// Endpoint routing table: every location with its upstream, backend hosts and ports, file and status.
// Used for the PNG image, the CSV/TSV exports and routing-table.csv in the package.
//
// Layouts:
//   matrix  one column per backend host, the port in each cell (compact when hosts are shared)
//   list    one "Backend servers" column with host:port entries (for many hosts)
//   auto    matrix up to MATRIX_MAX_HOSTS hosts, list beyond that
//   worker  inverted: one row per backend worker (a host and port) with the endpoints it serves,
//           grouped by host — "worker2 on 10.0.0.129 serves /app1/, /app2/, /app3/"

import { entityFilePath, locationLabel } from './model.js';
import { backendKind, isIPv4, isIPv6, stripBrackets } from './net.js';
import { plural, t } from './util.js';

export const MATRIX_MAX_HOSTS = 8;
const FIXED_LAYOUTS = new Set(['matrix', 'list', 'worker']);

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
 * `rows` and `groups` are what the image, the preview and the CSV render: endpoints grouped by server
 * block, or — in the worker layout — backend workers grouped by host. The endpoint rows stay available
 * as `endpointRows` / `endpointGroups`.
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
        note: cfg.enabled ? '' : 'turned off',
        rows: [],
      };
      group.sub = [group.file, `listen ${group.listen}`, names && names !== '_' ? names : 'any host name', group.category].filter(Boolean).join('  ·  ');
      blk.locations.forEach((loc, li) => {
        if (o.proxyOnly && loc.type !== 'proxy') return;
        if (!loc.enabled && !o.includeDisabled) return;
        const path = `servers.${ci}.blocks.${bi}.locations.${li}`;
        const row = {
          path, group: group.key,
          endpoint: locationLabel(loc), endpointPath: t(loc.path), match: MATCH_NAME[loc.match] || loc.match, type: loc.type,
          category: group.category, environment: group.environment, config: t(cfg.name), file, listen: group.listen, serverNames: names,
          upstream: '', method: '', upstreamFile: '', target: '', backendPath: '',
          backends: new Map(), backendList: [], targets: [], notes: locationNotes(loc),
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
        const status = statusOf(cfg, loc, row, up, upIndex, issues);
        row.status = status[0];
        row.statusLevel = status[1];
        row.dim = status[1] === 'muted'; // drawn in grey: nothing here is in service
        group.rows.push(row);
        rows.push(row);
      });
      if (group.rows.length) groups.push(group);
    });
  });

  const hosts = [...hostSet].sort(compareHosts);
  const layout = FIXED_LAYOUTS.has(o.layout) ? o.layout : hosts.length && hosts.length <= MATRIX_MAX_HOSTS ? 'matrix' : 'list';
  const environments = [...new Set(rows.map((r) => r.environment).filter(Boolean))];
  const unused = project.upstreams.filter((u) => u.enabled && !usedUpstreams.has(u)).map((u) => t(u.name)).filter(Boolean);
  const view = layout === 'worker' ? workerView(rows, o) : null;

  const legend = [];
  if (layout === 'matrix') legend.push('Each backend column shows the port nginx connects to on that host.');
  if (layout === 'worker') {
    legend.push('One row per backend worker: a host and port nginx connects to. The Status column shows the state of each application on that worker, not of the worker itself.');
    if (view.namedPorts.length) legend.push(`Worker names come from the port list in the table options (${view.namedPorts.join(', ')}).`);
    if (view.numbered) {
      const who = view.namedPorts.length ? 'The other workers are' : 'Workers are';
      const from = o.workerFromZero ? 'worker0' : 'worker1';
      legend.push(o.workerNumbering === 'host'
        ? `${who} numbered per host in ascending port order, from ${from}; the Port column shows the real port.`
        : `${who} numbered by port across the project, from ${from}, so the same port is the same worker on every host.`);
    }
  }
  if (legendFlags.has('backup')) legend.push('backup: used only when the other servers are unavailable');
  if (legendFlags.has('down')) legend.push('down: marked unavailable');
  if (legendFlags.has('off')) legend.push('off: kept in the file as a comment (out of rotation)');
  if (legendFlags.has('weight')) legend.push('wN: weight N (default 1)');
  const footnotes = [];
  if (unused.length) footnotes.push(`Upstream groups not used by any endpoint: ${unused.join(', ')}`);
  if (layout === 'worker') {
    const noBackend = rows.filter((r) => !r.targets.length).length;
    if (noBackend) footnotes.push(`${plural(noBackend, 'endpoint')} without a backend server (static files, health checks, redirects, or a missing upstream) ${noBackend === 1 ? 'is' : 'are'} not listed here.`);
  }

  const env = environments.length === 1 ? environments[0] : t(project.project.environment);
  const counts = layout === 'worker'
    ? [plural(hosts.length, 'backend host'), plural(view.rows.length, 'worker'), plural(rows.length, 'endpoint'), plural(usedUpstreams.size, 'upstream group')]
    : [plural(rows.length, 'endpoint'), plural(usedUpstreams.size, 'upstream group'), plural(hosts.length, 'backend host')];
  const table = {
    title: t(project.project.name) || 'Nginx configuration',
    subtitle: [
      layout === 'worker' ? 'Backend workers and the endpoints they serve' : 'Endpoint routing table',
      environments.length <= 1 && env ? env : null,
      ...counts,
    ].filter(Boolean).join(' · '),
    layout,
    grouped: !!o.groupRows,
    hosts,
    groups: view ? view.groups : groups,
    rows: view ? view.rows : rows,
    endpointRows: rows,
    endpointGroups: groups,
    legend,
    footnotes,
    multiEnvironment: environments.length > 1,
  };
  table.columns = displayColumns(table);
  table.colorLegend = colorLegend(table);
  return table;
}

// What the colours of the status pills mean; only the levels the table actually uses are listed.
const COLOR_MEANING = [
  ['ok', 'Active', 'green: in service'],
  ['warning', 'Review', 'amber: works, but something needs checking'],
  ['error', 'Error', 'red: not serving traffic'],
  ['muted', 'Off', 'grey: turned off or out of rotation'],
];

function colorLegend(table) {
  const levels = new Set(table.rows.flatMap((r) => (r.endpointStatuses ? r.endpointStatuses.map((s) => s.level) : [r.statusLevel])));
  return COLOR_MEANING.filter(([level]) => levels.has(level)).map(([level, label, meaning]) => ({ level, label, meaning }));
}

function addBackend(row, host, port, flags) {
  const text = [port === null || port === undefined ? '' : String(port), ...flags].filter(Boolean).join(' ');
  row.targets.push({ host, port, flags });
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

function statusOf(cfg, loc, row, up, upIndex, issues) {
  if (!cfg.enabled) return ['Disabled', 'muted'];
  if (!loc.enabled) return ['Commented out', 'muted'];
  const own = issues.filter((i) => isUnder(i.path || '', row.path));
  const upIssues = upIndex === -1 ? [] : issues.filter((i) => isUnder(i.path || '', `upstreams.${upIndex}`));
  if (row.type === 'proxy' && row.upstream && !up) return ['Missing upstream', 'error'];
  if (up && !up.enabled) return ['Upstream off', 'error'];
  if (own.some((i) => i.level === 'error') || upIssues.some((i) => i.level === 'error')) return ['Error', 'error'];
  if (up && !up.servers.some((sv) => sv.enabled && !sv.down && !sv.backup)) return ['No backend', 'error'];
  if (own.some((i) => i.level === 'warning')) return ['Review', 'warning'];
  return ['Active', 'ok'];
}

// ---------- Worker layout: one row per backend worker (host + port), grouped by host ----------

const portLabel = (port) => (port === 'socket' ? 'socket' : port === null || port === undefined ? '—' : String(port));
const FLAG_ORDER = ['off', 'down', 'backup'];
const flagRank = (f) => (FLAG_ORDER.indexOf(f) === -1 ? FLAG_ORDER.length : FLAG_ORDER.indexOf(f));

/** Numbered ports first (ascending), then sockets and entries without a port. */
function compareWorkers(a, b) {
  const na = typeof a.port === 'number';
  const nb = typeof b.port === 'number';
  if (na && nb) return a.port - b.port;
  if (na !== nb) return na ? -1 : 1;
  return portLabel(a.port).localeCompare(portLabel(b.port));
}

function workerStatus(w) {
  if (!w.active) return w.flags.has('down') ? ['Down', 'error'] : ['Commented out', 'muted'];
  if (w.rows.every((r) => r.statusLevel === 'muted')) return ['Disabled', 'muted'];
  if (w.rows.some((r) => r.statusLevel === 'error')) return ['Error', 'error'];
  if (w.onlyBackup) return ['Standby', 'warning'];
  if (w.rows.some((r) => r.statusLevel === 'warning')) return ['Review', 'warning'];
  return ['Active', 'ok'];
}

/**
 * Names given to single ports in the settings, one entry per line: "9000 = worker0" (also "9000: web"
 * or "9000 web"). Returns Map(port text -> name); lines without a port are ignored.
 */
export function parseWorkerNames(lines) {
  const map = new Map();
  for (const line of lines || []) {
    const m = /^\s*([0-9]{1,5}|socket)\s*[=:]?\s*(.+?)\s*$/.exec(t(line));
    if (m && m[2]) map.set(m[1], m[2].slice(0, 40));
  }
  return map;
}

/** The ports a project connects to, ascending: the list the worker names are written against. */
export function portsInUse(rows) {
  const ports = new Set();
  for (const r of rows) for (const tg of r.targets) ports.add(portLabel(tg.port));
  return [...ports].sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)));
}

/**
 * Turns the endpoint rows inside out: every distinct backend target (host + port) becomes one worker
 * row listing the endpoints that reach it, and the rows are grouped by host. Endpoints without a
 * backend (static files, health checks, redirects) have no worker and are counted in a footnote.
 *
 * Worker names come from the port list in the settings; the rest are numbered, either by port across
 * the whole project (so the same port is the same worker on every host) or per host.
 */
function workerView(rows, o) {
  const names = parseWorkerNames(o.workerNames);
  const first = o.workerFromZero ? 0 : 1;
  const byPort = new Map(portsInUse(rows).map((p, i) => [p, `worker${i + first}`]));
  const nameOf = (port, indexInHost) => names.get(port)
    || (o.workerNumbering === 'host' ? `worker${indexInHost + first}` : byPort.get(port));
  const named = new Set();
  let numbered = 0;

  const byHost = new Map();
  for (const r of rows) {
    for (const tg of r.targets) {
      if (!byHost.has(tg.host)) byHost.set(tg.host, new Map());
      const slots = byHost.get(tg.host);
      const key = typeof tg.port === 'number' ? `p${tg.port}` : `s${portLabel(tg.port)}`;
      let w = slots.get(key);
      if (!w) {
        w = { host: tg.host, port: tg.port, flags: new Set(), active: false, onlyBackup: true, rows: [], upstreams: new Set(), methods: new Set(), configs: new Set(), files: new Set(), environments: new Set(), endpoints: new Map() };
        slots.set(key, w);
      }
      for (const f of tg.flags) w.flags.add(f);
      if (!tg.flags.includes('off') && !tg.flags.includes('down')) w.active = true;
      if (!tg.flags.includes('backup')) w.onlyBackup = false;
      if (!w.rows.includes(r)) w.rows.push(r);
      const upstream = r.upstream || 'direct';
      w.upstreams.add(upstream);
      if (r.method) w.methods.add(r.method);
      if (r.config) w.configs.add(r.config);
      if (r.file) w.files.add(r.file);
      if (r.environment) w.environments.add(r.environment);
      w.endpoints.set(`${upstream}\u0000${r.endpoint}`, { upstream, endpoint: r.endpoint, row: r });
    }
  }

  const groups = [];
  const out = [];
  for (const host of [...byHost.keys()].sort(compareHosts)) {
    const group = { key: `host:${host}`, path: '', host, title: host, file: '', listen: '', serverNames: '', category: '', rows: [] };
    [...byHost.get(host).values()].sort(compareWorkers).forEach((w, i) => {
      const endpoints = [...w.endpoints.values()].sort((a, b) => a.upstream.localeCompare(b.upstream) || a.endpoint.localeCompare(b.endpoint));
      const [status, statusLevel] = workerStatus(w);
      const port = portLabel(w.port);
      if (names.has(port)) named.add(port); else numbered++;
      const row = {
        path: w.rows[0] ? w.rows[0].path : '', group: group.key,
        host, worker: nameOf(port, i), port,
        flags: [...w.flags].sort((a, b) => flagRank(a) - flagRank(b) || a.localeCompare(b)).join(', '),
        upstreams: [...w.upstreams].sort(), method: [...w.methods].sort().join(', '),
        endpoints: endpoints.map((e) => e.endpoint), count: String(endpoints.length),
        // One status per endpoint: the state of that application, not of the worker it runs on.
        endpointStatuses: endpoints.map((e) => ({ text: e.row.status, level: e.row.statusLevel })),
        configs: [...w.configs], files: [...w.files], environment: [...w.environments].join(', '),
        backends: new Map(), backendList: [], targets: [], notes: [],
        status, statusLevel,
      };
      // Grey the row only when no application on it is in service; an "off" worker whose applications
      // still run elsewhere keeps its colours.
      row.dim = row.endpointStatuses.every((s) => s.level === 'muted');
      group.rows.push(row);
      out.push(row);
    });
    const endpoints = new Set(group.rows.flatMap((r) => r.endpoints));
    group.disabled = group.rows.every((r) => r.statusLevel === 'muted');
    group.note = group.disabled ? 'no worker in rotation' : '';
    group.sub = [plural(group.rows.length, 'worker'), plural(endpoints.size, 'endpoint'), `ports ${group.rows.map((r) => r.port).join(', ')}`].join('  ·  ');
    groups.push(group);
  }
  return { rows: out, groups, namedPorts: portsInUse(rows).filter((p) => named.has(p)), numbered };
}

/**
 * Columns for the image and the on-screen table. Columns that would be empty are left out, and the
 * server block details move to the group bands when rows are grouped.
 */
function displayColumns(table) {
  const rows = table.rows;
  const any = (key) => rows.some((r) => (Array.isArray(r[key]) ? r[key].length : r[key]));
  if (table.layout === 'worker') return workerColumns(table, any);
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

/**
 * Worker layout columns, left to right: which worker, where it is, how it is used, what it serves,
 * where the traffic comes from, and its state. The host moves to the group bands when rows are grouped.
 */
function workerColumns(table, any) {
  const configs = new Set(table.rows.flatMap((r) => r.configs));
  const cols = [];
  if (!table.grouped) cols.push({ key: 'host', label: 'Backend host', kind: 'mono', limits: [100, 220] });
  cols.push({ key: 'worker', label: 'Worker', kind: 'mono' });
  cols.push({ key: 'port', label: 'Port', kind: 'mono' });
  if (any('flags')) cols.push({ key: 'flags', label: 'Role', kind: 'mono' });
  if (table.multiEnvironment) cols.push({ key: 'environment', label: 'Environment' });
  cols.push({ key: 'upstreams', label: 'Upstream group', kind: 'mono', wrap: true });
  if (any('method')) cols.push({ key: 'method', label: 'Balancing', kind: 'mono' });
  cols.push({ key: 'count', label: 'Count', kind: 'mono' });
  cols.push({ key: 'endpoints', label: 'Endpoints served', kind: 'list' });
  if (configs.size > 1) cols.push({ key: 'configs', label: 'Served from', wrap: true });
  cols.push({ key: 'endpointStatuses', label: 'Status', kind: 'statuses' });
  return cols;
}

/** Text of a row cell for a display column. */
export function cellText(row, col) {
  if (col.kind === 'host') return row.backends.get(col.host)?.text || '';
  switch (col.key) {
    case 'upstream': return row.upstream || row.target;
    case 'backends': return row.backendList.join(', ');
    case 'notes': return row.notes.join(', ');
    case 'upstreams': case 'endpoints': case 'configs': case 'files': return (row[col.key] || []).join(', ');
    case 'endpointStatuses': return (row.endpointStatuses || []).map((s) => s.text).join(', ');
    default: return row[col.key] ?? '';
  }
}

/**
 * Cells that hold one entry per endpoint rather than one string: the endpoints a worker serves
 * ('list') and their statuses ('statuses'). Entries line up row by row, so an endpoint and its
 * status sit on the same line. Returns null for ordinary cells.
 */
export function cellLines(row, col) {
  if (col.kind === 'statuses') return (row.endpointStatuses || []).map((s) => ({ text: s.text, level: s.level }));
  if (col.kind === 'list') return (row[col.key] || []).map((text) => ({ text }));
  return null;
}

// ---------- CSV / TSV ----------

/** Full, stable column set for spreadsheets: one row per endpoint, or per worker in the worker layout. */
function exportColumns(table) {
  if (table.layout === 'worker') {
    return [
      ['Backend host', (r) => r.host],
      ['Worker', (r) => r.worker],
      ['Port', (r) => r.port],
      ['Role', (r) => r.flags],
      ['Environment', (r) => r.environment],
      ['Upstream groups', (r) => r.upstreams.join(', ')],
      ['Balancing', (r) => r.method || (r.upstreams.some((u) => u !== 'direct') ? 'round robin' : '')],
      ['Endpoint count', (r) => r.count],
      ['Endpoints served', (r) => r.endpoints.join(', ')],
      ['Status per endpoint', (r) => r.endpoints.map((e, i) => `${e}: ${r.endpointStatuses[i].text}`).join(', ')],
      ['Server configurations', (r) => r.configs.join(', ')],
      ['conf.d files', (r) => r.files.join(', ')],
      ['Worker state', (r) => r.status],
    ];
  }
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
