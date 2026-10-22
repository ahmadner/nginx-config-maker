// Settings tab: target server layout, shared include files, rate limit zones, formatting, appearance.

import { h, button } from '../dom.js';
import {
  textField, numberField, selectField, checkField, wordsField, choicesField, section, grid, note, issueArea, badgeEl,
} from '../fields.js';
import { proxyFields } from './proxy.js';
import { rowList } from './rows.js';
import { customArea } from './location.js';
import { confirmDialog, toast } from '../dialogs.js';
import { defaultSettings, resetProject } from '../../core/model.js';
import { REFERRER_POLICIES, TLS_PROTOCOLS } from '../../core/formats.js';
import { t } from '../../core/util.js';

export const settingsView = {
  id: 'settings',
  label: 'Settings',

  render(app, el) {
    const s = app.project.settings;
    const S = ['settings'];
    const used = app.build ? app.build.used : { proxyParams: [], sslParams: [], securityHeaders: [] };
    const usage = (key) => (used[key].length ? `included by ${used[key].length} block${used[key].length === 1 ? '' : 's'}` : 'not used yet (not generated)');

    const target = h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Target server' }),
      h('p', { class: 'hint', text: 'Describe the Nginx server the package is for, so include paths and checks match it. The reference layout is /etc/nginx with "include /etc/nginx/upstreams.conf;" and "include /etc/nginx/conf.d/*.conf;" in nginx.conf.' }),
      grid(
        textField(app, [...S, 'nginxRoot'], { label: 'Nginx configuration directory', width: 'm', placeholder: '/etc/nginx', hint: 'Package paths are relative to it; include directives use it as prefix.' }),
        selectField(app, [...S, 'nginxVersion'], [['1.24-or-older', 'Any version (listen … http2)'], ['1.25-or-newer', 'Nginx 1.25.1 or newer (http2 on;)']], { label: 'Target Nginx version', width: 'm', rerender: false, hint: 'Only changes how HTTP/2 is written. Check with nginx -v.' }),
      ),
      wordsField(app, [...S, 'httpIncludes'], { label: 'Loaded by nginx.conf (include patterns in its http block)', perLine: true, rows: 3, placeholder: 'upstreams.conf\nconf.d/*.conf', hint: 'One per line, relative to the Nginx directory. Used to check that every generated file is loaded exactly once; nginx.conf itself is not part of the package.' }));

    const folders = h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Output folders' }),
      grid(
        textField(app, [...S, 'serverDir'], { label: 'Default folder for server configurations', width: 'm', placeholder: 'conf.d' }),
        textField(app, [...S, 'upstreamDir'], { label: 'Default parent folder for upstream groups', width: 'm', placeholder: 'upstreams', hint: 'New groups go to <folder>/<category>, e.g. upstreams/external.' }),
        textField(app, [...S, 'disabledDirName'], { label: 'Folder for turned-off files', width: 's', placeholder: 'disabled', hint: 'Created inside the file\'s own folder.' }),
      ),
      h('div', { class: 'subhead', text: 'Upstream index' }),
      grid(
        checkField(app, [...S, 'upstreamIndex', 'enabled'], { label: 'Generate an index file that loads the upstream groups', width: 'l', rerender: true }),
        s.upstreamIndex.enabled ? textField(app, [...S, 'upstreamIndex', 'path'], { label: 'Index file', width: 's', placeholder: 'upstreams.conf' }) : null,
        s.upstreamIndex.enabled ? selectField(app, [...S, 'upstreamIndex', 'style'], [['directories', 'Include each folder (dir/*.conf), as the reference does'], ['files', 'Include each file by name']], { label: 'Include style', width: 'l', rerender: false }) : null,
      ),
      s.upstreamIndex.enabled && s.upstreamIndex.style === 'directories' ? note('Folder includes also load other .conf files that already exist in those folders on the server.') : null,
      grid(textField(app, [...S, 'sharedHttpPath'], { label: 'Shared http definitions file', width: 'm', placeholder: 'conf.d/00-shared.conf', hint: 'Holds rate limit zones and the WebSocket map; generated only when needed. Must be loaded by nginx.conf.' })));

    const logging = h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Logging defaults' }),
      grid(
        textField(app, [...S, 'logRoot'], { label: 'Log directory', width: 'm', placeholder: '/var/log/nginx', hint: 'Base for per-location log files: <dir>/<category>/<location>.access.log.' }),
        textField(app, [...S, 'logFormat'], { label: 'Access log format', width: 's', placeholder: 'combined', badge: { text: 'defined in nginx.conf', title: 'Any format other than "combined" must be defined with log_format in nginx.conf.' } }),
      ));

    const proxy = section(app, 'settings#proxy', { title: `Shared proxy parameters (${t(s.proxyParams.path) || 'proxy_params.conf'})`, open: true, issuePath: 'settings.proxyParams', summary: usage('proxyParams'), level: 2, cls: 'card' },
      grid(textField(app, [...S, 'proxyParams', 'path'], { label: 'File', width: 'm', placeholder: 'proxy_params.conf' })),
      h('p', { class: 'hint', text: 'Included by locations (and server blocks) that turn on "Include the shared proxy parameters". The reference file sends the forwarding headers, uses HTTP/1.1 with keepalive and leaves timeouts to each location.' }),
      proxyFields(app, [...S, 'proxyParams'], { level: 'snippet' }),
      h('div', { class: 'subhead', text: 'Custom directives' }),
      customArea(app, [...S, 'proxyParams', 'customDirectives'], 'location'));

    const sp = s.sslParams;
    const tls = section(app, 'settings#tls', { title: `Shared TLS parameters (${t(sp.path) || 'ssl_params.conf'})`, issuePath: 'settings.sslParams', summary: usage('sslParams'), level: 2, cls: 'card' },
      grid(textField(app, [...S, 'sslParams', 'path'], { label: 'File', width: 'm', placeholder: 'ssl_params.conf' })),
      choicesField(app, [...S, 'sslParams', 'protocols'], TLS_PROTOCOLS, { label: 'Protocols', hint: 'TLSv1 and TLSv1.1 are insecure and cannot be selected.' }),
      grid(
        textField(app, [...S, 'sslParams', 'ciphers'], { label: 'Ciphers (TLS 1.2)', width: 'full', placeholder: 'OpenSSL cipher list, e.g. ECDHE-ECDSA-AES128-GCM-SHA256:…' }),
        selectField(app, [...S, 'sslParams', 'preferServerCiphers'], [['', 'Not set'], ['on', 'on'], ['off', 'off']], { label: 'Prefer server ciphers', width: 's', rerender: false }),
      ),
      grid(
        textField(app, [...S, 'sslParams', 'sessionCache'], { label: 'Session cache', width: 'm', placeholder: 'shared:SSL:20m' }),
        textField(app, [...S, 'sslParams', 'sessionTimeout'], { label: 'Session timeout', width: 's', placeholder: '10m' }),
        selectField(app, [...S, 'sslParams', 'sessionTickets'], [['', 'Not set'], ['off', 'off'], ['on', 'on']], { label: 'Session tickets', width: 's', rerender: false }),
      ),
      grid(
        checkField(app, [...S, 'sslParams', 'stapling'], { label: 'OCSP stapling', width: 's', badge: { text: 'needs resolver', title: 'Nginx must reach the certificate authority\'s OCSP responder.' } }),
        checkField(app, [...S, 'sslParams', 'staplingVerify'], { label: 'Verify stapled responses', width: 'm' }),
        textField(app, [...S, 'sslParams', 'resolver'], { label: 'Resolver', width: 'm', placeholder: '10.0.0.2 valid=300s' }),
        textField(app, [...S, 'sslParams', 'resolverTimeout'], { label: 'Resolver timeout', width: 's', placeholder: '5s' }),
      ),
      h('div', { class: 'subhead', text: 'Custom directives' }),
      customArea(app, [...S, 'sslParams', 'customDirectives'], 'server'));

    const sh = s.securityHeaders;
    const sec = section(app, 'settings#security', { title: `Security headers (${t(sh.path) || 'security_headers.conf'})`, issuePath: 'settings.securityHeaders', summary: usage('securityHeaders'), level: 2, cls: 'card' },
      grid(textField(app, [...S, 'securityHeaders', 'path'], { label: 'File', width: 'm', placeholder: 'security_headers.conf' })),
      h('p', { class: 'hint', text: 'Sent with "always", so they are also on error responses. A server block or location that sets its own add_header does not inherit these; the generator repeats them there.' }),
      checkField(app, [...S, 'securityHeaders', 'hideUpstreamHeaders'], { label: 'Remove the same headers from backend responses (proxy_hide_header), so they are not sent twice', width: 'full' }),
      grid(
        selectField(app, [...S, 'securityHeaders', 'frameOptions'], [['', 'Not sent'], ['SAMEORIGIN', 'SAMEORIGIN'], ['DENY', 'DENY']], { label: 'X-Frame-Options', width: 's', rerender: false }),
        checkField(app, [...S, 'securityHeaders', 'contentTypeOptions'], { label: 'X-Content-Type-Options: nosniff', width: 'm' }),
        textField(app, [...S, 'securityHeaders', 'referrerPolicy'], { label: 'Referrer-Policy', width: 'm', placeholder: 'not sent', options: REFERRER_POLICIES }),
      ),
      grid(
        checkField(app, [...S, 'securityHeaders', 'hsts'], { label: 'Strict-Transport-Security (HSTS)', width: 'm', rerender: true, hint: 'Tells browsers to use HTTPS only. Browsers ignore it over plain HTTP.' }),
        sh.hsts ? numberField(app, [...S, 'securityHeaders', 'hstsMaxAge'], { label: 'max-age (seconds)', placeholder: '31536000', min: 0 }) : null,
        sh.hsts ? checkField(app, [...S, 'securityHeaders', 'hstsIncludeSubDomains'], { label: 'includeSubDomains', width: 's' }) : null,
        sh.hsts ? checkField(app, [...S, 'securityHeaders', 'hstsPreload'], { label: 'preload', width: 's' }) : null,
      ),
      grid(
        textField(app, [...S, 'securityHeaders', 'permissionsPolicy'], { label: 'Permissions-Policy', width: 'l', placeholder: 'geolocation=(), microphone=(), camera=()' }),
        textField(app, [...S, 'securityHeaders', 'contentSecurityPolicy'], { label: 'Content-Security-Policy', width: 'l', placeholder: "default-src 'self'" }),
        checkField(app, [...S, 'securityHeaders', 'xssProtection'], { label: 'X-XSS-Protection: 1; mode=block (deprecated)', width: 'm' }),
      ),
      h('div', { class: 'subhead', text: 'Custom directives' }),
      customArea(app, [...S, 'securityHeaders', 'customDirectives'], 'server'));

    const zones = h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Rate limit zones', badgeEl({ text: 'http context', title: `Written to ${t(s.sharedHttpPath) || 'the shared http file'}.` })),
      h('p', { class: 'hint', text: 'A zone counts requests per key (usually the client address). Server blocks and locations use a zone with a burst under "Access control and rate limiting".' }),
      issueArea(app, 'rateLimitZones'),
      rowList(app, {
        path: ['rateLimitZones'], addLabel: 'Add zone', create: () => ({ name: `zone${app.project.rateLimitZones.length + 1}`, key: '$binary_remote_addr', size: '10m', rate: '10r/s' }),
        empty: 'No zones defined.',
        columns: [
          { key: 'name', label: 'Name', width: 'minmax(8rem, 1fr)', render: (rp) => textField(app, [...rp, 'name'], { label: 'Zone name', hideLabel: true, width: 'full', placeholder: 'api' }) },
          { key: 'key', label: 'Key', width: 'minmax(10rem, 1.3fr)', render: (rp) => textField(app, [...rp, 'key'], { label: 'Key', hideLabel: true, width: 'full', options: ['$binary_remote_addr', '$server_name', '$http_x_api_key'] }) },
          { key: 'size', label: 'Memory', width: 'minmax(5rem, 0.6fr)', render: (rp) => textField(app, [...rp, 'size'], { label: 'Memory', hideLabel: true, width: 'full', placeholder: '10m' }) },
          { key: 'rate', label: 'Rate', width: 'minmax(6rem, 0.7fr)', render: (rp) => textField(app, [...rp, 'rate'], { label: 'Rate', hideLabel: true, width: 'full', placeholder: '10r/s' }) },
        ],
      }));

    const format = h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Output format' }),
      grid(
        numberField(app, [...S, 'format', 'indent'], { label: 'Indentation (spaces)', placeholder: '4', min: 2, max: 8 }),
        checkField(app, [...S, 'format', 'alignValues'], { label: 'Align values of related directives', width: 'm' }),
        checkField(app, [...S, 'format', 'headerComments'], { label: 'Header comment in each file', width: 'm' }),
      ));

    const appearance = h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Appearance' }),
      h('div', { class: 'field w-m' },
        h('label', { class: 'label', for: 'pref-theme', text: 'Theme (this browser)' }),
        (() => {
          const sel = h('select', { class: 'input', id: 'pref-theme' }, [['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: app.prefs.theme === v }, l)));
          sel.addEventListener('change', () => { app.setPref('theme', sel.value); app.applyTheme(); });
          return sel;
        })()));

    const danger = h('section', { class: 'card card-danger' },
      h('h2', { class: 'card-title', text: 'Reset' }),
      h('div', { class: 'row-buttons' },
        button('Restore default settings', async () => {
          const ok = await confirmDialog({ title: 'Restore default settings?', message: 'Every setting on this tab goes back to its default. Servers, upstreams and rate limit zones are kept.', confirmLabel: 'Restore defaults', danger: true });
          if (!ok) return;
          app.update((p) => { p.settings = defaultSettings(); });
          toast('Settings restored.', 'success');
        }, { icon: 'settings' }),
        button('Reset the whole project…', async () => {
          const ok = await confirmDialog({ title: `Reset "${t(app.project.project.name)}"?`, message: 'This removes every server configuration, upstream group and rate limit zone, and restores the default settings. Export the project as YAML first if you may need it.', confirmLabel: 'Reset project', danger: true });
          if (!ok) return;
          app.update((p) => resetProject(p));
          app.sel = { server: 0, upstream: 0, file: null };
          toast('Project reset.', 'success');
        }, { icon: 'trash', kind: 'danger' })));

    el.append(h('div', { class: 'scroll' }, h('div', { class: 'page' },
      issueArea(app, 'settings'),
      target, folders, logging, proxy, tls, sec, zones, format, appearance, danger)));
  },
};
