// Export dialog (TIA Portal, CODESYS, .iop, listing), settings dialog and the problem list.
import { h, download, fileBase } from '../util.js';
import { encodePool } from '../iso/codec.js';
import { validate } from '../iso/validate.js';
import { tiaSource } from '../export/tia.js';
import { codesysGvl, codesysXml } from '../export/codesys.js';
import { listing } from '../export/listing.js';
import { sanitizeName, label } from '../model.js';
import { modal, toast } from './dialogs.js';

const TARGETS = [
  { key: 'tia', label: 'TIA Portal', file: (p) => `${p.export.tiaDb}.db`, text: tiaSource,
    hint: 'Externe bronbestanden › Nieuw extern bestand toevoegen › dit .db-bestand › rechtsklik › Blokken genereren uit bron. Aan VT_TestClient: poolSize := "<DB>".size, chunkCount := "<DB>".chunkCount, pool := "<DB>".data, chunkStart := "<DB>".chunkStart, chunkLength := "<DB>".chunkLength; object-ID\'s als "<DB>".id.<naam>.' },
  { key: 'gvl', label: 'CODESYS (GVL-tekst)', file: (p) => `${p.export.codesysGvl}.st`, text: codesysGvl,
    hint: 'Application › Object toevoegen › Globale variabelenlijst met dezelfde naam, en de tekst als declaratie plakken.' },
  { key: 'xml', label: 'CODESYS (PLCopen XML)', file: (p) => `${p.export.codesysGvl}.xml`, text: codesysXml,
    hint: 'Project › PLCopenXML importeren. Hier zijn de ID\'s gewone variabelen (in de GVL-tekst zijn het constanten).' },
  { key: 'iop', label: 'Object pool (.iop)', file: (p) => `${fileBase(p.name)}.iop`, binary: true,
    hint: 'De binaire pool, zoals een VT ze ontvangt. Voor pool-viewers en ISOBUS-bibliotheken die een .iop-bestand inlezen.' },
  { key: 'lst', label: 'Listing', file: (p) => `${fileBase(p.name)}_listing.txt`, text: listing,
    hint: 'De pool byte per byte, per object.' },
];

export async function exportDialog(store, initial = 'tia') {
  let target = TARGETS.find((t) => t.key === initial) || TARGETS[0];
  const p = () => store.project;
  const tabs = h('div', { class: 'tabs dlg' });
  const opts = h('div', { class: 'grid3' });
  const msgs = h('div', { class: 'msgs' });
  const hint = h('p', { class: 'hint' });
  const area = h('textarea', { class: 'code', readonly: true, spellcheck: 'false', wrap: 'off' });
  let content = '';

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
  opts.append(nameField('Naam DB (TIA Portal)', 'tiaDb'), nameField('Naam GVL (CODESYS)', 'codesysGvl'),
    h('label', { class: 'field' }, h('span', null, 'Max. bytes per deel (TP)'), chunk));

  function refresh() {
    tabs.innerHTML = '';
    for (const t of TARGETS) tabs.append(h('button', { class: t === target ? 'active' : '', onclick: () => { target = t; refresh(); } }, t.label));
    const v = validate(p());
    const errs = v.filter((m) => m.level === 'error'), warns = v.filter((m) => m.level === 'warn');
    msgs.innerHTML = '';
    let pool;
    try { pool = encodePool(p().objects, p().export.chunkMax); } catch (e) { msgs.append(h('div', { class: 'error' }, e.message)); }
    if (pool) msgs.append(h('div', { class: 'ok' }, `${pool.bytes.length} bytes, ${Object.keys(p().objects).length} objecten, ${pool.chunks.length} ${pool.chunks.length === 1 ? 'deel' : 'delen'} voor het transport protocol.`));
    if (errs.length) msgs.append(h('div', { class: 'error' }, `${errs.length} fout(en) – de terminal zal deze pool weigeren: `, errs.slice(0, 3).map((m) => `${label(p().objects[m.id])}: ${m.text}`).join(' · ')));
    if (warns.length) msgs.append(h('div', { class: 'warn' }, `${warns.length} waarschuwing(en). Zie Problemen in de statusbalk.`));
    hint.textContent = target.hint;
    try {
      if (target.binary) {
        const b = pool.bytes;
        content = b;
        const lines = [];
        for (let i = 0; i < Math.min(b.length, 4096); i += 16) {
          lines.push(i.toString(16).padStart(6, '0') + '  ' + Array.from(b.slice(i, i + 16), (x) => x.toString(16).padStart(2, '0')).join(' '));
        }
        area.value = lines.join('\n') + (b.length > 4096 ? `\n… (${b.length - 4096} bytes meer)` : '');
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
    body: h('div', { class: 'export' }, tabs, opts, msgs, hint, area),
    buttons: [
      { label: 'Kopiëren', value: 'copy' },
      { label: 'Downloaden', value: 'download', primary: true },
      { label: 'Sluiten', value: 'close' },
    ],
    onButton: async (v) => {
      if (v === 'download') {
        download(target.file(p()), content, target.binary ? 'application/octet-stream' : 'text/plain;charset=utf-8');
        return false;
      }
      if (v === 'copy') {
        if (target.binary) { toast('Een binair bestand kan je niet kopiëren; gebruik Downloaden.'); return false; }
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
        h('label', { class: 'field' }, h('span', null, 'Versie'), ver),
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
