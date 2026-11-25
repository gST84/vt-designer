// TIA Portal: DB source (.db) with the pool as Array of Byte, the TP chunk table and the object IDs.
// Import: external source files › add › "Generate blocks from source". The fields size, chunkCount,
// chunkStart, chunkLength and data match the inputs of FB VT_TestClient (vt_test_project).
import { TYPES } from '../iso/schema.js';
import { APP_VERSION, blockTitle, buildExport, generatedBy, h2, plcName, summary } from './common.js';

export function tiaSource(p) {
  const ex = buildExport(p);
  const db = p.export.tiaDb || 'VT_Pool';
  const last = Math.max(0, ex.size - 1);
  const nChunks = ex.pool.chunks.length;
  const L = [];
  L.push(
    '// =====================================================================',
    `//  ${db} – object pool "${p.name}" – ${generatedBy()}`,
    `//  ${summary(p, ex)}.`,
    '//  Niet met de hand aanpassen: opnieuw exporteren.',
    '// =====================================================================',
    `DATA_BLOCK "${db}"`,
    blockTitle(`Object pool "${p.name}", ${ex.size} bytes`),
    "{ S7_Optimized_Access := 'TRUE' }",
    `VERSION : ${APP_VERSION}`,
    'NON_RETAIN',
    '   VAR ',
    '      size : UDInt;   // aantal bytes in data',
    `      chunkCount : UInt;   // aantal Object Pool Transfer-delen (elk enkel hele objecten)`,
    `      chunkStart : Array[0..${nChunks - 1}] of UDInt;   // beginindex van elk deel in data`,
    `      chunkLength : Array[0..${nChunks - 1}] of UInt;   // lengte van elk deel`,
    '      id : Struct   // object-ID\'s',
  );
  for (const o of ex.named) L.push(`         ${plcName(o.name)} : UInt := ${o.id};   // ${TYPES[o.type].name}`);
  L.push('      END_STRUCT;');
  if (ex.strings.length) {
    L.push('      textLength : Struct   // vaste lengte van tekstobjecten (maximum voor Change String Value)');
    for (const o of ex.strings) L.push(`         ${plcName(o.name)} : UInt := ${o.length};`);
    L.push('      END_STRUCT;');
  }
  L.push(`      data : Array[0..${last}] of Byte;`, '   END_VAR', '', '', 'BEGIN', `   size := ${ex.size};`, `   chunkCount := ${nChunks};`);
  ex.pool.chunks.forEach((c, i) => L.push(`   chunkStart[${i}] := ${c.start}; chunkLength[${i}] := ${c.length};   // ${c.count} objecten`));
  let chunk = 0;
  for (const e of ex.pool.entries) {
    if (ex.pool.chunks[chunk + 1]?.start === e.offset) {
      chunk++;
      L.push(`   // ======== deel ${chunk} (vanaf data[${e.offset}])`);
    }
    L.push(`   // ---- object ${e.obj.id} ${e.obj.name}: ${TYPES[e.obj.type].name} (${e.length} bytes)`);
    for (let k = 0; k < e.length; k += 8) {
      const parts = [];
      for (let j = k; j < Math.min(k + 8, e.length); j++) parts.push(`data[${e.offset + j}] := ${h2(e.bytes[j])};`);
      L.push('   ' + parts.join(' '));
    }
  }
  L.push('', 'END_DATA_BLOCK', '');
  return L.join('\n');
}
