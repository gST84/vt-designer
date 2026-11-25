// ISO 11783-10 device descriptor object pool (DDOP): the description of an implement that a TC client
// sends to the task controller. Binary form as in TC version 3 (little-endian, Latin-1 strings), which
// every TC of version 3 or later accepts.
//
//   DVC device                 table, id, designator, software version, NAME (8), serial number,
//                              structure label (7), localization label (7)
//   DET device element         table, id, type, designator, element number, parent id, child ids
//   DPD device process data    table, id, DDI, properties, trigger methods, designator, presentation id
//   DPT device property        table, id, DDI, value (int32), designator, presentation id
//   DVP value presentation     table, id, offset (int32), scale (float32), decimals, unit designator

import { latin1 } from '../iso/codec.js';

export const NONE = 0xffff;

/** Device element types. */
export const DET_TYPES = [[1, 'Toestel'], [2, 'Functie'], [3, 'Bak / product'], [4, 'Sectie'], [5, 'Eenheid'], [6, 'Koppeling'], [7, 'Navigatiereferentie']];

/** DPD properties (bits). */
export const PROP = { defaultSet: 1, settable: 2 };
/** DPD trigger methods (bits). */
export const TRIG = { time: 1, distance: 2, threshold: 4, change: 8, total: 16 };

/** Longest designator a version 3 TC accepts. */
export const MAX_DESIGNATOR = 32;

class Writer {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  i32(v) { this.u16(v); this.u16(v >> 16); }
  f32(v) { const a = new DataView(new ArrayBuffer(4)); a.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.u8(a.getUint8(i)); }
  bytes(a) { for (const x of a) this.u8(x); }
  text(s) { const t = latin1(s); this.u8(t.length); this.bytes(t); }
  table(t) { this.bytes([...t].map((c) => c.charCodeAt(0))); }
}

/** Seven bytes of a label: characters, padded with spaces (or the given bytes as they are). */
export const label7 = (v) => (Array.isArray(v) ? v.slice(0, 7) : latin1(String(v ?? '').padEnd(7, ' ').slice(0, 7)));

export function encodeObject(o) {
  const w = new Writer();
  w.table(o.table);
  w.u16(o.id);
  switch (o.table) {
    case 'DVC':
      w.text(o.designator); w.text(o.softwareVersion); w.bytes(o.name);
      w.text(o.serial); w.bytes(label7(o.structureLabel)); w.bytes(label7(o.localization));
      break;
    case 'DET':
      w.u8(o.type); w.text(o.designator); w.u16(o.number); w.u16(o.parent);
      w.u16(o.children.length); for (const c of o.children) w.u16(c);
      break;
    case 'DPD':
      w.u16(o.ddi); w.u8(o.props); w.u8(o.triggers); w.text(o.designator); w.u16(o.presentation ?? NONE);
      break;
    case 'DPT':
      w.u16(o.ddi); w.i32(o.value); w.text(o.designator); w.u16(o.presentation ?? NONE);
      break;
    case 'DVP':
      w.i32(o.offset); w.f32(o.scale); w.u8(o.decimals); w.text(o.unit);
      break;
    default:
      throw new Error(`Onbekend DDOP-object ${o.table}`);
  }
  return Uint8Array.from(w.b);
}

/** Bytes of the whole pool and where each object starts. */
export function encodeDdop(objects) {
  const entries = [];
  const parts = [];
  let at = 0;
  for (const o of objects) {
    const b = encodeObject(o);
    entries.push({ obj: o, start: at, length: b.length });
    parts.push(b);
    at += b.length;
  }
  const bytes = new Uint8Array(at);
  let p = 0;
  for (const b of parts) { bytes.set(b, p); p += b.length; }
  return { bytes, entries };
}

/** Objects from pool bytes (throws on malformed data). */
export function parseDdop(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let p = 0;
  const need = (n) => { if (p + n > b.length) throw new Error(`DDOP afgebroken bij byte ${p}`); };
  const u8 = () => { need(1); return b[p++]; };
  const u16 = () => u8() | (u8() << 8);
  const i32 = () => (u16() | (u16() << 16)) | 0;
  const f32 = () => { need(4); const v = new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; };
  const raw = (n) => { need(n); const r = Array.from(b.slice(p, p + n)); p += n; return r; };
  const text = () => String.fromCharCode(...raw(u8()));
  const out = [];
  while (p < b.length) {
    const table = String.fromCharCode(...raw(3));
    const id = u16();
    switch (table) {
      case 'DVC': {
        const designator = text(), softwareVersion = text(), name = raw(8), serial = text();
        out.push({ table, id, designator, softwareVersion, name, serial, structureLabel: raw(7), localization: raw(7) });
        break;
      }
      case 'DET': {
        const type = u8(), designator = text(), number = u16(), parent = u16(), n = u16();
        const children = [];
        for (let i = 0; i < n; i++) children.push(u16());
        out.push({ table, id, type, designator, number, parent, children });
        break;
      }
      case 'DPD': out.push({ table, id, ddi: u16(), props: u8(), triggers: u8(), designator: text(), presentation: u16() }); break;
      case 'DPT': out.push({ table, id, ddi: u16(), value: i32(), designator: text(), presentation: u16() }); break;
      case 'DVP': out.push({ table, id, offset: i32(), scale: f32(), decimals: u8(), unit: text() }); break;
      default: throw new Error(`Onbekend DDOP-object "${table}" bij byte ${p - 5}`);
    }
  }
  return out;
}

/** Structural checks of a pool: [{ id, text }] (empty = valid). */
export function checkDdop(objects) {
  const errs = [];
  const byId = new Map();
  for (const o of objects) {
    if (byId.has(o.id)) errs.push({ id: o.id, text: `Object-ID ${o.id} komt twee keer voor.` });
    byId.set(o.id, o);
  }
  const dvc = objects.filter((o) => o.table === 'DVC');
  if (dvc.length !== 1) errs.push({ id: null, text: `Een DDOP heeft precies één toestel (DVC), er zijn er ${dvc.length}.` });
  const numbers = new Set();
  for (const o of objects) {
    for (const k of ['designator', 'unit', 'softwareVersion', 'serial']) {
      if (o[k] !== undefined && latin1(o[k]).length > MAX_DESIGNATOR) errs.push({ id: o.id, text: `${k} is langer dan ${MAX_DESIGNATOR} tekens.` });
    }
    if (o.table === 'DET') {
      if (numbers.has(o.number)) errs.push({ id: o.id, text: `Elementnummer ${o.number} komt twee keer voor.` });
      numbers.add(o.number);
      if (o.number > 4095) errs.push({ id: o.id, text: 'Elementnummer groter dan 4095.' });
      const parent = byId.get(o.parent);
      if (!parent || (parent.table !== 'DET' && parent.table !== 'DVC')) errs.push({ id: o.id, text: `Ouder ${o.parent} bestaat niet.` });
      if (o.type === 1 && parent?.table !== 'DVC') errs.push({ id: o.id, text: 'Het element van type toestel hangt onder de DVC.' });
      for (const c of o.children) {
        const t = byId.get(c)?.table;
        if (t !== 'DPD' && t !== 'DPT') errs.push({ id: o.id, text: `Kind ${c} is geen procesdata of eigenschap.` });
      }
    }
    if ((o.table === 'DPD' || o.table === 'DPT') && o.presentation !== NONE && byId.get(o.presentation)?.table !== 'DVP') {
      errs.push({ id: o.id, text: `Weergave ${o.presentation} bestaat niet.` });
    }
  }
  if (!objects.some((o) => o.table === 'DET' && o.type === 1)) errs.push({ id: null, text: 'Er is geen element van type toestel.' });
  return errs;
}
