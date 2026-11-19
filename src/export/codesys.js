// CODESYS: a global variable list, as text (paste into a GVL) or as PLCopen XML
// (Project › Import PLCopenXML).
import { TYPES } from '../iso/schema.js';
import { APP, buildExport, h2, plcName, stamp, summary } from './common.js';

export function codesysGvl(p) {
  const ex = buildExport(p);
  const gvl = p.export.codesysGvl || 'GVL_VtPool';
  const last = Math.max(0, ex.size - 1);
  const n = ex.pool.chunks.length;
  const L = [
    '// =====================================================================',
    `//  ${gvl} – object pool "${p.name}" – gegenereerd door ${APP} (${stamp()})`,
    `//  ${summary(p, ex)}.`,
    `//  Application › Object toevoegen › Globale variabelenlijst "${gvl}", deze tekst als declaratie plakken.`,
    `//  Gebruik: ${gvl}.Pool, ${gvl}.POOL_SIZE, ${gvl}.ID_<naam>. Niet met de hand aanpassen: opnieuw exporteren.`,
    '// =====================================================================',
    "{attribute 'qualified_only'}",
    'VAR_GLOBAL CONSTANT',
    `\tPOOL_SIZE : UDINT := ${ex.size};\t// aantal bytes in Pool`,
    `\tCHUNK_COUNT : UINT := ${n};\t// aantal Object Pool Transfer-delen (elk enkel hele objecten)`,
    '\t// object-ID\'s',
  ];
  for (const o of ex.named) L.push(`\tID_${plcName(o.name)} : UINT := ${o.id};\t// ${TYPES[o.type].name}`);
  if (ex.strings.length) {
    L.push('\t// vaste lengte van tekstobjecten (maximum voor Change String Value)');
    for (const o of ex.strings) L.push(`\tLEN_${plcName(o.name)} : UINT := ${o.length};`);
  }
  L.push('END_VAR', 'VAR_GLOBAL',
    `\tChunkStart : ARRAY[0..${n - 1}] OF UDINT := [${ex.pool.chunks.map((c) => c.start).join(', ')}];`,
    `\tChunkLength : ARRAY[0..${n - 1}] OF UINT := [${ex.pool.chunks.map((c) => c.length).join(', ')}];`,
    `\tPool : ARRAY[0..${last}] OF BYTE := [`);
  ex.pool.entries.forEach((e, ei) => {
    L.push(`\t\t// object ${e.obj.id} ${e.obj.name}: ${TYPES[e.obj.type].name} (${e.length} bytes, vanaf ${e.offset})`);
    for (let k = 0; k < e.length; k += 16) {
      const row = Array.from(e.bytes.slice(k, k + 16), h2).join(', ');
      const end = ei === ex.pool.entries.length - 1 && k + 16 >= e.length;
      L.push(`\t\t${row}${end ? '' : ','}`);
    }
  });
  L.push('\t];', 'END_VAR', '');
  return L.join('\n');
}

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function codesysXml(p) {
  const ex = buildExport(p);
  const gvl = p.export.codesysGvl || 'GVL_VtPool';
  const now = new Date().toISOString().slice(0, 19);
  const v = (name, type, init, doc) =>
    `        <variable name="${x(name)}">\n          <type>${type}</type>\n          <initialValue>${init}</initialValue>\n` +
    (doc ? `          <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">${x(doc)}</xhtml></documentation>\n` : '') +
    '        </variable>';
  const arr = (n, base) => `<array><dimension lower="0" upper="${n - 1}" /><baseType><${base} /></baseType></array>`;
  const vals = (list) => `<arrayValue>${list.map((s) => `<value><simpleValue value="${s}" /></value>`).join('')}</arrayValue>`;
  const simple = (s) => `<simpleValue value="${s}" />`;
  const vars = [
    v('POOL_SIZE', '<UDINT />', simple(ex.size), 'aantal bytes in Pool'),
    v('CHUNK_COUNT', '<UINT />', simple(ex.pool.chunks.length), 'aantal Object Pool Transfer-delen'),
    ...ex.named.map((o) => v('ID_' + plcName(o.name), '<UINT />', simple(o.id), TYPES[o.type].name)),
    ...ex.strings.map((o) => v('LEN_' + plcName(o.name), '<UINT />', simple(o.length), 'vaste lengte')),
    v('ChunkStart', arr(ex.pool.chunks.length, 'UDINT'), vals(ex.pool.chunks.map((c) => c.start))),
    v('ChunkLength', arr(ex.pool.chunks.length, 'UINT'), vals(ex.pool.chunks.map((c) => c.length))),
    v('Pool', arr(Math.max(1, ex.size), 'BYTE'), vals(Array.from(ex.pool.bytes, h2)), `object pool "${p.name}" – ${summary(p, ex)}`),
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0200">
  <fileHeader companyName="" productName="${APP}" productVersion="1" creationDateTime="${now}" />
  <contentHeader name="${x(p.name)}" modificationDateTime="${now}">
    <coordinateInfo>
      <fbd><scaling x="1" y="1" /></fbd>
      <ld><scaling x="1" y="1" /></ld>
      <sfc><scaling x="1" y="1" /></sfc>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes />
    <pous />
  </types>
  <instances>
    <configurations />
  </instances>
  <addData>
    <data name="http://www.3s-software.com/plcopenxml/globalvars" handleUnknown="implementation">
      <globalVars name="${x(gvl)}">
${vars.join('\n')}
        <addData>
          <data name="http://www.3s-software.com/plcopenxml/attributes" handleUnknown="implementation">
            <Attributes>
              <Attribute Name="qualified_only" Value="" />
            </Attributes>
          </data>
        </addData>
      </globalVars>
    </data>
  </addData>
</project>
`;
}
