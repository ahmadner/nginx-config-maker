// Shared test helpers. Tests run the same modules the browser loads, including the vendored libraries.

import { newProject, newUpstream, newServerConfig, newLocation } from '../js/core/model.js';
import { S, normalizeEntity } from '../js/core/schema.js';
import { buildAll } from '../js/core/build.js';

export { buildAll };

/** Project with one upstream (ext_app, two servers) and one server configuration proxying to it. */
export function baseProject(name = 'Test project') {
  const p = newProject(name);
  p.upstreams.push(upstream({ name: 'ext_app', outputDir: 'upstreams/external', fileName: 'app.conf', servers: [{ address: '10.0.0.11', port: 9000 }, { address: '10.0.0.12', port: 9000 }] }));
  p.servers.push(server({
    name: 'External', category: 'external', fileName: 'external.conf',
    blocks: [{ listen: [{ port: 8444, defaultServer: true }], serverNames: ['_'], locations: [proxy('/app/', 'ext_app')] }],
  }));
  return p;
}

export const upstream = (values) => normalizeEntity(S.upstream, { keepalive: 32, outputDir: 'upstreams', ...values });
export const server = (values) => normalizeEntity(S.serverConfig, { outputDir: 'conf.d', ...values });
export const block = (values) => normalizeEntity(S.block, values);
export const location = (values) => normalizeEntity(S.location, values);
export const proxy = (path, upstreamName, extra = {}) => ({
  path, type: 'proxy', proxyPass: { target: 'upstream', upstream: upstreamName, scheme: 'http', ...(extra.proxyPass || {}) },
  proxy: { includeParams: true, ...(extra.proxy || {}) },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'proxy' && k !== 'proxyPass')),
});

export const fileAt = (build, path) => build.files.find((f) => f.path === path);
export const contentOf = (build, path) => {
  const f = fileAt(build, path);
  if (!f) throw new Error(`No generated file ${path}. Files: ${build.files.map((x) => x.path).join(', ')}`);
  return f.content;
};

export const errorsOf = (build) => build.issues.filter((i) => i.level === 'error');
export const warningsOf = (build) => build.issues.filter((i) => i.level === 'warning');

/** First issue of `level` whose path starts with `path` and whose message matches `re`. */
export function findIssue(build, level, path, re) {
  return build.issues.find((i) => i.level === level && (i.path === path || i.path.startsWith(`${path}.`) || i.path.startsWith(path)) && (!re || re.test(i.message)));
}

export function describeIssues(build) {
  return build.issues.map((i) => `[${i.level}] ${i.path}: ${i.message}`).join('\n');
}

export { newProject, newUpstream, newServerConfig, newLocation };
