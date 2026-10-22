// Configuration package: generated files + manifest.yml + README.md + the project YAML, zipped with
// fflate (pinned, vendored). Everything is built in memory; nothing leaves the browser.

import yaml from '../../vendor/js-yaml@4.1.1/js-yaml.mjs';
import { zipSync, strToU8 } from '../../vendor/fflate@0.8.2/fflate.js';
import { projectToYaml } from './yaml-io.js';
import { projectFileNameFor } from './validate.js';
import { buildRoutingTable, tableToDelimited } from './table.js';
import { relativePathError, segmentError, targetPath, dirname, relativeInclude } from './paths.js';
import { slugify, sha256Hex, t } from './util.js';
import { APP_NAME, APP_VERSION } from './version.js';
import { SCHEMA_VERSION } from './schema.js';

export { projectFileNameFor };

export const TABLE_FILE = 'routing-table.csv';

export function zipFileNameFor(project) {
  return t(project.settings.package.zipFileName) || `${slugify(project.project.name)}.zip`;
}

const KIND_LABEL = {
  server: 'server configuration',
  upstream: 'upstream group',
  'upstream-index': 'upstream index',
  snippet: 'shared include',
  shared: 'shared http definitions',
};

/**
 * Builds the package. `build` is the result of buildAll(project).
 * Returns { rootFolder, zipName, entries: [{ path, content, kind }], manifest } with paths relative to the root folder.
 */
export async function buildPackage(project, build, { now = new Date() } = {}) {
  const s = project.settings;
  const configFiles = build.files.filter((f) => f.path);
  const projectFile = projectFileNameFor(project);
  const entries = configFiles.map((f) => ({ path: f.path, content: f.content, kind: f.kind, file: f }));

  const yamlText = s.package.includeProjectFile ? projectToYaml(project) : null;
  const tableText = s.package.includeTable ? tableToDelimited(buildRoutingTable(project, build), { bom: true }) : null;
  const manifest = await buildManifest(project, build, entries, { now, projectFile, yamlText, tableText });
  const manifestText = `# Package manifest written by ${APP_NAME}. Lists every file with its size and SHA-256.\n${yaml.dump(manifest, { noRefs: true, lineWidth: 120 })}`;
  const readme = buildReadme(project, build, entries, { now, projectFile: yamlText ? projectFile : null, tableFile: tableText ? TABLE_FILE : null });

  entries.push({ path: 'manifest.yml', content: manifestText, kind: 'manifest' });
  entries.push({ path: 'README.md', content: readme, kind: 'readme' });
  if (yamlText) entries.push({ path: projectFile, content: yamlText, kind: 'project' });
  if (tableText) entries.push({ path: TABLE_FILE, content: tableText, kind: 'table' });

  return { rootFolder: t(s.package.rootFolder), zipName: zipFileNameFor(project), entries, manifest };
}

async function buildManifest(project, build, entries, { now, projectFile, yamlText, tableText }) {
  const s = project.settings;
  const files = [];
  for (const e of entries) {
    const f = e.file;
    files.push({
      path: e.path,
      type: KIND_LABEL[e.kind] || e.kind,
      source: f.title,
      enabled: f.enabled,
      loadedBy: f.loadedBy && f.loadedBy.length ? f.loadedBy : f.kind === 'snippet' ? ['include from server blocks'] : f.enabled ? [] : ['not loaded (disabled)'],
      bytes: new TextEncoder().encode(e.content).length,
      sha256: await sha256Hex(e.content),
      ...(summaryOf(project, f) ? { summary: summaryOf(project, f) } : {}),
    });
  }
  if (yamlText) {
    files.push({ path: projectFile, type: 'project file', source: 'this project (import it in the app)', bytes: new TextEncoder().encode(yamlText).length, sha256: await sha256Hex(yamlText) });
  }
  if (tableText) {
    files.push({ path: TABLE_FILE, type: 'endpoint routing table (CSV)', bytes: new TextEncoder().encode(tableText).length, sha256: await sha256Hex(tableText) });
  }
  files.push({ path: 'README.md', type: 'instructions' });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    manifestVersion: 1,
    generator: { name: APP_NAME, version: APP_VERSION, schemaVersion: SCHEMA_VERSION },
    generatedAt: now.toISOString(),
    project: {
      name: t(project.project.name),
      ...(t(project.project.description) ? { description: t(project.project.description) } : {}),
      ...(t(project.project.environment) ? { environment: t(project.project.environment) } : {}),
    },
    target: {
      nginxRoot: t(s.nginxRoot),
      nginxConfIncludes: s.httpIncludes.map(t).filter(Boolean).map((p) => `include ${targetPath(t(s.nginxRoot), relativeInclude(p, t(s.nginxRoot)))};`),
    },
    validation: {
      errors: build.counts.error,
      warnings: build.counts.warning,
      notes: build.counts.info,
      checkedBy: `${APP_NAME} only. Run "nginx -t" on the target server before reloading.`,
    },
    files,
  };
}

function summaryOf(project, f) {
  if (f.kind === 'upstream') {
    const u = project.upstreams[Number(f.src.split('.')[1])];
    if (!u) return null;
    return {
      upstream: t(u.name),
      method: u.method,
      servers: u.servers.filter((sv) => sv.enabled).map((sv) => `${t(sv.address)}${sv.port !== null ? `:${sv.port}` : ''}${sv.backup ? ' backup' : ''}${sv.down ? ' down' : ''}`),
    };
  }
  if (f.kind === 'server') {
    const cfg = project.servers[Number(f.src.split('.')[1])];
    if (!cfg) return null;
    return {
      serverBlocks: cfg.blocks.map((b) => ({
        listen: b.listen.map((l) => `${t(l.address) ? `${t(l.address)}:` : ''}${l.port ?? ''}${l.ssl ? ' ssl' : ''}`),
        serverNames: b.serverNames.map(t).filter(Boolean),
        locations: b.locations.length,
      })),
    };
  }
  return null;
}

// ---------- README ----------
const code = (s) => `\`${s}\``;
const fence = (lines) => ['```bash', ...lines, '```'].join('\n');

function buildReadme(project, build, entries, { now, projectFile, tableFile }) {
  const s = project.settings;
  const root = t(s.nginxRoot) || '/etc/nginx';
  const pkgRoot = t(s.package.rootFolder);
  const zip = zipFileNameFor(project);
  const staging = `/tmp/${slugify(project.project.name)}`;
  const cfgEntries = entries.filter((e) => e.file);
  const enabledEntries = cfgEntries.filter((e) => e.file.enabled);
  const out = [];
  const p = (line = '') => out.push(line);

  p(`# ${t(project.project.name)} – Nginx configuration package`);
  p();
  p(`Generated ${now.toISOString().replace('T', ' ').replace(/\..*$/, ' UTC')} by ${APP_NAME} ${APP_VERSION}.`);
  if (t(project.project.description)) { p(); p(t(project.project.description)); }
  p();
  p(`Files in this package are relative to the Nginx configuration directory ${code(root)}.`);
  p('The package holds configuration only: no certificates, private keys, passwords or application files.');
  p();
  p('> **Validate before you reload.** The generator checks structure, references and common mistakes, but only');
  p('> `nginx -t` on the target server (with its modules, nginx.conf, certificates and log folders) proves that Nginx');
  p('> accepts the configuration.');
  p();

  p('## Contents');
  p();
  p('| File | Type | Loaded by |');
  p('|------|------|-----------|');
  for (const e of cfgEntries) {
    const f = e.file;
    const loaded = f.kind === 'snippet' ? 'included by server blocks' : !f.enabled ? 'not loaded (disabled)' : f.loadedBy && f.loadedBy.length ? f.loadedBy.join(', ') : '**not loaded – see notes**';
    p(`| ${code(e.path)} | ${KIND_LABEL[f.kind] || f.kind}${f.kind === 'server' || f.kind === 'upstream' ? `: ${f.title}` : ''} | ${loaded} |`);
  }
  p('| `manifest.yml` | file list with sizes and SHA-256 checksums | – |');
  p('| `README.md` | these instructions | – |');
  if (projectFile) p(`| ${code(projectFile)} | project file; import it in ${APP_NAME} to edit this configuration | – |`);
  if (tableFile) p(`| ${code(tableFile)} | every endpoint with its upstream, backend hosts and ports, file and status (opens in Excel) | – |`);
  p();

  p('## Before you install');
  p();
  const includes = s.httpIncludes.map(t).filter(Boolean);
  if (includes.length) {
    p(`The ${code('http')} block of ${code(`${root}/nginx.conf`)} must contain these includes (they match the folders above):`);
    p();
    p('```nginx');
    for (const inc of includes) p(`include ${targetPath(root, relativeInclude(inc, root))};`);
    p('```');
    p();
  }
  const certs = new Set();
  for (const cfg of project.servers) for (const blk of cfg.blocks) for (const k of ['certificate', 'certificateKey']) if (t(blk.tls[k]) && blk.listen.some((l) => l.ssl)) certs.add(t(blk.tls[k]));
  if (certs.size) {
    p('- Copy these certificate and key files to the server (they are not in the package). Keep private keys readable by root/the nginx user only (chmod 600):');
    for (const c of certs) p(`  - ${code(c)}`);
  }
  const logDirs = collectLogDirs(project, build);
  if (logDirs.length) {
    p('- Create the log folders used by the configuration (nginx -t fails when a log folder is missing):');
    p();
    p(fence([`sudo mkdir -p ${logDirs.join(' ')}`]));
  }
  const notes = build.issues.filter((i) => i.level === 'info');
  if (notes.length) {
    p();
    p('### Notes');
    p();
    for (const n of notes) p(`- ${n.message}`);
  }
  const warnings = build.issues.filter((i) => i.level === 'warning');
  if (warnings.length) {
    p();
    p(`### Warnings to review (${warnings.length})`);
    p();
    for (const w of warnings) p(`- ${w.file ? `${code(w.file)}${w.line ? `:${w.line}` : ''}: ` : ''}${w.message}`);
  }
  p();

  p('## Install');
  p();
  p('1. Copy the ZIP to the server and unpack it in a staging folder:');
  p();
  p(fence([`scp ${zip} user@nginx-host:/tmp/`, `ssh user@nginx-host`, `mkdir -p ${staging} && unzip -o /tmp/${zip} -d ${staging}`]));
  p();
  p('2. Back up the current configuration:');
  p();
  p(fence([`sudo tar -czf /root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C ${dirname(root) || '/'} ${root.split('/').pop()}`]));
  p();
  p(`3. Copy the configuration files into ${code(root)} (only the files listed here; README, manifest, project file and routing table stay in the staging folder):`);
  p();
  const lines = [`cd ${staging}${pkgRoot ? `/${pkgRoot}` : ''}`];
  for (const e of cfgEntries) lines.push(`sudo install -D -m 644 ${e.path} ${targetPath(root, e.path)}`);
  p(fence(lines));
  p();
  p('4. Test the configuration. Do not reload if this fails:');
  p();
  p(fence(['sudo nginx -t']));
  p();
  p('   If Nginx runs as a systemd user service under a dedicated account, run the test as that account instead.');
  p();
  p('5. Reload Nginx (open connections are kept):');
  p();
  p(fence(['sudo systemctl reload nginx', '# or: sudo nginx -s reload', '# or, for a systemd user service: systemctl --user reload nginx']));
  p();
  const smoke = smokeTests(project);
  if (smoke.length) {
    p('6. Check each listener answers:');
    p();
    p(fence(smoke));
    p();
  }

  p('## Roll back');
  p();
  p('Restore the backup from step 2, test, and reload:');
  p();
  p(fence([`sudo tar -xzf /root/nginx-backup-<timestamp>.tar.gz -C ${dirname(root) || '/'}`, 'sudo nginx -t && sudo systemctl reload nginx']));
  p();
  p(`Files that were added by this package and did not exist before (check ${code('manifest.yml')}) are not removed by restoring the backup over the folder; delete them, or restore into an empty folder.`);
  p();

  p('## Disabled files');
  p();
  p(`Files under a ${code(`${t(s.disabledDirName) || 'disabled'}/`)} folder are parked: the include patterns above do not load them. Move a file one level up to enable it, then run ${code('nginx -t')} and reload.`);
  p();
  return `${out.join('\n')}\n`;
}

function collectLogDirs(project, build) {
  const dirs = new Set();
  for (const f of build.files) {
    if (f.kind !== 'server' || !f.enabled) continue;
    for (const m of f.content.matchAll(/^\s*(?:access_log|error_log)\s+(\/[^\s;]+)/gm)) dirs.add(dirname(m[1]));
  }
  return [...dirs].filter(Boolean).sort();
}

function smokeTests(project) {
  const lines = [];
  for (const cfg of project.servers) {
    if (!cfg.enabled) continue;
    for (const blk of cfg.blocks) {
      const name = blk.serverNames.map(t).find((n) => n && n !== '_' && !n.startsWith('~') && !n.includes('*'));
      const loc = blk.locations.find((l) => (l.match === 'prefix' || l.match === 'exact' || l.match === 'prefix_no_regex') && t(l.path).startsWith('/'));
      const path = loc ? t(loc.path) : '/';
      for (const l of blk.listen) {
        if (l.port === null) continue;
        const host = t(l.address) && t(l.address) !== '*' && !t(l.address).includes(':') ? t(l.address) : '127.0.0.1';
        const scheme = l.ssl ? 'https' : 'http';
        const write = `-o /dev/null -w '%{http_code} ${scheme}://${name || host}:${l.port}${path}\\n'`;
        if (l.ssl && name) {
          // --resolve keeps the server name in the TLS handshake (SNI) while connecting to this host.
          lines.push(`curl -sS -k ${write} --resolve ${name}:${l.port}:${host} https://${name}:${l.port}${path}`);
        } else {
          lines.push(`curl -sS ${l.ssl ? '-k ' : ''}${write}${name ? ` -H 'Host: ${name}'` : ''} ${scheme}://${host}:${l.port}${path}`);
        }
      }
    }
  }
  return [...new Set(lines)].slice(0, 20);
}

// ---------- ZIP ----------
const ZIP_MTIME = (now) => new Date(Math.max(now.getTime(), Date.UTC(1980, 0, 2)));

/**
 * Zips package entries. Re-checks every path (no absolute paths, no "..", no duplicates) so a bug
 * elsewhere can never write outside the archive folder or overwrite a file.
 */
export function zipPackage(pkg, { now = new Date() } = {}) {
  const root = pkg.rootFolder;
  if (root && segmentError(root)) throw new Error(`Invalid package folder name "${root}".`);
  const tree = {};
  const seen = new Set();
  const mtime = ZIP_MTIME(now);
  for (const e of pkg.entries) {
    const ext = e.path.endsWith('.conf') ? '.conf' : '';
    const err = relativePathError(e.path, ext);
    if (err) throw new Error(`Refusing to write "${e.path}": ${err}.`);
    const full = root ? `${root}/${e.path}` : e.path;
    const key = full.toLowerCase();
    if (seen.has(key)) throw new Error(`Refusing to write "${full}" twice.`);
    seen.add(key);
    tree[full] = [strToU8(e.content), { level: 6, mtime }];
  }
  return zipSync(tree, { mtime });
}
