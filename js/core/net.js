// Address, hostname, CIDR, port and server_name checks.

const V4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const V4_RE = new RegExp(`^${V4_OCTET}(\\.${V4_OCTET}){3}$`);

export const isIPv4 = (s) => typeof s === 'string' && V4_RE.test(s);

/** IPv6 without brackets or zone id; accepts "::", compressed groups and a trailing dotted IPv4. */
export function isIPv6(s) {
  if (typeof s !== 'string' || s.length < 2 || s.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(s)) return false;
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const parse = (part) => (part === '' ? [] : part.split(':'));
  const groups = [...parse(halves[0]), ...(halves.length === 2 ? parse(halves[1]) : [])];
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (i === groups.length - 1 && g.includes('.')) {
      if (!isIPv4(g)) return false;
      count += 2;
    } else if (/^[0-9A-Fa-f]{1,4}$/.test(g)) {
      count += 1;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

/** "[2001:db8::1]" or "2001:db8::1" -> "2001:db8::1"; anything else unchanged. */
export const stripBrackets = (s) => (typeof s === 'string' && /^\[.*\]$/.test(s) ? s.slice(1, -1) : s);

export const isIP = (s) => isIPv4(s) || isIPv6(stripBrackets(s));

/** DNS hostname, single label allowed (internal names). Labels: letters, digits, hyphen. */
export function isHostname(s) {
  if (typeof s !== 'string' || !s || s.length > 253) return false;
  const labels = s.split('.');
  if (labels.some((l) => !/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l))) return false;
  // An all-numeric last label is a broken IPv4 address, not a hostname.
  return !/^\d+$/.test(labels[labels.length - 1]);
}

export function isCidr(s) {
  if (typeof s !== 'string') return false;
  const [addr, len, ...rest] = s.split('/');
  if (rest.length || len === undefined || !/^\d{1,3}$/.test(len)) return false;
  const n = Number(len);
  if (isIPv4(addr)) return n <= 32;
  if (isIPv6(addr)) return n <= 128;
  return false;
}

export const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

/** Address for allow/deny: "all", an IP, a CIDR range or "unix:". */
export const isAccessSource = (s) => s === 'all' || s === 'unix:' || isIP(s) || isCidr(s);

/**
 * Classifies a server_name entry. Returns 'catchall', 'exact', 'wildcard', 'regex', 'ip' or null if invalid.
 * Nginx wildcards: "*.example.com", "www.example.*" and ".example.com".
 */
export function serverNameKind(name) {
  if (typeof name !== 'string' || !name) return null;
  if (name === '_') return 'catchall';
  if (name.startsWith('~')) return name.length > 1 && !/\s/.test(name) ? 'regex' : null;
  if (isIP(name)) return 'ip';
  if (name.startsWith('*.')) return isHostname(name.slice(2)) ? 'wildcard' : null;
  if (name.startsWith('.')) return isHostname(name.slice(1)) ? 'wildcard' : null;
  if (name.endsWith('.*')) return isHostname(name.slice(0, -2)) ? 'wildcard' : null;
  return isHostname(name) ? 'exact' : null;
}

/** Backend address in an upstream or proxy_pass: IP, hostname or unix socket path. */
export function backendKind(address) {
  if (typeof address !== 'string' || !address) return null;
  if (address.startsWith('unix:')) return /^unix:\/[^\s;{}"'#]+$/.test(address) ? 'unix' : null;
  if (isIPv4(address)) return 'ipv4';
  if (isIPv6(stripBrackets(address))) return 'ipv6';
  if (isHostname(address)) return 'hostname';
  return null;
}

/** "192.0.2.10" -> "192.0.2.10", "2001:db8::1" -> "[2001:db8::1]". */
export const hostForUrl = (address) => (isIPv6(stripBrackets(address)) ? `[${stripBrackets(address)}]` : address);

function ipv4Int(s) {
  return s.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}

const DOC_V4_RANGES = [['192.0.2.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24]];

/** Documentation ranges (RFC 5737, RFC 3849) used for placeholders. */
export function isPlaceholderAddress(address) {
  const a = stripBrackets(String(address ?? '').split('/')[0]);
  if (isIPv4(a)) {
    const n = ipv4Int(a);
    return DOC_V4_RANGES.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      const start = ipv4Int(base);
      return n >= start && n < start + size;
    });
  }
  if (isIPv6(a)) return /^2001:0?db8(:|$)/i.test(a);
  return false;
}

/** Reserved example domains (RFC 2606 / RFC 6761). */
export function isPlaceholderDomain(name) {
  const n = String(name ?? '').toLowerCase().replace(/^\*\.|^\./, '').replace(/\.\*$/, '');
  return /(^|\.)example\.(com|net|org)$/.test(n) || /(^|\.)example$/.test(n) || /\.invalid$/.test(n);
}
