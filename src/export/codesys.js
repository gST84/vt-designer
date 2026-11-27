// CODESYS: a global variable list, as text (paste into a GVL) or as PLCopen XML
// (Project › Import PLCopenXML), and the full package for VT_Client / TC_Client: the TIA sources
// translated by scl2st.js plus the CAN layer LCan_CL2.st, written as PLCopen XML or as ST text.
import { TYPES } from '../iso/schema.js';
import { APP, APP_VERSION, buildExport, generatedBy, h2, plcName, summary } from './common.js';
import { parseType, parseValue, parseStObjects, stText, translateScl } from './scl2st.js';
import { tiaSource } from './tia.js';
import { tiaIoDb, tiaIoMap } from './io.js';
import { tiaTcPool } from './tcpool.js';
import { tiaTcIo, tiaTcIoMap } from './tcio.js';

export function codesysGvl(p) {
  const ex = buildExport(p);
  const gvl = p.export.codesysGvl || 'GVL_VtPool';
  const last = Math.max(0, ex.size - 1);
  const n = ex.pool.chunks.length;
  const L = [
    '// =====================================================================',
    `//  ${gvl} – object pool "${p.name}" – ${generatedBy()}`,
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
  <fileHeader companyName="" productName="${APP}" productVersion="${APP_VERSION}" creationDateTime="${now}" />
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

// ---------- PLCopen XML for translated objects ----------

const typeXml = (t) => {
  const p = typeof t === 'string' ? parseType(t) : t;
  switch (p.kind) {
    case 'base': return `<${p.name === 'TIME_OF_DAY' ? 'TOD' : p.name === 'DATE_AND_TIME' ? 'DT' : p.name} />`;
    case 'string': return `<${p.wide ? 'wstring' : 'string'} length="${p.len}" />`;
    case 'array':
      return `<array>${p.dims.map((d) => (d === '*' ? '<dimension lower="*" upper="*" />' : `<dimension lower="${x(d[0])}" upper="${x(d[1])}" />`)).join('')}`
        + `<baseType>${typeXml(p.of)}</baseType></array>`;
    case 'pointer': return `<pointer><baseType>${typeXml(p.of)}</baseType></pointer>`;
    default: return `<derived name="${x(p.name)}" />`;
  }
};
const valueXml = (v) => {
  if (typeof v === 'string') v = parseValue(v);
  if (v.kind === 'simple') return `<simpleValue value="${x(v.text)}" />`;
  if (v.kind === 'array') return `<arrayValue>${v.items.map((it) => `<value${it.rep > 1 ? ` repetitionValue="${it.rep}"` : ''}>${valueXml(it.value)}</value>`).join('')}</arrayValue>`;
  return `<structValue>${v.members.map((m) => `<value member="${x(m.name)}">${valueXml(m.value)}</value>`).join('')}</structValue>`;
};
const xhtml = (s) => `<xhtml xmlns="http://www.w3.org/1999/xhtml">${x(s)}</xhtml>`;
const varXml = (v, ind) => [
  `${ind}<variable name="${x(v.name)}">`,
  `${ind}  <type>${typeXml(v.type)}</type>`,
  ...(v.init !== null && v.init !== undefined ? [`${ind}  <initialValue>${valueXml(v.init)}</initialValue>`] : []),
  ...(v.comment ? [`${ind}  <documentation>${xhtml(v.comment)}</documentation>`] : []),
  `${ind}</variable>`,
].join('\n');

const SECTION_XML = { VAR_INPUT: 'inputVars', VAR_OUTPUT: 'outputVars', VAR_IN_OUT: 'inOutVars', VAR: 'localVars', VAR_TEMP: 'tempVars', 'VAR CONSTANT': 'localVars' };

/**
 * Fixed ObjectId of an object (a GUID from its kind and name): CODESYS uses it to place the object in the folder
 * structure of the import (projectstructure), and a new export of the same object keeps the same id.
 */
export function objectId(o) {
  const key = `vt-designer:${o.kind}:${o.name.toLowerCase()}`;
  const hex = [0x811c9dc5, 0x2c1b3c6d, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; // spread the last characters over every digit
    return h.toString(16).padStart(8, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** <addData> with one <data> per entry: [name, handleUnknown, element]. */
const addData = (ind, entries) => [
  `${ind}<addData>`,
  ...entries.map(([name, handle, el]) => `${ind}  <data name="http://www.3s-software.com/plcopenxml/${name}" handleUnknown="${handle}">\n${ind}    ${el}\n${ind}  </data>`),
  `${ind}</addData>`,
].join('\n');
const idData = (o) => ['objectid', 'discard', `<ObjectId>${objectId(o)}</ObjectId>`];

function pouXml(o) {
  const parts = [];
  if (o.ret) parts.push(`          <returnType>${typeXml(o.ret)}</returnType>`);
  for (const s of o.sections) {
    const tag = SECTION_XML[s.kind];
    if (!tag || !s.vars.length) continue;
    parts.push(`          <${tag}${s.kind === 'VAR CONSTANT' ? ' constant="true"' : ''}>`, ...s.vars.map((v) => varXml(v, '            ')), `          </${tag}>`);
  }
  return [
    `      <pou name="${x(o.name)}" pouType="${o.pouType}">`,
    '        <interface>',
    ...parts,
    '        </interface>',
    `        <body><ST>${xhtml(o.impl)}</ST></body>`,
    addData('        ', [['interfaceasplaintext', 'implementation', `<InterfaceAsPlainText>${xhtml(o.decl)}</InterfaceAsPlainText>`], idData(o)]),
    '      </pou>',
  ].join('\n');
}

const dutXml = (o) => [
  `      <dataType name="${x(o.name)}">`,
  '        <baseType>',
  '          <struct>',
  ...o.fields.map((v) => varXml(v, '            ')),
  '          </struct>',
  '        </baseType>',
  addData('        ', [idData(o)]),
  '      </dataType>',
].join('\n');

const gvlXml = (o) => [
  `      <globalVars name="${x(o.name)}">`,
  ...o.vars.map((v) => varXml(v, '        ')),
  addData('        ', [
    ...((o.attrs || []).length ? [['attributes', 'implementation', `<Attributes>${o.attrs.map((a) => `<Attribute Name="${x(a)}" Value="" />`).join('')}</Attributes>`]] : []),
    idData(o),
  ]),
  '      </globalVars>',
].join('\n');

/** Objects (from translateScl / parseStObjects) → one PLCopen XML file for Project › Import PLCopenXML. */
export function plcopenXml(objects, name) {
  const now = new Date().toISOString().slice(0, 19);
  const duts = objects.filter((o) => o.kind === 'dut');
  const pous = objects.filter((o) => o.kind === 'pou');
  const gvls = objects.filter((o) => o.kind === 'gvl');
  return `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0200">
  <fileHeader companyName="" productName="${APP}" productVersion="${APP_VERSION}" creationDateTime="${now}" />
  <contentHeader name="${x(name)}" modificationDateTime="${now}">
    <coordinateInfo>
      <fbd><scaling x="1" y="1" /></fbd>
      <ld><scaling x="1" y="1" /></ld>
      <sfc><scaling x="1" y="1" /></sfc>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes>
${duts.map(dutXml).join('\n')}
    </dataTypes>
    <pous>
${pous.map(pouXml).join('\n')}
    </pous>
  </types>
  <instances>
    <configurations />
  </instances>
  <addData>
${[...gvls.map(gvlData), structureData(objects)].join('\n')}
  </addData>
</project>
`;
}

/**
 * The folders of the import (as CODESYS exports them): every object with `folder` (a path such as ['ISOBUS', 'CAN'])
 * lands in that folder below the node selected for the import, so the folders need not be made again by hand.
 */
function structureData(objects) {
  const root = { folders: new Map(), objects: [] };
  for (const o of objects) {
    let node = root;
    for (const f of o.folder || []) {
      if (!node.folders.has(f)) node.folders.set(f, { folders: new Map(), objects: [] });
      node = node.folders.get(f);
    }
    node.objects.push(o);
  }
  const lines = [];
  const walk = (node, ind) => {
    for (const [name, sub] of node.folders) {
      lines.push(`${ind}<Folder Name="${x(name)}">`);
      walk(sub, ind + '  ');
      lines.push(`${ind}</Folder>`);
    }
    for (const o of node.objects) lines.push(`${ind}<Object Name="${x(o.name)}" ObjectId="${objectId(o)}" />`);
  };
  walk(root, '        ');
  return [
    '    <data name="http://www.3s-software.com/plcopenxml/projectstructure" handleUnknown="discard">',
    '      <ProjectStructure>',
    ...lines,
    '      </ProjectStructure>',
    '    </data>',
  ].join('\n');
}

/** One GVL as additional data. PLCopen allows a single element per <data>: one <data> per GVL, as CODESYS writes it. */
const gvlData = (o) => [
  '    <data name="http://www.3s-software.com/plcopenxml/globalvars" handleUnknown="implementation">',
  gvlXml(o),
  '    </data>',
].join('\n');

// ---------- the CODESYS package ----------

/** The designer's own exports for the project, translated: VT_Pool, VT_Io, VT_IoMap (and the TC parts). */
export function codesysProjectObjects(p) {
  const sources = [tiaSource(p), tiaIoDb(p), tiaIoMap(p)];
  if (p.implement?.enabled) sources.push(tiaTcPool(p), tiaTcIo(p), tiaTcIoMap(p));
  return order(inFolder([FOLDER, p.name || 'Project'], sources.flatMap((s) => translateScl(s, APP_VERSION))));
}

/** Top folder of the import in CODESYS; below it CAN, VT_Client, TC_Client and the project. */
export const FOLDER = 'ISOBUS';
const inFolder = (folder, objects) => objects.map((o) => ({ ...o, folder }));

/**
 * The fixed blocks, translated: `files` = { lcan, vtUdt, vtScl, tcUdt?, tcScl? } as text
 * (LCan_CL2.st and the TIA sources from isobus_project_bundle).
 */
export function codesysBlockObjects(files) {
  const out = [...inFolder([FOLDER, 'CAN'], parseStObjects(files.lcan))];
  for (const k of ['vtUdt', 'vtScl', 'tcUdt', 'tcScl']) {
    if (files[k]) out.push(...inFolder([FOLDER, k.startsWith('vt') ? 'VT_Client' : 'TC_Client'], translateScl(files[k], APP_VERSION)));
  }
  return order(out);
}

/** Data types first, then the lists of global variables, then the blocks (also the order in the ST file). */
function order(objects) {
  const rank = { dut: 0, gvl: 1, pou: 2 };
  return objects.map((o, i) => [o, i]).sort((a, b) => rank[a[0].kind] - rank[b[0].kind] || a[1] - b[1]).map((a) => a[0]);
}

/** Header of an ST file: how to use it. */
export const stHeader = (what) => [
  '// =====================================================================',
  `//  ${what} – CODESYS – ${generatedBy()}`,
  '//  Per object: "// ======== DUT|GVL|POU <naam>", de declaratie en bij een POU na "// ---- code" de',
  '//  implementatie. Liever in één keer: de PLCopen XML van dezelfde export (Project › PLCopenXML importeren).',
  '// =====================================================================',
];

export { stText };
