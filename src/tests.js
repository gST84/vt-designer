// Self-tests for the encoder, parser and exporters. Run in the browser (test.html) or headless
// on macOS with JavaScriptCore:  jsc -m tools/run-tests.mjs
import { TYPES } from './iso/schema.js';
import { encodeObject, encodePool, parsePool } from './iso/codec.js';
import { b64enc, pictureRaw, pixelsFromRaw, b64dec } from './iso/picture.js';
import { COMMANDS, decodeCommand, encodeCommand, defaultsFor, splitCommands, joinCommands } from './iso/macros.js';
import { addObject, newProject, normalizeProject, projectFromObjects, renumber, deleteObject } from './model.js';
import { validate } from './iso/validate.js';
import { tiaSource } from './export/tia.js';
import { codesysGvl, codesysXml } from './export/codesys.js';
import { listing } from './export/listing.js';
import { ioPlan, tiaIoDb, tiaIoMap, inIo } from './export/io.js';

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

/** A project with one object of every type, filled with non-default values. */
export function everyTypeProject() {
  const p = newProject('Alle types');
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
  add(2, { softKeyMask: skm.id, priority: 0, acousticSignal: 1, children: [{ id: cont.id, x: 1, y: 2 }, { id: btn.id, x: 300, y: 400 }] });
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
  const cmds = [encodeCommand(0xb3, { obj: 1, text: 'abcdefgh' }), encodeCommand(0xb4, { parent: 1, obj: 2, x: 3, y: 4 }), encodeCommand(0xa3, {})];
  check('macro-opdrachten splitsen', JSON.stringify(splitCommands(joinCommands(cmds))) === JSON.stringify(cmds));

  // 6. model operations
  const p3 = newProject();
  check('ID wijzigen werkt verwijzingen bij', renumber(p3, 11000, 11005) === null && p3.objects[1000].children[0].id === 11005);
  deleteObject(p3, 23001);
  check('verwijderen ruimt verwijzingen op', p3.objects[11001].fontAttributes === 0xffff);
  check('validatie meldt ontbrekend lettertype', validate(p3).some((m) => m.level === 'error' && m.id === 11001));

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

  log(fails ? `\n${fails} test(s) mislukt` : '\nAlle tests geslaagd');
  return fails;
}
