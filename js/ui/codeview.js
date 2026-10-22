// Read-only code view with line numbers, Nginx syntax highlighting and issue markers.
// Highlighting produces text nodes only, so file content can never inject markup.

import { h, clear, icon } from './dom.js';
import { highlightLines } from '../core/syntax.js';

export class CodeView {
  constructor({ label = 'File content', wrap = false } = {}) {
    this.el = h('div', { class: ['code-view', wrap && 'code-wrap'], role: 'region', 'aria-label': label, tabIndex: 0 });
    this.pre = h('pre', { class: 'code' });
    this.el.append(this.pre);
    this.signature = null;
    this.lineEls = [];
    this.highlighted = [];
  }

  /** text: file content; issues: [{ level, line, message }]; language: 'nginx' | 'plain'. */
  update(text, issues = [], { language = 'nginx' } = {}) {
    const sig = `${language}\u0000${text}\u0000${issues.map((i) => `${i.level}:${i.line}:${i.message}`).join('|')}`;
    if (sig === this.signature) return;
    this.signature = sig;
    clear(this.pre);
    this.lineEls = [];
    const byLine = new Map();
    for (const i of issues) {
      if (!i.line) continue;
      if (!byLine.has(i.line)) byLine.set(i.line, []);
      byLine.get(i.line).push(i);
    }
    const source = text.endsWith('\n') ? text.slice(0, -1) : text;
    const lines = language === 'nginx'
      ? highlightLines(source)
      : source.split('\n').map((l) => [{ cls: language === 'yaml' && /^\s*#/.test(l) ? 'c' : '', text: l }]);
    const code = h('code');
    lines.forEach((segs, idx) => {
      const n = idx + 1;
      const lineIssues = byLine.get(n) || [];
      const level = lineIssues.some((i) => i.level === 'error') ? 'error' : lineIssues.some((i) => i.level === 'warning') ? 'warning' : lineIssues.length ? 'info' : null;
      const content = h('span', { class: 'lc' }, segs.map((s) => (s.cls ? h('span', { class: `t-${s.cls}`, text: s.text }) : s.text)));
      const line = h('span', {
        class: ['line', level && `line-${level}`], dataset: { line: n },
        title: lineIssues.length ? lineIssues.map((i) => `${i.level}: ${i.message}`).join('\n') : undefined,
      },
      h('span', { class: 'ln', 'aria-hidden': 'true' }, level ? icon(level === 'error' ? 'error' : level === 'warning' ? 'alert' : 'info', { size: 11 }) : null, String(n)),
      content);
      this.lineEls.push(line);
      code.append(line);
    });
    this.pre.append(code);
    this.highlighted = [];
  }

  /** Highlights lines (1-based) and scrolls the first into view. */
  highlight(lines = [], { scroll = true } = {}) {
    for (const el of this.highlighted) el.classList.remove('line-focus');
    this.highlighted = lines.map((n) => this.lineEls[n - 1]).filter(Boolean);
    for (const el of this.highlighted) el.classList.add('line-focus');
    if (scroll && this.highlighted[0]) {
      const target = this.highlighted[0];
      const box = this.el;
      const top = target.offsetTop - box.clientHeight / 3;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }
}

/** Compact list of issues for a file, each one clickable. */
export function issueList(issues, { onSelect, empty = null, max = 200 } = {}) {
  if (!issues.length) return empty;
  const shown = issues.slice(0, max);
  return h('ul', { class: 'issue-list' },
    shown.map((i) => h('li', { class: ['issue', `issue-${i.level}`] },
      icon(i.level === 'error' ? 'error' : i.level === 'warning' ? 'alert' : 'info'),
      h('div', { class: 'issue-body' },
        h('div', { class: 'issue-msg', text: i.message }),
        i.where ? h('div', { class: 'issue-where', text: i.where }) : null),
      onSelect ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => onSelect(i), text: 'Show' }) : null)),
    issues.length > max ? h('li', { class: 'issue issue-more', text: `…and ${issues.length - max} more` }) : null);
}
