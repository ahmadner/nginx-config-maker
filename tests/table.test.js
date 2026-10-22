import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutingTable, tableToDelimited, cellText, compareHosts, safeCell, MATRIX_MAX_HOSTS } from '../js/core/table.js';
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
