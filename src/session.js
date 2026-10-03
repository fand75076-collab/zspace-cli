import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ConfigStore, importSession } from './config.js';
import { Client } from './client.js';
import { ZspaceError, conflict, usage } from './errors.js';

export function sessionFingerprint(profile) {
  return createHash('sha256').update(JSON.stringify([profile.baseUrl, Object.entries(profile.cookies).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');
}

// Read only an owner-selected private regular file. Never run credential commands.
export async function readSessionSource(path, profile) {
  if (!isAbsolute(path)) throw usage('会话来源必须是绝对路径。');
  let handle;
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new ZspaceError('SESSION_SOURCE_INVALID','会话来源不能是符号链接。',{exitCode:3});
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1048576) throw usage('会话来源必须是小于 1 MiB 的普通 JSON 文件。');
    if (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) throw usage('会话来源必须由当前用户拥有，权限为 600。');
    const buffer=Buffer.alloc(1048577);
    let bytes=0;
    while (bytes<buffer.length) {
      const part=await handle.read(buffer,bytes,buffer.length-bytes,null);
      if (!part.bytesRead) break;
      bytes+=part.bytesRead;
    }
    if (bytes>1048576) throw usage('会话来源超过 1 MiB。');
    const input = JSON.parse(buffer.subarray(0,bytes).toString('utf8'));
    const candidate = importSession(input, { allowHttp: profile.allowHttp });
    if (candidate.baseUrl !== profile.baseUrl) throw new ZspaceError('SESSION_ORIGIN_CHANGED', '会话来源的 NAS 地址与绑定配置不同；不会把凭证发送到新地址。', { exitCode: 3 });
    return candidate;
  } catch (e) {
    if (e instanceof ZspaceError) throw e;
    throw new ZspaceError('SESSION_SOURCE_INVALID', '无法读取会话来源。请检查本机 JSON、600 权限及符号链接，或用 auth source --clear --yes 解绑。', { exitCode: 3 });
  } finally { await handle?.close(); }
}

export class SessionManager {
  constructor({ config, profile, timeout, clientFactory, expectedOrigin } = {}) {
    this.store = new ConfigStore(config);
    this.profile = profile;
    this.expectedOrigin = expectedOrigin;
    this.makeClient = clientFactory || (p => new Client(p, { ...(timeout ? { timeout } : {}) }));
  }
  async status() {
    const { name, profile } = await this.store.select(this.profile);
    return { profile: name, mode: profile.sessionSource ? 'rotating-file' : 'imported-session', importedAt: profile.importedAt, automaticLogin: false, recovery: profile.sessionSource ? 'Update the private session source, then auth refresh. Changed sessions are verified and loaded before the next call.' : 'Log in to the NAS and run auth import --replace with a private session JSON.' };
  }
  async bindSource(path) {
    const { name, profile } = await this.store.select(this.profile);
    if (path === null) {
      await this.store.update(c => { if (!Object.hasOwn(c.profiles, name)) throw conflict('配置已移除。'); delete c.profiles[name].sessionSource; });
      return { profile: name, sourceConfigured: false };
    }
    path = resolve(path);
    if (path === resolve(this.store.path)) throw usage('会话来源不能是 CLI 配置文件本身。');
    const candidate = await readSessionSource(path, profile);
    await this.makeClient(candidate).request('/auth/token');
    await this.replace(name, profile, { ...candidate, sessionSource: path });
    return { profile: name, sourceConfigured: true, authenticated: true };
  }
  async replace(name, before, after) {
    await this.store.update(c => {
      const current = c.profiles[name];
      if (!current || sessionFingerprint(current) !== sessionFingerprint(before) || current.sessionSource !== before.sessionSource) throw conflict('会话在验证期间被其他进程修改；请重新调用。');
      c.profiles[name] = after;
    });
  }
  async select({ force = false } = {}) {
    const selected = await this.store.select(this.profile);
    const { name, profile } = selected;
    if (this.expectedOrigin && profile.baseUrl !== this.expectedOrigin) throw new ZspaceError('AGENT_DENIED','NAS 地址发生变化；需要所有者重新建立 Agent 配置。',{exitCode:7});
    if (!profile.sessionSource) {
      if (force) await this.makeClient(profile).request('/auth/token');
      return { ...selected, changed: false };
    }
    const candidate = await readSessionSource(profile.sessionSource, profile);
    const changed = sessionFingerprint(candidate) !== sessionFingerprint(profile);
    if (!changed && !force) return { ...selected, changed: false };
    await this.makeClient(candidate).request('/auth/token');
    if (changed) {
      const next = { ...candidate, importedAt: new Date().toISOString(), sessionSource: profile.sessionSource };
      await this.replace(name, profile, next);
      return { name, profile: next, changed: true };
    }
    return { ...selected, changed: false };
  }
  async client() { return this.makeClient((await this.select()).profile); }
  async refresh() {
    const { name, profile, changed } = await this.select({ force: true });
    return { profile: name, authenticated: true, changed, sourceConfigured: Boolean(profile.sessionSource) };
  }
}
