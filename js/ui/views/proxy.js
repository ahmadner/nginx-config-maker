// Proxy settings, shared by the server block (defaults), locations and the proxy_params.conf settings.

import { h } from '../dom.js';
import { textField, selectField, checkField, wordsField, grid, badgeEl } from '../fields.js';
import { requestHeaderRows } from './rows.js';
import { t } from '../../core/util.js';

/** One-line description of what the shared proxy parameters send. */
export function proxyParamsSummary(pp) {
  const parts = [];
  if (t(pp.hostHeader)) parts.push(`Host ${t(pp.hostHeader)}`);
  if (pp.realIp) parts.push('X-Real-IP');
  if (pp.forwardedFor) parts.push('X-Forwarded-For');
  if (pp.forwardedProto) parts.push('X-Forwarded-Proto');
  if (pp.httpVersion) parts.push(`HTTP/${pp.httpVersion}`);
  if (pp.clearConnectionHeader) parts.push('Connection ""');
  for (const k of ['connectTimeout', 'sendTimeout', 'readTimeout']) if (t(pp[k])) parts.push(`${k.replace('Timeout', '')} ${t(pp[k])}`);
  if (pp.redirect) parts.push(`proxy_redirect ${pp.redirect}`);
  return parts.length ? `Sends ${parts.join(', ')}. Edit it under Settings.` : 'The shared file is empty; edit it under Settings.';
}

/** Number of proxy settings set at this level (for section summaries). */
export function proxySetCount(ps) {
  let n = 0;
  for (const [k, v] of Object.entries(ps)) {
    if (Array.isArray(v)) n += v.length;
    else if (v === true || (typeof v === 'string' && v.trim())) n += k === 'includeParams' ? 0 : 1;
  }
  return n;
}

/**
 * level: 'server' (defaults for every location), 'location', or 'snippet' (proxy_params.conf).
 * inherited: settings of the enclosing server block, used for placeholders at location level.
 */
export function proxyFields(app, base, { level, inherited = null }) {
  const ps = app.get(base);
  const pp = app.project.settings.proxyParams;
  const fromServer = (key, fallback) => {
    if (level !== 'location') return fallback;
    const v = inherited && t(inherited[key]);
    return v ? `${v} (from server block)` : fallback;
  };
  const out = [];
  if (level !== 'snippet') {
    out.push(checkField(app, [...base, 'includeParams'], {
      label: `Include the shared proxy parameters (${t(pp.path) || 'proxy_params.conf'})`, width: 'full', rerender: true,
      hint: proxyParamsSummary(pp),
    }));
    if (ps.includeParams && level === 'server') {
      out.push(h('p', { class: 'hint', text: 'Included at server level, every location inherits these settings. Locations that set their own request headers get the shared ones repeated automatically.' }));
    }
  }
  out.push(grid(
    selectField(app, [...base, 'httpVersion'], [['', level === 'snippet' ? 'Not set' : 'Not set (inherited)'], ['1.1', 'HTTP/1.1 (needed for keepalive)'], ['1.0', 'HTTP/1.0']], { label: 'HTTP version to backends', width: 'm', rerender: false }),
    textField(app, [...base, 'hostHeader'], { label: 'Host header sent to backends', width: 'm', placeholder: fromServer('hostHeader', 'not set ($proxy_host)'), options: [['$host', 'requested name, without port'], ['$http_host', 'Host header as sent, with port'], ['$proxy_host', 'backend name (nginx default)']] }),
  ));
  out.push(h('div', { class: 'checks' },
    checkField(app, [...base, 'realIp'], { label: 'X-Real-IP: client address' }),
    checkField(app, [...base, 'forwardedFor'], { label: 'X-Forwarded-For: client address chain' }),
    checkField(app, [...base, 'forwardedProto'], { label: 'X-Forwarded-Proto: http or https' }),
    checkField(app, [...base, 'clearConnectionHeader'], { label: 'Clear Connection header (upstream keepalive)' }),
    level !== 'snippet' ? checkField(app, [...base, 'websocket'], { label: 'WebSocket (Upgrade and Connection headers)', badge: { text: 'http-level map', title: 'Uses $connection_upgrade, defined by a map in the shared http file of this package.' } }) : null,
    level !== 'snippet' ? checkField(app, [...base, 'sslServerName'], { label: 'Send SNI to https:// backends (proxy_ssl_server_name)' }) : null));
  out.push(h('div', { class: 'subhead', text: 'Timeouts' }));
  out.push(grid(
    textField(app, [...base, 'connectTimeout'], { label: 'proxy_connect_timeout', width: 's', placeholder: fromServer('connectTimeout', 'default 60s') }),
    textField(app, [...base, 'sendTimeout'], { label: 'proxy_send_timeout', width: 's', placeholder: fromServer('sendTimeout', 'default 60s') }),
    textField(app, [...base, 'readTimeout'], { label: 'proxy_read_timeout', width: 's', placeholder: fromServer('readTimeout', 'default 60s') }),
  ));
  out.push(h('div', { class: 'subhead', text: 'Buffering' }));
  const onOff = (label) => [['', 'Not set (default on)'], ['on', 'on'], ['off', 'off']].map(([v, l]) => [v, v ? l : label || l]);
  out.push(grid(
    selectField(app, [...base, 'buffering'], onOff(), { label: 'Response buffering', width: 's', rerender: false }),
    selectField(app, [...base, 'requestBuffering'], onOff(), { label: 'Request buffering', width: 's', rerender: false }),
    textField(app, [...base, 'bufferSize'], { label: 'proxy_buffer_size', width: 's', placeholder: fromServer('bufferSize', '4k or 8k') }),
    textField(app, [...base, 'buffers'], { label: 'proxy_buffers', width: 's', placeholder: fromServer('buffers', '8 4k') }),
    textField(app, [...base, 'busyBuffersSize'], { label: 'proxy_busy_buffers_size', width: 's', placeholder: fromServer('busyBuffersSize', '8k or 16k') }),
  ));
  out.push(h('div', { class: 'subhead', text: 'Response handling' }));
  out.push(grid(
    selectField(app, [...base, 'redirect'], [['', 'Not set (default)'], ['off', 'off: keep backend Location headers'], ['default', 'default: rewrite them']], { label: 'proxy_redirect', width: 'm', rerender: false }),
    wordsField(app, [...base, 'hideHeaders'], { label: 'Hide backend response headers', width: 'm', placeholder: 'X-Powered-By Server' }),
  ));
  out.push(h('div', { class: 'subhead' }, 'Extra request headers', level === 'location' ? badgeEl({ text: 'replaces inherited', title: 'Nginx does not inherit proxy_set_header into a location that sets its own; the generator repeats the inherited ones for you.' }) : null));
  out.push(requestHeaderRows(app, [...base, 'requestHeaders']));
  return out;
}
