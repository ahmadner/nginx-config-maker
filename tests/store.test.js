import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, memoryStorage, STORAGE_KEY } from '../js/ui/store.js';
import { newProject, resetProject, duplicateUpstream, duplicateServerConfig, duplicateLocation, duplicateBlock, renameUpstream, newUpstream, newServerConfig } from '../js/core/model.js';
import { stripIds } from '../js/core/schema.js';
import { sampleProject } from '../js/core/sample.js';
import { buildAll, errorsOf, describeIssues } from './helpers.js';

test('projects are created, renamed, duplicated, deleted and restored after a reload', () => {
  const storage = memoryStorage();
  const store = new ProjectStore(storage).load();
  assert.equal(store.projects.length, 0);
  const prod = store.add(newProject('Production Servers'));
  const dr = store.add(sampleProject());
  assert.equal(store.activeId, dr.id);
  assert.ok(store.rename(dr.id, 'DR Environment'));
  const copy = store.duplicate(dr.id);
  assert.equal(copy.project.project.name, 'DR Environment copy');
  assert.notEqual(copy.project.upstreams[0].id, dr.project.upstreams[0].id, 'copies get fresh ids');
  assert.deepEqual(stripIds(copy.project.upstreams), stripIds(dr.project.upstreams));
  store.setActive(prod.id);

  const reloaded = new ProjectStore(storage).load();
  assert.deepEqual(reloaded.projects.map((p) => p.project.project.name), ['Production Servers', 'DR Environment', 'DR Environment copy']);
  assert.equal(reloaded.activeId, prod.id);
  assert.deepEqual(reloaded.get(dr.id).project, dr.project, 'ids and content are kept exactly');

  assert.ok(reloaded.remove(prod.id));
  assert.equal(reloaded.activeId, dr.id);
  assert.equal(new ProjectStore(storage).load().projects.length, 2);
});

test('broken or unwritable storage does not break the store', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const store = new ProjectStore(storage).load();
  assert.equal(store.projects.length, 0);
  assert.equal(store.loadWarnings.length, 1);

  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, activeId: 'x', projects: [{ id: 'x', data: { schemaVersion: 99 } }, { id: 'y', data: { schemaVersion: 1, project: { name: 'Ok' } } }] }));
  const partial = new ProjectStore(storage).load();
  assert.deepEqual(partial.projects.map((p) => p.id), ['y']);
  assert.equal(partial.activeId, 'y');

  const full = { getItem: () => null, setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }, removeItem: () => {} };
  const s2 = new ProjectStore(full).load();
  s2.add(newProject('X'));
  assert.equal(s2.saveError, 'Browser storage is full.');
});

test('reset empties a project but keeps its name', () => {
  const p = sampleProject();
  resetProject(p);
  assert.equal(p.project.name, 'Sample environment (placeholders)');
  assert.equal(p.servers.length + p.upstreams.length + p.rateLimitZones.length, 0);
  assert.equal(p.settings.nginxRoot, '/etc/nginx');
});

test('duplicating entities keeps the project valid and unique', () => {
  const p = sampleProject();
  duplicateUpstream(p, 0);
  duplicateServerConfig(p, 1);
  duplicateLocation(p.servers[0].blocks[0], 0);
  duplicateBlock(p.servers[0], 1);
  assert.equal(p.upstreams[1].name, 'ext_portal_copy');
  assert.equal(p.upstreams[1].fileName, 'portal-2.conf');
  assert.equal(p.servers[2].name, 'Internal services copy');
  assert.equal(p.servers[2].fileName, 'internal-copy.conf');
  assert.equal(p.servers[0].blocks[0].locations[1].path, '/portal-copy/');
  const b = buildAll(p);
  // The duplicated server configuration listens on the same port with the same names: that must be flagged.
  assert.ok(errorsOf(b).some((i) => /default server|conflicting server name|also used by/.test(i.message)), describeIssues(b));
  assert.ok(!errorsOf(b).some((i) => /Output path/.test(i.message)), describeIssues(b));
});

test('renaming an upstream updates every reference and the suggested file name', () => {
  const p = sampleProject();
  const up = p.upstreams.find((u) => u.name === 'ext_payments');
  up.fileName = 'payments.conf';
  const changed = renameUpstream(p, up, 'ext_billing');
  assert.equal(changed, 2);
  assert.equal(up.fileName, 'billing.conf');
  const refs = p.servers.flatMap((c) => c.blocks.flatMap((b) => b.locations)).filter((l) => l.proxyPass.upstream === 'ext_billing');
  assert.equal(refs.length, 2);
  assert.deepEqual(errorsOf(buildAll(p)), []);
});

test('new entities get unique names and file names', () => {
  const p = newProject('X');
  p.upstreams.push(newUpstream(p, { name: 'ext_app', category: 'external' }));
  p.upstreams.push(newUpstream(p, { name: 'ext_app', category: 'external' }));
  assert.deepEqual(p.upstreams.map((u) => [u.name, u.outputDir, u.fileName]), [['ext_app', 'upstreams/external', 'app.conf'], ['ext_app-2', 'upstreams/external', 'app-2.conf']]);
  p.servers.push(newServerConfig(p, { name: 'API' }));
  p.servers.push(newServerConfig(p, { name: 'API' }));
  assert.deepEqual(p.servers.map((s) => s.fileName), ['api.conf', 'api-2.conf']);
  assert.deepEqual(p.servers.map((s) => s.name), ['API', 'API-2']);
});
