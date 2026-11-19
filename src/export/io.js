// PLC interface for FB VT_Client (TIA Portal, isobus_project_bundle/vt_client):
//   - DB "VT_Io": a named field per object (out: PLC → screen, in: screen → PLC) plus the
//     tables VT_Client works on (sys);
//   - FC "VT_IoMap": copies between the named fields and those tables (SCL cannot loop over
//     the members of a struct, so this part is generated per project).
import { TYPES, NONE } from '../iso/schema.js';
import { APP, plcName, stamp } from './common.js';

const INPUTS = [7, 8, 9, 10];

/** Role of an object in the interface: { table, dir, plc } or null (no field). */
export function ioKind(o) {
  switch (o.type) {
    case 11: case 22: return { table: 'str', dir: 'out' };
    case 8: return { table: 'str', dir: 'in' };
    case 12: case 21: return { table: 'num', dir: 'out', plc: 'UDInt' };
    case 17: case 18: case 19: case 27: return { table: 'num', dir: 'out', plc: 'UInt' };
    case 7: return { table: 'num', dir: 'in', plc: 'Bool' };
    case 9: return { table: 'num', dir: 'in', plc: 'UDInt' };
    case 10: return { table: 'num', dir: 'in', plc: 'USInt' };
    case 3: return { table: 'flag', dir: 'out', plc: 'Bool' };
    case 5: case 6: return { table: 'key', dir: 'in', plc: '"typeVtKey"' };
    default: return null;
  }
}

const hasVar = (o) => o.variableReference !== undefined && o.variableReference !== NONE;

/**
 * Whether an object gets a field when the user did not choose: outputs that show a variable
 * leave it to the variable, a variable used by an input in the interface is covered by that
 * input, and a container only when it starts hidden (to be shown by the PLC).
 */
export function ioDefault(p, o) {
  if (!ioKind(o)) return false;
  if (o.type === 3) return !!o.hidden;
  if (!INPUTS.includes(o.type) && hasVar(o)) return false;
  if (o.type === 21 || o.type === 22) {
    return !Object.values(p.objects).some((x) => INPUTS.includes(x.type) && x.variableReference === o.id && (x.plcIo ?? true));
  }
  return true;
}

export const inIo = (p, o) => !!ioKind(o) && (o.plcIo ?? ioDefault(p, o));

/** Field type in the DB. */
export function ioType(o) {
  const k = ioKind(o);
  if (!k) return null;
  if (k.table === 'str') return `String[${strLen(o)}]`;
  return k.plc;
}
const strLen = (o) => Math.max(1, Math.min(254, o.length || 1));

/** Short description of the field, e.g. '"VT_Io".out.Snelheid : UDInt'. */
export function ioFieldText(p, o) {
  const k = ioKind(o);
  return `"${p.export.ioDb}".${k.dir}.${plcName(o.name)} : ${ioType(o)}`;
}

/** Fields and tables of the interface. */
export function ioPlan(p) {
  const tables = { num: [], str: [], flag: [], key: [] };
  const fields = { out: [], in: [] };
  for (const o of Object.values(p.objects).filter((x) => inIo(p, x)).sort((a, b) => a.id - b.id)) {
    const k = ioKind(o);
    const f = { o, k, name: plcName(o.name), i: tables[k.table].length };
    tables[k.table].push(f);
    fields[k.dir].push(f);
  }
  const ws = Object.values(p.objects).find((o) => o.type === 0);
  return { tables, fields, ws, mask: ws && p.objects[ws.activeMask] ? ws.activeMask : NONE };
}

// ---------- values ----------
const varOf = (p, o) => (hasVar(o) ? p.objects[o.variableReference] : null);
function numValue(p, o) {
  const v = varOf(p, o);
  const raw = v?.type === 21 ? v.value : o.value;
  return Number(raw ?? 0) >>> 0;
}
function strValue(p, o) {
  const v = varOf(p, o);
  return String((v?.type === 22 ? v.value : o.value) ?? '').slice(0, strLen(o));
}
/** SCL string literal: $ and ' escaped, characters outside Latin-1 become '?'. */
const sclStr = (s) => "'" + [...s].map((c) => (c.charCodeAt(0) > 255 ? '?' : c)).join('').replace(/\$/g, '$$$$').replace(/'/g, "$$'") + "'";
const plcVal = (f, p) => {
  const t = f.k.plc;
  if (f.k.table === 'str') return sclStr(strValue(p, f.o));
  if (f.k.table === 'flag') return f.o.hidden ? 'FALSE' : 'TRUE';
  const v = numValue(p, f.o);
  if (t === 'Bool') return v ? 'TRUE' : 'FALSE';
  if (t === 'USInt') return String(v & 255);
  if (t === 'UInt') return String(v & 0xffff);
  return String(v);
};
const describe = (f) => {
  const o = f.o;
  const base = `${TYPES[o.type].name} ${o.id}`;
  if (o.type === 12 || o.type === 9) return `${base} – ruwe waarde, weergave = (waarde + offset) × schaal`;
  if (o.type === 27) return `${base} – ID van het object dat getoond wordt`;
  if (o.type === 10) return `${base} – index van het gekozen item`;
  if (o.type === 3) return `${base} – zichtbaar`;
  if (o.type === 5 || o.type === 6) return `${base} – toetscode ${o.keyCode}`;
  if (f.k.table === 'str') return `${base} – max. ${strLen(o)} tekens`;
  return base;
};

// ---------- DB ----------
export function tiaIoDb(p) {
  const db = p.export.ioDb || 'VT_Io';
  const plan = ioPlan(p);
  const { tables, fields } = plan;
  const L = [
    '// =====================================================================',
    `//  ${db} – PLC-interface van object pool "${p.name}" – gegenereerd door ${APP} (${stamp()})`,
    `//  out: PLC → scherm (${fields.out.length}), in: scherm → PLC (${fields.in.length}; invoervelden kan de PLC ook schrijven).`,
    `//  sys: tabellen voor FB VT_Client – niet zelf schrijven. Elke cyclus na VT_Client "${db}Map"() aanroepen.`,
    '//  Niet met de hand aanpassen: opnieuw exporteren.',
    '// =====================================================================',
    `DATA_BLOCK "${db}"`,
    "{ S7_Optimized_Access := 'TRUE' }",
    'VERSION : 0.1',
    'NON_RETAIN',
    '   VAR ',
    '      status : Struct',
    '         ready : Bool;   // pool geladen, werkset actief',
    '         onScreen : Bool;   // onze werkset staat op de voorgrond',
    '         shownMask : UInt;   // masker dat de VT nu toont',
    '      END_STRUCT;',
    `      activeMask : UInt;   // gewenst masker, bv. "${p.export.tiaDb}".id.<masker> → Change Active Mask`,
  ];
  for (const dir of ['out', 'in']) {
    L.push(`      ${dir} : Struct   // ${dir === 'out' ? 'PLC → scherm' : 'scherm → PLC'}`);
    if (!fields[dir].length) L.push('         none : Bool;   // geen objecten');
    for (const f of fields[dir]) L.push(`         ${f.name} : ${ioType(f.o)};   // ${describe(f)}`);
    L.push('      END_STRUCT;');
  }
  const size = (t) => Math.max(1, tables[t].length) - 1;
  L.push('      sys : Struct   // intern voor VT_Client en ' + db + 'Map – niet zelf schrijven',
    '         ctrl : "typeVtcCtrl";',
    `         num : Array[0..${size('num')}] of "typeVtcNum";`,
    `         str : Array[0..${size('str')}] of "typeVtcStr";`,
    `         flag : Array[0..${size('flag')}] of "typeVtcFlag";`,
    `         key : Array[0..${size('key')}] of "typeVtcKey";`,
    '      END_STRUCT;',
    '   END_VAR',
    '',
    '',
    'BEGIN',
    `   activeMask := ${plan.mask};`,
    `   sys.ctrl.wsId := ${plan.ws ? plan.ws.id : 0};`,
    `   sys.ctrl.mask := ${plan.mask};`);
  for (const dir of ['out', 'in']) {
    for (const f of fields[dir]) if (f.k.table !== 'key') L.push(`   ${dir}.${f.name} := ${plcVal(f, p)};`);
  }
  for (const t of ['num', 'str', 'flag', 'key']) {
    if (!tables[t].length) { L.push(`   sys.${t}[0].id := 65535;   // ongebruikt`); continue; }
    for (const f of tables[t]) {
      const o = f.o;
      const a = `sys.${t}[${f.i}]`;
      const parts = [`${a}.id := ${o.id};`];
      if (t === 'num' || t === 'str') parts.push(`${a}.varId := ${hasVar(o) ? o.variableReference : 65535};`);
      if (t === 'num') parts.push(`${a}.value := ${numValue(p, o)};`);
      if (t === 'str') parts.push(`${a}.maxLen := ${strLen(o)};`, `${a}.text := ${sclStr(strValue(p, o))};`);
      if (t === 'flag') parts.push(`${a}.cmd := 16#A0;`, `${a}.on := ${o.hidden ? 'FALSE' : 'TRUE'};`);
      L.push(`   ${parts.join(' ')}   // ${f.name}`);
    }
  }
  L.push('', 'END_DATA_BLOCK', '');
  return L.join('\n');
}

// ---------- FC ----------
export function tiaIoMap(p) {
  const db = p.export.ioDb || 'VT_Io';
  const D = `"${db}"`;
  const { fields } = ioPlan(p);
  const L = [
    '// =====================================================================',
    `//  ${db}Map – koppelt ${db}.out/.in aan de tabellen van VT_Client – gegenereerd door ${APP} (${stamp()})`,
    `//  Elke cyclus aanroepen, na "VT_Client_DB"(...) en vóór je eigen logica. Niet met de hand aanpassen.`,
    '// =====================================================================',
    `FUNCTION "${db}Map" : Void`,
    `TITLE = 'Koppelt ${db}.out/.in aan de tabellen van VT_Client'`,
    "{ S7_Optimized_Access := 'TRUE' }",
    'VERSION : 0.1',
    '',
    'BEGIN',
    '\tREGION Status en masker',
    `\t    ${D}.status.ready := ${D}.sys.ctrl.ready;`,
    `\t    ${D}.status.onScreen := ${D}.sys.ctrl.onScreen;`,
    `\t    ${D}.status.shownMask := ${D}.sys.ctrl.shownMask;`,
    `\t    IF ${D}.activeMask <> ${D}.sys.ctrl.mask THEN`,
    `\t        ${D}.sys.ctrl.mask := ${D}.activeMask;`,
    `\t        ${D}.sys.ctrl.maskDirty := TRUE;`,
    '\t    END_IF;',
    '\tEND_REGION',
    '',
    '\tREGION PLC → scherm',
  ];
  const toSys = { UDInt: (x) => x, UInt: (x) => `UINT_TO_UDINT(${x})`, USInt: (x) => `USINT_TO_UDINT(${x})` };
  const fromSys = { UDInt: (x) => x, UInt: (x) => `UDINT_TO_UINT(${x})`, USInt: (x) => `UDINT_TO_USINT(${x})` };
  const field = (f) => `${D}.${f.k.dir}.${f.name}`;
  const push = (...lines) => L.push(...lines.map((l) => '\t    ' + l));
  for (const f of fields.out) {
    const s = `${D}.sys.${f.k.table}[${f.i}]`;
    push(`// ${f.name}: ${TYPES[f.o.type].name} ${f.o.id}`);
    if (f.k.table === 'flag') {
      push(`IF ${field(f)} <> ${s}.on THEN`, `    ${s}.on := ${field(f)};`, `    ${s}.dirty := TRUE;`, 'END_IF;');
    } else if (f.k.table === 'str') {
      push(`IF ${field(f)} <> ${s}.text THEN`, `    ${s}.text := ${field(f)};`, `    ${s}.dirty := TRUE;`, 'END_IF;');
    } else {
      const v = toSys[f.k.plc](field(f));
      push(`IF ${v} <> ${s}.value THEN`, `    ${s}.value := ${v};`, `    ${s}.dirty := TRUE;`, 'END_IF;');
    }
  }
  if (!fields.out.length) push('// geen objecten');
  L.push('\tEND_REGION', '', '\tREGION Scherm → PLC (invoervelden in beide richtingen)');
  for (const f of fields.in) {
    const s = `${D}.sys.${f.k.table}[${f.i}]`;
    push(`// ${f.name}: ${TYPES[f.o.type].name} ${f.o.id}`);
    if (f.k.table === 'key') {
      push(`${field(f)}.pressed := ${s}.pressed;`, `${field(f)}.onPress := ${s}.onPress;`, `${field(f)}.onRelease := ${s}.onRelease;`,
        `${field(f)}.count := ${s}.count;`, `${s}.onPress := FALSE;`, `${s}.onRelease := FALSE;`);
    } else if (f.k.table === 'str') {
      push(`IF ${s}.fromVt THEN`, `    ${field(f)} := ${s}.text;`, `    ${s}.fromVt := FALSE;`,
        `ELSIF ${field(f)} <> ${s}.text THEN`, `    ${s}.text := ${field(f)};`, `    ${s}.dirty := TRUE;`, 'END_IF;');
    } else if (f.k.plc === 'Bool') {
      push(`IF ${s}.fromVt THEN`, `    ${field(f)} := ${s}.value <> 0;`, `    ${s}.fromVt := FALSE;`,
        `ELSIF ${field(f)} <> (${s}.value <> 0) THEN`,
        `    IF ${field(f)} THEN`, `        ${s}.value := 1;`, '    ELSE', `        ${s}.value := 0;`, '    END_IF;',
        `    ${s}.dirty := TRUE;`, 'END_IF;');
    } else {
      push(`IF ${s}.fromVt THEN`, `    ${field(f)} := ${fromSys[f.k.plc](`${s}.value`)};`, `    ${s}.fromVt := FALSE;`,
        `ELSIF ${toSys[f.k.plc](field(f))} <> ${s}.value THEN`, `    ${s}.value := ${toSys[f.k.plc](field(f))};`, `    ${s}.dirty := TRUE;`, 'END_IF;');
    }
  }
  if (!fields.in.length) push('// geen objecten');
  L.push('\tEND_REGION', 'END_FUNCTION', '');
  return L.join('\n');
}
