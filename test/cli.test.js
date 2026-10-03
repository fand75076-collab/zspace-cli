import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/version.js';
import { parse, execute, format } from '../src/cli.js';
test('parses aliases and global flags anywhere', () => {
  const p = parse(['--json', '--profile', 'home', 'ls', '/sata1/my/data', '--all']);
  assert.equal(p.command.name, 'files ls'); assert.equal(p.options.all, true); assert.equal(p.options.json, true);
});
test('rejects misspelled commands, wrong options and extra positional args', () => {
  for (const a of [['statu'], ['status', '--yes'], ['status', 'extra'], ['files', 'ls'], ['files', 'ls', '/a', '--to', '/b']]) assert.throws(() => parse(a), { code: 'USAGE' });
});
test('dry run requires no configuration and never authenticates', async () => {
  const { output } = await execute(['files', 'mkdir', '/sata1/my/data/new', '--dry-run', '--json', '--config', '/nonexistent/no-config.json']);
  assert.equal(JSON.parse(output).dryRun, true); assert.equal(JSON.parse(output).path, '/sata1/my/data/new');
});
test('writes without yes fail before loading credentials', async () => {
  await assert.rejects(execute(['files', 'trash', '/sata1/my/data/a']), { code: 'USAGE' });
});
test('dry run validates protected paths and missing destination', async () => {
  await assert.rejects(execute(['files', 'mkdir', '/sata1/my/data', '--dry-run']), { code: 'USAGE' });
  await assert.rejects(execute(['files', 'copy', '/sata1/my/data/a', '--dry-run']), { code: 'USAGE' });
});
test('machine readable catalogue and version work offline', async () => {
  const output = JSON.parse((await execute(['commands', '--json'])).output);
  assert.ok(output.some(x => x.command === 'files upload' && x.writes));
  assert.equal((await execute(['--version'])).output, VERSION);
});
test('JSON output redacts secrets and text table strips terminal control characters', () => {
  assert.equal(JSON.parse(format({ token: 'abc' }, null, true)).token, '[REDACTED]');
  const out = format({ items: [{ name: '\x1b[31mfile', is_dir: 0, size: 1 }], total: 1 }, { name: 'files ls' }, false);
  assert.equal(out.includes('\x1b'), false);
});
