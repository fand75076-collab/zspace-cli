import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, formEncode, redact } from '../src/index.js';

const profile = { baseUrl: 'https://nas.example.invalid:5056', cookies: { zenithtoken: 'session-secret-12345', plat: 'web', device: 'Mac%20Browser', device_id: '0123456789abcdef0123456789abcdef', version: '2.3.fixture' } };
const ok = data => new Response(JSON.stringify({ code: '200', data }), { headers: { 'Content-Type': 'application/json' } });
test('encodes repeated array fields and Unicode without changing values', () => {
  const p = formEncode({ paths: ['/sata1/my/data/a b', '/sata1/my/data/中文&x'], n: 0, absent: undefined });
  assert.deepEqual(p.getAll('paths[]'), ['/sata1/my/data/a b', '/sata1/my/data/中文&x']);
  assert.equal(p.get('n'), '0'); assert.equal(p.has('absent'), false);
});
test('uses scoped cookie, webagent=v2, verified TLS and manual redirects', async () => {
  const c = new Client(profile, { fetchImpl: async (url, init) => {
    assert.equal(url.origin, profile.baseUrl); assert.equal(url.searchParams.get('webagent'), 'v2');
    assert.equal(init.redirect, 'manual'); assert.match(init.headers.get('Cookie'), /zenithtoken=/);
    assert.equal(init.body.get('device'), 'Mac Browser'); assert.equal(init.body.get('path'), '/sata1/my/data/中文');
    return ok({ fine: true });
  } });
  assert.deepEqual(await c.request('/v2/file/list', { data: { path: '/sata1/my/data/中文' } }), { fine: true });
});
test('prevents off-origin URLs, traversal and query injection', () => {
  const c = new Client(profile);
  for (const endpoint of ['https://evil.invalid/', '//evil.invalid/', '/v2/../auth/login', '/v2/file?evil=1', '/v2/\\evil']) assert.throws(() => c.url(endpoint), { code: 'USAGE' });
});
test('redirect is not followed; secrets are never forwarded', async () => {
  let calls = 0;
  const c = new Client(profile, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } }); } });
  await assert.rejects(c.request('/auth/token'), { code: 'AUTH_REQUIRED' }); assert.equal(calls, 1);
});
test('classifies HTTP and NAS authentication failures', async () => {
  for (const response of [new Response(null, { status: 401 }), new Response(JSON.stringify({ code: 'N001207', msg: 'expired' }))]) {
    const c = new Client(profile, { fetchImpl: async () => response });
    await assert.rejects(c.request('/auth/token'), { code: 'AUTH_REQUIRED', exitCode: 3 });
  }
});
test('preserves NAS permission error instead of treating it as missing file', async () => {
  const c = new Client(profile, { fetchImpl: async () => new Response(JSON.stringify({ code: 'N001411', msg: 'no permission' })) });
  await assert.rejects(c.request('/v2/file/info'), { code: 'N001411' });
});
test('accepts numeric success code; rejects HTML and malformed envelopes', async () => {
  assert.deepEqual(await new Client(profile, { fetchImpl: async () => new Response('{"code":200,"data":{"a":1}}') }).request('/x'), { a: 1 });
  for (const text of ['<html>login</html>', '{"ok":true}', '[]']) await assert.rejects(new Client(profile, { fetchImpl: async () => new Response(text) }).request('/x'), { code: 'PROTOCOL' });
});
test('errors and nested outputs redact credentials', async () => {
  const c = new Client(profile, { fetchImpl: async () => new Response(JSON.stringify({ code: 'ERROR', msg: 'bad ' + profile.cookies.zenithtoken })) });
  await assert.rejects(c.request('/x'), e => !e.message.includes(profile.cookies.zenithtoken));
  const out = JSON.stringify(redact({ token: 'abc', nested: [{ authorization: 'def', pwd: 'ghi', path: '/normal' }], url: 'https://x/?token=1234' }));
  for (const value of ['abc', 'def', 'ghi', '1234']) assert.equal(out.includes(value), false);
  assert.match(out, /normal/);
  assert.equal(redact('embedded {"API_KEY":"quoted-secret"}').includes('quoted-secret'),false);
});
test('network timeouts do not retry writes and do not expose request context', async () => {
  let calls = 0;
  const c = new Client(profile, { fetchImpl: async () => { calls++; throw new DOMException(profile.cookies.zenithtoken, 'TimeoutError'); } });
  await assert.rejects(c.request('/v2/file/remove'), e => e.code === 'TIMEOUT' && !e.message.includes(profile.cookies.zenithtoken));
  assert.equal(calls, 1);
});
test('streamed oversized JSON cancels before unbounded buffering',async()=>{
  let cancelled=false;
  const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
  const c=new Client(profile,{fetchImpl:async()=>new Response(body)});
  await assert.rejects(c.request('/x'),{code:'RESPONSE_TOO_LARGE'});assert.equal(cancelled,true);
});
