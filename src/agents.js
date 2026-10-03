import { realpath, stat, lstat } from 'node:fs/promises';
import { resolve, isAbsolute, dirname, basename, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { ConfigStore, validateName } from './config.js';
import { SessionManager } from './session.js';
import { OPERATIONS, parameters, runOperation } from './operations.js';
import { nasPath } from './files.js';
import { ZspaceError, usage, conflict, redact } from './errors.js';
import { VERSION } from './version.js';

export const isMutation = op => Boolean(op.write || op.localWrite);
const scopedFiles = new Set(['files.roots','files.list','files.info','files.mkdir','files.rename','files.copy','files.move','files.trash','files.upload','files.download']);
const policySchema = z.strictObject({
  version: z.literal(1), name: z.string(), profile: z.string(), origin: z.string().url(),
  disabled: z.boolean(), read: z.array(z.string()), write: z.array(z.string()),
  nasRoots: z.array(z.string()), localRoots: z.array(z.string()), createdAt: z.string(),
});
const denied = message => new ZspaceError('AGENT_DENIED', message, { exitCode: 7 });
const within = (path, root, separator = '/') => path === root || path.startsWith(root.endsWith(separator) ? root : root + separator);
function expand(value, write) {
  const names = new Set();
  for (const pattern of (value || '').split(',').map(v=>v.trim()).filter(Boolean)) {
    const matches = [...OPERATIONS.values()].filter(o=>o.name===pattern || pattern.endsWith('.*') && o.domain===pattern.slice(0,-2));
    if (!matches.length) throw usage(`未知操作或应用域：${pattern}`);
    for (const op of matches) {
      if (op.experimental) throw usage(`不能授予尚未验证的实验操作：${op.name}`);
      if (isMutation(op) === write) names.add(op.name);
      else if (!pattern.endsWith('.*')) throw usage(`${op.name} 应放入 --${isMutation(op)?'write':'read'}。下载到本机也属于写操作。`);
    }
  }
  return [...names].sort();
}
function validatePolicy(input) {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw usage('Agent 配置格式无效。');
  const p = parsed.data;
  validateName(p.name); validateName(p.profile);
  for (const [mode, names] of [['read',p.read],['write',p.write]]) for (const name of names) {
    const op = OPERATIONS.get(name);
    if (!op || op.experimental || isMutation(op) !== (mode==='write')) throw usage(`Agent 授权操作无效：${name}`);
    if (op.domain==='files' && (!scopedFiles.has(name) || !p.nasRoots.length)) throw usage('Agent 文件权限需要 --nas-root；只支持 roots/list/info/mkdir/rename/copy/move/trash/upload/download。');
    if (['files.upload','files.download'].includes(name) && !p.localRoots.length) throw usage('Agent 上传/下载需要 --local-root。');
  }
  for (const root of p.nasRoots) if (nasPath(root)!==root) throw usage('NAS 根目录必须是规范绝对路径。');
  for (const root of p.localRoots) if (!isAbsolute(root)) throw usage('本机根目录必须是绝对路径。');
  return p;
}

export class AgentStore {
  constructor(config) { this.store = new ConfigStore(config); }
  async get(name) {
    validateName(name);
    const data = (await this.store.read()).agents;
    if (!data || !Object.hasOwn(data,name)) throw new ZspaceError('AGENT_NOT_FOUND','Agent 配置不存在；由所有者运行 agent create 创建。',{exitCode:7});
    const policy=validatePolicy(data[name]);
    if (policy.name!==name) throw usage('Agent 配置名称与存储键不一致。');
    return policy;
  }
  async list() {
    return Object.entries((await this.store.read()).agents || {}).map(([name,p])=>({name,profile:p.profile,disabled:p.disabled,read:p.read?.length,write:p.write?.length}));
  }
  async create(name, { profile, read = 'system.status,apps.inventory,apps.coverage', write = '', nasRoots = [], localRoots = [] } = {}) {
    validateName(name);
    const selected = await this.store.select(profile);
    const canonicalLocal = [];
    for (const root of localRoots) {
      const path = await realpath(resolve(root));
      if (!(await stat(path)).isDirectory()) throw usage('--local-root 必须是已经存在的目录。');
      canonicalLocal.push(path);
    }
    const policy = validatePolicy({ version:1,name,profile:selected.name,origin:selected.profile.baseUrl,disabled:false,
      read:expand(read,false),write:expand(write,true),nasRoots:[...new Set(nasRoots.map(nasPath))],localRoots:[...new Set(canonicalLocal)],createdAt:new Date().toISOString() });
    if (!policy.read.length && !policy.write.length) throw usage('至少授予一个明确操作。');
    await this.store.update(c=>{
      c.agents ||= {};
      if (Object.hasOwn(c.agents,name)) throw conflict('Agent 配置已经存在；请选择新名称，或先检查旧配置。');
      Object.defineProperty(c.agents,name,{value:policy,enumerable:true,writable:true,configurable:true});
    });
    return policy;
  }
  async revoke(name) {
    await this.get(name);
    await this.store.update(c=>{ if (!Object.hasOwn(c.agents || {},name)) throw conflict('Agent 配置已移除。'); c.agents[name].disabled=true; });
    return { name, disabled:true, effect:'New calls are denied; already dispatched NAS operations cannot be cancelled.' };
  }
  async update(name, { read, write, nasRoots, localRoots } = {}) {
    const before=await this.get(name), next={...before};
    if (read!==undefined) next.read=expand(read,false);
    if (write!==undefined) next.write=expand(write,true);
    if (nasRoots!==undefined) next.nasRoots=[...new Set(nasRoots.map(nasPath))];
    if (localRoots!==undefined) {
      next.localRoots=[];
      for (const root of localRoots) {
        const path=await realpath(resolve(root));
        if (!(await stat(path)).isDirectory()) throw usage('--local-root 必须是已经存在的目录。');
        next.localRoots.push(path);
      }
    }
    validatePolicy(next);
    await this.store.update(c=>{
      if (JSON.stringify(c.agents?.[name])!==JSON.stringify(before)) throw conflict('Agent 配置在编辑期间已变化，请重新调用。');
      c.agents[name]=next;
    });
    return {...next,reconnectForNewOperations:true};
  }
}

async function canonicalTarget(path) {
  if (!isAbsolute(path)) throw denied('Agent 本机文件路径必须是绝对路径。');
  let current=resolve(path); const missing=[];
  for (;;) {
    try { return resolve(await realpath(current),...missing.reverse()); }
    catch (e) {
      if (e.code!=='ENOENT' || dirname(current)===current) throw denied('无法验证本机文件路径。');
      try { if ((await lstat(current)).isSymbolicLink()) throw denied('本机路径包含无法解析的符号链接。'); }
      catch(error) { if (error.code!=='ENOENT') throw error; }
      missing.push(basename(current)); current=dirname(current);
    }
  }
}
export async function checkScope(policy, op, p) {
  if (!(isMutation(op)?policy.write:policy.read).includes(op.name)) throw denied(`未授予 ${op.name}。权限由所有者调整，Agent 不能自行扩大。`);
  if (op.domain !== 'files') return;
  if (!scopedFiles.has(op.name)) throw denied('该文件接口无法按目录限制，Agent 模式不开放。');
  const paths = [...(p.paths || []), ...['path','remote','to'].filter(k=>p[k]).map(k=>p[k])];
  if (op.name==='files.rename') {
    if (!p.name || p.name.includes('/') || p.name.includes('\\') || ['.','..'].includes(p.name)) throw denied('新文件名必须是单个名称。');
    paths.push(posix.join(posix.dirname(p.path),p.name));
  }
  for (const path of paths) if (!policy.nasRoots.some(root=>within(nasPath(path),root))) throw denied('NAS 文件路径超出 Agent 配置的目录范围。');
  if (p.local) {
    const path = await canonicalTarget(p.local);
    if (!policy.localRoots.some(root=>within(path,root,sep))) throw denied('本机文件路径超出 Agent 配置的目录范围（包括符号链接）。');
  }
}

export class AgentRuntime {
  constructor(store, initial, { clientFactory, timeout } = {}) { this.store=store; this.initial=initial; this.clientFactory=clientFactory; this.timeout=timeout; }
  static async create(name, options = {}) {
    const store = new AgentStore(options.config);
    const initial = await store.get(name);
    const runtime = new AgentRuntime(store,initial,options);
    await runtime.policy();
    return runtime;
  }
  async policy() {
    const p = await this.store.get(this.initial.name);
    if (p.disabled) throw new ZspaceError('AGENT_REVOKED','所有者已撤销该 Agent 的权限。',{exitCode:7});
    if (p.profile!==this.initial.profile || p.origin!==this.initial.origin) throw denied('Agent 的 NAS 绑定发生变化，需要重新启动连接。');
    return p;
  }
  async operations() {
    const p = await this.policy();
    const initial = new Set([...this.initial.read,...this.initial.write]);
    return [...p.read,...p.write].filter(n=>initial.has(n)).map(n=>OPERATIONS.get(n));
  }
  async describe() {
    const p=await this.policy();
    const ops=await this.operations();
    return {version:VERSION,agent:p.name,profile:p.profile,read:ops.filter(o=>!isMutation(o)).map(o=>o.name),write:ops.filter(isMutation).map(o=>o.name),nasRoots:p.nasRoots,localRoots:p.localRoots,
      enforcement:'Local application policy; not vendor OAuth or an OS sandbox.',fileScope:'Lexical NAS paths; NAS symlink resolution is not verified. Other app domains retain their account-level scope.',revocation:'Checked on every call; in-flight operations cannot be cancelled.',session:await new SessionManager({config:this.store.store.path,profile:p.profile}).status()};
  }
  async run(name, input, { allowWrite=false, dryRun=false } = {}) {
    const p=await this.policy();
    if (![...this.initial.read,...this.initial.write].includes(name)) throw denied('操作不在此连接的初始权限中；新增权限需要重启连接。');
    const op=OPERATIONS.get(name);
    if (!op) throw usage('未知操作。');
    const params=parameters(op,input);
    await checkScope(p,op,params);
    if (isMutation(op) && !allowWrite && !dryRun) throw new ZspaceError('WRITE_DISABLED','写操作需要 --yes，或 MCP --allow-write 与 confirm=true。',{exitCode:2});
    if (dryRun) return runOperation(null,name,params,{dryRun:true});
    if (name==='files.roots') return p.nasRoots.map(path=>({path,scope:'configured-agent-root'}));
    let client;
    if (op.requiresNas!==false) {
      const manager=new SessionManager({config:this.store.store.path,profile:p.profile,timeout:this.timeout,clientFactory:this.clientFactory,expectedOrigin:p.origin});
      client=await manager.client();
    }
    // Recheck after session verification, before dispatching any requested action.
    await checkScope(await this.policy(),op,params);
    try { return redact(await runOperation(client,name,params,{allowWrite}),client?.secrets || []); }
    catch(e) {
      if (e instanceof ZspaceError) throw new ZspaceError(e.code,redact(e.message,client?.secrets||[]),{...redact(e.details,client?.secrets||[]),exitCode:e.exitCode});
      throw e;
    }
  }
}

export async function agentConnection(config, name, format = 'json') {
  const store = new AgentStore(config), p = await store.get(name);
  if (p.disabled) throw denied('该 Agent 已被撤销。');
  const connection={command:process.execPath,args:[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--config',resolve(store.store.path),'--agent',name,...(p.write.length?['--allow-write']:[])]};
  if (format==='json') return {mcpServers:{[`zspace-${name}`]:connection}};
  if (format==='codex') return `[mcp_servers.${JSON.stringify(`zspace-${name}`)}]\ncommand = ${JSON.stringify(connection.command)}\nargs = ${JSON.stringify(connection.args)}\ntool_timeout_sec = 120\n`;
  throw usage('--format 支持 json（通用 MCP / Claude Desktop / Cursor）或 codex（TOML）。');
}
