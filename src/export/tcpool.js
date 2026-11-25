// Task controller exports: the DDOP as TIA DB source (with the tables TC_Client uses to send only the
// sections in use and to patch widths and offsets), as a binary file and as a listing.
import { buildDdop, DDI } from '../tc/build.js';
import { DET_TYPES } from '../tc/ddop.js';
import { APP_VERSION, blockTitle, generatedBy } from './common.js';

const h2 = (b) => '16#' + b.toString(16).toUpperCase().padStart(2, '0');
const ddiName = Object.fromEntries(Object.entries(DDI).map(([k, v]) => [v, k]));

export function tcSummary(b) {
  return `${b.bytes.length} bytes, ${b.objects.length} objecten, max. ${b.maxSections} secties, ${b.products.length} product(en), structuurlabel ${b.structureLabel}`;
}

export function tiaTcPool(p) {
  const b = buildDdop(p.implement);
  const db = p.export.tcDb || 'TC_Pool';
  const n = b.entries.length;
  const np = b.patches.length;
  const L = [
    '// =====================================================================',
    `//  ${db} – werktuigbeschrijving (DDOP, ISO 11783-10) "${b.implement.designator}" – ${generatedBy()}`,
    `//  ${tcSummary(b)}.`,
    '//  Voor FB TC_Client: die stuurt enkel de objecten met objSection = 0 of <= het aantal gebruikte secties,',
    '//  past breedte en positie per sectie aan (patch…) en kort de kindlijst van de boom in (boom…).',
    '//  Niet met de hand aanpassen: opnieuw exporteren.',
    '// =====================================================================',
    `DATA_BLOCK "${db}"`,
    blockTitle(`DDOP "${b.implement.designator}", max. ${b.maxSections} secties`),
    "{ S7_Optimized_Access := 'TRUE' }",
    `VERSION : ${APP_VERSION}`,
    'NON_RETAIN',
    '   VAR ',
    '      size : UDInt;   // bytes in data (met het maximum aantal secties)',
    '      maxSections : USInt;',
    '      nameOffset : UDInt;   // 8 bytes: NAME van de werkset (schrijft TC_Client)',
    '      labelOffset : UDInt;   // 7 bytes: structuurlabel; TC_Client past de laatste 2 aan',
    '      objCount : UInt;',
    `      objStart : Array[0..${n - 1}] of UDInt;   // begin van elk object in data`,
    `      objLength : Array[0..${n - 1}] of UInt;`,
    `      objSection : Array[0..${n - 1}] of USInt;   // 0 = altijd, k = enkel bij k of meer secties`,
    '      boomIndex : UInt;   // object (in objStart) van de boom',
    '      boomCountOffset : UDInt;   // UInt: aantal kinderen van de boom',
    '      boomFixedRefs : UInt;   // kinderen los van de secties; daarna 2 per groep van 16 secties',
    '      patchCount : UInt;',
    `      patchOffset : Array[0..${np - 1}] of UDInt;   // DInt in data`,
    `      patchKind : Array[0..${np - 1}] of USInt;   // 1 = breedte, 2 = X, 3 = Y (mm)`,
    `      patchSection : Array[0..${np - 1}] of USInt;`,
    `      data : Array[0..${b.bytes.length - 1}] of Byte;`,
    '   END_VAR',
    '',
    '',
    'BEGIN',
    `   size := ${b.bytes.length};`,
    `   maxSections := ${b.maxSections};`,
    `   nameOffset := ${b.nameOffset};`,
    `   labelOffset := ${b.labelOffset};`,
    `   objCount := ${n};`,
  ];
  b.entries.forEach((e, i) => L.push(`   objStart[${i}] := ${e.start}; objLength[${i}] := ${e.length}; objSection[${i}] := ${e.section};   // ${e.obj.table} ${e.obj.id} ${e.obj.designator ?? e.obj.unit ?? ''}`));
  L.push(`   boomIndex := ${b.boom.index};`, `   boomCountOffset := ${b.boom.countOffset};`, `   boomFixedRefs := ${b.boom.fixedRefs};`, `   patchCount := ${np};`);
  b.patches.forEach((q, i) => L.push(`   patchOffset[${i}] := ${q.offset}; patchKind[${i}] := ${q.kind}; patchSection[${i}] := ${q.section};`));
  for (let i = 0; i < b.bytes.length; i += 16) {
    L.push('   ' + Array.from(b.bytes.slice(i, i + 16), (x, j) => `data[${i + j}] := ${h2(x)};`).join(' '));
  }
  L.push('END_DATA_BLOCK', '');
  return L.join('\n');
}

export function ddopBytes(p) {
  return buildDdop(p.implement).bytes;
}

export function ddopListing(p) {
  const b = buildDdop(p.implement);
  const id = (x) => String(x).padStart(4);
  const L = [`DDOP "${b.implement.designator}" – ${generatedBy()}`, tcSummary(b) + '.', ''];
  if (b.errors.length) L.push('FOUTEN:', ...b.errors.map((e) => `  ${e.id ?? '-'}: ${e.text}`), '');
  for (const e of b.entries) {
    const o = e.obj;
    let d = '';
    if (o.table === 'DVC') d = `"${o.designator}" versie ${o.softwareVersion}, serie ${o.serial}, label ${o.structureLabel}`;
    if (o.table === 'DET') d = `${(DET_TYPES.find((t) => t[0] === o.type) || [0, o.type])[1]} "${o.designator}" nr ${o.number}, ouder ${o.parent}, kinderen ${o.children.join(' ')}`;
    if (o.table === 'DPD') d = `DDI ${o.ddi} ${ddiName[o.ddi] ?? ''} "${o.designator}" eig. ${o.props} trig. ${o.triggers} weergave ${o.presentation === 0xffff ? '-' : o.presentation}`;
    if (o.table === 'DPT') d = `DDI ${o.ddi} ${ddiName[o.ddi] ?? ''} = ${o.value} "${o.designator}" weergave ${o.presentation === 0xffff ? '-' : o.presentation}`;
    if (o.table === 'DVP') d = `"${o.unit}" schaal ${o.scale} offset ${o.offset} ${o.decimals} dec.`;
    L.push(`${String(e.start).padStart(5)} ${String(e.length).padStart(3)}  ${o.table} ${id(o.id)}${e.section ? ` [sectie ${e.section}]` : ''}  ${d}`);
  }
  return L.join('\n') + '\n';
}
