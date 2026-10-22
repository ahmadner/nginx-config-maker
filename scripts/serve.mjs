#!/usr/bin/env node
// Static development server with no dependencies.
// Serves the app at http://127.0.0.1:4320/ and also under /nginx-config-generator/, the way GitHub Pages
// serves a project site from a repository subpath, so both can be tested locally.
//
//   node scripts/serve.mjs [--port 4320] [--base nginx-config-generator]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.PORT || 4320));
const BASE = `/${arg('base', 'nginx-config-generator').replace(/^\/+|\/+$/g, '')}/`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const BLOCKED = /(^|\/)(\.git|node_modules|tests|scripts)(\/|$)/;

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === BASE.slice(0, -1)) { res.writeHead(301, { Location: BASE }); res.end(); return; }
    if (urlPath.startsWith(BASE)) urlPath = `/${urlPath.slice(BASE.length)}`;
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = normalize(join(ROOT, urlPath));
    if (!file.startsWith(ROOT + sep) || BLOCKED.test(urlPath)) { res.writeHead(404); res.end('Not found'); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(400);
    res.end('Bad request');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Nginx Config Generator: http://127.0.0.1:${PORT}/  (GitHub Pages style: http://127.0.0.1:${PORT}${BASE})`);
});
