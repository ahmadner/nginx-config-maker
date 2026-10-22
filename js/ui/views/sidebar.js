// Left sidebar: projects (create, open, rename, duplicate, reset, delete) and the generated file tree.

import { h, icon, button, timeAgo, replace } from '../dom.js';
import { fileTree } from '../tree.js';
import { popupMenu, promptDialog, confirmDialog, toast } from '../dialogs.js';
import { resetProject } from '../../core/model.js';
import { importExportView } from './importexport.js';

export function sidebar(app) {
  const projectList = h('ul', { class: 'project-list', 'aria-label': 'Projects' });
  const treeBox = h('div', { class: 'tree-box' });
  const fileCount = h('span', { class: 'side-count' });

  const newBtn = button('New project', (e) => popupMenu(e.currentTarget, [
    { label: 'Empty project…', icon: 'plus', onSelect: async () => {
      const name = await promptDialog({ title: 'New project', label: 'Project name', value: 'New project', hint: 'For example Production Servers, DR Environment or Development Environment.', validate: (v) => (v ? null : 'Enter a name.'), confirmLabel: 'Create' });
      if (name) app.newEmptyProject(name);
    } },
    { label: 'Sample project (placeholders)', icon: 'sample', onSelect: () => app.newSampleProject() },
    { label: 'Import YAML file…', icon: 'upload', onSelect: () => importExportView.pickAsNew(app) },
  ]), { icon: 'plus', iconOnly: true, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });

  const el = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Projects and files' },
    h('div', { class: 'side-section' },
      h('div', { class: 'side-head' }, h('h2', { text: 'Projects' }), newBtn),
      projectList),
    h('div', { class: 'side-section side-grow' },
      h('div', { class: 'side-head' }, h('h2', { text: 'Generated files' }), fileCount),
      treeBox));

  function projectMenu(anchor, entry) {
    const isActive = entry.id === app.store.activeId;
    popupMenu(anchor, [
      { label: 'Open', icon: 'eye', disabled: isActive, onSelect: () => app.openProject(entry.id) },
      { label: 'Rename…', icon: 'file', onSelect: async () => {
        const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: entry.project.project.name, validate: (v) => (v ? null : 'Enter a name.'), confirmLabel: 'Rename' });
        if (name) { app.store.rename(entry.id, name); app.rebuildNow(); }
      } },
      { label: 'Duplicate', icon: 'duplicate', onSelect: () => {
        app.store.duplicate(entry.id);
        app.openProject(app.store.activeId);
        toast(`Created "${app.project.project.name}".`, 'success');
      } },
      'separator',
      { label: 'Reset…', icon: 'x', danger: true, onSelect: async () => {
        const ok = await confirmDialog({
          title: `Reset "${entry.project.project.name}"?`,
          message: 'This removes every server configuration, upstream group and rate limit zone, and restores the default settings. The project name is kept. Export the project as YAML first if you may need it again.',
          confirmLabel: 'Reset project', danger: true,
        });
        if (!ok) return;
        resetProject(entry.project);
        app.store.touch(entry.id);
        app.store.save();
        if (isActive) { app.sel = { server: 0, upstream: 0, file: null }; app.rerender(); } else app.rebuildNow();
        toast('Project reset.', 'success');
      } },
      { label: 'Delete…', icon: 'trash', danger: true, onSelect: async () => {
        const ok = await confirmDialog({
          title: `Delete "${entry.project.project.name}"?`,
          message: 'The project is removed from this browser. This cannot be undone; export it as YAML first if you may need it again.',
          confirmLabel: 'Delete project', danger: true,
        });
        if (!ok) return;
        app.store.remove(entry.id);
        app.openProject(app.store.activeId);
        if (!app.project) { app.rebuildNow(); app.renderView(); }
        toast('Project deleted.', 'success');
      } },
    ]);
  }

  function refresh() {
    replace(projectList, app.store.projects.map((entry) => {
      const active = entry.id === app.store.activeId;
      const p = entry.project;
      const counts = active && app.build ? app.build.counts : null;
      return h('li', { class: ['project-item', active && 'active'] },
        h('button', {
          type: 'button', class: 'project-open', 'aria-current': active ? 'true' : undefined,
          onclick: () => { if (!active) app.openProject(entry.id); app.root.classList.remove('sidebar-open'); },
        },
        h('span', { class: 'project-title', text: p.project.name || 'Untitled' }),
        h('span', { class: 'project-meta', text: [p.project.environment, `${p.servers.length} server config${p.servers.length === 1 ? '' : 's'}, ${p.upstreams.length} upstream${p.upstreams.length === 1 ? '' : 's'}`, timeAgo(entry.updatedAt)].filter(Boolean).join(' · ') }),
        counts && (counts.error || counts.warning) ? h('span', { class: ['dot', counts.error ? 'dot-error' : 'dot-warning'], title: `${counts.error} errors, ${counts.warning} warnings` }) : null),
        h('button', {
          type: 'button', class: 'btn btn-icon btn-ghost project-menu', 'aria-label': `Actions for ${p.project.name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
          onclick: (e) => projectMenu(e.currentTarget, entry),
        }, icon('dots')));
    }));
    if (!app.store.projects.length) projectList.append(h('li', { class: 'empty-small', text: 'No projects yet.' }));

    if (!app.build) { replace(treeBox, h('p', { class: 'empty-small', text: 'Files appear here as you build the project.' })); fileCount.textContent = ''; return; }
    const pkg = app.pkg && app.pkgFor === app.build ? app.pkg : null;
    const counts = new Map(app.build.files.map((f) => [f.path, f.counts]));
    const enabled = new Map(app.build.files.map((f) => [f.path, f.enabled]));
    const entries = (pkg ? pkg.entries : app.build.files).map((e) => ({ path: e.path, counts: counts.get(e.path), enabled: enabled.get(e.path) }));
    fileCount.textContent = String(entries.length);
    if (!entries.length) { replace(treeBox, h('p', { class: 'empty-small', text: 'No files yet. Add a server configuration or an upstream group.' })); return; }
    const root = app.project.settings.package.rootFolder.trim();
    replace(treeBox, fileTree(entries, {
      selected: app.tab === 'files' ? app.sel.file : null,
      rootLabel: root || null,
      collapsed: app.collapsedFolders,
      onToggle: (path, collapsed) => { if (collapsed) app.collapsedFolders.add(path); else app.collapsedFolders.delete(path); },
      onSelect: (path) => { app.sel.file = path; app.root.classList.remove('sidebar-open'); if (app.tab === 'files') app.renderView(); else app.switchTab('files'); refresh(); },
    }));
  }

  return { el, refresh };
}
