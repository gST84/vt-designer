// Implement dialog: what the PLC tells the task controller about the implement (DDOP, ISO 11783-10).
import { h } from '../util.js';
import { modal } from './dialogs.js';
import { buildDdop, normalizeImplement, PRODUCT_KINDS, CONNECTOR_TYPES, PRACTICES, MAX_SECTIONS } from '../tc/build.js';
import { tcSummary } from '../export/tcpool.js';

const KIND_OPTIONS = [...Object.entries(PRODUCT_KINDS).map(([k, v]) => [k, v.nl]), ['none', 'Geen dosis (alleen secties)']];

export async function implementDialog(store) {
  const m = normalizeImplement(JSON.parse(JSON.stringify(store.project.implement)));
  const info = h('div', { class: 'msgs' });
  const prodBox = h('div', { class: 'products' });

  const select = (opts, value, onchange) => {
    const s = h('select', null, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, t)));
    s.onchange = () => { onchange(s.value); refresh(); };
    return s;
  };
  const text = (value, onchange, max = 32) => {
    const i = h('input', { type: 'text', value, maxlength: max });
    i.oninput = () => { onchange(i.value); refresh(); };
    return i;
  };
  const num = (value, min, max, onchange) => {
    const i = h('input', { type: 'number', value, min, max });
    i.onchange = () => { const v = Math.max(min, Math.min(max, Math.round(Number(i.value) || 0))); i.value = v; onchange(v); refresh(); };
    return i;
  };
  const field = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', null, hint) : null);

  const enabled = h('input', { type: 'checkbox', checked: m.enabled });
  enabled.onchange = () => { m.enabled = enabled.checked; refresh(); };

  function products() {
    prodBox.innerHTML = '';
    m.products.forEach((pr, i) => {
      const kind = PRODUCT_KINDS[pr.kind];
      prodBox.append(h('div', { class: 'product' },
        h('b', null, `Product ${i + 1}`),
        h('div', { class: 'grid3' },
          field('Naam', text(pr.name, (v) => { pr.name = v; })),
          field('Soort', select(KIND_OPTIONS, pr.kind, (v) => { pr.kind = v; products(); })),
          field('Teeltpraktijk', select(PRACTICES, pr.practice, (v) => { pr.practice = Number(v); })),
          kind?.capacityNl ? field(`Max. inhoud (${kind.capacityNl})`, num(pr.capacity, 0, 2000000, (v) => { pr.capacity = v; })) : null,
          kind ? h('p', { class: 'hint' }, `De TC stuurt de dosis in ${kind.rawNl}.`) : null),
        h('button', { class: 'icon', title: 'Product weghalen', onclick: () => { m.products.splice(i, 1); products(); refresh(); } }, '✕')));
    });
    prodBox.append(h('button', { onclick: () => { m.products.push({ name: `Product ${m.products.length + 1}`, kind: 'volume', capacity: 1000, practice: m.practice }); products(); refresh(); } }, '+ Product'));
  }

  function refresh() {
    info.innerHTML = '';
    const b = buildDdop(m);
    info.append(h('div', { class: b.errors.length ? 'error' : 'ok' }, tcSummary(b) + '.'));
    for (const e of b.errors.slice(0, 4)) info.append(h('div', { class: 'error' }, e.text));
    if (b.bytes.length > 1785) info.append(h('div', { class: 'warn' }, `Meer dan 1785 bytes: de PLC moet de beschrijving met ETP sturen (komt in TC_Client).`));
    if (!m.enabled) info.append(h('div', { class: 'hint' }, 'Uit: de export bevat geen TC-pool.'));
  }

  products();
  refresh();
  const body = h('div', { class: 'form implement' },
    h('label', { class: 'check' }, enabled, 'Werktuig met task controller (TC-client, ISO 11783-10)'),
    h('p', { class: 'hint' }, 'De terminal stuurt via zijn task controller secties en dosis volgens een taakkaart naar de PLC. Hier beschrijf je het werktuig; de PLC kiest tijdens het draaien hoeveel secties (tot het maximum) en hoe breed.'),
    h('div', { class: 'grid3' },
      field('Naam', text(m.designator, (v) => { m.designator = v; })),
      field('Serienummer', text(m.serial, (v) => { m.serial = v; })),
      field('Softwareversie', text(m.softwareVersion, (v) => { m.softwareVersion = v; })),
      field('Koppeling', select(CONNECTOR_TYPES, m.connectorType, (v) => { m.connectorType = Number(v); })),
      field('Koppeling → werklijn (mm)', num(m.workDistance, 0, 50000, (v) => { m.workDistance = v; }), 'Afstand van de koppeling naar achter, tot waar de secties werken'),
      field('Teeltpraktijk', select(PRACTICES, m.practice, (v) => { m.practice = Number(v); })),
      field('Max. aantal secties', num(m.maxSections, 1, MAX_SECTIONS, (v) => { m.maxSections = v; }), `1 tot ${MAX_SECTIONS}; de PLC gebruikt er 1 tot dit aantal`),
      field('Standaard sectiebreedte (mm)', num(m.sectionWidth, 1, 100000, (v) => { m.sectionWidth = v; }), 'De PLC kan elke breedte aanpassen'),
      field('Taal (2 letters)', text(m.language, (v) => { m.language = v.toLowerCase(); }, 2), 'Voor de weergave op de terminal, bv. en, nl, de')),
    h('h3', null, 'Producten'),
    prodBox,
    info);

  const ok = await modal({
    title: 'Werktuig voor de task controller',
    wide: true,
    body,
    buttons: [{ label: 'Annuleren', value: false }, { label: 'OK', value: true, primary: true }],
  });
  if (!ok) return;
  store.edit((pp) => { pp.implement = m; });
}
