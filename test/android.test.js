import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ANDROID_APPS, android, pythonRequest } from '../src/android.js';
import { OPERATIONS, operationInfo, runOperation } from '../src/operations.js';
import { coverage } from '../src/applications.js';
import { execute } from '../src/cli.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('Android runner passes Unicode through stdin without shell or text in argv',async()=>{
  const payload={action:'set-text',target:'a'.repeat(24),text:'中文; $(echo fixture) `whoami`'};
  let input,call;
  const execute=(...args)=>{call=args;const stdin=new EventEmitter();stdin.end=value=>{input=value;args[3](null,'{"ok":true,"result":{"changed":true}}');};return {stdin};};
  assert.deepEqual(await pythonRequest(payload,{execute,python:'/fixture/python'}),{changed:true});
  assert.equal(call[0],'/fixture/python');assert.equal(call[1].length,1);assert.ok(call[1][0].endsWith('android_bridge.py'));
  assert.equal(call[2].shell,undefined);assert.equal(call[2].timeout,45000);assert.deepEqual(JSON.parse(input),payload);
  const req=await android('screen',{action:'shell'},{runner:async x=>x});assert.equal(req.action,'screen');
});
test('Android runner reports bounded errors without reflecting subprocess diagnostics',async()=>{
  for(const [error,stdout,code] of [[{killed:true,message:'private'},'','ANDROID_TIMEOUT'],[{code:'ENOENT'},'','ANDROID_RUNTIME'],[null,'not JSON private','ANDROID_PROTOCOL'],[null,'{"ok":false,"error":{"code":"ANDROID_BUSY","message":"busy"}}','ANDROID_BUSY']]){
    const execute=(...args)=>{const stdin=new EventEmitter();stdin.end=()=>args[3](error,stdout,'private stderr');return {stdin};};
    await assert.rejects(pythonRequest({action:'screen'},{execute}),e=>e.code===code&&!e.message.includes('private'));
  }
});
test('Android schemas enforce write gates and dry run stays offline',async()=>{
  const ops=[...OPERATIONS.values()].filter(o=>o.domain==='android');assert.equal(ops.length,8);
  for(const op of ops){assert.equal(operationInfo(op).transport,'android-ui');assert.equal(op.requiresNas,false);}
  await assert.rejects(runOperation(null,'android.open',{app:'comics'}),{code:'WRITE_DISABLED'});
  const p=await runOperation(null,'android.open',{app:'comics'},{dryRun:true});assert.equal(p.transport,'android-ui');
  for(const [name,params] of [['tap',{target:'fake'}],['open',{app:'other.app'}],['screen',{serial:'x;sh'}],['screen',{url:'https://evil.invalid'}],['set-text',{target:'a'.repeat(24),text:'x'.repeat(4001)}]])
    await assert.rejects(runOperation(null,'android.'+name,params,{dryRun:true}),{code:'USAGE'});
});
test('Android CLI works without NAS configuration and writes require yes',async()=>{
  const o=['--config','/nonexistent/zspace-no-config.json','--json'];
  for(const args of [['android','apps'],['api','call','android.apps']])assert.deepEqual(JSON.parse((await execute([...args,...o])).output),ANDROID_APPS);
  await assert.rejects(execute(['android','open','--app','bookLib',...o]),{code:'USAGE'});
  assert.equal(JSON.parse((await execute(['android','open','--app','bookLib','--dry-run',...o])).output).dryRun,true);
  await assert.rejects(execute(['api','call','android.open','--params','{"app":"bookLib"}',...o]),{code:'USAGE'});
});
test('Coverage distinguishes Android UI from direct NAS business operations',async()=>{
  const c={baseUrl:'https://nas.invalid',request:async ep=>({list:ep.startsWith('/zdocker')?[]:['bookLib','comics','family','mobileBackup','helpCenter'].map(app_name=>({app_name,installed:1}))})};
  const x=await coverage(c,[...OPERATIONS.values()]);
  assert.equal(x.applications.filter(a=>a.scope==='android-ui').length,4);assert.equal(x.applications.at(-1).scope,'package-only');
  assert.ok(x.applications[0].operations.includes('android.screen'));
});
test('Android MCP discovery, no-NAS routing, confirm and dry run without a phone',async t=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--domains','android','--allow-write','--config','/nonexistent/zspace-no-config.json'],stderr:'pipe'});
  let stderr='';transport.stderr.on('data',chunk=>stderr+=chunk);
  const client=new Client({name:'android-offline-test',version:'1'});
  t.after(async()=>{await client.close();assert.equal(stderr,'');});await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['zspace_android','zspace_android_write','zspace_capabilities','zspace_catalog']);
  const apps=await client.callTool({name:'zspace_android',arguments:{request:{action:'apps'}}});assert.deepEqual(apps.structuredContent.result,ANDROID_APPS);
  const request={action:'open',params:{app:'bookLib'}};
  assert.equal((await client.callTool({name:'zspace_android_write',arguments:{request}})).isError,true);
  assert.equal((await client.callTool({name:'zspace_android_write',arguments:{request,dry_run:true}})).structuredContent.result.dryRun,true);
  assert.equal((await client.callTool({name:'zspace_android',arguments:{request}})).isError,true);
});
test('Python bridge viewport, protected inputs, stale targets, locks and foreground guards',()=>{
  execFileSync(process.env.ZSPACE_ANDROID_PYTHON||'python3',[fileURLToPath(new URL('./android_bridge_test.py',import.meta.url))],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'});
});
