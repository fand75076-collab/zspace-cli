// Explicit opt-in acceptance using generated media and UUID-named NAS objects.
// Needs ffmpeg locally. No existing user object is changed or deleted.
import assert from 'node:assert/strict';
import { parseArgs, promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { OPERATIONS } from '../src/operations.js';
import { nasPath } from '../src/files.js';
import { VERSION } from '../src/version.js';

const {values:o}=parseArgs({options:{yes:{type:'boolean'},parent:{type:'string'},profile:{type:'string'},config:{type:'string'},report:{type:'string'},domains:{type:'string'}}});
if(!o.yes||!o.parent||!o.report)throw new Error('Requires --yes --parent <authorized NAS directory> --report <local JSON file>. Creates and cleans up synthetic data.');
const parent=nasPath(o.parent);
if(!/^\/[^/]+\/(my|public)\/data(?:\/|$)/.test(parent))throw new Error('Choose a personal/team data directory.');
const domains=(o.domains||'notes,music,audiobooks,photos,video').split(',');
if(domains.some(d=>!['notes','music','audiobooks','photos','video'].includes(d)))throw new Error('Unknown workflow domain.');
const tag='zspace-cli-v05-'+randomUUID(),root=parent+'/'+tag;
const local=await mkdtemp(join(tmpdir(),'zspace-app-live-'));
const report={version:VERSION,date:new Date().toISOString(),runId:tag,domains,transport:'MCP stdio',checks:[],cleanup:[],limitations:[],successfulOperations:[]};
const owned=[],success=new Set();
const list=v=>Array.isArray(v)?v:v?.list||v?.items||[];
const exec=promisify(execFile);
const args=[fileURLToPath(new URL('../bin/zspace-mcp.js',import.meta.url)),'--allow-write','--max-bytes','2097152'];
for(const k of ['config','profile'])if(o[k])args.push('--'+k,o[k]);
const transport=new StdioClientTransport({command:process.execPath,args,env:{...process.env},stderr:'pipe'});
let stderr='';transport.stderr.on('data',b=>stderr+=b);
const client=new Client({name:'zspace-v05-acceptance',version:VERSION});
async function save(){report.successfulOperations=[...success].sort();await writeFile(o.report,JSON.stringify(report,null,2)+'\n');}
async function call(name,params={}){
  const op=OPERATIONS.get(name),[domain,action]=name.split('.'),mutation=op.write||op.localWrite;
  const r=await client.callTool({name:`zspace_${domain.replaceAll('-','_')}${mutation?'_write':''}`,arguments:{request:{action,params},...(mutation?{confirm:true}:{})}});
  if(r.isError){let code='MCP_ERROR',status;try{const e=JSON.parse(r.content[0].text).error;code=e.code;status=e.status;}catch{}throw Object.assign(new Error(code),{code,operation:name,status});}
  success.add(name);return r.structuredContent.result;
}
async function step(domain,name,fn){
  if(!domains.includes(domain))return;
  try{await fn();report.checks.push({name,ok:true});console.log('PASS '+name);return true;}
  catch(e){report.checks.push({name,ok:false,code:e.code||e.name,...(e.operation?{operation:e.operation,status:e.status}:{})});console.log('FAIL '+name+' '+(e.code||e.name)+(e.operation?' '+e.operation:''));if(e.name==='AssertionError')console.log(e.stack);return false;}
  finally{await save();}
}
async function poll(read,accept,ms=45000){
  const end=Date.now()+ms;
  for(;;){const value=await read();if(accept(value))return value;if(Date.now()>=end)throw Object.assign(new Error('Readback timed out'),{code:'READBACK_TIMEOUT'});await new Promise(r=>setTimeout(r,1000));}
}
function cleanup(name,run){owned.push({name,run});}
async function findMusic(){
  for(let page=1;page<=10;page++){
    const d=await call('music.songs',{page,page_size:100});
    const found=list(d).find(x=>x.song_path?.startsWith(root+'/music/'));
    if(found)return found;if(list(d).length<100)return null;
  }
  return null;
}

try{
  await exec('ffmpeg',['-nostdin','-loglevel','error','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','2','-c:a','flac','-metadata','title='+tag,'-metadata','artist='+tag,'-metadata','album='+tag,join(local,'synthetic.flac')]);
  await exec('ffmpeg',['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64','-frames:v','1','-update','1',join(local,'synthetic.jpg')]);
  await exec('ffmpeg',['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:r=1','-t','2','-c:v','libx264','-pix_fmt','yuv420p',join(local,'synthetic.mp4')]);
  await writeFile(join(local,'synthetic.cue'),'PERFORMER "'+tag+'"\nTITLE "'+tag+'"\nFILE "synthetic.flac" WAVE\n  TRACK 01 AUDIO\n    TITLE "Synthetic one"\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    TITLE "Synthetic two"\n    INDEX 01 00:01:00\n');
  await client.connect(transport);
  const status=await call('system.status');report.model=status.model;report.webVersion=status.firmware;
  await call('files.mkdir',{path:root});
  cleanup('synthetic files moved to recycle bin',async()=>{
    await call('files.trash',{paths:[root]});
    assert.ok(!list(await call('files.list',{path:parent,all:true})).some(x=>x.name===tag));
  });
  for(const dir of ['music','photos','video'])await call('files.mkdir',{path:root+'/'+dir});
  for(const [file,dir] of [['synthetic.flac','music'],['synthetic.cue','music'],['synthetic.jpg','photos'],['synthetic.mp4','video']])await call('files.upload',{local:join(local,file),remote:`${root}/${dir}/${file}`});

  await step('notes','notes classification, color zero, filters and readback',async()=>{
    const category=await call('notes.category-create',{name:tag});assert.ok(Number.isInteger(category));
    cleanup('synthetic note category',async()=>{await call('notes.category-delete',{id:category});assert.ok(!JSON.stringify(await call('notes.categories')).includes(tag));});
    const note=await call('notes.create',{title:tag,body:'Synthetic acceptance note'});assert.ok(note.id);
    cleanup('synthetic note',async()=>{await call('notes.delete',{ids:[note.id]});assert.ok(!list(await call('notes.search',{keyword:tag})).some(x=>String(x.id)===String(note.id)));});
    assert.ok(JSON.stringify(await call('notes.category-list',{num:1000})).includes(tag));
    await call('notes.move',{ids:[note.id],classify_id:category});assert.equal(Number((await call('notes.info',{id:note.id})).classify_id),category);
    await call('notes.label',{id:note.id,label_id:0});assert.equal((await call('notes.info',{id:note.id})).label_id,'0');
    assert.ok(list(await call('notes.list',{classify_id:category,label_id:0,sortby:6})).some(x=>String(x.id)===String(note.id)));
    await call('notes.label',{id:note.id,label_id:0,action:2});assert.equal((await call('notes.info',{id:note.id})).label_id,'');
    await call('notes.move',{ids:[note.id],classify_id:0});assert.equal(Number((await call('notes.info',{id:note.id})).classify_id),0);
  });

  await step('music','music import, metadata, lyrics, CUE, favorites and rescan',async()=>{
    await call('music.library-add',{file_path:[root+'/music']});
    cleanup('synthetic music source',async()=>{await call('music.library-remove',{file_path:[root+'/music']});assert.ok(!JSON.stringify(await call('music.directories')).includes(root+'/music'));await call('files.info',{path:root+'/music/synthetic.flac'});});
    const song=await poll(findMusic,Boolean);assert.ok(song.song_id);
    assert.equal((await call('music.song',{song_id:song.song_id})).song_path,song.song_path);
    await call('music.lyrics',{song_id:song.song_id});
    await call('music.lyrics-update',{song_id:song.song_id,song_lyrics:'[00:00.00]Synthetic acceptance lyrics'});
    assert.match(JSON.stringify(await call('music.lyrics',{song_id:song.song_id})),/Synthetic acceptance lyrics/);
    if(Number(song.cuesheet)===1){const cue=await call('music.cue',{song_id:song.song_id});assert.ok(cue.Tracks?.length);}
    else report.limitations.push({operation:'music.cue',reason:'Synthetic source did not produce a CUE entry; no existing media was modified.'});
    assert.equal(song.artist,tag);assert.equal(song.album,tag);assert.ok(song.album_id);
    const playlist=await call('music.playlist-create',{playlist_name:tag});assert.ok(playlist.playlist_id);
    cleanup('synthetic music playlist',async()=>{await call('music.playlist-delete',{playlist_id:[playlist.playlist_id]});assert.ok(!list(await call('music.playlists',{num:1000})).some(x=>String(x.playlist_id)===String(playlist.playlist_id)));});
    await call('music.playlist-add',{playlist_id:playlist.playlist_id,add_type:'song',add_value:[song.song_id]});
    for(const [kind,value,key,action] of [['song',song.song_id,'song_id','songs'],['album',song.album_id,'album_id','albums'],['artist',tag,'artist','artists'],['playlist',playlist.playlist_id,'playlist_id','playlists']]){
      const params={favorite_type:kind,favorite_content:[value]},read=()=>call('music.favorite-'+action,{page_size:500}),contains=d=>list(d).some(x=>String(x[key])===String(value));
      await call('music.favorite-add',params);
      cleanup('synthetic music '+kind+' favorite',async()=>{await call('music.favorite-remove',params);assert.ok(!contains(await read()));});
      assert.ok(contains(await read()));
    }
    await call('music.library-rescan',{file_path:[root+'/music']});
    await poll(()=>call('music.tasks'),d=>Number(d.file_add_status)===0&&Number(d.file_refresh_status)===0);
  });

  await step('audiobooks','audiobook directory import, chapters, position, rescan and removal',async()=>{
    const book=await call('audiobooks.library-create',{playlist_name:tag});assert.ok(book.playlist_id);
    const p={playlist_id:book.playlist_id};
    cleanup('synthetic audiobook library',async()=>{await call('audiobooks.library-delete',p);assert.ok(!list(await call('audiobooks.libraries')).some(x=>String(x.playlist_id)===String(p.playlist_id)));});
    await call('audiobooks.directory-add',{...p,dirs:[root+'/music']});
    await poll(()=>call('audiobooks.import-status',p),d=>Number(d.add_status)===0);
    const chapters=await poll(()=>call('audiobooks.chapters',p),d=>list(d).length>0),chapter=list(chapters)[0];
    const track=chapter.track_id??chapter.song_id;assert.ok(track);
    assert.ok(Number((await call('audiobooks.chapter-position',{...p,track_id:track})).position)>0);
    await call('audiobooks.external-status',p);
    await call('audiobooks.chapter-remove',{...p,track_id:[track]});assert.ok(!list(await call('audiobooks.chapters',p)).some(x=>String(x.track_id??x.song_id)===String(track)));
    await call('audiobooks.rescan',p);
    await poll(()=>call('audiobooks.scan-status',p),d=>Number(d.refresh_status)===0);
    await call('audiobooks.directory-remove',{...p,dirs:[root+'/music']});
    assert.ok(!JSON.stringify((await call('audiobooks.library',p)).playlist_dirs).includes(root+'/music'));
    await call('files.info',{path:root+'/music/synthetic.flac'});
  });

  await step('photos','photo directory scan, lookup, favorite and album membership',async()=>{
    await call('photos.directory-add',{paths:[root+'/photos']});
    const dir=list(await call('photos.directories')).find(x=>x.path===root+'/photos');assert.ok(dir?.id);
    cleanup('synthetic photo source',async()=>{await call('photos.directory-remove',{dir_ids:[dir.id]});assert.ok(!list(await call('photos.directories')).some(x=>x.path===root+'/photos'));await call('files.info',{path:root+'/photos/synthetic.jpg'});});
    await call('photos.directory-scan',{dir_ids:[dir.id]});
    const feeds=await poll(()=>call('photos.by-path',{paths:[root+'/photos/synthetic.jpg']}),d=>list(d).some(x=>x.id||x.feed_id));
    const feed=list(feeds)[0],feed_id=feed.id??feed.feed_id;
    await call('photos.favorite',{feed_id,liked:1});
    assert.ok(list(await call('photos.favorites',{num:1000})).some(x=>String(x.id??x.feed_id)===String(feed_id)));
    await call('photos.favorite',{feed_id,liked:0});
    assert.ok(!list(await call('photos.favorites',{num:1000})).some(x=>String(x.id??x.feed_id)===String(feed_id)));
    const album=await call('photos.album-create',{name:tag});assert.ok(album.id);
    cleanup('synthetic photo album',async()=>{await call('photos.album-delete',{album_id:album.id});assert.ok(!list(await call('photos.albums',{num:1000})).some(x=>String(x.id)===String(album.id)));});
    await call('photos.album-add',{album_id:album.id,feed_ids:[feed_id]});
    assert.ok(JSON.stringify(await call('photos.photo-albums',{feed_id})).includes(tag));
    await call('photos.album-remove',{album_id:album.id,feed_ids:[feed_id]});
    assert.ok(!list(await call('photos.items',{album_id:album.id})).some(x=>String(x.id??x.feed_id)===String(feed_id)));
    await call('files.info',{path:root+'/photos/synthetic.jpg'});
  });

  await step('video','video library, custom collection, listing and favorite round trip',async()=>{
    await call('video.library-create',{classification_name:tag,file_path:root+'/video',not_scrape:0});
    const library=list(await call('video.libraries')).find(x=>x.name===tag);assert.ok(library?.id);
    cleanup('synthetic video library',async()=>{await call('video.library-delete',{classification_id:library.id});assert.ok(!list(await call('video.libraries')).some(x=>String(x.id)===String(library.id)));});
    const item=await call('video.collection-create',{classification_id:library.id,title:tag});assert.ok(item.collection_id);
    const p={classification_id:library.id,collection_id:item.collection_id};
    cleanup('synthetic video collection',async()=>{await call('video.collection-dismiss',p);assert.ok(!list(await call('video.collections',{classification_id:library.id})).some(x=>String(x.collection_id)===String(p.collection_id)));await call('files.info',{path:root+'/video/synthetic.mp4'});});
    assert.ok(list(await call('video.collections',{classification_id:library.id})).some(x=>String(x.collection_id)===String(p.collection_id)));
    await call('video.favorite-add',p);assert.equal(Number((await call('video.collection',p)).is_fav),1);
    await call('video.favorite-remove',p);assert.equal(Number((await call('video.collection',p)).is_fav),0);
  });
}catch(e){
  report.checks.push({name:'fixture setup',ok:false,code:e.code||e.name});
  console.log('FAIL fixture setup '+(e.code||e.name));
}finally{
  for(const entry of owned.reverse()){
    try{await entry.run();report.cleanup.push({name:entry.name,ok:true});console.log('CLEAN '+entry.name);}
    catch(e){report.cleanup.push({name:entry.name,ok:false,code:e.code||e.name});console.log('CLEANUP FAILED '+entry.name+' '+(e.code||e.name));}
    await save();
  }
  await client.close();await rm(local,{recursive:true,force:true});
  report.stderrEmpty=stderr==='';report.passed=report.checks.filter(x=>x.ok).length;report.failed=report.checks.filter(x=>!x.ok).length;
  await save();console.log(JSON.stringify({passed:report.passed,failed:report.failed,cleanup:report.cleanup,limitations:report.limitations}));
  if(report.failed||report.cleanup.some(x=>!x.ok)||stderr)process.exitCode=1;
}
