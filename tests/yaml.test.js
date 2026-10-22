import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectToYaml, parseProjectYaml, MAX_IMPORT_BYTES } from '../js/core/yaml-io.js';
import { stripIds, compactProject } from '../js/core/schema.js';
import { sampleProject } from '../js/core/sample.js';
import { baseProject, buildAll, newProject } from './helpers.js';

const filesOf = (p) => buildAll(p).files.map((f) => `${f.path}\n${f.content}`);

function roundTrip(project) {
  const text = projectToYaml(project);
  const res = parseProjectYaml(text);
  assert.ok(res.ok, JSON.stringify(res.errors));
  assert.deepEqual(res.warnings, []);
  return { text, project: res.project };
}

test('export then import restores the same project and the same files', () => {
  for (const original of [sampleProject(), baseProject(), newProject('Empty project')]) {
    const { project } = roundTrip(original);
    assert.deepEqual(stripIds(project), stripIds(original));
    assert.deepEqual(filesOf(project), filesOf(original));
    // Exporting again gives identical YAML.
    assert.equal(projectToYaml(project), projectToYaml(original));
  }
});

test('tricky values survive the round trip', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.serverNames = ['_', '*.example.org', '~^(?<sub>.+)\\.example\\.org$', '10.0.0.1'];
  blk.customDirectives = '# keep\nadd_header X-Quote "a \\"b\\" c" always;\n\n  # indented\n';
  blk.responseHeaders = [{ name: 'Content-Security-Policy', value: "default-src 'self'; img-src * data:", always: true }];
  blk.locations[0].proxy.requestHeaders = [{ name: 'X-Empty', value: '' }, { name: 'X-Yes', value: 'yes' }, { name: 'X-Num', value: '0123' }];
  blk.locations[0].proxy.httpVersion = '1.0';
  p.settings.httpIncludes = ['upstreams.conf', 'conf.d/*.conf', '*.conf'];
  p.project.description = 'Line with: colon, #hash, and "quotes"';
  p.upstreams[0].servers[0].comment = 'null';
  const { project } = roundTrip(p);
  assert.deepEqual(stripIds(project), stripIds(p));
});

test('every inactive location section is left out of the YAML', () => {
  const p = baseProject();
  const loc = p.servers[0].blocks[0].locations[0];
  loc.type = 'return';
  loc.return = { code: 301, value: 'https://$host/' };
  const compact = compactProject(p);
  const out = compact.servers[0].blocks[0].locations[0];
  assert.equal(out.type, 'return');
  assert.ok(out.return && !out.proxyPass && !out.proxy);
});

test('malformed YAML gives a line number', () => {
  const res = parseProjectYaml('schemaVersion: 1\nproject:\n  name: "unterminated\nservers: []\n');
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /YAML syntax error on line \d+/);
  const tabs = parseProjectYaml('schemaVersion: 1\nproject:\n\tname: x\n');
  assert.equal(tabs.ok, false);
  const dupKey = parseProjectYaml('schemaVersion: 1\nproject: {name: a}\nproject: {name: b}\n');
  assert.equal(dupKey.ok, false);
  assert.match(dupKey.errors[0].message, /duplicate|duplicated/i);
});

test('schema version is required and checked', () => {
  assert.match(parseProjectYaml('project: {name: a}\n').errors[0].message, /missing/);
  assert.match(parseProjectYaml('schemaVersion: 2\nproject: {name: a}\n').errors[0].message, /newer version/);
  assert.match(parseProjectYaml('schemaVersion: "1"\nproject: {name: a}\n').errors[0].message, /whole number/);
  assert.match(parseProjectYaml('schemaVersion: 0\nproject: {name: a}\n').errors[0].message, /not a supported/);
  assert.match(parseProjectYaml('- a\n- b\n').errors[0].message, /mapping at the top level/);
  assert.match(parseProjectYaml('').errors[0].message, /empty/);
  assert.match(parseProjectYaml('schemaVersion: 1\nproject: {name: a}\n---\nschemaVersion: 1\n').errors[0].message, /more than one YAML document/);
});

test('wrong types are reported with their path; numbers and strings are coerced where safe', () => {
  const bad = parseProjectYaml(`schemaVersion: 1
project: {name: Types}
upstreams:
  - name: u
    keepalive: lots
    servers: "not a list"
    method: fastest
servers:
  - name: s
    enabled: maybe
    blocks: [{ listen: [{ port: 8080 }], locations: 5 }]
`);
  assert.equal(bad.ok, false);
  const paths = bad.errors.map((e) => e.path);
  assert.ok(paths.includes('upstreams[0].keepalive'), paths.join());
  assert.ok(paths.includes('upstreams[0].servers'));
  assert.ok(paths.includes('upstreams[0].method'));
  assert.ok(paths.includes('servers[0].enabled'));
  assert.ok(paths.includes('servers[0].blocks[0].locations'));

  const coerced = parseProjectYaml(`schemaVersion: 1
project: {name: Coerce}
upstreams:
  - name: u
    fileName: u.conf
    keepalive: "32"
    servers: [{ address: 10.0.0.1, port: "9000" }]
servers:
  - name: s
    blocks: [{ listen: [{ port: 8080 }], serverNames: _, locations: [{ path: /, proxy: { httpVersion: 1.1 } }] }]
`);
  assert.ok(coerced.ok, JSON.stringify(coerced.errors));
  assert.equal(coerced.project.upstreams[0].keepalive, 32);
  assert.equal(coerced.project.upstreams[0].servers[0].port, 9000);
  assert.deepEqual(coerced.project.servers[0].blocks[0].serverNames, ['_']);
  assert.equal(coerced.project.servers[0].blocks[0].locations[0].proxy.httpVersion, '1.1');
});

test('unknown fields are ignored with a warning; defaults fill missing fields', () => {
  const res = parseProjectYaml('schemaVersion: 1\nproject: {name: Old, owner: someone}\nservers: [{name: s, color: blue, blocks: []}]\nextra: true\n');
  assert.ok(res.ok);
  assert.deepEqual(res.warnings.map((w) => w.path).sort(), ['extra', 'project.owner', 'servers[0].color']);
  assert.equal(res.project.settings.nginxRoot, '/etc/nginx');
  assert.deepEqual(res.project.settings.httpIncludes, ['upstreams.conf', 'conf.d/*.conf']);
  assert.equal(res.project.servers[0].enabled, true);
});

test('unsafe content is rejected or inert', () => {
  const proto = parseProjectYaml('schemaVersion: 1\nproject: {name: x}\n__proto__: {polluted: true}\nservers: [{name: s, constructor: 1}]\n');
  assert.equal(proto.ok, false);
  assert.ok(proto.errors.some((e) => /__proto__/.test(e.path)));
  assert.equal(({}).polluted, undefined);
  const merge = parseProjectYaml('schemaVersion: 1\nproject:\n  <<: {__proto__: {polluted: true}}\n  name: x\n');
  assert.equal(({}).polluted, undefined);
  assert.equal(merge.ok, false);

  const fn = parseProjectYaml('schemaVersion: 1\nproject: {name: !!js/function "function () { return 1 }"}\n');
  assert.equal(fn.ok, false);
  assert.match(fn.errors[0].message, /unknown tag/);

  const html = parseProjectYaml('schemaVersion: 1\nproject: {name: "<img src=x onerror=alert(1)>"}\n');
  assert.ok(html.ok);
  assert.equal(html.project.project.name, '<img src=x onerror=alert(1)>', 'kept as plain text; the UI renders it as text');

  const multiline = parseProjectYaml('schemaVersion: 1\nproject: {name: "a\\nlisten 80;"}\n');
  assert.equal(multiline.ok, false);
  assert.match(multiline.errors[0].message, /single line/);
});

test('alias bombs and oversized files are stopped', () => {
  const lines = ['schemaVersion: 1', 'project: {name: bomb}', 'a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
  let prev = 'a';
  for (let i = 0; i < 8; i++) {
    lines.push(`l${i}: &l${i} [*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev},*${prev}]`);
    prev = `l${i}`;
  }
  lines.push(`servers: [{ name: s, blocks: [{ serverNames: *${prev} }] }]`);
  const started = Date.now();
  const res = parseProjectYaml(lines.join('\n'));
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /too large|repeated references|nested too deeply|expected text/.test(e.message)), JSON.stringify(res.errors.slice(0, 3)));
  assert.ok(Date.now() - started < 5000, 'stops quickly');

  const big = `schemaVersion: 1\nproject: {name: big}\n# ${'x'.repeat(MAX_IMPORT_BYTES)}\n`;
  assert.match(parseProjectYaml(big).errors[0].message, /limit/);
});

test('YAML export has a header, schemaVersion first, and no internal ids or anchors', () => {
  const text = projectToYaml(sampleProject());
  assert.match(text, /^# Nginx Config Generator project file \(schema version 1\)\./);
  assert.match(text.split('\n').find((l) => !l.startsWith('#')), /^schemaVersion: 1$/);
  assert.ok(!/\bid: /.test(text));
  assert.ok(!/[&*][a-z]/.test(text.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '').replace(/\*\.conf/g, '')));
});
