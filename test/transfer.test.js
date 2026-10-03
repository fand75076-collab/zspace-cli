import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client, ConfigStore, upload, download } from '../src/index.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'zspace-transfer-'));
  const data = new Map(); const calls = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks); const form = new URLSearchParams(body.toString());
    calls.push({ method: req.method, path: url.pathname, headers: req.headers });
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: '200', data: value })); };
    if (url.pathname === '/auth/token') return json({ is_master: 1 });
    if (url.pathname === '/v2/file/list') return json({ total: data.size, list: [...data].map(([path, bytes]) => ({ name: path.split('/').pop(), path, size: bytes.length, is_dir: 0 })) });
    if (url.pathname === '/v2/file/create') { const path = decodeURIComponent(req.headers.path); data.set(path, body); return json({ path }); }
    if (url.pathname === '/v2/file/info') {
      const path = form.get('path'); const bytes = data.get(path);
      return json({ path, is_dir: 0, size: bytes?.length ?? 0 });
    }
    if (url.pathname === '/v2/file/download') {
      const path = url.searchParams.get('path');
      if (path.endsWith('/error')) { res.setHeader('Content-Type', 'application/json'); return res.end('{"code":"N001207","msg":"expired"}'); }
      res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="fixture"');
      if (path.endsWith('/wrong-size')) return res.end('incomplete');
      return res.end(data.get(path));
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const profile = { baseUrl: `http://127.0.0.1:${server.address().port}`, allowHttp: true, cookies: { zenithtoken: 'synthetic-test-token' } };
  return { dir, data, calls, profile, client: new Client(profile) };
}
test('streams binary and Unicode paths, compares SHA-256 end-to-end', async t => {
  const f = await fixture(t); const bytes = randomBytes(2 * 1024 * 1024); const path = '/sata1/my/data/中文 & % 文件.bin';
  const source = join(f.dir, 'input'); const destination = join(f.dir, 'output'); await writeFile(source, bytes);
  const up = await upload(f.client, source, path); const down = await download(f.client, path, destination);
  assert.equal(up.sha256, down.sha256); assert.equal(up.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(destination), bytes);
  const request = f.calls.find(c => c.path === '/v2/file/create'); assert.equal(request.headers.path, encodeURIComponent(path)); assert.equal(request.headers.rename, '0');
});
test('empty file and downloadable JSON are preserved', async t => {
  const f = await fixture(t);
  for (const [name, content] of [['empty', ''], ['value.json', '{"code":123,"ordinary_file":true}']]) {
    const input = join(f.dir, name); await writeFile(input, content); const path = '/sata1/my/data/' + name;
    await upload(f.client, input, path); await download(f.client, path, input + '.out');
    assert.equal(await readFile(input + '.out', 'utf8'), content);
  }
});
test('upload conflict and local download conflict leave originals unchanged', async t => {
  const f = await fixture(t); const path = '/sata1/my/data/existing'; f.data.set(path, Buffer.from('remote-original'));
  const input = join(f.dir, 'existing'); await writeFile(input, 'local-original');
  await assert.rejects(upload(f.client, input, path), { code: 'CONFLICT' });
  await assert.rejects(download(f.client, path, input), { code: 'CONFLICT' });
  assert.equal(f.data.get(path).toString(), 'remote-original'); assert.equal(await readFile(input, 'utf8'), 'local-original');
});
test('NAS auth error is not saved as a file and partial download is removed', async t => {
  const f = await fixture(t); f.data.set('/sata1/my/data/wrong-size', Buffer.alloc(100));
  await assert.rejects(download(f.client, '/sata1/my/data/error', join(f.dir, 'error')), { code: 'AUTH_REQUIRED' });
  await assert.rejects(download(f.client, '/sata1/my/data/wrong-size', join(f.dir, 'bad')), { code: 'SIZE_MISMATCH' });
  assert.deepEqual(await readdir(f.dir), []);
});
test('installed entrypoint supports pipeable JSON with empty stderr', async t => {
  const f = await fixture(t); const config = join(f.dir, 'credentials', 'config.json'); await new ConfigStore(config).save('test', f.profile);
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['bin/zspace.js', 'auth', 'status', '--json', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).authenticated, true); assert.equal(result.stdout.includes('synthetic-test-token'), false);
});
