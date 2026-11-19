// Object pool ⇄ bytes. The encoder and the parser both walk the field list of each type
// (src/iso/schema.js), so a type defined there is supported in both directions.
import { TYPES, NONE } from './schema.js';
import { pictureRaw, pixelsFromRaw, b64enc } from './picture.js';
import { joinCommands, splitCommands } from './macros.js';

/** Largest Object Pool Transfer that fits one TP transfer: 1785 bytes minus the command byte. */
export const TP_MAX = 1784;

class Writer {
  constructor() { this.a = []; }
  u8(v) { this.a.push(Number(v) & 255); }
  u16(v) { v = Number(v) & 0xffff; this.u8(v); this.u8(v >> 8); }
  u32(v) { v = Number(v) >>> 0; this.u16(v & 0xffff); this.u16(v >>> 16); }
  f32(v) {
    const d = new DataView(new ArrayBuffer(4));
    d.setFloat32(0, Number(v), true);
    for (let i = 0; i < 4; i++) this.u8(d.getUint8(i));
  }
  n(v, size) { if (size === 1) this.u8(v); else if (size === 2) this.u16(v); else this.u32(v); }
  bytes(b) { for (const x of b) this.u8(x); }
}

class Reader {
  constructor(b) { this.b = b; this.p = 0; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  need(n) { if (this.p + n > this.b.length) throw new Error(`pool eindigt te vroeg (offset ${this.p}, nog ${n} bytes nodig)`); }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16() { this.need(2); const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  n(size) { return size === 1 ? this.u8() : size === 2 ? this.u16() : this.u32(); }
  bytes(n) { this.need(n); const v = this.b.slice(this.p, this.p + n); this.p += n; return v; }
}

/** ISO 8859-1 bytes of a string (other characters become '?'). */
export const latin1 = (s) => [...String(s ?? '')].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
const fromLatin1 = (b) => String.fromCharCode(...b);
/** The value of a fixed-length string as sent: padded with spaces or cut off. */
export const fixedString = (s, len) => String(s ?? '').slice(0, len).padEnd(len, ' ');

/** Encodes one object. */
export function encodeObject(obj) {
  const def = TYPES[obj.type];
  if (!def) throw new Error(`objecttype ${obj.type} wordt niet ondersteund`);
  const w = new Writer();
  w.u16(obj.id);
  w.u8(obj.type);
  const raw = obj.type === 20 ? pictureRaw(obj) : null;
  const cmds = obj.type === 28 ? joinCommands(obj.commands) : null;
  const countOf = (n) => (n === '$raw' ? raw.length : n === 'commands' ? cmds.length : (obj[n] || []).length);
  for (const f of def.fields) {
    const v = obj[f.n] ?? f.def;
    switch (f.k) {
      case 'u8': case 'colour': case 'enum': case 'bits': case 'just': w.u8(v); break;
      case 'bool': w.u8(v ? 1 : 0); break;
      case 'u16': case 'ref': w.u16(v); break;
      case 'u32': case 'i32': w.u32(v); break;
      case 'f32': w.f32(v); break;
      case 'count': w.n(countOf(f.of), f.size); break;
      case 'children': for (const c of obj.children || []) { w.u16(c.id); w.u16(c.x); w.u16(c.y); } break;
      case 'macros': for (const m of obj.macros || []) { w.u8(m.event); w.u8(m.macro); } break;
      case 'idlist': for (const id of obj[f.n] || []) w.u16(id); break;
      case 'langs': for (const l of obj.languages || []) w.bytes(latin1(String(l).padEnd(2, ' ').slice(0, 2))); break;
      case 'points': for (const p of obj.points || []) { w.u16(p.x); w.u16(p.y); } break;
      case 'string': {
        const s = latin1(f.fixed ? fixedString(v, obj.length ?? 0) : v);
        w.n(s.length, f.lenSize);
        w.bytes(s);
        break;
      }
      case 'picdata': w.bytes(raw); break;
      case 'macrocmds': w.bytes(cmds); break;
      default: throw new Error('onbekend veldtype ' + f.k);
    }
  }
  return Uint8Array.from(w.a);
}

/** Objects in pool order: the Working Set first, then by ID. */
export function poolOrder(objects) {
  return Object.values(objects).sort((a, b) => (b.type === 0) - (a.type === 0) || a.id - b.id);
}

/**
 * Encodes a whole pool. Returns { bytes, entries: [{obj, offset, length, bytes}], chunks: [{start, length, count}] }.
 * Chunks group whole objects into Object Pool Transfer messages of at most `chunkMax` bytes.
 */
export function encodePool(objects, chunkMax = TP_MAX) {
  const entries = [];
  let offset = 0;
  for (const obj of poolOrder(objects)) {
    const bytes = encodeObject(obj);
    entries.push({ obj, offset, length: bytes.length, bytes });
    offset += bytes.length;
  }
  const out = new Uint8Array(offset);
  for (const e of entries) out.set(e.bytes, e.offset);
  const chunks = [];
  for (const e of entries) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + e.length <= chunkMax) { last.length += e.length; last.count++; }
    else chunks.push({ start: e.offset, length: e.length, count: 1 });
  }
  return { bytes: out, entries, chunks };
}

/** Parses an object pool (.iop) into objects. Throws on unknown types or a truncated pool. */
export function parsePool(bytes) {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const objects = [];
  while (r.p < r.b.length) {
    const start = r.p;
    const id = r.u16();
    const type = r.u8();
    const def = TYPES[type];
    if (!def) throw new Error(`objecttype ${type} (object ${id}, offset ${start}) wordt niet ondersteund`);
    const obj = { id, type, name: '' };
    const counts = {};
    let raw = null;
    try {
      for (const f of def.fields) {
        switch (f.k) {
          case 'u8': case 'colour': case 'enum': case 'bits': case 'just': obj[f.n] = r.u8(); break;
          case 'bool': obj[f.n] = r.u8() ? 1 : 0; break;
          case 'u16': case 'ref': obj[f.n] = r.u16(); break;
          case 'u32': obj[f.n] = r.u32(); break;
          case 'i32': obj[f.n] = r.i32(); break;
          case 'f32': obj[f.n] = Math.fround(r.f32()); break;
          case 'count': counts[f.of] = r.n(f.size); break;
          case 'children': obj.children = Array.from({ length: counts.children }, () => ({ id: r.u16(), x: r.i16(), y: r.i16() })); break;
          case 'macros': obj.macros = Array.from({ length: counts.macros }, () => ({ event: r.u8(), macro: r.u8() })); break;
          case 'idlist': obj[f.n] = Array.from({ length: counts[f.n] }, () => r.u16()); break;
          case 'langs': obj.languages = Array.from({ length: counts.languages }, () => fromLatin1(r.bytes(2))); break;
          case 'points': obj.points = Array.from({ length: counts.points }, () => ({ x: r.u16(), y: r.u16() })); break;
          case 'string': {
            const len = r.n(f.lenSize);
            const s = fromLatin1(r.bytes(len));
            if (f.fixed) { obj.length = len; obj[f.n] = s.replace(/ +$/, ''); } else obj[f.n] = s;
            break;
          }
          case 'picdata': raw = r.bytes(counts.$raw); break;
          case 'macrocmds': obj.commands = splitCommands(r.bytes(counts.commands)); break;
        }
      }
    } catch (e) {
      throw new Error(`object ${id} (${def.name}, offset ${start}): ${e.message}`);
    }
    if (type === 20) obj.pixels = b64enc(pixelsFromRaw(obj, raw));
    objects.push(obj);
  }
  return objects;
}

/** Every object reference inside an object: calls fn(id, kind, set) where set(newId) replaces it. */
export function forEachRef(obj, fn) {
  const def = TYPES[obj.type];
  if (!def) return;
  for (const f of def.fields) {
    if (f.k === 'ref') fn(obj[f.n], f.n, (v) => { obj[f.n] = v; }, f);
    else if (f.k === 'children') (obj.children || []).forEach((c) => fn(c.id, 'children', (v) => { c.id = v; }, f));
    else if (f.k === 'idlist') (obj[f.n] || []).forEach((id, i) => fn(id, f.n, (v) => { obj[f.n][i] = v; }, f));
  }
}

export { NONE };
