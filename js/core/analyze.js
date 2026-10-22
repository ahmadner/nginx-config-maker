// Context analysis of generated files: expands includes and custom directives, then checks each block
// (http, server, location, upstream) for directives that Nginx would reject or that need attention.

import { argValue } from './ast.js';
import { parseConfig } from './syntax.js';
import { directiveInfo, allowedIn, contextsOf, childContext, moduleNote } from './directives.js';
import { INSECURE_TLS } from './formats.js';

/** Directives whose inheritance is all-or-nothing, keyed by their first argument (header name). */
export const FAMILIES = ['proxy_set_header', 'add_header', 'proxy_hide_header'];
export const familyKey = (args) => String(args[0] ?? '').toLowerCase();

const parseCache = new Map();
export function parseCached(text) {
  let res = parseCache.get(text);
  if (!res) {
    res = parseConfig(text);
    if (parseCache.size > 500) parseCache.clear();
    parseCache.set(text, res);
  }
  return res;
}

/**
 * Flattens one block's children into the directives Nginx sees in that block.
 * Includes of generated snippets are expanded; custom text is parsed.
 * Entry: { name, args, rawArgs, src, origin, rawLine?, isBlock, children?, statement? }
 *   origin: 'own' (structured settings), 'custom', 'inherited', or 'snippet:<key>'.
 */
export function expandNodes(nodes, snippets = {}, origin = null) {
  const out = [];
  for (const n of nodes) {
    if (n.t === 'dir') {
      if (n.commented) continue;
      if (n.name === 'include' && n.snippet && snippets[n.snippet]) {
        out.push({ name: 'include', args: n.args.map(argValue), rawArgs: n.args, src: n.src, origin: origin || n.origin || 'own', snippet: n.snippet, isBlock: false });
        out.push(...expandNodes(snippets[n.snippet], {}, `snippet:${n.snippet}`));
        continue;
      }
      out.push({ name: n.name, args: n.args.map(argValue), rawArgs: n.args, src: n.src, origin: origin || n.origin || 'own', isBlock: false });
    } else if (n.t === 'block') {
      out.push({ name: n.name, args: n.args.map(argValue), rawArgs: n.args, src: n.src, origin: origin || 'own', isBlock: true, children: n.children });
    } else if (n.t === 'raw') {
      const { statements } = parseCached(n.text);
      for (const st of statements) {
        out.push({
          name: st.name, args: st.args, rawArgs: st.args, src: n.src, origin: origin && origin.startsWith('snippet:') ? origin : 'custom',
          rawLine: st.line, isBlock: !!st.block, statement: st,
        });
      }
    }
  }
  return out;
}

const ORIGIN_LABEL = {
  own: 'the settings of this block',
  custom: 'custom directives',
  inherited: 'headers repeated from the server block',
  'snippet:proxyParams': 'the shared proxy parameters file',
  'snippet:sslParams': 'the shared TLS parameters file',
  'snippet:securityHeaders': 'the shared security headers file',
};
const originLabel = (o) => ORIGIN_LABEL[o] || o;

const CONTEXT_LABEL = { http: 'the http context (top level of the file)', server: 'a server block', location: 'a location block', upstream: 'an upstream block', if: 'an if block', limit_except: 'a limit_except block' };

/**
 * Analyzes every generated file. Returns issues: { level, path, message, rawLine? }.
 * `snippets` maps snippet keys to their nodes.
 */
export function analyzeFiles(files, snippets) {
  const issues = [];
  const seen = new Set();
  const add = (issue) => {
    const key = `${issue.level}|${issue.path}|${issue.rawLine || ''}|${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };
  for (const file of files) {
    if (file.kind === 'snippet') continue; // checked where it is included
    analyzeBlock(file.nodes, 'http', file.src, snippets, add);
  }
  return issues;
}

function analyzeBlock(nodes, context, ctxSrc, snippets, add) {
  const entries = expandNodes(nodes, snippets);

  // Parse errors in custom text (reported once per text).
  for (const n of nodes) {
    if (n.t !== 'raw') continue;
    for (const err of parseCached(n.text).errors) {
      add({ level: 'error', path: n.src, rawLine: err.line, message: `Custom directives, line ${err.line}: ${err.message}.` });
    }
  }
  for (const [key, snippetNodes] of Object.entries(snippets)) {
    if (!entries.some((e) => e.snippet === key)) continue;
    for (const n of snippetNodes) {
      if (n.t !== 'raw') continue;
      for (const err of parseCached(n.text).errors) {
        add({ level: 'error', path: n.src, rawLine: err.line, message: `Custom directives, line ${err.line}: ${err.message}.` });
      }
    }
  }

  checkEntries(entries, context, add);

  // Duplicates of directives that may only appear once per block.
  const counts = new Map();
  for (const e of entries) {
    if (e.isBlock) continue;
    const info = directiveInfo(e.name);
    if (!info || info.multi) continue;
    if (!counts.has(e.name)) counts.set(e.name, []);
    counts.get(e.name).push(e);
  }
  for (const [name, list] of counts) {
    if (list.length < 2) continue;
    const target = [...list].reverse().find((e) => !e.origin.startsWith('snippet:')) || list[list.length - 1];
    const origins = [...new Set(list.map((e) => originLabel(e.origin)))];
    add({
      level: 'error', path: target.src || ctxSrc, rawLine: target.rawLine,
      message: `"${name}" is set ${list.length} times in ${CONTEXT_LABEL[context] || context} (${origins.join(' and ')}). Nginx rejects a directive that is set twice in the same block; remove one of them.`,
    });
  }

  // Same header set twice with values (nginx would send both).
  for (const fam of FAMILIES) {
    const byKey = new Map();
    for (const e of entries) {
      if (e.name !== fam || e.isBlock) continue;
      if (fam !== 'proxy_hide_header' && (e.args[1] ?? '') === '') continue; // empty value: nginx does not send it
      const k = familyKey(e.args);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
    for (const [k, list] of byKey) {
      if (list.length < 2) continue;
      const target = [...list].reverse().find((e) => !e.origin.startsWith('snippet:')) || list[list.length - 1];
      const origins = [...new Set(list.map((e) => originLabel(e.origin)))];
      add({
        level: 'warning', path: target.src || ctxSrc, rawLine: target.rawLine,
        message: `${fam} "${list[0].args[0]}" is set ${list.length} times in ${CONTEXT_LABEL[context] || context} (${origins.join(' and ')}); nginx sends ${fam === 'proxy_hide_header' ? 'nothing different' : 'every value'}. Keep one.`,
      });
    }
  }

  // Recurse into generated blocks.
  for (const n of nodes) {
    if (n.t !== 'block') continue;
    const child = childContext(n.name);
    if (child) analyzeBlock(n.children, child, n.src || ctxSrc, snippets, add);
  }
}

/** Checks directives (mainly custom ones) against the catalog for the given context. */
function checkEntries(entries, context, add) {
  for (const e of entries) {
    const fromUser = e.origin === 'custom' || (e.origin.startsWith('snippet:') && e.rawLine);
    const where = e.rawLine ? `Custom directives, line ${e.rawLine}: ` : '';
    const info = directiveInfo(e.name);
    const issue = (level, message) => add({ level, path: e.src, rawLine: e.rawLine, message: `${where}${message}` });

    for (const a of e.args) {
      if (/-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)/.test(a)) issue('error', `"${e.name}" contains a certificate or key. Reference files on the server by path; never embed key material.`);
    }
    if (/^ssl_(certificate|certificate_key|trusted_certificate|client_certificate)$/.test(e.name) && /^data:/i.test(e.args[0] || '')) {
      issue('error', `"${e.name} data:..." embeds key material in the configuration. Use a file path on the server instead.`);
    }

    if (!fromUser) continue;

    if (!e.name) continue; // parse error already reported
    if (!info) {
      issue('warning', `unknown directive "${e.name}" was not checked. Check the spelling, or that the module providing it is installed.`);
      if (e.isBlock && e.statement) checkStatements(e.statement.block, null, e, add);
      continue;
    }
    const allowed = allowedIn(e.name, context);
    if (!allowed) {
      issue('error', `"${e.name}" is not allowed in ${CONTEXT_LABEL[context] || context}; it belongs in: ${contextsOf(e.name).join(', ')}.`);
    }
    if (e.name === 'server') {
      if (context === 'upstream' && e.isBlock) issue('error', '"server" inside an upstream takes an address, not a { } block.');
      if (context === 'http' && !e.isBlock) issue('error', '"server" at the http level must be a { } block.');
    } else if (info.block && !e.isBlock) {
      issue('error', `"${e.name}" needs a { } block.`);
    } else if (!info.block && e.isBlock) {
      issue('error', `"${e.name}" does not take a { } block.`);
    }
    if (info.plus) issue('warning', `"${e.name}" is only available in NGINX Plus (the commercial version).`);
    if (info.code) issue('warning', `"${e.name}" runs code inside Nginx; review it carefully. ${moduleNote(info.module)}.`);
    else if (info.module) issue('info', `"${e.name}" ${moduleNote(info.module)}.`);
    if (info.deprecated) issue('warning', `"${e.name}" is deprecated (removed in Nginx 1.25.1). Use "listen ... ssl" instead.`);
    if (e.name === 'include') issue('warning', `includes "${e.args[0] || ''}", which is not part of this package and was not checked. Make sure it exists on the server.`);
    if (e.name === 'ssl_protocols' && e.args.some((p) => INSECURE_TLS.includes(p))) issue('error', `enables an insecure protocol (${e.args.filter((p) => INSECURE_TLS.includes(p)).join(', ')}). Use TLSv1.2 and TLSv1.3 only.`);
    if (e.name === 'root' && e.args[0] === '/') issue('warning', '"root /" serves the whole file system of the server.');
    if (e.name === 'autoindex' && e.args[0] === 'on') issue('warning', '"autoindex on" publishes directory listings.');
    if (e.name === 'server_tokens' && e.args[0] === 'on') issue('warning', '"server_tokens on" reveals the Nginx version in responses and error pages.');

    if (e.isBlock && e.statement) {
      const child = childContext(e.name);
      if (child) checkStatements(e.statement.block, child, e, add);
    }
  }
}

function checkStatements(statements, context, parent, add) {
  if (!context) return;
  const entries = statements.map((st) => ({
    name: st.name, args: st.args, src: parent.src, origin: parent.origin === 'custom' ? 'custom' : parent.origin,
    rawLine: st.line, isBlock: !!st.block, statement: st,
  }));
  checkEntries(entries, context, add);
}
