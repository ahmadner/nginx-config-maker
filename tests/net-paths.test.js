import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIPv4, isIPv6, isHostname, isCidr, isPort, serverNameKind, backendKind, isPlaceholderAddress, isPlaceholderDomain, hostForUrl,
} from '../js/core/net.js';
import { dirError, fileNameError, relativePathError, absPathError, globToRegExp, relativeInclude, joinPath, normalizeDir } from '../js/core/paths.js';
import { isTime, isSize, isRate, isBuffers, timeSeconds } from '../js/core/formats.js';

test('IPv4 addresses', () => {
  for (const ok of ['0.0.0.0', '10.20.30.40', '255.255.255.255', '192.0.2.1']) assert.ok(isIPv4(ok), ok);
  for (const bad of ['256.1.1.1', '10.1.1', '10.01.1.1', '1.2.3.4.5', '', 'a.b.c.d', ' 10.0.0.1']) assert.ok(!isIPv4(bad), bad);
});

test('IPv6 addresses', () => {
  for (const ok of ['::', '::1', '2001:db8::1', 'fe80::1:2:3:4', '2001:0db8:0000:0000:0000:ff00:0042:8329', '::ffff:192.0.2.1']) assert.ok(isIPv6(ok), ok);
  for (const bad of ['2001:db8:::1', '1:2:3:4:5:6:7:8:9', 'gggg::1', '12345::', ':', '[::1]', '2001:db8::1::2']) assert.ok(!isIPv6(bad), bad);
});

test('hostnames', () => {
  for (const ok of ['example.com', 'app01', 'a-b.example.org', 'xn--bcher-kva.example']) assert.ok(isHostname(ok), ok);
  for (const bad of ['-bad.com', 'bad-.com', 'a..b', 'under_score.com', '10.0.0.999', '', 'a'.repeat(64) + '.com', 'space here']) assert.ok(!isHostname(bad), bad);
});

test('CIDR ranges and ports', () => {
  assert.ok(isCidr('10.0.0.0/8'));
  assert.ok(isCidr('2001:db8::/32'));
  assert.ok(!isCidr('10.0.0.0/33'));
  assert.ok(!isCidr('10.0.0.0'));
  assert.ok(!isCidr('10.0.0.0/8/8'));
  assert.ok(isPort(1) && isPort(65535) && isPort(8444));
  for (const bad of [0, 65536, -1, 80.5, '80', null]) assert.ok(!isPort(bad), String(bad));
});

test('server names', () => {
  assert.equal(serverNameKind('_'), 'catchall');
  assert.equal(serverNameKind('visit.example.com'), 'exact');
  assert.equal(serverNameKind('*.example.com'), 'wildcard');
  assert.equal(serverNameKind('.example.com'), 'wildcard');
  assert.equal(serverNameKind('www.example.*'), 'wildcard');
  assert.equal(serverNameKind('~^(?<sub>.+)\\.example\\.com$'), 'regex');
  assert.equal(serverNameKind('10.20.30.41'), 'ip');
  assert.equal(serverNameKind('bad name'), null);
  assert.equal(serverNameKind('*.*.example.com'), null);
  assert.equal(serverNameKind('exa;mple.com'), null);
});

test('backend addresses', () => {
  assert.equal(backendKind('10.0.0.1'), 'ipv4');
  assert.equal(backendKind('2001:db8::1'), 'ipv6');
  assert.equal(backendKind('[2001:db8::1]'), 'ipv6');
  assert.equal(backendKind('app.internal'), 'hostname');
  assert.equal(backendKind('unix:/run/app.sock'), 'unix');
  assert.equal(backendKind('unix:relative.sock'), null);
  assert.equal(backendKind('http://10.0.0.1'), null);
  assert.equal(backendKind('10.0.0.1:80'), null);
  assert.equal(hostForUrl('2001:db8::1'), '[2001:db8::1]');
  assert.equal(hostForUrl('10.0.0.1'), '10.0.0.1');
});

test('placeholder detection', () => {
  assert.ok(isPlaceholderAddress('192.0.2.10'));
  assert.ok(isPlaceholderAddress('198.51.100.0/24'));
  assert.ok(isPlaceholderAddress('203.0.113.255'));
  assert.ok(isPlaceholderAddress('2001:db8::5'));
  assert.ok(!isPlaceholderAddress('10.20.30.40'));
  assert.ok(isPlaceholderDomain('visitor.example.com'));
  assert.ok(isPlaceholderDomain('*.example.org'));
  assert.ok(!isPlaceholderDomain('example.company.com'));
});

test('package folders and file names', () => {
  assert.equal(dirError(''), null);
  assert.equal(dirError('upstreams/external/v1'), null);
  assert.match(dirError('../etc'), /not allowed/);
  assert.match(dirError('upstreams/../../etc'), /not allowed/);
  assert.match(dirError('/etc/nginx'), /relative/);
  assert.match(dirError('C:/nginx'), /drive/);
  assert.match(dirError('conf.d\\sub'), /forward slashes/);
  assert.match(dirError('a//b'), /empty folder/);
  assert.match(dirError('con'), /reserved/);
  assert.match(dirError('my folder'), /space/);
  assert.match(dirError('.hidden'), /letters/);
  assert.equal(fileNameError('Api-Gateway.conf'), null);
  assert.equal(fileNameError('00-shared.conf'), null);
  assert.match(fileNameError('visitor'), /\.conf/);
  assert.match(fileNameError('.conf'), /must not start with \./);
  assert.match(fileNameError('a/b.conf'), /slashes/);
  assert.match(fileNameError('-rf.conf'), /start/);
  assert.match(fileNameError(''), /required/);
  assert.match(relativePathError('../x.conf'), /not allowed/);
  assert.equal(relativePathError('conf.d/disabled/x.conf'), null);
  assert.equal(normalizeDir('./conf.d/'), 'conf.d');
  assert.equal(joinPath('/var/log/nginx', '', 'external'), '/var/log/nginx/external');
});

test('absolute target paths', () => {
  assert.equal(absPathError('/etc/nginx/ssl/site/fullchain.pem'), null);
  assert.match(absPathError('ssl/cert.pem'), /absolute/);
  assert.match(absPathError('-----BEGIN PRIVATE KEY-----'), /contents/);
  assert.match(absPathError('data:-----BEGIN'), /contents|data:/);
  assert.match(absPathError('/etc/nginx/my cert.pem'), /spaces/);
  assert.match(absPathError('/etc/nginx/../shadow'), /\.\./);
  assert.match(absPathError('C:\\certs\\a.pem'), /Linux path/);
});

test('include globs behave like glob(3)', () => {
  const re = globToRegExp('conf.d/*.conf');
  assert.ok(re.test('conf.d/external.conf'));
  assert.ok(!re.test('conf.d/disabled/external.conf'), 'glob does not cross folders');
  assert.ok(!re.test('conf.d/external.conf.bak'));
  assert.ok(globToRegExp('upstreams/*/*.conf').test('upstreams/internal/a.conf'));
  assert.ok(globToRegExp('conf.d/[a-c]*.conf').test('conf.d/b.conf'));
  assert.equal(relativeInclude('/etc/nginx/conf.d/*.conf', '/etc/nginx'), 'conf.d/*.conf');
  assert.equal(relativeInclude('/opt/other/*.conf', '/etc/nginx'), '/opt/other/*.conf');
});

test('time, size and rate formats', () => {
  for (const ok of ['600s', '10m', '1h30m', '500ms', '60', '1d']) assert.ok(isTime(ok), ok);
  for (const bad of ['10 s', '1.5s', 's', '', '-1s']) assert.ok(!isTime(bad), bad);
  assert.equal(timeSeconds('1h30m'), 5400);
  for (const ok of ['100M', '16k', '0', '1g']) assert.ok(isSize(ok), ok);
  assert.ok(!isSize('100MB'));
  assert.ok(isRate('10r/s') && isRate('300r/m') && !isRate('10/s'));
  assert.ok(isBuffers('8 32k') && !isBuffers('8x32k'));
});
