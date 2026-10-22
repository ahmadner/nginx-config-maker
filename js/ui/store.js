// Projects kept in browser storage. Storage is injected so the store can be tested without a browser.
// Each project is saved in full (with internal ids) and normalized again on load, so drafts written by an
// older version of the app are upgraded the same way imported YAML is.

import { normalizeProject, SCHEMA_VERSION } from '../core/schema.js';
import { newProject } from '../core/model.js';
import { clone, copyName, uid } from '../core/util.js';

export const STORAGE_KEY = 'nginx-config-generator.projects.v1';
export const PREFS_KEY = 'nginx-config-generator.prefs.v1';

/** localStorage when it works (it can throw in private windows or with blocked site data), else memory. */
export function browserStorage() {
  try {
    const ls = globalThis.localStorage;
    const probe = '__ncg_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { storage: ls, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

export class ProjectStore {
  constructor(storage) {
    this.storage = storage;
    this.projects = []; // [{ id, updatedAt, project }]
    this.activeId = null;
    this.loadWarnings = [];
    this.saveError = null;
    this.lastSavedAt = null;
  }

  load() {
    let raw = null;
    try {
      raw = JSON.parse(this.storage.getItem(STORAGE_KEY) || 'null');
    } catch {
      this.loadWarnings.push('Saved projects could not be read and were ignored.');
    }
    this.projects = [];
    if (raw && Array.isArray(raw.projects)) {
      for (const entry of raw.projects) {
        if (!entry || typeof entry.id !== 'string') continue;
        const { project, errors } = normalizeProject(entry.data, { keepIds: true });
        if (!project) {
          this.loadWarnings.push(`A saved project could not be restored: ${errors[0] ? `${errors[0].path} ${errors[0].message}` : 'invalid data'}.`);
          continue;
        }
        this.projects.push({ id: entry.id, updatedAt: entry.updatedAt || null, project });
      }
      this.activeId = this.projects.some((p) => p.id === raw.activeId) ? raw.activeId : this.projects[0]?.id ?? null;
    }
    return this;
  }

  save() {
    const data = {
      version: 1,
      activeId: this.activeId,
      projects: this.projects.map((p) => ({ id: p.id, updatedAt: p.updatedAt, data: { schemaVersion: SCHEMA_VERSION, ...p.project } })),
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.saveError = null;
      this.lastSavedAt = new Date();
      return true;
    } catch (e) {
      this.saveError = e && e.name === 'QuotaExceededError' ? 'Browser storage is full.' : 'Browser storage is not available.';
      return false;
    }
  }

  get active() {
    return this.projects.find((p) => p.id === this.activeId) || null;
  }

  get(id) {
    return this.projects.find((p) => p.id === id) || null;
  }

  touch(id = this.activeId) {
    const entry = this.get(id);
    if (entry) entry.updatedAt = new Date().toISOString();
  }

  /** Adds a project (a new empty one when none is given) and makes it active. */
  add(project = newProject('New project')) {
    const entry = { id: uid('prj'), updatedAt: new Date().toISOString(), project };
    this.projects.push(entry);
    this.activeId = entry.id;
    this.save();
    return entry;
  }

  setActive(id) {
    if (!this.get(id)) return false;
    this.activeId = id;
    this.save();
    return true;
  }

  rename(id, name) {
    const entry = this.get(id);
    if (!entry || !String(name).trim()) return false;
    entry.project.project.name = String(name).trim();
    this.touch(id);
    this.save();
    return true;
  }

  duplicate(id) {
    const entry = this.get(id);
    if (!entry) return null;
    const { project } = normalizeProject({ schemaVersion: SCHEMA_VERSION, ...clone(entry.project) });
    project.project.name = copyName(entry.project.project.name, this.projects.map((p) => p.project.project.name));
    const copy = { id: uid('prj'), updatedAt: new Date().toISOString(), project };
    this.projects.splice(this.projects.indexOf(entry) + 1, 0, copy);
    this.activeId = copy.id;
    this.save();
    return copy;
  }

  remove(id) {
    const index = this.projects.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.projects.splice(index, 1);
    if (this.activeId === id) this.activeId = this.projects[Math.min(index, this.projects.length - 1)]?.id ?? null;
    this.save();
    return true;
  }

  /** Replaces a project's content (import "replace current project"), keeping its place in the list. */
  replace(id, project) {
    const entry = this.get(id);
    if (!entry) return false;
    entry.project = project;
    this.touch(id);
    this.save();
    return true;
  }
}

export function loadPrefs(storage) {
  try {
    const p = JSON.parse(storage.getItem(PREFS_KEY) || 'null');
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export function savePrefs(storage, prefs) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}
