// Export dialog (sections TIA Portal, CODESYS and general), settings dialog and the problem list.
import { h, download, fileBase } from '../util.js';
import { encodePool } from '../iso/codec.js';
import { validate } from '../iso/validate.js';
import { tiaSource } from '../export/tia.js';
import { codesysGvl, codesysXml } from '../export/codesys.js';
import { listing } from '../export/listing.js';
import { tiaIoDb, tiaIoMap } from '../export/io.js';
import { sanitizeName, label } from '../model.js';
import { zip, utf8 } from '../zip.js';
import { tiaTcPool, ddopBytes, ddopListing } from '../export/tcpool.js';
import { tiaTcIo as tiaTcIoDb, tiaTcIoMap } from '../export/tcio.js';
import { modal, toast } from './dialogs.js';

/** The fixed PLC blocks (VT_Client, TC_Client), served from the same GitHub repository as this app. */
const BUNDLES = {
  vt: { dir: 'isobus_project_bundle/vt_client/', files: ['01_VTC_Types.udt', '02_VT_Client.scl', 'README.md'], fb: 'VT_Client' },
  tc: { dir: 'isobus_project_bundle/tc_client/', files: ['01_TCC_Types.udt', '02_TC_Client.scl', 'README.md'], fb: 'TC_Client' },
};
const FB_GITHUB = 'https://github.com/gST84/vt-designer/tree/main/isobus_project_bundle';

const SECTIONS = [
  { key: 'tia', label: 'TIA Portal', fields: ['tiaDb', 'ioDb', 'tcDb', 'tcIoDb', 'chunk'] },
  { key: 'codesys', label: 'CODESYS', fields: ['codesysGvl', 'chunk'] },
  { key: 'general', label: 'Algemeen', fields: [] },
];

// Generated files of the TIA section, in import order around the fixed blocks.
const tiaFiles = (p) => [
  { name: `${p.export.tiaDb}.db`, data: tiaSource(p) },
  { name: `${p.export.ioDb}.db`, data: tiaIoDb(p) },
  { name: `${p.export.ioDb}Map.scl`, data: tiaIoMap(p) },
];
const tcFiles = (p) => [
  { name: `${p.export.tcDb}.db`, data: tiaTcPool(p) },
  { name: `${p.export.tcIoDb}.db`, data: tiaTcIoDb(p) },
  { name: `${p.export.tcIoDb}Map.scl`, data: tiaTcIoMap(p) },
];
const renamed = (f, name) => ({ ...f, name });
const importOrder = (p) => [
  `Importvolgorde in TIA Portal: 01_VTC_Types.udt → ${tiaFiles(p).map((f) => f.name).join(' → ')} → 02_VT_Client.scl`,
  ...(p.implement.enabled ? [`Task controller: 01_TCC_Types.udt → ${tcFiles(p).map((f) => f.name).join(' → ')} → 02_TC_Client.scl`] : []),
].join('\n');

const TARGETS = [
  { key: 'tia', section: 'tia', label: 'Pool-DB', file: (p) => `${p.export.tiaDb}.db`, text: tiaSource,
    hint: 'Externe bronbestanden › Nieuw extern bestand toevoegen › dit .db-bestand › rechtsklik › Blokken genereren uit bron. Aan VT_Client: poolSize := "<DB>".size, chunkCount := "<DB>".chunkCount, pool := "<DB>".data, chunkStart := "<DB>".chunkStart, chunkLength := "<DB>".chunkLength; object-ID\'s als "<DB>".id.<naam>.' },
  { key: 'io', section: 'tia', label: 'Interface-DB', file: (p) => `${p.export.ioDb}.db`, text: tiaIoDb,
    hint: 'Voor FB VT_Client. Aan VT_Client: num/str/flag/key := "<DB>".sys.num/.str/.flag/.key, ctrl := "<DB>".sys.ctrl.' },
  { key: 'iomap', section: 'tia', label: 'Koppel-FC', file: (p) => `${p.export.ioDb}Map.scl`, text: tiaIoMap,
    hint: 'Elke cyclus aanroepen, na VT_Client en vóór je eigen logica. Hoort bij de interface-DB van dezelfde export: altijd samen opnieuw importeren.' },
  { key: 'tc', section: 'tia', label: 'TC-pool', file: (p) => `${p.export.tcDb}.db`, text: tiaTcPool, show: (p) => p.implement.enabled,
    hint: 'De werktuigbeschrijving (DDOP) voor de task controller, met het maximum aantal secties. Aan TC_Client: info := "<DB>".info, pool := "<DB>".data en de tabellen obj…/patch…; die stuurt enkel de secties die de PLC gebruikt.' },
  { key: 'tcio', section: 'tia', label: 'TC-interface', file: (p) => `${p.export.tcIoDb}.db`, text: (p) => tiaTcIoDb(p), show: (p) => p.implement.enabled,
    hint: 'Voor FB TC_Client: par (secties, maten), in (van de TC), io (beide richtingen), out (naar de TC). Aan TC_Client: pd := "<DB>".sys.pd, ctrl := "<DB>".sys.ctrl, sectionWidth/X/Y := "<DB>".par.sectionWidth/X/Y.' },
  { key: 'tciomap', section: 'tia', label: 'TC-koppel-FC', file: (p) => `${p.export.tcIoDb}Map.scl`, text: (p) => tiaTcIoMap(p), show: (p) => p.implement.enabled,
    hint: 'Elke cyclus aanroepen, na TC_Client en vóór je eigen logica. Hoort bij TC_Pool en de TC-interface van dezelfde export.' },
  { key: 'tcfb', section: 'tia', label: "TC-FB's van GitHub", file: () => 'TC_Client_FB.zip', bundle: 'tc', show: (p) => p.implement.enabled,
    zip: (p, fb) => fb.tc,
    hint: `FB TC_Client met zijn datatypes en de handleiding, uit ${FB_GITHUB}/tc_client (dezelfde versie als deze designer).` },
  { key: 'fb', section: 'tia', label: "FB's van GitHub", file: () => 'VT_Client_FB.zip', bundle: 'vt',
    zip: (p, fb) => fb.vt,
    hint: `FB VT_Client met zijn datatypes en de handleiding, uit ${FB_GITHUB} (dezelfde versie als deze designer). Opnieuw importeren na elke update van de designer.` },
  { key: 'all', section: 'tia', label: 'Alles', file: (p) => `${fileBase(p.name)}_TIA.zip`,
    zip: (p, fb) => [fb.vt[0], ...tiaFiles(p), fb.vt[1], renamed(fb.vt[2], 'README_VT_Client.md'),
      ...(p.implement.enabled ? [fb.tc[0], ...tcFiles(p), fb.tc[1], renamed(fb.tc[2], 'README_TC_Client.md')] : [])],
    hint: "Pool-DB, interface-DB, koppel-FC en de FB's van GitHub in één zip; met een werktuig ook alles voor TC_Client." },
  { key: 'gvl', section: 'codesys', label: 'GVL-tekst', file: (p) => `${p.export.codesysGvl}.st`, text: codesysGvl,
    hint: 'Application › Object toevoegen › Globale variabelenlijst met dezelfde naam, en de tekst als declaratie plakken.' },
  { key: 'xml', section: 'codesys', label: 'PLCopen XML', file: (p) => `${p.export.codesysGvl}.xml`, text: codesysXml,
    hint: 'Project › PLCopenXML importeren. Hier zijn de ID\'s gewone variabelen (in de GVL-tekst zijn het constanten).' },
  { key: 'iop', section: 'general', label: 'Object pool', file: (p) => `${fileBase(p.name)}.iop`, binary: true,
    hint: 'De binaire pool, zoals een VT ze ontvangt. Voor pool-viewers en ISOBUS-bibliotheken die een .iop-bestand inlezen.' },
  { key: 'lst', section: 'general', label: 'Listing', file: (p) => `${fileBase(p.name)}_listing.txt`, text: listing,
    hint: 'De pool byte per byte, per object.' },
  { key: 'ddop', section: 'general', label: 'DDOP', file: (p) => `${fileBase(p.name)}_ddop.bin`, binary: true, bytes: ddopBytes, show: (p) => p.implement.enabled,
    hint: 'De werktuigbeschrijving (ISO 11783-10) zoals de task controller ze ontvangt, met het maximum aantal secties.' },
  { key: 'ddoplst', section: 'general', label: 'DDOP-listing', file: (p) => `${fileBase(p.name)}_ddop.txt`, text: ddopListing, show: (p) => p.implement.enabled,
    hint: 'De werktuigbeschrijving per object, met de plaats in de bytes en bij welke sectie het hoort.' },
];
const visible = (t, p) => !t.show || t.show(p);

const hexDump = (b) => {
  const lines = [];
  for (let i = 0; i < Math.min(b.length, 4096); i += 16) {
    lines.push(i.toString(16).padStart(6, '0') + '  ' + Array.from(b.slice(i, i + 16), (x) => x.toString(16).padStart(2, '0')).join(' '));
  }
  return lines.join('\n') + (b.length > 4096 ? `\n… (${b.length - 4096} bytes meer)` : '');
};
const size = (f) => (typeof f.data === 'string' ? utf8(f.data) : f.data).length;
/** Version of the FB in a fetched SCL file (the VERSION line after FUNCTION_BLOCK "<name>"), or ''. */
const fbVersion = (file, name) => {
  const t = Array.from(file.data.slice(0, 20000), (c) => String.fromCharCode(c)).join('');
  return (t.match(new RegExp(`FUNCTION_BLOCK "${name}"[\\s\\S]*?VERSION : (\\d+\\.\\d+)`)) || [])[1] || '';
};

export async function exportDialog(store, initial = 'tia') {
  let target = TARGETS.find((t) => t.key === initial) || TARGETS[0];
  const p = () => store.project;
  const sections = h('div', { class: 'tabs dlg' });
  const buttons = h('div', { class: 'exports' });
  const opts = h('div', { class: 'grid3' });
  const msgs = h('div', { class: 'msgs' });
  const hint = h('p', { class: 'hint' });
  const area = h('textarea', { class: 'code', readonly: true, spellcheck: 'false', wrap: 'off' });
  let content = '';
  let fbFiles = null; // fetched once per dialog
  let loadNo = 0;

  async function fetchFb() {
    if (!fbFiles) {
      const get = (b) => Promise.all(b.files.map(async (name) => {
        const r = await fetch(b.dir + name, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`${b.dir}${name}: HTTP ${r.status}`);
        return { name, data: new Uint8Array(await r.arrayBuffer()) };
      }));
      fbFiles = { vt: await get(BUNDLES.vt), tc: p().implement.enabled ? await get(BUNDLES.tc) : [] };
    }
    return fbFiles;
  }

  const nameField = (labelTxt, key) => {
    const i = h('input', { type: 'text', value: p().export[key] });
    i.onchange = () => { const v = sanitizeName(i.value); i.value = v; store.edit((pp) => { pp.export[key] = v; }); refresh(); };
    return h('label', { class: 'field' }, h('span', null, labelTxt), i);
  };
  const chunk = h('input', { type: 'number', min: 64, max: 1784, value: p().export.chunkMax });
  chunk.onchange = () => {
    const v = Math.max(64, Math.min(1784, Math.round(Number(chunk.value) || 1784)));
    chunk.value = v;
    store.edit((pp) => { pp.export.chunkMax = v; });
    refresh();
  };
  const fields = {
    tiaDb: nameField('Naam pool-DB', 'tiaDb'),
    ioDb: nameField('Naam interface-DB', 'ioDb'),
    tcDb: nameField('Naam TC-pool', 'tcDb'),
    tcIoDb: nameField('Naam TC-interface', 'tcIoDb'),
    codesysGvl: nameField('Naam GVL', 'codesysGvl'),
    chunk: h('label', { class: 'field' }, h('span', null, 'Max. bytes per deel (TP)'), chunk),
  };
  opts.append(...Object.values(fields));

  function refresh() {
    const sec = target.section;
    sections.innerHTML = '';
    for (const s of SECTIONS) {
      sections.append(h('button', { class: s.key === sec ? 'active' : '', onclick: () => { target = TARGETS.find((t) => t.section === s.key); refresh(); } }, s.label));
    }
    buttons.innerHTML = '';
    if (!visible(target, p())) target = TARGETS.find((t) => t.section === sec);
    for (const t of TARGETS.filter((x) => x.section === sec && visible(x, p()))) {
      buttons.append(h('button', { class: t === target ? 'active' : '', onclick: () => { target = t; refresh(); } },
        h('b', null, t.label), h('small', null, t.file(p()))));
    }
    const show = SECTIONS.find((s) => s.key === sec).fields;
    for (const [k, el] of Object.entries(fields)) el.style.display = show.includes(k) && ((k !== 'tcDb' && k !== 'tcIoDb') || p().implement.enabled) ? '' : 'none';
    opts.style.display = show.length ? '' : 'none';

    const v = validate(p());
    const errs = v.filter((m) => m.level === 'error'), warns = v.filter((m) => m.level === 'warn');
    msgs.innerHTML = '';
    let pool;
    try { pool = encodePool(p().objects, p().export.chunkMax); } catch (e) { msgs.append(h('div', { class: 'error' }, e.message)); }
    if (pool) msgs.append(h('div', { class: 'ok' }, `${pool.bytes.length} bytes, ${Object.keys(p().objects).length} objecten, ${pool.chunks.length} ${pool.chunks.length === 1 ? 'deel' : 'delen'} voor het transport protocol.`));
    if (errs.length) msgs.append(h('div', { class: 'error' }, `${errs.length} fout(en) – de terminal zal deze pool weigeren: `, errs.slice(0, 3).map((m) => `${label(p().objects[m.id])}: ${m.text}`).join(' · ')));
    if (warns.length) msgs.append(h('div', { class: 'warn' }, `${warns.length} waarschuwing(en). Zie Problemen in de statusbalk.`));
    hint.textContent = target.hint;

    const no = ++loadNo;
    content = '';
    try {
      if (target.zip) {
        area.value = "FB's ophalen…";
        const t = target;
        fetchFb().then((fb) => {
          if (no !== loadNo) return;
          let files;
          try { files = t.zip(p(), fb); } catch (e) { area.value = 'Export mislukt: ' + e.message; return; }
          content = zip(files);
          const set = fb[t.bundle || 'vt'];
          const readme = new TextDecoder().decode(set[2].data);
          const ver = (b) => fb[b][1] ? fbVersion(fb[b][1], BUNDLES[b].fb) : '';
          const note = (f) => (f === fb.vt[1] ? ver('vt') : fb.tc[1] && f === fb.tc[1] ? ver('tc') : '');
          area.value = [t.file(p()), ...files.map((f) => `  ${f.name.padEnd(28)} ${String(size(f)).padStart(7)} bytes${note(f) ? `   FB ${f === fb.vt[1] ? 'VT_Client' : 'TC_Client'} versie ${note(f)}` : ''}`), '',
            importOrder(p()), '', '— README.md —', '', readme].join('\n');
        }).catch((e) => {
          if (no !== loadNo) return;
          area.value = `De FB's konden niet opgehaald worden (${e.message}).\nHaal ze zelf op: ${FB_GITHUB}`;
        });
      } else if (target.binary) {
        content = target.bytes ? target.bytes(p()) : pool.bytes;
        area.value = hexDump(content);
      } else {
        content = target.text(p());
        area.value = content;
      }
    } catch (e) {
      content = '';
      area.value = 'Export mislukt: ' + e.message;
    }
  }
  refresh();

  await modal({
    title: 'Exporteren voor de PLC',
    wide: true,
    body: h('div', { class: 'export' }, sections, buttons, opts, msgs, hint, area),
    buttons: [
      { label: 'Kopiëren', value: 'copy' },
      { label: 'Downloaden', value: 'download', primary: true },
      { label: 'Sluiten', value: 'close' },
    ],
    onButton: async (v) => {
      if (v === 'download') {
        if (!content || (target.zip && typeof content === 'string')) { toast('Nog niet klaar of niet beschikbaar.'); return false; }
        download(target.file(p()), content, target.zip ? 'application/zip' : target.binary ? 'application/octet-stream' : 'text/plain;charset=utf-8');
        return false;
      }
      if (v === 'copy') {
        if (target.binary || target.zip) { toast(`${target.zip ? 'Een zip' : 'Een binair bestand'} kan je niet kopiëren; gebruik Downloaden.`); return false; }
        try { await navigator.clipboard.writeText(content); toast('Gekopieerd'); } catch { area.select(); document.execCommand('copy'); toast('Gekopieerd'); }
        return false;
      }
      return true;
    },
  });
}

export async function settingsDialog(store) {
  const p = store.project;
  const s = { ...p.settings };
  const num = (k, label, min, max, hint) => {
    const i = h('input', { type: 'number', value: s[k], min, max });
    i.onchange = () => { s[k] = Math.max(min, Math.min(max, Math.round(Number(i.value) || min))); i.value = s[k]; };
    return h('label', { class: 'field' }, h('span', null, label), i, hint ? h('small', null, hint) : null);
  };
  const name = h('input', { type: 'text', value: p.name });
  const ver = h('select', null, [3, 4, 5, 6].map((v) => h('option', { value: v, selected: v === s.vtVersion ? true : null }, `VT-versie ${v}`)));
  ver.onchange = () => { s.vtVersion = Number(ver.value); };
  const ok = await modal({
    title: 'Project en terminal',
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', null, 'Projectnaam'), name),
      h('h3', null, 'Terminal (uit Get Hardware / Get Soft Key Info)'),
      h('div', { class: 'grid2' },
        num('dmSize', 'Datamasker (px, vierkant)', 60, 2000, 'bv. 480 of 200'),
        h('label', { class: 'field' }, h('span', null, 'Versie'), ver, h('small', null, 'Zoals diag.vtVersion van VT_Client')),
        num('skWidth', 'Softkey breedte (px)', 10, 400), num('skHeight', 'Softkey hoogte (px)', 10, 400),
        num('skCount', 'Softkeys per pagina', 1, 64), num('grid', 'Raster (px, 1 = uit)', 1, 100))),
    buttons: [{ label: 'Annuleren', value: false }, { label: 'OK', value: true, primary: true }],
  });
  if (!ok) return;
  store.edit((pp) => { pp.name = name.value.trim() || pp.name; pp.settings = s; });
}

export async function problemsDialog(store, onPick) {
  const v = validate(store.project);
  const order = { error: 0, warn: 1, info: 2 };
  v.sort((a, b) => order[a.level] - order[b.level]);
  const words = { error: 'fout', warn: 'let op', info: 'info' };
  let close;
  const list = v.length
    ? h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Object'), h('th', null, 'Melding'))),
      h('tbody', null, v.map((m) => h('tr', { onclick: () => { close?.(); onPick(m.id); } },
        h('td', { class: m.level }, words[m.level]), h('td', null, label(store.project.objects[m.id])), h('td', null, m.text)))))
    : h('p', null, 'Geen problemen gevonden.');
  const pr = modal({ title: 'Problemen', wide: true, body: h('div', { class: 'tablewrap' }, list), buttons: [{ label: 'Sluiten', value: true, primary: true }] });
  close = () => document.querySelector('.modal-back:last-of-type .modal-head button')?.click();
  return pr;
}
