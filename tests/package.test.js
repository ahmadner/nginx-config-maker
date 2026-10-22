import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from '../vendor/fflate@0.8.2/fflate.js';
import yaml from '../vendor/js-yaml@4.1.1/js-yaml.mjs';
import { buildPackage, zipPackage, zipFileNameFor, projectFileNameFor } from '../js/core/package.js';
import { parseProjectYaml } from '../js/core/yaml-io.js';
import { stripIds } from '../js/core/schema.js';
import { sha256Hex } from '../js/core/util.js';
import { sampleProject } from '../js/core/sample.js';
import { baseProject, buildAll, upstream } from './helpers.js';

const NOW = new Date('2026-10-20T08:30:00Z');

async function packageOf(project) {
  const build = buildAll(project);
  const pkg = await buildPackage(project, build, { now: NOW });
  const zip = zipPackage(pkg, { now: NOW });
  return { build, pkg, zip, entries: unzipSync(zip) };
}

test('ZIP keeps the directory structure and holds only package files', async () => {
  const { entries, build } = await packageOf(sampleProject());
  const names = Object.keys(entries).sort();
  const expected = [
    ...build.files.map((f) => `nginx-config/${f.path}`),
    'nginx-config/manifest.yml', 'nginx-config/README.md', 'nginx-config/sample-environment-placeholders.yml', 'nginx-config/routing-table.csv',
  ].sort();
  assert.deepEqual(names, expected);
  assert.ok(names.includes('nginx-config/upstreams/external/v1/visitor.conf'));
  assert.ok(names.includes('nginx-config/conf.d/disabled/legacy.conf'));
  assert.ok(names.every((n) => !n.endsWith('/')), 'no empty folder entries');
  assert.ok(names.every((n) => !n.includes('..') && !n.startsWith('/')));
  for (const f of build.files) assert.equal(strFromU8(entries[`nginx-config/${f.path}`]), f.content);
  // No key material or app code.
  for (const [n, data] of Object.entries(entries)) {
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(strFromU8(data)), n);
    assert.ok(!/\.(js|mjs|html|css|pem|key|p12)$/.test(n), n);
  }
  const csvBytes = entries['nginx-config/routing-table.csv'];
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte order mark so Excel reads the encoding');
  const csv = strFromU8(csvBytes); // TextDecoder drops the BOM
  assert.ok(csv.startsWith('Endpoint,Match,Type,'));
  assert.equal(csv.trimEnd().split('\r\n').length, 13, 'header + one row per endpoint');
});

test('manifest lists every file with matching checksums', async () => {
  const { entries } = await packageOf(sampleProject());
  const manifest = yaml.load(strFromU8(entries['nginx-config/manifest.yml']));
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.project.name, 'Sample environment (placeholders)');
  assert.equal(manifest.generatedAt, NOW.toISOString());
  assert.equal(manifest.validation.errors, 0);
  assert.deepEqual(manifest.target.nginxConfIncludes, ['include /etc/nginx/upstreams.conf;', 'include /etc/nginx/conf.d/*.conf;']);
  for (const f of manifest.files) {
    if (!f.sha256) continue;
    const data = entries[`nginx-config/${f.path}`];
    assert.ok(data, f.path);
    assert.equal(await sha256Hex(data), f.sha256, f.path);
    assert.equal(data.length, f.bytes, f.path);
  }
  const visitor = manifest.files.find((f) => f.path === 'upstreams/external/v1/visitor.conf');
  assert.deepEqual(visitor.summary.servers, ['192.0.2.31:8444']);
  assert.deepEqual(visitor.loadedBy, ['upstreams.conf']);
});

test('README explains installation, nginx -t and rollback', async () => {
  const { entries } = await packageOf(sampleProject());
  const readme = strFromU8(entries['nginx-config/README.md']);
  for (const part of ['## Install', 'sudo nginx -t', '## Roll back', 'include /etc/nginx/conf.d/*.conf;',
    'sudo install -D -m 644 upstreams/external/v1/visitor.conf /etc/nginx/upstreams/external/v1/visitor.conf',
    '/etc/nginx/ssl/visitor.example.com/privkey.pem', 'sudo mkdir -p', '### Warnings to review']) {
    assert.ok(readme.includes(part), part);
  }
});

test('the project file inside the ZIP imports back to the same project', async () => {
  const project = sampleProject();
  const { entries } = await packageOf(project);
  const res = parseProjectYaml(strFromU8(entries[`nginx-config/${projectFileNameFor(project)}`]));
  assert.ok(res.ok);
  assert.deepEqual(stripIds(res.project), stripIds(project));
});

test('package options: root folder, file names, disabled files, project file', async () => {
  const p = baseProject('Production Servers');
  p.upstreams.push(upstream({ name: 'parked', outputDir: 'upstreams/external', fileName: 'parked.conf', enabled: false, servers: [{ address: '10.0.0.9', port: 80 }] }));
  assert.equal(zipFileNameFor(p), 'production-servers.zip');
  assert.equal(projectFileNameFor(p), 'production-servers.yml');
  p.settings.package = { rootFolder: '', includeDisabled: false, includeProjectFile: false, includeTable: false, projectFileName: '', zipFileName: 'prod.zip' };
  const { entries, pkg } = await packageOf(p);
  assert.equal(pkg.zipName, 'prod.zip');
  const names = Object.keys(entries);
  assert.ok(names.includes('conf.d/external.conf'));
  assert.ok(!names.some((n) => n.includes('disabled')));
  assert.ok(!names.some((n) => n.endsWith('.yml') && n !== 'manifest.yml'));
  assert.ok(!names.includes('routing-table.csv'));
});

test('the ZIP writer refuses unsafe or duplicate paths', () => {
  const base = { rootFolder: 'pkg', entries: [{ path: 'conf.d/a.conf', content: 'x' }] };
  assert.ok(zipPackage(base));
  assert.throws(() => zipPackage({ ...base, entries: [{ path: '../evil.conf', content: 'x' }] }), /Refusing/);
  assert.throws(() => zipPackage({ ...base, entries: [{ path: '/etc/passwd.conf', content: 'x' }] }), /Refusing/);
  assert.throws(() => zipPackage({ ...base, entries: [{ path: 'a.conf', content: 'x' }, { path: 'A.conf', content: 'y' }] }), /twice/);
  assert.throws(() => zipPackage({ rootFolder: '..', entries: base.entries }), /Invalid package folder/);
});
