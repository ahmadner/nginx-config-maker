// Validation rules. Errors block exporting the configuration package; warnings need review; info notes
// describe requirements outside the package (modules, nginx.conf, files on the server).
//
// Passing these checks does not prove Nginx will accept the configuration: only "nginx -t" on the target
// server, with its modules, nginx.conf, certificates and log folders, can do that.

import { analyzeFiles } from './analyze.js';
import { upstreamReferences, locationLabel } from './model.js';
import { backendKind, isAccessSource, isIP, isHostname, serverNameKind, isPort, isPlaceholderAddress, isPlaceholderDomain, isIPv6, stripBrackets } from './net.js';
import { absPathError, dirError, fileNameError, relativePathError, segmentError, includePatternError, relativeInclude, globToRegExp } from './paths.js';
import {
  isTime, isSize, isRate, isBuffers, isHeaderName, isIdentifier, isLogFormatName, isSingleLine, isPlainToken,
  HTTP_METHODS, REFERRER_POLICIES, TLS_PROTOCOLS, INSECURE_TLS, LOG_LEVELS,
} from './formats.js';
import { t, slugify } from './util.js';

const REDIRECT_CODES = [301, 302, 307, 308];

export function validateProject(project, gen) {
  const v = new Validator(project, gen);
  v.run();
  return v.issues;
}

class Validator {
  constructor(project, gen) {
    this.p = project;
    this.s = project.settings;
    this.gen = gen;
    this.issues = [];
    this.once = new Set();
    this.soft = false;
  }

  add(level, path, message, extra = {}) {
    // Inside a commented-out location nothing reaches nginx, so its problems never block the package.
    this.issues.push({ level: this.soft && level === 'error' ? 'warning' : level, path, message, ...extra });
  }

  error(path, message) { this.add('error', path, message); }
  warn(path, message) { this.add('warning', path, message); }
  info(path, message) { this.add('info', path, message); }

  /** Info that should appear only once per project. */
  note(key, path, message) {
    if (this.once.has(key)) return;
    this.once.add(key);
    this.info(path, message);
  }

  run() {
    this.projectRules();
    this.settingsRules();
    this.zoneRules();
    this.upstreamRules();
    this.serverRules();
    this.listenConflicts();
    this.fileRules();
    this.placeholderRules();
    for (const issue of analyzeFiles(this.gen.files, this.gen.snippets)) this.issues.push(issue);
  }

  used(key) {
    return this.gen.used[key].length > 0;
  }

  // ---------- Project and settings ----------
  projectRules() {
    const name = t(this.p.project.name);
    if (!name) this.error('project.name', 'Project name is required.');
    else if (name.length > 100) this.warn('project.name', 'Project name is longer than 100 characters.');
    if (!this.p.servers.length && !this.p.upstreams.length) {
      this.error('project', 'The project is empty. Add a server configuration or an upstream group to export a package.');
    }
  }

  settingsRules() {
    const s = this.s;
    const P = 'settings';
    const rootErr = absPathError(s.nginxRoot);
    if (rootErr) this.error(`${P}.nginxRoot`, `Nginx directory ${rootErr}.`);
    const logErr = absPathError(s.logRoot);
    if (logErr) this.error(`${P}.logRoot`, `Log directory ${logErr}.`);
    if (t(s.logFormat) && !isLogFormatName(t(s.logFormat))) this.error(`${P}.logFormat`, 'Log format name may only contain letters, digits and underscores.');

    if (!s.httpIncludes.some((x) => t(x))) {
      this.warn(`${P}.httpIncludes`, 'No include patterns are listed, so the generator cannot check that nginx.conf loads the generated files.');
    }
    s.httpIncludes.forEach((pat, k) => {
      if (!t(pat)) return;
      const err = includePatternError(pat);
      if (err) this.error(`${P}.httpIncludes.${k}`, `Include pattern ${err}.`);
      else if (relativeInclude(t(pat), t(s.nginxRoot)).startsWith('/')) this.info(`${P}.httpIncludes.${k}`, `"${t(pat)}" is outside the Nginx directory ${t(s.nginxRoot)}, so no generated file can match it.`);
    });
    for (const key of ['serverDir', 'upstreamDir']) {
      const err = dirError(s[key]);
      if (err) this.error(`${P}.${key}`, `Folder ${err}.`);
    }
    const dErr = segmentError(t(s.disabledDirName));
    if (dErr) this.error(`${P}.disabledDirName`, `Disabled folder name: ${dErr}.`);

    if (s.upstreamIndex.enabled && this.p.upstreams.some((u) => u.enabled)) {
      const err = relativePathError(s.upstreamIndex.path);
      if (err) this.error(`${P}.upstreamIndex.path`, `Upstream index path ${err}.`);
    }
    if (this.gen.files.some((f) => f.kind === 'shared')) {
      const err = relativePathError(s.sharedHttpPath);
      if (err) this.error(`${P}.sharedHttpPath`, `Shared http file path ${err}.`);
    }
    for (const key of ['proxyParams', 'sslParams', 'securityHeaders']) {
      if (!this.used(key)) continue;
      const err = relativePathError(s[key].path);
      if (err) this.error(`${P}.${key}.path`, `File path ${err}.`);
    }

    const indent = s.format.indent;
    if (indent !== null && (indent < 2 || indent > 8)) this.error(`${P}.format.indent`, 'Indentation must be between 2 and 8 spaces.');
    const pkg = s.package;
    if (t(pkg.rootFolder)) {
      const err = segmentError(t(pkg.rootFolder));
      if (err) this.error(`${P}.package.rootFolder`, `Package folder name: ${err}.`);
    }
    if (t(pkg.projectFileName) && !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(t(pkg.projectFileName))) {
      this.error(`${P}.package.projectFileName`, 'Project file name must use letters, digits, . _ - and end with .yml or .yaml.');
    }
    if (t(pkg.zipFileName) && !/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(t(pkg.zipFileName))) {
      this.error(`${P}.package.zipFileName`, 'ZIP file name must use letters, digits, . _ - and end with .zip.');
    }

    if (this.used('proxyParams')) this.proxyRules(s.proxyParams, `${P}.proxyParams`, { snippet: true });
    if (this.used('sslParams')) this.sslRules();
    if (this.used('securityHeaders')) this.securityRules();
  }

  sslRules() {
    const sp = this.s.sslParams;
    const P = 'settings.sslParams';
    const protocols = sp.protocols.map(t).filter(Boolean);
    if (!protocols.length) {
      this.warn(`${P}.protocols`, 'No TLS protocols are set, so Nginx uses its default. Before Nginx 1.23.4 that default also enables the insecure TLSv1 and TLSv1.1.');
    }
    for (const proto of protocols) {
      if (INSECURE_TLS.includes(proto)) this.error(`${P}.protocols`, `${proto} is insecure and must not be enabled. Use TLSv1.2 and TLSv1.3.`);
      else if (!TLS_PROTOCOLS.includes(proto)) this.error(`${P}.protocols`, `"${proto}" is not a TLS protocol name (use TLSv1.2, TLSv1.3).`);
    }
    if (t(sp.ciphers) && !/^[A-Za-z0-9:!+@._-]+$/.test(t(sp.ciphers))) this.error(`${P}.ciphers`, 'Cipher list may only contain cipher names separated by ":" (OpenSSL format).');
    const cacheRe = /^(off|none|((builtin(:\d+)?|shared:[A-Za-z0-9_]+:\d+[kKmM]?)(\s+(builtin(:\d+)?|shared:[A-Za-z0-9_]+:\d+[kKmM]?))*))$/;
    if (t(sp.sessionCache) && !cacheRe.test(t(sp.sessionCache))) this.error(`${P}.sessionCache`, 'Session cache must look like "shared:SSL:20m", "builtin", "none" or "off".');
    if (t(sp.sessionTimeout) && !isTime(t(sp.sessionTimeout))) this.error(`${P}.sessionTimeout`, 'Session timeout must be a time such as 10m or 1d.');
    if (sp.stapling && !t(sp.resolver)) this.warn(`${P}.resolver`, 'OCSP stapling needs a resolver to reach the certificate authority; set one, or stapling will not work.');
    if (sp.staplingVerify && !sp.stapling) this.warn(`${P}.staplingVerify`, 'Stapling verification has no effect while OCSP stapling is off.');
    if (sp.stapling) this.note('stapling', `${P}.stapling`, 'OCSP stapling needs the issuer certificate: use the full chain as the certificate, or set ssl_trusted_certificate in custom directives.');
    if (t(sp.resolver)) {
      for (const w of t(sp.resolver).split(/\s+/)) {
        const hostPart = w.replace(/^\[(.*)\](:\d+)?$/, '$1').replace(/^([^:]+):\d+$/, '$1');
        const ok = /^valid=\d+[smhd]?$/.test(w) || /^ipv[46]=(on|off)$/.test(w) || /^status_zone=\w+$/.test(w) || isIP(hostPart) || isHostname(hostPart);
        if (!ok) { this.error(`${P}.resolver`, `"${w}" is not a resolver address or option (e.g. "10.0.0.2 valid=300s").`); break; }
      }
    }
    if (t(sp.resolverTimeout) && !isTime(t(sp.resolverTimeout))) this.error(`${P}.resolverTimeout`, 'Resolver timeout must be a time such as 5s.');
  }

  securityRules() {
    const sh = this.s.securityHeaders;
    const P = 'settings.securityHeaders';
    const anything = sh.frameOptions || sh.contentTypeOptions || sh.xssProtection || t(sh.referrerPolicy) || sh.hsts
      || t(sh.permissionsPolicy) || t(sh.contentSecurityPolicy) || t(sh.customDirectives);
    if (!anything) this.warn(P, 'Security headers are included by some server blocks, but no header is turned on, so the file is empty.');
    if (t(sh.referrerPolicy)) {
      const bad = t(sh.referrerPolicy).split(',').map((x) => x.trim()).filter((x) => !REFERRER_POLICIES.includes(x));
      if (bad.length) this.warn(`${P}.referrerPolicy`, `Unknown Referrer-Policy value "${bad[0]}". Known values: ${REFERRER_POLICIES.join(', ')}.`);
    }
    if (sh.hsts && sh.hstsMaxAge !== null && sh.hstsMaxAge < 0) this.error(`${P}.hstsMaxAge`, 'HSTS max-age cannot be negative.');
    if (sh.hsts && sh.hstsPreload && (!sh.hstsIncludeSubDomains || (sh.hstsMaxAge !== null && sh.hstsMaxAge < 31536000))) {
      this.warn(`${P}.hstsPreload`, 'HSTS preload lists require includeSubDomains and a max-age of at least 31536000 (one year).');
    }
    if (sh.xssProtection) this.info(`${P}.xssProtection`, 'X-XSS-Protection is deprecated; current browsers ignore it. Prefer a Content-Security-Policy.');
    for (const key of ['permissionsPolicy', 'contentSecurityPolicy', 'referrerPolicy']) {
      if (!isSingleLine(sh[key])) this.error(`${P}.${key}`, 'Must be a single line.');
    }
  }

  zoneRules() {
    const names = new Map();
    this.p.rateLimitZones.forEach((z, k) => {
      const P = `rateLimitZones.${k}`;
      const name = t(z.name);
      if (!name) this.error(`${P}.name`, 'Zone name is required.');
      else if (!isIdentifier(name)) this.error(`${P}.name`, 'Zone name may only contain letters, digits, _ and -.');
      else if (names.has(name)) this.error(`${P}.name`, `Zone "${name}" is defined twice; nginx rejects duplicate zone names.`);
      names.set(name, k);
      if (!t(z.key)) this.error(`${P}.key`, 'Key is required, e.g. $binary_remote_addr.');
      else if (!isPlainToken(t(z.key))) this.error(`${P}.key`, 'Key must be one value without spaces or quotes, e.g. $binary_remote_addr.');
      if (!isSize(t(z.size))) this.error(`${P}.size`, 'Size must be a memory size such as 10m.');
      if (!isRate(t(z.rate))) this.error(`${P}.rate`, 'Rate must look like 10r/s or 300r/m.');
      const usedBy = this.p.servers.some((c) => c.blocks.some((b) => t(b.rateLimit.zone) === name || b.locations.some((l) => t(l.rateLimit.zone) === name)));
      if (name && !usedBy) this.info(P, `Rate limit zone "${name}" is defined but not used by any server block or location.`);
    });
  }

  // ---------- Upstream groups ----------
  upstreamRules() {
    const names = new Map();
    this.p.upstreams.forEach((u, i) => {
      const P = `upstreams.${i}`;
      const name = t(u.name);
      if (!name) this.error(`${P}.name`, 'Upstream name is required.');
      else if (!isIdentifier(name)) this.error(`${P}.name`, 'Upstream name may only contain letters, digits, _ and - (it is used in proxy_pass http://name).');
      else {
        const lower = name.toLowerCase();
        if (names.has(lower)) this.error(`${P}.name`, `Upstream "${name}" is already defined (${names.get(lower)}). Nginx rejects duplicate upstream names (they are compared without case).`);
        else names.set(lower, `upstream ${i + 1}`);
      }
      const fErr = fileNameError(u.fileName);
      if (fErr) this.error(`${P}.fileName`, `File name: ${fErr}.`);
      const dErr = dirError(u.outputDir);
      if (dErr) this.error(`${P}.outputDir`, `Folder ${dErr}.`);
      for (const key of ['description', 'category', 'environment']) if (!isSingleLine(u[key])) this.error(`${P}.${key}`, 'Must be a single line.');

      if (u.method === 'hash') {
        if (!t(u.hashKey)) this.error(`${P}.hashKey`, 'Hash load balancing needs a key, e.g. $request_uri or $remote_addr.');
        else if (!isPlainToken(t(u.hashKey))) this.error(`${P}.hashKey`, 'Hash key must be one value without spaces, quotes or ; (combine variables like $host$request_uri).');
        else if (!t(u.hashKey).includes('$')) this.warn(`${P}.hashKey`, 'Hash key has no variable, so every request goes to the same server.');
      } else if (u.hashConsistent || t(u.hashKey)) {
        if (u.hashConsistent) this.warn(`${P}.hashConsistent`, '"consistent" only applies to hash load balancing and is not written.');
        if (t(u.hashKey)) this.warn(`${P}.hashKey`, 'The hash key only applies to hash load balancing and is not written.');
      }
      if (u.randomTwo && u.method !== 'random') this.warn(`${P}.randomTwo`, '"two" only applies to random load balancing and is not written.');

      const enabled = u.servers.filter((sv) => sv.enabled);
      if (!enabled.length) this.error(`${P}.servers`, u.servers.length ? 'All servers are commented out; nginx refuses an upstream with no servers.' : 'Add at least one backend server.');
      else if (enabled.every((sv) => sv.backup)) this.error(`${P}.servers`, 'At least one server must not be a backup.');
      else if (enabled.every((sv) => sv.down)) this.warn(`${P}.servers`, 'Every server is marked down, so requests to this upstream fail.');

      const seen = new Map();
      u.servers.forEach((sv, k) => this.upstreamServerRules(u, sv, `${P}.servers.${k}`, seen));

      if (u.keepalive !== null && (u.keepalive < 1 || u.keepalive > 100000)) this.error(`${P}.keepalive`, 'Keepalive connections must be between 1 and 100000.');
      if (u.keepaliveRequests !== null && u.keepaliveRequests < 1) this.error(`${P}.keepaliveRequests`, 'Keepalive requests must be at least 1.');
      if (t(u.keepaliveTime) && !isTime(t(u.keepaliveTime))) this.error(`${P}.keepaliveTime`, 'Keepalive time must be a time such as 1h.');
      if (t(u.keepaliveTime)) this.note('keepaliveTime', `${P}.keepaliveTime`, 'keepalive_time in an upstream needs Nginx 1.19.10 or newer.');
      if (t(u.keepaliveTimeout) && !isTime(t(u.keepaliveTimeout))) this.error(`${P}.keepaliveTimeout`, 'Keepalive timeout must be a time such as 60s.');
      if (t(u.zoneSize) && !isSize(t(u.zoneSize))) this.error(`${P}.zoneSize`, 'Zone size must be a memory size such as 64k.');

      if (name && !upstreamReferences(this.p, name).length) {
        this.info(P, `Upstream "${name}" is not used by any location in this project (it may be used by configuration already on the server).`);
      }
    });
  }

  upstreamServerRules(u, sv, P, seen) {
    const addr = t(sv.address);
    const kind = backendKind(addr);
    if (!addr) this.error(`${P}.address`, 'Address is required (IP address, hostname or unix:/path).');
    else if (!kind) this.error(`${P}.address`, `"${addr}" is not a valid IP address, hostname or unix:/path.`);
    if (kind === 'unix') {
      if (sv.port !== null) this.error(`${P}.port`, 'A unix socket has no port; clear the port.');
    } else if (sv.port === null) {
      this.error(`${P}.port`, 'Port is required.');
    } else if (!isPort(sv.port)) {
      this.error(`${P}.port`, 'Port must be between 1 and 65535.');
    }
    if (kind === 'hostname') this.note(`host:${u.name}`, `${P}.address`, `"${addr}" is a hostname. Nginx resolves it once at startup and refuses to start if it cannot.`);
    if (sv.weight !== null && (sv.weight < 1 || sv.weight > 1000)) this.error(`${P}.weight`, 'Weight must be between 1 and 1000.');
    if (sv.maxFails !== null && sv.maxFails < 0) this.error(`${P}.maxFails`, 'max_fails cannot be negative (0 turns failure counting off).');
    if (sv.maxConns !== null && sv.maxConns < 0) this.error(`${P}.maxConns`, 'max_conns cannot be negative (0 means no limit).');
    if (t(sv.failTimeout) && !isTime(t(sv.failTimeout))) this.error(`${P}.failTimeout`, 'fail_timeout must be a time such as 30s.');
    if (sv.backup && ['ip_hash', 'hash', 'random'].includes(u.method)) {
      this.error(`${P}.backup`, `Backup servers cannot be used with ${u.method === 'ip_hash' ? 'ip_hash' : u.method === 'hash' ? 'hash' : 'random'} load balancing; nginx rejects this combination.`);
    }
    if (sv.backup && sv.down) this.warn(`${P}.down`, 'This server is both a backup and down, so it is never used.');
    if (!isSingleLine(sv.comment)) this.error(`${P}.comment`, 'Comment must be a single line.');
    if (sv.enabled && addr) {
      const key = `${stripBrackets(addr).toLowerCase()}:${sv.port}`;
      if (seen.has(key)) this.warn(`${P}.address`, `${addr}:${sv.port} is listed twice in this upstream, which doubles its share of requests.`);
      seen.set(key, true);
    }
  }

  // ---------- Server configurations ----------
  serverRules() {
    this.p.servers.forEach((cfg, i) => {
      const P = `servers.${i}`;
      if (!t(cfg.name)) this.error(`${P}.name`, 'Name is required.');
      const fErr = fileNameError(cfg.fileName);
      if (fErr) this.error(`${P}.fileName`, `File name: ${fErr}.`);
      const dErr = dirError(cfg.outputDir);
      if (dErr) this.error(`${P}.outputDir`, `Folder ${dErr}.`);
      for (const key of ['description', 'category', 'environment']) if (!isSingleLine(cfg[key])) this.error(`${P}.${key}`, 'Must be a single line.');
      if (t(cfg.category) && segmentError(t(cfg.category))) this.warn(`${P}.category`, 'Category is used as a log folder name; use letters, digits, . _ - only.');
      if (!cfg.blocks.length) this.error(`${P}.blocks`, 'Add at least one server block.');
      cfg.blocks.forEach((blk, b) => this.blockRules(cfg, blk, `${P}.blocks.${b}`));
    });
  }

  blockRules(cfg, blk, P) {
    if (!isSingleLine(blk.label)) this.error(`${P}.label`, 'Label must be a single line.');
    if (!blk.listen.length) this.error(`${P}.listen`, 'Add at least one listen port.');
    const seen = new Set();
    blk.listen.forEach((l, k) => {
      const LP = `${P}.listen.${k}`;
      if (l.port === null) this.error(`${LP}.port`, 'Port is required.');
      else if (!isPort(l.port)) this.error(`${LP}.port`, 'Port must be between 1 and 65535.');
      else if (l.port < 1024) this.note('privileged', `${LP}.port`, `Ports below 1024 (such as ${l.port}) need Nginx to start as root or the nginx binary to have the CAP_NET_BIND_SERVICE capability.`);
      const a = t(l.address);
      if (a && a !== '*' && !isIP(a) && !isHostname(a)) this.error(`${LP}.address`, `"${a}" is not a valid listen address (leave empty for all addresses, or use an IP such as 10.0.0.5 or [::]).`);
      const key = `${normAddr(a)}:${l.port}`;
      if (seen.has(key)) this.error(`${LP}.port`, `${listenText(a, l.port)} is listed twice in this server block.`);
      seen.add(key);
    });

    const hasSsl = blk.listen.some((l) => l.ssl);
    const cert = t(blk.tls.certificate);
    const key = t(blk.tls.certificateKey);
    if (hasSsl) {
      if (!cert) this.error(`${P}.tls.certificate`, 'HTTPS listener needs a certificate path (for example /etc/nginx/ssl/example.com/fullchain.pem).');
      if (!key) this.error(`${P}.tls.certificateKey`, 'HTTPS listener needs a private key path (for example /etc/nginx/ssl/example.com/privkey.pem).');
      this.note('tls', `${P}.tls`, 'HTTPS needs ngx_http_ssl_module (part of distribution packages; "nginx -V" lists --with-http_ssl_module). Copy certificates and keys to the server separately; the package never contains them.');
    } else if (cert || key) {
      this.warn(`${P}.tls.certificate`, 'A certificate is set, but no listener has SSL turned on, so this block serves plain HTTP and the certificate is unused.');
    }
    if (cert) { const e = absPathError(cert); if (e) this.error(`${P}.tls.certificate`, `Certificate ${e}.`); }
    if (key) { const e = absPathError(key); if (e) this.error(`${P}.tls.certificateKey`, `Private key ${e}.`); }
    if (hasSsl && !blk.tls.includeParams) this.info(`${P}.tls.includeParams`, 'Shared TLS parameters are not included, so this block uses Nginx default protocols and ciphers.');
    if (blk.http2 && !hasSsl) this.warn(`${P}.http2`, 'Browsers use HTTP/2 only over TLS; turn on SSL for a listener, or turn HTTP/2 off.');
    if (blk.http2) this.note('http2', `${P}.http2`, `HTTP/2 needs ngx_http_v2_module. It is written as ${this.s.nginxVersion === '1.25-or-newer' ? '"http2 on;" (Nginx 1.25.1 or newer)' : '"listen ... ssl http2" (works on all versions; deprecated from 1.25.1)'}; change the target version in Settings if needed.`);

    const names = blk.serverNames.map(t).filter(Boolean);
    if (!names.length) this.warn(`${P}.serverNames`, 'No server name. Use "_" for a catch-all block, or enter the domain names this block answers to.');
    const nameSeen = new Set();
    for (const n of names) {
      const kind = serverNameKind(n);
      if (!kind) this.error(`${P}.serverNames`, `"${n}" is not a valid server name (domain, *.domain, IP address, ~regex or _).`);
      if (kind === 'regex') this.note(`regex-name:${P}`, `${P}.serverNames`, `Regular-expression server name "${n}" is not checked by the generator.`);
      if (nameSeen.has(n.toLowerCase())) this.warn(`${P}.serverNames`, `"${n}" is listed twice.`);
      nameSeen.add(n.toLowerCase());
    }

    const r = blk.redirectHttp;
    if (r.enabled) {
      if (!hasSsl) this.error(`${P}.redirectHttp.enabled`, 'HTTP to HTTPS redirect needs an HTTPS (SSL) listener in this block.');
      const port = r.port === null ? 80 : r.port;
      if (!isPort(port)) this.error(`${P}.redirectHttp.port`, 'Redirect port must be between 1 and 65535.');
      else if (blk.listen.some((l) => l.ssl && l.port === port)) this.error(`${P}.redirectHttp.port`, `Port ${port} is already the HTTPS port of this block.`);
      else if (blk.listen.some((l) => l.port === port)) this.error(`${P}.redirectHttp.port`, `Port ${port} is already a listener of this block; the redirect block needs a port of its own.`);
      if (r.code !== null && !REDIRECT_CODES.includes(r.code)) this.error(`${P}.redirectHttp.code`, `Redirect code must be one of ${REDIRECT_CODES.join(', ')}.`);
    }
    if (blk.securityHeaders && !hasSsl && this.s.securityHeaders.hsts) {
      this.warn(`${P}.securityHeaders`, 'Strict-Transport-Security (in the security headers) is ignored by browsers over plain HTTP. This is expected only when a load balancer in front terminates TLS.');
    }
    if (blk.securityHeaders || blk.responseHeaders.length) {
      this.note('http-add-header', `${P}.securityHeaders`, 'A server block that sets add_header does not inherit add_header directives from the http block of nginx.conf; repeat any global headers you need in the security headers.');
    }

    this.generalRules(blk, P);
    this.logRules(blk.logging, `${P}.logging`, blk.logging.perLocation);
    this.proxyRules(blk.proxy, `${P}.proxy`, {});
    this.responseHeaderRules(blk.responseHeaders, `${P}.responseHeaders`);
    this.accessRules(blk.access, `${P}.access`);
    this.rateLimitRules(blk.rateLimit, `${P}.rateLimit`);
    blk.errorPages.forEach((e, k) => {
      const EP = `${P}.errorPages.${k}`;
      const codes = e.codes.filter((c) => c !== null);
      if (!codes.length) this.error(`${EP}.codes`, 'Enter at least one status code, e.g. 502 503 504.');
      for (const c of codes) if (c < 300 || c > 599) this.error(`${EP}.codes`, `Error page status ${c} must be between 300 and 599.`);
      const target = t(e.target);
      if (!target) this.error(`${EP}.target`, 'Enter the page, e.g. /50x.html.');
      else if (!/^(\/|@|https?:\/\/)/.test(target) || /\s/.test(target)) this.error(`${EP}.target`, 'Error page must be a path (/50x.html), a named location (@fallback) or a URL.');
    });

    if (!blk.locations.length) this.warn(`${P}.locations`, 'This server block has no locations, so Nginx serves files from its default root.');
    const locKeys = new Map();
    blk.locations.forEach((loc, k) => {
      const LP = `${P}.locations.${k}`;
      const path = t(loc.path);
      const key = `${loc.match === 'exact' ? '=' : loc.match.startsWith('regex') ? loc.match : 'prefix'}|${path}`;
      // A commented-out location is not read by nginx: it never collides, and its own problems are warnings.
      if (loc.enabled) {
        if (path && locKeys.has(key)) this.error(`${LP}.path`, `"${locationLabel(loc)}" is already defined in this server block (location ${locKeys.get(key) + 1}); nginx rejects duplicate locations.`);
        else locKeys.set(key, k);
      }
      this.soft = !loc.enabled;
      this.locationRules(cfg, blk, loc, LP);
      this.soft = false;
    });
    if (blk.locations.length && !blk.locations.some((l) => l.enabled)) {
      this.warn(`${P}.locations`, 'Every location in this block is commented out, so Nginx serves files from its default root.');
    }
  }

  generalRules(x, P) {
    if (t(x.clientMaxBodySize) && !isSize(t(x.clientMaxBodySize))) this.error(`${P}.clientMaxBodySize`, 'Body size must be a size such as 50M or 512k (0 means no limit).');
    if (t(x.sendTimeout) && !isTime(t(x.sendTimeout))) this.error(`${P}.sendTimeout`, 'send_timeout must be a time such as 60s.');
  }

  logRules(lg, P, auto) {
    if (t(lg.accessLog)) { const e = absPathError(lg.accessLog); if (e) this.error(`${P}.accessLog`, `Access log ${e}.`); }
    if (t(lg.errorLog)) { const e = absPathError(lg.errorLog); if (e) this.error(`${P}.errorLog`, `Error log ${e}.`); }
    if (lg.accessLogOff && t(lg.accessLog)) this.warn(`${P}.accessLog`, 'The access log path is not written because the access log is turned off.');
    if (t(lg.accessLogFormat) && !isLogFormatName(t(lg.accessLogFormat))) this.error(`${P}.accessLogFormat`, 'Log format name may only contain letters, digits and underscores.');
    if (lg.errorLogLevel && !t(lg.errorLog) && !auto) this.warn(`${P}.errorLogLevel`, 'The error log level is not written without an error log path.');
    if (lg.errorLogLevel === 'debug') this.note('debug-log', `${P}.errorLogLevel`, 'error_log level "debug" only works when Nginx is built with --with-debug.');
    if (lg.errorLogLevel && !LOG_LEVELS.includes(lg.errorLogLevel)) this.error(`${P}.errorLogLevel`, 'Unknown log level.');
    const fmt = t(lg.accessLogFormat) || t(this.s.logFormat);
    if ((t(lg.accessLog) || auto) && !lg.accessLogOff && fmt && fmt !== 'combined') {
      this.note(`logfmt:${fmt}`, `${P}.accessLogFormat`, `Access logs use the "${fmt}" log format, which must be defined with log_format in the http block of nginx.conf (Nginx only knows "combined" by default).`);
    }
    if (auto) this.note('log-dirs', `${P}.perLocation`, 'Create the log folders on the server before reloading Nginx (for example mkdir -p for each folder listed in the package README); nginx -t fails if a log folder is missing.');
  }

  proxyRules(ps, P, { snippet = false } = {}) {
    if (!isSingleLine(ps.hostHeader)) this.error(`${P}.hostHeader`, 'Host header must be a single line.');
    ps.requestHeaders.forEach((h, k) => {
      if (!t(h.name)) this.error(`${P}.requestHeaders.${k}.name`, 'Header name is required.');
      else if (!isHeaderName(t(h.name))) this.error(`${P}.requestHeaders.${k}.name`, 'Header name may only contain letters, digits, - _ and .');
      if (!isSingleLine(h.value)) this.error(`${P}.requestHeaders.${k}.value`, 'Header value must be a single line.');
    });
    for (const key of ['connectTimeout', 'sendTimeout', 'readTimeout']) {
      if (t(ps[key]) && !isTime(t(ps[key]))) this.error(`${P}.${key}`, 'Must be a time such as 10s, 120s or 10m.');
    }
    for (const key of ['bufferSize', 'busyBuffersSize']) {
      if (t(ps[key]) && !isSize(t(ps[key]))) this.error(`${P}.${key}`, 'Must be a size such as 16k.');
    }
    if (t(ps.buffers) && !isBuffers(t(ps.buffers))) this.error(`${P}.buffers`, 'Must be a number and a size, such as "8 32k".');
    ps.hideHeaders.forEach((h, k) => {
      if (t(h) && !isHeaderName(t(h))) this.error(`${P}.hideHeaders.${k}`, 'Header name may only contain letters, digits, - _ and .');
    });
    if (ps.httpVersion === '1.0' && ps.clearConnectionHeader) this.warn(`${P}.clearConnectionHeader`, 'Clearing the Connection header only enables upstream keepalive with HTTP version 1.1.');
    if (!snippet && ps.websocket) {
      if (ps.httpVersion === '1.0') this.error(`${P}.httpVersion`, 'WebSocket needs HTTP version 1.1.');
      if (ps.clearConnectionHeader) this.info(`${P}.clearConnectionHeader`, 'WebSocket sets its own Connection header, so "Clear Connection header" is not written here.');
      this.note('websocket', `${P}.websocket`, `WebSocket uses the $connection_upgrade variable, defined by a map in ${t(this.s.sharedHttpPath) || 'the shared http file'} (part of this package).`);
    }
    if (!snippet && ps.sslServerName) this.note(`sni:${P}`, `${P}.sslServerName`, 'proxy_ssl_server_name only has an effect for https:// backends.');
  }

  responseHeaderRules(list, P) {
    list.forEach((h, k) => {
      if (!t(h.name)) this.error(`${P}.${k}.name`, 'Header name is required.');
      else if (!isHeaderName(t(h.name))) this.error(`${P}.${k}.name`, 'Header name may only contain letters, digits, - _ and .');
      if (!isSingleLine(h.value)) this.error(`${P}.${k}.value`, 'Header value must be a single line.');
      else if (!t(h.value)) this.warn(`${P}.${k}.value`, 'add_header with an empty value sends nothing.');
    });
  }

  accessRules(acc, P) {
    let catchAll = null;
    let anyAllow = false;
    acc.rules.forEach((r, k) => {
      const src = t(r.source);
      if (!src) this.error(`${P}.rules.${k}.source`, 'Enter an IP address, a range such as 10.0.0.0/8, or "all".');
      else if (!isAccessSource(src)) this.error(`${P}.rules.${k}.source`, `"${src}" is not an IP address, CIDR range (10.0.0.0/8) or "all".`);
      if (catchAll !== null) this.warn(`${P}.rules.${k}.source`, `This rule never matches: rule ${catchAll + 1} ("${acc.rules[catchAll].action} all") already matches every address.`);
      if (src === 'all' && catchAll === null) catchAll = k;
      if (r.action === 'allow') anyAllow = true;
    });
    if (anyAllow && catchAll === null) this.info(`${P}.rules`, 'Addresses that match no rule are allowed. Add "deny all" as the last rule to allow only the listed addresses.');
    const realm = t(acc.basicAuthRealm);
    const file = t(acc.basicAuthUserFile);
    if (!isSingleLine(acc.basicAuthRealm)) this.error(`${P}.basicAuthRealm`, 'Realm must be a single line.');
    if (realm && !file) this.error(`${P}.basicAuthUserFile`, 'Basic authentication needs a password file path (created on the server with htpasswd).');
    if (file) {
      const e = absPathError(file);
      if (e) this.error(`${P}.basicAuthUserFile`, `Password file ${e}.`);
      this.note('htpasswd', `${P}.basicAuthUserFile`, 'Create the basic-auth password files on the server (htpasswd); the package never contains credentials.');
    }
  }

  rateLimitRules(rl, P) {
    const zone = t(rl.zone);
    if (!zone) {
      if (rl.burst !== null || rl.nodelay || rl.status !== null) this.warn(`${P}.zone`, 'Rate limit settings are not written until a zone is chosen.');
      return;
    }
    if (!this.p.rateLimitZones.some((z) => t(z.name) === zone)) this.error(`${P}.zone`, `Rate limit zone "${zone}" is not defined. Add it under Settings → Rate limit zones.`);
    if (rl.burst !== null && rl.burst < 0) this.error(`${P}.burst`, 'Burst cannot be negative.');
    if (rl.nodelay && rl.burst === null) this.info(`${P}.nodelay`, '"nodelay" only matters together with a burst.');
    if (rl.status !== null && (rl.status < 400 || rl.status > 599)) this.error(`${P}.status`, 'Rejection status must be between 400 and 599 (429 is usual).');
  }

  locationRules(cfg, blk, loc, P) {
    const path = t(loc.path);
    const regex = loc.match === 'regex' || loc.match === 'regex_ci';
    if (!path) this.error(`${P}.path`, 'Location path is required.');
    else if (regex) {
      try { new RegExp(path); } catch { this.warn(`${P}.path`, 'This does not look like a valid regular expression (checked as JavaScript; PCRE in Nginx may differ).'); }
    } else if (path.startsWith('@')) {
      if (loc.match !== 'prefix') this.error(`${P}.match`, 'A named location (@name) cannot have a match modifier.');
      if (!/^@[A-Za-z0-9_-]+$/.test(path)) this.error(`${P}.path`, 'Named location must look like @name.');
    } else if (!path.startsWith('/')) {
      this.error(`${P}.path`, 'Location path must start with / (or @ for a named location).');
    } else if (/\s/.test(path)) {
      this.warn(`${P}.path`, 'Location path contains spaces.');
    }
    if (!isSingleLine(loc.path)) this.error(`${P}.path`, 'Location path must be a single line.');
    if (t(loc.name) && !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(t(loc.name))) this.error(`${P}.name`, 'Name is used for log file names; use letters, digits, . _ - only.');
    if (!isSingleLine(loc.group)) this.error(`${P}.group`, 'Group must be a single line.');
    for (const m of loc.methods.map(t).filter(Boolean)) {
      if (!HTTP_METHODS.includes(m)) this.error(`${P}.methods`, `"${m}" is not an HTTP method Nginx can restrict (${HTTP_METHODS.join(', ')}).`);
    }
    this.generalRules(loc, P);
    this.logRules(loc.logging, `${P}.logging`, false);
    this.responseHeaderRules(loc.responseHeaders, `${P}.responseHeaders`);
    this.accessRules(loc.access, `${P}.access`);
    this.rateLimitRules(loc.rateLimit, `${P}.rateLimit`);
    if (loc.type === 'proxy' || loc.type === 'custom') this.proxyRules(loc.proxy, `${P}.proxy`, {});

    switch (loc.type) {
      case 'proxy': this.proxyPassRules(cfg, blk, loc, P, regex); break;
      case 'return': {
        const code = loc.return.code;
        const value = t(loc.return.value);
        if (code === null) this.error(`${P}.return.code`, 'Choose a status code.');
        else if (!(code === 444 || (code >= 100 && code <= 599))) this.error(`${P}.return.code`, 'Status code must be between 100 and 599 (or 444 to close the connection).');
        if (code !== null && [301, 302, 303, 307, 308].includes(code)) {
          if (!value) this.error(`${P}.return.value`, 'A redirect needs a target URL, e.g. https://$host$request_uri.');
          else if (!/^(https?:\/\/|\/|\$)/.test(value)) this.warn(`${P}.return.value`, 'Redirect target should be a URL (https://…) or a path starting with /.');
        }
        if (!isSingleLine(loc.return.value)) this.error(`${P}.return.value`, 'Must be a single line.');
        break;
      }
      case 'static': {
        const st = loc.static;
        const root = t(st.root);
        const alias = t(st.alias);
        if (root && alias) this.error(`${P}.static.alias`, 'Set either root or alias, not both.');
        if (!root && !alias) this.error(`${P}.static.root`, 'Set a root folder (or an alias).');
        if (root) { const e = absPathError(root); if (e) this.error(`${P}.static.root`, `Root ${e}.`); }
        if (alias) { const e = absPathError(alias); if (e) this.error(`${P}.static.alias`, `Alias ${e}.`); }
        if (alias && regex) this.warn(`${P}.static.alias`, 'alias inside a regex location must use the captured part of the path ($1); check the result.');
        if (alias && !regex && path && !path.endsWith('/') && alias.endsWith('/')) {
          this.warn(`${P}.static.alias`, `Location "${path}" has no trailing slash but its alias does, so a request such as ${path}../ can read the parent of ${alias} (path traversal). Add a trailing slash to the location.`);
        }
        if (root && path.length > 1 && !regex && root.replace(/\/+$/, '').endsWith(path.replace(/\/+$/, ''))) {
          this.info(`${P}.static.root`, `root adds the full request path: ${path}file is read from ${root.replace(/\/+$/, '')}${path}file. Use alias to strip the location path.`);
        }
        if (t(st.tryFiles)) {
          const last = t(st.tryFiles).split(/\s+/).pop();
          if (!/^(=\d{3}|\/|@)/.test(last)) this.warn(`${P}.static.tryFiles`, 'The last try_files entry should be a fallback such as =404, /index.html or @named.');
        }
        break;
      }
      case 'health':
        if (!isSingleLine(loc.health.text)) this.error(`${P}.health.text`, 'Response text must be a single line.');
        break;
      case 'status':
        this.note('stub_status', `${P}.type`, 'The status page needs ngx_http_stub_status_module ("nginx -V" lists --with-http_stub_status_module).');
        if (!loc.access.rules.length) this.warn(`${P}.access.rules`, 'The status page is open to everyone. Add allow rules for monitoring hosts and "deny all".');
        break;
      case 'custom':
        if (!t(loc.customDirectives)) this.warn(`${P}.customDirectives`, 'This custom location has no directives.');
        break;
      default:
        break;
    }
  }

  proxyPassRules(cfg, blk, loc, P, regex) {
    const pp = loc.proxyPass;
    if (pp.target === 'upstream') {
      const name = t(pp.upstream);
      if (!name) {
        this.error(`${P}.proxyPass.upstream`, 'Choose an upstream group (or switch to a direct backend).');
      } else {
        const up = this.p.upstreams.find((u) => t(u.name).toLowerCase() === name.toLowerCase());
        if (!up) this.error(`${P}.proxyPass.upstream`, `Upstream "${name}" is not defined in this project. Add it on the Upstreams tab, or choose another.`);
        else if (!up.enabled) this.error(`${P}.proxyPass.upstream`, `Upstream "${name}" is turned off (it goes to the ${t(this.s.disabledDirName) || 'disabled'} folder), so Nginx does not load it.`);
        else if (up.keepalive !== null && !this.keepaliveReady(blk, loc)) {
          this.warn(`${P}.proxyPass.upstream`, `Upstream "${name}" keeps idle connections (keepalive ${up.keepalive}), but this location does not send HTTP/1.1 with an empty Connection header, so they are never reused. Include the shared proxy parameters, or set HTTP version 1.1 and "Clear Connection header".`);
        }
      }
    } else {
      const addr = t(pp.address);
      const kind = backendKind(addr);
      if (!addr) this.error(`${P}.proxyPass.address`, 'Backend address is required.');
      else if (!kind) this.error(`${P}.proxyPass.address`, `"${addr}" is not a valid IP address, hostname or unix:/path.`);
      if (kind === 'unix' && pp.port !== null) this.error(`${P}.proxyPass.port`, 'A unix socket has no port; clear the port.');
      if (kind !== 'unix') {
        if (pp.port === null) this.error(`${P}.proxyPass.port`, 'Backend port is required.');
        else if (!isPort(pp.port)) this.error(`${P}.proxyPass.port`, 'Port must be between 1 and 65535.');
      }
      if (kind === 'hostname') this.note(`direct-host:${addr}`, `${P}.proxyPass.address`, `"${addr}" is a hostname. Nginx resolves it once at startup and refuses to start if it cannot.`);
      if (addr && this.p.upstreams.some((u) => t(u.name).toLowerCase() === addr.toLowerCase())) {
        this.warn(`${P}.proxyPass.address`, `"${addr}" is the name of an upstream group; choose "Upstream group" as the target instead.`);
      }
    }
    const uri = t(pp.uri);
    if (uri) {
      if (!uri.startsWith('/')) this.error(`${P}.proxyPass.uri`, 'Backend path must start with /.');
      if (/\s/.test(uri) || !isPlainToken(uri)) this.error(`${P}.proxyPass.uri`, 'Backend path must not contain spaces, quotes, # or ;.');
      if (regex && !uri.includes('$')) this.error(`${P}.proxyPass.uri`, 'Nginx does not allow a path in proxy_pass inside a regex location. Clear the backend path, or use a prefix location.');
      const path = t(loc.path);
      if (!regex && loc.match !== 'exact' && path.startsWith('/') && path.endsWith('/') !== uri.endsWith('/')) {
        const sample = `${path}${path.endsWith('/') ? '' : '/'}page`;
        const mapped = `${uri}${sample.slice(path.length)}`;
        this.warn(`${P}.proxyPass.uri`, `Location and backend path disagree on the trailing slash: ${sample} is sent to the backend as ${mapped}. Use a trailing slash on both or on neither.`);
      }
    }
    if (pp.scheme === 'https') this.note(`https-backend:${P}`, `${P}.proxyPass.scheme`, 'For HTTPS backends that need SNI, turn on "Send SNI" (proxy_ssl_server_name). Nginx does not verify backend certificates unless proxy_ssl_verify is set in custom directives.');
  }

  /** Whether a proxy location ends up with HTTP/1.1 and a cleared Connection header (upstream keepalive). */
  keepaliveReady(blk, loc) {
    const pp = this.s.proxyParams;
    const L = loc.proxy;
    const B = blk.proxy;
    const version = L.httpVersion || (L.includeParams && pp.httpVersion) || (L.websocket && '1.1') || B.httpVersion || (B.includeParams && pp.httpVersion) || '';
    const cleared = L.clearConnectionHeader || L.websocket || (L.includeParams && pp.clearConnectionHeader)
      || B.clearConnectionHeader || B.websocket || (B.includeParams && pp.clearConnectionHeader);
    return version === '1.1' && cleared;
  }

  // ---------- Conflicts between server blocks ----------
  listenConflicts() {
    const sockets = new Map();
    this.p.servers.forEach((cfg, i) => {
      if (!cfg.enabled) return;
      cfg.blocks.forEach((blk, b) => {
        const label = blockLabel(cfg, blk, b);
        const names = blk.serverNames.map((n) => t(n).toLowerCase()).filter(Boolean);
        const bkey = `${i}.${b}`;
        blk.listen.forEach((l, k) => {
          if (!isPort(l.port)) return;
          const key = `${normAddr(t(l.address))}:${l.port}`;
          if (!sockets.has(key)) sockets.set(key, []);
          sockets.get(key).push({ path: `servers.${i}.blocks.${b}.listen.${k}`, namePath: `servers.${i}.blocks.${b}.serverNames`, ssl: l.ssl, http2: l.ssl && blk.http2, def: l.defaultServer, names, label, bkey, text: listenText(t(l.address), l.port) });
        });
        const r = blk.redirectHttp;
        if (r.enabled && blk.listen.some((l) => l.ssl)) {
          const port = r.port === null ? 80 : r.port;
          const addrs = [...new Set(blk.listen.filter((l) => l.ssl).map((l) => t(l.address)))];
          for (const a of addrs) {
            const key = `${normAddr(a)}:${port}`;
            if (!sockets.has(key)) sockets.set(key, []);
            sockets.get(key).push({ path: `servers.${i}.blocks.${b}.redirectHttp.port`, namePath: `servers.${i}.blocks.${b}.redirectHttp.port`, ssl: false, http2: false, def: false, names, label: `${label} (HTTP redirect)`, bkey: `${bkey}.r`, text: listenText(a, port) });
          }
        }
      });
    });

    for (const entries of sockets.values()) {
      const blocks = new Set(entries.map((e) => e.bkey));
      if (blocks.size < 2) continue;
      let def = null;
      const sslRef = entries.find((e) => e.ssl);
      const plainRef = entries.find((e) => !e.ssl);
      const nameOwner = new Map();
      for (const e of entries) {
        if (e.def) {
          if (def && def.bkey !== e.bkey) this.error(e.path, `${e.text} already has a default server in ${def.label}. Nginx allows one default_server per address and port.`);
          else def = def || e;
        }
        if (sslRef && plainRef && !e.ssl && e === plainRef) {
          this.error(e.path, `${e.text} uses SSL in ${sslRef.label} but not here. One address and port serves either HTTPS or plain HTTP; nginx applies SSL to every block on it.`);
        }
        const h2Ref = entries.find((x) => x.http2 !== e.http2 && x.ssl && e.ssl);
        if (h2Ref && e.http2 && this.s.nginxVersion !== '1.25-or-newer') {
          this.warn(e.path, `${e.text} has HTTP/2 here but not in ${h2Ref.label}; with "listen ... http2" the setting applies to every block on the port.`);
        }
        for (const n of e.names) {
          const owner = nameOwner.get(n);
          if (owner && owner.bkey !== e.bkey) {
            this.error(e.namePath, `Server name "${n}" on ${e.text} is also used by ${owner.label}. Nginx ignores the second block ("conflicting server name").`);
          } else if (!owner) nameOwner.set(n, e);
        }
      }
    }
  }

  // ---------- Generated files ----------
  fileRules() {
    const files = this.gen.files;
    const s = this.s;
    const root = t(s.nginxRoot);
    const pathField = (f) => {
      if (f.kind === 'server' || f.kind === 'upstream') return `${f.src}.fileName`;
      if (f.kind === 'snippet') return `settings.${f.snippet}.path`;
      if (f.kind === 'upstream-index') return 'settings.upstreamIndex.path';
      if (f.kind === 'shared') return 'settings.sharedHttpPath';
      return f.src;
    };
    const describe = (f) => (f.kind === 'server' ? `server configuration "${f.title}"` : f.kind === 'upstream' ? `upstream ${f.title}` : f.title.toLowerCase());

    // Duplicate paths (compared without case: Windows and macOS would overwrite one with the other).
    const byPath = new Map();
    const reserved = this.reservedPaths();
    for (const f of files) {
      if (!f.path) continue;
      const key = f.path.toLowerCase();
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key).push(f);
    }
    for (const list of byPath.values()) {
      if (list.length > 1) {
        for (const f of list.slice(1)) {
          this.error(pathField(f), `Output path ${f.path} is also used by ${describe(list[0])}. Each file needs its own path${list[0].path !== f.path ? ' (paths that differ only in case collide on Windows and macOS)' : ''}.`);
        }
      }
      const r = reserved.get(list[0].path.toLowerCase());
      if (r) this.error(pathField(list[0]), `Output path ${list[0].path} is reserved for the package ${r}.`);
    }
    // A file whose path is also a folder of another file.
    const dirs = new Set();
    for (const f of files) {
      const parts = f.path.toLowerCase().split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    for (const f of files) {
      if (dirs.has(f.path.toLowerCase())) this.error(pathField(f), `Output path ${f.path} is also used as a folder by another file.`);
    }

    // Is every file loaded exactly once by nginx.conf?
    const includes = s.httpIncludes.map((p) => relativeInclude(t(p), root)).filter((p) => p && !includePatternError(p));
    const httpRes = includes.map((p) => ({ p, re: globToRegExp(p) }));
    const index = files.find((f) => f.kind === 'upstream-index');
    const indexRes = index ? index.targets.map((tg) => ({ p: tg, re: globToRegExp(tg) })) : [];
    const disabledDir = (t(s.disabledDirName) || 'disabled').toLowerCase();
    const canCheck = httpRes.length > 0;
    for (const f of files) {
      const byHttp = httpRes.filter((x) => x.re.test(f.path)).map((x) => `nginx.conf (include ${x.p})`);
      const byIndex = index && f !== index ? indexRes.filter((x) => x.re.test(f.path)).map(() => index.path) : [];
      const loaders = [...byHttp, ...byIndex];
      f.loadedBy = loaders;
      if (f.kind === 'snippet') {
        if (loaders.length) this.warn(pathField(f), `${f.path} is included by server blocks, but nginx.conf also loads it at the http level (${loaders[0]}). Move it out of that folder.`);
        continue;
      }
      if (!f.enabled) {
        if (loaders.length) this.error(pathField(f), `${f.path} is turned off, but it is still loaded by ${loaders[0]}. Change the include pattern or the disabled folder name.`);
        continue;
      }
      if (f.path.split('/').slice(0, -1).some((d) => d.toLowerCase() === disabledDir)) {
        this.warn(pathField(f), `${f.path} is in a "${disabledDir}" folder although it is turned on.`);
      }
      if (!canCheck) continue;
      if (!loaders.length) {
        const fix = f.kind === 'upstream' && !s.upstreamIndex.enabled ? ' Turn on the upstream index, add an include,' : ' Add an include for it in nginx.conf (Settings → Loaded by nginx.conf)';
        const level = f.kind === 'shared' ? 'error' : 'warning';
        this.add(level, f.kind === 'upstream-index' || f.kind === 'shared' ? pathField(f) : `${f.src}.outputDir`, `${f.path} is not loaded by nginx.conf, which includes: ${includes.join(', ')}.${fix} or move the file.`);
      } else if (loaders.length > 1) {
        this.error(f.kind === 'upstream-index' || f.kind === 'shared' ? pathField(f) : `${f.src}.outputDir`, `${f.path} would be loaded twice (${loaders.join(' and ')}), which makes nginx report duplicate upstreams or listeners.`);
      }
    }
    // Empty shared files.
    for (const f of files) {
      if (f.kind !== 'snippet') continue;
      const body = f.content.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
      if (!body.length) this.warn(pathField(f), `${f.path} has no directives (all its settings are off).`);
    }
  }

  reservedPaths() {
    const s = this.s;
    const map = new Map([['manifest.yml', 'manifest'], ['readme.md', 'README']]);
    if (s.package.includeProjectFile) map.set(projectFileNameFor(this.p).toLowerCase(), 'project file');
    if (s.package.includeTable) map.set('routing-table.csv', 'routing table');
    return map;
  }

  // ---------- Placeholder values ----------
  placeholderRules() {
    const report = (path, values) => {
      const uniq = [...new Set(values)];
      if (uniq.length) this.warn(path, `Uses placeholder values (${uniq.slice(0, 4).join(', ')}${uniq.length > 4 ? ', …' : ''}). Replace them with real addresses, names and paths before deploying.`);
    };
    const isPh = (v) => isPlaceholderAddress(v) || isPlaceholderDomain(v) || /(^|[./])example\.(com|net|org)([./]|$)/i.test(v);
    this.p.upstreams.forEach((u, i) => {
      report(`upstreams.${i}`, u.servers.map((sv) => t(sv.address)).filter(isPh));
    });
    this.p.servers.forEach((cfg, i) => {
      const vals = [];
      for (const blk of cfg.blocks) {
        vals.push(...blk.serverNames.map(t).filter(isPh));
        vals.push(...blk.listen.map((l) => t(l.address)).filter(isPh));
        vals.push(...[blk.tls.certificate, blk.tls.certificateKey].map(t).filter(isPh));
        for (const loc of blk.locations) {
          if (loc.type === 'proxy' && loc.proxyPass.target === 'direct' && isPh(t(loc.proxyPass.address))) vals.push(t(loc.proxyPass.address));
          vals.push(...loc.access.rules.map((r) => t(r.source)).filter(isPh));
        }
        vals.push(...blk.access.rules.map((r) => t(r.source)).filter(isPh));
      }
      report(`servers.${i}`, vals);
    });
  }
}

const normAddr = (a) => {
  const s = t(a).toLowerCase();
  if (!s || s === '*' || s === '0.0.0.0') return '*';
  const bare = stripBrackets(s);
  return isIPv6(bare) ? `[${bare}]` : s;
};

const listenText = (a, port) => (t(a) && t(a) !== '*' ? `${isIPv6(stripBrackets(t(a))) ? `[${stripBrackets(t(a))}]` : t(a)}:${port}` : `port ${port}`);

function blockLabel(cfg, blk, b) {
  const name = t(cfg.name) || 'unnamed configuration';
  if (t(blk.label)) return `"${name}" / ${t(blk.label)}`;
  return cfg.blocks.length > 1 ? `"${name}" block ${b + 1}` : `"${name}"`;
}

/** Project file name inside the package (and for YAML export). */
export function projectFileNameFor(project) {
  const custom = t(project.settings.package.projectFileName);
  if (custom) return custom;
  return `${slugify(project.project.name, 'nginx-project')}.yml`;
}
