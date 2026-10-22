// Golden files: the sample project must keep producing exactly the files in tests/fixtures/sample.
// After an intended generator change, run "npm run fixtures" and review the diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleProject } from '../js/core/sample.js';
import { buildAll } from '../js/core/build.js';
import { projectToYaml, parseProjectYaml } from '../js/core/yaml-io.js';
import { compareProjects } from '../js/core/diff.js';
import { parseConfig } from '../js/core/syntax.js';

const FIXTURES = join(resolve(dirname(fileURLToPath(import.meta.url))), 'fixtures', 'sample');

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

test('sample project output matches the golden files', async () => {
  const build = buildAll(sampleProject());
  const pkgDir = join(FIXTURES, 'package');
  const expected = (await walk(pkgDir)).map((f) => relative(pkgDir, f).split(sep).join('/')).sort();
  assert.deepEqual(build.files.map((f) => f.path).sort(), expected, 'same set of files');
  for (const f of build.files) {
    assert.equal(f.content, await readFile(join(pkgDir, f.path), 'utf8'), `${f.path} differs from the golden file (run npm run fixtures if intended)`);
  }
  assert.equal(projectToYaml(sampleProject()), await readFile(join(FIXTURES, 'sample-project.yml'), 'utf8'));
});

test('every generated file is syntactically balanced Nginx configuration', () => {
  for (const f of buildAll(sampleProject()).files) {
    assert.deepEqual(parseConfig(f.content).errors, [], f.path);
  }
});

test('the golden YAML imports and produces the golden files', async () => {
  const res = parseProjectYaml(await readFile(join(FIXTURES, 'sample-project.yml'), 'utf8'));
  assert.ok(res.ok);
  const build = buildAll(res.project);
  for (const f of build.files) assert.equal(f.content, await readFile(join(FIXTURES, 'package', f.path), 'utf8'), f.path);
});

test('import comparison lists added, removed and changed entities and files', () => {
  const current = sampleProject();
  const incoming = sampleProject();
  incoming.upstreams[0].servers[0].address = '10.20.0.11';
  incoming.upstreams.splice(4, 1); // int_search removed
  incoming.servers[1].blocks[0].locations.splice(1, 1); // and the location that used it
  incoming.servers.push({ ...structuredClone(incoming.servers[0]), name: 'Second gateway', fileName: 'second.conf' });
  const d = compareProjects(current, incoming);
  assert.deepEqual(d.upstreams.removed, ['int_search']);
  assert.deepEqual(d.upstreams.changed, ['ext_portal']);
  assert.deepEqual(d.servers.added, ['Second gateway']);
  assert.deepEqual(d.servers.changed, ['Internal services']);
  assert.ok(d.files.added.includes('conf.d/second.conf'));
  assert.ok(d.files.removed.includes('upstreams/internal/search.conf'));
  assert.ok(d.files.changed.includes('upstreams/external/portal.conf'));
  assert.equal(d.settingsChanged, false);
});
