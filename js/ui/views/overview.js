// Overview tab: project details, summary table of everything configured, and every issue.

import { h, icon, replace } from '../dom.js';
import { textField, textareaField, grid } from '../fields.js';
import { issueList } from '../codeview.js';
import { issuesUnder, countsOf } from '../../core/build.js';
import { entityFilePath, countLocations } from '../../core/model.js';
import { t } from '../../core/util.js';

function statusCell(counts) {
  if (counts.error) return h('span', { class: 'status-cell status-error' }, icon('error'), `${counts.error} error${counts.error === 1 ? '' : 's'}`);
  if (counts.warning) return h('span', { class: 'status-cell status-warning' }, icon('alert'), `${counts.warning} warning${counts.warning === 1 ? '' : 's'}`);
  return h('span', { class: 'status-cell status-ok' }, icon('check'), 'OK');
}

function rows(app) {
  const p = app.project;
  const issues = app.build ? app.build.issues : [];
  const out = [];
  p.servers.forEach((cfg, ci) => {
    const cfgOnly = issues.filter((i) => i.path && (i.path === `servers.${ci}` || (i.path.startsWith(`servers.${ci}.`) && !i.path.startsWith(`servers.${ci}.blocks.`))));
    cfg.blocks.forEach((blk, bi) => {
      const ups = [...new Set(blk.locations.filter((l) => l.type === 'proxy').map((l) => (l.proxyPass.target === 'upstream' ? t(l.proxyPass.upstream) : `direct ${t(l.proxyPass.address)}${l.proxyPass.port !== null ? `:${l.proxyPass.port}` : ''}`)).filter(Boolean))];
      const backends = [];
      for (const name of ups) {
        const u = p.upstreams.find((x) => t(x.name).toLowerCase() === name.toLowerCase());
        if (u) backends.push(...u.servers.filter((s) => s.enabled).map((s) => `${t(s.address)}${s.port !== null ? `:${s.port}` : ''}`));
        else if (name.startsWith('direct ')) backends.push(name.slice(7));
      }
      out.push({
        path: `servers.${ci}.blocks.${bi}`,
        name: `${t(cfg.name) || 'Server configuration'}${cfg.blocks.length > 1 ? ` › ${t(blk.label) || `block ${bi + 1}`}` : ''}`,
        type: 'Server block',
        disabled: !cfg.enabled,
        domain: blk.serverNames.map(t).filter(Boolean).join(' ') || '–',
        listen: blk.listen.map((l) => `${l.port ?? '?'}${l.ssl ? ' ssl' : ''}${l.defaultServer ? ' default' : ''}`).join(', ') + (blk.redirectHttp.enabled ? `, ${blk.redirectHttp.port ?? 80} → https` : ''),
        upstream: ups.join(', ') || '–',
        backends: [...new Set(backends)],
        output: entityFilePath(cfg, p.settings),
        counts: countsOf([...issuesUnder(issues, `servers.${ci}.blocks.${bi}`), ...cfgOnly]),
      });
    });
    if (!cfg.blocks.length) out.push({ path: `servers.${ci}`, name: t(cfg.name), type: 'Server block', disabled: !cfg.enabled, domain: '–', listen: '–', upstream: '–', backends: [], output: entityFilePath(cfg, p.settings), counts: countsOf(issuesUnder(issues, `servers.${ci}`)) });
  });
  p.upstreams.forEach((u, i) => {
    out.push({
      path: `upstreams.${i}`,
      name: t(u.name) || `Upstream ${i + 1}`,
      type: `Upstream (${u.method.replace('_', ' ')})`,
      disabled: !u.enabled,
      domain: '–',
      listen: '–',
      upstream: t(u.name),
      backends: u.servers.map((s) => `${t(s.address)}${s.port !== null ? `:${s.port}` : ''}${s.backup ? ' backup' : ''}${s.down ? ' down' : ''}${s.enabled ? '' : ' (off)'}`),
      output: entityFilePath(u, p.settings),
      counts: countsOf(issuesUnder(issues, `upstreams.${i}`)),
    });
  });
  return out;
}

export const overviewView = {
  id: 'overview',
  label: 'Overview',

  render(app, el) {
    const p = app.project;
    this.stats = h('div', { class: 'stats' });
    this.table = h('div', { class: 'table-wrap' });
    this.issues = h('div', { id: 'overview-issues' });
    this.filter = this.filter || 'all';

    const details = h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Project' }),
      grid(
        textField(app, ['project', 'name'], { label: 'Name', required: true, width: 'm', mono: false, onInput: () => app.sidebar.refresh() }),
        textField(app, ['project', 'environment'], { label: 'Environment', width: 's', mono: false, placeholder: 'production', options: ['production', 'dr', 'staging', 'development', 'test'] }),
      ),
      textareaField(app, ['project', 'description'], { label: 'Description', rows: 2, mono: false, placeholder: 'What this project configures. Written to the README and the manifest.' }));

    const empty = !p.servers.length && !p.upstreams.length;
    el.append(h('div', { class: 'scroll' }, h('div', { class: 'page' },
      details,
      empty ? h('section', { class: 'card empty' },
        h('h2', { text: 'Start building' }),
        h('p', { text: 'Add upstream groups for your backend servers, then a server configuration with locations that proxy to them. The preview on the right shows each file as you type.' }),
        h('div', { class: 'empty-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => app.switchTab('upstreams') }, icon('layers'), h('span', { text: 'Add upstream groups' })),
          h('button', { type: 'button', class: 'btn', onclick: () => app.switchTab('servers') }, icon('server'), h('span', { text: 'Add a server configuration' })),
          h('button', { type: 'button', class: 'btn', onclick: () => app.newSampleProject() }, icon('sample'), h('span', { text: 'Open the sample project' })))) : null,
      this.stats,
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Configuration',
          h('button', {
            type: 'button', class: 'btn btn-small card-title-action',
            onclick: () => { app.switchTab('import'); requestAnimationFrame(() => document.getElementById('routing-table')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); },
          }, icon('download'), h('span', { text: 'Endpoint table as image or CSV' }))),
        this.table),
      h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'Validation' }), this.issues),
      h('section', { class: 'card card-muted' },
        h('h2', { class: 'card-title', text: 'Before deploying' }),
        h('p', { text: 'These checks catch structural mistakes, conflicts and unsafe settings, but they do not prove that Nginx accepts the configuration: that depends on the modules, nginx.conf, certificates and folders on the server. Download the ZIP, follow its README, and run nginx -t on a compatible server before reloading.' })))));
    this.refresh(app);
  },

  refresh(app) {
    if (!this.table?.isConnected) return;
    const p = app.project;
    const b = app.build;
    const backends = p.upstreams.reduce((n, u) => n + u.servers.filter((s) => s.enabled).length, 0);
    const blocks = p.servers.reduce((n, c) => n + c.blocks.length, 0);
    replace(this.stats, [
      ['Server configurations', p.servers.length], ['Server blocks', blocks], ['Locations', countLocations(p)],
      ['Upstream groups', p.upstreams.length], ['Backend servers', backends], ['Generated files', b ? b.files.length : 0],
    ].map(([label, n]) => h('div', { class: 'stat' }, h('div', { class: 'stat-n', text: String(n) }), h('div', { class: 'stat-l', text: label }))));

    const data = rows(app);
    replace(this.table, data.length ? h('table', { class: 'table' },
      h('caption', { class: 'sr-only', text: 'Server blocks and upstream groups in this project' }),
      h('thead', {}, h('tr', {}, ['Name', 'Type', 'Domain', 'Listen', 'Upstream', 'Backend servers', 'Output path', 'Status'].map((c) => h('th', { scope: 'col', text: c })))),
      h('tbody', {}, data.map((r) => h('tr', { class: r.disabled ? 'row-disabled' : undefined },
        h('th', { scope: 'row' }, h('button', { type: 'button', class: 'link-button', onclick: () => app.navigate(r.path) }, r.name), r.disabled ? h('span', { class: 'chip chip-muted', text: 'off' }) : null),
        h('td', { text: r.type }),
        h('td', { class: 'mono', text: r.domain }),
        h('td', { class: 'mono', text: r.listen }),
        h('td', { class: 'mono', text: r.upstream }),
        h('td', { class: 'mono' }, r.backends.length ? r.backends.slice(0, 4).join(', ') + (r.backends.length > 4 ? ` +${r.backends.length - 4}` : '') : '–'),
        h('td', { class: 'mono', text: r.output }),
        h('td', {}, statusCell(r.counts)))))) : h('p', { class: 'empty-small', text: 'Nothing configured yet.' }));

    const issues = b ? b.issues : [];
    const c = b ? b.counts : { error: 0, warning: 0, info: 0 };
    const filters = [['all', `All (${issues.length})`], ['error', `Errors (${c.error})`], ['warning', `Warnings (${c.warning})`], ['info', `Notes (${c.info})`]];
    const shown = this.filter === 'all' ? issues : issues.filter((i) => i.level === this.filter);
    replace(this.issues,
      h('p', { class: 'validation-summary' },
        c.error ? h('strong', { class: 'text-error', text: `${c.error} error${c.error === 1 ? '' : 's'} block the ZIP download. ` }) : h('strong', { class: 'text-ok', text: 'No errors: the package can be downloaded. ' }),
        c.warning ? `${c.warning} warning${c.warning === 1 ? '' : 's'} should be reviewed. ` : '',
        c.info ? `${c.info} note${c.info === 1 ? '' : 's'} describe what the server needs.` : ''),
      h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter issues' }, filters.map(([k, label]) => h('button', {
        type: 'button', class: ['chip-button', this.filter === k && 'active'], 'aria-pressed': String(this.filter === k),
        onclick: () => { this.filter = k; this.refresh(app); },
      }, label))),
      issueList(shown.map((i) => ({ ...i, where: app.where(i) })), {
        onSelect: (i) => app.navigate(i.path),
        empty: h('p', { class: 'empty-small', text: this.filter === 'all' ? 'No issues found.' : 'None.' }),
      }));
  },
};
