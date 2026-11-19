// Project model: a pool of VT objects keyed by ID plus settings. Objects are plain data:
// { id, type, name, ...attributes } with the attribute names of src/iso/schema.js.
import { TYPES, NONE } from './iso/schema.js';
import { forEachRef } from './iso/codec.js';
import { upgradeV1Command } from './iso/macros.js';

/** File format version of saved projects (2: macro command codes per ISO 11783-6). */
export const PROJECT_VERSION = 2;

export const DEFAULT_SETTINGS = {
  dmSize: 480, // data mask: width = height (pixels), from Get Hardware
  skWidth: 60, // soft key designator (also the Working Set designator)
  skHeight: 60,
  skCount: 6, // physical soft keys next to the data mask
  vtVersion: 3,
  grid: 5,
};

export const DEFAULT_EXPORT = { tiaDb: 'VT_Pool', ioDb: 'VT_Io', codesysGvl: 'GVL_VtPool', chunkMax: 1784 };

/** Initial attribute values that differ from the schema defaults. */
const INITIAL = {
  0: { languages: ['en'] },
  8: { value: '', length: 16 },
  11: { value: 'Tekst', length: 16 },
  16: { points: [{ x: 0, y: 60 }, { x: 40, y: 0 }, { x: 80, y: 60 }] },
  22: { value: '', length: 16 },
  26: { validationString: '0123456789' },
};

export function defaultsOf(type) {
  const o = {};
  for (const f of TYPES[type].fields) {
    if (f.k === 'count') continue;
    if (['children', 'macros', 'idlist', 'langs', 'points', 'macrocmds'].includes(f.k)) o[f.n] = [];
    else if (f.k === 'string') { o[f.n] = ''; if (f.fixed) o.length = 0; }
    else if (f.k === 'picdata') o.pixels = 'AA==';
    else o[f.n] = f.def;
  }
  return { ...o, ...structuredCloneSafe(INITIAL[type] || {}) };
}

const structuredCloneSafe = (o) => JSON.parse(JSON.stringify(o));
export const clone = structuredCloneSafe;

/** A valid PLC identifier made from any text. */
export function sanitizeName(s) {
  let n = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!n || /^[0-9]/.test(n)) n = 'O_' + n;
  return n.slice(0, 60);
}

export function uniqueName(p, base, exceptId) {
  const taken = new Set(Object.values(p.objects).filter((o) => o.id !== exceptId).map((o) => o.name.toLowerCase()));
  const b = sanitizeName(base);
  if (!taken.has(b.toLowerCase())) return b;
  for (let i = 2; ; i++) if (!taken.has(`${b}_${i}`.toLowerCase())) return `${b}_${i}`;
}

/** Next free ID: type × 1000 upwards (Working Set 0), macros 0–255 (macros are referenced with 1 byte). */
export function nextId(p, type) {
  const free = (i) => !p.objects[i];
  if (type === 28) {
    for (let i = 1; i < 256; i++) if (free(i)) return i; // 0 stays free for the Working Set
    if (free(0)) return 0;
    throw new Error('alle 256 macro-ID\'s zijn in gebruik');
  }
  for (let i = type * 1000; i < 65535; i++) if (free(i)) return i;
  for (let i = 1; i < 65535; i++) if (free(i)) return i;
  throw new Error('geen vrije object-ID meer');
}

/** Creates an object with default attributes; required references (font, line) get an existing or new object. */
export function addObject(p, type, attrs = {}) {
  const obj = { id: 0, type, name: '', ...defaultsOf(type), ...attrs };
  obj.id = attrs.id ?? nextId(p, type);
  obj.name = uniqueName(p, attrs.name || `${TYPES[type].prefix}_${obj.id}`);
  p.objects[obj.id] = obj;
  for (const f of TYPES[type].fields) {
    if (f.k === 'ref' && f.auto && obj[f.n] === NONE) obj[f.n] = firstOrNew(p, f.auto).id;
  }
  return obj;
}

export function firstOrNew(p, type) {
  return Object.values(p.objects).filter((o) => o.type === type).sort((a, b) => a.id - b.id)[0] || addObject(p, type);
}

export const objectsOfType = (p, types) =>
  Object.values(p.objects).filter((o) => !types || types.includes(o.type)).sort((a, b) => a.id - b.id);

export const label = (o) => (o ? `${o.name} (${o.id})` : '—');

/** Everything that refers to object `id`: [{obj, kind}] (kind = attribute name, 'children' or 'macros'). */
export function refsTo(p, id) {
  const out = [];
  for (const o of Object.values(p.objects)) {
    forEachRef(o, (v, kind) => { if (v === id) out.push({ obj: o, kind }); });
    if (p.objects[id]?.type === 28 && (o.macros || []).some((m) => m.macro === id)) out.push({ obj: o, kind: 'macros' });
  }
  return out;
}

/** Parents that place `id` as a child: [{parent, index}]. */
export function placementsOf(p, id) {
  const out = [];
  for (const o of Object.values(p.objects)) (o.children || []).forEach((c, index) => { if (c.id === id) out.push({ parent: o, index }); });
  return out;
}

/** Removes an object and every reference to it. */
export function deleteObject(p, id) {
  const gone = p.objects[id];
  if (!gone) return;
  for (const o of Object.values(p.objects)) {
    if (o.children) o.children = o.children.filter((c) => c.id !== id);
    if (o.keys) o.keys = o.keys.filter((k) => k !== id);
    if (o.items) o.items = o.items.map((k) => (k === id ? NONE : k));
    if (gone.type === 28 && o.macros) o.macros = o.macros.filter((m) => m.macro !== id);
    forEachRef(o, (v, kind, set, f) => { if (v === id && f.k === 'ref') set(NONE); });
  }
  delete p.objects[id];
}

/** Gives an object another ID and updates all references. Returns an error text or null. */
export function renumber(p, oldId, newId) {
  newId = Number(newId);
  if (!Number.isInteger(newId) || newId < 0 || newId > 65534) return 'Een ID ligt tussen 0 en 65534.';
  if (newId === oldId) return null;
  if (p.objects[newId]) return `ID ${newId} is al in gebruik door ${label(p.objects[newId])}.`;
  const obj = p.objects[oldId];
  if (obj.type === 28 && newId > 255) return 'Macro\'s hebben een ID van 0 tot 255 (ze worden met 1 byte aangeduid).';
  for (const o of Object.values(p.objects)) {
    forEachRef(o, (v, kind, set) => { if (v === oldId) set(newId); });
    if (obj.type === 28) for (const m of o.macros || []) if (m.macro === oldId) m.macro = newId;
  }
  delete p.objects[oldId];
  obj.id = newId;
  p.objects[newId] = obj;
  return null;
}

/** Copies an object (with `deep`: also its children, except shared attribute objects). Returns the copy. */
export function duplicate(p, id, deep = true) {
  const src = p.objects[id];
  const copy = clone(src);
  delete copy.id;
  copy.name = src.name + '_kopie';
  const obj = addObject(p, src.type, copy);
  if (deep && obj.children) obj.children = obj.children.map((c) => ({ ...c, id: p.objects[c.id] ? duplicate(p, c.id, true).id : c.id }));
  return obj;
}

/** Size of an object on screen [w, h] (pixels). */
export function sizeOf(p, obj, depth = 0) {
  const s = p.settings;
  if (!obj) return [0, 0];
  switch (obj.type) {
    case 0: case 5: return [s.skWidth, s.skHeight];
    case 1: case 2: return [s.dmSize, s.dmSize];
    case 4: return [s.skWidth, s.skHeight * Math.max(s.skCount, obj.keys.length)];
    case 7: case 17: return [obj.width, obj.width];
    case 20: return [obj.width, obj.actualWidth ? Math.round((obj.actualHeight * obj.width) / obj.actualWidth) : 0];
    case 27: return depth < 8 ? sizeOf(p, p.objects[obj.value], depth + 1) : [0, 0];
    default: return [obj.width ?? 0, obj.height ?? 0];
  }
}

/** Fills in missing settings and attributes (older files, imported pools). */
export function normalizeProject(p) {
  // version 1 → 2: macro command codes 0xA3–0xB2 corrected to ISO 11783-6 (they were one too high)
  if (p.version === 1) {
    for (const o of Object.values(p.objects || {})) {
      if (o?.type === 28 && Array.isArray(o.commands)) o.commands = o.commands.map(upgradeV1Command);
    }
  }
  p.format = 'vt-designer';
  p.version = PROJECT_VERSION;
  p.name = p.name || 'Nieuw project';
  p.settings = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
  p.export = { ...DEFAULT_EXPORT, ...(p.export || {}) };
  p.objects = p.objects || {};
  for (const [k, o] of Object.entries(p.objects)) {
    if (!TYPES[o.type]) { delete p.objects[k]; continue; }
    const d = defaultsOf(o.type);
    for (const [a, v] of Object.entries(d)) if (o[a] === undefined) o[a] = v;
    if (!o.name) o.name = uniqueName(p, `${TYPES[o.type].prefix}_${o.id}`, o.id);
  }
  return p;
}

/** Project from parsed pool objects. */
export function projectFromObjects(objects, name = 'Geïmporteerde pool') {
  const p = normalizeProject({ name, objects: {} });
  for (const o of objects) p.objects[o.id] = o;
  for (const o of objects) o.name = uniqueName(p, o.name || `${TYPES[o.type].prefix}_${o.id}`, o.id);
  return normalizeProject(p);
}

/** New project: the VT test pool of vt_test_project (one screen with one text). */
export function newProject(name = 'Nieuw project') {
  const p = normalizeProject({ name, objects: {} });
  const add = (type, attrs) => addObject(p, type, attrs);
  add(23, { id: 23000, name: 'Font12x16', fontColour: 0, fontSize: 3 });
  add(23, { id: 23001, name: 'Font8x12', fontColour: 0, fontSize: 2 });
  add(11, { id: 11000, name: 'Hoofdtekst', width: 400, height: 40, bgColour: 1, fontAttributes: 23000, justification: 1, value: 'Hallo vanuit S7-1500', length: 32 });
  add(11, { id: 11001, name: 'Designator', width: 60, height: 32, bgColour: 1, fontAttributes: 23001, justification: 1, value: 'S7 VT', length: 5 });
  add(1, { id: 1000, name: 'Hoofdscherm', bgColour: 1, children: [{ id: 11000, x: 20, y: 40 }] });
  add(0, { id: 0, name: 'Werkset', bgColour: 1, selectable: 1, activeMask: 1000, children: [{ id: 11001, x: 0, y: 0 }], languages: ['en'] });
  return p;
}

/** Placement path from page `rootId` to object `id` ([] for the root itself), or null when it is not on that page. */
export function findPath(p, rootId, id) {
  const O = p.objects;
  if (rootId === id) return [];
  const seen = new Set();
  const walk = (o, path) => {
    if (!o || seen.has(o.id)) return null;
    seen.add(o.id);
    if (o.type === 27) return walk(O[o.value], path);
    const list = o.type === 4 ? o.keys.map((k) => ({ id: k })) : o.children || [];
    for (let i = 0; i < list.length; i++) {
      const pth = [...path, [o.id, i]];
      if (list[i].id === id) return pth;
      const r = walk(O[list[i].id], pth);
      if (r) return r;
    }
    return null;
  };
  return walk(O[rootId], []);
}
