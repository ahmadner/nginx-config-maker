// Value formats used by Nginx directives.

/** Nginx time: "600s", "1h30m", "500ms" or a bare number of seconds. */
export const isTime = (s) => typeof s === 'string' && (/^(\d+(ms|s|m|h|d|w|M|y))+$/.test(s) || /^\d+$/.test(s));

/** Nginx size: "100M", "16k", "0". */
export const isSize = (s) => typeof s === 'string' && /^\d+[kKmMgG]?$/.test(s);

/** limit_req_zone rate: "10r/s" or "300r/m". */
export const isRate = (s) => typeof s === 'string' && /^\d+r\/[sm]$/.test(s);

/** proxy_buffers: "8 32k". */
export const isBuffers = (s) => typeof s === 'string' && /^\d+\s+\d+[kKmM]?$/.test(s);

/** HTTP header field name (RFC 9110 token, restricted to the common characters). */
export const isHeaderName = (s) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s) && s.length <= 100;

/** Identifier for upstream names, zone names, log formats. */
export const isIdentifier = (s) => typeof s === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(s) && s.length <= 128;

export const isLogFormatName = (s) => typeof s === 'string' && /^[A-Za-z0-9_]+$/.test(s);

/** Single line with no control characters (tabs allowed). */
// eslint-disable-next-line no-control-regex
export const isSingleLine = (s) => typeof s === 'string' && !/[\x00-\x08\x0a-\x1f\x7f]/.test(s);

/** A value that becomes one unquoted Nginx token: no whitespace, quotes or syntax characters. */
export const isPlainToken = (s) => typeof s === 'string' && s.length > 0 && !/[\s;{}"'#\\]/.test(s);

/** Time in seconds for comparisons; null when not parseable. */
export function timeSeconds(s) {
  if (!isTime(s)) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const unit = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000, y: 31536000 };
  let total = 0;
  for (const [, n, u] of s.matchAll(/(\d+)(ms|s|m|h|d|w|M|y)/g)) total += Number(n) * unit[u];
  return total;
}

export const LOG_LEVELS = ['debug', 'info', 'notice', 'warn', 'error', 'crit', 'alert', 'emerg'];

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'MKCOL', 'COPY', 'MOVE',
  'PROPFIND', 'PROPPATCH', 'LOCK', 'UNLOCK'];

export const RETURN_CODES = [200, 204, 301, 302, 303, 307, 308, 400, 401, 403, 404, 405, 410, 429, 444, 500, 502, 503, 504];

export const REFERRER_POLICIES = ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'];

export const TLS_PROTOCOLS = ['TLSv1.2', 'TLSv1.3'];
export const INSECURE_TLS = ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1'];
