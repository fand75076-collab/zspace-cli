// Explicit live acceptance using independent MCP clients and only new synthetic data.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { Client as McpClient } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ConfigStore } from '../src/config.js';
import { SessionManager } from '../src/session.js';
import { AgentStore, agentConnection, isMutation } from '../src/agents.js';
import { OPERATIONS, runOperation } from '../src/operations.js';
import { VERSION } from '../src/version.js';

const {values:o}=parseArgs({options:{yes:{type:'boolean'},profile:{type:'string',default:'home'},config:{type:'string'},parent:{type:'string'},report:{type:'string'}}});
if (!o.yes || !o.parent) throw new Error('Provide --yes and --parent with the NAS parent directory for synthetic acceptance.');
const scratch=await mkdtemp(join(tmpdir(),'zspace-agent-acceptance-'));
const config=join(scratch,'config.json'),source=join(scratch,'session.json');
const owner=new SessionManager({config:o.config,profile:o.profile});
const selected=await owner.select(),direct=await owner.client();
const root=posix.join(o.parent,'zspace-agent-test-'+randomUUID());
const name='acceptance',agents=new AgentStore(config),store=new ConfigStore(config);
await store.save('test',selected.profile);
// No synthetic token is sent to the real NAS. Token expiry/rotation is tested against fixtures.
await writeFile(source,JSON.stringify({baseUrl:selected.profile.baseUrl,allowHttp:selected.profile.allowHttp,cookies:selected.profile.cookies}),{mode:0o600});
await new SessionManager({config,profile:'test'}).bindSource(source);
await agents.create(name,{profile:'test',read:'system.status,apps.coverage,files.roots,files.list,files.info,notes.info,notes.search',write:'files.mkdir,files.upload,files.download,files.rename,files.trash,notes.create,notes.update,notes.delete',nasRoots:[root],localRoots:[scratch]});
const connection=(await agentConnection(config,name)).mcpServers['zspace-'+name];
const peers=[];
async function peer(write) {
  const args=connection.args.filter(a=>write||a!=='--allow-write');
  const transport=new StdioClientTransport({command:connection.command,args,stderr:'pipe'});
  const p={client:new McpClient({name:write?'acceptance-writer':'acceptance-reader',version:VERSION}),stderr:''};
  transport.stderr.on('data',b=>p.stderr+=b);peers.push(p);await p.client.connect(transport);return p.client;
}
const report={version:VERSION,date:new Date().toISOString(),transport:'Independent MCP stdio clients',checks:[],cleanup:[],limitations:['Session rotation/expiry tested with synthetic HTTP fixtures; live source validation uses the current authorized session.','Application policy is not vendor OAuth or an OS sandbox.','NAS symlink resolution and other firmware models remain unverified.']};
const check=async(name,fn)=>{try{await fn();report.checks.push({name,ok:true});console.log('PASS '+name);}catch(e){report.checks.push({name,ok:false,code:e.code||e.name});console.log('FAIL '+name+' '+(e.code||e.name));throw e;}};
const tool=async(c,operation,params={},extra={})=>{const op=OPERATIONS.get(operation),domain=op.domain;return c.callTool({name:`zspace_${domain.replaceAll('-','_')}${isMutation(op)?'_write':''}`,arguments:{request:{action:operation.slice(domain.length+1),params},...(isMutation(op)?{confirm:true}:{}),...extra}});};
const call=async(...args)=>{const r=await tool(...args);if(r.isError){const e=JSON.parse(r.content[0].text).error;throw Object.assign(new Error(e.code),{code:e.code});}return r.structuredContent.result;};
const expectCode=(r,code)=>{assert.equal(r.isError,true);assert.equal(JSON.parse(r.content[0].text).error.code,code);};
let folder=false,noteId,fatal=false;
try {
  const writer=await peer(true),reader=await peer(false);
  await check('two independent MCP clients initialize from generated connection JSON',async()=>{
    assert.equal(writer.getServerVersion().version,VERSION);assert.equal(reader.getServerVersion().version,VERSION);
    assert.ok((await writer.listTools()).tools.some(t=>t.name==='zspace_files_write'));
    assert.ok((await reader.listTools()).tools.every(t=>!t.name.endsWith('_write')));
  });
  await check('capability discovery returns policy, schema and packaged agent guide',async()=>{
    const r=await writer.callTool({name:'zspace_capabilities',arguments:{}});assert.equal(r.structuredContent.result.policy.agent,name);assert.equal(r.structuredContent.result.session.mode,'rotating-file');
    const schema=await reader.callTool({name:'zspace_catalog',arguments:{name:'files.list'}});assert.ok(schema.structuredContent.result[0].inputSchema.properties.path);
    assert.match((await reader.readResource({uri:'zspace://agent-guide'})).contents[0].text,/ZSpace NAS/);
  });
  await check('live status through Agent policy',async()=>{assert.ok(await call(reader,'system.status'));});
  await check('live application coverage through Agent policy',async()=>{const c=await call(reader,'apps.coverage');assert.ok(Array.isArray(c.applications));report.installedApplications=c.applications.length;});
  await check('configured root is the only root returned',async()=>{assert.deepEqual((await call(reader,'files.roots')).map(x=>x.path),[root]);});
  await check('NAS sibling path denied',async()=>{expectCode(await tool(reader,'files.list',{path:root+'-outside'}),'AGENT_DENIED');});
  await check('ungranted action rejected by MCP schema',async()=>{const r=await writer.callTool({name:'zspace_notes_write',arguments:{request:{action:'pin',params:{id:1}},confirm:true}});assert.equal(r.isError,true);});
  await check('write requires per-call confirmation',async()=>{expectCode(await tool(writer,'files.mkdir',{path:root},{confirm:false}),'USAGE');});
  await check('dry-run remains offline and does not create directory',async()=>{
    assert.equal((await call(writer,'files.mkdir',{path:root},{dry_run:true})).dryRun,true);
    const parent=await runOperation(direct,'files.list',{path:o.parent,all:true});assert.ok(!parent.items.some(x=>x.path===root));
  });
  await check('create owned synthetic directory',async()=>{folder=true;await call(writer,'files.mkdir',{path:root});assert.equal(String((await call(reader,'files.info',{path:root})).is_dir),'1');});
  const data=Buffer.concat([Buffer.from('极空间 Agent 测试\n'),randomBytes(131072)]),input=join(scratch,'source.bin'),output=join(scratch,'download.bin'),remote=posix.join(root,'中文测试.bin');
  await writeFile(input,data,{mode:0o600});const hash=createHash('sha256').update(data).digest('hex');
  await check('upload synthetic Unicode file through MCP',async()=>{assert.equal((await call(writer,'files.upload',{local:input,remote})).sha256,hash);});
  await check('local output outside policy denied',async()=>{expectCode(await tool(writer,'files.download',{remote,local:join(tmpdir(),'zspace-outside-'+randomUUID())},{dry_run:true}),'AGENT_DENIED');});
  await check('download synthetic file and verify bytes plus SHA-256',async()=>{assert.equal((await call(writer,'files.download',{remote,local:output})).sha256,hash);assert.deepEqual(await readFile(output),data);});
  await check('file listing supports the advertised mtime sort',async()=>{const r=await call(reader,'files.list',{path:root,sort:'mtime',limit:10});assert.equal(r.items.length,1);});
  await check('rename owned file and read back',async()=>{await call(writer,'files.rename',{path:remote,name:'renamed.bin'});assert.equal(Number((await call(reader,'files.info',{path:posix.join(root,'renamed.bin')})).size),data.length);});
  const title='zspace-agent-note-'+randomUUID();
  await check('create synthetic note and verify body',async()=>{const n=await call(writer,'notes.create',{title,body:'Agent synthetic body'});noteId=n.id;assert.ok(noteId);assert.equal((await call(reader,'notes.info',{id:noteId})).body,'Agent synthetic body');});
  await check('update synthetic note and verify body',async()=>{await call(writer,'notes.update',{id:noteId,title,body:'Updated synthetic body'});assert.equal((await call(reader,'notes.info',{id:noteId})).body,'Updated synthetic body');});
  await check('delete synthetic note and verify search absence',async()=>{await call(writer,'notes.delete',{ids:[noteId]});noteId=null;assert.ok(!JSON.stringify(await call(reader,'notes.search',{keyword:title})).includes(title));});
  await check('move owned directory to recycle bin and verify absence',async()=>{await call(writer,'files.trash',{paths:[root]});folder=false;const parent=await runOperation(direct,'files.list',{path:o.parent,all:true});assert.ok(!parent.items.some(x=>x.path===root));});
  await check('revoke policy while both MCP clients remain running',async()=>{await agents.revoke(name);expectCode(await tool(reader,'system.status'),'AGENT_REVOKED');expectCode(await tool(writer,'system.status'),'AGENT_REVOKED');});
} catch { fatal=true; }
finally {
  if(noteId)try{await runOperation(direct,'notes.delete',{ids:[noteId]},{allowWrite:true});report.cleanup.push({name:'synthetic note',ok:true});}catch(e){report.cleanup.push({name:'synthetic note',ok:false,code:e.code});}
  if(folder)try{await runOperation(direct,'files.trash',{paths:[root]},{allowWrite:true});report.cleanup.push({name:'synthetic directory',ok:true});}catch(e){report.cleanup.push({name:'synthetic directory',ok:false,code:e.code});}
  for(const p of peers)await p.client.close();
  report.stderrEmpty=peers.every(p=>p.stderr==='');
  report.passed=report.checks.filter(x=>x.ok).length;report.failed=report.checks.filter(x=>!x.ok).length;
  await rm(scratch,{recursive:true,force:true});
  if(o.report)await writeFile(o.report,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,stderrEmpty:report.stderrEmpty,cleanup:report.cleanup}));
  if(fatal||report.failed||!report.stderrEmpty||report.cleanup.some(x=>!x.ok))process.exitCode=1;
}
