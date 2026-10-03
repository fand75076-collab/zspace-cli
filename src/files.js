import { posix, resolve, dirname } from 'node:path';
import { stat, lstat, mkdir, unlink, link } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { ZspaceError, usage, conflict } from './errors.js';

export function nasPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => p === '.' || p === '..')) throw usage('NAS 路径必须是绝对路径，不能含 .、..、反斜杠或控制字符。');
  return posix.normalize(path);
}
export function writablePath(path) {
  const normalized = nasPath(path);
  if (!/^\/[^/]+\/(?:my|public)\/[^/]+\/.+/.test(normalized)) throw usage('拒绝修改存储池或空间根目录；请指定空间内的具体文件或目录。');
  return normalized.replace(/\/$/, '');
}
export function fileName(name) {
  if (typeof name !== 'string' || !name || /[\/\\\x00-\x1f\x7f]/.test(name) || ['.', '..'].includes(name)) throw usage('新名称必须是单个文件名，不能包含路径。');
  return name;
}
export const fileInfo = (client, path) => client.request('/v2/file/info', { data: { path: nasPath(path) } });
export async function listFiles(client, path, { start = 0, limit = 100, all = false, hidden = false, sort = 'name', order = 'asc', maxPages = 10000 } = {}) {
  nasPath(path);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw usage('start 必须非负，limit 必须在 1–1000 之间。');
  if (!['name', 'mtime', 'ctime', 'size', 'type'].includes(sort) || !['asc', 'desc'].includes(order)) throw usage('不支持的排序。');
  const result = { path, start, total: 0, items: [], hasMore: false };
  const seen = new Set();
  let cursor = start;
  for (let page = 0; page < maxPages; page++) {
    const data = await client.request('/v2/file/list', { data: { path, start: cursor, num: limit, sortby: sort, order, show_hidden: hidden ? 1 : 0, dup: 0 } });
    if (!Array.isArray(data?.list) || !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0) throw new ZspaceError('PROTOCOL', '文件列表结构不兼容。');
    result.total = Number(data.total);
    let added = 0;
    for (const item of data.list) if (!seen.has(item.path)) { seen.add(item.path); result.items.push(item); added++; }
    cursor += data.list.length;
    result.hasMore = cursor < result.total;
    if (!all || !result.hasMore) return result;
    if (!data.list.length || !added) throw new ZspaceError('PAGINATION_STALLED', '列表分页没有推进；目录可能正在变化，请重试。');
  }
  throw new ZspaceError('PAGINATION_LIMIT', '分页次数达到上限，请分段查询。');
}
export async function assertAbsent(client, path) {
  // Check via parent listing: file/info missing-file codes vary between firmware versions.
  const { items } = await listFiles(client, posix.dirname(path), { all: true, hidden: true, limit: 500 });
  if (items.some(item => item.path.replace(/\/$/, '') === path || item.name === posix.basename(path))) throw conflict('目标已存在；本版本不自动覆盖或自动改名。');
}
export async function mkdirRemote(client, path) {
  path = writablePath(path);
  await assertAbsent(client, path);
  return client.request('/v2/file/newdir', { data: { parent: posix.dirname(path), name: fileName(posix.basename(path)), rename: 0 } });
}
export async function renameRemote(client, path, name) {
  path = writablePath(path); fileName(name);
  const target = posix.join(posix.dirname(path), name);
  if (path === target) throw usage('新旧名称相同。');
  await assertAbsent(client, target);
  return client.request('/v2/file/modify', { data: { path, newname: name } });
}
export async function taskInfo(client, id) {
  if (!/^\d+$/.test(String(id))) throw usage('任务 ID 必须是数字。');
  const data = await client.request('/v2/file/taskbyids', { data: { ids: [String(id)] } });
  const task = data?.list?.find(t => String(t.id) === String(id));
  if (!task) throw new ZspaceError('TASK_NOT_FOUND', '任务不存在或已经被清理。', { taskId: String(id) });
  return task;
}
export async function waitTask(client, task, { waitMs = 30000, interval = 300 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (Number(task.fail_num) > 0 || ['fail', 'failed', 'removed', 'cancel', 'cancelled'].includes(task.state)) throw new ZspaceError('TASK_FAILED', '文件任务失败、部分失败或被取消。', { taskId: String(task.id), state: task.state, failed: Number(task.fail_num) || 0 });
    if (task.state === 'done') return task;
    if (Date.now() >= deadline) throw new ZspaceError('TASK_PENDING', '文件任务仍在运行；用 files task 查询。未取消任务，请勿重复提交。', { taskId: String(task.id) });
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
    task = await taskInfo(client, task.id);
  }
}
async function completeOperation(client, result, { wait = true, waitMs = 30000 } = {}, verify) {
  if (!result?.task?.id) throw new ZspaceError('PROTOCOL', '服务器没有返回文件任务 ID，请检查远端结果后再操作。');
  if (!['sync', 'async'].includes(result.otype)) throw new ZspaceError('PROTOCOL', '服务器返回了未知的任务执行类型。');
  // A synchronous response may still contain a stale task.state="new"; it is
  // not retained by taskbyids. The web UI uses otype as the completion contract.
  const task = result.otype === 'async' && wait ? await waitTask(client, result.task, { waitMs }) : result.task;
  if (Number(task.fail_num) > 0 || ['fail', 'failed'].includes(task.state)) throw new ZspaceError('TASK_FAILED', '文件任务失败或部分失败。', { taskId: String(task.id), failed: Number(task.fail_num) || 0 });
  const completed = result.otype === 'sync' || task.state === 'done';
  if (completed && verify) await verify();
  return { completed, execution: result.otype, verified: Boolean(completed && verify), task };
}
export async function transferRemote(client, paths, to, mode, options) {
  to = nasPath(to);
  paths = paths.map(writablePath);
  if (!paths.length || !['copy', 'move'].includes(mode)) throw usage('需要源路径和目标目录。');
  const target = await fileInfo(client, to);
  if (String(target.is_dir) !== '1') throw usage('目标必须是目录。');
  const names = new Set();
  const sources = [];
  for (const path of paths) {
    writablePath(path);
    const name = posix.basename(path);
    if (names.has(name)) throw conflict('多个源文件使用相同名称。');
    names.add(name);
    if (to === path || to.startsWith(path + '/')) throw usage('不能将目录复制或移动到自身内部。');
    await assertAbsent(client, posix.join(to, name));
    sources.push(await fileInfo(client, path));
  }
  return completeOperation(client, await client.request(`/v2/file/${mode}`, { data: { paths, to } }), options, async () => {
    for (let i = 0; i < paths.length; i++) {
      const destination = await fileInfo(client, posix.join(to, posix.basename(paths[i])));
      if (String(destination.is_dir) !== String(sources[i].is_dir) || (String(destination.is_dir) !== '1' && Number(destination.size) !== Number(sources[i].size))) throw new ZspaceError('VERIFY_FAILED', '目标文件类型或大小不匹配，请检查任务结果。');
    }
    if (mode === 'move') await assertRemoved(client, paths);
  });
}
async function assertRemoved(client, paths) {
  for (const parent of new Set(paths.map(p => posix.dirname(p)))) {
    const list = await listFiles(client, parent, { all: true, hidden: true, limit: 500 });
    if (list.items.some(item => paths.includes(item.path))) throw new ZspaceError('VERIFY_FAILED', '操作后源路径仍然存在，请检查 NAS 结果。');
  }
}
export async function trashRemote(client, paths, options) {
  paths = paths.map(writablePath);
  if (!paths.length) throw usage('需要待删除路径。');
  const config = await client.request('/v2/file/recycle/config/get');
  for (const path of paths) {
    const retention = path.split('/')[2] === 'public' ? config.public_cycle : config.my_cycle;
    if (!(Number(retention) > 0 || Number(retention) === -1)) throw new ZspaceError('RECYCLE_DISABLED', '无法确认回收站已启用，拒绝删除。请先在网页检查回收站设置。');
  }
  return completeOperation(client, await client.request('/v2/file/remove', { data: { paths, skip_bin: 0 } }), options, () => assertRemoved(client, paths));
}
export async function listTrash(client, { start = 0, limit = 100 } = {}) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw usage('start 必须非负，limit 必须在 1–1000 之间。');
  return client.request('/v2/file/nb/list', { data: { path: '/.recycle/my', start, num: limit } });
}
export async function download(client, remote, destination, { timeout = 3600000 } = {}) {
  remote = nasPath(remote);
  const info = await fileInfo(client, remote);
  if (String(info.is_dir) === '1') throw usage('download 当前仅支持单文件。');
  destination = resolve(destination);
  await mkdir(dirname(destination), { recursive: true });
  try { await lstat(destination); throw conflict('本地目标已存在；请指定新的下载文件名。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = `${destination}.${randomUUID()}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const response = await client.response('/v2/file/download', { method: 'GET', query: { path: remote, remote_port: 8050 }, timeout, headers: { Accept: 'application/octet-stream' } });
    // Some firmware returns API errors with HTTP 200 instead of a downloadable body.
    const contentType = response.headers.get('content-type') || '';
    if (/application\/json|text\/html/.test(contentType) && !response.headers.get('content-disposition')) {
      const text = await response.text();
      let payload; try { payload = JSON.parse(text); } catch {}
      if (payload && Object.hasOwn(payload, 'code')) client.decode(payload, '/v2/file/download');
      throw new ZspaceError('PROTOCOL', '服务器未返回文件内容。');
    }
    const counter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    if (Number.isFinite(Number(info.size)) && bytes !== Number(info.size)) throw new ZspaceError('SIZE_MISMATCH', '下载字节数与远端元数据不一致，已丢弃临时文件。');
    try { await link(temp, destination); } catch (error) { if (error.code === 'EEXIST') throw conflict('本地目标已被其他进程创建，拒绝覆盖。'); throw error; }
    return { path: remote, destination, bytes, sha256: hash.digest('hex') };
  } finally { await unlink(temp).catch(() => {}); }
}
export async function upload(client, source, remote, { timeout = 3600000 } = {}) {
  remote = writablePath(remote);
  const metadata = await stat(source);
  if (!metadata.isFile()) throw usage('upload 当前仅支持单文件。');
  await assertAbsent(client, remote);
  const hash = createHash('sha256');
  let bytes = 0;
  const input = createReadStream(source);
  const stream = Readable.from((async function* () {
    for await (const chunk of input) { bytes += chunk.length; hash.update(chunk); yield chunk; }
  })());
  try {
    const response = await client.response('/v2/file/create', { body: stream, timeout, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(metadata.size), path: encodeURIComponent(remote), rename: '0', app: 'file' } });
    let payload; try { payload = await response.json(); } catch { throw new ZspaceError('PROTOCOL', '上传响应不是 JSON，请检查远端状态。'); }
    const result = client.decode(payload, '/v2/file/create');
    const saved = await fileInfo(client, remote);
    if (bytes !== metadata.size || Number(saved.size) !== metadata.size) throw new ZspaceError('SIZE_MISMATCH', '上传后远端文件大小不匹配，请检查文件。');
    return { path: remote, bytes: metadata.size, sha256: hash.digest('hex'), result };
  } finally { stream.destroy(); input.destroy(); }
}
