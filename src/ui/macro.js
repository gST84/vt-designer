// Dialog to build one macro command.
import { h } from '../util.js';
import { COMMANDS, CMD, decodeCommand, encodeCommand, defaultsFor } from '../iso/macros.js';
import { objectsOfType } from '../model.js';
import { TYPES } from '../iso/schema.js';
import { modal, colourButton } from './dialogs.js';

const hex = (b) => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Resolves with the command bytes, or null when cancelled. `bytes` null = new command. */
export async function editCommand(p, bytes) {
  let code = bytes && CMD[bytes[0]] ? bytes[0] : bytes ? 'raw' : 0xa0;
  let vals = bytes && CMD[bytes[0]] ? decodeCommand(bytes) : defaultsFor(0xa0);
  let rawText = bytes ? hex(bytes) : '';
  const form = h('div');
  const preview = h('code', { class: 'hexprev' });
  const pick = h('select', null,
    COMMANDS.map((c) => h('option', { value: c.code, selected: c.code === code ? true : null }, `${c.nl} (${c.name}, ${c.code.toString(16).toUpperCase()})`)),
    h('option', { value: 'raw', selected: code === 'raw' ? true : null }, 'Ruwe bytes (hex)'));
  pick.onchange = () => {
    code = pick.value === 'raw' ? 'raw' : Number(pick.value);
    if (code !== 'raw') vals = defaultsFor(code);
    draw();
  };
  const objs = objectsOfType(p);
  const current = () => (code === 'raw' ? rawText.split(/[\s,]+/).filter(Boolean).map((x) => parseInt(x, 16) & 255) : encodeCommand(code, vals));
  const update = () => { try { preview.textContent = hex(current()); } catch { preview.textContent = '?'; } };
  function draw() {
    form.innerHTML = '';
    if (code === 'raw') {
      const t = h('input', { type: 'text', value: rawText, placeholder: 'A0 E8 03 01 FF FF FF FF' });
      t.oninput = () => { rawText = t.value; update(); };
      form.append(h('label', { class: 'field' }, h('span', null, 'Bytes (hex)'), t));
    } else {
      for (const [k, n, label, opts] of CMD[code].layout) {
        if (k === 'ff') continue;
        let el;
        if (k === 'id') {
          el = h('select', null, h('option', { value: 0xffff }, '— geen (65535) —'),
            objs.map((o) => h('option', { value: o.id, selected: o.id === vals[n] ? true : null }, `${o.name} (${o.id}, ${TYPES[o.type].name})`)));
          if (vals[n] !== 0xffff && !objs.some((o) => o.id === vals[n])) el.append(h('option', { value: vals[n], selected: true }, `⚠ ${vals[n]}`));
          el.onchange = () => { vals[n] = Number(el.value); update(); };
        } else if (opts) {
          el = h('select', null, opts.map(([v, t]) => h('option', { value: v, selected: v === vals[n] ? true : null }, t)));
          el.onchange = () => { vals[n] = Number(el.value); update(); };
        } else if (k === 'colour') {
          el = colourButton(vals[n], (c) => { vals[n] = c; draw(); });
        } else if (k === 'text') {
          el = h('input', { type: 'text', value: vals[n] });
          el.oninput = () => { vals[n] = el.value; update(); };
        } else {
          const range = { u8: [0, 255], u16: [0, 65535], u32: [0, 4294967295], rel: [-127, 128] }[k];
          el = h('input', { type: 'number', value: vals[n], min: range[0], max: range[1] });
          el.oninput = () => { vals[n] = Math.max(range[0], Math.min(range[1], Math.round(Number(el.value) || 0))); update(); };
        }
        form.append(h('label', { class: 'field' }, h('span', null, label), el));
      }
    }
    update();
  }
  draw();
  const ok = await modal({
    title: bytes ? 'Macro-opdracht wijzigen' : 'Macro-opdracht toevoegen',
    body: h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', null, 'Opdracht'), pick), form,
      h('div', { class: 'field' }, h('span', null, 'Bytes'), preview)),
    buttons: [{ label: 'Annuleren', value: false }, { label: 'OK', value: true, primary: true }],
  });
  if (!ok) return null;
  const b = current();
  return b.length ? b : null;
}
