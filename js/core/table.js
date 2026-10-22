// Endpoint routing table: every location with its upstream, backend hosts and ports, file and status.
// Used for the PNG image, the CSV/TSV exports and routing-table.csv in the package.
//
// Layouts:
//   matrix  one column per backend host, the port in each cell (compact when hosts are shared)
//   list    one "Backend servers" column with host:port entries (for many hosts)
//   auto    matrix up to MATRIX_MAX_HOSTS hosts, list beyond that

import { entityFilePath, locationLabel } from './model.js';
import { backendKind, isIPv4, isIPv6, stripBrackets } from './net.js';
import { t } from './util.js';

export const MATRIX_MAX_HOSTS = 8;

const METHOD_LABEL = { least_conn: 'least_conn', ip_hash: 'ip_hash', hash: 'hash', random: 'random' };
const MATCH_NAME = { prefix: 'prefix', exact: 'exact', prefix_no_regex: 'prefix (^~)', regex: 'regex', regex_ci: 'regex (case-insensitive)' };
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isUnder = (path, src) => path === src || path.startsWith(`${src}.`);

/** Display name of a backend host: bare IPv6, unix socket path, IPv4 or hostname. */
const hostName = (address) => stripBrackets(t(address));

/** Sort order: IPv4 numerically, then IPv6, hostnames, unix sockets. */
export function compareHosts(a, b) {
  const rank = (h) => (isIPv4(h) ? 0 : isIPv6(h) ? 1 : h.startsWith('unix:') ? 3 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  }
  return a.localeCompare(b);
}

/** Flags of one upstream server: off (commented out), backup, down, weight. */
function serverFlags(sv) {
  const flags = [];
  if (!sv.enabled) flags.push('off');
  if (sv.backup) flags.push('backup');
  if (sv.down) flags.push('down');
  if (sv.weight !== null && sv.weight !== 1) flags.push(`w${sv.weight}`);
  return flags;
}

function targetText(loc) {
  switch (loc.type) {
    case 'return': {
      const code = loc.return.code;
      const v = t(loc.return.value);
      return [301, 302, 303, 307, 308].includes(code) ? `redirect ${code} → ${v}` : `return ${code ?? ''}${v ? ` "${v}"` : ''}`.trim();
    }
    case 'static': return t(loc.static.alias) ? `static files (alias ${t(loc.static.alias)})` : `static files (root ${t(loc.static.root)})`;
    case 'health': return `health check (200 "${t(loc.health.text) || 'ok'}")`;
    case 'status': return 'status page (stub_status)';
    case 'custom': return 'custom directives';
    default: return '';
  }
}

function locationNotes(loc) {
  const notes = [];
  const px = loc.proxy;
  if (loc.type === 'proxy' || loc.type === 'custom') {
    if (t(px.readTimeout)) notes.push(`read ${t(px.readTimeout)}`);
    if (t(px.connectTimeout)) notes.push(`connect ${t(px.connectTimeout)}`);
    if (t(px.sendTimeout)) notes.push(`send ${t(px.sendTimeout)}`);
    if (px.websocket) notes.push('WebSocket');
    if (px.buffering === 'off') notes.push('no buffering');
  }
  if (t(loc.clientMaxBodySize)) notes.push(`body ${t(loc.clientMaxBodySize)}`);
  const methods = loc.methods.map(t).filter(Boolean);
  if (methods.length && ['proxy', 'static', 'custom'].includes(loc.type)) notes.push(`only ${methods.join('/')}`);
  const rules = loc.access.rules.filter((r) => t(r.source));
  if (rules.length) {
    const last = rules[rules.length - 1];
    notes.push(last.action === 'deny' && t(last.source) === 'all' ? `IP allowlist (${rules.length - 1})` : `${rules.length} access rule${rules.length === 1 ? '' : 's'}`);
  }
  if (t(loc.access.basicAuthUserFile)) notes.push('password');
  if (t(loc.rateLimit.zone)) notes.push(`rate limit ${t(loc.rateLimit.zone)}`);
  if (loc.internal) notes.push('internal only');
  if (loc.type === 'proxy' && loc.proxyPass.scheme === 'https') notes.push('HTTPS to backend');
  return notes;
}

function listenText(blk) {
  return blk.listen.map((l) => {
    const a = t(l.address);
    const host = a && a !== '*' ? `${isIPv6(stripBrackets(a)) ? `[${stripBrackets(a)}]` : a}:` : '';
    return `${host}${l.port ?? '?'}${l.ssl ? ' ssl' : ''}`;
  }).join(', ');
}

/**
 * Builds the table. `build` is buildAll(project) (used for the status column); options override
 * project.settings.table. Returns { title, subtitle, layout, hosts, groups, rows, columns, legend, footnotes, meta }.
 */
export function buildRoutingTable(project, build, options = {}) {
  const s = project.settings;
  const o = { ...s.table, ...options };
  const issues = build ? build.issues : [];
  const rows = [];
  const groups = [];
  const hostSet = new Set();
  const usedUpstreams = new Set();
  const legendFlags = new Set();

  project.servers.forEach((cfg, ci) => {
    if (!cfg.enabled && !o.includeDisabled) return;
    const file = entityFilePath(cfg, s);
    cfg.blocks.forEach((blk, bi) => {
      const names = blk.serverNames.map(t).filter(Boolean).join(' ');
      const group = {
        key: `${ci}.${bi}`,
        path: `servers.${ci}.blocks.${bi}`,
        title: `${t(cfg.name) || `Server configuration ${ci + 1}`}${cfg.blocks.length > 1 ? ` › ${t(blk.label) || `block ${bi + 1}`}` : ''}`,
        file,
        listen: listenText(blk),
        serverNames: names,
        category: titleCase(t(cfg.category)),
        environment: t(cfg.environment),
        disabled: !cfg.enabled,
        rows: [],
      };
      blk.locations.forEach((loc, li) => {
        if (o.proxyOnly && loc.type !== 'proxy') return;
        const path = `servers.${ci}.blocks.${bi}.locations.${li}`;
        const row = {
          path, group: group.key,
          endpoint: locationLabel(loc), endpointPath: t(loc.path), match: MATCH_NAME[loc.match] || loc.match, type: loc.type,
          category: group.category, environment: group.environment, config: t(cfg.name), file, listen: group.listen, serverNames: names,
          upstream: '', method: '', upstreamFile: '', target: '', backendPath: '',
          backends: new Map(), backendList: [], notes: locationNotes(loc),
          status: 'Active', statusLevel: 'ok',
        };
        let up = null;
        let upIndex = -1;
        if (loc.type === 'proxy') {
          const pp = loc.proxyPass;
          row.backendPath = t(pp.uri);
          if (pp.target === 'upstream') {
            row.upstream = t(pp.upstream);
            upIndex = project.upstreams.findIndex((u) => t(u.name).toLowerCase() === row.upstream.toLowerCase() && row.upstream);
            up = upIndex === -1 ? null : project.upstreams[upIndex];
            if (up) {
              usedUpstreams.add(up);
              row.method = METHOD_LABEL[up.method] ? `${METHOD_LABEL[up.method]}${up.method === 'hash' && t(up.hashKey) ? ` ${t(up.hashKey)}` : ''}` : '';
              row.upstreamFile = entityFilePath(up, s);
              for (const sv of up.servers) {
                if (!t(sv.address)) continue;
                const host = hostName(sv.address);
                const flags = serverFlags(sv);
                for (const f of flags) legendFlags.add(f.startsWith('w') ? 'weight' : f);
                addBackend(row, host, backendKind(t(sv.address)) === 'unix' ? 'socket' : sv.port, flags);
                hostSet.add(host);
              }
            }
          } else {
            const host = hostName(pp.address);
            row.target = 'direct';
            if (host) {
              addBackend(row, host, backendKind(t(pp.address)) === 'unix' ? 'socket' : pp.port, []);
              hostSet.add(host);
            }
          }
        } else {
          row.target = targetText(loc);
        }
        const status = statusOf(cfg, row, up, upIndex, issues);
        row.status = status[0];
        row.statusLevel = status[1];
        group.rows.push(row);
        rows.push(row);
      });
      if (group.rows.length) groups.push(group);
    });
  });

  const hosts = [...hostSet].sort(compareHosts);
  const layout = o.layout === 'matrix' || o.layout === 'list' ? o.layout : hosts.length && hosts.length <= MATRIX_MAX_HOSTS ? 'matrix' : 'list';
  const environments = [...new Set(rows.map((r) => r.environment).filter(Boolean))];
  const unused = project.upstreams.filter((u) => u.enabled && !usedUpstreams.has(u)).map((u) => t(u.name)).filter(Boolean);

  const legend = [];
  if (layout === 'matrix') legend.push('Each backend column shows the port nginx connects to on that host.');
  if (legendFlags.has('backup')) legend.push('backup: used only when the other servers are unavailable');
  if (legendFlags.has('down')) legend.push('down: marked unavailable');
  if (legendFlags.has('off')) legend.push('off: kept in the file as a comment (out of rotation)');
  if (legendFlags.has('weight')) legend.push('wN: weight N (default 1)');
  const footnotes = [];
  if (unused.length) footnotes.push(`Upstream groups not used by any endpoint: ${unused.join(', ')}`);

  const env = environments.length === 1 ? environments[0] : t(project.project.environment);
  const table = {
    title: t(project.project.name) || 'Nginx configuration',
    subtitle: [
      'Endpoint routing table',
      environments.length <= 1 && env ? env : null,
      `${rows.length} endpoint${rows.length === 1 ? '' : 's'}`,
      `${usedUpstreams.size} upstream group${usedUpstreams.size === 1 ? '' : 's'}`,
      `${hosts.length} backend host${hosts.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · '),
    layout,
    grouped: !!o.groupRows,
    hosts,
    groups,
    rows,
    legend,
    footnotes,
    multiEnvironment: environments.length > 1,
  };
  table.columns = displayColumns(table);
  return table;
}

function addBackend(row, host, port, flags) {
  const text = [port === null || port === undefined ? '' : String(port), ...flags].filter(Boolean).join(' ');
  const prev = row.backends.get(host);
  const entry = { text, flags, active: !flags.includes('off') && !flags.includes('down') };
  if (prev) {
    prev.text = `${prev.text}, ${text}`;
    prev.flags = [...prev.flags, ...flags];
    prev.active = prev.active || entry.active;
  } else {
    row.backends.set(host, entry);
  }
  const hostText = host.startsWith('unix:') ? host : isIPv6(host) ? `[${host}]` : host;
  row.backendList.push(`${hostText}${port === 'socket' || port === null || port === undefined ? '' : `:${port}`}${flags.length ? ` (${flags.join(', ')})` : ''}`);
}

function statusOf(cfg, row, up, upIndex, issues) {
  if (!cfg.enabled) return ['Disabled', 'muted'];
  const own = issues.filter((i) => isUnder(i.path || '', row.path));
  const upIssues = upIndex === -1 ? [] : issues.filter((i) => isUnder(i.path || '', `upstreams.${upIndex}`));
  if (row.type === 'proxy' && row.upstream && !up) return ['Missing upstream', 'error'];
  if (up && !up.enabled) return ['Upstream off', 'error'];
  if (own.some((i) => i.level === 'error') || upIssues.some((i) => i.level === 'error')) return ['Error', 'error'];
  if (up && !up.servers.some((sv) => sv.enabled && !sv.down && !sv.backup)) return ['No backend', 'error'];
  if (own.some((i) => i.level === 'warning')) return ['Review', 'warning'];
  return ['Active', 'ok'];
}

/**
 * Columns for the image and the on-screen table. Columns that would be empty are left out, and the
 * server block details move to the group bands when rows are grouped.
 */
function displayColumns(table) {
  const rows = table.rows;
  const any = (key) => rows.some((r) => (Array.isArray(r[key]) ? r[key].length : r[key]));
  const cols = [{ key: 'endpoint', label: 'Endpoint', kind: 'mono' }];
  if (!table.grouped) {
    cols.push({ key: 'category', label: 'Category' });
    if (table.multiEnvironment) cols.push({ key: 'environment', label: 'Environment' });
    cols.push({ key: 'listen', label: 'Listen', kind: 'mono' });
    if (rows.some((r) => r.serverNames && r.serverNames !== '_')) cols.push({ key: 'serverNames', label: 'Server names', kind: 'mono' });
  } else if (table.multiEnvironment) {
    cols.push({ key: 'environment', label: 'Environment' });
  }
  cols.push({ key: 'upstream', label: 'Upstream / handled by', kind: 'mono' });
  if (any('method')) cols.push({ key: 'method', label: 'Balancing', kind: 'mono' });
  if (table.layout === 'matrix') {
    for (const host of table.hosts) cols.push({ key: `host:${host}`, label: host, kind: 'host', host, group: 'Backend servers (port)' });
  } else if (table.hosts.length) {
    cols.push({ key: 'backends', label: 'Backend servers', kind: 'mono', wrap: true });
  }
  if (any('backendPath')) cols.push({ key: 'backendPath', label: 'Backend path', kind: 'mono' });
  if (!table.grouped) cols.push({ key: 'file', label: 'conf.d file', kind: 'mono' });
  if (any('notes')) cols.push({ key: 'notes', label: 'Notes', wrap: true });
  cols.push({ key: 'status', label: 'Status', kind: 'status' });
  return cols;
}

/** Text of a row cell for a display column. */
export function cellText(row, col) {
  if (col.kind === 'host') return row.backends.get(col.host)?.text || '';
  switch (col.key) {
    case 'upstream': return row.upstream || row.target;
    case 'backends': return row.backendList.join(', ');
    case 'notes': return row.notes.join(', ');
    default: return row[col.key] ?? '';
  }
}

// ---------- CSV / TSV ----------

/** Full, stable column set for spreadsheets (one row per endpoint, no grouping). */
function exportColumns(table) {
  const cols = [
    ['Endpoint', (r) => r.endpointPath],
    ['Match', (r) => r.match],
    ['Type', (r) => r.type],
    ['Category', (r) => r.category],
    ['Environment', (r) => r.environment],
    ['Server configuration', (r) => r.config],
    ['conf.d file', (r) => r.file],
    ['Listen', (r) => r.listen],
    ['Server names', (r) => r.serverNames],
    ['Upstream', (r) => r.upstream],
    ['Balancing', (r) => (r.upstream ? r.method || 'round robin' : '')],
    ['Upstream file', (r) => r.upstreamFile],
  ];
  if (table.layout === 'matrix') {
    for (const host of table.hosts) cols.push([host, (r) => r.backends.get(host)?.text || '']);
  } else {
    cols.push(['Backend servers', (r) => r.backendList.join(', ')]);
  }
  cols.push(
    ['Backend path', (r) => r.backendPath],
    ['Handled by', (r) => r.target],
    ['Notes', (r) => r.notes.join(', ')],
    ['Status', (r) => r.status],
  );
  return cols;
}

/** Neutralizes spreadsheet formulas: a cell starting with = + - @ or a control character is prefixed with '. */
export function safeCell(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/**
 * CSV (RFC 4180, CRLF) or TSV. `bom` prefixes a UTF-8 byte order mark so Excel reads the encoding.
 */
export function tableToDelimited(table, { delimiter = ',', bom = false } = {}) {
  const cols = exportColumns(table);
  const fmt = (v) => {
    const s = safeCell(v);
    if (delimiter === '\t') return s.replace(/[\t\r\n]+/g, ' ');
    return /[",\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(([label]) => fmt(label)).join(delimiter)];
  for (const r of table.rows) lines.push(cols.map(([, get]) => fmt(get(r))).join(delimiter));
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}
