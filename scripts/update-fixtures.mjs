#!/usr/bin/env node
// Regenerates tests/fixtures/sample/: the files generated from the sample project, plus its YAML.
// Run after an intended change to the generator, then review the diff.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleProject } from '../js/core/sample.js';
import { buildAll } from '../js/core/build.js';
import { projectToYaml } from '../js/core/yaml-io.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests', 'fixtures', 'sample');

await rm(OUT, { recursive: true, force: true });
const project = sampleProject();
const build = buildAll(project);
for (const f of build.files) {
  const target = join(OUT, 'package', f.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, f.content);
}
await writeFile(join(OUT, 'sample-project.yml'), projectToYaml(project));
console.log(`Wrote ${build.files.length} generated files and sample-project.yml to ${OUT}`);
