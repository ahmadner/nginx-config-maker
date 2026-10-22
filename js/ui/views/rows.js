// Editable lists of rows (listeners, headers, access rules, error pages, backend servers, zones).

import { h, icon } from '../dom.js';
import { issueArea, textField, numberField, checkField, selectField, numbersField } from '../fields.js';
import { moveItem } from '../../core/model.js';
import { pathKey } from '../../core/util.js';

/**
 * columns: [{ key, label, width: CSS grid track, render(rowPath, item, index) }]
 * create(): new item to append.
 */
export function rowList(app, { path, columns, create, addLabel, empty, reorder = false, cls, canRemove = () => true, onRemove }) {
  const items = app.get(path) || [];
  const tracks = `${columns.map((c) => c.width || 'minmax(8rem, 1fr)').join(' ')} auto`;
  const head = h('div', { class: 'rows-head', 'aria-hidden': 'true' }, columns.map((c) => h('div', { class: 'rc', text: c.label })), h('div', { class: 'rc' }));
  head.style.setProperty('--cols', tracks);
  const rows = items.map((item, i) => {
    const rowPath = [...path, i];
    const actions = h('div', { class: 'rc rc-actions' },
      reorder ? h('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Move row ${i + 1} up`, title: 'Move up', disabled: i === 0, onclick: () => app.update(() => moveItem(items, i, -1)) }, icon('up')) : null,
      reorder ? h('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Move row ${i + 1} down`, title: 'Move down', disabled: i === items.length - 1, onclick: () => app.update(() => moveItem(items, i, 1)) }, icon('down')) : null,
      h('button', {
        type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Remove row ${i + 1}`, title: 'Remove', disabled: !canRemove(items),
        onclick: () => app.update(() => { items.splice(i, 1); onRemove?.(i); }),
      }, icon('trash')));
    const row = h('div', { class: 'row-item', role: 'group', 'aria-label': `Row ${i + 1}` },
      columns.map((c) => h('div', { class: 'rc' }, c.render(rowPath, item, i))),
      actions);
    row.style.setProperty('--cols', tracks);
    return h('div', { class: 'row-wrap' }, row, issueArea(app, pathKey(rowPath)));
  });
  return h('div', { class: ['rows', cls] },
    items.length ? head : null,
    rows,
    !items.length && empty ? h('p', { class: 'empty-small', text: empty }) : null,
    h('button', { type: 'button', class: 'btn btn-small btn-add', onclick: () => app.update(() => items.push(create())) }, icon('plus'), h('span', { text: addLabel })));
}

const tf = (app, p, label, opts = {}) => textField(app, p, { label, hideLabel: true, width: 'full', ...opts });
const nf = (app, p, label, opts = {}) => numberField(app, p, { label, hideLabel: true, width: 'full', ...opts });
const cf = (app, p, label, opts = {}) => checkField(app, p, { label, width: 'full', ...opts });

export function listenRows(app, path, newListen) {
  return rowList(app, {
    path, addLabel: 'Add listener', empty: 'No listener yet.', create: newListen,
    columns: [
      { key: 'address', label: 'Address (optional)', width: 'minmax(7rem, 1.4fr)', render: (rp) => tf(app, [...rp, 'address'], 'Listen address', { placeholder: 'all addresses' }) },
      { key: 'port', label: 'Port', width: 'minmax(5rem, 0.7fr)', render: (rp) => nf(app, [...rp, 'port'], 'Port', { placeholder: '80', min: 1, max: 65535, required: true }) },
      { key: 'ssl', label: 'HTTPS', width: 'auto', render: (rp) => cf(app, [...rp, 'ssl'], 'SSL', { rerender: true }) },
      { key: 'def', label: 'Default', width: 'auto', render: (rp) => cf(app, [...rp, 'defaultServer'], 'default', { hint: undefined }) },
    ],
  });
}

export function requestHeaderRows(app, path) {
  return rowList(app, {
    path, addLabel: 'Add request header', create: () => ({ name: '', value: '' }),
    columns: [
      { key: 'name', label: 'Header', width: 'minmax(7rem, 1fr)', render: (rp) => tf(app, [...rp, 'name'], 'Request header name', { placeholder: 'X-Request-Id' }) },
      { key: 'value', label: 'Value (empty removes the header)', width: 'minmax(8rem, 1.6fr)', render: (rp) => tf(app, [...rp, 'value'], 'Request header value', { placeholder: '$request_id' }) },
    ],
  });
}

export function responseHeaderRows(app, path) {
  return rowList(app, {
    path, addLabel: 'Add response header', create: () => ({ name: '', value: '', always: true }),
    columns: [
      { key: 'name', label: 'Header', width: 'minmax(7rem, 1fr)', render: (rp) => tf(app, [...rp, 'name'], 'Response header name', { placeholder: 'Cache-Control' }) },
      { key: 'value', label: 'Value', width: 'minmax(8rem, 1.6fr)', render: (rp) => tf(app, [...rp, 'value'], 'Response header value', { placeholder: 'no-store' }) },
      { key: 'always', label: 'On errors', width: 'auto', render: (rp) => cf(app, [...rp, 'always'], 'always') },
    ],
  });
}

export function accessRows(app, path) {
  return rowList(app, {
    path, addLabel: 'Add rule', reorder: true, create: () => ({ action: 'allow', source: '' }),
    empty: 'No rules: every address is allowed.',
    columns: [
      { key: 'action', label: 'Action', width: 'minmax(5.5rem, auto)', render: (rp) => selectField(app, [...rp, 'action'], [['allow', 'allow'], ['deny', 'deny']], { label: 'Action', hideLabel: true, width: 'full', rerender: false }) },
      { key: 'source', label: 'Address, range or "all" (checked in order)', width: 'minmax(9rem, 1fr)', render: (rp) => tf(app, [...rp, 'source'], 'Address or range', { placeholder: '10.0.0.0/8', options: ['all', '127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] }) },
    ],
  });
}

export function errorPageRows(app, path) {
  return rowList(app, {
    path, addLabel: 'Add error page', create: () => ({ codes: [502, 503, 504], target: '/50x.html' }),
    columns: [
      { key: 'codes', label: 'Status codes', width: 'minmax(10rem, 1fr)', render: (rp) => numbersField(app, [...rp, 'codes'], { label: 'Status codes', hideLabel: true, width: 'full', placeholder: '502 503 504' }) },
      { key: 'target', label: 'Page, @location or URL', width: 'minmax(10rem, 1fr)', render: (rp) => tf(app, [...rp, 'target'], 'Error page target', { placeholder: '/50x.html' }) },
    ],
  });
}
