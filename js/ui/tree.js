// File tree (role="tree") with keyboard navigation: Up/Down move, Left/Right collapse/expand, Enter opens.

import { h, icon, fmtBytes } from './dom.js';

function buildTree(entries) {
  const root = { name: '', path: '', folders: new Map(), files: [] };
  for (const e of entries) {
    const parts = e.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join('/');
      if (!node.folders.has(parts[i])) node.folders.set(parts[i], { name: parts[i], path: p, folders: new Map(), files: [] });
      node = node.folders.get(parts[i]);
    }
    node.files.push({ ...e, name: parts[parts.length - 1] });
  }
  return root;
}

function sumCounts(node) {
  const c = { error: 0, warning: 0 };
  for (const f of node.files) { c.error += f.counts?.error || 0; c.warning += f.counts?.warning || 0; }
  for (const sub of node.folders.values()) { const s = sumCounts(sub); c.error += s.error; c.warning += s.warning; }
  return c;
}

function badge(c) {
  if (c.error) return h('span', { class: 'tbadge tbadge-error', title: `${c.error} error${c.error === 1 ? '' : 's'}`, text: String(c.error) });
  if (c.warning) return h('span', { class: 'tbadge tbadge-warning', title: `${c.warning} warning${c.warning === 1 ? '' : 's'}`, text: String(c.warning) });
  return null;
}

/**
 * entries: [{ path, counts?, enabled?, bytes?, kind? }]
 * options: { selected, onSelect(path), collapsed: Set<folderPath>, onToggle(path, collapsed), rootLabel, label }
 */
export function fileTree(entries, { selected, onSelect, collapsed = new Set(), onToggle, rootLabel = null, label = 'Generated files', showSize = false } = {}) {
  const tree = buildTree(entries);
  const container = h('ul', { class: 'tree', role: 'tree', 'aria-label': label });
  let selectedRow = null;

  const renderFolder = (node, depth, parentList) => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    for (const f of folders) {
      const isCollapsed = collapsed.has(f.path);
      const childList = h('ul', { role: 'group', hidden: isCollapsed });
      const row = h('button', {
        type: 'button', class: 'tree-row tree-folder', tabIndex: -1, dataset: { path: f.path, kind: 'folder' }, style: undefined,
        onclick: () => { const now = !childList.hidden; childList.hidden = now; li.setAttribute('aria-expanded', String(!now)); onToggle?.(f.path, now); },
      },
      h('span', { class: 'tree-indent', dataset: { depth } }),
      h('span', { class: 'tree-caret' }, icon('chevron', { size: 12 })),
      icon('folder', { size: 14 }),
      h('span', { class: 'tree-name', text: `${f.name}/` }),
      badge(sumCounts(f)));
      const li = h('li', { role: 'treeitem', 'aria-expanded': String(!isCollapsed), class: 'tree-item' }, row, childList);
      parentList.append(li);
      renderFolder(f, depth + 1, childList);
    }
    for (const file of files) {
      const isSel = file.path === selected;
      const row = h('button', {
        type: 'button', class: ['tree-row', 'tree-file', file.enabled === false && 'tree-disabled'], tabIndex: -1,
        dataset: { path: file.path, kind: 'file' }, title: file.path + (file.enabled === false ? ' (disabled: not loaded)' : ''),
        onclick: () => onSelect?.(file.path),
      },
      h('span', { class: 'tree-indent', dataset: { depth } }),
      h('span', { class: 'tree-caret tree-caret-none' }),
      icon('file', { size: 14 }),
      h('span', { class: 'tree-name', text: file.name }),
      showSize && file.bytes !== undefined ? h('span', { class: 'tree-size', text: fmtBytes(file.bytes) }) : null,
      badge(file.counts || {}));
      if (isSel) selectedRow = row;
      parentList.append(h('li', { role: 'treeitem', 'aria-selected': String(isSel), class: ['tree-item', isSel && 'tree-selected'] }, row));
    }
  };

  if (rootLabel) {
    const childList = h('ul', { role: 'group' });
    const row = h('div', { class: 'tree-row tree-root', dataset: { kind: 'root' } }, icon('folder', { size: 14 }), h('span', { class: 'tree-name', text: `${rootLabel}/` }));
    container.append(h('li', { role: 'treeitem', 'aria-expanded': 'true', class: 'tree-item' }, row, childList));
    renderFolder(tree, 1, childList);
  } else {
    renderFolder(tree, 0, container);
  }

  // Indentation through a data attribute and CSS (no inline styles).
  const rows = () => [...container.querySelectorAll('button.tree-row')].filter((r) => r.offsetParent !== null);
  const first = selectedRow || container.querySelector('button.tree-row');
  if (first) first.tabIndex = 0;
  container.addEventListener('focusin', (e) => {
    if (!e.target.classList.contains('tree-row')) return;
    for (const r of container.querySelectorAll('button.tree-row')) r.tabIndex = r === e.target ? 0 : -1;
  });
  container.addEventListener('keydown', (e) => {
    const list = rows();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    const cur = list[i];
    const li = cur.parentElement;
    if (e.key === 'ArrowDown') { e.preventDefault(); list[Math.min(list.length - 1, i + 1)].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[Math.max(0, i - 1)].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'ArrowRight' && cur.dataset.kind === 'folder') {
      e.preventDefault();
      if (li.getAttribute('aria-expanded') === 'false') cur.click();
      else list[i + 1]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (cur.dataset.kind === 'folder' && li.getAttribute('aria-expanded') === 'true') cur.click();
      else li.parentElement.closest('li[role="treeitem"]')?.querySelector(':scope > button.tree-row')?.focus();
    }
  });
  return container;
}
