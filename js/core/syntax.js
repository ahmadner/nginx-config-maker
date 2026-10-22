// Nginx configuration syntax: tokenizer, parser (for checking custom directives) and highlighter.
// Follows the rules of ngx_conf_read_token closely enough to catch the mistakes nginx -t would report:
// unbalanced braces, missing semicolons and unterminated quotes.

const UNESCAPE = { '"': '"', "'": "'", '\\': '\\', t: '\t', r: '\r', n: '\n' };
const unescape = (ch) => (Object.prototype.hasOwnProperty.call(UNESCAPE, ch) ? UNESCAPE[ch] : `\\${ch}`);

/**
 * Splits text into tokens: ws, nl, comment, word, string, semi, lbrace, rbrace.
 * Each token has { type, text (as written), value (words/strings, unescaped), line }.
 */
export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const push = (type, start, end, value, startLine, extra) => {
    tokens.push({ type, text: src.slice(start, end), value, line: startLine, ...extra });
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { push('nl', i, i + 1, null, line); i++; line++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') {
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      push('ws', i, j, null, line);
      i = j;
      continue;
    }
    if (c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      push('comment', i, j, null, line);
      i = j;
      continue;
    }
    if (c === ';') { push('semi', i, i + 1, null, line); i++; continue; }
    if (c === '{') { push('lbrace', i, i + 1, null, line); i++; continue; }
    if (c === '}') { push('rbrace', i, i + 1, null, line); i++; continue; }
    if (c === '"' || c === "'") {
      const startLine = line;
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\' && j + 1 < n) {
          if (src[j + 1] === '\n') line++;
          value += unescape(src[j + 1]);
          j += 2;
          continue;
        }
        if (ch === c) { closed = true; j++; break; }
        if (ch === '\n') line++;
        value += ch;
        j++;
      }
      push('string', i, j, value, startLine, closed ? undefined : { unterminated: true });
      i = j;
      continue;
    }
    let j = i;
    let value = '';
    while (j < n) {
      const ch = src[j];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === ';' || ch === '}') break;
      if (ch === '{') {
        // "${var}" keeps its braces inside the word.
        if (j > i && src[j - 1] === '$') {
          const close = src.indexOf('}', j);
          if (close !== -1 && !/[\s;]/.test(src.slice(j, close))) { value += src.slice(j, close + 1); j = close + 1; continue; }
        }
        break;
      }
      if (ch === '\\' && j + 1 < n) { value += unescape(src[j + 1]); j += 2; continue; }
      value += ch;
      j++;
    }
    push('word', i, j, value, line);
    i = j;
  }
  return tokens;
}

/**
 * Parses configuration text into statements: { name, args, line, block: statements|null }.
 * Returns { statements, errors: [{ line, message }] }.
 */
export function parseConfig(src) {
  const tokens = tokenize(String(src ?? ''));
  const errors = [];
  const root = [];
  const stack = [{ children: root, line: 0, name: null }];
  let words = [];
  let wordsLine = 0;
  const top = () => stack[stack.length - 1];

  for (const tk of tokens) {
    switch (tk.type) {
      case 'word':
      case 'string':
        if (!words.length) wordsLine = tk.line;
        if (tk.unterminated) errors.push({ line: tk.line, message: `quoted text starting on line ${tk.line} is never closed` });
        words.push(tk.value);
        break;
      case 'semi':
        if (!words.length) errors.push({ line: tk.line, message: 'unexpected ";" (nothing before it)' });
        else top().children.push({ name: words[0], args: words.slice(1), line: wordsLine, block: null });
        words = [];
        break;
      case 'lbrace': {
        const stmt = { name: words.length ? words[0] : '', args: words.slice(1), line: words.length ? wordsLine : tk.line, block: [] };
        if (!words.length) errors.push({ line: tk.line, message: 'unexpected "{" (a block needs a name such as location)' });
        top().children.push(stmt);
        stack.push({ children: stmt.block, line: tk.line, name: stmt.name });
        words = [];
        break;
      }
      case 'rbrace':
        if (words.length) {
          errors.push({ line: wordsLine, message: `"${words[0]}" is missing a ";" before "}"` });
          words = [];
        }
        if (stack.length === 1) errors.push({ line: tk.line, message: 'unexpected "}" (no matching "{")' });
        else stack.pop();
        break;
      default:
        break;
    }
  }
  if (words.length) errors.push({ line: wordsLine, message: `"${words[0]}" is missing a terminating ";"` });
  for (let k = stack.length - 1; k > 0; k--) {
    errors.push({ line: stack[k].line, message: `"${stack[k].name || '{'}" block opened on line ${stack[k].line} is never closed with "}"` });
  }
  return { statements: root, errors };
}

const BLOCK_WORDS = new Set(['server', 'location', 'upstream', 'map', 'if', 'limit_except', 'types', 'geo', 'split_clients', 'http', 'events']);
const NUMBER_RE = /^\d+(\.\d+)?(ms|s|m|h|d|w|M|y|k|K|g|G)?$/;
const VAR_RE = /\$(\{[A-Za-z0-9_]+\}|[A-Za-z0-9_]+)/g;

function splitVariables(text, baseCls, out) {
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    if (m.index > last) out.push({ cls: baseCls, text: text.slice(last, m.index) });
    out.push({ cls: 'v', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ cls: baseCls, text: text.slice(last) });
}

/**
 * Highlights configuration text. Returns one array of segments per line: [{ cls, text }].
 * Classes: k block keyword, d directive, s string, v variable, n number, b on/off, c comment, p punctuation.
 */
export function highlightLines(src) {
  const lines = [[]];
  let expectName = true;
  const add = (cls, text, splitVars) => {
    const parts = text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (!part) return;
      const segs = lines[lines.length - 1];
      if (splitVars) splitVariables(part, cls, segs);
      else segs.push({ cls, text: part });
    });
  };
  for (const tk of tokenize(src)) {
    switch (tk.type) {
      case 'nl': lines.push([]); break;
      case 'ws': add('', tk.text); break;
      case 'comment': add('c', tk.text); break;
      case 'string': add('s', tk.text, true); expectName = false; break;
      case 'word': {
        let cls = '';
        if (expectName) cls = BLOCK_WORDS.has(tk.value) ? 'k' : 'd';
        else if (NUMBER_RE.test(tk.text)) cls = 'n';
        else if (tk.text === 'on' || tk.text === 'off') cls = 'b';
        add(cls, tk.text, !expectName);
        expectName = false;
        break;
      }
      default: add('p', tk.text); expectName = true; break;
    }
  }
  return lines;
}
