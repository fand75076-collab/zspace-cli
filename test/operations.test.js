import test from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, operation, operationInfo, parameters, runOperation } from '../src/operations.js';
import { inventory, appAction, appInstall, appUninstall } from '../src/applications.js';
import { execute } from '../src/cli.js';

test('all operation schemas are serializable and reject extra routing/auth fields', () => {
  for(const op of OPERATIONS.values()) {
    assert.doesNotThrow(()=>JSON.stringify(operationInfo(op)));
    assert.throws(()=>parameters(op,{host:'https://other.invalid',cookie:'secret'}),{code:'USAGE'});
  }
  assert.throws(()=>operation('https://other.invalid'),{code:'USAGE'});
});
test('write gate and dry-run cannot contact NAS',async()=>{
  const c={request:()=>assert.fail('unexpected network')};
  await assert.rejects(runOperation(c,'notes.create',{title:'fixture'}),{code:'WRITE_DISABLED'});
  await assert.rejects(runOperation(c,'files.download',{remote:'/1/my/data/x',local:'/tmp/unused-zspace'}),{code:'WRITE_DISABLED'});
  const downloadPlan=await runOperation(c,'files.download',{remote:'/1/my/data/x',local:'/tmp/unused-zspace'},{dryRun:true});
  assert.equal(downloadPlan.localWrite,true);assert.equal(downloadPlan.requiresConfirmation,true);
  const p=await runOperation(c,'notes.create',{title:'fixture'},{dryRun:true});
  assert.equal(p.parameters.location,2);assert.equal(p.dryRun,true);
  await assert.rejects(runOperation(c,'notes.create',{title:'',token:'override'},{dryRun:true}),{code:'USAGE'});
});
test('application-specific encoding and parameter contracts',async()=>{
  const calls=[];const c={request:async(...args)=>{calls.push(args);return {ok:true};}};
  await runOperation(c,'music.songs',{page:2,page_size:3});
  assert.equal(calls.at(-1)[1].method,'POST');assert.equal(calls.at(-1)[1].data.page,2);
  await runOperation(c,'compose.list');assert.equal(calls.at(-1)[1].body,'{}');
  await runOperation(c,'camera.list');assert.equal(calls.at(-1)[1].data.data,'{"cam_uuid":"all"}');
  await runOperation(c,'notes.pin',{id:42,cancel:1},{allowWrite:true});assert.equal(calls.at(-1)[1].data.cancel,1);
  await runOperation(c,'backup.info',{task_id:3});assert.equal(calls.at(-1)[1].data.task_id,3);
  await runOperation(c,'cloud.status',{provider:'aliyun'});assert.equal(calls.at(-1)[0],'/zdrive/adrive/auth/check');assert.deepEqual(calls.at(-1)[1],{data:{}});
  const before=calls.length;
  await assert.rejects(runOperation(c,'cloud.tasks',{provider:'dropbox'}),{code:'UNSUPPORTED'});assert.equal(calls.length,before);
});
test('inventory whitelists metadata and app mutations enforce vendor capabilities',async()=>{
  const calls=[];const app={app_name:'fixture',installed:1,toggleable:1,removable:1,is_docker:0,status:'running',pwd:'never-output',latest_version:{version:{version:'1.1',version_int:11},pwd:'never-output'}};
  const c={request:async(ep,opts)=>{calls.push([ep,opts]);return ep.endsWith('/list')?{list:ep.startsWith('/zdocker')?[]:[app]}:{queued:true};}};
  const list=await inventory(c);assert.equal(list[0].latest,'1.1');assert.equal(JSON.stringify(list).includes('never-output'),false);
  await appInstall(c,{app:'fixture',mp:'/sata1'});assert.equal(calls.at(-1)[1].data.version_int,11);
  await appUninstall(c,{app:'fixture'});assert.equal(calls.at(-1)[1].data.with_data,0);
  app.toggleable=0;await assert.rejects(appAction(c,{app:'fixture',action:'stop'}),{code:'APP_NOT_TOGGLEABLE'});
  app.removable=0;await assert.rejects(appUninstall(c,{app:'fixture'}),{code:'APP_NOT_REMOVABLE'});
});
test('CLI new commands validate typed params before config and retain boolean flags',async()=>{
  const r=await execute(['notes','create','--title','你好','--dry-run','--config','/nonexistent']);
  assert.equal(JSON.parse(r.output).parameters.title,'你好');
  await assert.rejects(execute(['notes','create','--title','x','--params','{"url":"https://x"}','--dry-run']),{code:'USAGE'});
  await assert.rejects(execute(['api','call','notes.delete','--params','{"ids":[1]}']),{code:'USAGE'});
  await assert.rejects(execute(['api','call','music.songs','--param','page=-1']),{code:'USAGE'});
  const d=JSON.parse((await execute(['api','describe','docker.create','--json'])).output);
  assert.equal(d.write,true);assert.ok(d.inputSchema.properties.config);
  const docker=JSON.parse((await execute(['docker','create','--name','fixture','--spec','{"Image":"alpine"}','--config','/nonexistent/credentials.json','--dry-run'])).output);
  assert.equal(docker.parameters.config.Image,'alpine');
});
