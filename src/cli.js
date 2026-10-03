import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { ConfigStore, importSession, validateName, configPath } from './config.js';
import { Client } from './client.js';
import { READ_APIS, readApi, status } from './catalog.js';
import * as files from './files.js';
import { ZspaceError, usage, redact, authError } from './errors.js';
import { OPERATIONS, operationInfo, parameters, runOperation } from './operations.js';
import { VERSION } from './version.js';
import { SessionManager } from './session.js';
import { AgentStore, AgentRuntime, agentConnection, isMutation } from './agents.js';

const string = { type: 'string' }, boolean = { type: 'boolean' };
const globals = { help: { ...boolean, short: 'h' }, version: { ...boolean, short: 'V' }, json: boolean, profile: string, config: string, timeout: string };
const writes = { yes: { ...boolean, short: 'y' }, 'dry-run': boolean };
const fileListOptions = { start: string, limit: string, all: boolean, hidden: boolean, sort: string, order: string };
const taskOptions = { 'no-wait': boolean, 'wait-ms': string };
const commands = [
  { name: 'status', usage: '', description: '设备概况：CPU、内存、容量', run: c => status(c) },
  { name: 'auth import', usage: '--file <session.json> | --stdin [--name home]', description: '导入已登录浏览器会话并验证', local: true, options: { file: string, stdin: boolean, name: string, url: string, replace: boolean, 'allow-http': boolean } },
  { name: 'auth status', usage: '', description: '验证当前会话', run: async c => { const user = await c.request('/auth/token'); return { authenticated: true, role: user.role, isMaster: Boolean(Number(user.is_master)), pools: user.sp_perms || [] }; } },
  { name: 'auth logout', usage: '[--yes]', description: '清除本机选中配置，保留网页登录', local: true, write: true },
  { name: 'auth source', usage: '--file <private-session.json> | --clear --yes', description: '绑定或解绑同一 NAS 的私密会话轮换文件', local:true, write:true, options:{file:string,clear:boolean} },
  { name: 'auth refresh', usage: '', description: '验证当前会话并载入轮换文件中的新会话', local:true },
  { name: 'auth session', usage: '', description: '查看会话模式和恢复步骤，不显示凭证', local:true },
  { name: 'agent create', usage: '<name> [--read system.status,apps.coverage] [--write notes.create] --yes', description: '创建固定 NAS、明确操作和目录范围的 Agent 配置',local:true,write:true,min:1,max:1,options:{read:string,write:string,'nas-root':{...string,multiple:true},'local-root':{...string,multiple:true}} },
  { name: 'agent list', usage: '', description: '列出 Agent 配置与撤销状态',local:true },
  { name: 'agent update', usage: '<name> [--read OPERATIONS] [--write OPERATIONS] --yes', description: '由所有者调整权限；新增操作需要重启 MCP 连接',local:true,write:true,min:1,max:1,options:{read:string,write:string,'nas-root':{...string,multiple:true},'local-root':{...string,multiple:true}} },
  { name: 'agent show', usage: '<name>', description: '查看 Agent 的完整权限，不显示凭证',local:true,min:1,max:1 },
  { name: 'agent revoke', usage: '<name> --yes', description: '撤销 Agent 后续调用权限',local:true,write:true,min:1,max:1 },
  { name: 'agent config', usage: '<name> [--format json|codex]', description: '生成不含凭证的 MCP 客户端配置',local:true,min:1,max:1,options:{format:string} },
  { name: 'agent call', usage: '<name> <operation> [--params JSON] [--yes|--dry-run]', description: '在 Agent 权限内执行同一注册表操作',local:true,min:2,max:2,options:{params:string,...writes} },
  { name: 'agent doctor', usage: '<name>', description: '检查 Agent 权限、会话和 MCP 启动配置',local:true,min:1,max:1 },
  { name: 'profile list', usage: '', description: '列出配置，不显示凭证', local: true },
  { name: 'profile use', usage: '<name>', description: '切换默认配置', local: true, min: 1, max: 1 },
  { name: 'config path', usage: '', description: '显示本机配置路径', local: true },
  { name: 'doctor', usage: '', description: '检查认证和核心接口', run: async c => {
    const checks = [];
    for (const [name, endpoint] of [['auth', '/auth/token'], ['system', '/system/polling2'], ['storage', '/zspool/info']]) {
      try { await c.request(endpoint); checks.push({ name, ok: true }); }
      catch (e) { checks.push({ name, ok: false, code: e.code || 'ERROR', message: e.message }); }
    }
    return { ok: checks.every(x => x.ok), checks };
  } },
  { name: 'files roots', usage: '', description: '列出当前账号可访问的个人空间根目录', run: async c => {
    const user = await c.request('/auth/token');
    return (user.sp_perms || []).filter(p => p.perm && p.perm !== 'none').map(p => ({ pool: p.pool, permission: p.perm, path: `/${p.pool}/my/data` }));
  } },
  { name: 'files ls', usage: '<path> [--all] [--limit 100]', description: '列目录，支持完整分页', min: 1, max: 1, options: fileListOptions, run: (c, a, o) => files.listFiles(c, a[0], { start: int(o.start, 0), limit: int(o.limit, 100), all: o.all, hidden: o.hidden, sort: o.sort || 'name', order: o.order || 'asc' }) },
  { name: 'files stat', usage: '<path>', description: '文件或目录元数据', min: 1, max: 1, run: (c, a) => files.fileInfo(c, a[0]) },
  { name: 'files mkdir', usage: '<path> --yes', description: '创建目录（父目录必须已存在）', min: 1, max: 1, write: true, plan: a => ({ path: files.writablePath(a[0]) }), run: (c, a) => files.mkdirRemote(c, a[0]) },
  { name: 'files rename', usage: '<path> <new-name> --yes', description: '改名，不覆盖已有文件', min: 2, max: 2, write: true, plan: a => ({ path: files.writablePath(a[0]), name: files.fileName(a[1]) }), run: (c, a) => files.renameRemote(c, a[0], a[1]) },
  ...['copy', 'move'].map(mode => ({ name: `files ${mode}`, usage: '<source...> --to <directory> --yes', description: mode === 'copy' ? '复制文件/目录到目标目录' : '移动文件/目录到目标目录', min: 1, max: Infinity, options: { to: string, ...taskOptions }, write: true, plan: (a, o) => ({ paths: a.map(files.writablePath), to: files.nasPath(required(o.to, '--to')) }), run: (c, a, o) => files.transferRemote(c, a, o.to, mode, { wait: !o['no-wait'], waitMs: int(o['wait-ms'], 30000) }) })),
  { name: 'files trash', usage: '<path...> --yes', description: '移入回收站；回收站策略未知时拒绝', min: 1, max: Infinity, write: true, options: taskOptions, plan: a => ({ paths: a.map(files.writablePath) }), run: (c, a, o) => files.trashRemote(c, a, { wait: !o['no-wait'], waitMs: int(o['wait-ms'], 30000) }) },
  { name: 'files task', usage: '<id> [--wait]', description: '查询文件任务，可等待完成', min: 1, max: 1, options: { wait: boolean, 'wait-ms': string }, run: async (c, a, o) => { const task = await files.taskInfo(c, a[0]); return o.wait ? files.waitTask(c, task, { waitMs: int(o['wait-ms'], 30000) }) : task; } },
  { name: 'files recycle', usage: '[--start 0] [--limit 100]', description: '列出个人回收站', options: { start: string, limit: string }, run: (c, a, o) => files.listTrash(c, { start: int(o.start, 0), limit: int(o.limit, 100) }) },
  { name: 'files upload', usage: '<local-file> <remote-file> --yes', description: '流式上传一个文件，拒绝重名', min: 2, max: 2, write: true, plan: a => ({ source: a[0], path: files.writablePath(a[1]) }), run: (c, a, o) => files.upload(c, a[0], a[1], { timeout: int(o.timeout, 3600000) }) },
  { name: 'files download', usage: '<remote-file> <local-file> --yes', description: '流式下载，原子保存，返回 SHA-256', min: 2, max: 2, write:true, plan:a=>({remote:files.nasPath(a[0]),local:a[1]}), run: (c, a, o) => files.download(c, a[0], a[1], { timeout: int(o.timeout, 3600000) }) },
  { name: 'api list', usage: '', description: '列出操作 schema、写入属性和接口', local: true },
  { name: 'api call', usage: '<operation> [--params JSON] [--param key=value]', description: '调用注册表中的只读操作', min: 1, max: 1, options: { params:string, param: { ...string, multiple: true } },
    needsNas:a=>readOperation(a[0]).requiresNas!==false,
    plan:(a,o)=>{const op=readOperation(a[0]);return {parameters:parameters(op,operationInput(op,o))};},
    run:(c,a,o)=>{const op=readOperation(a[0]);return runOperation(c,op.name,operationInput(op,o));} },
  { name: 'commands', usage: '[--json]', description: '命令目录，可供脚本和 AI 发现', local: true },
  { name: 'completion', usage: '<bash|zsh>', description: '输出 shell 补全脚本', local: true, min: 1, max: 1 },
  { name: 'api describe', usage: '<operation>', description: '查看操作的参数 schema、方法和写入属性', local:true,min:1,max:1 },
  { name: 'mcp serve', usage: '[--agent NAME] [--allow-write] [--domains files,notes,music]', description: '启动 stdio MCP 服务', local:true, options:{agent:string,'allow-write':boolean,domains:string,'max-bytes':string} },
];
for (const [name, api] of Object.entries(READ_APIS)) commands.push({ name: name.replace('.', ' '), usage: '', description: api.description, run: c => readApi(c, name) });
for (const op of OPERATIONS.values()) {
  const name=op.name.replaceAll('.',' ');
  if(commands.some(c=>c.name===name)) continue;
  const fields=Object.keys(op.schema.shape);
  const props=operationInfo(op).inputSchema.properties;
  const options={params:string,param:{...string,multiple:true},...Object.fromEntries(fields.map(k=>[fieldOption(k),props[k]?.type==='boolean'?boolean:string]))};
  commands.push({name,description:op.description,usage:'[--params JSON] [--param key=value]'+(isMutation(op)?' --yes':''),options,write:isMutation(op),needsNas:op.requiresNas!==false,
    plan:(a,o)=>({parameters:parameters(op,operationInput(op,o)),...(op.validation?{validation:op.validation}:{})}),
    run:(c,a,o)=>runOperation(c,op.name,operationInput(op,o),{allowWrite:o.yes===true})});
}
function readOperation(name) {
  const op=OPERATIONS.get(name);
  if(!op||isMutation(op))throw usage('api call 只接受已注册的只读操作；写入请使用对应命令和 --yes。');
  return op;
}
// Keep the global credential-file --config separate from an application's config payload.
function fieldOption(key) { return key==='config'?'spec':key.replaceAll('_','-'); }
function operationInput(op,options) {
  let input={};
  if(options.params){try{input=JSON.parse(options.params);}catch{throw usage('--params 必须是 JSON 对象。');}}
  if(!input||typeof input!=='object'||Array.isArray(input))throw usage('--params 必须是 JSON 对象。');
  const schema=operationInfo(op).inputSchema;
  const parseValue=(k,v)=>{const s=schema.properties[k];if(s?.type==='string')return v;try{return JSON.parse(v);}catch{return v;}};
  for(const pair of options.param||[]){const i=pair.indexOf('=');if(i<1)throw usage('--param 需要 key=value。');const k=pair.slice(0,i);if(!Object.hasOwn(op.schema.shape,k))throw usage(`未知参数 ${k}`);input[k]=parseValue(k,pair.slice(i+1));}
  for(const k of Object.keys(op.schema.shape)){const v=options[fieldOption(k)];if(v!==undefined)input[k]=parseValue(k,v);}
  return input;
}
export const COMMANDS = commands;
const aliases = { ls: 'files ls', stat: 'files stat', mkdir: 'files mkdir', mv: 'files move', cp: 'files copy', rm: 'files trash', put: 'files upload', get: 'files download' };
function required(value, label) { if (!value) throw usage(`缺少 ${label}。`); return value; }
function int(value, fallback) { if (value === undefined) return fallback; if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw usage('数值参数必须是非负整数。'); return Number(value); }
const catalogue = () => commands.map(c => ({ command: c.name, usage: `zspace ${c.name} ${c.usage}`.trim(), description: c.description, writes: Boolean(c.write), options: Object.keys(c.options || {}) }));
export function parse(argv) {
  const allOptions = { ...globals, ...writes };
  for (const c of commands) Object.assign(allOptions, c.options);
  let first;
  try { first = parseArgs({ args: argv, options: allOptions, allowPositionals: true, strict: true, tokens: true }); }
  catch (error) { throw usage(error.message); }
  const p = first.positionals;
  if (!p.length || (first.values.version && !p.length)) return { options: first.values, command: null, args: [] };
  const expanded = aliases[p[0]] ? [...aliases[p[0]].split(' '), ...p.slice(1)] : p;
  const command = [...commands].sort((a, b) => b.name.length - a.name.length).find(c => c.name.split(' ').every((part, i) => part === expanded[i]));
  if (!command) throw usage(`未知命令 ${p.slice(0, 2).join(' ')}。运行 zspace --help。`);
  const allowed = { ...globals, ...command.options, ...(command.write ? writes : {}) };
  for (const name of Object.keys(first.values)) if (!Object.hasOwn(allowed, name)) throw usage(`命令 ${command.name} 不接受 --${name}。`);
  const args = expanded.slice(command.name.split(' ').length);
  if (!first.values.help && (args.length < (command.min || 0) || args.length > (command.max || 0))) throw usage(`用法：zspace ${command.name} ${command.usage}`);
  return { command, args, options: first.values };
}
function help(command) {
  if (command) return `zspace ${command.name} ${command.usage}\n${command.description}\n${OPERATIONS.has(command.name.replaceAll(' ','.'))?JSON.stringify(operationInfo(OPERATIONS.get(command.name.replaceAll(' ','.'))).inputSchema,null,2)+'\n':''}\n全局参数：--profile NAME --config PATH --json --timeout MS\n`;
  return `极空间 CLI v${VERSION} · Node.js 22+\n\n用法：zspace <command> [options]\n\n${catalogue().map(c => `  ${c.command.padEnd(28)} ${c.description}`).join('\n')}\n\n全局参数：--profile NAME --config PATH --json --timeout MS --help --version\n写入需 --yes；--dry-run 只输出计划，不发送请求。\n快捷命令：ls stat mkdir mv cp rm put get\n`;
}
function table(rows, columns) {
  const clean = v => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');
  const matrix = [columns.map(c => c[0]), ...rows.map(r => columns.map(([, fn]) => clean(fn(r))))];
  const widths = columns.map((_, i) => Math.max(...matrix.map(row => [...row[i]].length)));
  return matrix.map(row => row.map((cell, i) => cell + ' '.repeat(widths[i] - [...cell].length)).join('  ').trimEnd()).join('\n');
}
export function format(value, command, json) {
  const safe = redact(value);
  if (json) return JSON.stringify(safe, null, 2);
  if (typeof safe === 'string') return safe;
  if (command?.name === 'files ls') return table(safe.items, [['类型', r => String(r.is_dir) === '1' ? 'DIR' : 'FILE'], ['字节', r => r.size], ['名称', r => r.name]]) + `\n返回 ${safe.items.length} / 共 ${safe.total}${safe.hasMore ? '（有后续，使用 --all）' : ''}`;
  return JSON.stringify(safe, null, 2);
}
async function readStdin() { let text = ''; for await (const chunk of process.stdin) { text += chunk; if (text.length > 1048576) throw usage('会话输入超过 1 MiB。'); } return text; }
async function localCommand(command, args, options, store) {
  if (command.name.startsWith('auth ') && ['auth source','auth refresh','auth session'].includes(command.name)) {
    const manager = new SessionManager({config:store.path,profile:options.profile,timeout:int(options.timeout,30000)});
    if (command.name==='auth refresh') return manager.refresh();
    if (command.name==='auth session') return manager.status();
    if (Boolean(options.file)===Boolean(options.clear)) throw usage('提供 --file 或 --clear 其中一个。');
    return manager.bindSource(options.clear?null:options.file);
  }
  if (command.name.startsWith('agent ')) {
    const agents = new AgentStore(store.path), name=args[0];
    if (command.name==='agent create') return agents.create(name,{profile:options.profile,read:options.read,write:options.write,nasRoots:options['nas-root'],localRoots:options['local-root']});
    if (options.profile) throw usage('Agent 已固定 NAS profile；该命令不接受 --profile 覆盖。');
    if (command.name==='agent update') return agents.update(name,{read:options.read,write:options.write,nasRoots:options['nas-root'],localRoots:options['local-root']});
    if (command.name==='agent list') return agents.list();
    if (command.name==='agent show') return agents.get(name);
    if (command.name==='agent revoke') return agents.revoke(name);
    if (command.name==='agent config') return agentConnection(store.path,name,options.format);
    const runtime=await AgentRuntime.create(name,{config:store.path,timeout:int(options.timeout,30000)});
    if (command.name==='agent doctor') {
      const checks=[];
      try { const c=await new SessionManager({config:store.path,profile:runtime.initial.profile,expectedOrigin:runtime.initial.origin}).client(); await c.request('/auth/token'); checks.push({name:'auth',ok:true}); }
      catch(e) { checks.push({name:'auth',ok:false,code:e instanceof ZspaceError?e.code:'LOCAL_ERROR'}); }
      return {ok:checks.every(c=>c.ok),checks,capabilities:await runtime.describe(),connection:await agentConnection(store.path,name)};
    }
    let input={};
    try { input=options.params?JSON.parse(options.params):{}; } catch { throw usage('--params 必须是 JSON 对象。'); }
    return runtime.run(args[1],input,{allowWrite:options.yes===true,dryRun:options['dry-run']===true});
  }
  if (command.name === 'config path') return store.path;
  if (command.name === 'commands') return catalogue();
  if (command.name === 'api list') return [...OPERATIONS.values()].map(operationInfo);
  if (command.name === 'api describe') {const op=OPERATIONS.get(args[0]);if(!op)throw usage('未知操作。');return operationInfo(op);}
  if (command.name === 'completion') {
    const words = [...new Set(commands.map(c => c.name.split(' ')[0]))].join(' ');
    if (args[0] === 'bash') return `complete -W '${words}' zspace`;
    if (args[0] === 'zsh') return `#compdef zspace\ncompdef '_values "zspace command" ${words}' zspace`;
    throw usage('仅支持 bash / zsh 补全。');
  }
  if (command.name === 'auth import') {
    if (Boolean(options.file) === Boolean(options.stdin)) throw usage('提供 --file 或 --stdin 其中一个。');
    if (options.stdin && process.stdin.isTTY) throw usage('--stdin 需要管道输入 JSON。');
    let input;
    try { input = JSON.parse(options.stdin ? await readStdin() : await readFile(options.file, 'utf8')); }
    catch (error) { if (error instanceof ZspaceError) throw error; throw usage('会话文件不是可读取的 JSON。'); }
    const profile = importSession(input, { url: options.url, allowHttp: options['allow-http'] });
    await new Client(profile).request('/auth/token');
    const name = validateName(options.name || 'home');
    await store.save(name, profile, { replace: options.replace });
    return { saved: true, profile: name, config: store.path, authenticated: true };
  }
  if (command.name === 'profile list') {
    const config = await store.read();
    return Object.entries(config.profiles).map(([name, p]) => ({ name, active: config.active === name, baseUrl: p.baseUrl, importedAt: p.importedAt }));
  }
  if (command.name === 'profile use') {
    validateName(args[0]);
    await store.update(config => { if (!Object.hasOwn(config.profiles, args[0])) throw usage('配置不存在。'); config.active = args[0]; });
    return { active: args[0] };
  }
  if (command.name === 'auth logout') {
    const { name } = await store.select(options.profile);
    await store.update(config => { delete config.profiles[name]; if (config.active === name) config.active = Object.keys(config.profiles)[0] || null; });
    return { removed: name, browserSessionPreserved: true };
  }
}
export async function execute(argv) {
  const { command, args, options } = parse(argv);
  if (options.version) return { output: VERSION };
  if (!command || options.help) return { output: help(command) };
  if (command.name === 'mcp serve') {
    const { startMcp } = await import('./mcp.js');
    await startMcp({config:options.config,profile:options.profile,agent:options.agent,allowWrite:options['allow-write']===true,domains:options.domains,maxBytes:int(options['max-bytes'],262144)});
    return {mcp:true};
  }
  const plan = command.plan?.(args, options) || { profile: options.profile || '(active)' };
  if (command.write) {
    if (options['dry-run']) return { output: format({ dryRun: true, operation: command.name, ...plan }, command, options.json) };
    if (!options.yes) throw usage('写入需要 --yes；可先使用 --dry-run 查看计划。');
  }
  const store = new ConfigStore(options.config || configPath());
  let value;
  if (command.local) value = await localCommand(command, args, options, store);
  else if(command.needsNas===false||typeof command.needsNas==='function'&&!command.needsNas(args)) value=await command.run(null,args,options);
  else {
    const client = await new SessionManager({config:store.path,profile:options.profile,timeout:int(options.timeout,30000)}).client();
    value = redact(await command.run(client, args, options), client.secrets);
  }
  return { output: format(value, command, options.json), exitCode: ['doctor','agent doctor'].includes(command.name) && value.ok === false ? 5 : 0 };
}
export async function main(argv) {
  try {
    const result = await execute(argv);
    if(result.mcp)return;
    process.stdout.write(result.output + (result.output.endsWith('\n') ? '' : '\n'));
    process.exitCode = result.exitCode || 0;
  } catch (error) {
    const known = error instanceof ZspaceError;
    const body = { ok: false, error: { code: known ? error.code : 'LOCAL_ERROR', message: known ? error.message : '本地操作失败，请检查路径、文件权限或输入。', ...(known ? error.details : {}) } };
    process.stderr.write((argv.includes('--json') ? JSON.stringify(redact(body)) : `错误 [${body.error.code}]：${redact(body.error.message)}`) + '\n');
    process.exitCode = known ? error.exitCode : 5;
  }
}
