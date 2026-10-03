import test from 'node:test';
import assert from 'node:assert/strict';
import { listFiles, writablePath, nasPath, mkdirRemote, renameRemote, transferRemote, trashRemote, waitTask } from '../src/files.js';
const root = '/sata1/my/data';
test('protects roots and rejects traversal/control characters', () => {
  for (const p of ['/', '/sata1', root, root + '/../secret', root + '/a\n', 'relative', root + '/a\\b']) assert.throws(() => writablePath(p), { code: 'USAGE' });
  assert.equal(writablePath(root + '/中文 space.txt'), root + '/中文 space.txt');
  assert.equal(nasPath(root), root);
});
test('pagination uses server count and continues past short pages', async () => {
  const starts = [];
  const c = { request: async (_url, { data }) => { starts.push(data.start); return { total: '3', list: [{ path: `${root}/${data.start}`, name: `${data.start}` }] }; } };
  const result = await listFiles(c, root, { all: true, limit: 2 });
  assert.equal(result.items.length, 3); assert.equal(result.hasMore, false); assert.deepEqual(starts, [0, 1, 2]);
});
test('pagination stalls fail instead of looping or silently claiming completeness', async () => {
  const c = { request: async () => ({ total: 10, list: [{ path: 'same' }] }) };
  await assert.rejects(listFiles(c, root, { all: true }), { code: 'PAGINATION_STALLED' });
});
test('validates page bounds before requests', async () => {
  const c = { request: () => assert.fail('must not call API') };
  for (const opts of [{ limit: 0 }, { limit: 1001 }, { start: -1 }, { sort: 'bad' }, { order: 'bad' }]) await assert.rejects(listFiles(c, root, opts), { code: 'USAGE' });
});
test('mkdir refuses conflict before sending mutation', async () => {
  const called = [];
  const c = { request: async endpoint => { called.push(endpoint); return { total: 1, list: [{ path: root + '/exists', name: 'exists' }] }; } };
  await assert.rejects(mkdirRemote(c, root + '/exists'), { code: 'CONFLICT' }); assert.deepEqual(called, ['/v2/file/list']);
});
test('mkdir and rename use observed parameter names', async () => {
  const calls = [];
  const c = { request: async (endpoint, { data }) => { calls.push({ endpoint, data }); return endpoint.endsWith('/list') ? { total: 0, list: [] } : { path: root + '/new' }; } };
  await mkdirRemote(c, root + '/new'); await renameRemote(c, root + '/old', 'new');
  assert.deepEqual(calls[1].data, { parent: root, name: 'new', rename: 0 });
  assert.deepEqual(calls[3].data, { path: root + '/old', newname: 'new' });
});
test('copy rejects self-descendant, duplicate names and existing destination', async () => {
  const c = { request: async endpoint => endpoint.endsWith('/info') ? { is_dir: 1 } : { total: 0, list: [] } };
  await assert.rejects(transferRemote(c, [root + '/a/'], root + '/a/sub', 'copy'), { code: 'USAGE' });
  await assert.rejects(transferRemote(c, [root + '/a/x', root + '/b/x'], root + '/to', 'copy'), { code: 'CONFLICT' });
});
test('trash sends skip_bin=0 for recoverable deletion; -1 means no auto-cleanup', async () => {
  let body;
  const c = { request: async (endpoint, options) => {
    if (endpoint.includes('/config/')) return { my_cycle: -1 };
    if (endpoint.endsWith('/list')) return { total: 0, list: [] };
    body = options.data; return { otype: 'sync', task: { id: '1', state: 'done', fail_num: 0 } };
  } };
  assert.equal((await trashRemote(c, [root + '/a'])).completed, true);
  assert.deepEqual(body, { paths: [root + '/a'], skip_bin: 0 });
});
test('synchronous move with stale new state verifies the filesystem without polling a discarded task', async () => {
  let moved = false; let polls = 0;
  const c = { request: async (endpoint, { data }) => {
    if (endpoint === '/v2/file/taskbyids') { polls++; return { list: [] }; }
    if (endpoint === '/v2/file/info') return data.path === root + '/to' ? { is_dir: '1' } : { is_dir: '0', size: '10' };
    if (endpoint === '/v2/file/list') return { total: moved || data.path === root + '/to' ? 0 : 1, list: moved || data.path === root + '/to' ? [] : [{ path: root + '/file', name: 'file' }] };
    if (endpoint === '/v2/file/move') { moved = true; return { otype: 'sync', task: { id: '1', state: 'new', fail_num: '0' } }; }
    throw Error('unexpected endpoint');
  } };
  const result = await transferRemote(c, [root + '/file'], root + '/to', 'move');
  assert.equal(result.completed, true); assert.equal(result.verified, true); assert.equal(polls, 0);
});
test('trash refuses unknown recycle policy before mutation', async () => {
  let calls = 0;
  const c = { request: async () => { calls++; return {}; } };
  await assert.rejects(trashRemote(c, [root + '/a']), { code: 'RECYCLE_DISABLED' }); assert.equal(calls, 1);
});
test('async operations wait for real completion and report partial failure', async () => {
  const task = { id: '1', state: 'new', fail_num: 0 };
  const c = { request: async () => ({ list: [{ ...task, state: 'done' }] }) };
  assert.equal((await waitTask(c, task, { interval: 1, waitMs: 100 })).state, 'done');
  await assert.rejects(waitTask(c, { ...task, state: 'done', fail_num: 1 }), { code: 'TASK_FAILED' });
  await assert.rejects(waitTask(c, task, { waitMs: 0 }), { code: 'TASK_PENDING' });
});
