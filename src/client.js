import { ZspaceError, authError, usage, redact } from './errors.js';
import { normalizeUrl, COOKIE_NAMES } from './config.js';

const AUTH_CODES = new Set(['401', '403', 'N001207', 'N001208', 'N001100', 'N001413', 'N001001', 'N001209']);
export function formEncode(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) params.append(key.endsWith('[]') ? key : key + '[]', String(item));
    else params.set(key, String(value));
  }
  return params;
}
export function decodeCookie(value) { try { return decodeURIComponent(value || ''); } catch { return value || ''; } }
export class Client {
  constructor(profile, { timeout = 30000, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizeUrl(profile.baseUrl, profile.allowHttp === true);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400000) throw usage('timeout 必须在 1–86400000 毫秒之间。');
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw usage('请移除 NODE_TLS_REJECT_UNAUTHORIZED=0，CLI 要求验证 TLS 证书。');
    this.cookies = Object.fromEntries(Object.entries(profile.cookies || {}).filter(([key]) => COOKIE_NAMES.has(key)));
    for (const value of Object.values(this.cookies)) if (typeof value !== 'string' || /[\r\n;\x00-\x20\x7f]/.test(value)) throw usage('非法 Cookie 值。');
    this.timeout = timeout;
    this.fetch = fetchImpl;
    this.secrets = Object.entries(this.cookies).filter(([k]) => /token|username|device_id/i.test(k)).map(([, v]) => v);
  }
  common() {
    const c = this.cookies;
    return { plat: decodeCookie(c.plat) || 'web', version: decodeCookie(c.version) || undefined, device_id: decodeCookie(c.device_id) || undefined, device: decodeCookie(c.device) || undefined, _l: decodeCookie(c._l) || 'zh_cn' };
  }
  url(endpoint, query = {}) {
    if (typeof endpoint !== 'string' || !/^\/(?!\/)[a-zA-Z0-9_./-]+$/.test(endpoint) || endpoint.split('/').includes('..')) throw usage('接口必须是当前 NAS 下的绝对路径，不接受完整 URL、查询串或跳转。');
    const url = new URL(endpoint, this.baseUrl);
    url.search = formEncode({ ...this.common(), ...query, webagent: 'v2' }).toString();
    return url;
  }
  async response(endpoint, { method = 'POST', data, query, body, headers = {}, timeout = this.timeout } = {}) {
    const url = this.url(endpoint, query);
    const requestHeaders = new Headers({ Accept: 'application/json', Referer: `${this.baseUrl}/home/`, ...headers });
    requestHeaders.set('Cookie', Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
    if (body === undefined && method !== 'GET' && method !== 'HEAD') {
      requestHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
      body = formEncode({ ...this.common(), ...data });
    }
    let response;
    try {
      response = await this.fetch(url, { method, headers: requestHeaders, body, redirect: 'manual', signal: AbortSignal.timeout(timeout), ...(body && typeof body.pipe === 'function' ? { duplex: 'half' } : {}) });
    } catch (error) {
      const timedOut = ['TimeoutError', 'AbortError'].includes(error.name);
      throw new ZspaceError(timedOut ? 'TIMEOUT' : 'NETWORK', timedOut ? '请求超时；写入可能已被服务器接收，请检查远端状态后再试。' : '无法连接 NAS；检查地址、网络和证书（自建 CA 可用 NODE_EXTRA_CA_CERTS）。', { exitCode: 4 });
    }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw authError('NAS 返回重定向；请使用当前直连地址并重新导入登录会话。为保护凭证，不跟随跳转。'); }
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw authError('登录已失效或无访问权限，请在网页登录后重新导入会话。'); }
    if (!response.ok) { await response.body?.cancel(); throw new ZspaceError('HTTP_ERROR', `NAS 返回 HTTP ${response.status}；该固件可能不支持此接口。`, { status: response.status, endpoint }); }
    return response;
  }
  decode(payload, endpoint) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'code')) throw new ZspaceError('PROTOCOL', '响应不是预期的极空间 JSON 格式。', { endpoint });
    const code = String(payload.code);
    if (!['200', 'S000200'].includes(code)) {
      if (AUTH_CODES.has(code)) throw authError(`会话失效或需要网页验证（${code}），请重新导入会话。`);
      throw new ZspaceError(code, redact(String(payload.msg || payload.message || 'NAS 操作失败'), this.secrets), { endpoint });
    }
    return payload.data;
  }
  async request(endpoint, options) {
    const response = await this.response(endpoint, options);
    const chunks=[]; let bytes=0;
    try {
      for await (const chunk of response.body || []) {
        bytes+=chunk.byteLength;
        if(bytes>32*1024*1024)throw new ZspaceError('RESPONSE_TOO_LARGE','JSON 响应过大，请缩小查询范围。');
        chunks.push(chunk);
      }
    } catch (error) {
      if(error instanceof ZspaceError)throw error;
      throw new ZspaceError('NETWORK', '读取 NAS 响应失败。', { exitCode: 4 });
    }
    const text=Buffer.concat(chunks).toString('utf8');
    let payload;
    try { payload = JSON.parse(text); } catch { throw new ZspaceError('PROTOCOL', 'NAS 返回非 JSON 响应，可能是登录页或固件接口不兼容。'); }
    return this.decode(payload, endpoint);
  }
}
