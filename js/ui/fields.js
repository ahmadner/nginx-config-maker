// Form controls bound to model paths. Each control registers a slot so validation messages for its
// path appear right under it; sections register slots that collect the messages of their children.

import { h, icon, fieldId } from './dom.js';
import { pathKey } from '../core/util.js';

function describe(control, ids) {
  const v = ids.filter(Boolean).join(' ');
  if (v) control.setAttribute('aria-describedby', v);
}

function shell(app, path, { label, hint, width = 'm', badge, hideLabel = false, cls }, control) {
  const id = fieldId(path);
  control.id = id;
  control.dataset.path = pathKey(path);
  const hintId = hint ? `${id}-hint` : null;
  const msg = h('div', { class: 'field-msg', id: `${id}-msg` });
  describe(control, [hintId, msg.id]);
  const wrapper = h('div', { class: ['field', `w-${width}`, cls] },
    label ? h('label', { class: ['label', hideLabel && 'sr-only'], for: id }, label, badge ? badgeEl(badge) : null) : null,
    control,
    hint ? h('div', { class: 'hint', id: hintId }, hint) : null,
    msg);
  app.registerSlot(pathKey(path), { kind: 'field', el: msg, control, wrapper });
  return wrapper;
}

/** Small "needs …" chip next to a label. badge: { text, title } or string. */
export function badgeEl(badge) {
  const b = typeof badge === 'string' ? { text: badge } : badge;
  return h('span', { class: ['chip', b.kind && `chip-${b.kind}`], title: b.title, text: b.text });
}

export function textField(app, path, opts = {}) {
  const value = app.get(path) ?? '';
  const listId = opts.options ? `${fieldId(path)}-list` : null;
  const input = h('input', {
    type: 'text', class: ['input', opts.mono !== false && 'mono'], value: String(value), placeholder: opts.placeholder,
    autocomplete: 'off', spellcheck: false, list: listId, 'aria-required': opts.required ? 'true' : undefined, readOnly: opts.readOnly,
  });
  input.addEventListener('input', () => {
    app.set(path, input.value, { rerender: false });
    opts.onInput?.(input.value);
  });
  input.addEventListener('change', () => {
    const trimmed = input.value.trim();
    if (trimmed !== input.value) { input.value = trimmed; app.set(path, trimmed, { rerender: false }); }
    if (opts.rerender) app.rerender();
    opts.onCommit?.(trimmed);
  });
  const wrapper = shell(app, path, opts, input);
  if (opts.options) {
    wrapper.append(h('datalist', { id: listId }, opts.options.map((o) => h('option', { value: Array.isArray(o) ? o[0] : o }, Array.isArray(o) ? o[1] : null))));
  }
  if (opts.required) wrapper.querySelector('label')?.append(h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }));
  return wrapper;
}

/** Whole number or empty (null). */
export function numberField(app, path, opts = {}) {
  const value = app.get(path);
  const input = h('input', {
    type: 'number', class: 'input mono', value: value === null || value === undefined ? '' : String(value), placeholder: opts.placeholder,
    min: opts.min, max: opts.max, step: 1, inputmode: 'numeric', 'aria-required': opts.required ? 'true' : undefined,
  });
  const read = () => {
    const raw = input.value.trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  };
  input.addEventListener('input', () => app.set(path, read(), { rerender: false }));
  if (opts.rerender) input.addEventListener('change', () => app.rerender());
  const wrapper = shell(app, path, { width: 's', ...opts }, input);
  if (opts.required) wrapper.querySelector('label')?.append(h('span', { class: 'req', 'aria-hidden': 'true', text: ' *' }));
  return wrapper;
}

/** options: [[value, label], ...]. Re-renders on change by default (choices usually show other fields). */
export function selectField(app, path, options, opts = {}) {
  const value = app.get(path) ?? '';
  const select = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  select.addEventListener('change', () => {
    const v = select.value;
    const parsed = opts.numeric ? (v === '' ? null : Number(v)) : v;
    if (opts.onChange) opts.onChange(parsed);
    else app.set(path, parsed, { rerender: opts.rerender !== false });
  });
  return shell(app, path, opts, select);
}

export function checkField(app, path, opts = {}) {
  const id = fieldId(path);
  const input = h('input', { type: 'checkbox', class: 'checkbox', checked: !!app.get(path), id });
  input.dataset.path = pathKey(path);
  input.addEventListener('change', () => {
    if (opts.onChange) opts.onChange(input.checked);
    else app.set(path, input.checked, { rerender: !!opts.rerender });
  });
  const msg = h('div', { class: 'field-msg', id: `${id}-msg` });
  const hintId = opts.hint ? `${id}-hint` : null;
  describe(input, [hintId, msg.id]);
  const wrapper = h('div', { class: ['field', 'field-check', `w-${opts.width || 'm'}`] },
    h('label', { class: 'check', for: id }, input, h('span', { text: opts.label }), opts.badge ? badgeEl(opts.badge) : null),
    opts.hint ? h('div', { class: 'hint', id: hintId }, opts.hint) : null,
    msg);
  app.registerSlot(pathKey(path), { kind: 'field', el: msg, control: input, wrapper });
  return wrapper;
}

export function textareaField(app, path, opts = {}) {
  const value = app.get(path) ?? '';
  const code = opts.mono !== false;
  const ta = h('textarea', {
    class: ['input', 'textarea', code ? 'mono textarea-code' : 'textarea-text'], rows: opts.rows || 4, placeholder: opts.placeholder,
    spellcheck: !code, autocomplete: 'off', wrap: code ? 'off' : 'soft',
  });
  ta.value = String(value);
  ta.addEventListener('input', () => app.set(path, ta.value, { rerender: false }));
  // Tab inserts spaces in code areas; Escape leaves the field so keyboard users are never trapped.
  if (opts.code) {
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && ta.dataset.tabMode !== 'off') {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en } = ta;
        ta.setRangeText('    ', s, en, 'end');
        ta.dispatchEvent(new Event('input'));
      } else if (e.key === 'Escape') {
        ta.dataset.tabMode = 'off';
        ta.blur();
      }
    });
    ta.addEventListener('focus', () => { delete ta.dataset.tabMode; });
  }
  return shell(app, path, { width: 'full', ...opts }, ta);
}

/** List of strings edited as one line ("a b c") or one item per line. */
export function wordsField(app, path, opts = {}) {
  const perLine = opts.perLine;
  const list = app.get(path) || [];
  const join = (arr) => arr.join(perLine ? '\n' : ' ');
  const split = (s) => s.split(perLine ? /\r?\n/ : /[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const control = perLine
    ? h('textarea', { class: 'input textarea mono', rows: opts.rows || 3, spellcheck: false, placeholder: opts.placeholder, wrap: 'off' })
    : h('input', { type: 'text', class: 'input mono', placeholder: opts.placeholder, spellcheck: false, autocomplete: 'off' });
  control.value = join(list);
  control.addEventListener('input', () => app.set(path, split(control.value), { rerender: false }));
  return shell(app, path, { width: perLine ? 'full' : 'l', ...opts }, control);
}

/** List of whole numbers edited as "500 502 503". */
export function numbersField(app, path, opts = {}) {
  const list = app.get(path) || [];
  const input = h('input', { type: 'text', class: 'input mono', value: list.join(' '), placeholder: opts.placeholder, spellcheck: false, autocomplete: 'off', inputmode: 'numeric' });
  input.addEventListener('input', () => {
    const nums = input.value.split(/[\s,]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : null));
    app.set(path, nums, { rerender: false });
  });
  return shell(app, path, opts, input);
}

/** Checkbox group editing a list of strings (e.g. HTTP methods). */
export function choicesField(app, path, choices, opts = {}) {
  const current = new Set(app.get(path) || []);
  const id = fieldId(path);
  const msg = h('div', { class: 'field-msg', id: `${id}-msg` });
  const group = h('div', { class: 'choices', role: 'group', 'aria-labelledby': `${id}-label`, id, dataset: { path: pathKey(path) } },
    choices.map((c) => {
      const cb = h('input', { type: 'checkbox', class: 'checkbox', checked: current.has(c) });
      cb.addEventListener('change', () => {
        const next = choices.filter((x) => (x === c ? cb.checked : (app.get(path) || []).includes(x)));
        app.set(path, next, { rerender: false });
      });
      return h('label', { class: 'check check-inline' }, cb, h('span', { class: 'mono', text: c }));
    }));
  const wrapper = h('div', { class: ['field', `w-${opts.width || 'full'}`] },
    h('div', { class: 'label', id: `${id}-label`, text: opts.label }),
    group,
    opts.hint ? h('div', { class: 'hint' }, opts.hint) : null,
    msg);
  app.registerSlot(pathKey(path), { kind: 'field', el: msg, control: group, wrapper });
  return wrapper;
}

/** Read-only value with a label (computed output paths and similar). */
export function staticField(label, value, { width = 'm', mono = true, hint } = {}) {
  return h('div', { class: ['field', `w-${width}`] },
    h('div', { class: 'label', text: label }),
    h('div', { class: ['static-value', mono && 'mono'], text: value }),
    hint ? h('div', { class: 'hint' }, hint) : null);
}

/**
 * Collapsible section. Its open state is remembered by `key` (an entity id, stable across re-renders).
 * `issuePath` makes the section collect messages that have no field of their own, and shows a count.
 */
export function section(app, key, { title, summary = null, open = false, issuePath = null, cls, actions = null, level = 3 }, ...children) {
  const isOpen = app.openState.has(key) ? app.openState.get(key) : open;
  const count = h('span', { class: 'count-badge', hidden: true });
  const area = h('div', { class: 'section-issues' });
  const head = h(`h${level}`, { class: 'section-title' }, title);
  const el = h('details', { class: ['section', cls], open: isOpen, dataset: { key } },
    h('summary', { class: 'section-summary' },
      h('span', { class: 'caret' }, icon('chevron', { size: 14 })),
      head,
      summary ? h('span', { class: 'section-sub' }, summary) : null,
      count,
      actions ? h('span', { class: 'section-actions', onclick: (e) => e.stopPropagation() }, actions) : null),
    h('div', { class: 'section-body' }, area, children));
  el.addEventListener('toggle', () => app.openState.set(key, el.open));
  if (issuePath) {
    app.registerSlot(issuePath, { kind: 'section', el: area });
    app.registerSlot(issuePath, { kind: 'badge', el: count });
  }
  return el;
}

/** Message area that collects issues at `path` (and below, when no closer slot exists). */
export function issueArea(app, path) {
  const el = h('div', { class: 'section-issues' });
  app.registerSlot(path, { kind: 'section', el });
  return el;
}

export function grid(...children) {
  return h('div', { class: 'grid' }, children);
}

export function note(text, kind = 'info') {
  return h('div', { class: ['note', `note-${kind}`] }, icon(kind === 'warning' ? 'alert' : 'info'), h('div', {}, text));
}
