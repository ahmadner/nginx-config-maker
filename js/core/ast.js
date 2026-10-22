// Configuration tree used by the generator, and the serializer that turns it into text.
//
// Node types:
//   { t: 'dir', name, args, src?, ag?, ac?, trail?, commented?, origin? }   directive "name args;"
//   { t: 'block', name, args, children, src? }                               "name args { ... }"
//   { t: 'comment', text }   { t: 'blank' }   { t: 'raw', text, src }          custom text, kept as written
//   { t: 'marker', family }                                                  placeholder, prints nothing
// Arguments are raw values; the serializer quotes them when Nginx needs it. { q: value } forces quotes.
// `src` is the model path the node came from ("servers.0.blocks.1.listen.0"), used to map issues to lines.

let groupSeq = 0;

export const dir = (name, args = [], opts = {}) => ({ t: 'dir', name, args, ...opts });
export const block = (name, args, children, opts = {}) => ({ t: 'block', name, args, children, ...opts });
export const comment = (text) => ({ t: 'comment', text: String(text) });
export const blank = () => ({ t: 'blank' });
export const raw = (text, opts = {}) => ({ t: 'raw', text: String(text), ...opts });
export const marker = (family) => ({ t: 'marker', family });
export const forced = (value) => ({ q: String(value) });

/** Marks directives to be aligned with each other; `col` also aligns their first argument. */
export function aligned(nodes, { col = false } = {}) {
  const g = ++groupSeq;
  for (const n of nodes) {
    if (n.t === 'dir') {
      n.ag = g;
      if (col) n.ac = true;
    }
  }
  return nodes;
}

const NEEDS_QUOTES = /[\s;{}"']|^#|\\(["'\\trn]|$)/;

/** Quotes a value the way Nginx reads it back (ngx_conf_read_token escapes). */
export function quoteArg(value, force = false) {
  const s = String(value);
  if (!force && s !== '' && !NEEDS_QUOTES.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

const argText = (a) => (a !== null && typeof a === 'object' ? quoteArg(a.q, true) : quoteArg(a));
// eslint-disable-next-line no-control-regex
const cleanComment = (s) => String(s).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');

/** Plain value of an argument (for analysis). */
export const argValue = (a) => (a !== null && typeof a === 'object' ? a.q : String(a));

/**
 * Serializes nodes. Returns { text, lineMap } where lineMap is [{ line, src, rawLine? }].
 */
export function serialize(nodes, { indent = 4, align = true } = {}) {
  const out = [];
  const lineMap = [];
  const pad = (depth) => ' '.repeat(depth * indent);
  const lastBlankOrOpen = () => out.length === 0 || out[out.length - 1] === '' || out[out.length - 1].endsWith('{');
  const record = (n, extra) => { if (n.src) lineMap.push({ line: out.length + 1, src: n.src, ...extra }); };

  function emitDir(n, depth, nameW, argW) {
    const args = n.args.map(argText);
    const name = quoteArg(n.name);
    let s = pad(depth) + (n.commented ? '# ' : '');
    if (!args.length) s += name;
    else if (argW && args.length >= 2) s += `${nameW ? name.padEnd(nameW) : name} ${args[0].padEnd(argW)} ${args.slice(1).join(' ')}`;
    else s += `${nameW ? name.padEnd(nameW) : name} ${args.join(' ')}`;
    s += ';';
    if (n.trail) s += `  # ${cleanComment(n.trail)}`;
    record(n);
    out.push(s);
  }

  function emitRaw(n, depth) {
    const lines = n.text.replace(/\r\n?/g, '\n').split('\n');
    let first = 0;
    let last = lines.length - 1;
    while (first <= last && !lines[first].trim()) first++;
    while (last >= first && !lines[last].trim()) last--;
    if (first > last) return;
    const body = lines.slice(first, last + 1);
    const indents = body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length);
    const common = Math.min(...indents);
    body.forEach((l, k) => {
      const expanded = l.replace(/^[ \t]*/, (m) => m.replace(/\t/g, '    '));
      const text = l.trim() ? pad(depth) + expanded.slice(common).replace(/\s+$/, '') : '';
      record(n, { rawLine: first + k + 1 });
      out.push(text);
    });
  }

  function emitList(list, depth) {
    let i = 0;
    while (i < list.length) {
      const n = list[i];
      if (n.t === 'dir' && align && n.ag && !n.commented) {
        let j = i;
        while (j < list.length && list[j].t === 'dir' && list[j].ag === n.ag && !list[j].commented) j++;
        const run = list.slice(i, j);
        const withArgs = run.filter((r) => r.args.length);
        const nameW = withArgs.length > 1 ? Math.max(...withArgs.map((r) => quoteArg(r.name).length)) : 0;
        const colNodes = run.filter((r) => r.ac && r.args.length >= 2);
        const argW = colNodes.length > 1 ? Math.max(...colNodes.map((r) => argText(r.args[0]).length)) : 0;
        for (const r of run) emitDir(r, depth, r.args.length ? nameW : 0, r.ac ? argW : 0);
        i = j;
        continue;
      }
      emitNode(n, depth);
      i++;
    }
  }

  function emitNode(n, depth) {
    switch (n.t) {
      case 'dir': emitDir(n, depth, 0, 0); break;
      case 'block': {
        const head = [quoteArg(n.name), ...n.args.map(argText)].join(' ');
        record(n);
        out.push(`${pad(depth)}${head} {`);
        emitList(n.children, depth + 1);
        while (out.length && out[out.length - 1] === '') out.pop();
        out.push(`${pad(depth)}}`);
        break;
      }
      case 'comment':
        for (const line of cleanComment(n.text).split('\n')) out.push(`${pad(depth)}#${line ? ` ${line}` : ''}`.replace(/\s+$/, ''));
        break;
      case 'blank':
        if (!lastBlankOrOpen()) out.push('');
        break;
      case 'raw': emitRaw(n, depth); break;
      default: break;
    }
  }

  emitList(nodes, 0);
  while (out.length && out[out.length - 1] === '') out.pop();
  return { text: out.length ? `${out.join('\n')}\n` : '', lineMap };
}

/** Joins sections (arrays of nodes) with blank lines, skipping empty sections. */
export function sections(parts, { blankLines = true } = {}) {
  const res = [];
  for (const part of parts) {
    if (!part || !part.length) continue;
    if (res.length && blankLines) res.push(blank());
    res.push(...part);
  }
  return res;
}
