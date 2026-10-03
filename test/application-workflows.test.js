import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as McpClient } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client } from '../src/client.js';
import { ConfigStore } from '../src/config.js';
import { AgentStore } from '../src/agents.js';
import { OPERATIONS, operationInfo, runOperation } from '../src/operations.js';

// Independent wire expectations from the vendor call sites documented in
// docs/application-contracts-v0.5.md. Fixtures contain synthetic content only.
const cases = [
  ['notes.category-list', {}, 'POST', '/v2/file/notepad/classifylist', {location:'2',start:'0',num:'100'}],
  ['notes.move', {ids:[11,12],classify_id:0}, 'POST', '/v2/file/notepad/movenotepad', {location:'2','ids[]':['11','12'],classify_id:'0'}],
  ['notes.label', {id:11,label_id:0,action:2}, 'POST', '/v2/file/notepad/updatelabel', {location:'2',id:'11',label_id:'0',action:'2'}],
  ['photos.by-path', {paths:['/sata1/my/data/照片 + &.jpg']}, 'POST', '/v2/album/feed/bypath', {'paths[]':['/sata1/my/data/照片 + &.jpg']}],
  ['photos.photo-albums', {feed_id:21}, 'POST', '/v2/album/album/albums/by_feed_id', {feed_id:'21'}],
  ['photos.favorites', {start:4,num:2}, 'POST', '/v2/album/ilike/list', {start:'4',num:'2',liked:'1'}],
  ['photos.favorite', {feed_id:21,liked:0}, 'POST', '/v2/album/feed/like', {feed_id:'21',liked:'0'}],
  ['photos.album-remove', {album_id:31,feed_ids:[21,'22']}, 'POST', '/v2/album/album/feed/delete', {album_id:'31',feed_ids:'21,22',confirm:'1'}],
  ['photos.directory-add', {paths:['/sata1/my/data/合成照片']}, 'POST', '/v2/album/dirs/add/no_flush', {'paths[]':['/sata1/my/data/合成照片']}],
  ['photos.directory-remove', {dir_ids:[31,32]}, 'POST', '/v2/album/dirs/delete', {dir_ids:'31,32'}],
  ['photos.directory-scan', {dir_ids:[31]}, 'POST', '/v2/album/dirs/flush', {dir_ids:'31'}],
  ['video.favorite-add', {collection_id:41,classification_id:42}, 'POST', '/zvideo/favorite/add', {collection_id:'41',classification_id:'42'}],
  ['video.favorite-remove', {collection_id:41,classification_id:42}, 'POST', '/zvideo/favorite/delete', {collection_id:'41',classification_id:'42'}],
  ['video.collections', {classification_id:42,start:2,limit:5}, 'POST', '/zvideo/video/v2/list', {classification_id:'42',start:'2',limit:'5',system:'0',field:'release_year',sort:'desc',seen:'0',collection_type:'0'}],
  ['video.collection-create', {classification_id:42,title:'合成合集 + &'}, 'POST', '/zvideo/collection/add', {classification_id:'42',title:'合成合集 + &',storyline:'',cover:''}],
  ['video.collection-dismiss', {classification_id:42,collection_id:41}, 'POST', '/zvideo/collection/dismiss', {classification_id:'42',collection_id:'41'}],
  ['music.song', {song_id:51}, 'GET', '/zmusic/api/v2/song/info', {song_id:'51'}],
  ['music.lyrics', {song_id:51}, 'GET', '/zmusic/api/v2/song/info/lyrics', {song_id:'51'}],
  ['music.cue', {song_id:51}, 'GET', '/zmusic/api/v2/song/info/cue', {song_id:'51'}],
  ['music.lyrics-update', {song_id:51,song_lyrics:'[00:01.00]合成测试 + &\n[00:02.00]第二行'}, 'POST', '/zmusic/api/v2/song/info/lyrics', {song_id:'51',song_lyrics:'[00:01.00]合成测试 + &\n[00:02.00]第二行'}],
  ['music.favorite-add', {favorite_type:'artist',favorite_content:['合成歌手 + &']}, 'POST', '/zmusic/api/v2/favorite/add', {favorite_type:'artist','favorite_content[]':['合成歌手 + &']}],
  ['music.favorite-remove', {favorite_type:'song',favorite_content:[51,52]}, 'POST', '/zmusic/api/v2/favorite/delete', {favorite_type:'song','favorite_content[]':['51','52']}],
  ['music.favorite-songs', {page:2,page_size:3}, 'GET', '/zmusic/api/v2/favorite/song/list', {page:'2',page_size:'3',source:'2'}],
  ['music.favorite-albums', {}, 'GET', '/zmusic/api/v2/favorite/album/list', {page:'1',page_size:'50'}],
  ['music.favorite-artists', {}, 'GET', '/zmusic/api/v2/favorite/artist/list', {page:'1',page_size:'50'}],
  ['music.favorite-playlists', {}, 'GET', '/zmusic/api/v2/favorite/playlist/list', {page:'1',page_size:'50',source:'2'}],
  ['music.tasks', {}, 'GET', '/zmusic/api/v2/task/status', {}],
  ['music.directories', {}, 'GET', '/zmusic/api/v2/song/file', {}],
  ['music.library-add', {file_path:['/sata1/my/data/synthetic.wav']}, 'POST', '/zmusic/api/v2/song/file/add', {'file_path[]':['/sata1/my/data/synthetic.wav']}],
  ['music.library-remove', {file_path:['/sata1/my/data/synthetic.wav']}, 'POST', '/zmusic/api/v2/song/remove', {remove_type:'file','remove_value[]':['/sata1/my/data/synthetic.wav']}],
  ['music.library-rescan', {file_path:['/sata1/my/data/synthetic.wav']}, 'POST', '/zmusic/api/v2/song/file/refresh', {'file_path[]':['/sata1/my/data/synthetic.wav']}],
  ['audiobooks.directory-add', {playlist_id:61,dirs:['/sata1/my/data/书 & 甲','/sata1/my/data/乙']}, 'POST', '/zaudio/api/v1/playlist/dir/add', {playlist_id:'61','dirs[]':['/sata1/my/data/书 & 甲','/sata1/my/data/乙']}],
  ['audiobooks.directory-remove', {playlist_id:61,dirs:['/sata1/my/data/书']}, 'POST', '/zaudio/api/v1/playlist/dir/delete', {playlist_id:'61','dirs[]':['/sata1/my/data/书']}],
  ['audiobooks.chapter-remove', {playlist_id:61,track_id:[71,72]}, 'POST', '/zaudio/api/v1/playlist/record/delete', {playlist_id:'61','track_id[]':['71','72']}],
  ['audiobooks.rescan', {playlist_id:61}, 'POST', '/zaudio/api/v1/task/refresh', {playlist_id:'61'}],
  ['audiobooks.import-status', {playlist_id:61}, 'GET', '/zaudio/api/v1/task/status/add', {playlist_id:'61'}],
  ['audiobooks.external-status', {playlist_id:61}, 'GET', '/zaudio/api/v1/playlist/extdev/status', {playlist_id:'61'}],
  ['audiobooks.chapter-position', {playlist_id:61,track_id:71,order:'desc'}, 'GET', '/zaudio/api/v1/playlist/record/position', {playlist_id:'61',track_id:'71',order:'desc',sort_filed:'title'}],
];

async function fixture(t) {
  const requests=[];
  let respond=()=>({code:200,data:{accepted:true}});
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const record={method:req.method,url:new URL(req.url,'http://localhost'),headers:req.headers,body};
    requests.push(record);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(respond(record)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const profile={baseUrl:`http://127.0.0.1:${server.address().port}`,allowHttp:true,cookies:{zenithtoken:'synthetic-app-session'}};
  return {requests,profile,client:new Client(profile),setResponse:fn=>{respond=fn;}};
}
function assertWire(record,method,endpoint,expected) {
  assert.equal(record.method,method);assert.equal(record.url.pathname,endpoint);
  const params=method==='GET'?new URLSearchParams(record.url.search):new URLSearchParams(record.body);
  for(const key of ['plat','version','device','device_id','_l','webagent'])params.delete(key);
  const actual={};for(const key of new Set(params.keys()))actual[key]=key.endsWith('[]')?params.getAll(key):params.get(key);
  assert.deepEqual(actual,expected);
  if(method==='GET')assert.equal(record.body,'');else assert.match(record.headers['content-type'],/^application\/x-www-form-urlencoded/);
}

test('application additions send the vendor methods, parameters and array encodings over HTTP',async t=>{
  const f=await fixture(t);
  assert.deepEqual([...OPERATIONS.values()].filter(o=>o.validation).map(o=>o.name).sort(),cases.map(c=>c[0]).sort());
  for(const [name,input,method,endpoint,expected] of cases)await t.test(name,async()=>{
    const before=f.requests.length;
    assert.deepEqual(await runOperation(f.client,name,input,{allowWrite:true}),{accepted:true});
    assert.equal(f.requests.length,before+1);assertWire(f.requests.at(-1),method,endpoint,expected);
  });
});

test('every new write refuses an unconfirmed call, and dry-run performs no request',async()=>{
  const client={request:()=>assert.fail('unexpected NAS request')};
  for(const [name,input] of cases){
    const op=OPERATIONS.get(name);
    if(op.write)await assert.rejects(runOperation(client,name,input),{code:'WRITE_DISABLED'});
    const plan=await runOperation(client,name,input,{dryRun:true});
    assert.equal(plan.requiresConfirmation,op.write);
    assert.equal(plan.validation.liveVerified,true);
    assert.equal(Object.hasOwn(plan.validation,'model'),false);
    assert.equal(Object.hasOwn(plan.validation,'verifiedAt'),false);
    assert.equal(operationInfo(op).validation.basis,'web-client-contract');
  }
});

test('new app schemas reject empty targets, malformed enums, routes and ambiguous CSV identifiers',async()=>{
  const invalid=[
    ['notes.move',{ids:[],classify_id:0}],['notes.move',{ids:[1],classify_id:-1}],
    ['notes.label',{id:1,label_id:6}],['notes.label',{id:1,label_id:0,action:0}],
    ['photos.favorite',{feed_id:1,liked:2}],['photos.album-remove',{album_id:1,feed_ids:['2,3']}],
    ['photos.album-remove',{album_id:1,feed_ids:[]}],['photos.album-remove',{album_id:1,feed_ids:[2],confirm:0}],
    ['video.favorite-add',{collection_id:1}],['music.favorite-add',{favorite_type:'unknown',favorite_content:[1]}],
    ['video.collections',{classification_id:1,start:0}],['video.collection-create',{classification_id:1,title:''}],
    ['music.favorite-remove',{favorite_type:'song',favorite_content:[]}],['music.lyrics-update',{song_id:1}],
    ['music.favorite-songs',{page:0}],['music.favorite-songs',{source:1}],['music.favorite-songs',{page_size:501}],
    ['audiobooks.directory-add',{playlist_id:1,dirs:['relative']}],['audiobooks.directory-remove',{playlist_id:1,dirs:[]}],
    ['audiobooks.chapter-remove',{playlist_id:1,track_id:1}],['audiobooks.chapter-position',{playlist_id:1,track_id:1,sort_filed:'other'}],
    ['photos.directory-scan',{dir_ids:['1,2']}],['photos.directory-add',{paths:['relative']}],
    ['music.library-add',{file_path:[]}],['music.library-remove',{file_path:['relative']}],['music.library-rescan',{}],
  ];
  for(const [name,input] of invalid)await assert.rejects(runOperation(null,name,input,{dryRun:true}),{code:'USAGE'},name);
  for(const [name,input] of cases)await assert.rejects(runOperation(null,name,{...input,endpoint:'/auth/token'},{dryRun:true}),{code:'USAGE'});
});

test('notes list filters preserve color zero and use the documented sorting field',async t=>{
  const f=await fixture(t);
  await runOperation(f.client,'notes.list',{label_id:0,sortby:6});
  assertWire(f.requests.at(-1),'POST','/v2/file/notepad/list',{location:'2',start:'0',num:'100',classify_id:'0',label_id:'0',sortby:'6'});
});

test('async application replies remain pending and business errors are not retried',async t=>{
  const f=await fixture(t);
  f.setResponse(()=>({code:200,data:{add_status:1,task_id:9}}));
  assert.deepEqual(await runOperation(f.client,'audiobooks.directory-add',{playlist_id:1,dirs:['/sata1/my/data/book']},{allowWrite:true}),{add_status:1,task_id:9});
  f.setResponse(()=>({code:'N001411',msg:'denied'}));
  const before=f.requests.length;
  await assert.rejects(runOperation(f.client,'photos.album-remove',{album_id:1,feed_ids:[2]},{allowWrite:true}),{code:'N001411'});
  assert.equal(f.requests.length,before+1);
});

test('real CLI converts named options, repeated IDs, Unicode and zero-valued flags',async t=>{
  const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'zspace-app-cli-')),config=join(dir,'config.json');
  t.after(()=>rm(dir,{recursive:true,force:true}));await new ConfigStore(config).save('fixture',f.profile);
  const bin=fileURLToPath(new URL('../bin/zspace.js',import.meta.url));
  const invoke=args=>promisify(execFile)(process.execPath,[bin,...args,'--config',config,'--json']);
  for(const args of [
    ['notes','move','--ids','[11,12]','--classify-id','0','--yes'],
    ['photos','album-remove','--album-id','31','--feed-ids','[21,22]','--yes'],
    ['music','favorite-add','--favorite-type','artist','--favorite-content','["合成歌手 + &"]','--yes'],
    ['audiobooks','chapter-position','--playlist-id','61','--track-id','71','--order','desc'],
    ['video','favorite-add','--collection-id','41','--classification-id','42','--yes'],
  ]) {
    const {stdout,stderr}=await invoke(args);assert.equal(stderr,'');assert.equal(JSON.parse(stdout).accepted,true);
    const row=cases.find(c=>c[0]===`${args[0]}.${args[1]}`);assertWire(f.requests.at(-1),row[2],row[3],row[4]);
  }
  const before=f.requests.length;
  const plan=JSON.parse((await invoke(['notes','label','--id','11','--label-id','0','--dry-run'])).stdout);
  assert.equal(plan.parameters.label_id,0);assert.equal(plan.validation.liveVerified,true);assert.equal(f.requests.length,before);
  await assert.rejects(invoke(['notes','move','--ids','[11]','--classify-id','0']),e=>e.code===2);
  assert.equal(f.requests.length,before);
});

test('real MCP exposes all additions, applies confirmation and respects persisted Agent grants',async t=>{
  const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'zspace-app-mcp-')),config=join(dir,'config.json');
  t.after(()=>rm(dir,{recursive:true,force:true}));await new ConfigStore(config).save('fixture',f.profile);
  const agents=new AgentStore(config);
  await agents.create('synthetic-app-agent',{profile:'fixture',read:'music.favorite-songs',write:'notes.move'});
  const connect=async extra=>{
    const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--config',config,'--allow-write',...extra],stderr:'pipe'});
    let stderr='';transport.stderr.on('data',chunk=>stderr+=chunk);
    const client=new McpClient({name:'application-workflow-test',version:'1.0.0'});
    t.after(async()=>{await client.close();assert.equal(stderr,'');});await client.connect(transport);return client;
  };
  const mcp=await connect([]);
  const catalog=(await mcp.callTool({name:'zspace_catalog',arguments:{}})).structuredContent.result;
  for(const [name,input,method,endpoint,expected] of cases){
    assert.equal(catalog.find(o=>o.name===name).validation.liveVerified,true);
    const [domain,action]=name.split('.'),write=OPERATIONS.get(name).write;
    const r=await mcp.callTool({name:`zspace_${domain}${write?'_write':''}`,arguments:{request:{action,params:input},...(write?{confirm:true}:{})}});
    assert.equal(r.isError,undefined,name);assertWire(f.requests.at(-1),method,endpoint,expected);
  }
  const before=f.requests.length,request={action:'move',params:{ids:[11],classify_id:0}};
  assert.equal((await mcp.callTool({name:'zspace_notes_write',arguments:{request}})).isError,true);
  assert.equal((await mcp.callTool({name:'zspace_notes_write',arguments:{request,dry_run:true}})).structuredContent.result.dryRun,true);
  assert.equal(f.requests.length,before);
  const restricted=await connect(['--agent','synthetic-app-agent']);
  const names=(await restricted.callTool({name:'zspace_catalog',arguments:{}})).structuredContent.result.map(o=>o.name).sort();
  assert.deepEqual(names,['music.favorite-songs','notes.move']);
  assert.equal((await restricted.callTool({name:'zspace_notes_write',arguments:{request:{action:'label',params:{id:11,label_id:0}},confirm:true}})).isError,true);
  assert.equal(f.requests.length,before);
  await restricted.callTool({name:'zspace_notes_write',arguments:{request,confirm:true}});
  assert.equal(f.requests.length,before+1);
  await agents.revoke('synthetic-app-agent');
  assert.equal((await restricted.callTool({name:'zspace_notes_write',arguments:{request,confirm:true}})).isError,true);
  assert.equal(f.requests.length,before+1);
});
