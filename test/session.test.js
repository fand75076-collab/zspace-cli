import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/config.js';
import { SessionManager } from '../src/session.js';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'zspace-session-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const config=join(dir,'config.json'),source=join(dir,'session.json'),store=new ConfigStore(config);
  const profile={baseUrl:'https://nas.example.invalid',cookies:{token:'fixture-old'},importedAt:'2026-01-01T00:00:00.000Z'};
  await store.save('fixture',profile);
  const calls=[];
  const clientFactory=p=>({request:async endpoint=>{calls.push({endpoint,value:p.cookies.token}); if(p.cookies.token==='bad') throw Object.assign(new Error('expired'),{code:'AUTH_REQUIRED'}); return {};}});
  const manager=new SessionManager({config,profile:'fixture',clientFactory});
  const write=(token,extra={})=>writeFile(source,JSON.stringify({...profile,cookies:{token},...extra}),{mode:0o600});
  return {source,store,profile,calls,manager,write};
}
test('Session preserves import timestamp and picks up verified changed credentials without restart',async t=>{
  const f=await fixture(t);assert.equal((await f.store.select()).profile.importedAt,f.profile.importedAt);
  await f.write('fixture-a');await f.manager.bindSource(f.source);assert.equal(f.calls.length,1);
  await f.manager.client();assert.equal(f.calls.length,1);
  await f.write('fixture-b');await f.manager.client();assert.equal(f.calls.length,2);
  assert.equal((await f.store.select()).profile.cookies.token,'fixture-b');
  assert.equal((await f.manager.refresh()).changed,false);assert.equal(f.calls.length,3);
  assert.equal((await f.manager.status()).mode,'rotating-file');
});
test('Session origin changes are blocked before any verification request',async t=>{
  const f=await fixture(t);await f.write('foreign',{baseUrl:'https://other.invalid'});
  await assert.rejects(f.manager.bindSource(f.source),{code:'SESSION_ORIGIN_CHANGED'});assert.equal(f.calls.length,0);
});
test('Invalid and expired sources fail closed and preserve last working credentials',async t=>{
  const f=await fixture(t);await f.write('fixture-a');await f.manager.bindSource(f.source);await f.write('bad');
  await assert.rejects(f.manager.client(),{code:'AUTH_REQUIRED'});assert.equal((await f.store.select()).profile.cookies.token,'fixture-a');
  await writeFile(f.source,'{invalid');await assert.rejects(f.manager.client(),{code:'SESSION_SOURCE_INVALID'});
  await f.manager.bindSource(null);assert.equal((await f.manager.status()).mode,'imported-session');
  await f.manager.client();assert.equal(f.calls.length,2);
});
test('Private source checks reject loose permissions, symbolic links and oversized files',async t=>{
  const f=await fixture(t);await f.write('a');await chmod(f.source,0o644);
  await assert.rejects(f.manager.bindSource(f.source),{code:'USAGE'});await chmod(f.source,0o600);
  await symlink(f.source,f.source+'.link');await assert.rejects(f.manager.bindSource(f.source+'.link'),{code:'SESSION_SOURCE_INVALID'});
  await writeFile(f.source,'x'.repeat(1048577));await assert.rejects(f.manager.bindSource(f.source),{code:'USAGE'});assert.equal(f.calls.length,0);
});
test('No source means refresh only validates; the manager never fabricates renewal',async t=>{
  const f=await fixture(t);assert.equal((await f.manager.refresh()).changed,false);assert.equal(f.calls.length,1);
  assert.equal((await f.manager.status()).automaticLogin,false);
});
