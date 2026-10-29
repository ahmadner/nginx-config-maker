// Endpoint routing table card: options, a live preview, and PNG / CSV / clipboard exports.

import { h, button, replace } from '../dom.js';
import { selectField, checkField, wordsField, grid } from '../fields.js';
import { alertDialog, copyText, downloadBlob, downloadText, toast } from '../dialogs.js';
import { buildRoutingTable, tableToDelimited, cellText, cellLines, portsInUse, MATRIX_MAX_HOSTS } from '../../core/table.js';
import { tableToPng } from '../table-image.js';
import { slugify } from '../../core/util.js';

const baseName = (app) => `${slugify(app.project.project.name)}-routing-table`;

/** The table as an HTML element (text nodes only), mirroring the image layout. */
export function tableElement(table) {
  const cols = table.columns;
  const hostCols = cols.filter((c) => c.group);
  const twoRows = hostCols.length > 0;
  const head = [h('tr', {}, cols.map((c) => {
    if (c.group) return c === hostCols[0] ? h('th', { scope: 'colgroup', colspan: hostCols.length, class: 'rt-super', text: c.group }) : null;
    return h('th', { scope: 'col', rowspan: twoRows ? 2 : undefined, text: c.label });
  }))];
  if (twoRows) head.push(h('tr', {}, hostCols.map((c) => h('th', { scope: 'col', class: 'rt-host-head mono', text: c.label }))));

  const strong = (c) => c.key === 'endpoint' || c.key === 'worker';
  const rowEl = (r, i) => h('tr', { class: [i % 2 && 'rt-zebra', r.dim && 'rt-muted'] }, cols.map((c) => {
    if (c.key === 'status') return h('td', {}, h('span', { class: ['rt-pill', `rt-${r.statusLevel}`], text: r.status }));
    const lines = cellLines(r, c);
    // One line per endpoint, so an endpoint and its status sit on the same line.
    if (lines) {
      return h('td', { class: ['rt-lines', c.kind === 'list' && 'mono'] },
        lines.map((l) => (c.kind === 'statuses'
          ? h('div', {}, h('span', { class: ['rt-pill', `rt-${l.level}`], text: l.text }))
          : h('div', { text: l.text }))));
    }
    if (c.kind === 'host') {
      const e = r.backends.get(c.host);
      // One span per server: a server marked "down" goes red on its own, the live ones beside it stay blue.
      return h('td', { class: 'rt-host' }, e ? (e.parts || [e]).map((p, n) => [
        n ? h('span', { class: 'rt-sep', text: ', ' }) : null,
        h('span', {
          class: ['mono', p.flags.includes('off') && 'rt-off', p.flags.includes('down') && 'rt-down', p.flags.includes('backup') && 'rt-backup', p.active && 'rt-active'],
          text: p.text,
        }),
      ]) : null);
    }
    const text = cellText(r, c);
    return h('td', { class: [c.kind === 'mono' && 'mono', strong(c) && 'rt-endpoint', (c.key === 'notes' || (c.key === 'upstream' && !r.upstream)) && 'rt-soft'], text });
  }));

  const body = [];
  if (table.grouped) {
    for (const g of table.groups) {
      body.push(h('tr', { class: 'rt-group' }, h('td', { colspan: cols.length },
        h('strong', { text: g.title + (g.note ? ` (${g.note})` : '') }),
        h('span', { class: 'rt-group-sub mono', text: g.sub }))));
      g.rows.forEach((r, i) => body.push(rowEl(r, i)));
    }
  } else {
    table.rows.forEach((r, i) => body.push(rowEl(r, i)));
  }
  return h('table', { class: 'rt' },
    h('caption', { class: 'sr-only', text: `${table.title}: ${table.subtitle}` }),
    h('thead', {}, head),
    h('tbody', {}, body));
}

export function routingTableCard(app) {
  const preview = h('div', { class: 'rt-wrap' });
  const summary = h('p', { class: 'hint rt-summary' });
  const colors = h('p', { class: 'rt-colors' });
  const legend = h('ul', { class: 'rt-legend' });

  const current = () => buildRoutingTable(app.project, app.build);
  const byWorker = app.project.settings.table.layout === 'worker';
  const ports = () => portsInUse(current().endpointRows);

  /** Writes one "port = workerN" line per port in use, as a starting point to edit. */
  const fillWorkerNames = () => {
    const first = app.project.settings.table.workerFromZero ? 0 : 1;
    const lines = ports().map((p, i) => `${p} = worker${i + first}`);
    if (!lines.length) { toast('No backend ports yet. Add upstream groups or proxy endpoints first.', 'warning'); return; }
    app.set(['settings', 'table', 'workerNames'], lines, { rerender: true });
    toast(`Wrote ${lines.length} worker name${lines.length === 1 ? '' : 's'}. Edit them to match your servers.`, 'success');
  };

  const downloadPng = async () => {
    try {
      const blob = await tableToPng(current());
      downloadBlob(blob, `${baseName(app)}.png`);
      toast(`Downloaded ${baseName(app)}.png.`, 'success');
    } catch (e) {
      await alertDialog({ title: 'The image could not be created', message: String(e && e.message ? e.message : e) });
    }
  };
  const copyPng = async () => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('This browser cannot copy images; download the PNG instead.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': tableToPng(current()) })]);
      toast('Copied the table image. Paste it into a document, ticket or e-mail.', 'success');
    } catch (e) {
      toast(e && e.message && !/denied|NotAllowed/i.test(e.name || '') ? e.message : 'The image could not be copied; download the PNG instead.', 'error', 6000);
    }
  };
  const downloadCsv = () => {
    downloadText(tableToDelimited(current(), { bom: true }), `${baseName(app)}.csv`, 'text/csv');
    toast(`Downloaded ${baseName(app)}.csv.`, 'success');
  };
  const copyTsv = async () => {
    const ok = await copyText(tableToDelimited(current(), { delimiter: '\t' }));
    toast(ok ? 'Copied as tab-separated text. Paste it into Excel or a spreadsheet.' : 'Copy failed.', ok ? 'success' : 'error');
  };

  const el = h('section', { class: 'card', id: 'routing-table' },
    h('h2', { class: 'card-title', text: 'Endpoint routing table (image and CSV)' }),
    h('p', { text: 'Every endpoint with its upstream group, the port on each backend host, its server configuration file and its status. The worker layout turns it around: one row per backend worker (a host and port) with the endpoints it serves. Use the image for handover documents and tickets, and the CSV for spreadsheets.' }),
    grid(
      selectField(app, ['settings', 'table', 'layout'], [
        ['auto', `Automatic (columns per host up to ${MATRIX_MAX_HOSTS} hosts)`],
        ['matrix', 'One column per backend host'],
        ['list', 'Backend servers in one column'],
        ['worker', 'Group by backend worker (one row per host and port)'],
      ], { label: 'Layout', width: 'l' }),
      checkField(app, ['settings', 'table', 'groupRows'], { label: byWorker ? 'Group rows by backend host (image and preview)' : 'Group rows by server block (image and preview)', width: 'm', rerender: true }),
    ),
    byWorker ? grid(
      selectField(app, ['settings', 'table', 'workerNumbering'], [
        ['port', 'By port across the project (the same port is the same worker everywhere)'],
        ['host', 'Per host, in ascending port order'],
      ], { label: 'Number workers', width: 'l' }),
      checkField(app, ['settings', 'table', 'workerFromZero'], { label: 'Start at worker0', width: 's', rerender: true }),
    ) : null,
    byWorker ? grid(
      wordsField(app, ['settings', 'table', 'workerNames'], {
        label: 'Worker names by port',
        perLine: true,
        rows: 3,
        width: 'l',
        placeholder: '9000 = worker0',
        hint: `One per line: port = name. Ports in use: ${ports().join(', ') || 'none yet'}. Ports that are not listed keep their number.`,
      }),
      h('div', { class: 'field w-m' }, h('div', { class: 'label', text: 'From the ports in use' }),
        button('Fill worker names', fillWorkerNames, { icon: 'plus', title: 'Write one line per port, numbered in port order' })),
    ) : null,
    grid(
      checkField(app, ['settings', 'table', 'proxyOnly'], { label: 'Proxy endpoints only', width: 's', rerender: true }),
      checkField(app, ['settings', 'table', 'includeDisabled'], { label: 'Include turned-off configurations', width: 'm', rerender: true }),
      checkField(app, ['settings', 'package', 'includeTable'], { label: 'Add routing-table.csv to the ZIP package', width: 'm', rerender: true }),
    ),
    h('div', { class: 'row-buttons' },
      button('Download PNG', downloadPng, { icon: 'download', kind: 'primary' }),
      button('Copy image', copyPng, { icon: 'copy' }),
      button('Download CSV', downloadCsv, { icon: 'download' }),
      button('Copy for Excel', copyTsv, { icon: 'copy', title: 'Copy as tab-separated text' })),
    summary,
    preview,
    colors,
    legend);

  function refresh() {
    if (!el.isConnected || !app.build) return;
    const table = current();
    const how = table.layout === 'worker' ? 'One row per backend worker, grouped by host, with the endpoints it serves.'
      : table.layout === 'matrix' ? 'Backend columns: one per host.'
        : 'Backend servers listed per endpoint.';
    const csv = table.layout === 'worker' ? 'The CSV has one row per worker with every column.' : 'The CSV always has one row per endpoint with every column.';
    summary.textContent = `${table.subtitle}. ${how} ${csv}`;
    replace(preview, table.rows.length ? tableElement(table) : h('p', { class: 'empty-small', text: table.layout === 'worker' ? 'No backend servers yet. Add upstream groups and proxy endpoints.' : 'No endpoints yet. Add locations to a server block.' }));
    replace(colors, table.colorLegend.map((c) => h('span', { class: 'rt-color' },
      h('span', { class: ['rt-pill', `rt-${c.level}`], text: c.label }),
      h('span', { class: 'rt-color-text', text: c.meaning }))));
    replace(legend, [...table.legend, ...table.footnotes].map((l) => h('li', { text: l })));
  }

  return { el, refresh };
}
