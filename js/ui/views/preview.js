// Right panel: live preview of the generated file for whatever is being edited.

import { h, button, replace } from '../dom.js';
import { CodeView, issueList } from '../codeview.js';
import { copyText, toast } from '../dialogs.js';

const isUnder = (path, src) => path === src || path.startsWith(`${src}.`);

export function previewPanel(app) {
  const picker = h('select', { class: 'input preview-picker', 'aria-label': 'File shown in the preview' });
  picker.addEventListener('change', () => { app.previewPinned = picker.value; refresh(); });
  const counts = h('span', { class: 'preview-counts' });
  const sub = h('div', { class: 'preview-sub' });
  const issuesBox = h('div', { class: 'preview-issues' });
  const view = new CodeView({ label: 'Generated file preview' });
  let current = null;

  const copyBtn = button('Copy', async () => {
    if (!current) return;
    const ok = await copyText(current.content);
    toast(ok ? `Copied ${current.path}.` : 'Copy failed; select the text and copy it manually.', ok ? 'success' : 'error');
    if (ok && current.counts?.error) toast('This file still has errors.', 'warning');
  }, { icon: 'copy', iconOnly: true, title: 'Copy file content' });
  const dlBtn = button('Download', () => current && app.downloadFile(current.path), { icon: 'download', iconOnly: true, title: 'Download this file' });
  const closeBtn = button('Close preview', () => {
    app.root.classList.add('preview-closed');
    app.setPref('previewOpen', false);
  }, { icon: 'x', iconOnly: true });

  const resizer = h('div', { class: 'resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize preview', tabIndex: 0 });
  const el = h('aside', { class: 'preview', 'aria-label': 'Preview' },
    resizer,
    h('div', { class: 'preview-head' }, picker, counts, h('div', { class: 'preview-buttons' }, copyBtn, dlBtn, closeBtn)),
    sub, issuesBox, view.el);

  // Resize by dragging or with the arrow keys.
  const setWidth = (w) => {
    const width = Math.round(Math.max(320, Math.min(window.innerWidth * 0.7, w)));
    document.documentElement.style.setProperty('--preview-w', `${width}px`);
    return width;
  };
  if (Number.isFinite(app.prefs.previewWidth)) setWidth(app.prefs.previewWidth);
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const move = (ev) => setWidth(window.innerWidth - ev.clientX);
    const up = (ev) => {
      resizer.releasePointerCapture(ev.pointerId);
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      app.setPref('previewWidth', setWidth(window.innerWidth - ev.clientX));
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });
  resizer.addEventListener('keydown', (e) => {
    const cur = el.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') { e.preventDefault(); app.setPref('previewWidth', setWidth(cur + 40)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); app.setPref('previewWidth', setWidth(cur - 40)); }
  });

  function contextFile() {
    const files = app.build ? app.build.files : [];
    if (app.previewPinned) {
      const pinned = allEntries().find((f) => f.path === app.previewPinned);
      if (pinned) return pinned;
    }
    if (app.tab === 'servers') return files.find((f) => f.src === `servers.${app.sel.server}`) || files[0];
    if (app.tab === 'upstreams') return files.find((f) => f.src === `upstreams.${app.sel.upstream}`) || files[0];
    if (app.tab === 'settings') return files.find((f) => f.kind === 'snippet') || files.find((f) => f.kind === 'upstream-index') || files[0];
    return files[0];
  }

  function allEntries() {
    const files = app.build ? app.build.files : [];
    const pkg = app.pkg && app.pkgFor === app.build ? app.pkg : null;
    const extras = pkg ? pkg.entries.filter((e) => !e.file).map((e) => ({ path: e.path, content: e.content, kind: e.kind, extra: true })) : [];
    return [...files, ...extras];
  }

  function refresh() {
    if (!app.build) {
      current = null;
      replace(sub, h('p', { class: 'empty-small', text: 'Nothing to preview yet.' }));
      view.update('', []);
      replace(picker);
      return;
    }
    current = contextFile() || null;
    const entries = allEntries();
    replace(picker, entries.map((f) => h('option', { value: f.path, selected: current && f.path === current.path }, `${f.path}${f.enabled === false ? ' (disabled)' : ''}`)));
    picker.disabled = !entries.length;
    copyBtn.disabled = dlBtn.disabled = !current;
    if (!current) {
      replace(counts);
      replace(sub, h('p', { class: 'empty-small', text: 'No files are generated yet. Add a server configuration or an upstream group.' }));
      replace(issuesBox);
      view.update('', []);
      return;
    }
    const fileIssues = current.extra ? [] : app.build.issues.filter((i) => i.file === current.path && i.level !== 'info');
    const c = current.counts || { error: 0, warning: 0 };
    replace(counts,
      c.error ? h('span', { class: 'count-badge count-error', text: `${c.error} error${c.error === 1 ? '' : 's'}` }) : null,
      c.warning ? h('span', { class: 'count-badge count-warning', text: `${c.warning} warning${c.warning === 1 ? '' : 's'}` }) : null);
    const loaded = current.kind === 'snippet' ? 'Included by server blocks' : current.extra ? 'Package file (not configuration)' : current.enabled === false ? 'Disabled: not loaded by nginx' : current.loadedBy?.length ? `Loaded by ${current.loadedBy.join(', ')}` : 'Not loaded by nginx.conf';
    replace(sub, h('span', { text: loaded }));
    replace(issuesBox, fileIssues.length ? h('details', { class: 'preview-issue-box', open: fileIssues.some((i) => i.level === 'error') },
      h('summary', { text: `${fileIssues.length} issue${fileIssues.length === 1 ? '' : 's'} in this file` }),
      issueList(fileIssues.map((i) => ({ ...i, where: i.line ? `line ${i.line}` : '' })), { onSelect: (i) => app.navigate(i.path) })) : null);
    const lang = current.path.endsWith('.yml') ? 'yaml' : current.path.endsWith('.md') ? 'plain' : 'nginx';
    view.update(current.content, app.build.issues.filter((i) => i.file === current.path), { language: lang });
  }

  /** Highlights the lines generated from a model path (when the shown file contains it). */
  function focusPath(path) {
    if (!current || !current.lineMap || !el.offsetParent) return;
    let lines = current.lineMap.filter((e) => e.src === path).map((e) => e.line);
    if (!lines.length) lines = current.lineMap.filter((e) => isUnder(e.src, path)).map((e) => e.line);
    if (!lines.length) {
      let best = null;
      for (const e of current.lineMap) if (isUnder(path, e.src) && (!best || e.src.length > best.src.length)) best = e;
      if (best) lines = current.lineMap.filter((e) => e.src === best.src).map((e) => e.line);
    }
    view.highlight([...new Set(lines)].slice(0, 40));
  }

  return { el, refresh, focusPath };
}
