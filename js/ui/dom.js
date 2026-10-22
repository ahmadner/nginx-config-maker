// DOM helpers. All dynamic content is set as text (textContent / text nodes); nothing is parsed as HTML.

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'open', 'selected', 'readOnly', 'multiple', 'indeterminate', 'tabIndex', 'htmlFor', 'spellcheck']);
const BLOCKED = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'style']);

/**
 * h('button', { class: 'btn', onclick: fn, text: 'Save' }, child, ...)
 * Event handlers: keys starting with "on". Booleans false/null/undefined are skipped.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

function setProps(el, props) {
  for (const [key, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (BLOCKED.has(key)) throw new Error(`h(): "${key}" is not allowed`);
    if (key === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
    else if (key === 'text') el.textContent = String(v);
    else if (key === 'dataset') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
    else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
    else if (key === 'href') {
      const s = String(v);
      if (!/^(#|blob:|https:\/\/)/.test(s)) throw new Error('h(): unsafe href');
      el.setAttribute('href', s);
    } else if (PROPS.has(key)) el[key] = v;
    else el.setAttribute(key, v === true ? '' : String(v));
  }
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

// ---------- Icons (inline SVG, 24x24 stroke paths) ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  duplicate: ['M8 8h12v12H8z', 'M4 16V4h12', 'M14 11v6', 'M11 14h6'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  chevron: ['M9 6l6 6-6 6'],
  file: ['M14 3H6v18h12V7z', 'M14 3v4h4'],
  folder: ['M3 6h6l2 2h10v11H3z'],
  check: ['M5 12l5 5 9-10'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17v.5'],
  error: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9 9l6 6', 'M15 9l-6 6'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v6', 'M12 7.5v.5'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  dots: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M12 2v3', 'M12 19v3', 'M4.2 4.2l2.1 2.1', 'M17.7 17.7l2.1 2.1', 'M2 12h3', 'M19 12h3', 'M4.2 19.8l2.1-2.1', 'M17.7 6.3l2.1-2.1'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  panel: ['M3 4h18v16H3z', 'M14 4v16'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  sample: ['M5 4h14v16H5z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
};

export function icon(name, { size = 16, label } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'icon');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Button with an optional icon. */
export function button(label, onClick, { icon: iconName, cls = '', title, kind = '', disabled, type = 'button', iconOnly = false, attrs = {} } = {}) {
  return h('button', {
    type, class: ['btn', kind && `btn-${kind}`, iconOnly && 'btn-icon', cls], onclick: onClick, disabled,
    // aria-label always: narrow layouts hide the text and show only the icon.
    title: title || (iconOnly ? label : undefined), 'aria-label': label, ...attrs,
  }, iconName ? icon(iconName) : null, iconOnly ? null : h('span', { text: label }));
}

export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return d.toLocaleDateString();
}

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Id for the form control of a model path: ["servers", 0, "name"] -> "f-servers-0-name". */
export const fieldId = (path) => `f-${(Array.isArray(path) ? path.join('-') : String(path).replace(/\./g, '-')).replace(/[^A-Za-z0-9_-]/g, '_')}`;
