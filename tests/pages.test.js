// Static hosting checks: the app must work from any GitHub Pages subpath with no build step,
// no backend, no network requests and no machine-specific paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    if (['node_modules', '.git'].includes(name)) continue;
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const appFiles = async () => (await walk(ROOT)).filter((f) => {
  const r = rel(f);
  return (r === 'index.html' || r.startsWith('js/') || r.startsWith('css/')) && /\.(js|mjs|html|css)$/.test(r);
});

test('index.html uses only relative asset paths and a strict CSP', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const r of refs) {
    assert.ok(!r.startsWith('/') && !/^[a-z]+:/i.test(r), `absolute or external reference: ${r}`);
    assert.ok(existsSync(join(ROOT, r)), `missing file: ${r}`);
  }
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.ok(!/<script>[^<]/.test(html), 'no inline scripts (CSP)');
  assert.ok(existsSync(join(ROOT, '.nojekyll')), '.nojekyll keeps GitHub Pages from running Jekyll');
});

test('every module import is relative and resolves to a file', async () => {
  const seen = new Set();
  const queue = [join(ROOT, 'js/main.js')];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel(file)} imports "${spec}" (must be relative for subpath hosting)`);
      const target = resolve(dirname(file), spec);
      assert.ok(existsSync(target), `${rel(file)} imports missing ${spec}`);
      if (/\.m?js$/.test(target) && !target.includes(`${sep}vendor${sep}`)) queue.push(target);
    }
  }
  assert.ok(seen.size > 20, `walked ${seen.size} modules`);
});

test('no machine-specific paths, network calls, dynamic code or HTML injection in app code', async () => {
  for (const f of await appFiles()) {
    const src = await readFile(f, 'utf8');
    const r = rel(f);
    // A drive letter followed by a backslash and a name (D:\UBS, C:\\Users), or D:/UBS style paths.
    assert.ok(!/(?<![A-Za-z0-9])[A-Za-z]:\\{1,2}[A-Za-z]|\b[A-Z]:\/(Users|UBS|Windows)\b/.test(src), `${r} contains a Windows path`);
    if (!r.endsWith('.js')) continue;
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket\(|navigator\.sendBeacon/.test(src), `${r} makes network requests`);
    assert.ok(!/\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]/.test(src), `${r} executes dynamic code`);
    assert.ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), `${r} writes HTML strings`);
  }
});

test('vendored libraries are pinned and unmodified', async () => {
  const expected = JSON.parse(await readFile(join(ROOT, 'vendor/checksums.json'), 'utf8'));
  for (const [file, info] of Object.entries(expected.files)) {
    const data = await readFile(join(ROOT, 'vendor', file));
    assert.equal(createHash('sha256').update(data).digest('hex'), info.sha256, `${file} checksum`);
    assert.ok(existsSync(join(ROOT, 'vendor', dirname(file), 'LICENSE')), `${file} license`);
  }
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is pinned to an exact version`);
    assert.ok(existsSync(join(ROOT, 'vendor', `${name}@${version}`)), `vendor folder for ${name}@${version}`);
  }
  const yamlHead = await readFile(join(ROOT, 'vendor/js-yaml@4.1.1/js-yaml.mjs'), 'utf8');
  assert.match(yamlHead.slice(0, 80), /js-yaml 4\.1\.1/);
});

test('the dev server serves the app under a GitHub Pages style subpath', async () => {
  const { spawn } = await import('node:child_process');
  const port = 4391;
  const child = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), '--port', String(port), '--base', 'my-repo'], { stdio: 'ignore' });
  try {
    const get = async (path) => {
      for (let i = 0; i < 50; i++) {
        try {
          const { default: http } = await import('node:http');
          return await new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path }, (r) => {
            let body = '';
            r.on('data', (c) => { body += c; });
            r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'], body }));
          }).on('error', rej));
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error('server did not start');
    };
    const page = await get('/my-repo/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<script type="module" src="js\/main\.js">/);
    const js = await get('/my-repo/js/main.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.equal((await get('/my-repo/vendor/fflate@0.8.2/fflate.js')).status, 200);
    assert.equal((await get('/my-repo/..%2f..%2f..%2fpackage.json')).status, 404, 'encoded traversal outside the app folder');
    assert.equal((await get('/my-repo/%2e%2e/%2e%2e/%2e%2e/Windows/win.ini')).status, 404);
    assert.equal((await get('/tests/pages.test.js')).status, 404);
  } finally {
    child.kill();
  }
});
