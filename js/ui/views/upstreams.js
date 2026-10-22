// Upstreams tab: upstream groups (one file each) with backend servers and load balancing.

import { h, icon, replace } from '../dom.js';
import { textField, numberField, selectField, checkField, section, grid, note, issueArea, staticField } from '../fields.js';
import { rowList } from './rows.js';
import { customArea } from './location.js';
import { entityList } from './servers.js';
import { confirmDialog, promptDialog } from '../dialogs.js';
import {
  newUpstream, newUpstreamServer, duplicateUpstream, entityFilePath, upstreamReferences, suggestedUpstreamFile, locationLabel,
} from '../../core/model.js';
import { normalizeDir } from '../../core/paths.js';
import { issuesUnder, countsOf } from '../../core/build.js';
import { isIdentifier } from '../../core/formats.js';
import { t } from '../../core/util.js';

const METHODS = [
  ['round_robin', 'Round robin (default): in turn, by weight'],
  ['least_conn', 'least_conn: fewest active connections'],
  ['ip_hash', 'ip_hash: same client IP, same server'],
  ['hash', 'hash: by a key you choose'],
  ['random', 'random'],
];

export const upstreamsView = {
  id: 'upstreams',
  label: 'Upstreams',

  render(app, el) {
    const p = app.project;
    if (app.sel.upstream >= p.upstreams.length) app.sel.upstream = Math.max(0, p.upstreams.length - 1);
    this.listBox = h('div', { class: 'list-col' });
    const editor = h('div', { class: 'editor-col scroll' });
    el.append(h('div', { class: 'split' }, this.listBox, editor));
    this.renderList(app);
    if (!p.upstreams.length) { editor.append(emptyState(app)); return; }
    editor.append(upstreamEditor(app, app.sel.upstream));
  },

  refresh(app) {
    if (this.listBox?.isConnected) this.renderList(app);
  },

  renderList(app) {
    const issues = app.build ? app.build.issues : [];
    replace(this.listBox, entityList(app, {
      title: 'Upstream groups',
      items: app.project.upstreams.map((u, i) => ({
        name: t(u.name) || `Upstream ${i + 1}`,
        sub: entityFilePath(u, app.project.settings),
        disabled: !u.enabled,
        counts: countsOf(issuesUnder(issues, `upstreams.${i}`)),
      })),
      selected: app.sel.upstream,
      onSelect: (i) => { app.sel.upstream = i; app.previewPinned = null; app.renderView(); app.preview.refresh(); },
      onAdd: () => addUpstream(app),
      addLabel: 'New',
      empty: 'None yet.',
    }));
  },
};

async function addUpstream(app) {
  const name = await promptDialog({
    title: 'New upstream group', label: 'Upstream name', value: 'ext_app',
    hint: 'Used in proxy_pass http://<name>. The reference layout uses ext_<app> for external and int_<app> for internal groups.',
    validate: (v) => (!v ? 'Enter a name.' : !isIdentifier(v) ? 'Use letters, digits, _ and - only.' : app.project.upstreams.some((u) => u.name.toLowerCase() === v.toLowerCase()) ? 'An upstream with this name already exists.' : null),
    confirmLabel: 'Create',
  });
  if (!name) return;
  const category = /^ext_/i.test(name) ? 'external' : /^int_/i.test(name) ? 'internal' : '';
  app.update((p) => {
    p.upstreams.push(newUpstream(p, { name, category }));
    app.sel.upstream = p.upstreams.length - 1;
  });
  app.preview.refresh();
}

function emptyState(app) {
  return h('div', { class: 'empty' },
    icon('layers', { size: 32 }),
    h('h2', { text: 'No upstream groups yet' }),
    h('p', { text: 'An upstream group lists the backend servers for an application (upstream ext_app { server 10.0.0.11:9000; … }). It is written to its own file and loaded through upstreams.conf.' }),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => addUpstream(app) }, icon('plus'), h('span', { text: 'New upstream group' })));
}

function upstreamEditor(app, i) {
  const p = app.project;
  const base = ['upstreams', i];
  const u = p.upstreams[i];
  const file = app.build?.files.find((f) => f.src === `upstreams.${i}`);
  const dirs = [...new Set([normalizeDir(p.settings.upstreamDir), ...p.upstreams.map((x) => normalizeDir(x.outputDir))].filter(Boolean))];
  const outPath = h('span', { class: 'mono', text: entityFilePath(u, p.settings) });
  const updatePath = () => { outPath.textContent = entityFilePath(u, p.settings); };
  const refs = upstreamReferences(p, u.name);

  // Renaming keeps the locations that used this upstream when editing started pointing at it.
  let refIds = null;
  let prevName = u.name;
  const nameField = textField(app, [...base, 'name'], { label: 'Name', required: true, width: 'm', placeholder: 'ext_app', hint: 'Used in proxy_pass http://<name>. Renaming updates the locations that use it.' });
  const nameInput = nameField.querySelector('input');
  nameInput.addEventListener('focus', () => { refIds = new Set(upstreamReferences(p, u.name).map((r) => r.loc.id)); prevName = u.name; });
  nameInput.addEventListener('input', () => {
    if (!refIds) refIds = new Set(upstreamReferences(p, prevName).map((r) => r.loc.id));
    for (const cfg of p.servers) for (const blk of cfg.blocks) for (const loc of blk.locations) if (refIds.has(loc.id)) loc.proxyPass.upstream = u.name;
    if (u.fileName === suggestedUpstreamFile(prevName) && t(u.name)) {
      u.fileName = suggestedUpstreamFile(u.name);
      const fileInput = document.getElementById(`f-upstreams-${i}-fileName`);
      if (fileInput) fileInput.value = u.fileName;
    }
    prevName = u.name;
    updatePath();
    titleEl.textContent = t(u.name) || 'Upstream group';
  });
  nameInput.addEventListener('blur', () => { refIds = null; });

  const titleEl = h('h2', { class: 'editor-title mono', text: t(u.name) || 'Upstream group' });
  const header = h('div', { class: 'editor-head' },
    h('div', {}, titleEl,
      h('div', { class: 'editor-sub' }, icon('file', { size: 14 }), outPath, u.enabled ? null : h('span', { class: 'chip chip-muted', text: 'turned off: not loaded' }))),
    h('div', { class: 'editor-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => app.update((proj) => { duplicateUpstream(proj, i); app.sel.upstream = i + 1; }) }, icon('duplicate'), h('span', { text: 'Duplicate' })),
      h('button', {
        type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
          const used = upstreamReferences(p, u.name).length;
          const ok = await confirmDialog({
            title: `Delete upstream ${t(u.name)}?`,
            message: used ? `${used} location(s) proxy to this upstream; they will show an error until you choose another upstream.` : 'The upstream group is removed from the project.',
            confirmLabel: 'Delete', danger: true,
          });
          if (ok) app.update((proj) => { proj.upstreams.splice(i, 1); app.sel.upstream = Math.max(0, i - 1); });
        },
      }, icon('trash'), h('span', { text: 'Delete' }))));

  const identity = h('section', { class: 'card' },
    h('h3', { class: 'card-title', text: 'Upstream group' }),
    grid(nameField,
      textField(app, [...base, 'description'], { label: 'Description', width: 'l', mono: false, placeholder: 'written as a comment' })),
    grid(
      textField(app, [...base, 'environment'], { label: 'Environment', width: 's', mono: false, options: ['production', 'dr', 'staging', 'development'] }),
      textField(app, [...base, 'category'], { label: 'Category', width: 's', options: ['external', 'internal'] }),
      checkField(app, [...base, 'enabled'], { label: 'Turned on (loaded by Nginx)', width: 'm', rerender: true, hint: `Off: written to ${t(p.settings.disabledDirName) || 'disabled'}/, which upstreams.conf does not load.` })),
    grid(
      textField(app, [...base, 'outputDir'], { label: 'Folder', width: 'm', options: dirs, placeholder: 'upstreams/external', onInput: updatePath, hint: 'Nested folders such as upstreams/external/v1 are fine.' }),
      textField(app, [...base, 'fileName'], { label: 'File name', width: 'm', required: true, placeholder: 'app.conf', onInput: updatePath }),
      staticField('Loaded by', file ? (file.loadedBy?.length ? file.loadedBy.join(', ') : u.enabled ? 'nothing (see messages)' : 'not loaded (turned off)') : '–', { width: 'm', mono: false })),
    h('div', { class: 'used-by' },
      h('span', { class: 'label', text: 'Used by' }),
      refs.length
        ? h('ul', { class: 'ref-list' }, refs.map((r) => h('li', {}, h('button', {
          type: 'button', class: 'link-button', onclick: () => app.navigate(`servers.${r.ci}.blocks.${r.bi}.locations.${r.li}`),
        }, `${t(r.cfg.name)} › ${locationLabel(r.loc)}`))))
        : h('span', { class: 'hint', text: 'No location in this project proxies to this upstream yet.' })));

  const lb = h('section', { class: 'card' },
    h('h3', { class: 'card-title', text: 'Load balancing' }),
    grid(
      selectField(app, [...base, 'method'], METHODS, { label: 'Method', width: 'l' }),
      u.method === 'hash' ? textField(app, [...base, 'hashKey'], { label: 'Hash key', width: 'm', required: true, placeholder: '$request_uri', options: ['$request_uri', '$remote_addr', '$binary_remote_addr', '$host$request_uri', '$cookie_session'] }) : null,
      u.method === 'hash' ? checkField(app, [...base, 'hashConsistent'], { label: 'Consistent (ketama): fewer keys move when servers change', width: 'm' }) : null,
      u.method === 'random' ? checkField(app, [...base, 'randomTwo'], { label: 'Pick two at random, use the less busy one', width: 'm' }) : null,
    ),
    ['ip_hash', 'hash', 'random'].includes(u.method) ? note(`Backup servers cannot be used with ${u.method}.`) : null);

  const servers = h('section', { class: 'card' },
    h('h3', { class: 'card-title', text: `Backend servers (${u.servers.filter((s) => s.enabled).length} on)` }),
    h('p', { class: 'hint', text: 'Turning a server off keeps it in the file as a comment, like a node taken out of rotation. "down" keeps it listed but marks it unavailable.' }),
    issueArea(app, `upstreams.${i}.servers`),
    rowList(app, {
      path: [...base, 'servers'], addLabel: 'Add server', reorder: true, cls: 'rows-wide',
      create: () => newUpstreamServer({ port: u.servers[u.servers.length - 1]?.port ?? null }),
      columns: [
        { key: 'on', label: 'On', width: '3.2rem', render: (rp) => checkField(app, [...rp, 'enabled'], { label: 'On', width: 'full', rerender: false }) },
        { key: 'address', label: 'Address', width: 'minmax(10rem, 1.6fr)', render: (rp) => textField(app, [...rp, 'address'], { label: 'Address', hideLabel: true, width: 'full', required: true, placeholder: '10.0.0.11' }) },
        { key: 'port', label: 'Port', width: 'minmax(5.5rem, 0.7fr)', render: (rp) => numberField(app, [...rp, 'port'], { label: 'Port', hideLabel: true, width: 'full', required: true, placeholder: '9000', min: 1, max: 65535 }) },
        { key: 'weight', label: 'Weight', width: 'minmax(4.5rem, 0.5fr)', render: (rp) => numberField(app, [...rp, 'weight'], { label: 'Weight', hideLabel: true, width: 'full', placeholder: '1', min: 1 }) },
        { key: 'mf', label: 'max_fails', width: 'minmax(5rem, 0.5fr)', render: (rp) => numberField(app, [...rp, 'maxFails'], { label: 'max_fails', hideLabel: true, width: 'full', placeholder: '1', min: 0 }) },
        { key: 'ft', label: 'fail_timeout', width: 'minmax(5.5rem, 0.6fr)', render: (rp) => textField(app, [...rp, 'failTimeout'], { label: 'fail_timeout', hideLabel: true, width: 'full', placeholder: '10s' }) },
        { key: 'mc', label: 'max_conns', width: 'minmax(5rem, 0.5fr)', render: (rp) => numberField(app, [...rp, 'maxConns'], { label: 'max_conns', hideLabel: true, width: 'full', placeholder: '0', min: 0 }) },
        { key: 'backup', label: 'Backup', width: '4.6rem', render: (rp) => checkField(app, [...rp, 'backup'], { label: 'backup', width: 'full' }) },
        { key: 'down', label: 'Down', width: '4.2rem', render: (rp) => checkField(app, [...rp, 'down'], { label: 'down', width: 'full' }) },
        { key: 'comment', label: 'Comment', width: 'minmax(8rem, 1fr)', render: (rp) => textField(app, [...rp, 'comment'], { label: 'Comment', hideLabel: true, width: 'full', mono: false, placeholder: 'optional' }) },
      ],
    }));

  const keep = section(app, `${u.id}#keepalive`, {
    title: 'Keepalive and shared memory', open: true, issuePath: `upstreams.${i}.keepalive`,
    summary: u.keepalive !== null ? `keepalive ${u.keepalive}` : 'no keepalive',
  },
  h('p', { class: 'hint', text: 'Idle connections kept open to the backends. They are only reused when locations send HTTP/1.1 with an empty Connection header (the shared proxy parameters do).' }),
  grid(
    numberField(app, [...base, 'keepalive'], { label: 'keepalive (connections)', placeholder: 'off', min: 1 }),
    numberField(app, [...base, 'keepaliveRequests'], { label: 'keepalive_requests', placeholder: '1000', min: 1 }),
    textField(app, [...base, 'keepaliveTime'], { label: 'keepalive_time', width: 's', placeholder: '1h' }),
    textField(app, [...base, 'keepaliveTimeout'], { label: 'keepalive_timeout', width: 's', placeholder: '60s' }),
    textField(app, [...base, 'zoneSize'], { label: 'Shared zone size', width: 's', placeholder: 'e.g. 64k', hint: 'Shares server state between worker processes.' }),
  ));

  const custom = section(app, `${u.id}#custom`, { title: 'Custom directives (upstream block)', summary: t(u.customDirectives) ? 'set' : 'none', issuePath: `upstreams.${i}.customDirectives` },
    customArea(app, [...base, 'customDirectives'], 'upstream'));

  return h('div', { class: 'editor' }, header, issueArea(app, `upstreams.${i}`), identity, lb, servers, keep, custom);
}
