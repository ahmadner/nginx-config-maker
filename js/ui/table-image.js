// Draws the endpoint routing table on a canvas and returns a PNG. Light "document" colors regardless of
// the app theme, so the image reads well in e-mails, tickets and printed handovers.

import { cellText, cellLines } from '../core/table.js';
import { APP_NAME } from '../core/version.js';

const SANS = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = '"Cascadia Mono", Consolas, "SF Mono", Menlo, "Liberation Mono", monospace';
const F = {
  title: `600 22px ${SANS}`,
  subtitle: `13px ${SANS}`,
  head: `600 12px ${SANS}`,
  super: `600 11px ${SANS}`,
  cell: `13px ${SANS}`,
  italic: `italic 13px ${SANS}`,
  mono: `12.5px ${MONO}`,
  monoBold: `600 12.5px ${MONO}`,
  group: `600 13.5px ${SANS}`,
  groupSub: `12px ${MONO}`,
  pill: `600 11px ${SANS}`,
  foot: `12px ${SANS}`,
};
const C = {
  bg: '#ffffff', text: '#1b222c', muted: '#5f6b7a', faint: '#a2abb6', grid: '#e6e9ee', zebra: '#f7f9fb', border: '#d5dbe2',
  headBg: '#1f2a37', headText: '#ffffff', superBg: '#2e3d4f', groupBg: '#eef5f1', accent: '#1a7f4b',
  port: '#0b5ea8', backup: '#8a5a00', down: '#c21f32',
};
const STATUS = {
  ok: ['#1a7f4b', '#e3f3e9'], warning: ['#8a5a00', '#fff1cc'], error: ['#c21f32', '#fde8ea'], muted: ['#5b6573', '#eceff3'],
};
const MARGIN = 28;
const PAD = 10;
const ROW_H = 30;
const LINE_H = 17;
const HEAD_H = 30;
const GROUP_H = 36;
const MAX_LINES = 3;
const MAX_STACK = 12;   // endpoints listed on one worker row before the rest become "+N more"
const STACK_H = 22;     // line height when a cell stacks status pills
const COLOR_H = 24;     // one row of the colour legend
const COLOR_GAP = 20;

const LIMITS = {
  endpoint: [90, 320], upstream: [120, 320], method: [80, 200], backends: [180, 420], backendPath: [80, 220],
  notes: [120, 320], status: [86, 140], category: [70, 140], environment: [80, 160], listen: [70, 180],
  serverNames: [90, 240], file: [110, 260], host: [76, 150],
  // Worker layout.
  worker: [76, 120], port: [56, 110], flags: [64, 160], upstreams: [110, 260], count: [58, 90],
  endpoints: [220, 520], configs: [110, 240],
};

function fontFor(col, row) {
  if (col.key === 'endpoint' || col.key === 'worker') return F.monoBold;
  if (col.key === 'upstream' && row && !row.upstream) return F.italic;
  return col.kind === 'mono' || col.kind === 'host' ? F.mono : F.cell;
}

function textWidth(ctx, font, text) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

function ellipsize(ctx, font, text, max) {
  ctx.font = font;
  if (ctx.measureText(text).width <= max + 0.5) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max + 0.5) lo = mid; else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Wraps between list entries (after ", "), and between words only inside an entry that is too long. */
function wrapText(ctx, font, text, max, maxLines = MAX_LINES) {
  ctx.font = font;
  if (!text) return [''];
  const words = text.split(/(?<=, )/).flatMap((entry) => (ctx.measureText(entry.trimEnd()).width <= max ? [entry] : entry.split(/(?<= )/)));
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line + w;
    if (ctx.measureText(candidate.trimEnd()).width <= max || !line) {
      line = candidate;
    } else {
      lines.push(line.trimEnd());
      line = w;
    }
  }
  if (line) lines.push(line.trimEnd());
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(ctx, font, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, max);
    return kept;
  }
  return lines.map((l) => ellipsize(ctx, font, l, max));
}

/** Lays colour-legend items out in rows that fit the content width. */
function wrapRow(items, maxWidth) {
  const rows = [];
  let row = [];
  let used = 0;
  for (const item of items) {
    const need = item.width + (row.length ? COLOR_GAP : 0);
    if (row.length && used + need > maxWidth) { rows.push(row); row = [item]; used = item.width; } else { row.push(item); used += need; }
  }
  if (row.length) rows.push(row);
  return rows;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Entries of a stacked cell (one per endpoint), capped so a worker with many endpoints stays readable. */
function stacked(row, col) {
  const entries = cellLines(row, col);
  if (!entries) return null;
  if (entries.length <= MAX_STACK) return entries;
  const rest = entries.length - (MAX_STACK - 1);
  return [...entries.slice(0, MAX_STACK - 1), { text: col.kind === 'statuses' ? '' : `+${rest} more`, more: true }];
}

/** Lays out the table; returns sizes and per-row wrapped cell text. */
function layout(ctx, table) {
  const cols = table.columns.map((col) => {
    const [min, max] = col.limits || LIMITS[col.kind === 'host' ? 'host' : col.key] || [70, 240];
    let w = textWidth(ctx, F.head, col.label) + PAD * 2;
    for (const r of table.rows) {
      const entries = stacked(r, col);
      if (entries) {
        const font = col.kind === 'statuses' ? F.pill : fontFor(col, r);
        for (const e of entries) w = Math.max(w, textWidth(ctx, font, e.text) + (col.kind === 'statuses' ? 18 : 0) + PAD * 2);
        continue;
      }
      const text = col.key === 'status' ? r.status : cellText(r, col);
      const tw = col.key === 'status' ? textWidth(ctx, F.pill, text) + 18 : textWidth(ctx, fontFor(col, r), text);
      w = Math.max(w, tw + PAD * 2);
    }
    return { ...col, width: Math.ceil(Math.min(max, Math.max(min, w + 2))) };
  });
  // Stacked pills need more room between lines than plain text does.
  const lineH = cols.some((c) => c.kind === 'statuses') ? STACK_H : LINE_H;
  const rows = table.rows.map((r) => {
    const cells = cols.map((col) => {
      const font = fontFor(col, r);
      const entries = stacked(r, col);
      if (entries) {
        const max = col.width - PAD * 2 - (col.kind === 'statuses' ? 16 : 0);
        return { text: '', font, entries, lines: entries.map((e) => ellipsize(ctx, col.kind === 'statuses' ? F.pill : font, e.text, max)) };
      }
      const text = col.key === 'status' ? r.status : cellText(r, col);
      const lines = col.wrap ? wrapText(ctx, font, text, col.width - PAD * 2, col.maxLines || MAX_LINES) : [ellipsize(ctx, font, text, col.width - PAD * 2)];
      return { text, lines, font };
    });
    const lineCount = Math.max(1, ...cells.map((c) => c.lines.length));
    return { row: r, cells, height: Math.max(ROW_H, lineCount * lineH + 13) };
  });
  return { cols, rows, lineH, tableWidth: cols.reduce((n, c) => n + c.width, 0), twoRowHeader: cols.some((c) => c.group) };
}

/**
 * Renders the table to a PNG Blob. scale 2 gives sharp text on high-density screens and in documents;
 * it is reduced automatically for very large tables (canvas size limits).
 */
export async function tableToPng(table, { scale = 2, date = new Date() } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const L = layout(ctx, table);
  const byKey = new Map(L.rows.map((x) => [x.row, x]));
  const groups = table.grouped ? table.groups : [{ rows: table.rows }];

  const legendLines = [...table.legend, ...table.footnotes];
  const footer = `Generated by ${APP_NAME} on ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const titleW = Math.max(textWidth(ctx, F.title, table.title), textWidth(ctx, F.subtitle, table.subtitle));
  const legendW = Math.max(0, ...legendLines.map((l) => textWidth(ctx, F.foot, l)), textWidth(ctx, F.foot, footer));
  const colorItems = (table.colorLegend || []).map((c) => {
    const pw = textWidth(ctx, F.pill, c.label) + 16;
    return { ...c, pw, width: pw + 6 + textWidth(ctx, F.foot, c.meaning) };
  });
  const widest = Math.max(0, ...colorItems.map((c) => c.width));
  const width = Math.ceil(Math.max(L.tableWidth, titleW, legendW, widest, 560) + MARGIN * 2);
  const colorRows = wrapRow(colorItems, width - MARGIN * 2);
  const headerH = L.twoRowHeader ? HEAD_H * 2 : HEAD_H;
  const bodyH = groups.reduce((n, g) => n + (table.grouped ? GROUP_H : 0) + g.rows.reduce((m, r) => m + byKey.get(r).height, 0), 0);
  const colorH = colorRows.length * COLOR_H;
  const height = Math.ceil(MARGIN + 30 + 22 + 18 + headerH + bodyH + 18 + colorH + (legendLines.length + 1) * 18 + MARGIN);

  const s = Math.min(scale, 16000 / width, 16000 / height, Math.sqrt(160e6 / (width * height)));
  if (s < 0.6) throw new Error(`The table is too large for an image (${table.rows.length} rows). Use the CSV export instead.`);
  canvas.width = Math.ceil(width * s);
  canvas.height = Math.ceil(height * s);
  ctx.scale(s, s);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);

  // Title.
  let y = MARGIN;
  ctx.fillStyle = C.text;
  ctx.font = F.title;
  ctx.fillText(table.title, MARGIN, y + 13);
  y += 30;
  ctx.fillStyle = C.muted;
  ctx.font = F.subtitle;
  ctx.fillText(table.subtitle, MARGIN, y + 9);
  y += 22 + 18;

  const x0 = MARGIN;
  const tableTop = y;

  // Header.
  ctx.fillStyle = C.headBg;
  ctx.fillRect(x0, y, L.tableWidth, headerH);
  let x = x0;
  const hostCols = L.cols.filter((c) => c.group);
  for (const col of L.cols) {
    if (col.group) {
      ctx.fillStyle = C.superBg;
      if (col === hostCols[0]) ctx.fillRect(x, y, hostCols.reduce((n, c) => n + c.width, 0), HEAD_H);
      ctx.fillStyle = C.headText;
      ctx.font = F.head;
      ctx.textAlign = 'center';
      ctx.fillText(ellipsize(ctx, F.head, col.label, col.width - 8), x + col.width / 2, y + HEAD_H * 1.5);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = C.headText;
      ctx.font = F.head;
      ctx.fillText(ellipsize(ctx, F.head, col.label, col.width - PAD * 2), x + PAD, y + headerH / 2);
    }
    x += col.width;
  }
  if (hostCols.length) {
    const hx = x0 + L.cols.slice(0, L.cols.indexOf(hostCols[0])).reduce((n, c) => n + c.width, 0);
    const hw = hostCols.reduce((n, c) => n + c.width, 0);
    ctx.fillStyle = C.headText;
    ctx.font = F.super;
    ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, F.super, hostCols[0].group.toUpperCase(), hw - 8), hx + hw / 2, y + HEAD_H / 2);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, y + HEAD_H + 0.5);
    ctx.lineTo(hx + hw, y + HEAD_H + 0.5);
    for (let i = 1; i < hostCols.length; i++) {
      const vx = hx + hostCols.slice(0, i).reduce((n, c) => n + c.width, 0) + 0.5;
      ctx.moveTo(vx, y + HEAD_H);
      ctx.lineTo(vx, y + headerH);
    }
    ctx.stroke();
  }
  y += headerH;

  // Groups and rows.
  for (const g of groups) {
    if (table.grouped) {
      ctx.fillStyle = C.groupBg;
      ctx.fillRect(x0, y, L.tableWidth, GROUP_H);
      ctx.fillStyle = g.disabled ? C.faint : C.accent;
      ctx.fillRect(x0, y, 4, GROUP_H);
      ctx.fillStyle = g.disabled ? C.muted : C.text;
      ctx.font = F.group;
      const title = g.title + (g.note ? ` (${g.note})` : '');
      ctx.fillText(ellipsize(ctx, F.group, title, L.tableWidth * 0.5), x0 + 14, y + GROUP_H / 2);
      const tw = Math.min(textWidth(ctx, F.group, title), L.tableWidth * 0.5);
      ctx.fillStyle = C.muted;
      ctx.font = F.groupSub;
      ctx.fillText(ellipsize(ctx, F.groupSub, g.sub, L.tableWidth - tw - 40), x0 + 14 + tw + 16, y + GROUP_H / 2 + 1);
      y += GROUP_H;
    }
    g.rows.forEach((r, i) => {
      const R = byKey.get(r);
      if (i % 2 === 1) {
        ctx.fillStyle = C.zebra;
        ctx.fillRect(x0, y, L.tableWidth, R.height);
      }
      let cx = x0;
      L.cols.forEach((col, k) => {
        const cell = R.cells[k];
        const muted = r.dim;
        if (col.key === 'status') {
          const [fg, bg] = STATUS[r.statusLevel] || STATUS.muted;
          ctx.font = F.pill;
          const pw = Math.min(col.width - PAD * 2, textWidth(ctx, F.pill, r.status) + 16);
          ctx.fillStyle = bg;
          roundRect(ctx, cx + PAD, y + R.height / 2 - 10, pw, 20, 10);
          ctx.fill();
          ctx.fillStyle = fg;
          ctx.fillText(ellipsize(ctx, F.pill, r.status, pw - 12), cx + PAD + 8, y + R.height / 2 + 0.5);
        } else if (col.kind === 'host') {
          const entry = r.backends.get(col.host);
          if (entry) {
            const off = entry.flags.includes('off');
            const color = muted || off ? C.faint : entry.flags.includes('down') ? C.down : entry.flags.includes('backup') ? C.backup : C.port;
            ctx.fillStyle = color;
            ctx.font = entry.active && !muted ? F.monoBold : F.mono;
            ctx.textAlign = 'center';
            const text = cell.lines[0];
            ctx.fillText(text, cx + col.width / 2, y + R.height / 2);
            if (off) {
              const w = textWidth(ctx, ctx.font, text);
              ctx.fillRect(cx + col.width / 2 - w / 2, y + R.height / 2, w, 1);
            }
            ctx.textAlign = 'left';
          }
        } else if (cell.entries && col.kind === 'statuses') {
          // One pill per endpoint, on the same lines as the endpoints next to it.
          const top = y + R.height / 2 - ((cell.lines.length - 1) * L.lineH) / 2;
          cell.lines.forEach((line, n) => {
            if (!line) return;
            const [fg, bg] = STATUS[cell.entries[n].level] || STATUS.muted;
            ctx.font = F.pill;
            const pw = Math.min(col.width - PAD * 2, textWidth(ctx, F.pill, line) + 16);
            ctx.fillStyle = bg;
            roundRect(ctx, cx + PAD, top + n * L.lineH - 9, pw, 18, 9);
            ctx.fill();
            ctx.fillStyle = fg;
            ctx.fillText(line, cx + PAD + 8, top + n * L.lineH + 0.5);
          });
        } else {
          ctx.font = cell.font;
          ctx.fillStyle = muted ? C.muted : col.key === 'notes' || (col.key === 'upstream' && !r.upstream) ? C.muted : C.text;
          const top = y + R.height / 2 - ((cell.lines.length - 1) * L.lineH) / 2;
          cell.lines.forEach((line, n) => {
            ctx.fillStyle = cell.entries && cell.entries[n].more ? C.faint
              : muted ? C.muted : col.key === 'notes' || (col.key === 'upstream' && !r.upstream) ? C.muted : C.text;
            ctx.fillText(line, cx + PAD, top + n * L.lineH);
          });
        }
        cx += col.width;
      });
      // Row separator.
      ctx.fillStyle = C.grid;
      ctx.fillRect(x0, y + R.height - 1, L.tableWidth, 1);
      y += R.height;
    });
  }

  // Vertical separators around the backend host columns, and the outer border.
  if (hostCols.length) {
    ctx.fillStyle = C.grid;
    let vx = x0 + L.cols.slice(0, L.cols.indexOf(hostCols[0])).reduce((n, c) => n + c.width, 0);
    for (const col of hostCols) {
      ctx.fillRect(Math.round(vx), tableTop + headerH, 1, y - tableTop - headerH);
      vx += col.width;
    }
    ctx.fillRect(Math.round(vx), tableTop + headerH, 1, y - tableTop - headerH);
  }
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, tableTop + 0.5, L.tableWidth - 1, y - tableTop - 1);

  // What the colours mean, then the legend and footer.
  y += 18;
  for (const row of colorRows) {
    let lx = MARGIN;
    for (const item of row) {
      const [fg, bg] = STATUS[item.level] || STATUS.muted;
      ctx.fillStyle = bg;
      roundRect(ctx, lx, y + 1, item.pw, 18, 9);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = F.pill;
      ctx.fillText(item.label, lx + 8, y + 10.5);
      ctx.fillStyle = C.muted;
      ctx.font = F.foot;
      ctx.fillText(item.meaning, lx + item.pw + 6, y + 10);
      lx += item.width + COLOR_GAP;
    }
    y += COLOR_H;
  }
  ctx.font = F.foot;
  for (const line of legendLines) {
    ctx.fillStyle = C.muted;
    ctx.fillText(line, MARGIN, y + 6);
    y += 18;
  }
  ctx.fillStyle = C.faint;
  ctx.fillText(footer, MARGIN, y + 6);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not create the image.'))), 'image/png');
  });
}
