// Generated files tab: the complete package tree and the exact content of each file.

import { h, icon, button, replace, fmtBytes } from '../dom.js';
import { fileTree } from '../tree.js';
import { CodeView, issueList } from '../codeview.js';
import { copyText, toast } from '../dialogs.js';

const KIND = {
  server: 'Server configuration', upstream: 'Upstream group', 'upstream-index': 'Upstream index', snippet: 'Shared include file',
  shared: 'Shared http definitions', manifest: 'Package manifest', readme: 'Installation instructions', project: 'Project file (YAML)',
};

export const filesView = {
  id: 'files',
  label: 'Generated files',

  render(app, el) {
    this.treeBox = h('div', { class: 'files-tree' });
    this.head = h('div', { class: 'files-head' });
    this.issues = h('div', { class: 'files-issues' });
    this.code = new CodeView({ label: 'File content' });
    el.append(h('div', { class: 'split split-files' },
      h('div', { class: 'list-col' },
        h('div', { class: 'entity-head' }, h('h2', { text: 'Package' }),
          button('ZIP', () => app.downloadZip(), { icon: 'download', kind: 'primary', cls: 'btn-small', title: 'Download the whole package as a ZIP' })),
        h('p', { class: 'hint pad', text: 'Exactly what the ZIP contains. Select a file to view it.' }),
        this.treeBox),
      h('div', { class: 'files-viewer' }, this.head, this.issues, this.code.el)));
    this.refresh(app);
  },

  packageReady(app) { this.refresh(app); },

  refresh(app) {
    if (!this.treeBox?.isConnected || !app.build) return;
    const pkg = app.pkg && app.pkgFor === app.build ? app.pkg : null;
    const files = app.build.files;
    const entries = pkg
      ? pkg.entries.map((e) => ({ ...e, ...(e.file ? { counts: e.file.counts, enabled: e.file.enabled, loadedBy: e.file.loadedBy, src: e.file.src, lineMap: e.file.lineMap } : {}) }))
      : files.map((f) => ({ path: f.path, content: f.content, kind: f.kind, counts: f.counts, enabled: f.enabled, loadedBy: f.loadedBy, src: f.src }));
    if (!entries.length) {
      replace(this.treeBox, h('p', { class: 'empty-small pad', text: 'No files yet.' }));
      replace(this.head);
      replace(this.issues);
      this.code.update('', []);
      return;
    }
    if (!entries.some((e) => e.path === app.sel.file)) app.sel.file = entries[0].path;
    const current = entries.find((e) => e.path === app.sel.file);
    const enc = new TextEncoder();
    const root = app.project.settings.package.rootFolder.trim();
    replace(this.treeBox, fileTree(entries.map((e) => ({ ...e, bytes: enc.encode(e.content).length })), {
      selected: app.sel.file, rootLabel: root || null, collapsed: app.collapsedFolders, showSize: true,
      onToggle: (path, collapsed) => { if (collapsed) app.collapsedFolders.add(path); else app.collapsedFolders.delete(path); },
      onSelect: (path) => { app.sel.file = path; this.refresh(app); app.sidebar.refresh(); this.treeBox.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus(); },
    }));

    const c = current.counts || { error: 0, warning: 0 };
    const loaded = current.kind === 'snippet' ? 'included by server blocks' : current.loadedBy ? (current.enabled === false ? 'not loaded (turned off)' : current.loadedBy.length ? `loaded by ${current.loadedBy.join(', ')}` : 'not loaded by nginx.conf') : 'not configuration: stays in the staging folder';
    replace(this.head,
      h('div', { class: 'files-title' },
        icon('file'), h('h2', { class: 'mono', text: root ? `${root}/${current.path}` : current.path }),
        c.error ? h('span', { class: 'count-badge count-error', text: `${c.error} error${c.error === 1 ? '' : 's'}` }) : null,
        c.warning ? h('span', { class: 'count-badge count-warning', text: `${c.warning} warning${c.warning === 1 ? '' : 's'}` }) : null),
      h('div', { class: 'files-meta' },
        h('span', { text: KIND[current.kind] || current.kind }), h('span', { text: '·' }),
        h('span', { text: fmtBytes(enc.encode(current.content).length) }), h('span', { text: '·' }),
        h('span', { text: loaded })),
      h('div', { class: 'files-actions' },
        button('Copy', async () => {
          const ok = await copyText(current.content);
          toast(ok ? `Copied ${current.path}.` : 'Copy failed; select the text and copy it manually.', ok ? 'success' : 'error');
        }, { icon: 'copy' }),
        button('Download file', () => app.downloadFile(current.path), { icon: 'download', disabled: c.error > 0, title: c.error ? 'Fix this file\'s errors first' : `Download ${current.path.split('/').pop()}` }),
        current.src && current.src !== 'settings.sharedHttpPath' ? button('Edit source', () => app.navigate(current.src), { icon: 'link' }) : null));
    const fileIssues = app.build.issues.filter((i) => i.file === current.path);
    replace(this.issues, fileIssues.length ? issueList(fileIssues.map((i) => ({ ...i, where: i.line ? `line ${i.line}` : app.where(i) })), { onSelect: (i) => app.navigate(i.path) }) : null);
    const lang = current.path.endsWith('.conf') ? 'nginx' : current.path.endsWith('.yml') ? 'yaml' : 'plain';
    this.code.update(current.content, fileIssues, { language: lang });
  },
};
