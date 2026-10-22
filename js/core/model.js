// Factories and helpers for projects, server configurations, server blocks, locations and upstream groups.
//
// Terms used throughout the app:
//   project               a named set of everything below (e.g. "Production Servers")
//   server configuration  one generated file with one or more server blocks (conf.d/external.conf)
//   server block          one "server { }" (virtual host) with its listeners and locations
//   upstream group        one "upstream name { }" with its backend servers, in its own file
//   generated file        output derived from the above; never edited directly

import { S, normalizeEntity } from './schema.js';
import { joinPath, normalizeDir } from './paths.js';
import { t, clone, uniqueName, copyName, slugify } from './util.js';

export const DEFAULT_CIPHERS = [
  'ECDHE-ECDSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384', 'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305', 'ECDHE-RSA-CHACHA20-POLY1305',
].join(':');

/** New project with the shared include files pre-filled from the reference configuration. */
export function newProject(name = 'New project', { description = '', environment = '' } = {}) {
  return normalizeEntity(S.project, {
    project: { name, description, environment },
    settings: {
      proxyParams: {
        hostHeader: '$host', realIp: true, forwardedFor: true, forwardedProto: true,
        httpVersion: '1.1', clearConnectionHeader: true, redirect: 'off',
      },
      sslParams: {
        protocols: ['TLSv1.2', 'TLSv1.3'], ciphers: DEFAULT_CIPHERS, preferServerCiphers: 'on',
        sessionCache: 'shared:SSL:20m', sessionTimeout: '10m', sessionTickets: 'off',
      },
      securityHeaders: {
        hideUpstreamHeaders: true, frameOptions: 'SAMEORIGIN', contentTypeOptions: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        hsts: true, hstsMaxAge: 31536000, hstsIncludeSubDomains: true,
        permissionsPolicy: 'geolocation=(), microphone=(), camera=()',
      },
    },
  });
}

/** Default settings, for "reset settings". */
export function defaultSettings() {
  return newProject().settings;
}

/** Relative output path of an upstream group or server configuration, honoring "disabled". */
export function entityFilePath(entity, settings) {
  const disabledDir = t(settings.disabledDirName) || 'disabled';
  return joinPath(normalizeDir(entity.outputDir), entity.enabled ? '' : disabledDir, t(entity.fileName));
}

/** All output paths currently claimed by entities (lower-cased), optionally ignoring one entity. */
export function takenPaths(project, ignore = null) {
  const out = new Set();
  for (const e of [...project.upstreams, ...project.servers]) {
    if (e !== ignore) out.add(entityFilePath(e, project.settings).toLowerCase());
  }
  return out;
}

function uniqueFileName(project, dir, stem, ignore = null) {
  const taken = takenPaths(project, ignore);
  const base = stem.replace(/[^A-Za-z0-9._+-]+/g, '-').replace(/^[-.]+/, '') || 'file';
  let name = `${base}.conf`;
  for (let i = 2; taken.has(joinPath(dir, name).toLowerCase()); i++) name = `${base}-${i}.conf`;
  return name;
}

/** File name suggested for an upstream, following the ext_<app>/int_<app> convention: "ext_billing" -> "billing.conf". */
export function suggestedUpstreamFile(name) {
  return `${t(name).replace(/^(ext|int)_/i, '') || 'upstream'}.conf`;
}

export function newUpstreamServer(values = {}) {
  return normalizeEntity(S.upstreamServer, values);
}

export function newUpstream(project, { name = 'backend', category = '', outputDir } = {}) {
  const finalName = uniqueName(name, project.upstreams.map((u) => u.name));
  const dir = outputDir !== undefined ? outputDir : joinPath(project.settings.upstreamDir, category);
  return normalizeEntity(S.upstream, {
    name: finalName,
    category,
    environment: project.project.environment,
    outputDir: dir,
    fileName: uniqueFileName(project, dir, suggestedUpstreamFile(finalName).replace(/\.conf$/, '')),
    keepalive: 32,
    servers: [{}],
  });
}

export function newListen(values = {}) {
  return normalizeEntity(S.listen, values);
}

export function newServerBlock(values = {}) {
  return normalizeEntity(S.block, {
    listen: [{ port: 80 }],
    serverNames: ['_'],
    tls: { includeParams: true },
    redirectHttp: { port: 80, code: 301 },
    ...values,
  });
}

export function newServerConfig(project, { name = 'New server', category = '' } = {}) {
  const finalName = uniqueName(name, project.servers.map((s) => s.name));
  const dir = normalizeDir(project.settings.serverDir);
  return normalizeEntity(S.serverConfig, {
    name: finalName,
    category,
    environment: project.project.environment,
    outputDir: dir,
    fileName: uniqueFileName(project, dir, slugify(finalName, 'server')),
    blocks: [newServerBlock()],
  });
}

const LOCATION_DEFAULTS = {
  proxy: () => ({ path: '/', type: 'proxy', proxyPass: { target: 'upstream', scheme: 'http' }, proxy: { includeParams: true } }),
  return: () => ({ path: '/', match: 'exact', type: 'return', return: { code: 301, value: 'https://$host$request_uri' } }),
  static: () => ({ path: '/static/', type: 'static', static: { root: '/usr/share/nginx/html', index: 'index.html', tryFiles: '$uri $uri/ =404' } }),
  health: () => ({ path: '/healthz', match: 'exact', type: 'health', health: { text: 'ok' } }),
  status: () => ({
    path: '/nginx_status', match: 'exact', type: 'status',
    access: { rules: [{ action: 'allow', source: '127.0.0.1' }, { action: 'deny', source: 'all' }] },
  }),
  custom: () => ({ path: '/', type: 'custom' }),
};

export function newLocation(type = 'proxy', { upstream = '' } = {}) {
  const values = LOCATION_DEFAULTS[type] ? LOCATION_DEFAULTS[type]() : LOCATION_DEFAULTS.proxy();
  if (type === 'proxy' && upstream) values.proxyPass.upstream = upstream;
  return normalizeEntity(S.location, values);
}

/** Switches a location's type, filling in defaults for sections that are still empty. */
export function changeLocationType(loc, type) {
  const defaults = newLocation(type);
  loc.type = type;
  if (type === 'return' && loc.return.code === null) loc.return = defaults.return;
  if (type === 'static' && !t(loc.static.root) && !t(loc.static.alias)) loc.static = defaults.static;
  if (type === 'health' && !t(loc.health.text)) loc.health = defaults.health;
  if (type === 'status' && loc.access.rules.length === 0) loc.access = defaults.access;
  if (type === 'proxy' && !loc.proxy.includeParams && !t(loc.proxyPass.upstream) && !t(loc.proxyPass.address)) loc.proxy.includeParams = true;
  return loc;
}

/** Name used for per-location log files and comments: "/billing/" -> "billing". */
export function locationLogName(loc, index = 0) {
  if (t(loc.name)) return t(loc.name);
  if (loc.match === 'regex' || loc.match === 'regex_ci') return `location-${index + 1}`;
  const s = t(loc.path).replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+/, '');
  return s || 'root';
}

export const MATCH_LABELS = { prefix: 'prefix', exact: '= exact', prefix_no_regex: '^~ prefix (stops regex search)', regex: '~ regex', regex_ci: '~* regex, case-insensitive' };
export const MATCH_PREFIX = { prefix: '', exact: '=', prefix_no_regex: '^~', regex: '~', regex_ci: '~*' };

/** "location = /healthz" style label. */
export function locationLabel(loc) {
  const m = MATCH_PREFIX[loc.match];
  return `${m ? `${m} ` : ''}${t(loc.path) || '(no path)'}`;
}

/** Every location that proxies to the upstream with this name. */
export function upstreamReferences(project, name) {
  const refs = [];
  const n = t(name).toLowerCase();
  if (!n) return refs;
  project.servers.forEach((cfg, ci) => cfg.blocks.forEach((blk, bi) => blk.locations.forEach((loc, li) => {
    if ((loc.type === 'proxy') && loc.proxyPass.target === 'upstream' && t(loc.proxyPass.upstream).toLowerCase() === n) {
      refs.push({ ci, bi, li, cfg, blk, loc });
    }
  })));
  return refs;
}

/** Renames an upstream and updates every location that refers to it. Returns the number of updated locations. */
export function renameUpstream(project, upstream, newName) {
  const refs = upstreamReferences(project, upstream.name);
  const oldSuggestion = suggestedUpstreamFile(upstream.name);
  upstream.name = newName;
  for (const r of refs) r.loc.proxyPass.upstream = newName;
  if (upstream.fileName === oldSuggestion && t(newName)) {
    upstream.fileName = uniqueFileName(project, normalizeDir(upstream.outputDir), suggestedUpstreamFile(newName).replace(/\.conf$/, ''), upstream);
  }
  return refs.length;
}

export function duplicateUpstream(project, index) {
  const src = project.upstreams[index];
  const copy = normalizeEntity(S.upstream, clone(src));
  copy.name = uniqueName(`${t(src.name) || 'backend'}_copy`, project.upstreams.map((u) => u.name));
  copy.fileName = uniqueFileName(project, normalizeDir(copy.outputDir), t(src.fileName).replace(/\.conf$/i, '') || 'upstream');
  project.upstreams.splice(index + 1, 0, copy);
  return copy;
}

export function duplicateServerConfig(project, index) {
  const src = project.servers[index];
  const copy = normalizeEntity(S.serverConfig, clone(src));
  copy.name = copyName(src.name || 'Server', project.servers.map((s) => s.name));
  copy.fileName = uniqueFileName(project, normalizeDir(copy.outputDir), `${t(src.fileName).replace(/\.conf$/i, '') || 'server'}-copy`);
  project.servers.splice(index + 1, 0, copy);
  return copy;
}

export function duplicateBlock(cfg, index) {
  const copy = normalizeEntity(S.block, clone(cfg.blocks[index]));
  if (t(copy.label)) copy.label = `${copy.label} (copy)`;
  cfg.blocks.splice(index + 1, 0, copy);
  return copy;
}

export function duplicateLocation(blk, index) {
  const copy = normalizeEntity(S.location, clone(blk.locations[index]));
  const p = t(copy.path);
  if (copy.match !== 'regex' && copy.match !== 'regex_ci' && p) {
    const taken = new Set(blk.locations.map((l) => t(l.path)));
    const slash = p.endsWith('/');
    const stem = p === '/' ? '/copy' : `${slash ? p.slice(0, -1) : p}-copy`;
    const end = slash ? '/' : '';
    let next = `${stem}${end}`;
    for (let i = 2; taken.has(next); i++) next = `${stem}-${i}${end}`;
    copy.path = next;
  }
  if (t(copy.name)) copy.name = `${copy.name}-copy`;
  blk.locations.splice(index + 1, 0, copy);
  return copy;
}

/** Moves an item in an array; returns the new index. */
export function moveItem(list, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= list.length) return index;
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item);
  return to;
}

/** Empties a project (servers, upstreams, zones) and restores default settings, keeping its name. */
export function resetProject(project) {
  const fresh = newProject(project.project.name, { description: project.project.description, environment: project.project.environment });
  Object.assign(project, fresh);
  return project;
}

export function countLocations(project) {
  return project.servers.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.locations.length, 0), 0);
}
