// Project data model and YAML schema (version 1).
//
// The schema below is the single definition of every field: it fills defaults, checks the types of
// imported YAML, and produces the compact form that is written back to YAML. Semantic checks (ports in
// range, valid addresses, conflicts) live in validate.js so the UI can show them inline.

import { isPlainObject, uid } from './util.js';
import { LOG_LEVELS } from './formats.js';

export const SCHEMA_VERSION = 1;

// ---------- Field descriptors ----------
const str = (def = '') => ({ k: 'str', def });
const text = () => ({ k: 'str', def: '', multiline: true });
const int = (def = null) => ({ k: 'int', def });
const bool = (def = false) => ({ k: 'bool', def });
const oneOf = (values, def = values[0]) => ({ k: 'enum', values, def });
const list = (item, def = []) => ({ k: 'list', item, def, max: 1000 });
const obj = (fields, opts = {}) => ({ k: 'obj', fields, ...opts });
const omit = (fields, keys) => Object.fromEntries(Object.entries(fields).filter(([k]) => !keys.includes(k)));

const onOff = () => oneOf(['', 'on', 'off'], '');

const REQUEST_HEADER = obj({ name: str(), value: str() });
const RESPONSE_HEADER = obj({ name: str(), value: str(), always: bool() });

const LOGGING_FIELDS = {
  accessLog: str(),
  accessLogFormat: str(),
  accessLogOff: bool(),
  errorLog: str(),
  errorLogLevel: oneOf(['', ...LOG_LEVELS], ''),
};

const PROXY_FIELDS = {
  includeParams: bool(),
  httpVersion: oneOf(['', '1.0', '1.1'], ''),
  clearConnectionHeader: bool(),
  hostHeader: str(),
  realIp: bool(),
  forwardedFor: bool(),
  forwardedProto: bool(),
  requestHeaders: list(REQUEST_HEADER),
  connectTimeout: str(),
  sendTimeout: str(),
  readTimeout: str(),
  buffering: onOff(),
  requestBuffering: onOff(),
  bufferSize: str(),
  buffers: str(),
  busyBuffersSize: str(),
  redirect: oneOf(['', 'off', 'default'], ''),
  hideHeaders: list(str()),
  websocket: bool(),
  sslServerName: bool(),
};

const ACCESS = obj({
  rules: list(obj({ action: oneOf(['allow', 'deny']), source: str() })),
  basicAuthRealm: str(),
  basicAuthUserFile: str(),
});

const RATE_LIMIT = obj({ zone: str(), burst: int(), nodelay: bool(), status: int() });

export const LOCATION_TYPES = ['proxy', 'return', 'static', 'health', 'status', 'custom'];
export const LOCATION_MATCHES = ['prefix', 'exact', 'prefix_no_regex', 'regex', 'regex_ci'];
export const LB_METHODS = ['round_robin', 'least_conn', 'ip_hash', 'hash', 'random'];

export const S = {};

S.upstreamServer = obj({
  address: str(),
  port: int(),
  weight: int(),
  maxFails: int(),
  failTimeout: str(),
  maxConns: int(),
  backup: bool(),
  down: bool(),
  enabled: bool(true),
  comment: str(),
}, { id: 'srv' });

S.upstream = obj({
  name: str(),
  description: str(),
  environment: str(),
  category: str(),
  enabled: bool(true),
  outputDir: str(),
  fileName: str(),
  method: oneOf(LB_METHODS),
  hashKey: str(),
  hashConsistent: bool(),
  randomTwo: bool(),
  zoneSize: str(),
  keepalive: int(),
  keepaliveRequests: int(),
  keepaliveTime: str(),
  keepaliveTimeout: str(),
  servers: list(S.upstreamServer),
  customDirectives: text(),
}, { id: 'up' });

S.listen = obj({ address: str(), port: int(), ssl: bool(), defaultServer: bool() }, { id: 'ln' });

S.location = obj({
  name: str(),
  group: str(),
  match: oneOf(LOCATION_MATCHES),
  path: str(),
  type: oneOf(LOCATION_TYPES),
  internal: bool(),
  proxyPass: obj({
    target: oneOf(['upstream', 'direct']),
    upstream: str(),
    scheme: oneOf(['http', 'https']),
    address: str(),
    port: int(),
    uri: str(),
  }),
  return: obj({ code: int(), value: str() }),
  static: obj({ root: str(), alias: str(), index: str(), tryFiles: str() }),
  health: obj({ text: str('ok') }),
  methods: list(str()),
  clientMaxBodySize: str(),
  sendTimeout: str(),
  logging: obj(LOGGING_FIELDS),
  proxy: obj(PROXY_FIELDS),
  responseHeaders: list(RESPONSE_HEADER),
  access: ACCESS,
  rateLimit: RATE_LIMIT,
  customDirectives: text(),
}, {
  id: 'loc',
  // Sections that only apply to some location types. The others are left out of the YAML.
  typeSections: {
    proxy: ['proxyPass', 'proxy'],
    return: ['return'],
    static: ['static'],
    health: ['health'],
    status: [],
    custom: ['proxy'],
  },
});

S.block = obj({
  label: str(),
  listen: list(S.listen),
  serverNames: list(str()),
  http2: bool(),
  tls: obj({ certificate: str(), certificateKey: str(), includeParams: bool() }),
  redirectHttp: obj({ enabled: bool(), port: int(), code: int() }),
  securityHeaders: bool(),
  clientMaxBodySize: str(),
  sendTimeout: str(),
  logging: obj({ ...LOGGING_FIELDS, perLocation: bool() }),
  proxy: obj(PROXY_FIELDS),
  responseHeaders: list(RESPONSE_HEADER),
  access: ACCESS,
  rateLimit: RATE_LIMIT,
  errorPages: list(obj({ codes: list(int()), target: str() })),
  customDirectives: text(),
  locations: list(S.location),
}, { id: 'blk' });

S.serverConfig = obj({
  name: str(),
  description: str(),
  environment: str(),
  category: str(),
  enabled: bool(true),
  outputDir: str(),
  fileName: str(),
  httpDirectives: text(),
  blocks: list(S.block),
}, { id: 'cfg' });

S.rateZone = obj({ name: str(), key: str('$binary_remote_addr'), size: str('10m'), rate: str('10r/s') });

S.proxyParams = obj({ path: str('proxy_params.conf'), ...omit(PROXY_FIELDS, ['includeParams', 'websocket']), customDirectives: text() });

S.sslParams = obj({
  path: str('ssl_params.conf'),
  protocols: list(str()),
  ciphers: str(),
  preferServerCiphers: onOff(),
  sessionCache: str(),
  sessionTimeout: str(),
  sessionTickets: onOff(),
  stapling: bool(),
  staplingVerify: bool(),
  resolver: str(),
  resolverTimeout: str(),
  customDirectives: text(),
});

S.securityHeaders = obj({
  path: str('security_headers.conf'),
  hideUpstreamHeaders: bool(),
  frameOptions: oneOf(['', 'SAMEORIGIN', 'DENY'], ''),
  contentTypeOptions: bool(),
  referrerPolicy: str(),
  hsts: bool(),
  hstsMaxAge: int(),
  hstsIncludeSubDomains: bool(),
  hstsPreload: bool(),
  permissionsPolicy: str(),
  contentSecurityPolicy: str(),
  xssProtection: bool(),
  customDirectives: text(),
});

export const NGINX_VERSIONS = ['1.24-or-older', '1.25-or-newer'];

S.settings = obj({
  nginxRoot: str('/etc/nginx'),
  httpIncludes: list(str(), ['upstreams.conf', 'conf.d/*.conf']),
  nginxVersion: oneOf(NGINX_VERSIONS),
  serverDir: str('conf.d'),
  upstreamDir: str('upstreams'),
  disabledDirName: str('disabled'),
  upstreamIndex: obj({ enabled: bool(true), path: str('upstreams.conf'), style: oneOf(['directories', 'files']) }),
  sharedHttpPath: str('conf.d/00-shared.conf'),
  logRoot: str('/var/log/nginx'),
  logFormat: str('main'),
  proxyParams: S.proxyParams,
  sslParams: S.sslParams,
  securityHeaders: S.securityHeaders,
  format: obj({ indent: int(4), alignValues: bool(true), headerComments: bool(true) }),
  package: obj({
    rootFolder: str('nginx-config'),
    includeDisabled: bool(true),
    includeProjectFile: bool(true),
    projectFileName: str(),
    zipFileName: str(),
  }),
});

S.project = obj({
  project: obj({ name: str(), description: str(), environment: str() }),
  settings: S.settings,
  rateLimitZones: list(S.rateZone),
  upstreams: list(S.upstream),
  servers: list(S.serverConfig),
});

// ---------- Normalization (defaults + type checks) ----------
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ID_RE = /^[a-z]+_[a-z0-9]{4,16}$/;
const MAX_NODES = 200000;
const MAX_DEPTH = 40;
const MAX_LINE = 4000;
const MAX_TEXT = 100000;

const fmtPath = (path) => path.reduce((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : p), '');
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const MAX_ERRORS = 50;

function fail(ctx, path, message) {
  if (ctx.errors.length < MAX_ERRORS) ctx.errors.push({ path: fmtPath(path), message });
  else if (ctx.errors.length === MAX_ERRORS) ctx.errors.push({ path: '', message: 'More problems were found; fix the ones above first.' });
}

function normalizeNode(desc, raw, path, ctx) {
  if (++ctx.nodes > MAX_NODES) {
    if (!ctx.tooBig) fail(ctx, path, `The file is too large or uses too many repeated references (over ${MAX_NODES} values).`);
    ctx.tooBig = true;
    return defaultOf(desc, ctx);
  }
  if (path.length > MAX_DEPTH) {
    fail(ctx, path, 'is nested too deeply');
    return defaultOf(desc, ctx);
  }
  const missing = raw === undefined || raw === null;
  switch (desc.k) {
    case 'str': {
      if (missing) return desc.def;
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
      if (typeof raw !== 'string') { fail(ctx, path, 'expected text'); return desc.def; }
      if (desc.multiline) {
        if (raw.length > MAX_TEXT) { fail(ctx, path, `is longer than ${MAX_TEXT} characters`); return desc.def; }
        return raw.replace(/\r\n?/g, '\n');
      }
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x08\x0a-\x1f\x7f]/.test(raw)) { fail(ctx, path, 'must be a single line of text'); return desc.def; }
      if (raw.length > MAX_LINE) { fail(ctx, path, `is longer than ${MAX_LINE} characters`); return desc.def; }
      return raw.trim();
    }
    case 'int': {
      if (missing || raw === '') return desc.def;
      let n = raw;
      if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) n = Number(raw);
      if (typeof n !== 'number' || !Number.isInteger(n)) { fail(ctx, path, `expected a whole number, got ${JSON.stringify(raw)}`); return desc.def; }
      if (Math.abs(n) > 1e12) { fail(ctx, path, 'number is too large'); return desc.def; }
      return n;
    }
    case 'bool': {
      if (missing) return desc.def;
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      fail(ctx, path, `expected true or false, got ${JSON.stringify(raw)}`);
      return desc.def;
    }
    case 'enum': {
      if (missing) return desc.def;
      if (desc.values.includes(raw)) return raw;
      if (typeof raw === 'number') {
        for (const candidate of [String(raw), raw.toFixed(1)]) if (desc.values.includes(candidate)) return candidate;
      }
      fail(ctx, path, `must be one of ${desc.values.filter(Boolean).map((v) => JSON.stringify(v)).join(', ')}${desc.values.includes('') ? ' or empty' : ''}; got ${JSON.stringify(raw)}`);
      return desc.def;
    }
    case 'list': {
      if (missing) return desc.def.map((v) => normalizeNode(desc.item, v, path, ctx));
      let items = raw;
      if (!Array.isArray(raw)) {
        if (desc.item.k === 'str' && typeof raw === 'string') items = [raw];
        else { fail(ctx, path, 'expected a list'); return defaultOf(desc, ctx); }
      }
      if (items.length > desc.max) { fail(ctx, path, `has more than ${desc.max} items`); return defaultOf(desc, ctx); }
      return items.map((item, i) => normalizeNode(desc.item, item, [...path, i], ctx));
    }
    case 'obj': {
      if (!missing && !isPlainObject(raw)) { fail(ctx, path, 'expected a mapping (key: value pairs)'); return defaultOf(desc, ctx); }
      const src = missing ? {} : raw;
      const out = {};
      if (desc.id) {
        const id = hasOwn(src, 'id') ? src.id : undefined;
        out.id = ctx.keepIds && typeof id === 'string' && ID_RE.test(id) && !ctx.ids.has(id) ? id : uid(desc.id);
        ctx.ids.add(out.id);
      }
      for (const key of Object.keys(src)) {
        if (UNSAFE_KEYS.has(key)) { fail(ctx, [...path, key], 'is not an allowed key'); continue; }
        if (key === 'id' && desc.id) continue;
        if (!hasOwn(desc.fields, key) && !ctx.skipUnknown.has(fmtPath([...path, key]))) {
          ctx.warnings.push({ path: fmtPath([...path, key]), message: 'unknown field, ignored' });
        }
      }
      for (const [key, fd] of Object.entries(desc.fields)) {
        out[key] = normalizeNode(fd, hasOwn(src, key) ? src[key] : undefined, [...path, key], ctx);
      }
      return out;
    }
    default:
      throw new Error(`Unknown descriptor ${desc.k}`);
  }
}

function defaultOf(desc, ctx) {
  return normalizeNode(desc, undefined, ['(default)'], { ...ctx, errors: [], warnings: [], nodes: 0 });
}

function newCtx(keepIds) {
  return { errors: [], warnings: [], nodes: 0, keepIds, ids: new Set(), skipUnknown: new Set() };
}

/** Normalizes one entity (e.g. S.upstream) with fresh ids. Used by factories and duplication. */
export function normalizeEntity(desc, raw = {}, { keepIds = false } = {}) {
  const ctx = newCtx(keepIds);
  const value = normalizeNode(desc, raw, [], ctx);
  if (ctx.errors.length) throw new Error(`Invalid ${ctx.errors[0].path}: ${ctx.errors[0].message}`);
  return value;
}

/**
 * Checks and normalizes a parsed project document (from YAML or browser storage).
 * Returns { project, errors, warnings }; the project is only usable when errors is empty.
 */
export function normalizeProject(raw, { keepIds = false } = {}) {
  const ctx = newCtx(keepIds);
  if (!isPlainObject(raw)) {
    return { project: null, errors: [{ path: '', message: 'The file must contain a YAML mapping at the top level (schemaVersion, project, servers, upstreams…).' }], warnings: [] };
  }
  const version = raw.schemaVersion;
  if (version === undefined) {
    return { project: null, errors: [{ path: 'schemaVersion', message: 'is missing. Project files exported by this app start with "schemaVersion: 1".' }], warnings: [] };
  }
  if (!Number.isInteger(version)) {
    return { project: null, errors: [{ path: 'schemaVersion', message: `must be a whole number, got ${JSON.stringify(version)}` }], warnings: [] };
  }
  if (version > SCHEMA_VERSION) {
    return { project: null, errors: [{ path: 'schemaVersion', message: `is ${version}, but this app supports schema version ${SCHEMA_VERSION}. The file was created by a newer version; update the app to import it.` }], warnings: [] };
  }
  if (version < 1) {
    return { project: null, errors: [{ path: 'schemaVersion', message: `${version} is not a supported schema version.` }], warnings: [] };
  }
  const migrated = migrate(raw, version);
  ctx.skipUnknown.add('schemaVersion');
  const project = normalizeNode(S.project, migrated, [], ctx);
  if (!project.project.name) ctx.errors.push({ path: 'project.name', message: 'is required' });
  return { project: ctx.errors.length ? null : project, errors: ctx.errors, warnings: ctx.warnings };
}

/** Upgrades older schema versions in place. Version 1 is the first version, so there is nothing to do yet. */
function migrate(raw /* , fromVersion */) {
  return raw;
}

// ---------- Compact form for YAML ----------
const isEmpty = (desc, v) => {
  switch (desc.k) {
    case 'str': case 'enum': return v === '';
    case 'int': return v === null;
    case 'bool': return v === false;
    case 'list': return Array.isArray(v) && v.length === 0;
    default: return false;
  }
};

function compactNode(desc, value) {
  switch (desc.k) {
    case 'obj': {
      const out = {};
      let dropped = null;
      if (desc.typeSections && value) {
        const keep = desc.typeSections[value.type] || [];
        dropped = new Set(Object.values(desc.typeSections).flat().filter((s) => !keep.includes(s)));
      }
      for (const [key, fd] of Object.entries(desc.fields)) {
        if (dropped && dropped.has(key)) continue;
        const c = compactNode(fd, value ? value[key] : undefined);
        if (c !== undefined) out[key] = c;
      }
      return Object.keys(out).length ? out : undefined;
    }
    case 'list': {
      const arr = Array.isArray(value) ? value : [];
      if (!arr.length) return isEmpty(desc, desc.def) ? undefined : [];
      return arr.map((item) => {
        const c = compactNode(desc.item, item);
        if (c !== undefined) return c;
        return desc.item.k === 'obj' ? {} : desc.item.k === 'int' ? null : desc.item.k === 'bool' ? false : '';
      });
    }
    default: {
      const v = value === undefined ? desc.def : value;
      return isEmpty(desc, v) && isEmpty(desc, desc.def) ? undefined : v;
    }
  }
}

/** Project as a plain object for YAML: schemaVersion first, ids removed, empty optional values left out. */
export function compactProject(project) {
  const body = compactNode(S.project, project) || {};
  return { schemaVersion: SCHEMA_VERSION, ...body };
}

/** Removes internal ids (for comparing projects logically). */
export function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'id') out[k] = stripIds(v);
    return out;
  }
  return value;
}
