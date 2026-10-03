import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ConfigStore } from '../src/config.js';
import { AgentStore } from '../src/agents.js';
import { SessionManager } from '../src/session.js';
import { createMcpServer } from '../src/mcp.js';

async function fixture(t,extra=[],agentOptions){
  const requests=[];let respond=()=>({code:200,data:{list:[{title:'fixture'}],total:1}});
  const server=createServer(async(req,res)=>{let body='';for await(const ch of req)body+=ch;requests.push({url:new URL(req.url,'http://localhost'),body,headers:req.headers});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(respond(requests.at(-1))));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const dir=await mkdtemp(join(tmpdir(),'zspace-mcp-'));const config=join(dir,'config.json');const store=new ConfigStore(config);
  const profile={baseUrl:`http://127.0.0.1:${server.address().port}`,allowHttp:true,cookies:{zenithtoken:'fixture-secret-a'}};
  await store.save('fixture',profile);
  const agents=new AgentStore(config);
  if(agentOptions)await agents.create('test-agent',{profile:'fixture',...agentOptions});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--config',config,'--domains','notes,music,docker,files',...(agentOptions?['--agent','test-agent']:[]),...extra],stderr:'pipe'});
  let stderr='';transport.stderr.on('data',chunk=>stderr+=chunk);
  const client=new Client({name:'zspace-test',version:'1.0.0'});
  t.after(async()=>{await client.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});assert.equal(stderr,'');});
  await client.connect(transport);
  return {client,requests,store,profile,dir,config,agents,setResponse:f=>respond=f};
}
test('stdio initialization, tools, resources and real HTTP query',async t=>{
  const f=await fixture(t);const tools=(await f.client.listTools()).tools;
  assert.ok(tools.some(x=>x.name==='zspace_notes'));assert.ok(tools.every(x=>!x.name.endsWith('_write')));
  assert.equal(tools.find(x=>x.name==='zspace_notes').annotations.readOnlyHint,true);
  const r=await f.client.callTool({name:'zspace_music',arguments:{request:{action:'songs',params:{page:2,page_size:5}}}});
  assert.equal(r.isError,undefined);assert.equal(r.structuredContent.result.total,1);
  assert.equal(f.requests.at(-1).url.pathname,'/zmusic/api/v2/song/list');assert.equal(new URLSearchParams(f.requests.at(-1).body).get('page_size'),'5');
  const resources=await f.client.listResources();assert.equal(resources.resources.length,3);
  const resource=await f.client.readResource({uri:'zspace://operations'});assert.ok(JSON.parse(resource.contents[0].text).every(x=>!x.write));
});
test('MCP write opt-in requires confirm; dry-run needs no NAS and validates input',async t=>{
  const f=await fixture(t,['--allow-write']);const tools=(await f.client.listTools()).tools;
  assert.equal(tools.find(x=>x.name==='zspace_notes_write').annotations.destructiveHint,true);
  const call=args=>f.client.callTool({name:'zspace_notes_write',arguments:args});
  const request={action:'create',params:{title:'synthetic'}};
  assert.equal((await call({request})).isError,true);assert.equal(f.requests.length,0);
  assert.equal((await call({request,dry_run:true})).structuredContent.result.dryRun,true);assert.equal(f.requests.length,0);
  assert.equal((await call({request:{action:'update',params:{}},confirm:true})).isError,true);assert.equal(f.requests.length,0);
  const done=await call({request,confirm:true});assert.equal(done.isError,undefined);assert.equal(f.requests.length,1);
  assert.equal(new URLSearchParams(f.requests[0].body).get('title'),'synthetic');
});
test('MCP rejects route/schema injection and cannot invoke writes from read group',async t=>{
  const f=await fixture(t);
  for(const request of [{action:'delete',params:{ids:[1]}},{action:'list',params:{host:'https://evil.invalid'}},{action:'list',params:{num:-1}},{action:'info',params:{}}]) {
    const r=await f.client.callTool({name:'zspace_notes',arguments:{request}});assert.equal(r.isError,true);
  }
  assert.equal(f.requests.length,0);
});
test('MCP sanitizes credentials in Docker env, compose text and error responses',async t=>{
  const f=await fixture(t);
  f.setResponse(()=>({code:200,data:{token:'secret-field',Env:['OPENAI_API_KEY=secret-env'],yaml:'PASSWORD: secret-yaml\nname: fixture',url:'https://user:secret-url@example.invalid'}}));
  const r=await f.client.callTool({name:'zspace_docker',arguments:{request:{action:'containers'}}});
  for(const secret of ['secret-field','secret-env','secret-yaml','secret-url'])assert.equal(JSON.stringify(r).includes(secret),false);
  f.setResponse(()=>({code:'N001411',msg:'denied fixture-secret-a'}));
  const err=await f.client.callTool({name:'zspace_notes',arguments:{request:{action:'list'}}});assert.equal(err.isError,true);assert.equal(JSON.stringify(err).includes('fixture-secret-a'),false);
});
test('MCP refreshes saved session each call and reports oversized output',async t=>{
  const f=await fixture(t,['--max-bytes','1024']);
  const args={name:'zspace_notes',arguments:{request:{action:'list'}}};
  await f.client.callTool(args);assert.match(f.requests.at(-1).headers.cookie,/fixture-secret-a/);
  await f.store.save('fixture',{...f.profile,cookies:{zenithtoken:'fixture-secret-b'}},{replace:true});
  f.setResponse(()=>({code:200,data:{text:'x'.repeat(2000)}}));
  const r=await f.client.callTool(args);assert.match(f.requests.at(-1).headers.cookie,/fixture-secret-b/);assert.equal(r.isError,true);assert.match(r.content[0].text,/MCP_RESULT_TOO_LARGE/);
});
test('MCP validates domain filters and output limit at startup',()=>{
  assert.throws(()=>createMcpServer({domains:'not-real'}),{code:'USAGE'});
  assert.throws(()=>createMcpServer({maxBytes:1}),{code:'USAGE'});
});
test('Restricted Agent MCP discovers only granted actions and reads its packaged workflow',async t=>{
  const f=await fixture(t,['--allow-write'],{read:'notes.list',write:'notes.create'});
  assert.deepEqual((await f.client.listTools()).tools.map(t=>t.name).sort(),['zspace_capabilities','zspace_catalog','zspace_notes','zspace_notes_write']);
  const caps=await f.client.callTool({name:'zspace_capabilities',arguments:{}});
  assert.deepEqual(caps.structuredContent.result.operations.sort(),['notes.create','notes.list']);assert.equal(f.requests.length,0);
  const guide=await f.client.readResource({uri:'zspace://agent-guide'});assert.match(guide.contents[0].text,/Never automatically replay a write/);
  const denied=await f.client.callTool({name:'zspace_notes',arguments:{request:{action:'usage'}}});assert.equal(denied.isError,true);assert.equal(f.requests.length,0);
  const request={action:'create',params:{title:'synthetic'}};
  assert.equal((await f.client.callTool({name:'zspace_notes_write',arguments:{request,dry_run:true}})).structuredContent.result.dryRun,true);assert.equal(f.requests.length,0);
  await f.client.callTool({name:'zspace_notes_write',arguments:{request,confirm:true}});assert.equal(f.requests.length,1);
});
test('Revoking a policy blocks subsequent requests through an already initialized MCP process',async t=>{
  const f=await fixture(t,[],{read:'notes.list'}),call=()=>f.client.callTool({name:'zspace_notes',arguments:{request:{action:'list'}}});
  assert.equal((await call()).isError,undefined);await f.agents.revoke('test-agent');
  const r=await call();assert.equal(r.isError,true);assert.equal(JSON.parse(r.content[0].text).error.code,'AGENT_REVOKED');assert.equal(f.requests.length,1);
  assert.equal((await f.client.callTool({name:'zspace_catalog',arguments:{}})).isError,true);
});
test('MCP reloads and verifies rotating source; invalid credentials are not replayed or saved',async t=>{
  const f=await fixture(t,['--allow-write'],{read:'notes.list',write:'notes.create'});
  const source=join(f.dir,'session.json'),manager=new SessionManager({config:f.config,profile:'fixture'});
  await writeFile(source,JSON.stringify(f.profile),{mode:0o600});await manager.bindSource(source);f.requests.length=0;
  const next={...f.profile,cookies:{zenithtoken:'fixture-rotated'}};
  await writeFile(source,JSON.stringify(next));
  await f.client.callTool({name:'zspace_notes',arguments:{request:{action:'list'}}});
  assert.equal(f.requests.length,2);assert.equal(f.requests[0].url.pathname,'/auth/token');assert.match(f.requests[1].headers.cookie,/fixture-rotated/);
  f.setResponse(()=>({code:'N001208'}));f.requests.length=0;
  const r=await f.client.callTool({name:'zspace_notes_write',arguments:{request:{action:'create',params:{title:'fixture'}},confirm:true}});
  assert.equal(JSON.parse(r.content[0].text).error.code,'AUTH_REQUIRED');assert.equal(f.requests.length,1);
  await writeFile(source,JSON.stringify({...next,cookies:{zenithtoken:'fixture-invalid'}}));f.requests.length=0;
  assert.equal((await f.client.callTool({name:'zspace_notes',arguments:{request:{action:'list'}}})).isError,true);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url.pathname,'/auth/token');assert.equal((await f.store.select()).profile.cookies.zenithtoken,'fixture-rotated');
});
test('Downloads are excluded from readonly MCP and cannot bypass directory scope via write tool',async t=>{
  const f=await fixture(t,['--allow-write'],{read:'files.roots,files.info',write:'files.download',nasRoots:['/1/my/data/safe'],localRoots:[tmpdir()]});
  const catalogue=await f.client.callTool({name:'zspace_catalog',arguments:{name:'files.download'}});assert.equal(catalogue.structuredContent.result[0].localWrite,true);
  const request={action:'download',params:{remote:'/1/my/data/outside',local:join(tmpdir(),'zspace-do-not-create')}};
  const r=await f.client.callTool({name:'zspace_files_write',arguments:{request,dry_run:true}});assert.equal(JSON.parse(r.content[0].text).error.code,'AGENT_DENIED');assert.equal(f.requests.length,0);
  const roots=await f.client.callTool({name:'zspace_files',arguments:{request:{action:'roots'}}});assert.equal(roots.structuredContent.result[0].path,'/1/my/data/safe');assert.equal(f.requests.length,0);
});
test('Owner readonly MCP excludes every operation with local side effects',async t=>{
  const f=await fixture(t);
  const r=await f.client.callTool({name:'zspace_catalog',arguments:{}});
  assert.ok(r.structuredContent.result.every(o=>!o.write&&!o.localWrite));
  assert.equal((await f.client.callTool({name:'zspace_files',arguments:{request:{action:'download',params:{remote:'/1/my/data/x',local:'/tmp/x'}}}})).isError,true);assert.equal(f.requests.length,0);
});
