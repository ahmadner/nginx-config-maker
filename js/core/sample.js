// Sample project. Every address, name and path is a placeholder: IPs from the documentation ranges
// 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24 (RFC 5737), names under example.com (RFC 2606).
// The validator warns about each placeholder so the sample cannot be deployed by accident.

import { S, normalizeEntity } from './schema.js';
import { newProject } from './model.js';

export const SAMPLE_NAME = 'Sample environment (placeholders)';

export function sampleProject() {
  const p = newProject(SAMPLE_NAME, {
    description: 'Example layout with placeholder IPs (192.0.2.x, 198.51.100.x, 203.0.113.x), example.com names and certificate paths. Replace every placeholder before deploying.',
    environment: 'production',
  });

  p.rateLimitZones = [normalizeEntity(S.rateZone, { name: 'partner_api', key: '$binary_remote_addr', size: '10m', rate: '20r/s' })];

  const up = (u) => normalizeEntity(S.upstream, { environment: 'production', keepalive: 32, ...u });
  p.upstreams = [
    up({
      name: 'ext_portal', description: 'Customer portal (pair A)', category: 'external',
      outputDir: 'upstreams/external', fileName: 'portal.conf',
      servers: [{ address: '192.0.2.11', port: 9000 }, { address: '192.0.2.12', port: 9000 }],
    }),
    up({
      name: 'ext_payments', description: 'Payment API with a standby node', category: 'external',
      outputDir: 'upstreams/external', fileName: 'payments.conf', method: 'least_conn',
      servers: [
        { address: '192.0.2.21', port: 9002, weight: 2, maxFails: 3, failTimeout: '30s' },
        { address: '192.0.2.22', port: 9002, maxFails: 3, failTimeout: '30s' },
        { address: '192.0.2.23', port: 9002, backup: true, comment: 'standby' },
      ],
    }),
    up({
      name: 'ext_visitor', description: 'Visitor portal, sticky by client IP', category: 'external',
      outputDir: 'upstreams/external/v1', fileName: 'visitor.conf', method: 'ip_hash',
      servers: [
        { address: '192.0.2.31', port: 8444, maxFails: 2, failTimeout: '30s' },
        { address: '192.0.2.32', port: 8444, maxFails: 2, failTimeout: '30s', enabled: false, comment: 'out of rotation for maintenance' },
      ],
    }),
    up({
      name: 'int_reports', description: 'Reporting (long-running requests)', category: 'internal',
      outputDir: 'upstreams/internal', fileName: 'reports.conf', keepalive: 16, keepaliveTimeout: '60s',
      servers: [{ address: '198.51.100.41', port: 9005 }, { address: '198.51.100.42', port: 9005 }],
    }),
    up({
      name: 'int_search', description: 'Search, cache-friendly hashing by URI', category: 'internal',
      outputDir: 'upstreams/internal', fileName: 'search.conf', method: 'hash', hashKey: '$request_uri', hashConsistent: true,
      servers: [{ address: '198.51.100.51', port: 9200 }, { address: '198.51.100.52', port: 9200 }],
    }),
  ];

  const proxyLoc = (path, upstream, extra = {}) => ({
    path, type: 'proxy', proxyPass: { target: 'upstream', upstream, scheme: 'http', uri: extra.uri || '' },
    proxy: { includeParams: true, ...(extra.proxy || {}) },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => !['uri', 'proxy'].includes(k))),
  });

  const cfg = (c) => normalizeEntity(S.serverConfig, { environment: 'production', outputDir: 'conf.d', ...c });
  p.servers = [
    cfg({
      name: 'External gateway', description: 'Public application traffic', category: 'external', fileName: 'external.conf',
      blocks: [
        {
          label: 'Catch-all for external applications',
          listen: [{ port: 8444, defaultServer: true }], serverNames: ['_'],
          clientMaxBodySize: '100M', logging: { perLocation: true },
          locations: [
            proxyLoc('/portal/', 'ext_portal', { group: 'Pair A (192.0.2.11 / .12)' }),
            proxyLoc('/portal/ws/', 'ext_portal', { group: 'Pair A (192.0.2.11 / .12)', name: 'portal-ws', proxy: { includeParams: false, hostHeader: '$host', forwardedFor: true, websocket: true, readTimeout: '1h' } }),
            proxyLoc('/payments/', 'ext_payments', { group: 'Payments (192.0.2.21 - .23)', proxy: { readTimeout: '120s' } }),
            { path: '/healthz', match: 'exact', type: 'health', health: { text: 'ok' } },
          ],
        },
        {
          label: 'Partner API: listed partner networks only',
          listen: [{ port: 8445 }], serverNames: ['api.example.com'],
          logging: { perLocation: true },
          access: { rules: [{ action: 'allow', source: '203.0.113.0/24' }, { action: 'deny', source: 'all' }] },
          rateLimit: { zone: 'partner_api', burst: 40, nodelay: true, status: 429 },
          responseHeaders: [{ name: 'X-Environment', value: 'sample', always: true }],
          locations: [
            proxyLoc('/v1/', 'ext_payments', { name: 'partner-v1', uri: '/api/v1/', methods: ['GET', 'POST'] }),
          ],
        },
      ],
    }),
    cfg({
      name: 'Internal services', description: 'Back-office traffic from the internal network', category: 'internal', fileName: 'internal.conf',
      blocks: [{
        listen: [{ port: 8443, defaultServer: true }], serverNames: ['_'],
        logging: { perLocation: true },
        locations: [
          proxyLoc('/reports/', 'int_reports', { proxy: { readTimeout: '600s' } }),
          proxyLoc('/search/', 'int_search'),
          {
            path: '/nginx_status', match: 'exact', type: 'status',
            access: { rules: [{ action: 'allow', source: '127.0.0.1' }, { action: 'allow', source: '198.51.100.0/24' }, { action: 'deny', source: 'all' }] },
          },
        ],
      }],
    }),
    cfg({
      name: 'Visitor portal (HTTPS)', description: 'TLS terminated on Nginx', category: 'visitor', fileName: 'visitor.conf',
      blocks: [{
        listen: [{ port: 443, ssl: true }], serverNames: ['visitor.example.com'], http2: true,
        tls: {
          certificate: '/etc/nginx/ssl/visitor.example.com/fullchain.pem',
          certificateKey: '/etc/nginx/ssl/visitor.example.com/privkey.pem',
          includeParams: true,
        },
        redirectHttp: { enabled: true, port: 80, code: 301 },
        securityHeaders: true,
        logging: { accessLog: '/var/log/nginx/visitor.access.log', errorLog: '/var/log/nginx/visitor.error.log', errorLogLevel: 'warn' },
        proxy: {
          httpVersion: '1.1', clearConnectionHeader: true, hostHeader: '$host', realIp: true, forwardedFor: true, forwardedProto: true,
          connectTimeout: '10s', sendTimeout: '60s', readTimeout: '120s',
          bufferSize: '16k', buffers: '8 32k', busyBuffersSize: '64k',
        },
        errorPages: [{ codes: [502, 503, 504], target: '/50x.html' }],
        locations: [
          { path: '/', match: 'exact', type: 'return', return: { code: 301, value: 'https://$host/visitor/' } },
          { path: '/visitor/', type: 'proxy', proxyPass: { target: 'upstream', upstream: 'ext_visitor', scheme: 'http', uri: '/visitor/' } },
          { path: '/50x.html', match: 'exact', type: 'static', internal: true, static: { root: '/usr/share/nginx/html' } },
        ],
      }],
    }),
    cfg({
      name: 'Legacy application', description: 'Parked: turned off, written to conf.d/disabled/', category: 'legacy', fileName: 'legacy.conf', enabled: false,
      blocks: [{
        listen: [{ port: 8080 }], serverNames: ['legacy.example.com'],
        locations: [{ path: '/', type: 'proxy', proxyPass: { target: 'direct', address: '192.0.2.61', port: 8080, scheme: 'http' }, proxy: { includeParams: true } }],
      }],
    }),
  ];
  return p;
}
