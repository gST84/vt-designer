// Left panel: pages (masks, keys, containers …) with the layers of the open page, and a list of all objects.
import { h } from '../util.js';
import { TYPES, ROOT_TYPES, TYPE_INFO } from '../iso/schema.js';
import { addObject, objectsOfType } from '../model.js';
import { infoMark } from './dialogs.js';

const LAYERS_INFO = 'De objecten op het geopende scherm, met wat erin zit. Wat lager in de lijst staat, wordt later getekend en ligt dus bovenop. Klik om te selecteren.';

const PAGE_GROUPS = [
  [0, 'Werkset'], [1, 'Datamaskers'], [2, 'Alarmmaskers'], [4, 'Softkeymaskers'], [5, 'Softkeys'], [3, 'Containers'], [6, 'Knoppen'],
];

export class Tree {
  constructor(store, host, tabsHost, app) {
    this.s = store;
    this.host = host;
    this.app = app;
    this.tab = 'pages';
    this.filter = '';
    this.collapsed = new Set();
    this.tabs = tabsHost;
    store.on('change', () => this.render());
    store.on('root', () => this.render());
    store.on('select', () => this.render());
  }

  render() {
    this.tabs.innerHTML = '';
    this.tabs.append(
      h('button', { class: this.tab === 'pages' ? 'active' : '', onclick: () => { this.tab = 'pages'; this.render(); } }, 'Schermen'),
      h('button', { class: this.tab === 'objects' ? 'active' : '', onclick: () => { this.tab = 'objects'; this.render(); } }, 'Objecten'),
    );
    const scroll = this.host.scrollTop;
    this.host.innerHTML = '';
    if (this.tab === 'pages') this.pages();
    else this.objects();
    this.host.scrollTop = scroll;
  }

  add(type) {
    let obj;
    this.s.edit((p) => {
      obj = addObject(p, type);
      const ws = Object.values(p.objects).find((o) => o.type === 0);
      if (type === 1 && ws && !p.objects[ws.activeMask]) ws.activeMask = obj.id;
    });
    if (ROOT_TYPES.includes(type)) this.s.setRoot(obj.id);
    else this.s.selectObject(obj.id);
  }

  pages() {
    const s = this.s;
    const ws = Object.values(s.O).find((o) => o.type === 0);
    for (const [type, title] of PAGE_GROUPS) {
      const list = objectsOfType(s.project, [type]);
      const head = h('div', { class: 'grouphead' }, h('span', { class: 'ghl' }, title, infoMark(`${TYPES[type].name}: ${TYPE_INFO[type]}`)),
        type === 0 && list.length ? null : h('button', { class: 'icon', title: `${TYPES[type].name} toevoegen`, onclick: () => this.add(type) }, '+'));
      if (!list.length && (type === 3 || type === 6 || type === 2)) {
        this.host.append(head);
        continue;
      }
      const ul = h('ul', { class: 'pagelist' });
      for (const o of list) {
        const active = o.id === s.root;
        ul.append(h('li', { class: active ? 'active' : '', onclick: () => s.setRoot(o.id), title: `${TYPES[o.type].name} ${o.id}` },
          h('span', { class: 'nm' }, o.name), ws && ws.activeMask === o.id ? h('span', { class: 'badge', title: 'Actief masker van de werkset' }, 'start') : null,
          h('span', { class: 'idno' }, o.id)));
      }
      this.host.append(head, ul);
    }
    const root = s.O[s.root];
    if (root) {
      this.host.append(h('div', { class: 'grouphead layers' }, h('span', { class: 'ghl' }, `Lagen van ${root.name}`, infoMark(LAYERS_INFO))));
      const ul = h('ul', { class: 'layers' });
      this.layers(ul, root, [], 0, new Set([root.id]));
      if (!ul.children.length) ul.append(h('li', { class: 'hint' }, 'Nog leeg: voeg objecten toe met de werkbalk.'));
      this.host.append(ul);
    }
  }

  layers(ul, o, path, depth, seen) {
    const s = this.s;
    let list;
    if (o.type === 4) list = o.keys.map((id) => ({ id }));
    else if (o.type === 27) { const t = s.O[o.value]; if (t && !seen.has(t.id)) this.layers(ul, t, path, depth, new Set([...seen, t.id])); return; }
    else list = o.children || [];
    list.forEach((c, i) => {
      const child = s.O[c.id];
      const p = [...path, [o.id, i]];
      const sel = s.sel && s.sel.id === c.id && JSON.stringify(s.sel.path) === JSON.stringify(p);
      ul.append(h('li', { class: sel ? 'active' : '', style: { paddingLeft: 6 + depth * 14 + 'px' }, onclick: () => s.select({ id: c.id, path: p }) },
        h('span', { class: 'nm' }, child ? child.name : `? ${c.id}`), h('span', { class: 'tp' }, child ? TYPES[child.type].nl : 'ontbreekt')));
      if (child && !seen.has(child.id) && (child.children?.length || child.type === 27)) this.layers(ul, child, p, depth + 1, new Set([...seen, child.id]));
    });
  }

  objects() {
    const s = this.s;
    const search = h('input', { type: 'search', placeholder: 'Zoeken op naam of ID…', value: this.filter, class: 'search' });
    search.oninput = () => { this.filter = search.value; this.renderList(list); };
    const list = h('div');
    this.host.append(search, list);
    this.renderList(list);
    if (this.filter) setTimeout(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); });
  }

  renderList(list) {
    const s = this.s;
    list.innerHTML = '';
    const f = this.filter.trim().toLowerCase();
    for (const t of Object.keys(TYPES).map(Number)) {
      const objs = objectsOfType(s.project, [t]).filter((o) => !f || o.name.toLowerCase().includes(f) || String(o.id).includes(f));
      if (f && !objs.length) continue;
      const open = !this.collapsed.has(t) || f;
      list.append(h('div', { class: 'grouphead' },
        h('span', { class: 'ghl' },
          h('span', { class: 'fold', onclick: () => { this.collapsed.has(t) ? this.collapsed.delete(t) : this.collapsed.add(t); this.renderList(list); } },
            h('span', { class: 'caret' }, objs.length ? (open ? '▾' : '▸') : ' '), `${TYPES[t].nl} `, h('small', null, objs.length || '')),
          infoMark(`${TYPES[t].name}: ${TYPE_INFO[t]}`)),
        t === 0 && objs.length ? null : h('button', { class: 'icon', title: `${TYPES[t].name} toevoegen`, onclick: () => this.addLoose(t) }, '+')));
      if (!open || !objs.length) continue;
      const ul = h('ul', { class: 'pagelist' });
      for (const o of objs) {
        const active = s.sel?.id === o.id;
        ul.append(h('li', {
          class: active ? 'active' : '', title: TYPES[o.type].name,
          onclick: () => s.selectObject(o.id),
          ondblclick: () => { if (ROOT_TYPES.includes(o.type)) s.setRoot(o.id); },
        }, h('span', { class: 'nm' }, o.name), h('span', { class: 'idno' }, o.id)));
      }
      list.append(ul);
    }
  }

  /** New object from the object list: visual objects go onto the open page, others stand alone. */
  addLoose(type) {
    if (ROOT_TYPES.includes(type) && type !== 3 && type !== 6) return this.add(type);
    if (this.app.canPlace(type)) return this.app.place(type);
    this.add(type);
  }
}

