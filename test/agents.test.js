import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/config.js';
import { AgentStore, AgentRuntime, agentConnection } from '../src/agents.js';
import { execute } from '../src/cli.js';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'zspace-agent-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const config=join(dir,'config.json'),store=new ConfigStore(config),agents=new AgentStore(config);
  await store.save('fixture',{baseUrl:'https://nas.example.invalid',cookies:{token:'private-fixture-value'}});
  const requests=[];
  const clientFactory=p=>({secrets:[p.cookies.token],request:async(path,options)=>{requests.push({path,options});return {ok:true};}});
  const create=async(name,options)=>{await agents.create(name,{profile:'fixture',...options});return AgentRuntime.create(name,{config,clientFactory});};
  return {dir,config,store,agents,requests,create};
}
test('Agent grants expand to exact known operations and redact all connection configuration',async t=>{
  const f=await fixture(t),r=await f.create('reader',{read:'notes.*,system.status'});
  const ops=await r.operations();assert.ok(ops.some(o=>o.name==='notes.list'));assert.ok(ops.every(o=>!o.write));
  assert.equal((await r.run('system.status',{})).ok,undefined);
  const json=await agentConnection(f.config,'reader');
  assert.ok(json.mcpServers['zspace-reader'].args.includes('--agent'));
  assert.equal(JSON.stringify(json).includes('private-fixture-value'),false);
  assert.match(await agentConnection(f.config,'reader','codex'),/tool_timeout_sec = 120/);
});
test('Agent disallows ungranted operations, validates schema, and respects write confirmation without I/O',async t=>{
  const f=await fixture(t),r=await f.create('notes',{read:'notes.list',write:'notes.create'});
  await assert.rejects(r.run('docker.containers',{}),{code:'AGENT_DENIED'});
  await assert.rejects(r.run('notes.create',{title:'x'}),{code:'WRITE_DISABLED'});
  await assert.rejects(r.run('notes.list',{host:'evil'}),{code:'USAGE'});
  assert.equal((await r.run('notes.create',{title:'x'},{dryRun:true})).dryRun,true);
  assert.equal(f.requests.length,0);
  await r.run('notes.create',{title:'x'},{allowWrite:true});assert.equal(f.requests.length,1);
});
test('Agent revocation and removed grants take effect in an already running connection',async t=>{
  const f=await fixture(t),r=await f.create('notes',{read:'notes.list,notes.usage'});
  await r.run('notes.list',{});
  await f.store.update(c=>{c.agents.notes.read=['notes.usage'];});
  await assert.rejects(r.run('notes.list',{}),{code:'AGENT_DENIED'});
  assert.deepEqual((await r.operations()).map(o=>o.name),['notes.usage']);
  await f.agents.revoke('notes');
  await assert.rejects(r.run('notes.usage',{}),{code:'AGENT_REVOKED'});
  assert.equal(f.requests.length,1);
});
test('Agent pins profile, origin, and initial grants; a changed active profile cannot retarget it',async t=>{
  const f=await fixture(t),r=await f.create('notes',{read:'notes.list'});
  await f.store.save('other',{baseUrl:'https://other.invalid',cookies:{token:'other'}});
  await f.store.update(c=>{c.active='other';c.agents.notes.read.push('notes.usage');});
  await r.run('notes.list',{});assert.equal(f.requests.length,1);
  await assert.rejects(r.run('notes.usage',{}),{code:'AGENT_DENIED'});
  await f.store.update(c=>{c.profiles.fixture.baseUrl='https://changed.invalid';});
  await assert.rejects(r.run('notes.list',{}),{code:'AGENT_DENIED'});assert.equal(f.requests.length,1);
  await f.store.update(c=>{c.agents.notes.profile='other';});
  await assert.rejects(r.run('notes.list',{}),{code:'AGENT_DENIED'});
});
test('NAS scope checks source, destination, rename destination, traversal and sibling-prefix escapes',async t=>{
  const f=await fixture(t),root='/1/my/data/agent';
  const r=await f.create('files',{read:'files.roots,files.list,files.info',write:'files.mkdir,files.copy,files.move,files.rename',nasRoots:[root]});
  assert.deepEqual(await r.run('files.roots',{}),[{path:root,scope:'configured-agent-root'}]);
  for (const [op,p] of [['files.list',{path:root+'-other'}],['files.copy',{paths:[root+'/a'],to:'/1/my/data'}],['files.move',{paths:['/1/my/data/outside'],to:root}],['files.rename',{path:root,name:'other'}],['files.rename',{path:root+'/a',name:'../b'}]]) {
    await assert.rejects(r.run(op,p,{dryRun:true}),{code:'AGENT_DENIED'});
  }
  await assert.rejects(r.run('files.info',{path:root+'/../escape'}),{code:'USAGE'});
  assert.equal((await r.run('files.mkdir',{path:root+'/child'},{dryRun:true})).dryRun,true);
  assert.equal(f.requests.length,0);
});
test('Local transfer scope resolves symlinks and treats downloads as mutations',async t=>{
  const f=await fixture(t),local=join(f.dir,'allowed'),outside=join(f.dir,'outside');
  await mkdir(local);await mkdir(outside);await writeFile(join(outside,'x'),'fixture');await symlink(outside,join(local,'escape'));await symlink(join(outside,'not-created'),join(local,'dangling'));
  const r=await f.create('transfer',{read:'files.roots',write:'files.upload,files.download',nasRoots:['/1/my/data/agent'],localRoots:[local]});
  for (const p of [join(outside,'x'),join(local,'escape','x'),join(local,'escape','new'),join(local,'dangling','new'),local+'-other/new','relative']) {
    await assert.rejects(r.run('files.download',{remote:'/1/my/data/agent/x',local:p},{dryRun:true}),{code:'AGENT_DENIED'});
  }
  const args={remote:'/1/my/data/agent/x',local:join(local,'new')};
  await assert.rejects(r.run('files.download',args),{code:'WRITE_DISABLED'});
  assert.equal((await r.run('files.download',args,{dryRun:true})).dryRun,true);assert.equal(f.requests.length,0);
});
test('Policy creation rejects incomplete file scopes and does not overwrite existing names',async t=>{
  const f=await fixture(t);
  for (const options of [{read:'files.*',nasRoots:['/1/my/data']},{read:'files.list'},{read:'files.download'},{write:'files.upload',nasRoots:['/1/my/data']},{read:'unknown.*'}]) await assert.rejects(f.agents.create('bad',options),{code:'USAGE'});
  await f.create('reader');await assert.rejects(f.create('reader'),{code:'CONFLICT'});
});
test('CLI Agent calls use the policy even for dry-run, with no credential exposure in configs',async t=>{
  const f=await fixture(t);
  await execute(['agent','create','notes','--read','notes.list','--write','notes.create','--yes','--config',f.config,'--json']);
  const result=await execute(['agent','call','notes','notes.create','--params','{"title":"synthetic"}','--dry-run','--config',f.config,'--json']);
  assert.equal(JSON.parse(result.output).dryRun,true);
  await assert.rejects(execute(['agent','call','notes','docker.start','--params','{}','--dry-run','--config',f.config]),{code:'AGENT_DENIED'});
  await assert.rejects(execute(['agent','call','notes','notes.list','--profile','other','--config',f.config]),{code:'USAGE'});
});
test('Owner updates preserve unspecified fields and revoked state; additions need a new runtime',async t=>{
  const f=await fixture(t),r=await f.create('reader',{read:'notes.list'});
  await f.agents.update('reader',{read:'notes.usage',write:'notes.create'});
  await assert.rejects(r.run('notes.list',{}),{code:'AGENT_DENIED'});
  await assert.rejects(r.run('notes.usage',{}),{code:'AGENT_DENIED'});
  const newer=await AgentRuntime.create('reader',{config:f.config,clientFactory:()=>({request:async()=>({})})});
  await newer.run('notes.usage',{});
  await f.agents.update('reader',{write:''});assert.deepEqual((await f.agents.get('reader')).read,['notes.usage']);
  await f.agents.revoke('reader');await f.agents.update('reader',{read:'notes.list'});assert.equal((await f.agents.get('reader')).disabled,true);
});
