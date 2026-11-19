// Checks a project before it goes to a terminal. Returns [{level: 'error'|'warn'|'info', id, text}].
// Errors make the VT reject the pool (or the export unusable); warnings deserve a look.
import { TYPES, NONE, CHILD_TYPES, typeName } from './schema.js';
import { encodeObject, forEachRef } from './codec.js';
import { pixelsOf } from './picture.js';
import { sizeOf, label } from '../model.js';

export function validate(p) {
  const out = [];
  const O = p.objects;
  const err = (id, text) => out.push({ level: 'error', id, text });
  const warn = (id, text) => out.push({ level: 'warn', id, text });
  const info = (id, text) => out.push({ level: 'info', id, text });
  const name = (id) => label(O[id]);
  const chunkMax = p.export?.chunkMax || 1784;

  const ws = Object.values(O).filter((o) => o.type === 0);
  if (ws.length !== 1) err(ws[1]?.id ?? null, ws.length ? 'Een pool heeft precies één Working Set; er zijn er ' + ws.length + '.' : 'De pool heeft geen Working Set.');

  const names = new Map();
  for (const o of Object.values(O)) {
    const def = TYPES[o.type];
    const key = o.name.toLowerCase();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)) err(o.id, `Naam "${o.name}" is geen geldige PLC-naam (letters, cijfers, _).`);
    if (names.has(key)) err(o.id, `Naam "${o.name}" wordt ook gebruikt door ${name(names.get(key))}.`);
    names.set(key, o.id);
    if (o.id < 0 || o.id > 65534) err(o.id, 'ID buiten 0–65534.');

    // references
    for (const f of def.fields) {
      if (f.k !== 'ref') continue;
      const v = o[f.n];
      if (v === NONE) { if (!f.none) err(o.id, `${f.label}: ontbreekt.`); continue; }
      if (!O[v]) err(o.id, `${f.label}: object ${v} bestaat niet.`);
      else if (!f.types.includes(O[v].type)) err(o.id, `${f.label}: ${name(v)} is een ${typeName(O[v].type)}, verwacht ${f.types.map(typeName).join(' of ')}.`);
    }
    // children
    if (o.children) {
      const allowed = CHILD_TYPES[o.type] || [];
      const [pw, ph] = sizeOf(p, o);
      for (const c of o.children) {
        const t = O[c.id];
        if (!t) { err(o.id, `Kind ${c.id} bestaat niet.`); continue; }
        if (!allowed.includes(t.type)) { err(o.id, `${typeName(t.type)} ${name(c.id)} mag niet in een ${def.name}.`); continue; }
        const [cw, chh] = sizeOf(p, t);
        if (c.x < 0 || c.y < 0 || c.x + cw > pw || c.y + chh > ph) warn(o.id, `${name(c.id)} valt (deels) buiten ${o.name} en wordt afgeknipt.`);
      }
    }
    for (const f of def.fields) {
      if (f.k === 'idlist') {
        for (const id of o[f.n]) {
          if (id === NONE && f.n === 'items') continue;
          if (!O[id]) err(o.id, `${f.label}: object ${id} bestaat niet.`);
          else if (!f.types.includes(O[id].type)) err(o.id, `${f.label}: ${name(id)} (${typeName(O[id].type)}) is hier niet toegelaten.`);
        }
      }
      if (f.k === 'count' && f.size === 1) {
        const n = f.of === '$raw' || f.of === 'commands' ? 0 : (o[f.of] || []).length;
        if (n > 255) err(o.id, `Meer dan 255 ${f.of}.`);
      }
      if (f.k === 'string') {
        const max = f.lenSize === 1 ? 255 : 65535;
        const len = f.fixed ? o.length : String(o[f.n]).length;
        if (len > max) err(o.id, `${f.label}: lengte ${len} > ${max}.`);
        if (f.fixed && String(o[f.n]).length > o.length) warn(o.id, `${f.label} is langer dan de lengte (${o.length}) en wordt afgekapt.`);
        if ([...String(o[f.n])].some((ch) => ch.charCodeAt(0) > 255)) warn(o.id, `${f.label} bevat tekens buiten ISO 8859-1; die worden "?".`);
      }
    }
    for (const m of o.macros || []) {
      if (!O[m.macro] || O[m.macro].type !== 28) err(o.id, `Macro ${m.macro} bestaat niet.`);
      if (m.macro > 255) err(o.id, `Macro-ID ${m.macro} > 255.`);
    }
    if (o.type === 28 && o.id > 255) err(o.id, 'Een macro heeft een ID van 0 tot 255.');

    // type-specific
    if (o.type === 0) {
      for (const l of o.languages) if (!/^[a-z]{2}$/.test(l)) warn(o.id, `Taalcode "${l}" is geen code van 2 kleine letters (ISO 639).`);
    }
    if (o.type === 16) {
      const min = o.polygonType === 3 ? 2 : 3;
      if (o.points.length < min) err(o.id, `Een ${o.polygonType === 3 ? 'open ' : ''}veelhoek heeft minstens ${min} punten.`);
    }
    if (o.type === 20) {
      const px = pixelsOf(o);
      const max = [2, 16, 256][o.format];
      if (px.some((v) => v >= max)) err(o.id, `Afbeelding gebruikt kleuren buiten het ${max}-kleurenpalet.`);
      if (o.format === 1 && o.transparencyColour > 15 && o.options & 1) warn(o.id, 'Transparante kleur ligt buiten de 16 kleuren.');
    }
    if (o.type === 25 && o.fillType === 3 && o.fillPattern === NONE) err(o.id, 'Vulling met patroon zonder afbeelding.');
    if (o.type === 9 && o.minValue > o.maxValue) warn(o.id, 'Minimum is groter dan maximum.');
    if ((o.type === 17 || o.type === 18 || o.type === 19) && o.minValue >= o.maxValue) warn(o.id, 'Minimum moet kleiner zijn dan maximum.');
    if (o.type === 4) {
      if (o.keys.length > 64) err(o.id, 'Een softkeymasker heeft hoogstens 64 toetsen.');
      if (o.keys.length > p.settings.skCount) info(o.id, `${o.keys.length} toetsen, de terminal toont er ${p.settings.skCount} per pagina.`);
    }

    // size of one object vs. one transfer
    try {
      const n = encodeObject(o).length;
      if (n > chunkMax) err(o.id, `Object is ${n} bytes: groter dan één TP-overdracht (${chunkMax}). Verklein het of gebruik ETP.`);
    } catch (e) { err(o.id, e.message); }
  }

  // objects nobody refers to (still sent to the VT; fine when the PLC uses them)
  const reach = new Set();
  const walk = (id) => {
    if (id === NONE || reach.has(id) || !O[id]) return;
    reach.add(id);
    const o = O[id];
    forEachRef(o, (v) => walk(v));
    for (const m of o.macros || []) walk(m.macro);
  };
  for (const w of ws) walk(w.id);
  for (const o of Object.values(O)) {
    if (!reach.has(o.id) && o.type !== 1 && o.type !== 2) info(o.id, 'Niet gebruikt vanuit de Working Set (wel meegestuurd).');
  }
  return out;
}
