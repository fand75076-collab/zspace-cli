import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, importSession } from '../src/config.js';
import { normalizeUrl } from '../src/config.js';

const input = { baseUrl: 'https://nas.example.invalid:5056/home/', cookie: 'zenithtoken=fixture; device=Mac%20Browser; unrelated=do-not-import' };
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'zspace-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return new ConfigStore(join(dir, 'private', 'config.json')); }
test('normalizes address and imports only NAS session cookies', () => {
  const p = importSession(input);
  assert.equal(p.baseUrl, 'https://nas.example.invalid:5056'); assert.equal(p.cookies.unrelated, undefined); assert.equal(p.cookies.device, 'Mac%20Browser');
});
test('imports only matching and unexpired cookie domains', () => {
  const p = importSession({ baseUrl: input.baseUrl, cookies: [{ name: 'token', value: 'fixture', domain: '.example.invalid' }, { name: 'username', value: 'foreign', domain: 'evil.invalid' }, { name: 'device', value: 'expired', expires: 1 }] });
  assert.equal(p.cookies.token, 'fixture'); assert.equal(p.cookies.username, undefined); assert.equal(p.cookies.device, undefined);
});
test('requires credential and rejects header injection', () => {
  assert.throws(() => importSession({ ...input, cookie: '' }), { code: 'AUTH_REQUIRED' });
  assert.throws(() => importSession({ baseUrl: input.baseUrl, cookies: { token: 'a\r\nb' } }), { code: 'USAGE' });
});
test('rejects insecure origin by default and URLs with credentials or queries', () => {
  for (const u of ['http://nas.invalid', 'ftp://nas.invalid', 'https://user:pass@nas.invalid', 'https://nas.invalid/?token=a', 'https://nas.invalid/other']) assert.throws(() => normalizeUrl(u), { code: 'USAGE' });
  assert.equal(normalizeUrl('http://127.0.0.1:5055', true), 'http://127.0.0.1:5055');
});
test('saves atomically with private permissions, supports explicit replacement and profiles', async t => {
  const store = await fixture(t); const profile = importSession(input);
  await store.save('home', profile); await store.save('office', profile);
  assert.equal((await store.select()).name, 'home'); assert.equal((await store.select('office')).name, 'office');
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  await assert.rejects(store.save('home', profile), { code: 'CONFLICT' });
  await store.save('home', profile, { replace: true });
  assert.equal((await store.read()).version, 1);
});
test('rejects damaged config without overwriting it', async t => {
  const store = await fixture(t); await store.save('home', importSession(input));
  await writeFile(store.path, '{broken');
  await assert.rejects(store.save('new', importSession(input)), { code: 'USAGE' });
  assert.equal(await readFile(store.path, 'utf8'), '{broken');
});
test('rejects symlink and loose credentials', async t => {
  const store = await fixture(t); await store.save('home', importSession(input));
  await chmod(store.path, 0o644); await assert.rejects(store.read(), { code: 'USAGE' }); await chmod(store.path, 0o600);
  const other = new ConfigStore(store.path + '.link'); await symlink(store.path, other.path);
  await assert.rejects(other.read(), { code: 'USAGE' });
});
test('does not lose config when another writer holds the lock', async t => {
  const store = await fixture(t); await store.save('home', importSession(input));
  await writeFile(store.path + '.lock', '', { mode: 0o600 });
  await assert.rejects(store.save('office', importSession(input)), { code: 'CONFLICT' });
  assert.equal(Object.keys((await store.read()).profiles).length, 1);
});
