// Import / Export tab: project YAML export, the endpoint routing table, YAML import with a review
// step, and the ZIP package.

import { h, icon, button, replace, fmtBytes } from '../dom.js';
import { textField, checkField, grid, note, staticField } from '../fields.js';
import { CodeView } from '../codeview.js';
import { confirmDialog, alertDialog, copyText, toast, readFileText } from '../dialogs.js';
import { parseProjectYaml, projectToYaml, MAX_IMPORT_BYTES } from '../../core/yaml-io.js';
import { projectFileNameFor, zipFileNameFor } from '../../core/package.js';
import { compareProjects } from '../../core/diff.js';
import { buildAll } from '../../core/build.js';
import { t } from '../../core/util.js';
import { routingTableCard } from './routing-table.js';

const state = { pending: null, pickNext: false };

function hiddenPicker(onFile) {
  const input = h('input', { type: 'file', accept: '.yml,.yaml,application/yaml,text/yaml,text/plain', class: 'offscreen', tabIndex: -1, 'aria-hidden': 'true' });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) onFile(f);
  });
  return input;
}

async function readAndParse(file) {
  try {
    const text = await readFileText(file, MAX_IMPORT_BYTES);
    return { name: file.name, result: parseProjectYaml(text) };
  } catch (e) {
    return { name: file.name, result: { ok: false, project: null, errors: [{ path: '', message: e.message }], warnings: [] } };
  }
}

function errorList(errors) {
  return h('ul', { class: 'error-list' }, errors.slice(0, 30).map((e) => h('li', {},
    e.path ? h('code', { text: e.path }) : null, e.path ? ' ' : null, e.message, e.line ? ` (line ${e.line})` : '')),
  errors.length > 30 ? h('li', { text: `…and ${errors.length - 30} more` }) : null);
}

function diffList(title, d) {
  const parts = [];
  if (d.added.length) parts.push(h('li', { class: 'diff-add' }, h('strong', { text: `+${d.added.length} added: ` }), d.added.join(', ')));
  if (d.removed.length) parts.push(h('li', { class: 'diff-del' }, h('strong', { text: `−${d.removed.length} removed: ` }), d.removed.join(', ')));
  if (d.changed.length) parts.push(h('li', { class: 'diff-chg' }, h('strong', { text: `~${d.changed.length} changed: ` }), d.changed.join(', ')));
  if (d.same.length) parts.push(h('li', { class: 'diff-same', text: `${d.same.length} unchanged` }));
  return h('div', { class: 'diff-group' }, h('h4', { text: title }), parts.length ? h('ul', { class: 'diff-list' }, parts) : h('p', { class: 'empty-small', text: 'None in either project.' }));
}

export const importExportView = {
  id: 'import',
  label: 'Import / Export',

  /** Opens the file picker of the import section (used by the toolbar button). */
  pick(app) {
    state.pickNext = true;
    if (app.tab === 'import' && this.picker?.isConnected) { state.pickNext = false; this.picker.click(); }
  },

  /** Picks a YAML file and imports it as a new project after a short check (sidebar, welcome page). */
  pickAsNew(app) {
    const input = hiddenPicker(async (file) => {
      input.remove();
      const { name, result } = await readAndParse(file);
      if (!result.ok) {
        await alertDialog({ title: `${name} was not imported`, message: 'The file is not a valid project file:', details: errorList(result.errors) });
        return;
      }
      app.addProject(result.project, { message: `Imported "${result.project.project.name}" from ${name}.` });
      if (result.warnings.length) toast(`${result.warnings.length} unknown field(s) in ${name} were ignored.`, 'warning', 6000);
    });
    document.body.append(input);
    input.click();
  },

  render(app, el) {
    const p = app.project;
    this.yamlView = new CodeView({ label: 'Project YAML' });
    this.pkgList = h('div', { class: 'pkg-list' });
    this.review = h('div', { class: 'review', 'aria-live': 'polite' });
    this.table = routingTableCard(app);
    this.picker = hiddenPicker(async (file) => {
      state.pending = await readAndParse(file);
      this.renderReview(app);
      this.review.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    const drop = h('div', { class: 'drop', tabIndex: 0, role: 'button', 'aria-label': 'Choose a YAML project file to import' },
      icon('upload', { size: 24 }),
      h('strong', { text: 'Drop a project YAML file here, or choose one' }),
      h('span', { class: 'hint', text: `.yml or .yaml, up to ${MAX_IMPORT_BYTES / 1024 / 1024} MB. The file is read in this browser only.` }));
    drop.addEventListener('click', () => this.picker.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.picker.click(); } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      state.pending = await readAndParse(f);
      this.renderReview(app);
    });

    const paste = h('textarea', { class: 'input textarea mono', rows: 5, placeholder: 'schemaVersion: 1\nproject:\n  name: …', spellcheck: false, 'aria-label': 'Paste project YAML', wrap: 'off' });
    const pasteBtn = button('Check pasted YAML', () => {
      state.pending = { name: 'pasted text', result: parseProjectYaml(paste.value) };
      this.renderReview(app);
    }, { icon: 'check' });

    el.append(h('div', { class: 'scroll' }, h('div', { class: 'page' },
      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Export project (YAML)' }),
        h('p', { text: 'Saves every server configuration, upstream group, setting and custom directive, so the project can be imported again here or kept in version control. Exporting is always possible, even with errors.' }),
        grid(
          textField(app, ['settings', 'package', 'projectFileName'], { label: 'File name', width: 'm', placeholder: projectFileNameFor({ ...p, settings: { ...p.settings, package: { ...p.settings.package, projectFileName: '' } } }), hint: 'Also the name of the project file inside the ZIP.' }),
          h('div', { class: 'field w-l field-button' },
            button('Download YAML', () => app.exportYaml(), { icon: 'download', kind: 'primary' }),
            button('Copy YAML', async () => { const ok = await copyText(projectToYaml(app.project)); toast(ok ? 'Copied the project YAML.' : 'Copy failed.', ok ? 'success' : 'error'); }, { icon: 'copy' }))),
        h('details', { class: 'section' }, h('summary', { class: 'section-summary' }, h('h3', { class: 'section-title', text: 'Show the YAML' })), h('div', { class: 'section-body' }, this.yamlView.el))),

      this.table.el,

      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Import project (YAML)' }),
        h('p', { text: 'The file is checked first, and you can review the differences before anything changes. Imported content is treated as data only.' }),
        drop, this.picker,
        h('details', { class: 'section' }, h('summary', { class: 'section-summary' }, h('h3', { class: 'section-title', text: 'Or paste YAML' })),
          h('div', { class: 'section-body' }, paste, h('div', { class: 'row-buttons' }, pasteBtn))),
        this.review),

      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Configuration package (ZIP)' }),
        h('p', { text: 'All generated files with their folders, the project YAML, a manifest with checksums and a README with installation and nginx -t instructions. Certificates, keys, passwords and app files are never included.' }),
        grid(
          textField(app, ['settings', 'package', 'zipFileName'], { label: 'ZIP file name', width: 'm', placeholder: zipFileNameFor({ ...p, settings: { ...p.settings, package: { ...p.settings.package, zipFileName: '' } } }) }),
          textField(app, ['settings', 'package', 'rootFolder'], { label: 'Folder inside the ZIP', width: 's', placeholder: 'none (files at the top)' }),
          checkField(app, ['settings', 'package', 'includeDisabled'], { label: 'Include turned-off files (in disabled/ folders)', width: 'm', rerender: true }),
          checkField(app, ['settings', 'package', 'includeProjectFile'], { label: 'Include the project YAML', width: 'm', rerender: true }),
        ),
        h('div', { class: 'row-buttons' }, button('Download ZIP', () => app.downloadZip(), { icon: 'download', kind: 'primary' })),
        this.pkgList))));

    this.refresh(app);
    this.renderReview(app);
    if (state.pickNext) { state.pickNext = false; setTimeout(() => this.picker.click(), 0); }
  },

  refresh(app) {
    if (!this.yamlView || !this.pkgList?.isConnected) return;
    this.yamlView.update(projectToYaml(app.project), [], { language: 'yaml' });
    this.table.refresh();
    this.packageReady(app);
  },

  packageReady(app) {
    if (!this.pkgList?.isConnected) return;
    const pkg = app.pkg && app.pkgFor === app.build ? app.pkg : null;
    if (!pkg) { replace(this.pkgList, h('p', { class: 'empty-small', text: 'Preparing the package…' })); return; }
    const enc = new TextEncoder();
    const root = pkg.rootFolder;
    replace(this.pkgList, h('table', { class: 'table table-compact' },
      h('caption', { class: 'sr-only', text: 'Files in the package' }),
      h('thead', {}, h('tr', {}, ['File', 'Size', 'Status', ''].map((c) => h('th', { scope: 'col', text: c })))),
      h('tbody', {}, pkg.entries.map((e) => {
        const c = e.file?.counts || { error: 0, warning: 0 };
        return h('tr', {},
          h('td', { class: 'mono', text: root ? `${root}/${e.path}` : e.path }),
          h('td', { text: fmtBytes(enc.encode(e.content).length) }),
          h('td', {}, c.error ? h('span', { class: 'text-error', text: `${c.error} error(s)` }) : c.warning ? h('span', { class: 'text-warning', text: `${c.warning} warning(s)` }) : h('span', { class: 'text-muted', text: e.file && e.file.enabled === false ? 'turned off' : 'OK' })),
          h('td', {}, h('button', { type: 'button', class: 'btn btn-small', disabled: c.error > 0, onclick: () => app.downloadFile(e.path), 'aria-label': `Download ${e.path}` }, icon('download'), h('span', { text: 'Download' }))));
      }))));
  },

  renderReview(app) {
    if (!this.review?.isConnected) return;
    const pending = state.pending;
    if (!pending) { replace(this.review); return; }
    const { name, result } = pending;
    const close = button('Discard', () => { state.pending = null; this.renderReview(app); }, { icon: 'x' });
    if (!result.ok) {
      replace(this.review, h('div', { class: 'review-box review-error', role: 'alert' },
        h('h3', {}, icon('error'), ` ${name} cannot be imported`),
        h('p', { text: 'Nothing was changed. Fix these problems in the file and try again:' }),
        errorList(result.errors),
        h('div', { class: 'row-buttons' }, close)));
      return;
    }
    const incoming = result.project;
    const incomingBuild = buildAll(incoming);
    const diff = compareProjects(app.project, incoming, { currentBuild: app.build, incomingBuild });
    const ic = incomingBuild.counts;
    replace(this.review, h('div', { class: 'review-box' },
      h('h3', {}, icon('check'), ` ${name} is a valid project file`),
      grid(
        staticField('Project', t(incoming.project.name), { mono: false }),
        staticField('Environment', t(incoming.project.environment) || '–', { mono: false, width: 's' }),
        staticField('Contents', `${incoming.servers.length} server configuration(s), ${incoming.upstreams.length} upstream group(s), ${incomingBuild.files.length} file(s)`, { mono: false, width: 'l' }),
        staticField('Validation', `${ic.error} error(s), ${ic.warning} warning(s)`, { mono: false })),
      t(incoming.project.description) ? h('p', { class: 'hint', text: t(incoming.project.description) }) : null,
      result.warnings.length ? note(h('div', {}, `${result.warnings.length} field(s) are not part of schema version 1 and will be ignored: `, result.warnings.slice(0, 10).map((w) => w.path).join(', '), result.warnings.length > 10 ? ', …' : ''), 'warning') : null,
      ic.error ? note('The imported project has validation errors. You can import it and fix them here, but the ZIP stays blocked until they are fixed.', 'warning') : null,
      h('h4', { text: `Compared with the current project "${t(app.project.project.name)}"` }),
      h('div', { class: 'diff' },
        diffList('Server configurations', diff.servers),
        diffList('Upstream groups', diff.upstreams),
        diffList('Generated files', diff.files)),
      h('p', { class: 'hint', text: `${diff.settingsChanged ? 'Settings differ.' : 'Settings are the same.'} ${diff.projectChanged ? 'Project details differ.' : ''}` }),
      h('div', { class: 'row-buttons' },
        button('Replace current project', async () => {
          const ok = await confirmDialog({
            title: `Replace "${t(app.project.project.name)}"?`,
            message: 'Its servers, upstreams and settings are replaced by the imported project. Export the current project first if you may need it.',
            confirmLabel: 'Replace project', danger: true,
          });
          if (!ok) return;
          app.replaceActiveProject(incoming);
          state.pending = null;
          toast(`Imported ${name} into the current project.`, 'success');
          app.switchTab('overview');
        }, { icon: 'upload', kind: 'danger' }),
        button('Import as a new project', () => {
          state.pending = null;
          app.addProject(incoming, { message: `Imported "${t(incoming.project.name)}" as a new project.` });
        }, { icon: 'plus', kind: 'primary' }),
        close)));
  },
};
