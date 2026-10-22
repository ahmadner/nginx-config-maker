// Application controller: active project, selection, rebuild loop, issue placement and navigation.
//
// Rendering model: the active tab renders its forms once (on tab or selection change and after
// structural edits). Typing only updates the model; a debounced rebuild then refreshes the preview,
// status, file tree and the inline messages, without re-creating the form under the cursor.

import { h, clear, debounce, fieldId } from './dom.js';
import { buildAll } from '../core/build.js';
import { buildPackage, zipPackage } from '../core/package.js';
import { projectToYaml } from '../core/yaml-io.js';
import { projectFileNameFor } from '../core/validate.js';
import { getIn, setIn, t } from '../core/util.js';
import { newProject } from '../core/model.js';
import { sampleProject } from '../core/sample.js';
import { ProjectStore, browserStorage, loadPrefs, savePrefs, STORAGE_KEY } from './store.js';
import { confirmDialog, alertDialog, toast, downloadBlob, downloadText } from './dialogs.js';

import { toolbar } from './views/toolbar.js';
import { sidebar } from './views/sidebar.js';
import { previewPanel } from './views/preview.js';
import { overviewView } from './views/overview.js';
import { serversView } from './views/servers.js';
import { upstreamsView } from './views/upstreams.js';
import { filesView } from './views/files.js';
import { importExportView } from './views/importexport.js';
import { settingsView } from './views/settings.js';

export const TABS = [overviewView, serversView, upstreamsView, filesView, importExportView, settingsView];

export class App {
  constructor(root) {
    this.root = root;
    const { storage, persistent } = browserStorage();
    this.storage = storage;
    this.persistent = persistent;
    this.store = new ProjectStore(storage).load();
    this.prefs = { theme: 'system', previewOpen: true, sidebarCollapsed: false, ...loadPrefs(storage) };
    this.tab = 'overview';
    this.sel = { server: 0, upstream: 0, file: null };
    this.openState = new Map();
    this.collapsedFolders = new Set();
    this.slots = new Map();
    this.build = null;
    this.pkg = null;
    this.pkgFor = null;
    this.previewPinned = null;
    this.saveSoon = debounce(() => this.save(), 400);
    this.rebuildSoon = debounce(() => this.rebuildNow(), 160);
    this.packageSoon = debounce(() => this.refreshPackage(), 350);
  }

  // ---------- Startup ----------
  mount() {
    this.applyTheme();
    this.toolbar = toolbar(this);
    this.sidebar = sidebar(this);
    this.preview = previewPanel(this);
    this.tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Workspace' });
    this.panel = h('div', { class: 'tabpanel', role: 'tabpanel', tabIndex: -1 });
    this.banner = h('div', { class: 'banners' });
    const workspace = h('main', { class: 'workspace', id: 'workspace' }, this.banner, this.tabsEl, this.panel);
    workspace.addEventListener('focusin', (e) => {
      const path = e.target?.dataset?.path;
      if (path) this.preview.focusPath(path);
    });
    clear(this.root);
    this.root.append(this.toolbar.el, h('div', { class: 'body' }, this.sidebar.el, workspace, this.preview.el));
    // On narrow screens the preview is an overlay; start with it closed there.
    this.root.classList.toggle('preview-closed', !this.prefs.previewOpen || window.innerWidth < 1100);
    this.root.classList.toggle('sidebar-collapsed', !!this.prefs.sidebarCollapsed);
    this.fromHash(false);
    this.renderTabs();

    window.addEventListener('hashchange', () => this.fromHash());
    window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) this.showExternalChange(); });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveSoon.flush();
        toast(this.persistent ? 'All changes are saved in this browser. Use Export YAML to save a project file.' : 'Browser storage is not available; use Export YAML to keep your work.', 'info');
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (!this.persistent && this.project && (this.project.servers.length || this.project.upstreams.length)) { e.preventDefault(); e.returnValue = ''; }
    });

    if (!this.persistent) this.addBanner('warning', 'Browser storage is not available (private window or blocked site data). Your changes are lost when you close this page: use Export YAML to keep them.');
    for (const w of this.store.loadWarnings) this.addBanner('warning', w);
    this.rebuildNow();
    this.renderView();
  }

  fromHash(render = true) {
    const tab = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (TABS.some((v) => v.id === tab) && tab !== this.tab) {
      this.tab = tab;
      if (render) { this.renderTabs(); this.renderView(); this.preview.refresh(); }
    }
  }

  // ---------- Project access ----------
  get entry() { return this.store.active; }
  get project() { return this.store.active ? this.store.active.project : null; }

  get(path) { return getIn(this.project, path); }

  /** Sets a model value. rerender: true re-renders the current view (for choices that show/hide fields). */
  set(path, value, { rerender = false } = {}) {
    setIn(this.project, path, value);
    this.changed({ rerender });
  }

  /** Applies a structural change (add/remove/move) and re-renders. */
  update(fn, { rerender = true } = {}) {
    fn(this.project);
    this.changed({ rerender });
  }

  changed({ rerender }) {
    this.store.touch();
    this.saveSoon();
    if (rerender) {
      this.rebuildNow();
      this.renderView();
    } else {
      this.rebuildSoon();
    }
  }

  rerender() {
    this.rebuildNow();
    this.renderView();
  }

  save() {
    if (!this.store.save()) this.toolbar.setSaveState('error', this.store.saveError);
    else this.toolbar.setSaveState('saved');
  }

  // ---------- Build ----------
  rebuildNow() {
    this.rebuildSoon.cancel();
    this.build = this.project ? buildAll(this.project) : null;
    this.pkg = null;
    if (this.project) this.packageSoon();
    this.refreshAll();
  }

  refreshAll() {
    this.root.classList.toggle('no-project', !this.project);
    this.toolbar.refresh();
    this.sidebar.refresh();
    this.preview.refresh();
    const view = this.currentView();
    view.refresh?.(this);
    this.applyIssues();
  }

  async refreshPackage() {
    if (!this.project || !this.build) return null;
    const build = this.build;
    try {
      const pkg = await buildPackage(this.project, build, { now: new Date() });
      if (build !== this.build) return null; // outdated
      this.pkg = pkg;
      this.pkgFor = build;
      this.currentView().packageReady?.(this);
      this.sidebar.refresh();
      this.preview.refresh();
      return pkg;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async ensurePackage() {
    if (this.rebuildSoon) this.rebuildSoon.flush();
    if (this.pkg && this.pkgFor === this.build) return this.pkg;
    this.packageSoon.cancel();
    return this.refreshPackage();
  }

  // ---------- Slots (inline validation messages) ----------
  registerSlot(path, slot) {
    if (!this.slots.has(path)) this.slots.set(path, []);
    this.slots.get(path).push({ ...slot, count: { error: 0, warning: 0, info: 0 } });
  }

  applyIssues() {
    const issues = this.build ? this.build.issues : [];
    for (const list of this.slots.values()) {
      for (const s of list) {
        if (!s.el.isConnected) continue;
        s.count = { error: 0, warning: 0, info: 0 };
        if (s.kind !== 'badge') clear(s.el);
        if (s.kind === 'field') {
          s.control?.removeAttribute('aria-invalid');
          s.wrapper?.classList.remove('has-error', 'has-warning');
        }
      }
    }
    for (const issue of issues) {
      if (!issue.path) continue;
      let target = (this.slots.get(issue.path) || []).find((s) => (s.kind === 'field' || s.kind === 'section') && s.el.isConnected);
      if (!target) {
        let p = issue.path;
        while (!target && p.includes('.')) {
          p = p.slice(0, p.lastIndexOf('.'));
          target = (this.slots.get(p) || []).find((s) => s.kind === 'section' && s.el.isConnected);
        }
      }
      if (target) {
        target.el.append(h('div', { class: ['msg', `msg-${issue.level}`], role: issue.level === 'error' ? 'alert' : undefined, text: issue.message }));
        if (target.kind === 'field') {
          if (issue.level === 'error') { target.control?.setAttribute('aria-invalid', 'true'); target.wrapper?.classList.add('has-error'); }
          else if (issue.level === 'warning') target.wrapper?.classList.add('has-warning');
        }
      }
      let p = issue.path;
      for (;;) {
        for (const s of this.slots.get(p) || []) if (s.kind === 'badge') s.count[issue.level]++;
        if (!p.includes('.')) break;
        p = p.slice(0, p.lastIndexOf('.'));
      }
    }
    for (const list of this.slots.values()) {
      for (const s of list) {
        if (s.kind !== 'badge' || !s.el.isConnected) continue;
        const { error, warning } = s.count;
        s.el.hidden = !error && !warning;
        s.el.className = `count-badge ${error ? 'count-error' : 'count-warning'}`;
        s.el.textContent = error ? `${error} error${error === 1 ? '' : 's'}` : warning ? `${warning} warning${warning === 1 ? '' : 's'}` : '';
      }
    }
  }

  // ---------- Views ----------
  currentView() {
    return TABS.find((v) => v.id === this.tab) || TABS[0];
  }

  renderTabs() {
    clear(this.tabsEl);
    TABS.forEach((v, i) => {
      const selected = v.id === this.tab;
      const btn = h('button', {
        type: 'button', role: 'tab', class: 'tab', id: `tab-${v.id}`, 'aria-selected': String(selected), 'aria-controls': 'tabpanel',
        tabIndex: selected ? 0 : -1, onclick: () => this.switchTab(v.id),
      }, v.label, h('span', { class: 'tab-key', 'aria-hidden': 'true', text: '' }));
      btn.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (dir) { e.preventDefault(); const next = TABS[(i + dir + TABS.length) % TABS.length]; this.switchTab(next.id); this.tabsEl.querySelector(`#tab-${next.id}`)?.focus(); }
        if (e.key === 'Home') { e.preventDefault(); this.switchTab(TABS[0].id); this.tabsEl.firstChild.focus(); }
        if (e.key === 'End') { e.preventDefault(); this.switchTab(TABS[TABS.length - 1].id); this.tabsEl.lastChild.focus(); }
      });
      this.tabsEl.append(btn);
    });
    this.panel.id = 'tabpanel';
    this.panel.setAttribute('aria-labelledby', `tab-${this.tab}`);
    this.root.dataset.tab = this.tab;
  }

  switchTab(id) {
    if (id === this.tab) return;
    this.tab = id;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    this.previewPinned = null;
    this.renderTabs();
    this.renderView();
    this.preview.refresh();
    this.sidebar.refresh();
  }

  /** Re-renders the active view, keeping focus and scroll position. */
  renderView() {
    const active = document.activeElement;
    const focusId = active && this.panel.contains(active) ? active.id : null;
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const scroller = this.panel.querySelector('.scroll');
    // Keep the scroll position only when re-rendering the same editor (not after switching tab or entity).
    const viewKey = `${this.store.activeId}|${this.tab}|${this.sel.server}|${this.sel.upstream}`;
    const scrollTop = scroller && viewKey === this.lastViewKey ? scroller.scrollTop : 0;
    this.lastViewKey = viewKey;
    for (const [k, list] of this.slots) this.slots.set(k, list.filter((s) => !this.panel.contains(s.el)));
    clear(this.panel);
    if (!this.project) {
      this.panel.append(welcome(this));
      return;
    }
    this.currentView().render(this, this.panel);
    const nextScroller = this.panel.querySelector('.scroll');
    if (nextScroller) nextScroller.scrollTop = scrollTop;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel && 'setSelectionRange' in el) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
      }
    }
    this.applyIssues();
  }

  /** Opens the editor for a model path and focuses the field. */
  navigate(path) {
    if (!path) return;
    const parts = path.split('.');
    if (parts[0] === 'servers') { this.sel.server = Number(parts[1]); this.tab = 'servers'; }
    else if (parts[0] === 'upstreams') { this.sel.upstream = Number(parts[1]); this.tab = 'upstreams'; }
    else if (parts[0] === 'settings' || parts[0] === 'rateLimitZones') this.tab = 'settings';
    else this.tab = 'overview';
    history.replaceState(null, '', `#${this.tab}`);
    this.previewPinned = null;
    this.renderTabs();
    this.renderView();
    this.preview.refresh();
    requestAnimationFrame(() => this.focusPath(path));
  }

  focusPath(path) {
    let p = path;
    let el = null;
    for (;;) {
      el = document.getElementById(fieldId(p));
      if (el) break;
      const slot = (this.slots.get(p) || []).find((s) => s.el.isConnected);
      if (slot) { el = slot.el.closest('details, .card, section') || slot.el; break; }
      if (!p.includes('.')) break;
      p = p.slice(0, p.lastIndexOf('.'));
    }
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) {
      if (!d.open) { d.open = true; if (d.dataset.key) this.openState.set(d.dataset.key, true); }
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el.matches('input, select, textarea, button')) el.focus({ preventScroll: true });
    else {
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
    this.preview.focusPath(path);
  }

  // ---------- Projects ----------
  openProject(id) {
    if (!this.store.setActive(id)) return;
    this.sel = { server: 0, upstream: 0, file: null };
    this.previewPinned = null;
    this.openState.clear();
    this.rebuildNow();
    this.renderView();
  }

  addProject(project, { message } = {}) {
    this.store.add(project);
    this.sel = { server: 0, upstream: 0, file: null };
    this.previewPinned = null;
    this.rebuildNow();
    if (this.tab === 'import') this.switchTab('overview');
    else this.renderView();
    if (message) toast(message, 'success');
  }

  newEmptyProject(name = 'New project') { this.addProject(newProject(name), { message: `Created "${name}".` }); }
  newSampleProject() { this.addProject(sampleProject(), { message: 'Opened the sample project. Every address and name in it is a placeholder.' }); }

  replaceActiveProject(project) {
    this.store.replace(this.store.activeId, project);
    this.sel = { server: 0, upstream: 0, file: null };
    this.openState.clear();
    this.rebuildNow();
    this.renderView();
  }

  // ---------- Exports ----------
  exportYaml() {
    const name = projectFileNameFor(this.project);
    downloadText(projectToYaml(this.project), name, 'application/yaml');
    toast(`Downloaded ${name}.`, 'success');
  }

  async downloadZip() {
    this.rebuildSoon.flush();
    const build = this.build;
    if (!build) return;
    if (build.counts.error) {
      const errs = build.issues.filter((i) => i.level === 'error');
      const go = await confirmDialog({
        title: 'Fix the errors first',
        message: `${errs.length} error${errs.length === 1 ? '' : 's'} must be fixed before the package can be downloaded. You can still export the project as YAML.`,
        details: h('ul', { class: 'dialog-list' }, errs.slice(0, 6).map((i) => h('li', { text: i.message })), errs.length > 6 ? h('li', { text: `…and ${errs.length - 6} more` }) : null),
        confirmLabel: 'Show errors', cancelLabel: 'Close',
      });
      if (go) this.navigate(errs[0].path || 'project');
      return;
    }
    if (build.counts.warning) {
      const warns = build.issues.filter((i) => i.level === 'warning');
      const ok = await confirmDialog({
        title: `Download with ${warns.length} warning${warns.length === 1 ? '' : 's'}?`,
        message: 'Warnings do not block the download, but review them first. They are also listed in the README inside the package.',
        details: h('ul', { class: 'dialog-list' }, warns.slice(0, 5).map((i) => h('li', { text: i.message })), warns.length > 5 ? h('li', { text: `…and ${warns.length - 5} more` }) : null),
        confirmLabel: 'Download anyway',
      });
      if (!ok) return;
    }
    try {
      const pkg = await this.ensurePackage();
      if (!pkg) throw new Error('The package could not be built.');
      const bytes = zipPackage(pkg, { now: new Date() });
      downloadBlob(new Blob([bytes], { type: 'application/zip' }), pkg.zipName);
      toast(`Downloaded ${pkg.zipName} (${pkg.entries.length} files).`, 'success');
    } catch (e) {
      await alertDialog({ title: 'The ZIP could not be created', message: String(e && e.message ? e.message : e) });
    }
  }

  /** Downloads one generated file (only when it has no errors). */
  downloadFile(path) {
    const entry = this.pkg?.entries.find((e) => e.path === path) || this.build?.files.find((f) => f.path === path);
    if (!entry) return;
    const file = this.build.files.find((f) => f.path === path);
    if (file && file.counts.error) {
      toast(`${path} has ${file.counts.error} error${file.counts.error === 1 ? '' : 's'}; fix them before downloading it.`, 'error');
      return;
    }
    downloadText(entry.content, path.split('/').pop(), path.endsWith('.md') ? 'text/markdown' : path.endsWith('.yml') ? 'application/yaml' : 'text/plain');
  }

  // ---------- Misc ----------
  applyTheme() {
    const t2 = this.prefs.theme;
    if (t2 === 'light' || t2 === 'dark') document.documentElement.dataset.theme = t2;
    else delete document.documentElement.dataset.theme;
  }

  setPref(key, value) {
    this.prefs[key] = value;
    savePrefs(this.storage, this.prefs);
  }

  addBanner(level, text, action = null) {
    const el = h('div', { class: ['banner', `banner-${level}`], role: 'status' }, h('span', { text }), action,
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => el.remove(), text: 'Dismiss' }));
    this.banner.append(el);
    return el;
  }

  showExternalChange() {
    if (this.banner.querySelector('[data-external]')) return;
    const el = this.addBanner('warning', 'Projects were changed in another tab or window. Reload to see those changes; editing here will overwrite them.',
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => location.reload(), text: 'Reload' }));
    el.dataset.external = '1';
  }

  /** Short label for a model path, used in issue lists. */
  where(issue) {
    const p = this.project;
    const parts = (issue.path || '').split('.');
    let label = '';
    if (parts[0] === 'servers' && p.servers[parts[1]]) {
      label = `Server configuration "${t(p.servers[parts[1]].name) || Number(parts[1]) + 1}"`;
      if (parts[2] === 'blocks') label += ` › block ${Number(parts[3]) + 1}`;
      if (parts[4] === 'locations') {
        const loc = p.servers[parts[1]].blocks[parts[3]]?.locations[parts[5]];
        if (loc) label += ` › location ${t(loc.path) || Number(parts[5]) + 1}`;
      }
    } else if (parts[0] === 'upstreams' && p.upstreams[parts[1]]) {
      label = `Upstream ${t(p.upstreams[parts[1]].name) || Number(parts[1]) + 1}`;
      if (parts[2] === 'servers') label += ` › server ${Number(parts[3]) + 1}`;
    } else if (parts[0] === 'settings') label = 'Settings';
    else if (parts[0] === 'rateLimitZones') label = 'Settings › rate limit zones';
    else if (parts[0] === 'project') label = 'Project';
    if (issue.file) label += `${label ? ' · ' : ''}${issue.file}${issue.line ? `:${issue.line}` : ''}`;
    return label;
  }
}

function welcome(app) {
  return h('div', { class: 'scroll' }, h('div', { class: 'welcome' },
    h('h1', { text: 'Nginx Config Generator' }),
    h('p', { class: 'lead', text: 'Build conf.d server configurations and upstream groups, check them, and download them as a ZIP package that is ready for nginx -t. Everything runs in this browser; nothing is uploaded.' }),
    h('div', { class: 'welcome-actions' },
      h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => app.newEmptyProject('New project'), text: 'Create an empty project' }),
      h('button', { type: 'button', class: 'btn btn-large', onclick: () => app.newSampleProject(), text: 'Open the sample project' }),
      h('button', { type: 'button', class: 'btn btn-large', onclick: () => importExportView.pickAsNew(app), text: 'Import a YAML project file' })),
    h('ul', { class: 'welcome-list' },
      h('li', { text: 'Projects are kept in this browser and restored when you come back. Export them as YAML to share or back them up.' }),
      h('li', { text: 'The output follows a conf.d + upstreams/ layout: one upstream group per file, an upstreams.conf index, shared proxy_params.conf, ssl_params.conf and security_headers.conf.' }),
      h('li', { text: 'Validation catches conflicts, missing references and unsafe settings, but only nginx -t on your server proves Nginx accepts the result.' }))));
}
