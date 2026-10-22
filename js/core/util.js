// Small helpers shared by the core modules. No DOM access here: everything in js/core runs in Node for tests.

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Short random id, used only inside the app (never written to YAML). */
export function uid(prefix = 'id') {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;
}

/** "Production Servers" -> "production-servers". */
export function slugify(text, fallback = 'nginx-config') {
  const slug = String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/g, '');
  return slug || fallback;
}

/** Trimmed string for any model value ('' for null/undefined). */
export const t = (v) => (v === null || v === undefined ? '' : String(v).trim());

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function getIn(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function setIn(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (UNSAFE_KEYS.has(String(path[i]))) throw new Error('Unsafe path');
    cur = cur[path[i]];
    if (cur === null || typeof cur !== 'object') throw new Error(`Missing path ${path.slice(0, i + 1).join('.')}`);
  }
  const last = path[path.length - 1];
  if (UNSAFE_KEYS.has(String(last))) throw new Error('Unsafe path');
  cur[last] = value;
}

export const pathKey = (path) => (Array.isArray(path) ? path.join('.') : String(path));

export function uniqueName(base, taken) {
  const set = new Set([...taken].map((s) => String(s).toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const name = `${base}-${i}`;
    if (!set.has(name.toLowerCase())) return name;
  }
}

/** Copy name for duplicates: "External" -> "External copy", "External copy" -> "External copy 2". */
export function copyName(base, taken) {
  const set = new Set([...taken].map((s) => String(s).toLowerCase()));
  const stem = String(base).replace(/ copy( \d+)?$/i, '');
  let name = `${stem} copy`;
  for (let i = 2; set.has(name.toLowerCase()); i++) name = `${stem} copy ${i}`;
  return name;
}

export async function sha256Hex(text) {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
