// Location editor (one card per location inside a server block).

import { h, icon } from '../dom.js';
import {
  textField, numberField, selectField, checkField, textareaField, choicesField, section, grid, note, badgeEl,
} from '../fields.js';
import { proxyFields, proxySetCount } from './proxy.js';
import { accessRows, responseHeaderRows } from './rows.js';
import { confirmDialog, toast } from '../dialogs.js';
import {
  locationLabel, locationLogName, changeLocationType, duplicateLocation, moveItem, newUpstream, MATCH_LABELS,
} from '../../core/model.js';
import { joinPath } from '../../core/paths.js';
import { t, pathKey } from '../../core/util.js';
import { LOG_LEVELS, HTTP_METHODS } from '../../core/formats.js';

export const TYPE_LABELS = {
  proxy: 'Proxy to a backend',
  return: 'Redirect or fixed response',
  static: 'Static files',
  health: 'Health check (200 OK)',
  status: 'Nginx status page',
  custom: 'Custom directives only',
};

const RETURN_CODES = [
  [301, '301 Moved Permanently'], [302, '302 Found'], [303, '303 See Other'], [307, '307 Temporary Redirect'], [308, '308 Permanent Redirect'],
  [200, '200 OK (text)'], [204, '204 No Content'], [403, '403 Forbidden'], [404, '404 Not Found'], [410, '410 Gone'], [429, '429 Too Many Requests'],
  [444, '444 Close connection'], [500, '500 Internal Server Error'], [503, '503 Service Unavailable'],
];

const isRegex = (loc) => loc.match === 'regex' || loc.match === 'regex_ci';

export function typeChip(type) {
  return h('span', { class: ['type-chip', `type-${type}`], text: type });
}

/** "→ ext_portal/visitor/" style summary of what a location does. */
export function targetSummary(loc) {
  const pp = loc.proxyPass;
  switch (loc.type) {
    case 'proxy': {
      const dest = pp.target === 'direct' ? `${t(pp.address) || '?'}${pp.port !== null ? `:${pp.port}` : ''}` : t(pp.upstream) || 'no upstream chosen';
      return `→ ${pp.scheme}://${dest}${t(pp.uri)}`;
    }
    case 'return': return `return ${loc.return.code ?? '?'} ${t(loc.return.value)}`.trim();
    case 'static': return t(loc.static.alias) ? `alias ${t(loc.static.alias)}` : `root ${t(loc.static.root) || '?'}`;
    case 'health': return `200 "${t(loc.health.text) || 'ok'}"`;
    case 'status': return 'stub_status';
    default: return 'custom';
  }
}

/** Example of how a request path reaches the backend. */
export function mappingExample(loc) {
  const pp = loc.proxyPass;
  const path = t(loc.path);
  const uri = t(pp.uri);
  const dest = pp.target === 'direct' ? `${t(pp.address) || 'backend'}${pp.port !== null ? `:${pp.port}` : ''}` : t(pp.upstream) || 'upstream';
  const base = `${pp.scheme}://${dest}`;
  if (!path) return '';
  if (isRegex(loc)) return `The request path is passed unchanged: /any/path → ${base}/any/path`;
  if (path.startsWith('@')) return `Named location: used by error_page or try_files, not by request paths.`;
  const req = loc.match === 'exact' ? path : `${path}${path.endsWith('/') ? '' : '/'}page`;
  const sent = uri ? (loc.match === 'exact' ? uri : uri + req.slice(path.length)) : req;
  return `Example: ${req} → ${base}${sent}${uri && loc.match !== 'exact' ? `  (the matched "${path}" is replaced by "${uri}")` : ''}`;
}

export function locationCard(app, ci, bi, li) {
  const base = ['servers', ci, 'blocks', bi, 'locations', li];
  const cfg = app.get(['servers', ci]);
  const blk = app.get(['servers', ci, 'blocks', bi]);
  const loc = app.get(base);
  const p = app.project;
  const list = blk.locations;

  const titleText = h('span', { class: 'mono loc-path', text: locationLabel(loc) });
  const summaryText = h('span', { class: 'mono', text: targetSummary(loc) });
  const example = h('p', { class: 'hint mono example', text: loc.type === 'proxy' ? mappingExample(loc) : '' });
  const live = () => {
    titleText.textContent = locationLabel(loc);
    summaryText.textContent = targetSummary(loc);
    example.textContent = loc.type === 'proxy' ? mappingExample(loc) : '';
  };

  const actions = [
    h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'Move up', 'aria-label': `Move location ${locationLabel(loc)} up`, disabled: li === 0, onclick: () => app.update(() => moveItem(list, li, -1)) }, icon('up')),
    h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'Move down', 'aria-label': `Move location ${locationLabel(loc)} down`, disabled: li === list.length - 1, onclick: () => app.update(() => moveItem(list, li, 1)) }, icon('down')),
    h('button', { type: 'button', class: 'btn btn-icon btn-ghost', title: 'Duplicate', 'aria-label': `Duplicate location ${locationLabel(loc)}`, onclick: () => app.update(() => { const c = duplicateLocation(blk, li); app.openState.set(c.id, true); }) }, icon('duplicate')),
    h('button', {
      type: 'button', class: 'btn btn-icon btn-ghost', title: 'Delete', 'aria-label': `Delete location ${locationLabel(loc)}`,
      onclick: async () => {
        if (await confirmDialog({ title: `Delete location ${locationLabel(loc)}?`, message: 'The location and its settings are removed from this server block.', confirmLabel: 'Delete location', danger: true })) {
          app.update(() => list.splice(li, 1));
        }
      },
    }, icon('trash')),
  ];

  const body = [];
  const groups = [...new Set(list.map((l) => t(l.group)).filter(Boolean))];
  body.push(grid(
    selectField(app, [...base, 'match'], Object.entries(MATCH_LABELS), { label: 'Match', width: 's' }),
    textField(app, [...base, 'path'], { label: isRegex(loc) ? 'Regular expression' : 'Path', required: true, width: 'm', placeholder: isRegex(loc) ? '\\.(png|jpg)$' : '/api/', onInput: live }),
    selectField(app, [...base, 'type'], Object.entries(TYPE_LABELS), { label: 'Handles requests by', width: 'm', onChange: (v) => app.update(() => changeLocationType(loc, v)) }),
  ));
  body.push(grid(
    textField(app, [...base, 'name'], { label: 'Name (log files)', width: 's', placeholder: locationLogName({ ...loc, name: '' }, li) }),
    textField(app, [...base, 'group'], { label: 'Group comment', width: 'm', placeholder: 'e.g. Pair A (11/12)', options: groups }),
    checkField(app, [...base, 'internal'], { label: 'Internal only (error pages, X-Accel)', width: 'm' }),
  ));

  // What the location does.
  if (loc.type === 'proxy') {
    const pp = loc.proxyPass;
    const names = p.upstreams.map((u) => [u.name, `${u.name}${u.enabled ? '' : ' (turned off)'}`]);
    if (t(pp.upstream) && !p.upstreams.some((u) => u.name.toLowerCase() === t(pp.upstream).toLowerCase())) names.push([t(pp.upstream), `${t(pp.upstream)} (not defined)`]);
    const target = [
      selectField(app, [...base, 'proxyPass', 'target'], [['upstream', 'Upstream group'], ['direct', 'One backend server']], { label: 'Send to', width: 's' }),
    ];
    if (pp.target === 'upstream') {
      target.push(selectField(app, [...base, 'proxyPass', 'upstream'], [['', names.length ? 'Choose an upstream…' : 'No upstream groups yet'], ...names], { label: 'Upstream group', width: 'm', required: true }));
      target.push(h('div', { class: 'field w-s field-button' },
        h('button', {
          type: 'button', class: 'btn btn-small', onclick: () => {
            let created;
            app.update((proj) => {
              created = newUpstream(proj, { name: `${t(cfg.category) ? `${t(cfg.category).slice(0, 3)}_` : ''}${locationLogName(loc, li).replace(/[^A-Za-z0-9_-]/g, '_')}`, category: t(cfg.category) });
              proj.upstreams.push(created);
              loc.proxyPass.upstream = created.name;
            });
            toast(`Created upstream ${created.name}. Add its backend servers on the Upstreams tab.`, 'success');
          },
        }, icon('plus'), h('span', { text: 'New upstream group' }))));
    } else {
      target.push(textField(app, [...base, 'proxyPass', 'address'], { label: 'Backend address', width: 'm', required: true, placeholder: '10.0.0.10, app.internal or unix:/run/app.sock', onInput: live }));
      target.push(numberField(app, [...base, 'proxyPass', 'port'], { label: 'Port', placeholder: '8080', min: 1, max: 65535 }));
    }
    target.push(selectField(app, [...base, 'proxyPass', 'scheme'], [['http', 'http://'], ['https', 'https://']], { label: 'Protocol', width: 's', rerender: false, onChange: (v) => { app.set([...base, 'proxyPass', 'scheme'], v); live(); } }));
    target.push(textField(app, [...base, 'proxyPass', 'uri'], { label: 'Backend path (optional)', width: 'm', placeholder: 'keep the request path', onInput: live }));
    body.push(grid(...target));
    body.push(example);
  } else if (loc.type === 'return') {
    const code = loc.return.code;
    const redirect = [301, 302, 303, 307, 308].includes(code);
    body.push(grid(
      selectField(app, [...base, 'return', 'code'], RETURN_CODES.map(([c, l]) => [String(c), l]), { label: 'Status', width: 'm', numeric: true }),
      textField(app, [...base, 'return', 'value'], { label: redirect ? 'Redirect to' : 'Response text (optional)', width: 'l', placeholder: redirect ? 'https://$host$request_uri' : 'Service unavailable', onInput: live }),
    ));
  } else if (loc.type === 'static') {
    body.push(grid(
      textField(app, [...base, 'static', 'root'], { label: 'root (adds the request path)', width: 'm', placeholder: '/usr/share/nginx/html', onInput: live }),
      textField(app, [...base, 'static', 'alias'], { label: 'alias (replaces the location path)', width: 'm', placeholder: '/srv/files/', onInput: live }),
      textField(app, [...base, 'static', 'index'], { label: 'index', width: 's', placeholder: 'index.html' }),
      textField(app, [...base, 'static', 'tryFiles'], { label: 'try_files', width: 'm', placeholder: '$uri $uri/ =404' }),
    ));
  } else if (loc.type === 'health') {
    body.push(grid(textField(app, [...base, 'health', 'text'], { label: 'Response text', width: 'm', placeholder: 'ok', onInput: live })));
    body.push(note('Answers 200 with this text and does not write access log entries. Nginx itself does not check backends actively (that needs NGINX Plus); upstream max_fails and fail_timeout do passive checks.'));
  } else if (loc.type === 'status') {
    body.push(note(h('span', {}, 'Shows Nginx connection counters (stub_status). Limit it to monitoring hosts with the access rules below. ', badgeEl({ text: 'needs stub_status module', title: 'ngx_http_stub_status_module: check that "nginx -V" lists --with-http_stub_status_module.' }))));
  } else if (loc.type === 'custom') {
    body.push(note('Write the body of this location under Custom directives. The proxy settings below still apply if you add a proxy_pass there.'));
  }

  if (['proxy', 'static', 'custom'].includes(loc.type)) {
    body.push(choicesField(app, [...base, 'methods'], HTTP_METHODS.slice(0, 7), {
      label: 'Allowed methods (none checked: all)', hint: 'Other methods get 403 Forbidden (limit_except). GET also allows HEAD.',
    }));
  }

  // Logging and limits.
  const lg = loc.logging;
  const autoName = locationLogName(loc, li);
  const autoBase = joinPath(t(p.settings.logRoot) || '/var/log/nginx', t(cfg.category));
  const auto = blk.logging.perLocation && !['health', 'status'].includes(loc.type);
  body.push(section(app, `${loc.id}#log`, {
    title: 'Logging and limits', level: 4, issuePath: pathKey([...base, 'logging']),
    summary: lg.accessLogOff ? 'access log off' : t(lg.accessLog) ? t(lg.accessLog) : auto ? 'per-location log files' : 'inherited from the server block',
  },
  grid(
    textField(app, [...base, 'logging', 'accessLog'], { label: 'Access log', width: 'l', placeholder: auto ? `${autoBase}/${autoName}.access.log` : 'inherited from the server block' }),
    textField(app, [...base, 'logging', 'accessLogFormat'], { label: 'Format', width: 's', placeholder: t(p.settings.logFormat) || 'combined' }),
    checkField(app, [...base, 'logging', 'accessLogOff'], { label: 'Access log off', width: 's' }),
  ),
  grid(
    textField(app, [...base, 'logging', 'errorLog'], { label: 'Error log', width: 'l', placeholder: auto ? `${autoBase}/${autoName}.error.log` : 'inherited from the server block' }),
    selectField(app, [...base, 'logging', 'errorLogLevel'], [['', 'Default (error)'], ...LOG_LEVELS.map((l) => [l, l])], { label: 'Level', width: 's', rerender: false }),
  ),
  grid(
    textField(app, [...base, 'clientMaxBodySize'], { label: 'client_max_body_size', width: 's', placeholder: t(blk.clientMaxBodySize) ? `${t(blk.clientMaxBodySize)} (from server block)` : 'default 1m' }),
    textField(app, [...base, 'sendTimeout'], { label: 'send_timeout', width: 's', placeholder: t(blk.sendTimeout) ? `${t(blk.sendTimeout)} (from server block)` : 'default 60s' }),
  )));

  if (loc.type === 'proxy' || loc.type === 'custom') {
    const n = proxySetCount(loc.proxy);
    body.push(section(app, `${loc.id}#proxy`, {
      title: 'Proxy settings', level: 4, issuePath: pathKey([...base, 'proxy']),
      summary: `${loc.proxy.includeParams ? `includes ${t(p.settings.proxyParams.path) || 'proxy_params.conf'}` : 'no shared file'}${n ? `, ${n} set here` : ''}`,
    }, proxyFields(app, [...base, 'proxy'], { level: 'location', inherited: blk.proxy })));
  }

  body.push(section(app, `${loc.id}#headers`, {
    title: 'Response headers', level: 4, issuePath: pathKey([...base, 'responseHeaders']),
    summary: loc.responseHeaders.length ? `${loc.responseHeaders.length} header${loc.responseHeaders.length === 1 ? '' : 's'}` : 'none (inherits the server block)',
  },
  h('p', { class: 'hint', text: 'A location that sets add_header does not inherit the server block\'s headers; the generator repeats them (including the security headers) so nothing is lost.' }),
  responseHeaderRows(app, [...base, 'responseHeaders'])));

  const acc = loc.access;
  body.push(section(app, `${loc.id}#access`, {
    title: 'Access control and rate limiting', level: 4, issuePath: pathKey([...base, 'access']),
    summary: [acc.rules.length && `${acc.rules.length} rule${acc.rules.length === 1 ? '' : 's'}`, t(acc.basicAuthUserFile) && 'password', t(loc.rateLimit.zone) && `limit ${t(loc.rateLimit.zone)}`].filter(Boolean).join(', ') || 'inherits the server block',
  }, accessControls(app, base)));

  body.push(section(app, `${loc.id}#custom`, {
    title: 'Custom directives', level: 4, issuePath: pathKey([...base, 'customDirectives']),
    summary: t(loc.customDirectives) ? `${t(loc.customDirectives).split('\n').length} line(s)` : 'none',
    open: loc.type === 'custom',
  }, customArea(app, [...base, 'customDirectives'], 'location')));

  const isNewOrSmall = list.length <= 2;
  return section(app, loc.id, {
    title: h('span', { class: 'loc-head' }, typeChip(loc.type), titleText), summary: summaryText, open: isNewOrSmall,
    issuePath: pathKey(base), cls: 'loc-card', actions, level: 4,
  }, body);
}

/** Access rules, basic authentication and rate limiting (server block and location). */
export function accessControls(app, base) {
  const zones = app.project.rateLimitZones.map((z) => t(z.name)).filter(Boolean);
  const current = t(app.get([...base, 'rateLimit', 'zone']));
  const zoneOptions = [['', zones.length ? 'No rate limit' : 'No zones defined (Settings)'], ...zones.map((z) => [z, z])];
  if (current && !zones.includes(current)) zoneOptions.push([current, `${current} (not defined)`]);
  return [
    h('div', { class: 'subhead', text: 'Allow and deny (checked in order)' }),
    accessRows(app, [...base, 'access', 'rules']),
    h('div', { class: 'subhead' }, 'Basic authentication', badgeEl({ text: 'password file on server', title: 'Create it with htpasswd on the server. The package never contains credentials.' })),
    grid(
      textField(app, [...base, 'access', 'basicAuthRealm'], { label: 'Realm (prompt text)', width: 'm', mono: false, placeholder: 'Restricted' }),
      textField(app, [...base, 'access', 'basicAuthUserFile'], { label: 'Password file', width: 'l', placeholder: '/etc/nginx/htpasswd/site' }),
    ),
    h('div', { class: 'subhead' }, 'Rate limiting', badgeEl({ text: 'zone in Settings', title: 'Zones are defined under Settings → Rate limit zones and written to the shared http file.' })),
    grid(
      selectField(app, [...base, 'rateLimit', 'zone'], zoneOptions, { label: 'Zone', width: 'm' }),
      numberField(app, [...base, 'rateLimit', 'burst'], { label: 'Burst', placeholder: '0', min: 0 }),
      checkField(app, [...base, 'rateLimit', 'nodelay'], { label: 'No delay (reject above burst)', width: 'm' }),
      numberField(app, [...base, 'rateLimit', 'status'], { label: 'Reject status', placeholder: '503', min: 400, max: 599 }),
    ),
  ];
}

export function customArea(app, path, context) {
  return [
    note(`Advanced: written exactly as entered inside the ${context} block. The generator checks syntax, braces and where each directive may appear, but not its values; nginx -t on the server is the final check.`, 'warning'),
    textareaField(app, path, { label: `Custom directives (${context} context)`, hideLabel: true, rows: 5, code: true, placeholder: context === 'upstream' ? '# e.g.\nresolver 10.0.0.2 valid=30s;' : '# e.g.\nproxy_next_upstream error timeout;' }),
  ];
}
