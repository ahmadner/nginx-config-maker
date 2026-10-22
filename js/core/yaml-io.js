// YAML project files: parsing with js-yaml (pinned, vendored) and the schema checks in schema.js.

import yaml from '../../vendor/js-yaml@4.1.1/js-yaml.mjs';
import { compactProject, normalizeProject, SCHEMA_VERSION } from './schema.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const HEADER = `# Nginx Config Generator project file (schema version ${SCHEMA_VERSION}).
# Import it in the app to restore every server, upstream group and setting.
`;

/** Serializes a project to YAML text. */
export function projectToYaml(project) {
  return HEADER + yaml.dump(compactProject(project), {
    noRefs: true, // never emit anchors/aliases
    lineWidth: 120,
    sortKeys: false,
    quotingType: "'",
  });
}

/**
 * Parses and checks a YAML project file.
 * Returns { ok, project, errors: [{path, message, line?}], warnings: [{path, message}] }.
 * Imported text is treated as data only: js-yaml's default schema has no executable types, and the
 * schema copies known fields into fresh objects.
 */
export function parseProjectYaml(text) {
  if (typeof text !== 'string') return failure('The file could not be read as text.');
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_IMPORT_BYTES) return failure(`The file is ${Math.round(bytes / 1024)} KB; the limit is ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  if (!text.trim()) return failure('The file is empty.');
  let docs;
  try {
    docs = yaml.loadAll(text.replace(/^﻿/, ''), null, { json: false });
  } catch (e) {
    const line = e && e.mark ? e.mark.line + 1 : undefined;
    const reason = e && e.reason ? e.reason : String(e && e.message ? e.message : e).split('\n')[0];
    return failure(`YAML syntax error${line ? ` on line ${line}` : ''}: ${reason}`, line);
  }
  docs = docs.filter((d) => d !== null && d !== undefined);
  if (docs.length === 0) return failure('The file contains no YAML document.');
  if (docs.length > 1) return failure('The file contains more than one YAML document (---). Import one project at a time.');
  const { project, errors, warnings } = normalizeProject(docs[0]);
  return { ok: errors.length === 0, project, errors, warnings };
}

function failure(message, line) {
  return { ok: false, project: null, errors: [{ path: '', message, line }], warnings: [] };
}
