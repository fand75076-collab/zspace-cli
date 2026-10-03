export class ZspaceError extends Error {
  constructor(code, message, { exitCode = 5, ...details } = {}) {
    super(message);
    this.name = 'ZspaceError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}
export const usage = message => new ZspaceError('USAGE', message, { exitCode: 2 });
export const conflict = message => new ZspaceError('CONFLICT', message, { exitCode: 6 });
export const authError = message => new ZspaceError('AUTH_REQUIRED', message, { exitCode: 3 });
const sensitive = /^(?:.*(?:token|password|passwd|secret|cookie|authorization|private.?key|api.?key|credential)|pwd|passphrase|sign|key|device_id|deviceid)$/i;
export function redact(value, secrets = []) {
  if (typeof value === 'string') {
    let out = value;
    for (const secret of secrets.filter(s => typeof s === 'string' && s.length > 4).sort((a, b) => b.length - a.length)) {
      out = out.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
    }
    return out
      .replace(/((?:[\w.-]*(?:token|password|passwd|secret|cookie|authorization|api[_-]?key|credential)|sign|pwd)["']?\s*[=:]\s*)[^\r\n&;,}]+/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@');
  }
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sensitive.test(k) ? '[REDACTED]' : redact(v, secrets)]));
  return value;
}
