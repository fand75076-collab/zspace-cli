// Opt-in live acceptance. Only synthetic notes, categories and empty media lists are mutated.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { OPERATIONS } from '../src/operations.js';
import { VERSION } from '../src/version.js';

const {values:o}=parseArgs({options:{yes:{type:'boolean'},profile:{type:'string'},config:{type:'string'},report:{type:'string'}}});
if(!o.yes)throw new Error('Live synthetic CRUD needs --yes. Existing NAS services will not be changed.');
const args=[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--allow-write','--max-bytes','2097152'];
for(const key of ['profile','config'])if(o[key])args.push('--'+key,o[key]);
const transport=new StdioClientTransport({command:process.execPath,args,stderr:'pipe'});
const client=new Client({name:'zspace-live-acceptance',version:VERSION});
let stderr='';transport.stderr.on('data',b=>stderr+=b);
const report={version:VERSION,date:new Date().toISOString(),transport:'MCP stdio',checks:[],cleanup:[],limitations:[]};
const tag='zspace-cli-mcp-test-'+randomUUID();const owned=[];
const list=x=>Array.isArray(x)?x:x?.list||[];
async function call(name,params={},extra={}) {
  const op=OPERATIONS.get(name);const [domain,...action]=name.split('.');
  const r=await client.callTool({name:`zspace_${domain.replaceAll('-','_')}${op.write?'_write':''}`,arguments:{request:{action:action.join('.'),params},...(op.write?{confirm:true}:{}),...extra}});
  if(r.isError){let code='MCP_ERROR';try{code=JSON.parse(r.content[0].text)?.error?.code||code;}catch{}throw Object.assign(new Error(code),{code});}
  return r.structuredContent.result;
}
async function check(name,fn){try{await fn();report.checks.push({name,ok:true});process.stdout.write('PASS '+name+'\n');}catch(e){report.checks.push({name,ok:false,code:e.code||e.name});process.stdout.write('FAIL '+name+' '+(e.code||e.name)+'\n');}}
async function remove(x){await call(x.remove,x.params);x.removed=true;}
try {
  await client.connect(transport);
  const tools=(await client.listTools()).tools;report.tools=tools.length;
  const cache=new Map();
  for(const op of OPERATIONS.values()) {
    if(op.requiresNas===false||op.write||op.experimental||!op.schema.safeParse({}).success)continue;
    if(op.domain==='hdmi'){try{await call(op.name);}catch(e){report.limitations.push({name:op.name,code:e.code});}continue;}
    await check(op.name,async()=>{cache.set(op.name,await call(op.name));});
  }
  const add=async(name,params)=>check(name,()=>call(name,params));
  const d=list(cache.get('docker.containers')).find(x=>x.State==='running');
  if(d)for(const a of ['inspect','logs','top'])await add('docker.'+a,{container_id:d.Id,...(a==='logs'?{tail:1}:{})});
  const image=list(cache.get('docker.images'))[0];if(image)await add('docker.image',{image_id:image.Id});
  const network=list(cache.get('docker.networks'))[0];if(network)await add('docker.network',{network_id:network.Id});
  const project=list(cache.get('compose.list'))[0];if(project)for(const a of ['containers','file','logs'])await add('compose.'+a,{project_id:project.id,...(a==='logs'?{tail:1}:{})});
  const vm=list(cache.get('vm.list'))[0];if(vm)for(const a of ['inspect','disks','snapshots','network','schedules'])await add('vm.'+a,{name:vm.name});
  const album=list(cache.get('music.albums'))[0];if(album)await add('music.album',{id:album.album_id});
  for(const a of ['files','documents'])await add('search.'+a,{keyword:tag,num:1});
  await check('notes CRUD + pin + cleanup',async()=>{
    const n=await call('notes.create',{title:tag,body:'MCP synthetic body'});assert.ok(n.id);
    const x={remove:'notes.delete',params:{ids:[n.id]}};owned.push(x);
    assert.equal((await call('notes.info',{id:n.id})).body,'MCP synthetic body');
    await call('notes.update',{id:n.id,title:tag+'-edited',body:'MCP edited body'});
    assert.equal((await call('notes.info',{id:n.id})).body,'MCP edited body');
    await call('notes.pin',{id:n.id});assert.equal(Number((await call('notes.info',{id:n.id})).pin_flag),1);
    await call('notes.pin',{id:n.id,cancel:1});assert.equal(Number((await call('notes.info',{id:n.id})).pin_flag),0);
    await remove(x);assert.ok(!list(await call('notes.list',{num:1000})).some(i=>i.id===n.id));
  });
  await check('notes category CRUD + cleanup',async()=>{
    const id=await call('notes.category-create',{name:tag});assert.ok(Number.isInteger(id));
    const x={remove:'notes.category-delete',params:{id}};owned.push(x);
    await call('notes.category-rename',{id,name:tag+'-edited'});
    assert.ok(JSON.stringify(await call('notes.categories')).includes(tag+'-edited'));
    await remove(x);assert.ok(!JSON.stringify(await call('notes.categories')).includes(tag));
  });
  for(const spec of [
    {domain:'music',create:'playlist-create',info:'playlist',update:'playlist-update',remove:'playlist-delete',id:'playlist_id',name:'playlist_name',list:'playlists',array:true},
    {domain:'photos',create:'album-create',info:'album',update:'album-rename',remove:'album-delete',id:'album_id',returnedId:'id',name:'name',list:'albums'},
    {domain:'audiobooks',create:'library-create',info:'library',update:'library-rename',remove:'library-delete',id:'playlist_id',name:'playlist_name',list:'libraries'},
  ])await check(spec.domain+' empty list CRUD + cleanup',async()=>{
    const created=await call(spec.domain+'.'+spec.create,{[spec.name]:tag});const id=created[spec.returnedId||spec.id];assert.ok(id);
    const p={[spec.id]:id};const x={remove:spec.domain+'.'+spec.remove,params:{[spec.id]:spec.array?[id]:id}};owned.push(x);
    assert.equal((await call(spec.domain+'.'+spec.info,p))[spec.name],tag);
    await call(spec.domain+'.'+spec.update,{...p,[spec.name]:tag+'-edited'});
    assert.equal((await call(spec.domain+'.'+spec.info,p))[spec.name],tag+'-edited');
    await remove(x);assert.ok(!JSON.stringify(await call(spec.domain+'.'+spec.list)).includes(tag));
  });
}finally{
  for(const x of owned){try{if(!x.removed)await remove(x);report.cleanup.push({operation:x.remove,ok:true});}catch(e){report.cleanup.push({operation:x.remove,ok:false,code:e.code});}}
  await client.close();
  report.stderrEmpty=stderr==='';report.passed=report.checks.filter(x=>x.ok).length;report.failed=report.checks.length-report.passed;
  if(o.report)await writeFile(o.report,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,tools:report.tools,cleanup:report.cleanup,limitations:report.limitations}));
  if(report.failed||report.cleanup.some(x=>!x.ok)||stderr)process.exitCode=1;
}
