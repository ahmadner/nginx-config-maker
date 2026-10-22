// Top toolbar: project name, validation status, import/export and the ZIP download.

import { h, icon, button } from '../dom.js';
import { importExportView } from './importexport.js';

export function toolbar(app) {
  const nameInput = h('input', {
    type: 'text', class: 'project-name', id: 'toolbar-project-name', 'aria-label': 'Project name', autocomplete: 'off', spellcheck: false,
    placeholder: 'Project name', maxlength: 100,
  });
  nameInput.addEventListener('input', () => app.set(['project', 'name'], nameInput.value, { rerender: false }));
  nameInput.addEventListener('change', () => {
    if (!nameInput.value.trim()) return;
    nameInput.value = nameInput.value.trim();
    app.set(['project', 'name'], nameInput.value, { rerender: false });
  });

  const env = h('span', { class: 'env-chip', hidden: true });
  const saveState = h('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
  const status = h('button', { type: 'button', class: 'status-pill', onclick: () => { app.switchTab('overview'); requestAnimationFrame(() => document.getElementById('overview-issues')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); } });

  const importBtn = button('Import YAML', () => { app.switchTab('import'); importExportView.pick(app); }, { icon: 'upload', title: 'Import a project from a YAML file' });
  const exportBtn = button('Export YAML', () => app.exportYaml(), { icon: 'download', title: 'Save this project as a YAML file' });
  const zipBtn = button('Download ZIP', () => app.downloadZip(), { icon: 'download', kind: 'primary', title: 'Download every generated file as a ZIP package' });
  const previewBtn = button('Preview', () => {
    const open = !app.root.classList.contains('preview-closed');
    app.root.classList.toggle('preview-closed', open);
    app.setPref('previewOpen', !open);
    previewBtn.setAttribute('aria-pressed', String(!open));
  }, { icon: 'panel', iconOnly: true, title: 'Show or hide the preview panel', attrs: { 'aria-pressed': String(app.prefs.previewOpen) } });
  const menuBtn = button('Show or hide projects and files', () => {
    if (window.matchMedia('(max-width: 860px)').matches) { app.root.classList.toggle('sidebar-open'); return; }
    const collapsed = !app.root.classList.contains('sidebar-collapsed');
    app.root.classList.toggle('sidebar-collapsed', collapsed);
    app.setPref('sidebarCollapsed', collapsed);
  }, { icon: 'menu', iconOnly: true });

  const el = h('header', { class: 'toolbar' },
    menuBtn,
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('layers', { size: 18 })), h('span', { class: 'brand-name', text: 'Nginx Config Generator' })),
    h('div', { class: 'toolbar-project' }, nameInput, env, saveState),
    h('div', { class: 'toolbar-spacer' }),
    status,
    h('div', { class: 'toolbar-actions' }, importBtn, exportBtn, zipBtn, previewBtn));

  function refresh() {
    const p = app.project;
    const has = !!p;
    for (const b of [exportBtn, zipBtn]) b.disabled = !has;
    nameInput.disabled = !has;
    status.hidden = !has;
    if (!has) { nameInput.value = ''; env.hidden = true; return; }
    if (document.activeElement !== nameInput) nameInput.value = p.project.name;
    env.hidden = !p.project.environment.trim();
    env.textContent = p.project.environment.trim();
    const c = app.build ? app.build.counts : { error: 0, warning: 0, info: 0 };
    status.className = `status-pill ${c.error ? 'status-error' : c.warning ? 'status-warning' : 'status-ok'}`;
    status.replaceChildren(
      icon(c.error ? 'error' : c.warning ? 'alert' : 'check'),
      h('span', { text: c.error ? `${c.error} error${c.error === 1 ? '' : 's'}` : c.warning ? 'No errors' : 'No problems found' }),
      c.warning ? h('span', { class: 'status-sub', text: `${c.warning} warning${c.warning === 1 ? '' : 's'}` }) : null);
    status.title = `${c.error} errors, ${c.warning} warnings, ${c.info} notes. Errors block the ZIP download. Click for details.`;
    zipBtn.classList.toggle('btn-blocked', c.error > 0);
    zipBtn.title = c.error ? 'Fix the errors before downloading the package' : 'Download every generated file as a ZIP package';
  }

  function setSaveState(state, message) {
    saveState.className = `save-state save-${state}`;
    saveState.textContent = state === 'error' ? `Not saved: ${message}` : app.persistent ? 'Saved in this browser' : 'Not saved (no browser storage)';
  }

  setSaveState('saved');
  return { el, refresh, setSaveState };
}
