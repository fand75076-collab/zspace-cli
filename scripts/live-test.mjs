// Opt-in integration test: only creates and recycles its own synthetic fixture directory.
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { READ_APIS } from '../src/catalog.js';
import { VERSION } from '../src/version.js';

const { values } = parseArgs({ options: { parent: { type: 'string' }, profile: { type: 'string' }, config: { type: 'string' }, yes: { type: 'boolean' }, report: { type: 'string' } } });
if (!values.parent || !values.yes) { console.error('用法：npm run test:live -- --parent /POOL/my/data --yes [--profile home] [--report work/acceptance.json]'); process.exit(2); }
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/zspace.js', import.meta.url));
const globals = ['--json', ...(values.profile ? ['--profile', values.profile] : []), ...(values.config ? ['--config', values.config] : [])];
async function call(...args) {
  try { const { stdout } = await exec(process.execPath, [cli, ...args, ...globals], { maxBuffer: 32 * 1024 * 1024 }); return JSON.parse(stdout); }
  catch (error) { error.command = args.slice(0, 2).join(' '); throw error; }
}
const report = { version: VERSION, timestamp: new Date().toISOString(), device: {}, tests: [], cleanup: 'not-started' };
const check = async (name, fn) => { const start = Date.now(); try { await fn(); report.tests.push({ name, passed: true, durationMs: Date.now() - start }); console.log(`PASS ${name}`); } catch (error) { report.tests.push({ name, passed: false }); throw error; } };
const root = posix.join(values.parent, 'zspace-cli-test-' + randomUUID());
await mkdir('work', { recursive: true });
const scratch = await mkdtemp(resolve('work', 'live-'));
let created = false;
try {
  await check('session and core health', async () => { assert.equal((await call('auth', 'status')).authenticated, true); assert.equal((await call('doctor')).ok, true); });
  const status = await call('status'); report.device = { model: status.model, webVersion: status.firmware };
  for (const key of Object.keys(READ_APIS)) await check(`read ${key}`, async () => { assert.notEqual(await call(...key.split('.')), undefined); });
  await check('discover accessible personal roots', async () => { const roots = await call('files', 'roots'); assert.ok(roots.some(r => r.path === values.parent)); });
  await check('dry run sends no mutation', async () => { const p = await call('files', 'mkdir', root, '--dry-run'); assert.equal(p.dryRun, true); });
  await check('create fixture directory', async () => { assert.equal((await call('files', 'mkdir', root, '--yes')).path, root); created = true; });
  const binary = Buffer.alloc(2 * 1024 * 1024); for (let i = 0; i < binary.length; i++) binary[i] = i % 251;
  const fixtures = [['中文 空格 & %+.txt', Buffer.from('极空间 CLI 自测\nUnicode ✓\n')], ['binary.bin', binary], ['empty.txt', Buffer.alloc(0)], ['data.json', Buffer.from('{"code":123,"fixture":true}\n')]];
  for (const [name, data] of fixtures) {
    const local = join(scratch, name); await writeFile(local, data); const remote = posix.join(root, name);
    await check(`upload and download ${name === 'binary.bin' ? '2 MiB binary' : name === 'empty.txt' ? 'empty file' : name === 'data.json' ? 'JSON file' : 'Unicode filename'}`, async () => {
      const u = await call('files', 'upload', local, remote, '--yes'); const d = await call('files', 'download', remote, local + '.download', '--yes');
      const expected = createHash('sha256').update(data).digest('hex'); assert.equal(u.sha256, expected); assert.equal(d.sha256, expected); assert.deepEqual(await readFile(local + '.download'), data);
    });
  }
  await check('explicit pagination and complete pagination', async () => {
    const first = await call('files', 'ls', root, '--limit', '2'); const all = await call('files', 'ls', root, '--limit', '2', '--all');
    assert.equal(first.items.length, 2); assert.equal(first.hasMore, true); assert.equal(all.items.length, fixtures.length); assert.equal(all.hasMore, false);
  });
  await check('existing upload is refused without changing contents', async () => {
    await assert.rejects(call('files', 'upload', join(scratch, 'binary.bin'), posix.join(root, 'binary.bin'), '--yes'), e => e.code === 6);
  });
  await check('existing local download is refused', async () => {
    await assert.rejects(call('files', 'download', posix.join(root, 'binary.bin'), join(scratch, 'binary.bin'), '--yes'), e => e.code === 6);
  });
  await check('rename, copy, move and task completion', async () => {
    const original = posix.join(root, fixtures[0][0]); const renamed = posix.join(root, 'renamed.txt');
    await call('files', 'rename', original, 'renamed.txt', '--yes');
    await call('files', 'mkdir', posix.join(root, 'copy'), '--yes'); await call('files', 'mkdir', posix.join(root, 'move'), '--yes');
    const copied = await call('files', 'copy', renamed, '--to', posix.join(root, 'copy'), '--yes'); assert.equal(copied.completed, true);
    const moved = await call('files', 'move', renamed, '--to', posix.join(root, 'move'), '--yes'); assert.equal(moved.completed, true);
    assert.equal(copied.verified, true); assert.equal(moved.verified, true);
    for (const folder of ['copy', 'move']) assert.equal((await call('files', 'stat', posix.join(root, folder, 'renamed.txt'))).size, String(fixtures[0][1].length));
    assert.equal((await call('files', 'ls', root, '--all')).items.some(f => f.path === renamed), false);
  });
  await check('query retained task by id', async () => { const retained = await call('files', 'tasks'); if (retained.list?.length) assert.equal(String((await call('files', 'task', String(retained.list[0].id))).id), String(retained.list[0].id)); });
  await check('protected root rejected before mutation', async () => { await assert.rejects(call('files', 'trash', values.parent, '--dry-run'), e => e.code === 2); });
} catch (error) {
  console.error('Live test failed:', error.command || '', error.code || error.name, error instanceof assert.AssertionError ? error.message : error.stderr || 'see the failing check above');
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      await check('recycle only the fixture directory and confirm recovery entry', async () => {
        const result = await call('files', 'trash', root, '--yes'); assert.equal(result.completed, true);
        const list = await call('files', 'ls', values.parent, '--all'); assert.equal(list.items.some(f => f.path === root), false);
        let found = false;
        for (let start = 0; start < 10000 && !found; start += 1000) {
          const data = await call('files', 'recycle', '--start', String(start), '--limit', '1000');
          found = (data.list || []).some(item => JSON.stringify(item).includes(root));
          if (!data.list?.length || start + data.list.length >= Number(data.total)) break;
        }
        assert.equal(found, true);
      });
      report.cleanup = 'fixture-confirmed-in-recycle-bin';
    } catch { report.cleanup = 'check-failed'; console.error('Cleanup verification failed; inspect the uniquely named test directory:', root); process.exitCode = 1; }
  }
  await rm(scratch, { recursive: true, force: true });
  report.passed = report.tests.every(t => t.passed) && report.cleanup === 'fixture-confirmed-in-recycle-bin';
  if (values.report) { await mkdir(resolve(values.report, '..'), { recursive: true }); await writeFile(values.report, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ passed: report.passed, checks: report.tests.length, cleanup: report.cleanup }));
}
