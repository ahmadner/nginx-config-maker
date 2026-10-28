import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutingTable, tableToDelimited, cellText, cellLines, compareHosts, parseWorkerNames, portsInUse, safeCell, MATRIX_MAX_HOSTS } from '../js/core/table.js';
import { sampleProject } from '../js/core/sample.js';
import { baseProject, buildAll, upstream, server, proxy, location } from './helpers.js';

const tableOf = (p, opts) => buildRoutingTable(p, buildAll(p), opts);
const row = (table, endpoint) => table.rows.find((r) => r.endpoint === endpoint);

/** Two app pairs on four hosts, like a typical application server layout. */
function pairsProject() {
  const p = baseProject('Pairs');
  p.upstreams = [
    upstream({ name: 'ext_billing', outputDir: 'upstreams/external', fileName: 'billing.conf', servers: [{ address: '10.0.0.12', port: 9000 }, { address: '10.0.0.11', port: 9000 }] }),
    upstream({ name: 'ext_visitor', outputDir: 'upstreams/external', fileName: 'visitor.conf', method: 'ip_hash', servers: [{ address: '10.0.0.13', port: 9001, enabled: false }, { address: '10.0.0.14', port: 9001 }] }),
    upstream({ name: 'int_jobs', outputDir: 'upstreams/internal', fileName: 'jobs.conf', servers: [{ address: '10.0.0.11', port: 9005, weight: 2 }, { address: '10.0.0.12', port: 9005, backup: true }] }),
    upstream({ name: 'int_unused', outputDir: 'upstreams/internal', fileName: 'unused.conf', servers: [{ address: '10.0.0.9', port: 80 }] }),
  ];
  p.servers = [
    server({ name: 'External', category: 'external', fileName: 'external.conf', blocks: [{ listen: [{ port: 8444, defaultServer: true }], serverNames: ['_'], locations: [proxy('/billing/', 'ext_billing'), proxy('/visitor/', 'ext_visitor', { proxy: { readTimeout: '600s' } })] }] }),
    server({ name: 'Internal', category: 'internal', fileName: 'internal.conf', blocks: [{ listen: [{ port: 8443, defaultServer: true }], serverNames: ['_'], locations: [proxy('/jobs/', 'int_jobs'), { path: '/healthz', match: 'exact', type: 'health' }] }] }),
  ];
  return p;
}

test('matrix layout: one column per backend host with the port in each cell', () => {
  const table = tableOf(pairsProject());
  assert.equal(table.layout, 'matrix');
  assert.deepEqual(table.hosts, ['10.0.0.9', '10.0.0.11', '10.0.0.12', '10.0.0.13', '10.0.0.14'].filter((h) => h !== '10.0.0.9'));
  const billing = row(table, '/billing/');
  assert.equal(billing.upstream, 'ext_billing');
  assert.equal(billing.backends.get('10.0.0.11').text, '9000');
  assert.equal(billing.backends.get('10.0.0.12').text, '9000');
  assert.equal(billing.backends.has('10.0.0.13'), false);
  const visitor = row(table, '/visitor/');
  assert.equal(visitor.backends.get('10.0.0.13').text, '9001 off');
  assert.equal(visitor.method, 'ip_hash');
  assert.deepEqual(visitor.notes, ['read 600s']);
  const jobs = row(table, '/jobs/');
  assert.equal(jobs.backends.get('10.0.0.11').text, '9005 w2');
  assert.equal(jobs.backends.get('10.0.0.12').text, '9005 backup');
  assert.equal(row(table, '= /healthz').target, 'health check (200 "ok")');
  assert.deepEqual(table.footnotes, ['Upstream groups not used by any endpoint: int_unused']);
  assert.ok(table.legend.some((l) => l.startsWith('off:')) && table.legend.some((l) => l.startsWith('backup:')));

  const labels = table.columns.map((c) => c.label);
  assert.deepEqual(labels.slice(0, 3), ['Endpoint', 'Upstream / handled by', 'Balancing']);
  assert.ok(labels.includes('10.0.0.11') && labels.includes('Notes') && labels.at(-1) === 'Status');
  assert.ok(!labels.includes('Backend path'), 'empty columns are left out');
  assert.ok(!labels.includes('conf.d file'), 'grouped rows show the file in the group band');
  assert.deepEqual(table.groups.map((g) => [g.file, g.listen, g.category]), [['conf.d/external.conf', '8444', 'External'], ['conf.d/internal.conf', '8443', 'Internal']]);
});

test('layout switches to a backend list for many hosts, and can be forced either way', () => {
  const sample = sampleProject();
  const auto = tableOf(sample);
  assert.ok(auto.hosts.length > MATRIX_MAX_HOSTS);
  assert.equal(auto.layout, 'list');
  assert.ok(auto.columns.some((c) => c.key === 'backends'));
  assert.equal(cellText(row(auto, '/payments/'), auto.columns.find((c) => c.key === 'backends')), '192.0.2.21:9002 (w2), 192.0.2.22:9002, 192.0.2.23:9002 (backup)');
  const matrix = tableOf(sample, { layout: 'matrix' });
  assert.equal(matrix.layout, 'matrix');
  assert.equal(matrix.columns.filter((c) => c.kind === 'host').length, auto.hosts.length);
  assert.equal(tableOf(pairsProject(), { layout: 'list' }).layout, 'list');
});

test('ungrouped tables carry the server block details as columns', () => {
  const table = tableOf(pairsProject(), { groupRows: false });
  const labels = table.columns.map((c) => c.label);
  for (const l of ['Category', 'Listen', 'conf.d file']) assert.ok(labels.includes(l), l);
  assert.ok(!labels.includes('Server names'), 'all names are "_", so the column is left out');
});

test('worker layout: one row per backend worker (host + port) with the endpoints it serves', () => {
  const p = pairsProject();
  p.servers[0].blocks[0].locations.push(location(proxy('/invoices/', 'ext_billing')));
  const table = tableOf(p, { layout: 'worker' });
  const w = (host, worker) => table.rows.find((r) => r.host === host && r.worker === worker);

  assert.equal(table.layout, 'worker');
  assert.deepEqual(table.groups.map((g) => g.title), ['10.0.0.11', '10.0.0.12', '10.0.0.13', '10.0.0.14']);
  assert.equal(table.groups[0].sub, '2 workers  ·  3 endpoints  ·  ports 9000, 9005');
  assert.equal(table.rows.length, 6);
  assert.equal(table.endpointRows.length, 5);

  // Ports are numbered across the project, so the same port is the same worker on every host.
  assert.deepEqual([w('10.0.0.11', 'worker1').port, w('10.0.0.11', 'worker3').port], ['9000', '9005']);
  assert.equal(w('10.0.0.13', 'worker2').port, '9001');
  assert.deepEqual(w('10.0.0.11', 'worker1').endpoints, ['/billing/', '/invoices/']);
  assert.equal(w('10.0.0.11', 'worker1').count, '2');
  assert.deepEqual(w('10.0.0.11', 'worker1').upstreams, ['ext_billing']);
  assert.equal(w('10.0.0.11', 'worker3').flags, 'w2');
  assert.equal(w('10.0.0.12', 'worker3').status, 'Standby');
  assert.equal(w('10.0.0.13', 'worker2').status, 'Commented out');
  assert.equal(w('10.0.0.14', 'worker2').method, 'ip_hash');
  assert.ok(table.legend.some((l) => l.startsWith('One row per backend worker')));
  assert.ok(table.legend.some((l) => l.includes('numbered by port across the project, from worker1')));
  assert.ok(table.footnotes.some((f) => f.startsWith('1 endpoint without a backend server')), 'the health check has no worker');

  const labels = table.columns.map((c) => c.label);
  assert.deepEqual(labels, ['Worker', 'Port', 'Role', 'Upstream group', 'Balancing', 'Count', 'Endpoints served', 'Served from', 'Status']);
  assert.equal(cellText(w('10.0.0.11', 'worker1'), table.columns.find((c) => c.key === 'endpoints')), '/billing/, /invoices/');
  assert.equal(tableOf(p, { layout: 'worker', groupRows: false }).columns[0].label, 'Backend host', 'the host is a column when rows are not grouped');
});

test('worker names: by port, per host, from zero, or named in the settings', () => {
  const p = pairsProject();
  const names = (opts) => tableOf(p, { layout: 'worker', ...opts }).rows.map((r) => `${r.host}:${r.port}=${r.worker}`);

  // 9000, 9001 and 9005 are in use, so by port they are worker1, worker2 and worker3 on every host.
  assert.deepEqual(names(), ['10.0.0.11:9000=worker1', '10.0.0.11:9005=worker3', '10.0.0.12:9000=worker1', '10.0.0.12:9005=worker3', '10.0.0.13:9001=worker2', '10.0.0.14:9001=worker2']);
  assert.deepEqual(names({ workerFromZero: true }), ['10.0.0.11:9000=worker0', '10.0.0.11:9005=worker2', '10.0.0.12:9000=worker0', '10.0.0.12:9005=worker2', '10.0.0.13:9001=worker1', '10.0.0.14:9001=worker1']);
  // Per host, every host starts again at worker1.
  assert.deepEqual(names({ workerNumbering: 'host' }), ['10.0.0.11:9000=worker1', '10.0.0.11:9005=worker2', '10.0.0.12:9000=worker1', '10.0.0.12:9005=worker2', '10.0.0.13:9001=worker1', '10.0.0.14:9001=worker1']);

  // Names given for single ports win; the rest keep their number.
  const named = tableOf(p, { layout: 'worker', workerNames: ['9000 = web', '9005: jobs', 'nonsense', '  '] });
  assert.deepEqual(named.rows.map((r) => r.worker), ['web', 'jobs', 'web', 'jobs', 'worker2', 'worker2']);
  assert.ok(named.legend.some((l) => l.includes('come from the port list in the table options (9000, 9005)')));
  assert.ok(named.legend.some((l) => l.startsWith('The other workers are numbered')));
  assert.deepEqual([...parseWorkerNames(['9000=a', '80 b', 'x=y', '9000 = c'])], [['9000', 'c'], ['80', 'b']]);
  assert.deepEqual(portsInUse(named.endpointRows), ['9000', '9001', '9005']);
});

test('worker layout: a status per endpoint, with the colours explained', () => {
  const p = pairsProject();
  p.servers[1].blocks[0].locations[0].proxy.buffers = 'bad'; // /jobs/ fails validation
  p.servers[0].blocks[0].locations.push(location(proxy('/invoices/', 'ext_billing')));
  const table = tableOf(p, { layout: 'worker' });
  const w = (host, worker) => table.rows.find((r) => r.host === host && r.worker === worker);

  // The status column belongs to the applications on the worker, not to the worker itself.
  assert.deepEqual(w('10.0.0.11', 'worker1').endpointStatuses, [{ text: 'Active', level: 'ok' }, { text: 'Active', level: 'ok' }]);
  assert.deepEqual(w('10.0.0.11', 'worker3').endpointStatuses, [{ text: 'Error', level: 'error' }]);
  const status = table.columns.find((c) => c.kind === 'statuses');
  assert.deepEqual(cellLines(w('10.0.0.11', 'worker1'), status), [{ text: 'Active', level: 'ok' }, { text: 'Active', level: 'ok' }]);
  assert.deepEqual(cellLines(w('10.0.0.11', 'worker1'), table.columns.find((c) => c.kind === 'list')), [{ text: '/billing/' }, { text: '/invoices/' }]);

  // The commented-out server keeps its colours: the endpoint itself still runs on the other host.
  assert.equal(w('10.0.0.13', 'worker2').status, 'Commented out');
  assert.equal(w('10.0.0.13', 'worker2').dim, false);
  assert.deepEqual(w('10.0.0.13', 'worker2').endpointStatuses, [{ text: 'Active', level: 'ok' }]);

  assert.deepEqual(table.colorLegend.map((c) => [c.level, c.label]), [['ok', 'Active'], ['error', 'Error']]);
  assert.ok(table.colorLegend.every((c) => c.meaning.includes(':')), 'each colour says what it means');

  // Turned-off configurations are grey in every layout.
  p.servers[1].enabled = false;
  const off = tableOf(p, { layout: 'worker' });
  assert.equal(off.rows.find((r) => r.host === '10.0.0.11' && r.port === '9005').dim, true);
  assert.deepEqual(tableOf(p).colorLegend.map((c) => c.level), ['ok', 'muted']);
});

test('worker layout CSV: one row per worker', () => {
  const p = pairsProject();
  p.servers[0].blocks[0].locations.push(location(proxy('/invoices/', 'ext_billing')));
  const table = tableOf(p, { layout: 'worker' });
  const csv = tableToDelimited(table);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'Backend host,Worker,Port,Role,Environment,Upstream groups,Balancing,Endpoint count,Endpoints served,Status per endpoint,Server configurations,conf.d files,Worker state');
  assert.equal(lines.length, table.rows.length + 1);
  assert.equal(lines[1], '10.0.0.11,worker1,9000,,,ext_billing,round robin,2,"/billing/, /invoices/","/billing/: Active, /invoices/: Active",External,conf.d/external.conf,Active');
});

test('status reflects validation and the state of the configuration', () => {
  const p = pairsProject();
  p.upstreams[1].enabled = false; // ext_visitor turned off
  p.servers[0].blocks[0].locations.push(location(proxy('/ghost/', 'ext_ghost')));
  p.servers[1].blocks[0].locations[0].proxy.buffers = 'bad';
  let table = tableOf(p);
  assert.equal(row(table, '/billing/').status, 'Active');
  assert.equal(row(table, '/visitor/').status, 'Upstream off');
  assert.equal(row(table, '/ghost/').status, 'Missing upstream');
  assert.equal(row(table, '/jobs/').status, 'Error');
  p.servers[1].enabled = false;
  table = tableOf(p);
  assert.equal(row(table, '/jobs/').status, 'Disabled');
  assert.equal(row(table, '/jobs/').statusLevel, 'muted');
  assert.equal(tableOf(p, { includeDisabled: false }).rows.some((r) => r.endpoint === '/jobs/'), false);
  assert.equal(tableOf(p, { proxyOnly: true }).rows.some((r) => r.type !== 'proxy'), false);
});

test('CSV: one row per endpoint, stable columns, quoting, BOM and formula protection', () => {
  const p = pairsProject();
  p.servers[0].blocks[0].locations[0].path = '@billing';
  p.servers[0].blocks[0].locations[0].proxy.readTimeout = '30s';
  const table = tableOf(p);
  const csv = tableToDelimited(table, { bom: true });
  assert.ok(csv.startsWith('﻿Endpoint,Match,Type,Category,Environment,Server configuration,conf.d file,Listen,Server names,Upstream,Balancing,Upstream file,10.0.0.11,10.0.0.12,10.0.0.13,10.0.0.14,Backend path,Handled by,Notes,Status\r\n'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, table.rows.length + 1);
  assert.equal(lines[1], "'@billing,prefix,proxy,External,,External,conf.d/external.conf,8444,_,ext_billing,round robin,upstreams/external/billing.conf,9000,9000,,,,,read 30s,Active");
  assert.ok(lines.some((l) => l.startsWith('/healthz,exact,health,') && l.includes('"health check (200 ""ok"")"')));
  const tsv = tableToDelimited(table, { delimiter: '\t' });
  assert.ok(!tsv.startsWith('﻿'));
  assert.equal(tsv.split('\r\n')[0].split('\t').length, 20);
  for (const [input, out] of [['=1+1', "'=1+1"], ['+cmd', "'+cmd"], ['-2', "'-2"], ['@SUM(A1)', "'@SUM(A1)"], ['/api/', '/api/'], ['', '']]) assert.equal(safeCell(input), out);
});

test('hosts sort numerically, then IPv6, hostnames and sockets', () => {
  const hosts = ['app.internal', '10.0.0.10', 'unix:/run/a.sock', '10.0.0.9', '2001:db8::1', '9.255.0.1'];
  assert.deepEqual([...hosts].sort(compareHosts), ['9.255.0.1', '10.0.0.9', '10.0.0.10', '2001:db8::1', 'app.internal', 'unix:/run/a.sock']);
});

test('an empty project gives an empty table', () => {
  const p = baseProject();
  p.servers = [];
  const table = tableOf(p);
  assert.equal(table.rows.length, 0);
  assert.equal(tableToDelimited(table).split('\r\n').filter(Boolean).length, 1);
});
