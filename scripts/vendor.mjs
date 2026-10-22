#!/usr/bin/env node
// Vendored browser libraries: pinned versions, copied from npm packages, verified by SHA-256.
//
//   node scripts/vendor.mjs --check   verify vendor/ against vendor/checksums.json (no network)
//   node scripts/vendor.mjs --copy    after "npm install", copy the pinned files from node_modules
//                                     into vendor/ and rewrite vendor/checksums.json

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = [
  { name: 'js-yaml', from: 'dist/js-yaml.mjs', to: 'js-yaml.mjs' },
  { name: 'fflate', from: 'esm/browser.js', to: 'fflate.js' },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const mode = process.argv[2];

if (mode === '--copy') {
  const files = {};
  for (const lib of LIBS) {
    const version = pkg.devDependencies[lib.name];
    const installed = JSON.parse(await readFile(join(ROOT, 'node_modules', lib.name, 'package.json'), 'utf8')).version;
    if (installed !== version) throw new Error(`${lib.name}: node_modules has ${installed}, package.json pins ${version}. Run npm ci.`);
    const dir = join(ROOT, 'vendor', `${lib.name}@${version}`);
    await mkdir(dir, { recursive: true });
    await copyFile(join(ROOT, 'node_modules', lib.name, lib.from), join(dir, lib.to));
    await copyFile(join(ROOT, 'node_modules', lib.name, 'LICENSE'), join(dir, 'LICENSE'));
    files[`${lib.name}@${version}/${lib.to}`] = { package: lib.name, version, source: `${lib.name}/${lib.from}`, sha256: sha(await readFile(join(dir, lib.to))) };
  }
  await writeFile(join(ROOT, 'vendor', 'checksums.json'), `${JSON.stringify({ note: 'Written by scripts/vendor.mjs --copy. Checked by npm test.', files }, null, 2)}\n`);
  console.log('Vendored:', Object.keys(files).join(', '));
} else if (mode === '--check' || !mode) {
  const { files } = JSON.parse(await readFile(join(ROOT, 'vendor', 'checksums.json'), 'utf8'));
  let ok = true;
  for (const [file, info] of Object.entries(files)) {
    const actual = sha(await readFile(join(ROOT, 'vendor', file)));
    const good = actual === info.sha256;
    ok &&= good;
    console.log(`${good ? 'ok  ' : 'FAIL'} ${file} ${actual}`);
  }
  process.exitCode = ok ? 0 : 1;
} else {
  console.error('Usage: node scripts/vendor.mjs --check | --copy');
  process.exitCode = 2;
}
