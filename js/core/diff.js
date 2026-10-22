// Compares two projects for the import review: what an import would add, remove or change.

import { stripIds } from './schema.js';
import { buildAll } from './build.js';
import { t } from './util.js';

function compareLists(current, incoming, key) {
  const cur = new Map(current.map((x) => [t(x[key]).toLowerCase(), x]));
  const inc = new Map(incoming.map((x) => [t(x[key]).toLowerCase(), x]));
  const out = { added: [], removed: [], changed: [], same: [] };
  for (const [k, x] of inc) {
    if (!cur.has(k)) out.added.push(t(x[key]) || '(unnamed)');
    else if (JSON.stringify(stripIds(cur.get(k))) !== JSON.stringify(stripIds(x))) out.changed.push(t(x[key]));
    else out.same.push(t(x[key]));
  }
  for (const [k, x] of cur) if (!inc.has(k)) out.removed.push(t(x[key]) || '(unnamed)');
  return out;
}

/** Returns { servers, upstreams, zones, files, settingsChanged, projectChanged } with added/removed/changed/same lists. */
export function compareProjects(current, incoming, { currentBuild = null, incomingBuild = null } = {}) {
  const a = currentBuild || buildAll(current);
  const b = incomingBuild || buildAll(incoming);
  const fa = new Map(a.files.map((f) => [f.path, f.content]));
  const fb = new Map(b.files.map((f) => [f.path, f.content]));
  const files = { added: [], removed: [], changed: [], same: [] };
  for (const [path, content] of fb) {
    if (!fa.has(path)) files.added.push(path);
    else if (fa.get(path) !== content) files.changed.push(path);
    else files.same.push(path);
  }
  for (const path of fa.keys()) if (!fb.has(path)) files.removed.push(path);
  return {
    servers: compareLists(current.servers, incoming.servers, 'name'),
    upstreams: compareLists(current.upstreams, incoming.upstreams, 'name'),
    zones: compareLists(current.rateLimitZones, incoming.rateLimitZones, 'name'),
    files,
    settingsChanged: JSON.stringify(current.settings) !== JSON.stringify(incoming.settings),
    projectChanged: JSON.stringify(current.project) !== JSON.stringify(incoming.project),
  };
}
