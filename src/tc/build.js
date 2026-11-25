// Implement description (project.implement) → DDOP for the task controller, built like the section
// control example of AgIsoStack++: device, connector, boom (function) with bins per product and
// sections. The pool holds the maximum number of sections; the PLC sends only the first n (n set at run
// time) and patches widths and offsets. The tables in the result tell the PLC how:
//   entries[i].section   0 = always send, k = send only when the PLC uses k or more sections
//   boom                 child list of the boom: the condensed work states for sections 17+ come last,
//                        so the PLC can shorten the list (count at countOffset) with the sections
//   patches              int32 values the PLC may overwrite: section width, offset X, offset Y
//   nameOffset           8 bytes: the NAME of the working set (from VT_Client/TC_Client inputs)
//   labelOffset          7 bytes: structure label; the PLC changes the last 2 when it patches
import { NONE, PROP, TRIG, encodeDdop, checkDdop } from './ddop.js';
import { crc32 } from '../zip.js';
import { latin1 } from '../iso/codec.js';
import { DDI_SETPOINTS } from './ddi-setpoints.js';

/** DDIs used (ISO 11783-11). */
export const DDI = {
  setpointVolumeRate: 1, actualVolumeRate: 2,
  setpointMassRate: 6, actualMassRate: 7,
  setpointCountRate: 11, actualCountRate: 12,
  setpointTillageDepth: 51, actualTillageDepth: 52, setpointSeedingDepth: 56, actualSeedingDepth: 57,
  setpointWorkingHeight: 61, actualWorkingHeight: 62,
  actualWorkingWidth: 67, actualVolumeContent: 72, maximumVolumeContent: 73,
  actualMassContent: 75, maximumMassContent: 76,
  totalVolume: 80, totalMass: 81, totalCount: 82,
  totalArea: 116, effectiveTotalTime: 119,
  offsetX: 134, offsetY: 135, offsetZ: 136, actualWorkState: 141,
  connectorType: 157, prescriptionControlState: 158, sectionControlState: 160,
  actualCondensedWorkState: 161, actualCulturalPractice: 179,
  setpointWorkState: 289, setpointCondensedWorkState: 290,
  requestDefaultProcessData: 57343,
};

/**
 * Kinds of setpoint the TC can send per product or channel (a task map can hold any of them): rate DDIs
 * (raw units), presentation on the terminal, the content/total DDIs for products, and the element type
 * (3 = bin for a product, 2 = function for a depth or height).
 */
export const PRODUCT_KINDS = {
  volume: { nl: 'Vloeibaar (L/ha)', setpoint: DDI.setpointVolumeRate, actual: DDI.actualVolumeRate, rate: ['L/ha', 0.0001, 1],
    content: DDI.actualVolumeContent, capacity: DDI.maximumVolumeContent, contentUnit: ['L', 0.001, 0], total: DDI.totalVolume, totalUnit: ['L', 1, 0],
    rawNl: '0,01 mm³/m² (= 0,0001 L/ha)', capacityNl: 'L', capacityRaw: 1000 },
  mass: { nl: 'Korrel / meststof (kg/ha)', setpoint: DDI.setpointMassRate, actual: DDI.actualMassRate, rate: ['kg/ha', 0.01, 1],
    content: DDI.actualMassContent, capacity: DDI.maximumMassContent, contentUnit: ['kg', 0.001, 0], total: DDI.totalMass, totalUnit: ['kg', 1, 0],
    rawNl: 'mg/m² (= 0,01 kg/ha)', capacityNl: 'kg', capacityRaw: 1000 },
  count: { nl: 'Zaad (korrels/ha)', setpoint: DDI.setpointCountRate, actual: DDI.actualCountRate, rate: ['/ha', 10, 0],
    total: DDI.totalCount, totalUnit: ['#', 1, 0], rawNl: '0,001 /m² (= 10 /ha)' },
  tillageDepth: { nl: 'Diepte grondbewerking (mm)', setpoint: DDI.setpointTillageDepth, actual: DDI.actualTillageDepth, rate: ['mm', 1, 0], rawNl: 'mm', element: 2 },
  seedingDepth: { nl: 'Zaaidiepte (mm)', setpoint: DDI.setpointSeedingDepth, actual: DDI.actualSeedingDepth, rate: ['mm', 1, 0], rawNl: 'mm', element: 2 },
  workingHeight: { nl: 'Werkhoogte (mm)', setpoint: DDI.setpointWorkingHeight, actual: DDI.actualWorkingHeight, rate: ['mm', 1, 0], rawNl: 'mm', element: 2 },
};

/** Decimals that show one step of the given resolution (0.01 → 2). */
const decimalsOf = (res) => (res >= 1 ? 0 : Math.min(7, Math.ceil(-Math.log10(res) - 1e-9)));

/**
 * Kind of a setpoint: one of PRODUCT_KINDS, or 'ddi:<setpoint DDI>' for any pair of DDI_SETPOINTS. A
 * generic pair is shown in its database unit; rates per area or time hang under a bin, the rest under a
 * function element.
 */
export function kindOf(kind) {
  if (PRODUCT_KINDS[kind]) return PRODUCT_KINDS[kind];
  const m = /^ddi:(\d+)$/.exec(String(kind));
  const row = m && DDI_SETPOINTS.find((r) => r[0] === Number(m[1]));
  if (!row) return null;
  const [setpoint, actual, name, unit, res] = row;
  const rate = /Application Rate|\/m²|\/s$/.test(`${name} ${unit}`);
  return { nl: `${name}${unit ? ` (${unit})` : ''}`, setpoint, actual, rate: [unit || '-', res, decimalsOf(res)],
    rawNl: `${String(res).replace('.', ',')} ${unit || '(zonder eenheid)'}`, element: rate ? 3 : 2, generic: true };
}

/** Choices for the kind of a setpoint: the common ones, then every pair of the DDI database. */
export const KIND_CHOICES = [
  ...Object.entries(PRODUCT_KINDS).map(([k, v]) => [k, v.nl]),
  ...DDI_SETPOINTS.map(([s, a, name, unit]) => [`ddi:${s}`, `DDI ${s}/${a} ${name}${unit ? ` (${unit})` : ''}`]),
];

/** Connector types (DDI 157). */
export const CONNECTOR_TYPES = [
  [0, 'Onbekend'], [1, 'Trekhaak / trekbalk (ISO 6489-3)'], [2, 'Driepuntshef, halfgedragen (ISO 730)'],
  [3, 'Driepuntshef, gedragen (ISO 730)'], [4, 'Haak (ISO 6489-1)'], [5, 'Trekoog 40 (ISO 6489-2)'], [6, 'Piton (ISO 6489-4)'],
  [7, 'CUNA (ISO 6489-5)'], [8, 'Kogel K80 (ISO 24347)'], [9, 'Zelfrijdend, op het chassis'], [10, 'Draaikrans (ISO 5692-2)'],
];

/** Cultural practices (DDI 179). */
export const PRACTICES = [
  [0, 'Onbekend'], [1, 'Bemesten'], [2, 'Zaaien en planten'], [3, 'Gewasbescherming'], [4, 'Grondbewerking'], [5, 'Persen'],
  [6, 'Maaien'], [7, 'Wikkelen'], [8, 'Oogsten'], [9, 'Hakselen'], [10, 'Transport'], [11, 'Zwaden'],
  [12, 'Mest uitrijden'], [13, 'Opraapwagen'], [14, 'Schudden'], [15, 'Meten'], [16, 'Irrigatie'], [17, 'Voeren / mengen'], [18, 'Mulchen'],
];

export const MAX_SECTIONS = 64;

export const DEFAULT_IMPLEMENT = {
  enabled: false,
  designator: 'Werktuig',
  serial: '1',
  softwareVersion: '1.0',
  language: 'en',
  connectorType: 3,
  workDistance: 1000, // mm from the connector back to the working line of the sections
  maxSections: 8,
  sectionWidth: 3000, // mm, default for every section
  practice: 3,
  products: [{ name: 'Product 1', kind: 'volume', capacity: 3000, practice: 3 }],
};

export function normalizeImplement(m) {
  const d = { ...DEFAULT_IMPLEMENT, ...(m || {}) };
  d.products = (Array.isArray(d.products) ? d.products : []).map((x) => ({ name: 'Product', kind: 'volume', capacity: 0, practice: d.practice, ...x }));
  return d;
}

const sectionsPerCondensed = 16;
/** Y offset (mm, right positive) of section k (1-based) when all sections have width w and are centred. */
export const sectionY = (k, n, w) => Math.round(-((n * w) / 2) + (k - 1) * w + w / 2);

/** Localization label: language, decimal point, 24 h, dd-mm-yyyy, metric units. */
const localization = (lang) => [...latin1(String(lang || 'en').toLowerCase().padEnd(2, ' ').slice(0, 2)), 0x40, 0x00, 0x00, 0x00, 0xff];

/** Default NAME in the pool (the PLC writes its own): identity 12345, function 129, industry group 2. */
const DEFAULT_NAME = [0x39, 0x30, 0x00, 0x00, 0x00, 0x81, 0x00, 0x20];

export function buildDdop(implement) {
  const m = normalizeImplement(implement);
  const n = Math.max(1, Math.min(MAX_SECTIONS, Math.round(m.maxSections)));
  const objects = [];
  const sectionOf = new Map(); // object id → section index (0 = always)
  let nextId = 0;
  let element = 0;
  const add = (o, section = 0) => { o.id = nextId++; objects.push(o); sectionOf.set(o.id, section); return o; };
  const presentations = [];
  const dvp = (unit, scale, decimals) => {
    let p = presentations.find((x) => x.unit === unit && x.scale === scale && x.decimals === decimals);
    if (!p) { p = { table: 'DVP', unit, scale, decimals, offset: 0, id: null }; presentations.push(p); }
    return p;
  };
  const dpd = (designator, ddi, props, triggers, pres = null) => ({ table: 'DPD', designator, ddi, props, triggers, pres });
  const dpt = (designator, ddi, value, pres = null) => ({ table: 'DPT', designator, ddi, value: Math.round(value) | 0, pres });
  const mm = () => dvp('mm', 1, 0);
  const det = (type, designator, parent, section = 0) => add({ table: 'DET', type, designator, number: element++, parent, children: [] }, section);
  const child = (parent, o, section = 0) => { add(o, section); parent.children.push(o.id); return o; };

  const device = add({ table: 'DVC', designator: m.designator, softwareVersion: m.softwareVersion, name: DEFAULT_NAME,
    serial: m.serial, structureLabel: '0000000', localization: localization(m.language) });

  // device element: work state, totals, request for the default process data
  const main = det(1, m.designator, device.id);
  child(main, dpd('Werkstand', DDI.actualWorkState, PROP.defaultSet, TRIG.change));
  child(main, dpd('Standaard procesdata', DDI.requestDefaultProcessData, 0, TRIG.total));
  child(main, dpd('Werktijd', DDI.effectiveTotalTime, PROP.defaultSet | PROP.settable, TRIG.total, dvp('h', 1 / 3600, 1)));
  child(main, dpt('Teeltpraktijk', DDI.actualCulturalPractice, m.practice));

  // connector = device reference point
  const conn = det(6, 'Koppeling', main.id);
  child(conn, dpt('Koppeling X', DDI.offsetX, 0, mm()));
  child(conn, dpt('Koppeling Y', DDI.offsetY, 0, mm()));
  child(conn, dpt('Type koppeling', DDI.connectorType, m.connectorType));

  // boom with the section states; the condensed work states are added to its child list last
  const boom = det(2, 'Boom', main.id);
  child(boom, dpt('Boom X', DDI.offsetX, -m.workDistance, mm()));
  child(boom, dpt('Boom Y', DDI.offsetY, 0, mm()));
  child(boom, dpt('Boom Z', DDI.offsetZ, 0, mm()));
  child(boom, dpd('Werkbreedte', DDI.actualWorkingWidth, PROP.defaultSet, TRIG.change, dvp('m', 0.001, 2)));
  child(boom, dpd('Werkstand instellen', DDI.setpointWorkState, PROP.defaultSet | PROP.settable, TRIG.change));
  child(boom, dpd('Oppervlakte', DDI.totalArea, PROP.defaultSet, TRIG.total, dvp('ha', 0.0001, 2)));
  child(boom, dpd('Sectiebesturing', DDI.sectionControlState, PROP.defaultSet | PROP.settable, TRIG.change | TRIG.time));
  const boomFixedRefs = boom.children.length;

  // products (bins under the boom)
  const products = [];
  m.products.forEach((pr, i) => {
    const k = kindOf(pr.kind);
    const bin = det(k?.element || 3, pr.name || `Product ${i + 1}`, boom.id);
    const info = { index: i + 1, name: bin.designator, kind: pr.kind, element: bin.number };
    if (k) {
      const rate = dvp(...k.rate);
      const what = k.element === 2 ? 'Waarde' : 'Dosis';
      child(bin, dpd(`${what} instellen`, k.setpoint, PROP.defaultSet | PROP.settable, TRIG.change, rate));
      child(bin, dpd(what, k.actual, PROP.defaultSet, TRIG.change | TRIG.time, rate));
      child(bin, dpd('Taakkaart', DDI.prescriptionControlState, PROP.defaultSet | PROP.settable, TRIG.change | TRIG.time));
      if (k.total) child(bin, dpd('Totaal', k.total, PROP.defaultSet, TRIG.total, dvp(...k.totalUnit)));
      if (k.content) {
        const cu = dvp(...k.contentUnit);
        child(bin, dpd('Inhoud', k.content, PROP.defaultSet, TRIG.change | TRIG.time, cu));
        child(bin, dpt('Max. inhoud', k.capacity, (pr.capacity || 0) * k.capacityRaw, cu));
      }
    }
    child(bin, dpt('Teeltpraktijk', DDI.actualCulturalPractice, pr.practice ?? m.practice));
    products.push(info);
  });

  // sections
  const sections = [];
  for (let s = 1; s <= n; s++) {
    const sec = det(4, `Sectie ${s}`, boom.id, s);
    const x = child(sec, dpt('X', DDI.offsetX, -m.workDistance, mm()), s);
    const y = child(sec, dpt('Y', DDI.offsetY, sectionY(s, n, m.sectionWidth), mm()), s);
    const w = child(sec, dpt('Breedte', DDI.actualWorkingWidth, m.sectionWidth, mm()), s);
    sections.push({ section: s, element: sec.number, x, y, w });
  }
  // condensed work states per 16 sections, last in the boom's child list
  const groups = Math.ceil(n / sectionsPerCondensed);
  for (let g = 0; g < groups; g++) {
    const first = g * sectionsPerCondensed + 1;
    const last = Math.min(n, first + sectionsPerCondensed - 1);
    child(boom, dpd(`Secties ${first}-${last}`, DDI.actualCondensedWorkState + g, PROP.defaultSet, TRIG.change | TRIG.time), first);
    child(boom, dpd(`Secties ${first}-${last} instellen`, DDI.setpointCondensedWorkState + g, PROP.defaultSet | PROP.settable, TRIG.change), first);
  }
  // presentations last
  for (const p of presentations) add(p);
  for (const o of objects) if (o.pres !== undefined) { o.presentation = o.pres ? o.pres.id : NONE; delete o.pres; }

  // structure label: changes with the pool, so a TC that stored an older pool asks for this one
  let ddop = encodeDdop(objects);
  device.structureLabel = crc32(ddop.bytes).toString(36).toUpperCase().padStart(5, '0').slice(-5) + '00';
  ddop = encodeDdop(objects);

  const at = (o) => ddop.entries.find((e) => e.obj === o).start;
  const lenOf = (s) => latin1(s).length;
  const dvcStart = at(device);
  const nameOffset = dvcStart + 3 + 2 + 1 + lenOf(device.designator) + 1 + lenOf(device.softwareVersion);
  const labelOffset = nameOffset + 8 + 1 + lenOf(device.serial);
  const patches = [];
  for (const s of sections) {
    patches.push({ offset: at(s.w) + 7, kind: 1, section: s.section });
    patches.push({ offset: at(s.x) + 7, kind: 2, section: s.section });
    patches.push({ offset: at(s.y) + 7, kind: 3, section: s.section });
  }
  const boomIndex = ddop.entries.findIndex((e) => e.obj === boom);

  // process data table for the PLC (TC_Io.sys.pd): every DPD except "request default process data",
  // with the role the koppel-FC gives it
  const parentOf = new Map();
  for (const o of objects) if (o.table === 'DET') for (const c of o.children) parentOf.set(c, o);
  const prodByElement = new Map(products.map((x) => [x.element, x]));
  const pd = [];
  for (const o of objects) {
    if (o.table !== 'DPD' || o.ddi === DDI.requestDefaultProcessData) continue;
    const el = parentOf.get(o.id);
    const r = { element: el.number, ddi: o.ddi, settable: !!(o.props & PROP.settable), designator: o.designator, role: '', index: 0 };
    const prod = prodByElement.get(el.number);
    if (el === main) r.role = { [DDI.actualWorkState]: 'actualWorkState', [DDI.effectiveTotalTime]: 'totalTime' }[o.ddi];
    else if (el === boom) {
      r.role = { [DDI.actualWorkingWidth]: 'workingWidth', [DDI.setpointWorkState]: 'setpointWorkState', [DDI.totalArea]: 'totalArea',
        [DDI.sectionControlState]: 'sectionControlState' }[o.ddi];
      if (o.ddi >= DDI.actualCondensedWorkState && o.ddi < DDI.actualCondensedWorkState + 16) { r.role = 'actualCondensed'; r.index = o.ddi - DDI.actualCondensedWorkState; }
      if (o.ddi >= DDI.setpointCondensedWorkState && o.ddi < DDI.setpointCondensedWorkState + 16) { r.role = 'setpointCondensed'; r.index = o.ddi - DDI.setpointCondensedWorkState; }
    } else if (prod) {
      const k = kindOf(prod.kind);
      r.index = prod.index;
      r.role = { [k.setpoint]: 'setpoint', [k.actual]: 'actual', [DDI.prescriptionControlState]: 'prescription', [k.total]: 'total', [k.content]: 'content' }[o.ddi];
    }
    if (!r.role) throw new Error(`Geen rol voor DDI ${o.ddi} in element ${el.number}`);
    pd.push(r);
  }
  return {
    pd,
    implement: m,
    objects,
    bytes: ddop.bytes,
    entries: ddop.entries.map((e) => ({ ...e, section: sectionOf.get(e.obj.id) })),
    maxSections: n,
    sections,
    products,
    boom: { index: boomIndex, countOffset: at(boom) + 11 + lenOf(boom.designator), fixedRefs: boomFixedRefs, refsPerGroup: 2 },
    patches,
    nameOffset,
    labelOffset,
    structureLabel: device.structureLabel,
    errors: checkDdop(objects),
  };
}

/**
 * The pool as the PLC sends it with `count` sections and the given values (mm) per section: what
 * TC_Client will do, here so the tests can check that the result is a valid pool.
 * values: { width: [..], x: [..], y: [..] } indexed by section - 1 (missing = keep).
 */
export function poolForSections(b, count, values = {}) {
  const data = Uint8Array.from(b.bytes);
  const put32 = (off, v) => { for (let i = 0; i < 4; i++) data[off + i] = (v >> (8 * i)) & 255; };
  for (const p of b.patches) {
    const arr = [null, values.width, values.x, values.y][p.kind];
    if (arr && arr[p.section - 1] !== undefined) put32(p.offset, arr[p.section - 1]);
  }
  const groups = Math.ceil(count / sectionsPerCondensed);
  const refs = b.boom.fixedRefs + groups * b.boom.refsPerGroup;
  data[b.boom.countOffset] = refs & 255;
  data[b.boom.countOffset + 1] = refs >> 8;
  const out = [];
  b.entries.forEach((e, i) => {
    if (e.section > count) return;
    let len = e.length;
    if (i === b.boom.index) len = b.boom.countOffset + 2 - e.start + refs * 2;
    out.push(...data.slice(e.start, e.start + len));
  });
  return Uint8Array.from(out);
}
