// Servers tab: server configurations (one generated file each), their server blocks and locations.

import { h, icon, replace } from '../dom.js';
import {
  textField, numberField, selectField, checkField, wordsField, section, grid, note, issueArea, badgeEl, staticField,
} from '../fields.js';
import { proxyFields, proxySetCount } from './proxy.js';
import { listenRows, responseHeaderRows, errorPageRows } from './rows.js';
import { locationCard, accessControls, customArea, TYPE_LABELS } from './location.js';
import { confirmDialog, popupMenu, promptDialog } from '../dialogs.js';
import {
  newServerConfig, newServerBlock, newLocation, newListen, duplicateServerConfig, duplicateBlock, moveItem, entityFilePath,
} from '../../core/model.js';
import { normalizeDir, joinPath } from '../../core/paths.js';
import { issuesUnder, countsOf } from '../../core/build.js';
import { t, pathKey } from '../../core/util.js';
import { LOG_LEVELS } from '../../core/formats.js';

const CATEGORY_SUGGESTIONS = ['external', 'internal', 'visitor', 'partner', 'admin'];
const ENV_SUGGESTIONS = ['production', 'dr', 'staging', 'development', 'test'];

export function countBadge(counts) {
  if (counts.error) return h('span', { class: 'count-badge count-error', text: String(counts.error), title: `${counts.error} error${counts.error === 1 ? '' : 's'}` });
  if (counts.warning) return h('span', { class: 'count-badge count-warning', text: String(counts.warning), title: `${counts.warning} warning${counts.warning === 1 ? '' : 's'}` });
  return null;
}

/** Entity list column shared by the Servers and Upstreams tabs. */
export function entityList(app, { title, items, selected, onSelect, onAdd, addLabel, empty }) {
  return h('nav', { class: 'entity-list', 'aria-label': title },
    h('div', { class: 'entity-head' }, h('h2', { text: title }),
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: onAdd }, icon('plus'), h('span', { text: addLabel }))),
    items.length
      ? h('ul', {}, items.map((it, i) => h('li', {},
        h('button', {
          type: 'button', class: ['entity-item', i === selected && 'selected', it.disabled && 'is-disabled'], 'aria-current': i === selected ? 'true' : undefined,
          onclick: () => onSelect(i),
        },
        h('span', { class: 'entity-name' }, it.name, it.disabled ? h('span', { class: 'chip chip-muted', text: 'off' }) : null),
        h('span', { class: 'entity-sub mono', text: it.sub }),
        countBadge(it.counts)))))
      : h('p', { class: 'empty-small', text: empty }));
}

function listItems(app) {
  const issues = app.build ? app.build.issues : [];
  return app.project.servers.map((cfg, i) => ({
    name: t(cfg.name) || `Server configuration ${i + 1}`,
    sub: entityFilePath(cfg, app.project.settings),
    disabled: !cfg.enabled,
    counts: countsOf(issuesUnder(issues, `servers.${i}`)),
  }));
}

export const serversView = {
  id: 'servers',
  label: 'Servers',

  render(app, el) {
    const p = app.project;
    if (app.sel.server >= p.servers.length) app.sel.server = Math.max(0, p.servers.length - 1);
    this.listBox = h('div', { class: 'list-col' });
    const editor = h('div', { class: 'editor-col scroll' });
    el.append(h('div', { class: 'split' }, this.listBox, editor));
    this.renderList(app);
    if (!p.servers.length) {
      editor.append(emptyState(app));
      return;
    }
    editor.append(configEditor(app, app.sel.server));
  },

  refresh(app) {
    if (this.listBox?.isConnected) this.renderList(app);
  },

  renderList(app) {
    replace(this.listBox, entityList(app, {
      title: 'Server configurations',
      items: listItems(app),
      selected: app.sel.server,
      onSelect: (i) => { app.sel.server = i; app.previewPinned = null; app.renderView(); app.preview.refresh(); },
      onAdd: () => addServerConfig(app),
      addLabel: 'New',
      empty: 'None yet.',
    }));
  },
};

async function addServerConfig(app) {
  const name = await promptDialog({
    title: 'New server configuration', label: 'Name', value: 'New server',
    hint: 'One server configuration is one file in conf.d, with one or more server blocks (for example "External gateway").',
    validate: (v) => (v ? null : 'Enter a name.'), confirmLabel: 'Create',
  });
  if (!name) return;
  app.update((p) => {
    const cfg = newServerConfig(p, { name, category: '' });
    p.servers.push(cfg);
    app.sel.server = p.servers.length - 1;
  });
  app.preview.refresh();
}

function emptyState(app) {
  return h('div', { class: 'empty' },
    icon('server', { size: 32 }),
    h('h2', { text: 'No server configurations yet' }),
    h('p', { text: 'A server configuration becomes one file in conf.d (for example conf.d/external.conf) with one or more server blocks: listeners, names, TLS and locations.' }),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => addServerConfig(app) }, icon('plus'), h('span', { text: 'New server configuration' })));
}

function configEditor(app, ci) {
  const p = app.project;
  const base = ['servers', ci];
  const cfg = p.servers[ci];
  const file = app.build?.files.find((f) => f.src === `servers.${ci}`);
  const dirs = [...new Set([normalizeDir(p.settings.serverDir), ...p.servers.map((s) => normalizeDir(s.outputDir))].filter(Boolean))];
  const outPath = h('span', { class: 'mono', text: entityFilePath(cfg, p.settings) });
  const updatePath = () => { outPath.textContent = entityFilePath(cfg, p.settings); };

  const header = h('div', { class: 'editor-head' },
    h('div', {},
      h('h2', { class: 'editor-title', text: t(cfg.name) || 'Server configuration' }),
      h('div', { class: 'editor-sub' }, icon('file', { size: 14 }), outPath, cfg.enabled ? null : h('span', { class: 'chip chip-muted', text: 'turned off: not loaded' }))),
    h('div', { class: 'editor-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => app.update((proj) => { duplicateServerConfig(proj, ci); app.sel.server = ci + 1; }) }, icon('duplicate'), h('span', { text: 'Duplicate' })),
      h('button', {
        type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
          const ok = await confirmDialog({ title: `Delete "${t(cfg.name)}"?`, message: `The server configuration and its ${cfg.blocks.length} server block(s) are removed from the project. Its file is no longer generated.`, confirmLabel: 'Delete', danger: true });
          if (ok) app.update((proj) => { proj.servers.splice(ci, 1); app.sel.server = Math.max(0, ci - 1); });
        },
      }, icon('trash'), h('span', { text: 'Delete' }))));

  const fileCard = h('section', { class: 'card' },
    h('h3', { class: 'card-title', text: 'File' }),
    grid(
      textField(app, [...base, 'name'], { label: 'Name', required: true, width: 'm', mono: false, onInput: () => app.sidebar.refresh() }),
      textField(app, [...base, 'description'], { label: 'Description', width: 'l', mono: false, placeholder: 'written as a comment at the top of the file' }),
    ),
    grid(
      textField(app, [...base, 'environment'], { label: 'Environment', width: 's', mono: false, options: ENV_SUGGESTIONS }),
      textField(app, [...base, 'category'], { label: 'Category', width: 's', options: CATEGORY_SUGGESTIONS, hint: 'Also the log folder for per-location logs.' }),
      checkField(app, [...base, 'enabled'], { label: 'Turned on (loaded by Nginx)', width: 'm', rerender: true, hint: `Off: written to ${t(p.settings.disabledDirName) || 'disabled'}/ inside the folder, which nginx.conf does not load.` }),
    ),
    grid(
      textField(app, [...base, 'outputDir'], { label: 'Folder', width: 'm', options: dirs, placeholder: 'conf.d', onInput: updatePath }),
      textField(app, [...base, 'fileName'], { label: 'File name', width: 'm', required: true, placeholder: 'external.conf', onInput: updatePath }),
      staticField('Loaded by', file ? (file.loadedBy?.length ? file.loadedBy.join(', ') : cfg.enabled ? 'nothing (see messages)' : 'not loaded (turned off)') : '–', { width: 'm', mono: false }),
    ),
    section(app, `${cfg.id}#http`, { title: 'http-level directives at the top of this file', summary: t(cfg.httpDirectives) ? 'set' : 'none', issuePath: pathKey([...base, 'httpDirectives']) },
      h('p', { class: 'hint', text: 'For map, geo, or limit_conn_zone definitions used only by this file. Rate limit zones and the WebSocket map are generated for you.' }),
      customArea(app, [...base, 'httpDirectives'], 'http')));

  const blocks = cfg.blocks.map((blk, bi) => blockCard(app, ci, bi));
  return h('div', { class: 'editor' },
    header,
    issueArea(app, `servers.${ci}`),
    fileCard,
    blocks,
    h('button', {
      type: 'button', class: 'btn btn-add-block', onclick: () => app.update(() => { const b = newServerBlock({ listen: [{ port: 8080 }], serverNames: [] }); cfg.blocks.push(b); }),
    }, icon('plus'), h('span', { text: 'Add server block to this file' })));
}

function blockSummary(blk) {
  const listens = blk.listen.map((l) => `${t(l.address) ? `${t(l.address)}:` : ''}${l.port ?? '?'}${l.ssl ? ' ssl' : ''}`).join(', ');
  const names = blk.serverNames.map(t).filter(Boolean).join(' ');
  return `${listens || 'no listener'} · ${names || 'no server name'} · ${blk.locations.length} location${blk.locations.length === 1 ? '' : 's'}`;
}

function blockCard(app, ci, bi) {
  const p = app.project;
  const cfg = p.servers[ci];
  const blk = cfg.blocks[bi];
  const base = ['servers', ci, 'blocks', bi];
  const hasSsl = blk.listen.some((l) => l.ssl);
  const s = p.settings;

  const head = h('div', { class: 'block-head' },
    h('h3', { class: 'block-title' }, `Server block ${bi + 1}`, t(blk.label) ? h('span', { class: 'block-label', text: ` · ${t(blk.label)}` }) : null),
    h('span', { class: 'block-sub mono', text: blockSummary(blk) }),
    h('div', { class: 'block-actions' },
      h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'Move up', 'aria-label': `Move server block ${bi + 1} up`, disabled: bi === 0, onclick: () => app.update(() => moveItem(cfg.blocks, bi, -1)) }, icon('up')),
      h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'Move down', 'aria-label': `Move server block ${bi + 1} down`, disabled: bi === cfg.blocks.length - 1, onclick: () => app.update(() => moveItem(cfg.blocks, bi, 1)) }, icon('down')),
      h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'Duplicate', 'aria-label': `Duplicate server block ${bi + 1}`, onclick: () => app.update(() => duplicateBlock(cfg, bi)) }, icon('duplicate')),
      h('button', {
        type: 'button', class: 'btn btn-icon btn-ghost', title: 'Delete', 'aria-label': `Delete server block ${bi + 1}`,
        onclick: async () => {
          if (await confirmDialog({ title: `Delete server block ${bi + 1}?`, message: `The block and its ${blk.locations.length} location(s) are removed.`, confirmLabel: 'Delete block', danger: true })) {
            app.update(() => cfg.blocks.splice(bi, 1));
          }
        },
      }, icon('trash'))));

  const listenSec = section(app, `${blk.id}#listen`, { title: 'Listeners and names', open: true, issuePath: pathKey([...base, 'listen']), summary: blockSummary(blk).split(' · ').slice(0, 2).join(' · ') },
    listenRows(app, [...base, 'listen'], () => newListen({ port: hasSsl ? 443 : 80 })),
    grid(
      wordsField(app, [...base, 'serverNames'], { label: 'Server names', width: 'l', placeholder: 'example.com www.example.com (or _ for any name)', hint: 'Separated by spaces. Wildcards (*.example.com), IP addresses and ~regex are allowed.' }),
      textField(app, [...base, 'label'], { label: 'Label (comment above the block)', width: 'm', mono: false, placeholder: 'e.g. Partner API' }),
    ),
    checkField(app, [...base, 'http2'], { label: 'HTTP/2 on HTTPS listeners', width: 'full', badge: { text: 'needs http_v2 module', title: 'ngx_http_v2_module; written as "listen … http2" or "http2 on;" depending on the target Nginx version in Settings.' } }));

  const tlsSec = section(app, `${blk.id}#tls`, {
    title: 'HTTPS (TLS)', open: hasSsl, issuePath: pathKey([...base, 'tls']),
    summary: hasSsl ? `on${blk.redirectHttp.enabled ? `, redirects port ${blk.redirectHttp.port ?? 80}` : ''}` : 'off',
  },
  hasSsl ? null : note('Turn on HTTPS for a listener above to serve this block over TLS. HTTPS is never turned on without certificate paths.'),
  grid(
    textField(app, [...base, 'tls', 'certificate'], { label: 'Certificate (full chain)', width: 'l', required: hasSsl, placeholder: '/etc/nginx/ssl/example.com/fullchain.pem', hint: 'Path on the server. Certificates and keys are never part of the package.' }),
    textField(app, [...base, 'tls', 'certificateKey'], { label: 'Private key', width: 'l', required: hasSsl, placeholder: '/etc/nginx/ssl/example.com/privkey.pem' }),
  ),
  checkField(app, [...base, 'tls', 'includeParams'], { label: `Include the shared TLS parameters (${t(s.sslParams.path) || 'ssl_params.conf'}: protocols ${s.sslParams.protocols.join(' ') || 'default'}, session cache)`, width: 'full' }),
  h('div', { class: 'subhead', text: 'Redirect plain HTTP to HTTPS' }),
  grid(
    checkField(app, [...base, 'redirectHttp', 'enabled'], { label: 'Add a redirect server block', width: 'm', rerender: true }),
    blk.redirectHttp.enabled ? numberField(app, [...base, 'redirectHttp', 'port'], { label: 'HTTP port', placeholder: '80', min: 1, max: 65535 }) : null,
    blk.redirectHttp.enabled ? selectField(app, [...base, 'redirectHttp', 'code'], [['301', '301 permanent'], ['308', '308 permanent, keeps method'], ['302', '302 temporary'], ['307', '307 temporary, keeps method']], { label: 'Status', width: 's', numeric: true, rerender: false }) : null,
  ));

  const lg = blk.logging;
  const autoBase = joinPath(t(s.logRoot) || '/var/log/nginx', t(cfg.category));
  const logSec = section(app, `${blk.id}#log`, {
    title: 'Logging and limits', issuePath: pathKey([...base, 'logging']),
    summary: [lg.perLocation && 'per-location logs', t(blk.clientMaxBodySize) && `body ${t(blk.clientMaxBodySize)}`].filter(Boolean).join(', ') || 'inherited from nginx.conf',
  },
  checkField(app, [...base, 'logging', 'perLocation'], {
    label: 'Separate access and error log for each location', width: 'full', rerender: true,
    hint: `Writes ${autoBase}/<location>.access.log and .error.log, and ${autoBase}/_default.*.log for requests that match no location.`,
  }),
  grid(
    textField(app, [...base, 'logging', 'accessLog'], { label: 'Access log', width: 'l', placeholder: lg.perLocation ? `${autoBase}/_default.access.log` : 'inherited from nginx.conf' }),
    textField(app, [...base, 'logging', 'accessLogFormat'], { label: 'Format', width: 's', placeholder: t(s.logFormat) || 'combined' }),
    checkField(app, [...base, 'logging', 'accessLogOff'], { label: 'Access log off', width: 's' }),
  ),
  grid(
    textField(app, [...base, 'logging', 'errorLog'], { label: 'Error log', width: 'l', placeholder: lg.perLocation ? `${autoBase}/_default.error.log` : 'inherited from nginx.conf' }),
    selectField(app, [...base, 'logging', 'errorLogLevel'], [['', 'Default (error)'], ...LOG_LEVELS.map((l) => [l, l])], { label: 'Level', width: 's', rerender: false }),
  ),
  grid(
    textField(app, [...base, 'clientMaxBodySize'], { label: 'client_max_body_size', width: 's', placeholder: 'default 1m', hint: 'Largest request body (uploads).' }),
    textField(app, [...base, 'sendTimeout'], { label: 'send_timeout', width: 's', placeholder: 'default 60s' }),
  ));

  const proxySec = section(app, `${blk.id}#proxy`, {
    title: 'Proxy defaults for every location', issuePath: pathKey([...base, 'proxy']),
    summary: proxySetCount(blk.proxy) || blk.proxy.includeParams ? `${blk.proxy.includeParams ? 'includes shared file, ' : ''}${proxySetCount(blk.proxy)} set` : 'none',
  },
  h('p', { class: 'hint', text: 'Written at server level and inherited by every location. Locations can override each value.' }),
  proxyFields(app, [...base, 'proxy'], { level: 'server' }));

  const sh = s.securityHeaders;
  const shList = [sh.frameOptions && 'X-Frame-Options', sh.contentTypeOptions && 'X-Content-Type-Options', t(sh.referrerPolicy) && 'Referrer-Policy', sh.hsts && 'HSTS', t(sh.permissionsPolicy) && 'Permissions-Policy', t(sh.contentSecurityPolicy) && 'CSP'].filter(Boolean);
  const secSec = section(app, `${blk.id}#security`, {
    title: 'Security headers, access and rate limiting', issuePath: pathKey([...base, 'access']),
    summary: [blk.securityHeaders && 'security headers', blk.access.rules.length && `${blk.access.rules.length} access rule(s)`, t(blk.rateLimit.zone) && `limit ${t(blk.rateLimit.zone)}`].filter(Boolean).join(', ') || 'none',
  },
  checkField(app, [...base, 'securityHeaders'], { label: `Include the shared security headers (${t(sh.path) || 'security_headers.conf'})`, width: 'full', hint: shList.length ? `Adds ${shList.join(', ')}. Edit them under Settings.` : 'No header is turned on under Settings yet.' }),
  h('div', { class: 'subhead', text: 'Extra response headers' }),
  responseHeaderRows(app, [...base, 'responseHeaders']),
  accessControls(app, base));

  const errSec = section(app, `${blk.id}#errors`, { title: 'Error pages', issuePath: pathKey([...base, 'errorPages']), summary: blk.errorPages.length ? `${blk.errorPages.length} page(s)` : 'Nginx defaults' },
    h('p', { class: 'hint', text: 'Serve a page of your own for these status codes. Add an internal static location for the page (for example = /50x.html with root /usr/share/nginx/html).' }),
    errorPageRows(app, [...base, 'errorPages']));

  const customSec = section(app, `${blk.id}#custom`, { title: 'Custom directives (server block)', issuePath: pathKey([...base, 'customDirectives']), summary: t(blk.customDirectives) ? `${t(blk.customDirectives).split('\n').length} line(s)` : 'none' },
    customArea(app, [...base, 'customDirectives'], 'server'));

  const addLoc = h('button', {
    type: 'button', class: 'btn btn-small btn-primary', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: (e) => popupMenu(e.currentTarget, Object.entries(TYPE_LABELS).map(([type, label]) => ({
      label, onSelect: () => app.update(() => {
        const loc = newLocation(type, { upstream: p.upstreams[0]?.name || '' });
        if (type === 'proxy' && blk.locations.some((l) => l.path === loc.path)) loc.path = '/app/';
        blk.locations.push(loc);
        app.openState.set(loc.id, true);
      }),
    }))),
  }, icon('plus'), h('span', { text: 'Add location' }));

  return h('section', { class: 'card block-card', 'aria-label': `Server block ${bi + 1}` },
    head,
    issueArea(app, pathKey(base)),
    listenSec, tlsSec, logSec, proxySec, secSec, errSec, customSec,
    h('div', { class: 'locations-head' },
      h('h3', { class: 'card-title' }, `Locations (${blk.locations.length})`, badgeEl({ text: 'checked in Nginx order: = exact, ^~, regex, longest prefix', kind: 'muted' })),
      addLoc),
    issueArea(app, pathKey([...base, 'locations'])),
    blk.locations.length ? blk.locations.map((_, li) => locationCard(app, ci, bi, li)) : h('p', { class: 'empty-small', text: 'No locations yet. Add one to proxy requests, redirect, or serve files.' }));
}
