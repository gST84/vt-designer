// Self-tests for the encoder, parser and exporters. Run in the browser (test.html) or headless
// on macOS with JavaScriptCore:  jsc -m tools/run-tests.mjs
import { TYPES } from './iso/schema.js';
import { encodeObject, encodePool, parsePool } from './iso/codec.js';
import { b64enc, pictureRaw, pixelsFromRaw, b64dec } from './iso/picture.js';
import { COMMANDS, decodeCommand, encodeCommand, defaultsFor, splitCommands, joinCommands } from './iso/macros.js';
import { addObject, newProject, normalizeProject, projectFromObjects, renumber, deleteObject } from './model.js';
import { validate } from './iso/validate.js';
import { tiaSource } from './export/tia.js';
import { codesysGvl, codesysXml, codesysProjectObjects, plcopenXml } from './export/codesys.js';
import { translateScl, parseValue, valueText, parseStObjects, stText, mask } from './export/scl2st.js';
import { listing } from './export/listing.js';
import { ioPlan, tiaIoDb, tiaIoMap, inIo } from './export/io.js';
import { zip, crc32, utf8 } from './zip.js';
import { renderRoot } from './render.js';
import { encodeObject as ddopObject, parseDdop, checkDdop } from './tc/ddop.js';
import { buildDdop, poolForSections, sectionY, DDI, kindOf, KIND_CHOICES } from './tc/build.js';
import { tiaTcPool, ddopListing } from './export/tcpool.js';
import { tiaTcIo, tiaTcIoMap, realLit } from './export/tcio.js';
import { APP_VERSION, sclText, buildExport } from './export/common.js';

/** The 119 bytes of vt_test_project/VT_TestPool.iop (from pool_listing.txt). */
const TEST_POOL = `
00 00 00 01 01 E8 03 01 00 01 F9 2A 00 00 00 00 65 6E
E8 03 01 01 FF FF 01 00 F8 2A 14 00 28 00
F8 2A 0B 90 01 28 00 01 D8 59 00 FF FF 01 20 00 48 61 6C 6C 6F 20 76 61 6E 75 69 74 20 53 37 2D 31 35 30 30 20 20 20 20 20 20 20 20 20 20 20 20 00
F9 2A 0B 3C 00 20 00 01 D9 59 00 FF FF 01 05 00 53 37 20 56 54 00
D8 59 17 00 03 00 00 00
D9 59 17 00 02 00 00 00`;

const hexToBytes = (s) => Uint8Array.from(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Number of child elements of every <data> element in an XML text (tags only: values are escaped). */
function dataChildren(text) {
  const out = [], stack = [];
  for (const [, close, tag, self] of text.matchAll(/<(\/?)([A-Za-z][\w:.-]*)(?:\s[^>]*?)?(\/?)>/g)) {
    if (close) { const e = stack.pop(); if (e.tag === 'data') out.push(e.kids); continue; }
    if (stack.length) stack[stack.length - 1].kids++;
    if (!self) stack.push({ tag, kids: 0 });
    else if (tag === 'data') out.push(0);
  }
  return out;
}

/** A project with one object of every type, filled with non-default values. */
export function everyTypeProject() {
  const p = newProject('Alle types');
  p.settings.vtVersion = 4; // also covers version 4 options (vertical justification, realtime editing)
  const add = (t, a = {}) => addObject(p, t, a);
  const num = add(21, { value: 1234 });
  const sv = add(22, { value: 'abc', length: 8 });
  const pic = add(20, { width: 6, actualWidth: 3, actualHeight: 2, format: 2, options: 4, pixels: b64enc([1, 2, 3, 200, 200, 200]) });
  const fill = add(25, { fillType: 3, fillColour: 9, fillPattern: pic.id });
  const line = add(24, { lineColour: 12, lineWidth: 2, lineArt: 0xf0f0 });
  const ia = add(26, { validationType: 1, validationString: 'xyz' });
  const macro = add(28, { commands: [encodeCommand(0xa0, { obj: 1000, show: 1 }), encodeCommand(0xb3, { obj: 11000, text: 'Hoi' })] });
  const os = add(11, { value: 'Ölie', length: 10, variableReference: sv.id, justification: 1 | (1 << 2), macros: [{ event: 3, macro: macro.id }] });
  const on = add(12, { value: 77, offset: -5, scale: 0.25, decimals: 2, variableReference: num.id });
  add(13, { lineAttributes: line.id, width: 30, height: 10, lineDirection: 1 });
  add(14, { lineAttributes: line.id, fillAttributes: fill.id, lineSuppression: 5 });
  add(15, { lineAttributes: line.id, ellipseType: 3, startAngle: 10, endAngle: 100 });
  add(16, { lineAttributes: line.id, polygonType: 3 });
  add(17, { value: 40, variableReference: num.id });
  add(18, { value: 40, options: 0x13 });
  add(19, { value: 70, barWidth: 9 });
  add(7, { value: 1, enabled: 0 });
  add(8, { value: 'in', length: 5, inputAttributes: ia.id });
  add(9, { value: 5, minValue: 1, maxValue: 9, offset: -3, scale: 1.5, decimals: 1, options2: 3 });
  add(10, { items: [os.id, on.id, 0xffff], value: 1 });
  const cont = add(3, { hidden: 1, children: [{ id: os.id, x: -5, y: 7 }] });
  const btn = add(6, { options: 1, children: [{ id: on.id, x: 2, y: 2 }] });
  const key = add(5, { keyCode: 7, children: [{ id: os.id, x: 0, y: 0 }] });
  const ptr = add(27, { value: key.id });
  const skm = add(4, { keys: [key.id, ptr.id] });
  add(2, { softKeyMask: skm.id, priority: 0, acousticSignal: 1, children: [{ id: on.id, x: 1, y: 2 }] });
  p.objects[1000].children.push({ id: cont.id, x: 1, y: 2 }, { id: btn.id, x: 300, y: 400 });
  return p;
}

export function runTests(log = (s) => console.log(s)) {
  let fails = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) fails++;
    log(`${ok ? 'OK  ' : 'FOUT'} ${name}${ok || !detail ? '' : '\n     ' + detail}`);
  };

  // 1. the new project is byte for byte the pool of vt_test_project (make_pool.py)
  const ref = hexToBytes(TEST_POOL);
  const p = newProject();
  const pool = encodePool(p.objects);
  check('nieuw project = VT_TestPool.iop (119 bytes)', eq(pool.bytes, ref), `kreeg ${pool.bytes.length} bytes:\n     ${hex(pool.bytes)}`);

  // 2. parsing the reference and encoding it again gives the same bytes
  const parsed = parsePool(ref);
  check('VT_TestPool.iop inlezen: 6 objecten', parsed.length === 6);
  const p2 = projectFromObjects(parsed);
  check('VT_TestPool.iop inlezen en opnieuw coderen', eq(encodePool(p2.objects).bytes, ref));

  // 3. every object type: encode → parse → encode is stable
  const all = everyTypeProject();
  const types = new Set(Object.values(all.objects).map((o) => o.type));
  check('testproject bevat elk objecttype', Object.keys(TYPES).every((t) => types.has(Number(t))), [...types].join(','));
  for (const o of Object.values(all.objects)) {
    const b = encodeObject(o);
    let again;
    try { again = encodeObject(parsePool(b)[0]); } catch (e) { again = new Uint8Array(); check(`${TYPES[o.type].name} terug inlezen`, false, e.message); continue; }
    check(`${TYPES[o.type].name} (${o.id}): ${b.length} bytes, heen en terug`, eq(b, again), `${hex(b)}\n     ${hex(again)}`);
  }
  const allPool = encodePool(all.objects);
  const reparsed = projectFromObjects(parsePool(allPool.bytes));
  check('volledige pool heen en terug', eq(encodePool(reparsed.objects).bytes, allPool.bytes));
  check('geldige pool zonder fouten', validate(all).filter((m) => m.level === 'error').length === 0,
    validate(all).filter((m) => m.level === 'error').map((m) => m.text).join('; '));

  // 4. pictures: every format, with and without RLE
  for (const format of [0, 1, 2]) {
    for (const rle of [0, 4]) {
      const px = Array.from({ length: 11 * 3 }, (_, i) => (format === 0 ? i % 3 === 0 ? 1 : 0 : format === 1 ? i % 16 : (i * 7) % 232));
      const obj = { actualWidth: 11, actualHeight: 3, format, options: rle, pixels: b64enc(px) };
      const back = pixelsFromRaw(obj, pictureRaw(obj));
      check(`afbeelding formaat ${format}${rle ? ' + RLE' : ''}`, eq(back, b64dec(obj.pixels)));
    }
  }

  // 5. macro commands
  for (const c of COMMANDS) {
    const v = defaultsFor(c.code);
    for (const k of Object.keys(v)) if (typeof v[k] === 'number' && v[k] !== 0xffff) v[k] = 3;
    if ('text' in v) v.text = 'abc';
    const b = encodeCommand(c.code, v);
    const back = decodeCommand(b);
    const len = c.code === 0xb3 ? 8 : c.code === 0xb4 ? 9 : 8;
    check(`macro ${c.name}`, b.length === len && JSON.stringify(back) === JSON.stringify(v), `${hex(b)} ${JSON.stringify(back)}`);
  }
  const cmds = [encodeCommand(0xb3, { obj: 1, text: 'abcdefgh' }), encodeCommand(0xb4, { parent: 1, obj: 2, x: 3, y: 4 }), encodeCommand(0x92, {})];
  check('macro-opdrachten splitsen', JSON.stringify(splitCommands(joinCommands(cmds))) === JSON.stringify(cmds));
  // function codes of ISO 11783-6 (same as AgIsoStack++ and can_log_tools/decode.py VT_FUNC)
  const iso = {
    'Hide/Show Object': 0xa0, 'Enable/Disable Object': 0xa1, 'Select Input Object': 0xa2, ESC: 0x92,
    'Control Audio Signal': 0xa3, 'Set Audio Volume': 0xa4, 'Change Child Location': 0xa5, 'Change Size': 0xa6,
    'Change Background Colour': 0xa7, 'Change Numeric Value': 0xa8, 'Change End Point': 0xa9, 'Change Font Attributes': 0xaa,
    'Change Line Attributes': 0xab, 'Change Fill Attributes': 0xac, 'Change Active Mask': 0xad, 'Change Soft Key Mask': 0xae,
    'Change Attribute': 0xaf, 'Change Priority': 0xb0, 'Change List Item': 0xb1, 'Change String Value': 0xb3, 'Change Child Position': 0xb4,
  };
  const wrong = COMMANDS.filter((c) => iso[c.name] !== c.code).map((c) => `${c.name} = ${c.code.toString(16)}`);
  check('macro-functiecodes volgens ISO 11783-6', wrong.length === 0 && COMMANDS.length === Object.keys(iso).length, wrong.join(', '));

  // 5b. projects of file version 1 had the codes 0xA3–0xB2 one too high
  const ff = (n) => Array(n).fill(0xff);
  const oldCmds = [
    [0xae, 0, 0, 0xe8, 0x03, ...ff(3)], // Change Active Mask (old code) → 0xAD
    [0xa3, ...ff(7)], // ESC → 0x92
    [0xa4, 2, 0xe8, 3, 100, 0, 50, 0], // Control Audio Signal → 0xA3
    [0xa9, 0x10, 0x27, 0xff, 5, 0, 0, 0], // Change Numeric Value → 0xA8
    [0xb2, 0x10, 0x27, 1, 0xf8, 0x2a, 0xff, 0xff], // Change List Item → 0xB1
    [0xb3, 0xf8, 0x2a, 2, 0, 0xae, 0xa3], // Change String Value: unchanged, text bytes too
    [0xb4, 0xe8, 3, 0xf8, 0x2a, 0xa9, 0, 0xb2, 0], // Change Child Position: unchanged, values too
    [0xa0, 0xf8, 0x2a, 1, ...ff(4), 0xaf, 0, 0, 1, 0xe9, 3, ...ff(3)], // raw entry with 2 commands: Hide/Show + Change Soft Key Mask → 0xAE
  ];
  const newCmds = [
    [0xad, 0, 0, 0xe8, 0x03, ...ff(3)],
    [0x92, ...ff(7)],
    [0xa3, 2, 0xe8, 3, 100, 0, 50, 0],
    [0xa8, 0x10, 0x27, 0xff, 5, 0, 0, 0],
    [0xb1, 0x10, 0x27, 1, 0xf8, 0x2a, 0xff, 0xff],
    [0xb3, 0xf8, 0x2a, 2, 0, 0xae, 0xa3],
    [0xb4, 0xe8, 3, 0xf8, 0x2a, 0xa9, 0, 0xb2, 0],
    [0xa0, 0xf8, 0x2a, 1, ...ff(4), 0xae, 0, 0, 1, 0xe9, 3, ...ff(3)],
  ];
  const v1 = JSON.parse(JSON.stringify(newProject()));
  v1.version = 1;
  v1.objects[5] = { id: 5, type: 28, name: 'OudeMacro', commands: oldCmds };
  const v2 = normalizeProject(v1);
  check('project versie 1: macrocodes omgezet naar ISO', v2.version === 2 && JSON.stringify(v2.objects[5].commands) === JSON.stringify(newCmds),
    v2.objects[5].commands.map(hex).join(' | '));
  check('project versie 2: macrocodes niet nog eens omgezet', JSON.stringify(normalizeProject(JSON.parse(JSON.stringify(v2))).objects[5].commands) === JSON.stringify(newCmds));
  const iopIn = projectFromObjects(parsePool(encodePool(v2.objects).bytes));
  check('.iop inlezen: macrocodes ongewijzigd', JSON.stringify(normalizeProject(iopIn).objects[5].commands) === JSON.stringify(newCmds.flatMap((c) => splitCommands(c))));

  // 6. model operations
  const p3 = newProject();
  check('ID wijzigen werkt verwijzingen bij', renumber(p3, 11000, 11005) === null && p3.objects[1000].children[0].id === 11005);
  deleteObject(p3, 23001);
  check('verwijderen ruimt verwijzingen op', p3.objects[11001].fontAttributes === 0xffff);
  check('validatie meldt ontbrekend lettertype', validate(p3).some((m) => m.level === 'error' && m.id === 11001));

  // 6b. options of a newer VT version (a v3 terminal rejected vertical justification: EoP error 01, object 11001)
  const pv = newProject();
  pv.objects[11001].justification = 5; // horizontal + vertical middle
  pv.objects[23000].fontStyle = 0x81; // bold + proportional
  const v4err = (pp, id) => validate(pp).some((m) => m.level === 'error' && m.id === id && /VT-versie 4/.test(m.text));
  check('versie 3: verticale uitlijning is een fout', v4err(pv, 11001));
  check('versie 3: proportioneel lettertype is een fout', v4err(pv, 23000));
  check('versie 3: vet alleen is geen fout', !v4err(newProject(), 23000));
  pv.settings.vtVersion = 4;
  check('versie 4: geen versiefouten', !v4err(pv, 11001) && !v4err(pv, 23000));

  // 6c. children per VT version (table A.2): a v3 terminal refused a rectangle as Input List item
  const pc = newProject();
  const rect = addObject(pc, 14, {});
  const list = addObject(pc, 10, { items: [11000, rect.id] });
  pc.objects[1000].children.push({ id: list.id, x: 0, y: 0 });
  const meter = addObject(pc, 17, {});
  pc.objects[0].children.push({ id: meter.id, x: 0, y: 0 });
  check('versie 3: rechthoek in keuzelijst is een fout', v4err(pc, list.id));
  check('versie 3: meter in werkset is een fout', v4err(pc, 0));
  pc.objects[list.id].items = [11000, 11001];
  check('versie 3: teksten in keuzelijst mogen', !v4err(pc, list.id));
  pc.settings.vtVersion = 4;
  pc.objects[list.id].items = [11000, rect.id];
  check('versie 4: rechthoek in keuzelijst en meter in werkset mogen', !v4err(pc, list.id) && !v4err(pc, 0));
  const am = addObject(pc, 2, { children: [{ id: list.id, x: 0, y: 0 }] });
  check('alarmmasker zonder invoervelden', validate(pc).some((m) => m.level === 'error' && m.id === am.id && /mag niet in/.test(m.text)));

  // 7. pool split in TP-sized chunks of whole objects
  const big = newProject();
  for (let i = 0; i < 80; i++) addObject(big, 11, { value: 'x'.repeat(40), length: 40 });
  const bp = encodePool(big.objects);
  check('pool in delen van max. 1784 bytes', bp.chunks.length > 1 && bp.chunks.every((c) => c.length <= 1784)
    && bp.chunks.reduce((s, c) => s + c.length, 0) === bp.bytes.length);

  // 8. exporters
  const tia = tiaSource(p);
  check('TIA: DB-bron met data-array', tia.includes('DATA_BLOCK "VT_Pool"') && tia.includes('data : Array[0..118] of Byte;') && tia.includes('data[118] := 16#00;'));
  check('TIA: ID-constante', /Hoofdtekst : UInt := 11000;/.test(tia));
  check('TIA: velden voor VT_TestClient', ['size : UDInt;', 'chunkCount : UInt;', 'chunkStart : Array[0..0] of UDInt;', 'chunkLength : Array[0..0] of UInt;', 'chunkStart[0] := 0; chunkLength[0] := 119;'].every((t) => tia.includes(t)));
  const bigTia = tiaSource(big);
  check('TIA: meerdere delen', bigTia.includes(`chunkCount := ${bp.chunks.length};`) && bigTia.includes(`chunkStart : Array[0..${bp.chunks.length - 1}] of UDInt;`));
  const gvl = codesysGvl(p);
  check('CODESYS: GVL met array', gvl.includes('Pool : ARRAY[0..118] OF BYTE := [') && gvl.includes('ID_Hoofdtekst : UINT := 11000;'));
  const xml = codesysXml(p);
  check('CODESYS: PLCopen XML', xml.includes('<globalVars name="GVL_VtPool"') && (xml.match(/<simpleValue value="16#/g) || []).length === 119);
  check('listing', listing(p).includes('object 11000'));

  // 9. PLC interface (VT_Io + VT_IoMap)
  const ioP = ioPlan(p);
  check('interface: nieuw project heeft 2 teksten', ioP.fields.out.length === 2 && ioP.tables.str.length === 2 && !ioP.fields.in.length);
  const allIo = ioPlan(all);
  const kinds = (t) => allIo.tables[t].length;
  check('interface: alle soorten in het testproject', kinds('num') > 3 && kinds('str') > 1 && kinds('flag') === 1 && kinds('key') === 2,
    JSON.stringify({ num: kinds('num'), str: kinds('str'), flag: kinds('flag'), key: kinds('key') }));
  const outStrWithVar = Object.values(all.objects).find((o) => o.type === 11 && o.variableReference !== 0xffff);
  check('interface: tekst met variabele krijgt geen eigen veld', !inIo(all, outStrWithVar));
  for (const [name, proj] of [['nieuw project', p], ['testproject', all], ['leeg', (() => { const e = newProject(); delete e.objects[11000]; delete e.objects[11001]; e.objects[0].children = []; e.objects[1000].children = []; return e; })()]]) {
    const db = tiaIoDb(proj), fc = tiaIoMap(proj);
    const declared = new Set();
    let section = null;
    for (const line of db.split('\n')) {
      const m = line.match(/^ {6}(\w+) : Struct/);
      if (m) section = m[1];
      const f = line.match(/^ {9}(\w+) :/);
      if (f && section) declared.add(`${section}.${f[1]}`);
    }
    const used = [...fc.matchAll(/"VT_Io"\.(out|in)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`);
    const missing = used.filter((u) => !declared.has(u));
    check(`interface ${name}: FC gebruikt enkel velden uit de DB`, missing.length === 0, missing.join(', '));
    check(`interface ${name}: geen lege arrays of structs`, !/Array\[0\.\.-1\]/.test(db) && /none : Bool|: /.test(db));
    const opens = (fc.match(/\bIF\b/g) || []).length - (fc.match(/\bEND_IF\b/g) || []).length;
    check(`interface ${name}: IF/END_IF in balans`, opens === 0);
  }
  const quoted = newProject();
  quoted.objects[11000].value = "it's $5";
  check('interface: tekst met $ en \' correct in SCL', tiaIoDb(quoted).includes("out.Hoofdtekst := 'it$'s $$5';"));
  check('normaliseren laat project ongewijzigd', JSON.stringify(normalizeProject(JSON.parse(JSON.stringify(p)))) === JSON.stringify(p));

  // 10b. version and export time in every generated TIA block
  const pvv = newProject("Kees' pool");
  const vTitle = new RegExp(`^TITLE = '.* - VT Designer ${APP_VERSION.replace('.', '\\.')}, \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d'$`, 'm');
  for (const [nm, src] of [['pool-DB', tiaSource(pvv)], ['interface-DB', tiaIoDb(pvv)], ['koppel-FC', tiaIoMap(pvv)]]) {
    check(`${nm}: titel met designerversie en tijdstip`, vTitle.test(src), src.split('\n').find((l) => l.startsWith('TITLE')));
    check(`${nm}: VERSION ${APP_VERSION}`, src.includes(`\nVERSION : ${APP_VERSION}\n`));
  }
  check("titel: ' in de projectnaam als $'", tiaSource(pvv).includes("Object pool \"Kees$' pool\""));
  check('sclText: $ en \' ontsnapt', sclText("a$b'c") === "'a$$b$'c'");

  // 10c. meter and arched bar graph: arc anticlockwise from start to end, clockwise value starts at the end angle
  const needle = (start, end, value, options = 15) => {
    const pm = newProject();
    const m = addObject(pm, 17, { width: 100, startAngle: start, endAngle: end, options, value, minValue: 0, maxValue: 100 });
    pm.objects[1000].children = [{ id: m.id, x: 0, y: 0 }];
    const svg = renderRoot(pm, 1000).markup;
    const g = svg.match(/<line x1="50" y1="50" x2="([-\d.e]+)" y2="([-\d.e]+)"/);
    return g ? [Number(g[1]), Number(g[2])] : [NaN, NaN];
  };
  const [x0, y0] = needle(158, 112, 0), [x5, y5] = needle(158, 112, 50), [x9, y9] = needle(158, 112, 100);
  check('meter 316°→224° met de klok mee: minimum linksonder', x0 < 50 && y0 > 50, `${x0},${y0}`);
  check('meter 316°→224° met de klok mee: midden boven', Math.abs(x5 - 50) < 1 && y5 < 50, `${x5},${y5}`);
  check('meter 316°→224° met de klok mee: maximum rechtsonder', x9 > 50 && y9 > 50, `${x9},${y9}`);
  const [xb, yb] = needle(112, 158, 50);
  check('meter 224°→316° (zoals op de terminal): wijzer onderaan', Math.abs(xb - 50) < 1 && yb > 50, `${xb},${yb}`);
  const [xa, ya] = needle(158, 112, 0, 7);
  check('meter tegen de klok in: minimum bij de beginhoek (rechtsonder)', xa > 50 && ya > 50, `${xa},${ya}`);

  // 12. task controller: DDOP objects, generator and what the PLC does with sections
  const objs = [
    { table: 'DVC', id: 0, designator: 'Spuit', softwareVersion: '1.0', name: [1, 2, 3, 4, 5, 6, 7, 8], serial: '42', structureLabel: 'ABCDE00', localization: [101, 110, 0x40, 0, 0, 0, 255] },
    { table: 'DET', id: 1, type: 1, designator: 'Spuit', number: 0, parent: 0, children: [2, 3] },
    { table: 'DPD', id: 2, ddi: 141, props: 1, triggers: 8, designator: 'Werkstand', presentation: 0xffff },
    { table: 'DPT', id: 3, ddi: 134, value: -1500, designator: 'X', presentation: 4 },
    { table: 'DVP', id: 4, offset: 0, scale: 0.001, decimals: 2, unit: 'm' },
  ];
  const dvcBytes = ddopObject(objs[0]);
  check('DDOP: DVC begint met "DVC", ID, lengte en naam', String.fromCharCode(...dvcBytes.slice(0, 3)) === 'DVC' && dvcBytes[3] === 0 && dvcBytes[5] === 5);
  check('DDOP: DPT met negatieve waarde', [...ddopObject(objs[3]).slice(7, 11)].join(',') === '36,250,255,255');
  const rt = parseDdop(Uint8Array.from(objs.flatMap((o) => [...ddopObject(o)])));
  rt[0].structureLabel = String.fromCharCode(...rt[0].structureLabel);
  rt[4].scale = Math.round(rt[4].scale * 1e6) / 1e6;
  check('DDOP: alle objecttypes heen en terug', JSON.stringify(rt) === JSON.stringify(objs), JSON.stringify(rt));
  check('DDOP: geldige mini-pool', checkDdop(objs).length === 0, JSON.stringify(checkDdop(objs)));
  check('DDOP: verwijzing naar onbestaand kind gemeld', checkDdop([...objs.slice(0, 1), { ...objs[1], children: [2, 99] }, ...objs.slice(2)]).some((e) => /99/.test(e.text)));

  const tb = buildDdop({ maxSections: 20, sectionWidth: 3000, products: [{ name: 'Water', kind: 'volume', capacity: 3000 }, { name: 'Korrel', kind: 'mass', capacity: 500 }] });
  check('TC-werktuig: geldige DDOP', tb.errors.length === 0, JSON.stringify(tb.errors));
  const back = parseDdop(tb.bytes);
  check('TC-werktuig: DDOP opnieuw in te lezen', back.length === tb.objects.length);
  check('TC-werktuig: NAME en structuurlabel op de opgegeven plaats',
    [...tb.bytes.slice(tb.nameOffset, tb.nameOffset + 8)].join() === '57,48,0,0,0,129,0,32' && String.fromCharCode(...tb.bytes.slice(tb.labelOffset, tb.labelOffset + 7)) === tb.structureLabel);
  check('TC-werktuig: 20 secties en 2 groepen samengevatte werkstanden',
    back.filter((o) => o.table === 'DET' && o.type === 4).length === 20 && back.filter((o) => o.ddi === DDI.setpointCondensedWorkState + 1).length === 1);
  check('TC-werktuig: secties symmetrisch', sectionY(1, 2, 3000) === -1500 && sectionY(2, 2, 3000) === 1500);
  for (const n of [1, 16, 17]) {
    const pool = poolForSections(tb, n, { width: Array(20).fill(2500), y: Array.from({ length: 20 }, (_, i) => sectionY(i + 1, n, 2500)) });
    const po = parseDdop(pool);
    const boomO = po.find((o) => o.table === 'DET' && o.type === 2);
    const widths = po.filter((o) => o.table === 'DPT' && o.ddi === DDI.actualWorkingWidth).map((o) => o.value);
    check(`TC-werktuig met ${n} sectie(s): geldige pool`, checkDdop(po).length === 0, JSON.stringify(checkDdop(po)));
    check(`TC-werktuig met ${n} sectie(s): ${n} secties, ${Math.ceil(n / 16)} groep(en), breedte aangepast`,
      po.filter((o) => o.table === 'DET' && o.type === 4).length === n && boomO.children.length === tb.boom.fixedRefs + 2 * Math.ceil(n / 16) && widths.length === n && widths.every((w) => w === 2500));
  }

  const tdepth = buildDdop({ maxSections: 4, products: [{ name: 'Diepte', kind: 'tillageDepth' }, { name: 'Zaad', kind: 'count' }] });
  const depthEl = tdepth.objects.find((o) => o.table === 'DET' && o.designator === 'Diepte');
  check('TC-werktuig: diepte als functie-element met DDI 51/52', tdepth.errors.length === 0 && depthEl.type === 2 &&
    tdepth.pd.some((r) => r.ddi === 51 && r.role === 'setpoint' && r.settable) && tdepth.pd.some((r) => r.ddi === 52 && r.role === 'actual'));
  check('TC-werktuig: procesdatatabel met rollen', tdepth.pd.length > 0 && tdepth.pd.every((r) => r.role) &&
    tdepth.pd.filter((r) => r.role === 'setpointCondensed').length === 1 && tdepth.pd.some((r) => r.role === 'sectionControlState' && r.settable));

  const tg = buildDdop({ maxSections: 2, products: [{ name: 'Druk', kind: 'ddi:193' }, { name: 'Afstand', kind: 'ddi:16' }] });
  check('TC-werktuig: elk DDI-paar uit de database bruikbaar', KIND_CHOICES.length > 60 && KIND_CHOICES.every(([k]) => kindOf(k)));
  check('TC-werktuig: Product Pressure (DDI 193/194) in Pa met 1 decimaal', tg.errors.length === 0 && kindOf('ddi:193').rate.join() === 'Pa,0.1,1' &&
    tg.pd.some((r) => r.ddi === 193 && r.role === 'setpoint') && tg.objects.some((o) => o.table === 'DET' && o.designator === 'Druk' && o.type === 2));

  const pt = newProject('TC');
  pt.implement.enabled = true;
  pt.implement.maxSections = 12;
  const tcSrc = tiaTcPool(pt);
  const tcB = buildDdop(pt.implement);
  check('TC-pool: één data-toewijzing per byte', (tcSrc.match(/data\[\d+\] := 16#/g) || []).length === tcB.bytes.length);
  check('TC-pool: één objectregel per object', (tcSrc.match(/objStart\[\d+\] := /g) || []).length === tcB.entries.length && tcSrc.includes(`objCount := ${tcB.entries.length};`));
  check('TC-pool: titel met versie', /^TITLE = 'DDOP "Werktuig", max\. 12 secties - VT Designer /m.test(tcSrc));
  check('TC-listing: elk object een regel', ddopListing(pt).split('\n').filter((l) => /^\s*\d+\s+\d+\s+(DVC|DET|DPD|DPT|DVP)/.test(l)).length === tcB.entries.length);
  check('nieuw project: werktuig standaard uit', newProject().implement.enabled === false && Array.isArray(newProject().implement.products));

  // 12b. TC_Io and TC_IoMap: the FC only uses declared fields, blocks balanced, one table row per process data
  const tcPd = ['element', 'ddi', 'settable', 'value', 'fromTc', 'timeInterval', 'changeThreshold', 'lastSent', 'tSent', 'sent'];
  const tcCtrl = ['connected', 'tcVersion', 'taskActive', 'sectionCount'];
  for (const [nm, imp] of [['standaard', {}], ['20 secties, 3 instelwaarden', { maxSections: 20, products: [{ name: 'Water', kind: 'volume', capacity: 100 }, { name: 'Diepte', kind: 'tillageDepth' }, { name: 'Druk', kind: 'ddi:193' }] }], ['zonder instelwaarde', { products: [] }]]) {
    const pj = newProject('TC'); Object.assign(pj.implement, imp, { enabled: true });
    const tb2 = buildDdop(pj.implement);
    const io = tiaTcIo(pj), map = tiaTcIoMap(pj);
    const declared = new Set();
    let section = null;
    for (const line of io.split('\n')) {
      const m = line.match(/^ {6}(\w+) : Struct/);
      if (m) section = m[1];
      const f = line.match(/^ {9}(\w+) :/);
      if (f && section) declared.add(`${section}.${f[1]}`);
    }
    const used = [...map.matchAll(/"TC_Io"\.(\w+)(?:\[[^\]]*\])?\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`)
      .filter((u) => !(u.startsWith('sys.pd') || u.startsWith('sys.ctrl')));
    const pdFields = [...map.matchAll(/\.sys\.pd\[\d+\]\.(\w+)/g)].map((m) => m[1]);
    const ctrlFields = [...map.matchAll(/\.sys\.ctrl\.(\w+)/g)].map((m) => m[1]);
    const missing = [...used.filter((u) => !declared.has(u)), ...pdFields.filter((f) => !tcPd.includes(f)), ...ctrlFields.filter((f) => !tcCtrl.includes(f))];
    check(`TC-interface ${nm}: koppel-FC gebruikt enkel velden uit de DB`, missing.length === 0, missing.join(', '));
    const code = map.replace(/\/\/.*$/gm, '');
    const bal = ['IF', 'FOR', 'REGION'].every((k) => (code.match(new RegExp(`\\b${k}\\b`, 'g')) || []).length === (code.match(new RegExp(`\\bEND_${k}\\b`, 'g')) || []).length);
    check(`TC-interface ${nm}: IF/FOR/REGION in balans`, bal);
    check(`TC-interface ${nm}: één tabelregel per procesdata`, (io.match(/sys\.pd\[\d+\]\.element := /g) || []).length === tb2.pd.length && io.includes(`pd : Array[0..${tb2.pd.length - 1}] of "typeTcPd";`));
  }
  check('REAL-literals voor SCL', realLit(10) === '10.0' && realLit(0.01) === '0.01' && realLit(0.0001) === '1.0E-4' && realLit(1e-7) === '1.0E-7');

  // 13. CODESYS: translation of SCL (blocks, UDTs, DBs) and the PLCopen XML
  const fbSrc = [
    '// kop van het bestand',
    'FUNCTION_BLOCK "X"', "TITLE = 'Test - versie 1.0'", "{ S7_Optimized_Access := 'TRUE' }", 'VERSION : 1.0', '//x versie 1.0',
    '   VAR_INPUT', '      a : Byte;   // ingang', '      txt : String[10];', '      hwIdCmCan : HW_IO;', '      canStatus : Byte;', '      rxProxyIndex : Byte := 2;', '   END_VAR',
    '   VAR_IN_OUT', '      rxProxyIn : "LCan_typeRcvInTransparentMessage";', '      rxProxyOut : "LCan_typeRcvOutTransparentMessage";', '   END_VAR',
    '   VAR', '      st : Int;', '      buf : Array[0..3] of Char;', '      t : String;', '      ff : Array[0..7] of Byte := [8(16#FF)];', '      rcv : "LCan_RcvTransparentMessage";', '   END_VAR',
    'BEGIN', '\tREGION Iets',
    '\t    #st := WORD_TO_INT(SHL(IN := BYTE_TO_WORD(#a), N := SHR(IN := 16#10, N := 1)));   // "x" #y',
    '\t    #buf[0] := BYTE_TO_CHAR(#a);', '\t    #a := CHAR_TO_BYTE(#t[#st + 1]);',
    '\t    #st := LOWER_BOUND(ARR := #buf, DIM := 1) + DINT_TO_INT(TIME_TO_DINT(TIME_TCK()));', "\t    #txt := 'a#b \"c\" $'x';",
    '\t    #rcv(enable := TRUE,', '\t         canModulStatusByte := #canStatus,', '\t         inputArea := #rxProxyIn,', '\t         outputArea := #rxProxyOut,', '\t         messageData := #ff);',
    '\tEND_REGION', 'END_FUNCTION_BLOCK'].join('\n');
  const [fbObj] = translateScl(fbSrc, '9.9');
  check('CODESYS: SHL/SHR, #, quotes and reserved names translated',
    fbObj.impl.includes('step := WORD_TO_INT(SHL(BYTE_TO_WORD(a), SHR(16#10, 1)));   // "x" #y'), fbObj.impl.split('\n')[1]);
  check('CODESYS: Char, String index from 0, LOWER_BOUND, TIME()',
    fbObj.impl.includes('buf[0] := (a);') && fbObj.impl.includes('a := t[(step + 1) - 1];') && fbObj.impl.includes('LOWER_BOUND(buf, 1)')
    && fbObj.impl.includes('TIME_TO_DINT(TIME())'));
  check('CODESYS: strings untouched, REGION as comment', fbObj.impl.includes(`txt := 'a#b "c" $'x';`) && fbObj.impl.includes('// ---- Iets') && !/REGION/.test(fbObj.impl));
  check('CODESYS: declarations', ['step : INT;', 'buf : ARRAY[0..3] OF BYTE;', 't : STRING(254);', 'txt : STRING(10);', 'ff : ARRAY[0..7] OF BYTE := [8(16#FF)];',
    'canNet : USINT := 0;', 'a : BYTE;\t// ingang', '// kop van het bestand'].every((x) => fbObj.decl.includes(x)) && !/canStatus|rxProxyIn\b|HW_IO|"/.test(fbObj.decl.replace(/\/\/.*$/gm, '')));
  check('CODESYS: CM CAN parameters become the CL2 layer', fbObj.impl.includes('netId := canNet,') && fbObj.impl.includes('proxyIndex := rxProxyIndex,') && !/inputArea|canModulStatusByte/.test(fbObj.impl));
  const [noHw] = translateScl(['FUNCTION_BLOCK "Y"', '   VAR_INPUT', '      canStatus : Byte;', '   END_VAR',
    '   VAR_IN_OUT', '      rxProxyIn : "LCan_typeRcvInTransparentMessage";', '      rxProxyOut : "LCan_typeRcvOutTransparentMessage";', '   END_VAR',
    '   VAR', '      rcv : "LCan_RcvTransparentMessage";', '      b : Array[0..7] of Byte;', '   END_VAR', 'BEGIN',
    '\t    #rcv(enable := TRUE,', '\t         canModulStatusByte := #canStatus,', '\t         inputArea := #rxProxyIn,', '\t         outputArea := #rxProxyOut,',
    '\t         messageData := #b);', 'END_FUNCTION_BLOCK'].join('\n'), '9.9');
  check('CODESYS: without hwIdCmCan the status byte becomes canNet, without rxProxyIndex no filter list',
    noHw.decl.includes('canNet : USINT := 0;') && noHw.impl.includes('netId := canNet,') && !/proxyIndex|outputArea|canStatus/.test(noHw.impl + noHw.decl));
  check('CODESYS: parsed interface', fbObj.sections.map((s) => s.kind).join() === 'VAR_INPUT,VAR' && fbObj.sections[1].vars.some((v) => v.name === 'step' && v.type === 'INT'));
  check('CODESYS: initial values', valueText(parseValue('[8(16#FF)]')) === '[8(16#FF)]' && parseValue("(a := 1, b := 'x;y')").members[1].value.text === "'x;y'");

  const pcs = newProject('CS');
  pcs.implement.enabled = true;
  const csObjs = codesysProjectObjects(pcs);
  const csGvl = (n) => csObjs.find((o) => o.kind === 'gvl' && o.name === n);
  const csPool = buildExport(pcs);
  check('CODESYS: GVLs VT_Pool, VT_Io, TC_Pool, TC_Io and the functions', ['VT_Pool', 'VT_Io', 'TC_Pool', 'TC_Io'].every((n) => csGvl(n))
    && ['VT_IoMap', 'TC_IoMap'].every((n) => csObjs.some((o) => o.kind === 'pou' && o.name === n && o.ret === 'BOOL')));
  const poolData = csGvl('VT_Pool').vars.find((v) => v.name === 'data');
  check('CODESYS: VT_Pool.data with every byte as start value', poolData.type === `ARRAY[0..${csPool.size - 1}] OF BYTE` && poolData.init.items.length === csPool.size);
  const ioSys = csGvl('VT_Io').vars.find((v) => v.name === 'sys');
  const plan = ioPlan(pcs);
  check('CODESYS: VT_Io.sys tables initialised per object', ioSys.type === 'VT_Io_sys'
    && ['num', 'str', 'flag', 'key'].every((t) => (ioSys.init.members.find((m) => m.name === t)?.value.items.length ?? 0) === Math.max(1, plan.tables[t].length)));
  check('CODESYS: a DUT per inline Struct', ['VT_Io_status', 'VT_Io_out', 'VT_Io_in', 'VT_Io_sys', 'VT_Pool_id', 'TC_Io_par', 'TC_Io_sys'].every((n) => csObjs.some((o) => o.kind === 'dut' && o.name === n)));
  check('CODESYS: TC_Pool.info as struct initialisation', /info : typeTcPoolInfo := \(size := \d+, maxSections := 8,/.test(csGvl('TC_Pool').decl));
  check('CODESYS: no SCL left in the project objects', csObjs.every((o) => !/(^|[^0-9A-Za-z_])#[A-Za-z_]|"[A-Za-z_]|\bREGION\b|IN :=/.test(mask(o.decl + (o.impl || '')).text)));
  const round = parseStObjects(stText(csObjs));
  check('CODESYS: ST text read back', round.length === csObjs.length && round.every((o, i) => o.kind === csObjs[i].kind && o.name === csObjs[i].name));
  const csXml = plcopenXml(csObjs, 'CS');
  const countTag = (t) => (csXml.match(new RegExp(`<${t}[ >]`, 'g')) || []).length;
  check('CODESYS: PLCopen XML with every object', countTag('pou') === 2 && countTag('dataType') === csObjs.filter((o) => o.kind === 'dut').length
    && countTag('globalVars') === 4 && countTag('InterfaceAsPlainText') === 2 && !/[\u0001\u0002\u0003]/.test(csXml));
  // PLCopen TC6: <data> holds exactly one element (CODESYS: "ongeldig onderliggend element globalVars")
  check('CODESYS: every <data> with exactly one element', [csXml, xml, plcopenXml(csObjs.filter((o) => o.kind !== 'gvl'), 'NoGvl')]
    .every((doc) => dataChildren(doc).length > 0 && dataChildren(doc).every((n) => n === 1)));
  check('CODESYS: version in every object', csObjs.every((o) => o.decl.includes(`VT Designer ${APP_VERSION}`)));

  // 11. zip for the TIA download (stored files)
  check('CRC-32 van "hello"', crc32(utf8('hello')) === 0x3610a686);
  const z = zip([{ name: 'a.txt', data: 'hello' }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }], new Date(2026, 10, 25, 12, 0, 0));
  const u32 = (i) => (z[i] | (z[i + 1] << 8) | (z[i + 2] << 16) | (z[i + 3] << 24)) >>> 0;
  const end = z.length - 22;
  check('zip: lokale kop, centrale map en eindrecord', u32(0) === 0x04034b50 && u32(end) === 0x06054b50 && u32(u32(end + 16)) === 0x02014b50);
  check('zip: 2 bestanden, juiste lengte', (z[end + 10] | (z[end + 11] << 8)) === 2 && z.length === 2 * 30 + 5 + 5 + 5 + 3 + 2 * 46 + 5 + 5 + 22);
  check('utf8: é en € juist', utf8('é€').join(',') === '195,169,226,130,172');
  check('zip: inhoud ongewijzigd opgeslagen', String.fromCharCode(...z.slice(30 + 5, 30 + 5 + 5)) === 'hello' && u32(14) === 0x3610a686);

  log(fails ? `\n${fails} test(s) mislukt` : '\nAlle tests geslaagd');
  return fails;
}
