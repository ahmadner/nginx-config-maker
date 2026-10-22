// One call that generates every file and validates the project: what the preview, the overview and
// every export use, so they always agree.

import { generate } from './generate.js';
import { validateProject } from './validate.js';

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

const isUnder = (path, src) => path === src || path.startsWith(`${src}.`);

/** File (by index) that holds the model path, or -1. */
function fileIndexFor(files, path) {
  if (!path) return -1;
  let best = -1;
  let bestLen = -1;
  files.forEach((f, i) => {
    if (isUnder(path, f.src) && f.src.length > bestLen) { best = i; bestLen = f.src.length; }
  });
  if (best !== -1) return best;
  if (path === 'rateLimitZones' || path.startsWith('rateLimitZones.')) return files.findIndex((f) => f.kind === 'shared');
  return -1;
}

/** Line in the file for a model path: the deepest node at or above the path, else the first node below it. */
function lineFor(file, path, rawLine) {
  let best = null;
  for (const entry of file.lineMap) {
    if (rawLine && entry.rawLine && entry.src === path) {
      if (entry.rawLine === rawLine) return entry.line;
      continue;
    }
    if (isUnder(path, entry.src) && (!best || entry.src.length > best.src.length)) best = entry;
  }
  if (best) return best.line;
  const below = file.lineMap.find((e) => isUnder(e.src, path));
  return below ? below.line : null;
}

export function buildAll(project) {
  const gen = generate(project);
  const raw = validateProject(project, gen);

  const seen = new Set();
  const issues = [];
  for (const issue of raw) {
    const key = `${issue.level}|${issue.path}|${issue.rawLine || ''}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fi = fileIndexFor(gen.files, issue.path);
    if (fi !== -1) {
      issue.file = gen.files[fi].path;
      issue.line = lineFor(gen.files[fi], issue.path, issue.rawLine);
    }
    issues.push(issue);
  }
  issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.level]++;

  const fileCounts = new Map();
  for (const f of gen.files) fileCounts.set(f, { error: 0, warning: 0, info: 0 });
  for (const i of issues) {
    const fi = fileIndexFor(gen.files, i.path);
    if (fi !== -1) fileCounts.get(gen.files[fi])[i.level]++;
  }
  for (const f of gen.files) f.counts = fileCounts.get(f);

  return { files: gen.files, issues, counts, used: gen.used, snippets: gen.snippets };
}

/** Issues at or below a model path (e.g. "servers.2" or "upstreams.0.servers.1"). */
export function issuesUnder(issues, path) {
  return issues.filter((i) => i.path && isUnder(i.path, path));
}

export function countsOf(issues) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.level]++;
  return c;
}
