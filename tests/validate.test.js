import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseProject, buildAll, upstream, server, proxy, location, errorsOf, findIssue, describeIssues, newProject } from './helpers.js';
import { sampleProject } from '../js/core/sample.js';

const expectIssue = (b, level, path, re) => {
  const hit = findIssue(b, level, path, re);
  assert.ok(hit, `expected ${level} at ${path} matching ${re}\n--- got:\n${describeIssues(b)}`);
  return hit;
};

test('a valid project has no errors', () => {
  const b = buildAll(baseProject());
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
});

test('the sample project has no errors, and warns about every placeholder', () => {
  const b = buildAll(sampleProject());
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
  const ph = b.issues.filter((i) => /placeholder/.test(i.message));
  assert.ok(ph.length >= 5, describeIssues(b));
});

test('empty project blocks export', () => {
  const b = buildAll(newProject('Empty'));
  expectIssue(b, 'error', 'project', /empty/);
  assert.equal(b.files.length, 0);
});

test('required fields', () => {
  const p = baseProject();
  p.project.name = '';
  p.upstreams[0].name = '';
  p.servers[0].name = '';
  p.servers[0].fileName = '';
  p.servers[0].blocks[0].locations[0].path = '';
  const b = buildAll(p);
  expectIssue(b, 'error', 'project.name', /required/);
  expectIssue(b, 'error', 'upstreams.0.name', /required/);
  expectIssue(b, 'error', 'servers.0.name', /required/);
  expectIssue(b, 'error', 'servers.0.fileName', /required/);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.path', /required/);
});

test('invalid ports, addresses and domains', () => {
  const p = baseProject();
  p.upstreams[0].servers[0].port = 70000;
  p.upstreams[0].servers[1].address = '10.0.0.300';
  p.upstreams[0].servers.push({ ...p.upstreams[0].servers[1], id: 'srv_x00001', address: '10.0.0.13', port: null });
  const blk = p.servers[0].blocks[0];
  blk.listen[0].port = 0;
  blk.listen.push({ id: 'ln_x00001', address: 'not an ip', port: 8080, ssl: false, defaultServer: false });
  blk.serverNames = ['good.example.org', 'bad_name.com', '*.*.example.com'];
  const b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.servers.0.port', /between 1 and 65535/);
  expectIssue(b, 'error', 'upstreams.0.servers.1.address', /not a valid/);
  expectIssue(b, 'error', 'upstreams.0.servers.2.port', /required/);
  expectIssue(b, 'error', 'servers.0.blocks.0.listen.0.port', /between 1 and 65535/);
  expectIssue(b, 'error', 'servers.0.blocks.0.listen.1.address', /not a valid listen address/);
  expectIssue(b, 'error', 'servers.0.blocks.0.serverNames', /bad_name\.com/);
  expectIssue(b, 'error', 'servers.0.blocks.0.serverNames', /\*\.\*\.example\.com/);
});

test('duplicate upstream names and output paths', () => {
  const p = baseProject();
  p.upstreams.push(upstream({ name: 'EXT_APP', outputDir: 'upstreams/external', fileName: 'App.conf', servers: [{ address: '10.0.0.20', port: 80 }] }));
  p.servers.push(server({ name: 'Copy', fileName: 'external.conf', blocks: [{ listen: [{ port: 9000 }], serverNames: ['_'] }] }));
  const b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.1.name', /already defined/);
  expectIssue(b, 'error', 'upstreams.1.fileName', /also used by upstream ext_app.*differ only in case/);
  expectIssue(b, 'error', 'servers.1.fileName', /also used by server configuration "External"/);
});

test('reserved package paths and file/folder collisions', () => {
  const p = baseProject();
  p.servers[0].outputDir = '';
  p.servers[0].fileName = 'upstreams.conf';
  p.upstreams.push(upstream({ name: 'u2', outputDir: 'conf.d/x.conf', fileName: 'u.conf', servers: [{ address: '10.0.0.30', port: 80 }] }));
  p.servers.push(server({ name: 'X', fileName: 'x.conf', blocks: [{ listen: [{ port: 9001 }], serverNames: ['_'] }] }));
  const b = buildAll(p);
  assert.ok(b.issues.some((i) => i.level === 'error' && /upstreams\.conf is also used/.test(i.message)), describeIssues(b));
  expectIssue(b, 'error', 'servers.1.fileName', /also used as a folder/);
});

test('missing and disabled upstream references', () => {
  const p = baseProject();
  p.servers[0].blocks[0].locations.push({ ...structuredClone(p.servers[0].blocks[0].locations[0]), id: 'loc_m00001', path: '/missing/', proxyPass: { target: 'upstream', upstream: 'ext_nowhere', scheme: 'http', address: '', port: null, uri: '' } });
  p.upstreams.push(upstream({ name: 'ext_off', fileName: 'off.conf', enabled: false, servers: [{ address: '10.0.0.40', port: 80 }] }));
  p.servers[0].blocks[0].locations.push({ ...structuredClone(p.servers[0].blocks[0].locations[0]), id: 'loc_m00002', path: '/off/', proxyPass: { target: 'upstream', upstream: 'ext_off', scheme: 'http', address: '', port: null, uri: '' } });
  const b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.1.proxyPass.upstream', /not defined/);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.2.proxyPass.upstream', /turned off/);
});

test('HTTPS needs certificate paths; certificates without SSL are flagged', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.listen[0].ssl = true;
  let b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.tls.certificate', /certificate path/);
  expectIssue(b, 'error', 'servers.0.blocks.0.tls.certificateKey', /private key path/);
  blk.listen[0].ssl = false;
  blk.tls.certificate = '/etc/nginx/ssl/a/fullchain.pem';
  blk.tls.certificateKey = '/etc/nginx/ssl/a/privkey.pem';
  b = buildAll(p);
  expectIssue(b, 'warning', 'servers.0.blocks.0.tls.certificate', /no listener has SSL/);
  blk.listen[0].ssl = true;
  blk.tls.certificateKey = '-----BEGIN PRIVATE KEY-----MIIE...';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.tls.certificateKey', /file contents/);
  assert.ok(!b.files.some((f) => f.content.includes('BEGIN PRIVATE KEY')) || errorsOf(b).length > 0);
  blk.redirectHttp.enabled = true;
  blk.redirectHttp.port = 8444;
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.redirectHttp.port', /already the HTTPS port/);
});

test('hash without key and backup with an incompatible method', () => {
  const p = baseProject();
  p.upstreams[0].method = 'hash';
  let b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.hashKey', /needs a key/);
  p.upstreams[0].hashKey = '$request_uri extra';
  b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.hashKey', /one value/);
  p.upstreams[0].method = 'ip_hash';
  p.upstreams[0].servers[1].backup = true;
  b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.servers.1.backup', /cannot be used with ip_hash/);
  p.upstreams[0].method = 'round_robin';
  p.upstreams[0].hashConsistent = true;
  b = buildAll(p);
  expectIssue(b, 'warning', 'upstreams.0.hashConsistent', /not written/);
  p.upstreams[0].servers.forEach((s) => { s.enabled = false; });
  b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.servers', /commented out/);
});

test('conflicting listen directives across server blocks', () => {
  const p = baseProject();
  p.servers.push(server({
    name: 'Second', fileName: 'second.conf',
    blocks: [
      { listen: [{ port: 8444, defaultServer: true }], serverNames: ['_', 'app.example.org'] },
      { listen: [{ port: 8444, ssl: true }], serverNames: ['app.example.org'], tls: { certificate: '/etc/nginx/ssl/a.pem', certificateKey: '/etc/nginx/ssl/a.key' } },
    ],
  }));
  const b = buildAll(p);
  expectIssue(b, 'error', 'servers.1.blocks.0.listen.0', /already has a default server/);
  expectIssue(b, 'error', 'servers.1.blocks.0.serverNames', /"_".*also used by "External"/);
  expectIssue(b, 'error', 'servers.1.blocks.1.serverNames', /app\.example\.org.*also used/);
  assert.ok(b.issues.some((i) => i.level === 'error' && /uses SSL in .* but not here/.test(i.message)), describeIssues(b));

  // Disabled configurations do not take part.
  p.servers[1].enabled = false;
  const b2 = buildAll(p);
  assert.ok(!b2.issues.some((i) => /default server|conflicting server name/.test(i.message)), describeIssues(b2));
});

test('duplicate locations and listen entries in one block', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.locations.push({ ...structuredClone(blk.locations[0]), id: 'loc_dup001', match: 'prefix_no_regex' });
  blk.listen.push({ ...blk.listen[0], id: 'ln_dup0001', defaultServer: false });
  const b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.1.path', /already defined/);
  expectIssue(b, 'error', 'servers.0.blocks.0.listen.1.port', /listed twice/);
});

test('proxy_pass path rules: regex locations and trailing slashes', () => {
  const p = baseProject();
  const loc = p.servers[0].blocks[0].locations[0];
  loc.match = 'regex';
  loc.path = '^/api/(.*)$';
  loc.proxyPass.uri = '/v1/';
  let b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.proxyPass.uri', /regex location/);
  loc.match = 'prefix';
  loc.path = '/api';
  b = buildAll(p);
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.proxyPass.uri', /trailing slash/);
  loc.proxyPass.uri = 'v1';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.proxyPass.uri', /start with \//);
});

test('timeouts, sizes and other formats', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.clientMaxBodySize = '100MB';
  blk.proxy.readTimeout = '10 minutes';
  blk.locations[0].proxy.buffers = '8x32k';
  p.upstreams[0].servers[0].failTimeout = 'thirty';
  p.upstreams[0].keepalive = 0;
  const b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.clientMaxBodySize', /size/);
  expectIssue(b, 'error', 'servers.0.blocks.0.proxy.readTimeout', /time/);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.proxy.buffers', /number and a size/);
  expectIssue(b, 'error', 'upstreams.0.servers.0.failTimeout', /time/);
  expectIssue(b, 'error', 'upstreams.0.keepalive', /between 1/);
});

test('keepalive upstreams need HTTP/1.1 and a cleared Connection header', () => {
  const p = baseProject();
  p.servers[0].blocks[0].locations[0].proxy.includeParams = false;
  let b = buildAll(p);
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.proxyPass.upstream', /never reused/);
  p.servers[0].blocks[0].proxy.httpVersion = '1.1';
  p.servers[0].blocks[0].proxy.clearConnectionHeader = true;
  b = buildAll(p);
  assert.ok(!findIssue(b, 'warning', 'servers.0.blocks.0.locations.0.proxyPass.upstream', /never reused/));
});

test('custom directives: syntax, context, duplicates and unsafe content', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  const loc = blk.locations[0];
  loc.customDirectives = 'proxy_read_timeout 60s\n';
  let b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.customDirectives', /missing a terminating ";"/);

  loc.customDirectives = 'listen 9999;';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.customDirectives', /"listen" is not allowed in a location block/);

  loc.customDirectives = '}';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.customDirectives', /unexpected "}"/);

  loc.customDirectives = 'proxy_pass http://elsewhere;';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0', /"proxy_pass" is set 2 times/);

  loc.customDirectives = 'proxy_http_version 1.0;';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0', /"proxy_http_version" is set 2 times.*shared proxy parameters/);

  loc.customDirectives = 'frobnicate on;\ninclude /etc/nginx/extra.conf;\ncontent_by_lua_block { ngx.say("hi") }';
  b = buildAll(p);
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.customDirectives', /unknown directive "frobnicate"/);
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.customDirectives', /not part of this package/);
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.customDirectives', /runs code/);

  loc.customDirectives = '';
  blk.customDirectives = 'ssl_protocols TLSv1 TLSv1.2;\nssl_certificate_key data:-----BEGIN PRIVATE KEY-----abc;';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.customDirectives', /insecure protocol/);
  expectIssue(b, 'error', 'servers.0.blocks.0.customDirectives', /key material/);

  blk.customDirectives = 'location /nested/ {\n    listen 80;\n}';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.customDirectives', /line 2: "listen" is not allowed in a location block/);

  blk.customDirectives = '';
  p.upstreams[0].customDirectives = 'server { }';
  b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.customDirectives', /takes an address/);

  // Custom-directive issues point at the right line of the generated file.
  p.upstreams[0].customDirectives = '';
  loc.customDirectives = 'add_header X-A 1;\nbogus_directive 1;';
  b = buildAll(p);
  const issue = expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.customDirectives', /bogus_directive/);
  const fileLines = b.files.find((f) => f.path === issue.file).content.split('\n');
  assert.match(fileLines[issue.line - 1], /bogus_directive/);
});

test('files that nginx.conf would not load, or would load twice', () => {
  const p = baseProject();
  p.servers[0].outputDir = 'sites';
  let b = buildAll(p);
  expectIssue(b, 'warning', 'servers.0.outputDir', /not loaded by nginx\.conf/);
  p.servers[0].outputDir = 'conf.d';
  p.settings.httpIncludes = ['upstreams.conf', 'conf.d/*.conf', 'upstreams/external/*.conf'];
  b = buildAll(p);
  expectIssue(b, 'error', 'upstreams.0.outputDir', /loaded twice/);
  p.settings.httpIncludes = ['upstreams.conf', 'conf.d/*.conf', 'conf.d/*/*.conf'];
  p.servers[0].enabled = false;
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.fileName', /turned off, but it is still loaded/);
});

test('rate limit zones and access rules', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.rateLimit.zone = 'nope';
  blk.access.rules = [{ action: 'deny', source: 'all' }, { action: 'allow', source: '10.0.0.0/8' }, { action: 'allow', source: '10.0.0.0/33' }];
  p.rateLimitZones.push({ name: 'a', key: '$binary_remote_addr', size: '10m', rate: '10 per second' }, { name: 'a', key: '$binary_remote_addr', size: '10m', rate: '1r/s' });
  const b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.rateLimit.zone', /not defined/);
  expectIssue(b, 'warning', 'servers.0.blocks.0.access.rules.1.source', /never matches/);
  expectIssue(b, 'error', 'servers.0.blocks.0.access.rules.2.source', /not an IP address/);
  expectIssue(b, 'error', 'rateLimitZones.0.rate', /10r\/s/);
  expectIssue(b, 'error', 'rateLimitZones.1.name', /defined twice/);
});

test('static locations: alias traversal and root/alias mix-ups', () => {
  const p = baseProject();
  const loc = p.servers[0].blocks[0].locations[0];
  loc.type = 'static';
  loc.path = '/files';
  loc.static = { root: '', alias: '/srv/files/', index: '', tryFiles: '' };
  let b = buildAll(p);
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations.0.static.alias', /path traversal/);
  loc.static.root = '/srv';
  b = buildAll(p);
  expectIssue(b, 'error', 'servers.0.blocks.0.locations.0.static.alias', /not both/);
});

test('multiple environments in separate projects stay independent', () => {
  const prod = baseProject('Production');
  const dr = baseProject('DR');
  dr.upstreams[0].servers[0].address = '10.9.0.11';
  dr.project.environment = 'dr';
  const a = buildAll(prod).files.find((f) => f.kind === 'upstream').content;
  const c = buildAll(dr).files.find((f) => f.kind === 'upstream').content;
  assert.ok(a.includes('10.0.0.11') && c.includes('10.9.0.11'));
  assert.ok(a.includes('project "Production"') && c.includes('project "DR"'));
});

test('a commented-out location does not collide, and its own errors are warnings', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.locations.push(location({ ...blk.locations[0], enabled: false, proxyPass: { target: 'upstream', upstream: 'ext_gone', scheme: 'http', uri: '' } }));
  const b = buildAll(p);
  const LP = 'servers.0.blocks.0.locations.1';

  // Same path as location 1, and a missing upstream: nginx reads neither, so nothing blocks the package.
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
  expectIssue(b, 'warning', `${LP}.proxyPass.upstream`, /not defined in this project/);

  // Turned on again, both problems are errors.
  blk.locations[1].enabled = true;
  const on = buildAll(p);
  expectIssue(on, 'error', `${LP}.path`, /already defined in this server block/);
  expectIssue(on, 'error', `${LP}.proxyPass.upstream`, /not defined in this project/);
});

test('a block whose locations are all commented out is only a warning', () => {
  const p = baseProject();
  p.servers[0].blocks[0].locations[0].enabled = false;
  const b = buildAll(p);
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
  expectIssue(b, 'warning', 'servers.0.blocks.0.locations', /Every location in this block is commented out/);
});
