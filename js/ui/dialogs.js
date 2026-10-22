// Modal dialogs (native <dialog>), toasts, popover menus, downloads and clipboard.

import { h, clear, append, icon } from './dom.js';

let dialogEl = null;

function getDialog() {
  if (!dialogEl) {
    dialogEl = h('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' });
    document.body.append(dialogEl);
  }
  return dialogEl;
}

/**
 * Shows a modal dialog. buttons: [{ label, value, kind, autofocus }]. Resolves with the chosen value
 * (or null when closed with Escape).
 */
export function showDialog({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], wide = false }) {
  const dlg = getDialog();
  clear(dlg);
  dlg.classList.toggle('dialog-wide', wide);
  return new Promise((resolve) => {
    const finish = (value) => {
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onCancel = (e) => { e.preventDefault(); finish(null); };
    dlg.addEventListener('cancel', onCancel);
    const footer = h('div', { class: 'dialog-actions' }, buttons.map((b) => h('button', {
      type: 'button', class: ['btn', b.kind && `btn-${b.kind}`], onclick: () => finish(typeof b.value === 'function' ? b.value() : b.value),
      dataset: b.autofocus ? { autofocus: '1' } : undefined,
    }, b.label)));
    append(dlg, [
      h('h2', { id: 'dialog-title', class: 'dialog-title', text: title }),
      h('div', { class: 'dialog-body' }, body),
      footer,
    ]);
    dlg.showModal();
    const focus = dlg.querySelector('[data-autofocus]') || dlg.querySelector('input, textarea, select') || footer.lastChild;
    if (focus) focus.focus();
  });
}

export async function confirmDialog({ title, message, details = null, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  const body = [typeof message === 'string' ? h('p', { text: message }) : message, details];
  const res = await showDialog({
    title,
    body,
    buttons: [
      { label: cancelLabel, value: false, autofocus: danger },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary', autofocus: !danger },
    ],
  });
  return res === true;
}

export async function alertDialog({ title, message, details = null }) {
  await showDialog({ title, body: [typeof message === 'string' ? h('p', { text: message }) : message, details], buttons: [{ label: 'Close', value: true, kind: 'primary', autofocus: true }] });
}

/** Text prompt with validation. Resolves with the trimmed value or null. */
export function promptDialog({ title, label, value = '', confirmLabel = 'OK', validate = () => null, hint = '' }) {
  const dlg = getDialog();
  clear(dlg);
  dlg.classList.remove('dialog-wide');
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', class: 'input', value, id: 'dialog-input', autocomplete: 'off', spellcheck: false, 'aria-describedby': 'dialog-input-msg' });
    const msg = h('div', { class: 'field-msg', id: 'dialog-input-msg', role: 'alert' });
    const finish = (v) => {
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      resolve(v);
    };
    const onCancel = (e) => { e.preventDefault(); finish(null); };
    const submit = () => {
      const v = input.value.trim();
      const err = validate(v);
      clear(msg);
      if (err) {
        msg.append(h('div', { class: 'msg msg-error', text: err }));
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      finish(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    dlg.addEventListener('cancel', onCancel);
    append(dlg, [
      h('h2', { id: 'dialog-title', class: 'dialog-title', text: title }),
      h('div', { class: 'dialog-body' }, h('div', { class: 'field' },
        h('label', { for: 'dialog-input', class: 'label', text: label }),
        input,
        hint ? h('div', { class: 'hint', text: hint }) : null,
        msg)),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => finish(null), text: 'Cancel' }),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: submit, text: confirmLabel })),
    ]);
    dlg.showModal();
    input.focus();
    input.select();
  });
}

// ---------- Toasts ----------
let toastRegion = null;
export function toast(message, level = 'info', ms = 4000) {
  if (!toastRegion) {
    toastRegion = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const el = h('div', { class: ['toast', `toast-${level}`] }, icon(level === 'error' ? 'error' : level === 'warning' ? 'alert' : level === 'success' ? 'check' : 'info'), h('span', { text: message }));
  toastRegion.append(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- Popover menu ----------
let openMenu = null;
export function closeMenu() {
  if (openMenu) {
    openMenu.el.remove();
    document.removeEventListener('pointerdown', openMenu.outside, true);
    document.removeEventListener('keydown', openMenu.key, true);
    const { anchor } = openMenu;
    openMenu = null;
    anchor.setAttribute('aria-expanded', 'false');
    anchor.focus();
  }
}

/** Opens a menu under `anchor`. items: [{ label, icon, onSelect, danger, disabled } | 'separator']. */
export function popupMenu(anchor, items) {
  if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const list = h('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (item === 'separator') { list.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    list.append(h('button', {
      type: 'button', role: 'menuitem', class: ['menu-item', item.danger && 'menu-danger'], disabled: item.disabled,
      onclick: () => { closeMenu(); item.onSelect(); },
    }, item.icon ? icon(item.icon) : h('span', { class: 'icon-space' }), h('span', { text: item.label })));
  }
  document.body.append(list);
  const r = anchor.getBoundingClientRect();
  const width = Math.max(200, list.offsetWidth);
  list.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.left))}px`;
  list.style.top = `${Math.min(window.innerHeight - list.offsetHeight - 8, r.bottom + 4)}px`;
  const buttons = () => [...list.querySelectorAll('.menu-item:not([disabled])')];
  const outside = (e) => { if (!list.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const key = (e) => {
    const b = buttons();
    const i = b.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length]?.focus(); }
    else if (e.key === 'Tab') closeMenu();
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { el: list, anchor, outside, key };
  buttons()[0]?.focus();
}

// ---------- Files ----------
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function downloadText(text, name, type = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), name);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea method
  }
  const ta = h('textarea', { class: 'offscreen', readOnly: true });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Reads a user-chosen file as UTF-8 text. */
export function readFileText(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) { reject(new Error(`The file is ${Math.round(file.size / 1024)} KB; the limit is ${Math.round(maxBytes / 1024)} KB.`)); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsText(file, 'utf-8');
  });
}
