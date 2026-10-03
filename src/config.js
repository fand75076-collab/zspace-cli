import { mkdir, readFile, writeFile, rename, chmod, lstat, unlink, open } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authError, conflict, usage } from './errors.js';

export const COOKIE_NAMES = new Set(['token', 'zenithtoken', 'username', 'device_id', 'device', 'plat', 'version', 'nas_id', 'nasid', '_l', 'app']);
export function configPath() {
  if (process.env.ZSPACE_CONFIG) return process.env.ZSPACE_CONFIG;
  const base = platform() === 'darwin' ? join(homedir(), 'Library', 'Application Support') :
    platform() === 'win32' ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming') :
      process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'zspace-cli', 'config.json');
}
export function normalizeUrl(value, allowHttp = false) {
  let url;
  try { url = new URL(value); } catch { throw usage('NAS 地址必须是完整的 HTTPS URL。'); }
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !allowHttp)) throw usage('默认只允许 HTTPS；明文局域网连接需要显式 --allow-http。');
  if (url.username || url.password || url.search || url.hash || !['/', '/home/', '/home'].includes(url.pathname)) throw usage('NAS 地址只应包含协议、主机、端口，可带 /home/。');
  return url.origin;
}
export function validateName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw usage('配置名仅允许 1–64 位字母、数字、下划线和连字符。');
  return name;
}
export function importSession(input, { url, allowHttp = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('会话必须是 JSON 对象。');
  const baseUrl = normalizeUrl(url || input.baseUrl || input.url, allowHttp);
  let cookies = Object.create(null);
  if (Array.isArray(input.cookies)) {
    for (const c of input.cookies) {
      if (!c || typeof c.name !== 'string') continue;
      const host = new URL(baseUrl).hostname;
      if (c.domain && host !== c.domain.replace(/^\./, '') && !host.endsWith('.' + c.domain.replace(/^\./, ''))) continue;
      if (c.expires && c.expires > 0 && c.expires * 1000 < Date.now()) continue;
      if (COOKIE_NAMES.has(c.name)) cookies[c.name] = c.value;
    }
  } else if (input.cookies && typeof input.cookies === 'object') {
    for (const [key, value] of Object.entries(input.cookies)) if (COOKIE_NAMES.has(key)) cookies[key] = value;
  } else if (typeof input.cookie === 'string') {
    for (const item of input.cookie.split(';')) {
      const index = item.indexOf('=');
      if (index > 0 && COOKIE_NAMES.has(item.slice(0, index).trim())) cookies[item.slice(0, index).trim()] = item.slice(index + 1).trim();
    }
  }
  for (const [key, value] of Object.entries(cookies)) if (typeof value !== 'string' || /[\r\n;\x00-\x20\x7f]/.test(value)) throw usage(`会话 Cookie ${key} 含有非法字符；应使用浏览器导出的编码值。`);
  if (!cookies.token && !cookies.zenithtoken) throw authError('会话没有 token/zenithtoken，请重新导出当前 NAS 的已登录会话。');
  const importedAt = typeof input.importedAt === 'string' && Number.isFinite(Date.parse(input.importedAt)) ? input.importedAt : new Date().toISOString();
  return { baseUrl, allowHttp, cookies, importedAt };
}
async function rejectSymlink(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw usage('配置路径不能是符号链接。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export class ConfigStore {
  constructor(path = configPath()) { this.path = path; }
  async read() {
    await rejectSymlink(this.path);
    let config;
    try { config = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, active: null, profiles: {} };
      throw usage('无法读取配置 JSON；请检查配置文件（不会自动覆盖损坏文件）。');
    }
    if (config.version !== 1 || !config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles)) throw usage('不支持的配置格式。');
    if (platform() !== 'win32' && ((await lstat(this.path)).mode & 0o077)) throw usage('凭证文件权限过宽，请先 chmod 600 该配置文件。');
    return config;
  }
  async update(mutator) {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await rejectSymlink(dir);
    await rejectSymlink(this.path);
    const lockPath = `${this.path}.lock`;
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw conflict('另一进程正在更新配置；若已退出，请检查并移除遗留的 .lock 文件。'); throw error; }
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const config = await this.read();
      await mutator(config);
      await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(tmp, this.path);
      await chmod(this.path, 0o600);
      return config;
    } finally {
      await unlink(tmp).catch(() => {});
      await lock.close();
      await unlink(lockPath);
    }
  }
  async select(name) {
    const config = await this.read();
    const selected = name || config.active;
    if (!selected || !Object.hasOwn(config.profiles, selected)) throw authError('尚无可用配置。先执行 zspace auth import --file 会话.json --name home。');
    const profile = config.profiles[selected];
    const session = importSession(profile, { allowHttp: profile.allowHttp === true });
    if (profile.sessionSource !== undefined) {
      if (typeof profile.sessionSource !== 'string' || !isAbsolute(profile.sessionSource)) throw usage('会话来源必须是本机绝对路径。');
      session.sessionSource = profile.sessionSource;
    }
    return { name: selected, profile: session };
  }
  async save(name, profile, { replace = false } = {}) {
    validateName(name);
    await this.update(config => {
      if (Object.hasOwn(config.profiles, name) && !replace) throw conflict(`配置 ${name} 已存在，使用 --replace 更新会话。`);
      Object.defineProperty(config.profiles, name, { value: profile, enumerable: true, writable: true, configurable: true });
      config.active ||= name;
    });
  }
}
