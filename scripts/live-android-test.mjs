// Opt-in UI acceptance. Navigates the app and cancels an unsaved synthetic category.
// Never submit the dialog or change accounts, permissions, backup jobs, or NAS services.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { VERSION } from '../src/version.js';

const {values:o}=parseArgs({options:{yes:{type:'boolean'},serial:{type:'string'},report:{type:'string'},'text-input':{type:'boolean'}}});
if(!o.yes)throw new Error('Phone UI navigation needs --yes. Use --text-input to test a synthetic unsaved dialog on app 2.5.632.');
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--allow-write','--domains','android','--config','/nonexistent/zspace-android-no-nas.json'],stderr:'pipe'});
const client=new Client({name:'zspace-android-acceptance',version:VERSION});
let stderr='',ownsDialog=false;transport.stderr.on('data',b=>stderr+=b);
const report={version:VERSION,date:new Date().toISOString(),transport:'MCP stdio / Android UI',checks:[],limitations:['Visible UI bridge, not direct NAS business APIs','Input test never submits; no library item or backup job is created']};
const serial=o.serial?{serial:o.serial}:{};
const readActions=new Set(['apps','status','screen']);
const raw=(action,params={},extra={})=>client.callTool({name:`zspace_android${readActions.has(action)?'':'_write'}`,arguments:{request:{action,params:{...(action==='apps'?{}:serial),...params}},...(readActions.has(action)?{}:{confirm:true}),...extra}});
async function call(action,params={},extra={}) {
  const r=await raw(action,params,extra);
  if(r.isError){let code='MCP_ERROR';try{code=JSON.parse(r.content[0].text)?.error?.code||code;}catch{}throw Object.assign(new Error(code),{code});}
  return r.structuredContent.result;
}
async function check(name,fn){try{const r=await fn();report.checks.push({name,ok:true});console.log('PASS '+name);return r;}catch(e){report.checks.push({name,ok:false,code:e.code||e.name});console.log('FAIL '+name+' '+(e.code||e.name));throw e;}}
async function screenUntil(predicate){
  for(let i=0;i<5;i++){const s=await call('screen');if(predicate(s))return s;await new Promise(r=>setTimeout(r,200));}
  throw new Error('Expected UI was not observed');
}
function viewport(s){assert.equal(s.visibleOnly,true);assert.ok(s.elements.length);for(const e of s.elements){assert.match(e.target,/^[a-f0-9]{24}$/);const [l,t,r,b]=e.bounds;assert.ok(l>=0&&t>=0&&r<=s.viewport.width&&b<=s.viewport.height&&r>l&&b>t);}}
async function tap(predicate){const s=await call('screen');const matches=s.elements.filter(predicate);assert.equal(matches.length,1,'UI control must be unique');return call('tap',{target:matches[0].target});}
const suffix=id=>e=>e.resourceId.endsWith(':id/'+id);
const home='com.zentraedi.home.activity.NasHomeActivity';
try {
  await client.connect(transport);
  await check('MCP tools/list',async()=>assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['zspace_android','zspace_android_write','zspace_catalog']));
  await check('MCP resources/read',async()=>assert.ok((await client.readResource({uri:'zspace://coverage-notes'})).contents[0].text.includes('android-ui')));
  await check('Android apps without NAS credentials',async()=>assert.equal(Object.keys(await call('apps')).length,5));
  const status=await check('Android device and logged app foreground',async()=>{const x=await call('status');assert.equal(x.connected,true);assert.equal(x.foreground,true);return x;});report.androidAppVersion=status.version;
  await check('Visible screen bounds',async()=>viewport(await call('screen')));
  await check('MCP confirm gate',async()=>assert.equal((await raw('open',{app:'home'},{confirm:false})).isError,true));
  await check('Dry run leaves activity unchanged',async()=>{const before=await call('status');assert.equal((await call('open',{app:'bookLib'},{confirm:false,dry_run:true})).dryRun,true);assert.equal((await call('status')).activity,before.activity);});
  await check('Stale target is rejected',async()=>{const r=await raw('tap',{target:'0'.repeat(24)});assert.equal(r.isError,true);assert.equal(JSON.parse(r.content[0].text).error.code,'ANDROID_STALE_TARGET');});
  for(const [app,activity] of [['bookLib','BookMainActivity'],['family','FamilyServiceActivity'],['mobileBackup','BackupMainActivity'],['comics','ComicMainActivity']]){
    await check('Open '+app,async()=>{const s=await call('open',{app});assert.ok(s.activity.endsWith(activity));viewport(s);});
    if(app==='bookLib')await check('Book library and home tabs',async()=>{await tap(suffix('rb_my_tab'));await screenUntil(s=>s.elements.some(e=>suffix('rb_my_tab')(e)&&(e.checked||e.selected)));await tap(suffix('rb_home_tab'));});
  }
  await check('Comics settings tab',async()=>{await tap(suffix('settingRB'));await screenUntil(s=>s.elements.some(e=>e.text==='分类管理'));});
  if(o['text-input']){
    assert.equal(status.version,'2.5.632','Text-input navigation is verified only for app 2.5.632');
    await check('Comics category navigation',async()=>{await tap(e=>e.text==='分类管理');await screenUntil(s=>s.activity.endsWith('ComicCategoryManagementActivity'));});
    await check('Open unsaved category dialog',async()=>{
      const s=await call('screen');const back=s.elements.find(suffix('tv_nav_left'));assert.ok(back);
      // This unlabeled plus icon was visually verified on 2.5.632; require its matching toolbar geometry.
      const buttons=s.elements.filter(e=>e.clickable&&e.class==='android.widget.ImageView'&&!e.resourceId&&e.bounds[0]>s.viewport.width*.75&&e.bounds[1]===back.bounds[1]&&e.bounds[3]===back.bounds[3]);
      assert.equal(buttons.length,1);await call('tap',{target:buttons[0].target});ownsDialog=true;
      await screenUntil(s=>s.elements.some(e=>e.text==='新建分类')&&s.elements.some(e=>e.editable));
    });
    await check('Open refuses to discard an edit',async()=>{const r=await raw('open',{app:'home'});assert.equal(r.isError,true);assert.equal(JSON.parse(r.content[0].text).error.code,'ANDROID_EDIT_IN_PROGRESS');});
    const text='安卓桥接测试-'+randomUUID().slice(0,8);
    await check('Chinese set-text and fresh target',async()=>{
      const s=await call('screen');const field=s.elements.find(e=>e.editable&&suffix('edit_text')(e));assert.ok(field);
      const after=await call('set-text',{target:field.target,text});assert.ok(after.elements.some(e=>e.editable&&e.text===text));
      const old=await raw('set-text',{target:field.target,text:'must-not-appear'});assert.equal(old.isError,true);assert.equal(JSON.parse(old.content[0].text).error.code,'ANDROID_STALE_TARGET');
    });
    await check('Cancel unsaved input',async()=>{await tap(e=>e.text==='取消'&&suffix('cancel')(e));const s=await screenUntil(s=>!s.elements.some(e=>e.editable));assert.ok(!s.elements.some(e=>e.text.includes(text)));ownsDialog=false;});
    await check('Back from category',async()=>{await call('back');await screenUntil(s=>s.activity.endsWith('ComicMainActivity'));});
  }
  await check('Return NAS home',async()=>assert.equal((await call('open',{app:'home'})).activity,home));
  await check('Scroll home up and down',async()=>{await call('scroll',{direction:'up'});viewport(await call('screen'));await call('scroll',{direction:'down'});viewport(await call('screen'));});
  await check('Back at home is refused',async()=>{const r=await raw('back');assert.equal(r.isError,true);assert.equal(JSON.parse(r.content[0].text).error.code,'ANDROID_AT_HOME');});
}catch(e){report.error=e.code||e.name;process.exitCode=1;}
finally{
  if(ownsDialog){try{const s=await call('screen');if(s.elements.some(e=>e.text==='新建分类')){await tap(e=>e.text==='取消'&&suffix('cancel')(e));report.cleanup='unsaved test dialog cancelled';}else report.cleanup='inspect phone; unexpected screen';}catch{report.cleanup='inspect phone; cancellation could not be verified';}}
  await client.close();report.stderrEmpty=stderr==='';report.passed=report.checks.filter(c=>c.ok).length;report.failed=report.checks.filter(c=>!c.ok).length;
  if(o.report)await writeFile(o.report,JSON.stringify(report,null,2)+'\n');
  if(stderr)process.exitCode=1;
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,stderrEmpty:report.stderrEmpty,...(report.error?{error:report.error}:{})}));
}
