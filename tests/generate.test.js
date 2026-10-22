import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseProject, buildAll, contentOf, fileAt, upstream, server, proxy, errorsOf, describeIssues, newProject } from './helpers.js';
import { parseConfig } from '../js/core/syntax.js';

const lines = (text) => text.split('\n').map((l) => l.trim());

test('upstream file follows the reference layout', () => {
  const p = baseProject();
  p.upstreams[0].servers[0].enabled = false;
  p.settings.format.headerComments = false;
  const b = buildAll(p);
  assert.equal(contentOf(b, 'upstreams/external/app.conf'), [
    'upstream ext_app {',
    '    # server 10.0.0.11:9000;',
    '    server 10.0.0.12:9000;',
    '    keepalive 32;',
    '}',
    '',
  ].join('\n'));
});

test('load-balancing methods and server parameters', () => {
  const cases = [
    [{ method: 'least_conn' }, 'least_conn;'],
    [{ method: 'ip_hash' }, 'ip_hash;'],
    [{ method: 'hash', hashKey: '$request_uri', hashConsistent: true }, 'hash $request_uri consistent;'],
    [{ method: 'hash', hashKey: '$remote_addr' }, 'hash $remote_addr;'],
    [{ method: 'random' }, 'random;'],
    [{ method: 'random', randomTwo: true }, 'random two least_conn;'],
  ];
  for (const [values, expected] of cases) {
    const p = newProject('LB');
    p.upstreams.push(upstream({ name: 'u', fileName: 'u.conf', servers: [{ address: '10.0.0.1', port: 80 }], ...values }));
    const text = contentOf(buildAll(p), 'upstreams/u.conf');
    assert.ok(lines(text).includes(expected), `${expected}\n${text}`);
    // The method must come before keepalive.
    assert.ok(text.indexOf(expected) < text.indexOf('keepalive'), text);
  }
  const p = newProject('Params');
  p.upstreams.push(upstream({
    name: 'u', fileName: 'u.conf', zoneSize: '64k', keepaliveRequests: 1000, keepaliveTime: '1h', keepaliveTimeout: '60s',
    servers: [
      { address: '10.0.0.1', port: 80, weight: 3, maxFails: 2, failTimeout: '30s', maxConns: 100 },
      { address: '2001:db8::5', port: 8080, backup: true, comment: 'standby' },
      { address: 'unix:/run/app.sock', down: true },
    ],
  }));
  const text = contentOf(buildAll(p), 'upstreams/u.conf');
  assert.ok(text.includes('zone u 64k;'));
  assert.ok(text.includes('server 10.0.0.1:80 weight=3 max_conns=100 max_fails=2 fail_timeout=30s;'));
  assert.ok(text.includes('server [2001:db8::5]:8080 backup;  # standby'));
  assert.ok(text.includes('server unix:/run/app.sock down;'));
  assert.ok(/keepalive\s+32;/.test(text) && /keepalive_requests\s+1000;/.test(text) && /keepalive_time\s+1h;/.test(text) && /keepalive_timeout\s+60s;/.test(text));
  assert.deepEqual(parseConfig(text).errors, []);
});

test('server configuration mirrors the reference external.conf', () => {
  const p = newProject('Ref');
  p.settings.format.headerComments = false;
  p.upstreams.push(upstream({ name: 'ext_billing', outputDir: 'upstreams/external', fileName: 'billing.conf', servers: [{ address: '10.0.0.1', port: 9000 }] }));
  p.upstreams.push(upstream({ name: 'ext_reports', outputDir: 'upstreams/external', fileName: 'reports.conf', servers: [{ address: '10.0.0.1', port: 9002 }] }));
  p.servers.push(server({
    name: 'External', category: 'external', fileName: 'external.conf',
    blocks: [{
      listen: [{ port: 8444, defaultServer: true }], serverNames: ['_'], clientMaxBodySize: '100M', logging: { perLocation: true },
      locations: [
        proxy('/billing/', 'ext_billing', { group: 'Pair A (11/12)' }),
        proxy('/reports/', 'ext_reports', { group: 'Pair A (11/12)', proxy: { readTimeout: '600s' } }),
      ],
    }],
  }));
  const text = contentOf(buildAll(p), 'conf.d/external.conf');
  assert.ok(text.includes([
    '    # ── Pair A (11/12) ──',
  ][0]));
  assert.ok(text.includes([
    '    location /billing/ {',
    '        access_log /var/log/nginx/external/billing.access.log main;',
    '        error_log  /var/log/nginx/external/billing.error.log;',
    '        include    /etc/nginx/proxy_params.conf;',
    '        proxy_pass http://ext_billing;',
    '    }',
    '    location /reports/ {',
    '        access_log /var/log/nginx/external/reports.access.log main;',
    '        error_log  /var/log/nginx/external/reports.error.log;',
    '        include    /etc/nginx/proxy_params.conf;',
    '        proxy_read_timeout 600s;',
    '        proxy_pass http://ext_reports;',
    '    }',
  ].join('\n')), text);
  assert.ok(text.includes('access_log /var/log/nginx/external/_default.access.log main;'));
  assert.ok(text.includes('client_max_body_size 100M;'));
});

test('upstream index lists each folder once, or each file', () => {
  const p = baseProject();
  p.upstreams.push(upstream({ name: 'ext_visitor', outputDir: 'upstreams/external/v1', fileName: 'visitor.conf', servers: [{ address: '10.0.0.5', port: 80 }] }));
  p.upstreams.push(upstream({ name: 'int_api', outputDir: 'upstreams/internal', fileName: 'api.conf', servers: [{ address: '10.0.0.6', port: 80 }] }));
  p.upstreams.push(upstream({ name: 'off', outputDir: 'upstreams/internal', fileName: 'off.conf', enabled: false, servers: [{ address: '10.0.0.7', port: 80 }] }));
  let text = contentOf(buildAll(p), 'upstreams.conf');
  assert.deepEqual(lines(text).filter((l) => l.startsWith('include')), [
    'include /etc/nginx/upstreams/external/*.conf;',
    'include /etc/nginx/upstreams/external/v1/*.conf;',
    'include /etc/nginx/upstreams/internal/*.conf;',
  ]);
  p.settings.upstreamIndex.style = 'files';
  text = contentOf(buildAll(p), 'upstreams.conf');
  assert.deepEqual(lines(text).filter((l) => l.startsWith('include')), [
    'include /etc/nginx/upstreams/external/app.conf;',
    'include /etc/nginx/upstreams/external/v1/visitor.conf;',
    'include /etc/nginx/upstreams/internal/api.conf;',
  ]);
  p.settings.nginxRoot = '/opt/nginx/conf';
  assert.ok(contentOf(buildAll(p), 'upstreams.conf').includes('include /opt/nginx/conf/upstreams/external/app.conf;'));
});

test('disabled entities go to the disabled folder, or are left out', () => {
  const p = baseProject();
  p.servers[0].enabled = false;
  p.upstreams.push(upstream({ name: 'parked', outputDir: 'upstreams/external', fileName: 'parked.conf', enabled: false, servers: [{ address: '10.0.0.9', port: 80 }] }));
  let b = buildAll(p);
  assert.ok(fileAt(b, 'conf.d/disabled/external.conf'));
  assert.ok(fileAt(b, 'upstreams/external/disabled/parked.conf'));
  assert.ok(!contentOf(b, 'upstreams.conf').includes('disabled'));
  p.settings.package.includeDisabled = false;
  b = buildAll(p);
  assert.ok(!fileAt(b, 'conf.d/disabled/external.conf'));
  assert.ok(!b.files.some((f) => f.path.includes('/disabled/')));
});

test('shared include files are generated only when something includes them', () => {
  const p = baseProject();
  let b = buildAll(p);
  assert.ok(fileAt(b, 'proxy_params.conf'));
  assert.ok(!fileAt(b, 'ssl_params.conf'));
  assert.ok(!fileAt(b, 'security_headers.conf'));
  assert.ok(!fileAt(b, 'conf.d/00-shared.conf'));
  p.servers[0].blocks[0].locations[0].proxy.includeParams = false;
  b = buildAll(p);
  assert.ok(!fileAt(b, 'proxy_params.conf'));
  p.settings.proxyParams.path = 'snippets/proxy.conf';
  p.servers[0].blocks[0].locations[0].proxy.includeParams = true;
  b = buildAll(p);
  assert.match(contentOf(b, 'conf.d/external.conf'), /include\s+\/etc\/nginx\/snippets\/proxy\.conf;/);
  assert.ok(fileAt(b, 'snippets/proxy.conf'));
});

test('HTTPS server with TLS, security headers, HTTP/2 and redirect', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.listen = [{ id: 'ln_aaaaaa', address: '', port: 443, ssl: true, defaultServer: false }, { id: 'ln_bbbbbb', address: '::', port: 443, ssl: true, defaultServer: false }];
  blk.serverNames = ['www.example.com', 'example.com'];
  blk.http2 = true;
  blk.tls = { certificate: '/etc/nginx/ssl/example.com/fullchain.pem', certificateKey: '/etc/nginx/ssl/example.com/privkey.pem', includeParams: true };
  blk.securityHeaders = true;
  blk.redirectHttp = { enabled: true, port: 80, code: 308 };
  let b = buildAll(p);
  let text = contentOf(b, 'conf.d/external.conf');
  assert.ok(text.includes('listen      443 ssl http2;'), text);
  assert.ok(text.includes('listen      [::]:443 ssl http2;'));
  assert.ok(text.includes('ssl_certificate     /etc/nginx/ssl/example.com/fullchain.pem;'));
  assert.ok(text.includes('include /etc/nginx/ssl_params.conf;'));
  assert.ok(text.includes('include /etc/nginx/security_headers.conf;'));
  assert.ok(text.includes('return 308 https://$host$request_uri;'));
  assert.ok(text.includes('listen      [::]:80;'));
  assert.ok(contentOf(b, 'ssl_params.conf').includes('ssl_protocols             TLSv1.2 TLSv1.3;'));
  assert.ok(contentOf(b, 'security_headers.conf').includes('add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'));
  assert.deepEqual(errorsOf(b), [], describeIssues(b));

  // Nginx 1.25.1+: http2 becomes a server-level directive.
  p.settings.nginxVersion = '1.25-or-newer';
  text = contentOf(buildAll(p), 'conf.d/external.conf');
  assert.ok(text.includes('listen      443 ssl;') && text.includes('http2 on;'), text);

  // A non-standard HTTPS port is kept in the redirect target.
  blk.listen = [{ id: 'ln_cccccc', address: '', port: 9444, ssl: true, defaultServer: false }];
  text = contentOf(buildAll(p), 'conf.d/external.conf');
  assert.ok(text.includes('return 308 https://$host:9444$request_uri;'), text);
});

test('proxy settings: headers, timeouts, buffers, body size, websocket', () => {
  const p = baseProject();
  const loc = p.servers[0].blocks[0].locations[0];
  loc.proxy = {
    ...loc.proxy, includeParams: false, httpVersion: '1.1', clearConnectionHeader: true, hostHeader: '$http_host', realIp: true, forwardedFor: true, forwardedProto: true,
    requestHeaders: [{ name: 'X-Request-Id', value: '$request_id' }], connectTimeout: '5s', sendTimeout: '30s', readTimeout: '300s',
    buffering: 'off', requestBuffering: 'off', bufferSize: '16k', buffers: '8 32k', busyBuffersSize: '64k', redirect: 'off', hideHeaders: ['X-Powered-By'],
  };
  loc.clientMaxBodySize = '20M';
  loc.sendTimeout = '90s';
  const text = contentOf(buildAll(p), 'conf.d/external.conf');
  for (const expected of [
    'proxy_set_header Host              $http_host;', 'proxy_set_header X-Request-Id      $request_id;',
    'proxy_http_version 1.1;', 'proxy_set_header   Connection "";',
    'proxy_connect_timeout 5s;', 'proxy_send_timeout    30s;', 'proxy_read_timeout    300s;',
    'proxy_buffering         off;', 'proxy_request_buffering off;', 'proxy_buffers           8 32k;',
    'proxy_redirect    off;', 'proxy_hide_header X-Powered-By;',
    'client_max_body_size 20M;', 'send_timeout         90s;',
  ]) assert.ok(text.includes(expected), `${expected}\n${text}`);

  loc.proxy.websocket = true;
  const b = buildAll(p);
  const ws = contentOf(b, 'conf.d/external.conf');
  assert.ok(ws.includes('proxy_set_header   Upgrade $http_upgrade;'));
  assert.ok(ws.includes('proxy_set_header   Connection $connection_upgrade;'));
  assert.ok(!ws.includes('Connection "";'), 'websocket replaces the cleared Connection header');
  assert.ok(contentOf(b, 'conf.d/00-shared.conf').includes('map $http_upgrade $connection_upgrade {'));
});

test('a location that sets its own headers keeps the server-level ones', () => {
  const p = baseProject();
  const blk = p.servers[0].blocks[0];
  blk.proxy = { ...blk.proxy, hostHeader: '$host', realIp: true };
  blk.securityHeaders = true;
  blk.responseHeaders = [{ name: 'X-Env', value: 'prod', always: true }];
  const loc = blk.locations[0];
  loc.proxy.includeParams = false;
  loc.proxy.requestHeaders = [{ name: 'X-Custom', value: '1' }, { name: 'Host', value: 'backend.local' }];
  loc.responseHeaders = [{ name: 'Cache-Control', value: 'no-store', always: false }];
  const b = buildAll(p);
  const text = contentOf(b, 'conf.d/external.conf');
  const locText = text.slice(text.indexOf('location /app/'));
  // proxy_set_header: X-Real-IP repeated, Host overridden by the location (not repeated).
  assert.ok(locText.includes('proxy_set_header X-Real-IP $remote_addr;'), locText);
  assert.equal((locText.match(/proxy_set_header Host /g) || []).length, 1);
  assert.ok(locText.includes('backend.local'));
  // add_header: security headers re-included, X-Env repeated, own header kept.
  assert.ok(locText.includes('include /etc/nginx/security_headers.conf;') || locText.includes('X-Frame-Options'), locText);
  assert.ok(locText.includes('add_header X-Env'));
  assert.ok(locText.includes('add_header Cache-Control'));
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
});

test('location types: return, static, health, status, direct proxy, methods, access, rate limit', () => {
  const p = baseProject();
  p.rateLimitZones.push({ name: 'api', key: '$binary_remote_addr', size: '10m', rate: '10r/s' });
  const blk = p.servers[0].blocks[0];
  blk.locations.push(
    { ...blk.locations[0], id: 'loc_r00001', path: '/', match: 'exact', type: 'return', return: { code: 301, value: 'https://$host/app/' } },
    { ...blk.locations[0], id: 'loc_s00001', path: '/assets/', type: 'static', static: { root: '', alias: '/srv/assets/', index: 'index.html', tryFiles: '$uri =404' } },
    { ...blk.locations[0], id: 'loc_h00001', path: '/healthz', match: 'exact', type: 'health', health: { text: 'up' } },
    { ...blk.locations[0], id: 'loc_t00001', path: '/nginx_status', match: 'exact', type: 'status', access: { rules: [{ action: 'allow', source: '127.0.0.1' }, { action: 'deny', source: 'all' }], basicAuthRealm: '', basicAuthUserFile: '' } },
    { ...blk.locations[0], id: 'loc_d00001', path: '/legacy/', type: 'proxy', proxyPass: { target: 'direct', upstream: '', scheme: 'https', address: '10.0.0.50', port: 8443, uri: '/' }, proxy: { ...blk.locations[0].proxy, sslServerName: true } },
    { ...blk.locations[0], id: 'loc_m00001', path: '/api/', methods: ['GET', 'POST'], rateLimit: { zone: 'api', burst: 20, nodelay: true, status: 429 }, access: { rules: [], basicAuthRealm: 'Staff', basicAuthUserFile: '/etc/nginx/htpasswd' } },
  );
  const b = buildAll(p);
  const text = contentOf(b, 'conf.d/external.conf');
  for (const expected of [
    'location = / {', 'return 301 https://$host/app/;',
    'location /assets/ {', 'alias     /srv/assets/;', 'try_files $uri =404;',
    'location = /healthz {', 'access_log off;', 'return 200 "up\\n";',
    'location = /nginx_status {', 'stub_status;', 'deny  all;',
    'proxy_pass https://10.0.0.50:8443/;', 'proxy_ssl_server_name on;',
    'limit_except GET POST {', 'limit_req        zone=api burst=20 nodelay;', 'limit_req_status 429;',
    'auth_basic           "Staff";', 'auth_basic_user_file /etc/nginx/htpasswd;',
  ]) assert.ok(text.includes(expected), `${expected}\n${text}`);
  assert.ok(contentOf(b, 'conf.d/00-shared.conf').includes('limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;'));
  assert.deepEqual(parseConfig(text).errors, []);
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
});

test('custom directives are kept verbatim at their context', () => {
  const p = baseProject();
  const cfg = p.servers[0];
  cfg.httpDirectives = 'map $http_x_env $env_name {\n    default prod;\n}';
  cfg.blocks[0].customDirectives = '# server level\nlarge_client_header_buffers 4 16k;';
  cfg.blocks[0].locations[0].customDirectives = '    proxy_next_upstream error timeout;\n    proxy_next_upstream_tries 2;';
  p.upstreams[0].customDirectives = 'resolver 10.0.0.2;';
  const b = buildAll(p);
  const text = contentOf(b, 'conf.d/external.conf');
  assert.ok(text.startsWith('# Generated by') && text.includes('map $http_x_env $env_name {\n    default prod;\n}\n'), text);
  assert.ok(text.includes('    # server level\n    large_client_header_buffers 4 16k;'));
  assert.ok(text.includes('        proxy_next_upstream error timeout;\n        proxy_next_upstream_tries 2;'));
  assert.ok(contentOf(b, 'upstreams/external/app.conf').includes('    resolver 10.0.0.2;'));
  assert.deepEqual(errorsOf(b), [], describeIssues(b));
});

test('multiple server blocks in one file, nested output paths, custom formatting', () => {
  const p = baseProject();
  const cfg = p.servers[0];
  cfg.outputDir = 'conf.d';
  cfg.blocks.push({ ...structuredClone(cfg.blocks[0]), id: 'blk_second1', label: 'Second', listen: [{ id: 'ln_second1', address: '10.0.0.5', port: 8080, ssl: false, defaultServer: false }], serverNames: ['api.internal'] });
  p.upstreams[0].outputDir = 'upstreams/external/v1/extra';
  p.settings.format = { indent: 2, alignValues: false, headerComments: false };
  const b = buildAll(p);
  const text = contentOf(b, 'conf.d/external.conf');
  assert.equal((text.match(/^server \{/gm) || []).length, 2);
  assert.ok(text.includes('# Second\nserver {\n  listen 10.0.0.5:8080;\n  server_name api.internal;'), text);
  assert.ok(fileAt(b, 'upstreams/external/v1/extra/app.conf'));
  assert.ok(contentOf(b, 'upstreams.conf').includes('include /etc/nginx/upstreams/external/v1/extra/*.conf;'));
  assert.ok(!text.startsWith('#'));
});

test('generated text is identical for identical input', () => {
  const a = buildAll(baseProject()).files.map((f) => f.content).join('\n');
  const b = buildAll(baseProject()).files.map((f) => f.content).join('\n');
  assert.equal(a, b);
});
