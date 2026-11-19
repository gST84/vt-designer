// Right panel: the attributes of the selected object, generated from its field list in the schema.
import { h } from '../util.js';
import { TYPES, NONE, HJUST, VJUST, EVENTS, ROOT_TYPES, CHILD_TYPES, typeName } from '../iso/schema.js';
import { objectsOfType, label, refsTo, addObject, uniqueName, sanitizeName, deleteObject, duplicate, sizeOf } from '../model.js';
import { encodeObject } from '../iso/codec.js';
import { requantize, pictureRaw } from '../iso/picture.js';
import { describeCommand } from '../iso/macros.js';
import { validate } from '../iso/validate.js';
import { pictureUrl } from '../render.js';
import { colourButton, confirmDlg, toast } from './dialogs.js';
import { editCommand } from './macro.js';
import { importPicture } from './picture.js';
import { ioKind, inIo, ioDefault, ioFieldText } from '../export/io.js';

export class Props {
  constructor(store, host, app) {
    this.s = store;
    this.host = host;
    this.app = app;
    store.on('change', ({ source }) => { if (source !== 'props' && source !== 'drag') this.render(); });
    store.on('select', () => this.render());
  }

  get o() { return this.s.sel ? this.s.O[this.s.sel.id] : null; }

  /** Changes the selected object. rebuild: redraw the panel afterwards (lists, linked fields). */
  set(fn, rebuild = false, merge = null) {
    const id = this.s.sel.id;
    this.s.edit((p) => fn(p.objects[id], p), rebuild ? 'props-rebuild' : 'props', merge && `${id}.${merge}`);
  }

  render() {
    const scroll = this.host.scrollTop;
    this.host.innerHTML = '';
    const o = this.o;
    if (!o) { this.host.append(this.projectInfo()); return; }
    const def = TYPES[o.type];
    const sel = this.s.sel;
    const sec = (title, ...kids) => h('div', { class: 'psec' }, title ? h('h3', null, title) : null, ...kids);

    // header
    let bytes = 0;
    try { bytes = encodeObject(o).length; } catch { /* shown by validation */ }
    const isRoot = ROOT_TYPES.includes(o.type);
    this.host.append(h('div', { class: 'objhead' },
      h('div', null, h('b', null, def.nl), h('small', null, `${def.name} · type ${o.type} · ${bytes} bytes`)),
      h('div', { class: 'btnrow' },
        isRoot && this.s.root !== o.id ? h('button', { onclick: () => this.s.setRoot(o.id) }, 'Openen') : null,
        h('button', { title: 'Kopie maken (met kinderen)', onclick: () => this.duplicate() }, 'Dupliceren'),
        h('button', { class: 'danger', title: 'Object verwijderen', onclick: () => this.remove() }, 'Verwijderen'))));

    // name and ID
    const name = h('input', { type: 'text', value: o.name });
    name.onchange = () => {
      const n = uniqueName(this.s.project, sanitizeName(name.value), o.id);
      this.set((x) => { x.name = n; }, true);
    };
    const id = h('input', { type: 'number', min: 0, max: 65534, value: o.id });
    id.onchange = () => {
      const msg = this.s.renumber(o.id, Number(id.value));
      if (msg) { toast(msg); id.value = o.id; }
    };
    this.host.append(sec(null, h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Naam (PLC)'), name),
      h('label', { class: 'field' }, h('span', null, 'Object-ID'), id))));

    // problems of this object
    const msgs = validate(this.s.project).filter((m) => m.id === o.id && m.level !== 'info');
    if (msgs.length) this.host.append(h('div', { class: 'msgs' }, msgs.map((m) => h('div', { class: m.level }, m.text))));

    // placement in the parent
    if (sel.path?.length) {
      const [pid, i] = sel.path[sel.path.length - 1];
      const par = this.s.O[pid];
      if (par && par.type !== 4 && par.children[i]) {
        const c = par.children[i];
        const num = (k) => this.num(c[k], { min: -32768, max: 32767 }, (v) => this.s.edit((p) => { p.objects[pid].children[i][k] = v; }, 'props'));
        this.host.append(sec('Positie in ' + par.name, h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', null, 'X'), num('x')), h('label', { class: 'field' }, h('span', null, 'Y'), num('y'))),
        h('div', { class: 'btnrow' }, h('button', { title: 'Enkel van deze plaats weghalen; het object blijft bestaan', onclick: () => this.unplace(pid, i) }, 'Uit ' + par.name + ' halen'))));
      }
    }

    // attributes
    const attrs = h('div');
    for (const f of def.fields) {
      const el = this.editor(o, f);
      if (el) attrs.append(el);
    }
    if (o.type === 4 || o.type === 0 || o.type === 5) attrs.append(h('p', { class: 'hint' }, sizeHint(o, this.s.project)));
    this.host.append(sec('Attributen', attrs));

    // PLC interface (DB VT_Io for FB VT_Client)
    if (ioKind(o)) this.host.append(sec('PLC-koppeling', this.ioEditor(o)));

    // used by
    const refs = refsTo(this.s.project, o.id);
    if (refs.length) {
      this.host.append(sec('Gebruikt door', h('ul', { class: 'reflist' }, refs.map((r) =>
        h('li', null, h('button', { class: 'link', onclick: () => this.s.selectObject(r.obj.id) }, label(r.obj)), ` – ${r.kind}`)))));
    }
    this.host.scrollTop = scroll;
  }

  projectInfo() {
    const p = this.s.project;
    return h('div', { class: 'psec' }, h('h3', null, 'Project'),
      h('p', null, h('b', null, p.name)),
      h('p', { class: 'hint' }, `Terminal: datamasker ${p.settings.dmSize} × ${p.settings.dmSize}, softkeys ${p.settings.skWidth} × ${p.settings.skHeight} (${p.settings.skCount} stuks), VT-versie ${p.settings.vtVersion}.`),
      h('p', { class: 'hint keys' }, 'Klik een object om het te selecteren, dubbelklik om in een container of knop te gaan (Alt+klik: diepste object). ',
        'Pijltjes verschuiven (Shift: 10 px), Delete verwijdert, Esc kiest de ouder, Ctrl+D dupliceert, Ctrl+Z/Y.'));
  }

  /** Checkbox "in VT_Io" and the resulting field. */
  ioEditor(o) {
    const p = this.s.project;
    const on = inIo(p, o);
    const c = h('input', { type: 'checkbox', checked: on });
    c.onchange = () => this.set((x, pp) => {
      // back to "automatic" when the choice equals the default
      if (c.checked === ioDefault(pp, x)) delete x.plcIo; else x.plcIo = c.checked;
    }, true);
    const k = ioKind(o);
    const what = k.table === 'key' ? 'pressed, onPress en onRelease (één cyclus) en count'
      : k.dir === 'in' ? 'de bediener vult het in; de PLC kan het ook schrijven'
        : o.type === 3 ? 'TRUE = tonen, FALSE = verbergen' : 'de PLC schrijft, het scherm volgt';
    return h('div', null,
      h('label', { class: 'check' }, c, `In PLC-interface (${p.export.ioDb})`),
      on ? h('div', { class: 'iofield' }, h('code', null, ioFieldText(p, o)), h('small', null, what)) : null,
      o.plcIo === undefined ? null : h('small', { class: 'hint' }, 'Zelf gekozen (standaard: ' + (ioDefault(p, o) ? 'aan' : 'uit') + ').'));
  }

  // ---------- generic editors ----------
  num(value, { min, max, step = 1 } = {}, onchange) {
    const i = h('input', { type: 'number', value, min, max, step });
    i.onchange = () => {
      let v = Number(i.value);
      if (i.value === '' || Number.isNaN(v)) { i.value = value; return; }
      if (step === 1) v = Math.round(v);
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      i.value = v;
      onchange(v);
    };
    return i;
  }

  field(label, el, hint) {
    return h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', null, hint) : null);
  }

  editor(o, f) {
    const v = o[f.n];
    const setv = (val, rebuild = false) => this.set((x) => { x[f.n] = val; }, rebuild);
    switch (f.k) {
      case 'count': return null;
      case 'u8': case 'u16': case 'u32': case 'i32': case 'f32': {
        if (f.ro) return this.field(f.label, h('div', { class: 'ro' }, v));
        if (f.hex) return this.field(f.label, this.bitEditor(v, setv), f.hint);
        const lim = { u8: [0, 255], u16: [0, 65535], u32: [0, 4294967295], i32: [-2147483648, 2147483647], f32: [undefined, undefined] }[f.k];
        return this.field(f.label, this.num(v, { min: f.min ?? lim[0], max: f.max ?? lim[1], step: f.k === 'f32' ? 'any' : 1 }, (x) => setv(f.k === 'f32' ? Math.fround(x) : x)), f.hint);
      }
      case 'colour': return this.field(f.label, colourButton(v, (c) => setv(c, true), o.type === 20 && o.format === 1 ? 16 : 256));
      case 'bool': {
        const c = h('input', { type: 'checkbox', checked: !!v });
        c.onchange = () => setv(c.checked ? 1 : 0, true);
        return h('label', { class: 'check' }, c, f.label);
      }
      case 'enum': {
        const s = h('select', null, f.opts.map(([val, txt]) => h('option', { value: val, selected: val === v ? true : null }, txt)));
        if (!f.opts.some(([val]) => val === v)) s.append(h('option', { value: v, selected: true }, `${v} (onbekend)`));
        s.onchange = () => {
          const nv = Number(s.value);
          if (o.type === 20 && f.n === 'format') this.set((x) => { const old = x.format; x.format = nv; requantize(x, old); }, true);
          else setv(nv, true);
        };
        return this.field(f.label, s);
      }
      case 'bits': {
        const box = h('div', { class: 'bits' });
        for (const [bit, txt] of f.bits) {
          const c = h('input', { type: 'checkbox', checked: !!(v & (1 << bit)) });
          c.onchange = () => this.set((x) => { x[f.n] = c.checked ? x[f.n] | (1 << bit) : x[f.n] & ~(1 << bit); }, true);
          box.append(h('label', { class: 'check' }, c, txt));
        }
        return h('div', { class: 'field' }, h('span', null, f.label), box);
      }
      case 'just': {
        const mk = (opts, cur, apply) => {
          const s = h('select', null, opts.map(([val, txt]) => h('option', { value: val, selected: val === cur ? true : null }, txt)));
          s.onchange = () => this.set((x) => { x.justification = apply(x.justification, Number(s.value)); }, true);
          return s;
        };
        return h('div', { class: 'field' }, h('span', null, f.label), h('div', { class: 'grid2' },
          mk(HJUST, v & 3, (j, n) => (j & ~3) | n), mk(VJUST, (v >> 2) & 3, (j, n) => (j & ~12) | (n << 2))));
      }
      case 'ref': return this.refEditor(o, f);
      case 'string': return this.stringEditor(o, f);
      case 'children': return this.childrenEditor(o);
      case 'macros': return this.macrosEditor(o);
      case 'idlist': return this.idlistEditor(o, f);
      case 'langs': {
        const i = h('input', { type: 'text', value: (v || []).join(', ') });
        i.onchange = () => setv(i.value.split(/[\s,;]+/).filter(Boolean).map((x) => x.toLowerCase().slice(0, 2)), true);
        return this.field(f.label, i, 'ISO 639-codes, bv. en, nl, de, fr');
      }
      case 'points': return this.pointsEditor(o);
      case 'picdata': return this.pictureEditor(o);
      case 'macrocmds': return this.commandsEditor(o);
      default: return null;
    }
  }

  /** 16 toggles for a line pattern + hex value. */
  bitEditor(v, setv) {
    const row = h('div', { class: 'bitrow' });
    for (let b = 15; b >= 0; b--) {
      row.append(h('button', { type: 'button', class: 'bit' + (v & (1 << b) ? ' on' : ''), title: `bit ${b}`, onclick: () => setv(v ^ (1 << b), true) }));
    }
    const hex = h('input', { type: 'text', value: v.toString(16).toUpperCase().padStart(4, '0'), class: 'hex' });
    hex.onchange = () => { const n = parseInt(hex.value, 16); if (!Number.isNaN(n)) setv(n & 0xffff, true); };
    return h('div', { class: 'bitedit' }, row, hex);
  }

  refEditor(o, f) {
    const p = this.s.project;
    const v = o[f.n];
    const opts = objectsOfType(p, f.types).filter((x) => x.id !== o.id);
    const s = h('select', null,
      f.none || v === NONE ? h('option', { value: NONE, selected: v === NONE ? true : null }, '— geen —') : null,
      opts.map((x) => h('option', { value: x.id, selected: x.id === v ? true : null }, `${x.name} (${x.id})`)));
    if (v !== NONE && !opts.some((x) => x.id === v)) s.append(h('option', { value: v, selected: true }, `⚠ ${v} ontbreekt`));
    s.onchange = () => this.set((x) => { x[f.n] = Number(s.value); }, true);
    const go = h('button', { class: 'icon', title: 'Naar dit object', disabled: !p.objects[v] ? true : null, onclick: () => this.s.selectObject(v) }, '→');
    const add = h('button', { class: 'icon', title: `Nieuw ${typeName(f.types[0])}`, onclick: () => {
      this.set((x, pp) => { x[f.n] = addObject(pp, f.types[0]).id; }, true);
    } }, '+');
    return this.field(f.label, h('div', { class: 'refrow' }, s, go, add));
  }

  stringEditor(o, f) {
    const v = String(o[f.n] ?? '');
    const box = h('div');
    if (f.fixed) {
      const max = f.lenSize === 1 ? 255 : 65535;
      const count = h('small', null, `${v.length} / ${o.length} tekens`);
      const t = h('input', { type: 'text', value: v });
      t.oninput = () => {
        count.textContent = `${t.value.length} / ${o.length} tekens` + (t.value.length > o.length ? ' – wordt afgekapt' : '');
        this.set((x) => { x[f.n] = t.value; }, false, f.n);
      };
      t.onchange = () => this.render();
      const len = this.num(o.length, { min: 0, max }, (n) => this.set((x) => { x.length = n; }, true));
      const fit = h('button', { title: 'Lengte = lengte van de tekst', onclick: () => this.set((x) => { x.length = String(x[f.n]).length; }, true) }, '= tekst');
      box.append(this.field(f.label, t), count,
        this.field('Lengte (vast, maximum voor de PLC)', h('div', { class: 'refrow' }, len, fit)));
    } else {
      const t = h('input', { type: 'text', value: v });
      t.oninput = () => this.set((x) => { x[f.n] = t.value; }, false, f.n);
      box.append(this.field(f.label, t));
    }
    return box;
  }

  childrenEditor(o) {
    const p = this.s.project;
    const box = h('div', { class: 'field' }, h('span', null, 'Kinderen (positie t.o.v. dit object)'));
    const sel = this.s.sel;
    const list = h('div', { class: 'rows' });
    o.children.forEach((c, i) => {
      const t = p.objects[c.id];
      const path = sel.path ? [...sel.path, [o.id, i]] : (this.s.root === o.id ? [[o.id, i]] : null);
      list.append(h('div', { class: 'row childrow' },
        h('button', { class: 'link nm', title: t ? typeName(t.type) : 'ontbreekt', onclick: () => this.s.select({ id: c.id, path }) }, t ? t.name : `⚠ ${c.id}`),
        this.num(c.x, { min: -32768, max: 32767 }, (v) => this.set((x) => { x.children[i].x = v; })),
        this.num(c.y, { min: -32768, max: 32767 }, (v) => this.set((x) => { x.children[i].y = v; })),
        this.moveBtns(o.children.length, i, (from, to) => this.set((x) => { x.children.splice(to, 0, x.children.splice(from, 1)[0]); }, true)),
        h('button', { class: 'icon', title: 'Weghalen (het object blijft bestaan)', onclick: () => this.set((x) => { x.children.splice(i, 1); }, true) }, '✕')));
    });
    if (!o.children.length) list.append(h('div', { class: 'hint' }, 'Geen kinderen.'));
    const allowed = CHILD_TYPES[o.type] || [];
    const cands = objectsOfType(p, allowed).filter((x) => x.id !== o.id);
    const add = h('select', null, h('option', { value: '' }, 'Bestaand object plaatsen…'), cands.map((x) => h('option', { value: x.id }, `${x.name} (${typeName(x.type)})`)));
    add.onchange = () => { if (add.value !== '') this.set((x) => { x.children.push({ id: Number(add.value), x: 0, y: 0 }); }, true); };
    box.append(list, add);
    return box;
  }

  moveBtns(n, i, move) {
    return h('span', { class: 'mv' },
      h('button', { class: 'icon', title: 'Omhoog (eerder getekend)', disabled: i === 0 ? true : null, onclick: () => move(i, i - 1) }, '↑'),
      h('button', { class: 'icon', title: 'Omlaag (later getekend)', disabled: i === n - 1 ? true : null, onclick: () => move(i, i + 1) }, '↓'));
  }

  macrosEditor(o) {
    const p = this.s.project;
    const macros = objectsOfType(p, [28]);
    const box = h('div', { class: 'field' }, h('span', null, 'Macro\'s bij gebeurtenissen'));
    o.macros.forEach((m, i) => {
      const ev = h('select', null, EVENTS.map(([v, t]) => h('option', { value: v, selected: v === m.event ? true : null }, `${v} ${t}`)));
      ev.onchange = () => this.set((x) => { x.macros[i].event = Number(ev.value); }, true);
      const ms = h('select', null, macros.map((x) => h('option', { value: x.id, selected: x.id === m.macro ? true : null }, `${x.name} (${x.id})`)));
      if (!macros.some((x) => x.id === m.macro)) ms.append(h('option', { value: m.macro, selected: true }, `⚠ ${m.macro}`));
      ms.onchange = () => this.set((x) => { x.macros[i].macro = Number(ms.value); }, true);
      box.append(h('div', { class: 'row macrorow' }, ev, ms,
        h('button', { class: 'icon', title: 'Naar de macro', onclick: () => this.s.selectObject(m.macro) }, '→'),
        h('button', { class: 'icon', title: 'Weghalen', onclick: () => this.set((x) => { x.macros.splice(i, 1); }, true) }, '✕')));
    });
    box.append(h('button', { onclick: () => this.set((x, pp) => {
      const mac = objectsOfType(pp, [28])[0] || addObject(pp, 28);
      x.macros.push({ event: 3, macro: mac.id });
    }, true) }, '+ Macro koppelen'));
    return box;
  }

  idlistEditor(o, f) {
    const p = this.s.project;
    const box = h('div', { class: 'field' }, h('span', null, f.label));
    const cands = objectsOfType(p, f.types);
    o[f.n].forEach((id, i) => {
      const s = h('select', null, f.n === 'items' ? h('option', { value: NONE, selected: id === NONE ? true : null }, '— leeg —') : null,
        cands.map((x) => h('option', { value: x.id, selected: x.id === id ? true : null }, `${x.name} (${x.id})`)));
      if (id !== NONE && !cands.some((x) => x.id === id)) s.append(h('option', { value: id, selected: true }, `⚠ ${id}`));
      s.onchange = () => this.set((x) => { x[f.n][i] = Number(s.value); }, true);
      box.append(h('div', { class: 'row idrow' }, h('span', { class: 'no' }, i), s,
        this.moveBtns(o[f.n].length, i, (a, b) => this.set((x) => { x[f.n].splice(b, 0, x[f.n].splice(a, 1)[0]); }, true)),
        h('button', { class: 'icon', title: 'Weghalen', onclick: () => this.set((x) => { x[f.n].splice(i, 1); }, true) }, '✕')));
    });
    const addNew = f.n === 'keys'
      ? h('button', { onclick: () => this.set((x, pp) => { x.keys.push(addObject(pp, 5, { keyCode: x.keys.length + 1 }).id); }, true) }, '+ Nieuwe softkey')
      : null;
    const addExisting = h('button', { onclick: () => this.set((x) => { x[f.n].push(cands[0]?.id ?? NONE); }, true) }, f.n === 'keys' ? '+ Bestaande' : '+ Item');
    box.append(h('div', { class: 'btnrow' }, addNew, addExisting));
    return box;
  }

  pointsEditor(o) {
    const box = h('div', { class: 'field' }, h('span', null, 'Punten (t.o.v. linksboven)'));
    o.points.forEach((pt, i) => {
      box.append(h('div', { class: 'row ptrow' }, h('span', { class: 'no' }, i + 1),
        this.num(pt.x, { min: 0, max: 65535 }, (v) => this.set((x) => { x.points[i].x = v; })),
        this.num(pt.y, { min: 0, max: 65535 }, (v) => this.set((x) => { x.points[i].y = v; })),
        h('button', { class: 'icon', title: 'Punt weghalen', onclick: () => this.set((x) => { x.points.splice(i, 1); }, true) }, '✕')));
    });
    box.append(h('button', { onclick: () => this.set((x) => {
      const last = x.points[x.points.length - 1] || { x: 0, y: 0 };
      x.points.push({ x: Math.min(x.width, last.x + 10), y: last.y });
    }, true) }, '+ Punt'));
    return box;
  }

  pictureEditor(o) {
    let raw = 0;
    try { raw = pictureRaw(o).length; } catch { /* invalid */ }
    const [w, hh] = sizeOf(this.s.project, o);
    return h('div', { class: 'field' }, h('span', null, 'Beeld'),
      h('div', { class: 'picprev' }, h('img', { src: pictureUrl(o), width: Math.min(220, w), style: { imageRendering: 'pixelated' } })),
      h('small', null, `${o.actualWidth} × ${o.actualHeight} px, getoond als ${w} × ${hh}; ${raw} bytes beelddata`),
      h('button', { onclick: async () => {
        const r = await importPicture(o);
        if (r) this.set((x) => Object.assign(x, r), true);
      } }, 'Andere afbeelding…'));
  }

  commandsEditor(o) {
    const p = this.s.project;
    const nameOf = (id) => p.objects[id]?.name ?? `⚠ ${id}`;
    const box = h('div', { class: 'field' }, h('span', null, 'Opdrachten (in volgorde uitgevoerd)'));
    o.commands.forEach((cmd, i) => {
      box.append(h('div', { class: 'row cmdrow' },
        h('span', { class: 'cmd' }, describeCommand(cmd, nameOf)),
        h('button', { class: 'icon', title: 'Wijzigen', onclick: async () => {
          const b = await editCommand(p, cmd);
          if (b) this.set((x) => { x.commands[i] = b; }, true);
        } }, '✎'),
        this.moveBtns(o.commands.length, i, (a, b) => this.set((x) => { x.commands.splice(b, 0, x.commands.splice(a, 1)[0]); }, true)),
        h('button', { class: 'icon', title: 'Weghalen', onclick: () => this.set((x) => { x.commands.splice(i, 1); }, true) }, '✕')));
    });
    if (!o.commands.length) box.append(h('div', { class: 'hint' }, 'Nog geen opdrachten.'));
    box.append(h('button', { onclick: async () => {
      const b = await editCommand(p, null);
      if (b) this.set((x) => { x.commands.push(b); }, true);
    } }, '+ Opdracht'));
    return box;
  }

  // ---------- actions ----------
  duplicate() {
    const sel = this.s.sel;
    let copy;
    let path = null;
    this.s.edit((p) => {
      copy = duplicate(p, sel.id, true);
      if (sel.path?.length) {
        const [pid, i] = sel.path[sel.path.length - 1];
        const par = p.objects[pid];
        if (par.type === 4) { par.keys.splice(i + 1, 0, copy.id); path = [...sel.path.slice(0, -1), [pid, i + 1]]; }
        else {
          const c = par.children[i];
          par.children.push({ id: copy.id, x: c.x + 10, y: c.y + 10 });
          path = [...sel.path.slice(0, -1), [pid, par.children.length - 1]];
        }
      }
    });
    this.s.select({ id: copy.id, path });
  }

  unplace(pid, i) {
    this.s.edit((p) => { p.objects[pid].children.splice(i, 1); });
    this.s.select({ id: pid, path: this.s.sel.path.length > 1 ? this.s.sel.path.slice(0, -1) : (pid === this.s.root ? [] : null) });
  }

  async remove() {
    const o = this.o;
    if (o.type === 0) { toast('De Working Set kan je niet verwijderen.'); return; }
    const refs = refsTo(this.s.project, o.id);
    if (refs.length > 1 && !(await confirmDlg('Verwijderen', `${o.name} wordt gebruikt door ${refs.length} objecten. Alle verwijzingen worden weggehaald.`, 'Verwijderen', true))) return;
    this.s.edit((p) => deleteObject(p, o.id));
    this.s.select(null);
  }
}

function sizeHint(o, p) {
  const s = p.settings;
  if (o.type === 0) return `De werkset-designator is ${s.skWidth} × ${s.skHeight} px (instelling softkeygrootte).`;
  if (o.type === 5) return `Een softkey is ${s.skWidth} × ${s.skHeight} px (instellingen).`;
  return `De terminal toont ${s.skCount} softkeys per pagina.`;
}
