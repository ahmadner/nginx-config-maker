// Package paths (relative, inside the ZIP) and target paths (absolute, on the Nginx server).

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Letters, digits and ._+- only, starting with a letter, digit or underscore. Safe in a shell command
// unquoted, on every file system, and in an Nginx include without quotes.
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;

/** Returns an error message for one path segment, or null. */
export function segmentError(seg) {
  if (seg === '') return 'empty folder name (double or trailing slash)';
  if (seg === '.' || seg === '..') return `"${seg}" is not allowed (no relative jumps)`;
  if (seg.length > 100) return `"${seg.slice(0, 20)}…" is longer than 100 characters`;
  if (WINDOWS_RESERVED.test(seg)) return `"${seg}" is a reserved name on Windows`;
  if (/\s/.test(seg)) return `"${seg}" contains a space`;
  if (!SEGMENT_RE.test(seg)) return `"${seg}" may only use letters, digits and . _ + - (and must not start with . or -)`;
  if (/\.$/.test(seg)) return `"${seg}" ends with a dot`;
  return null;
}

/** Removes "./" prefixes and surrounding or trailing slashes that users commonly type. */
export function normalizeDir(dir) {
  return String(dir ?? '').trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

/** Error for a relative directory inside the package ('' means the package root), or null. */
export function dirError(dir) {
  const d = String(dir ?? '').trim();
  if (d === '' || d === '.') return null;
  if (d.includes('\\')) return 'use forward slashes (/), not backslashes';
  if (/^[A-Za-z]:/.test(d)) return 'must be a relative path, not a drive path';
  if (d.startsWith('/')) return 'must be relative to the Nginx directory (no leading /)';
  const parts = normalizeDir(d).split('/');
  for (const part of parts) {
    const err = segmentError(part);
    if (err) return err;
  }
  if (parts.length > 12) return 'is nested too deeply (more than 12 folders)';
  return null;
}

export function fileNameError(name, ext = '.conf') {
  const n = String(name ?? '').trim();
  if (!n) return 'file name is required';
  if (n.includes('/') || n.includes('\\')) return 'file name must not contain slashes; set the folder separately';
  const err = segmentError(n);
  if (err) return err;
  if (ext && !n.toLowerCase().endsWith(ext)) return `file name must end with ${ext}`;
  if (ext && n.length === ext.length) return `file name needs a name before ${ext}`;
  return null;
}

/** Full relative path error check (folders + file name). */
export function relativePathError(path, ext = '.conf') {
  const p = String(path ?? '').trim();
  if (!p) return 'path is required';
  if (p.includes('\\')) return 'use forward slashes (/), not backslashes';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'must be a relative path (no leading / or drive letter)';
  const parts = p.split('/');
  const file = parts.pop();
  const dErr = parts.length ? dirError(parts.join('/')) : null;
  if (dErr) return dErr;
  if (parts.some((s) => s === '')) return 'empty folder name (double slash)';
  return fileNameError(file, ext);
}

export function joinPath(...parts) {
  const joined = parts
    .map((p) => String(p ?? '').trim())
    .filter((p) => p !== '' && p !== '.')
    .join('/')
    .replace(/\/{2,}/g, '/');
  return joined;
}

/** Joins a target directory (absolute) with a relative path: ("/etc/nginx", "conf.d/a.conf"). */
export function targetPath(root, rel) {
  const r = String(root ?? '').trim().replace(/\/+$/, '');
  return `${r}/${String(rel).replace(/^\/+/, '')}`;
}

export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

/**
 * Absolute path on the target server (certificate, log, password file).
 * Returns an error message or null. Spaces, quotes and Nginx syntax characters are rejected.
 */
export function absPathError(p) {
  const s = String(p ?? '').trim();
  if (!s) return 'path is required';
  if (/-----BEGIN/.test(s)) return 'looks like file contents; enter the path to the file on the server instead';
  if (/^data:/i.test(s)) return 'inline data: values are not allowed; enter a file path on the server';
  if (s.includes('\\') || /^[A-Za-z]:/.test(s)) return 'must be a Linux path such as /etc/nginx/ssl/site/fullchain.pem';
  if (!s.startsWith('/')) return 'must be an absolute path starting with /';
  if (/[\s;{}"'#$`]/.test(s)) return 'must not contain spaces, quotes, $, #, ; or braces';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return 'contains control characters';
  if (s.split('/').includes('..')) return 'must not contain ".." segments';
  return null;
}

/**
 * Converts an Nginx include glob (glob(3): *, ? and [...] within one path segment) to a RegExp.
 */
export function globToRegExp(pattern) {
  let re = '';
  const p = String(pattern);
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else {
        let cls = p.slice(i + 1, end);
        if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
        re += `[${cls.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Normalizes an include pattern to a path relative to the Nginx directory.
 * "/etc/nginx/conf.d/*.conf" with root "/etc/nginx" -> "conf.d/*.conf". Patterns outside the root stay absolute.
 */
export function relativeInclude(pattern, root) {
  const p = String(pattern ?? '').trim();
  const r = String(root ?? '').trim().replace(/\/+$/, '');
  if (r && p.startsWith(`${r}/`)) return p.slice(r.length + 1);
  return p;
}

export function includePatternError(pattern) {
  const p = String(pattern ?? '').trim();
  if (!p) return 'pattern is empty';
  if (/[\s;{}"']/.test(p)) return 'must not contain spaces, quotes, ; or braces';
  if (p.includes('\\')) return 'use forward slashes';
  if (p.split('/').includes('..')) return 'must not contain ".."';
  if (p.includes('**')) return 'Nginx does not support ** (recursive) globs';
  return null;
}
