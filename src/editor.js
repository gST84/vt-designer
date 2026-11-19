// Canvas: shows the current page (mask, key, container …) at a zoom factor, selects objects,
// moves them and resizes them with handles.
import { renderRoot, boxOfPath } from './render.js';
import { hasField } from './iso/schema.js';
import { sizeOf } from './model.js';
import { h } from './util.js';

const PAD = 8;

export class Editor {
  constructor(store, host) {
    this.s = store;
    this.host = host;
    this.zoom = 1;
    this.fit = true;
    this.showHidden = true;
    this.showGrid = false;
    this.drag = null;
    this.scroller = h('div', { class: 'scroller' });
    this.stage = h('div', { class: 'stage' });
    this.scroller.append(this.stage);
    host.append(this.scroller);
    this.stage.addEventListener('pointerdown', (e) => this.down(e));
    this.stage.addEventListener('pointermove', (e) => { if (!this.drag) this.hover(e); });
    this.stage.addEventListener('dblclick', (e) => {
      const key = e.target.closest('[data-open]');
      if (key) this.s.setRoot(Number(key.dataset.open));
    });
    this.scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.scroller.addEventListener('pointerdown', (e) => { if (e.target === this.scroller || e.target === this.stage) this.s.select({ id: this.s.root, path: [] }); });
    store.on('change', () => this.render());
    store.on('root', () => { this.fit = true; this.render(); });
    store.on('select', () => this.overlay());
    new ResizeObserver(() => { if (this.fit) this.applyZoom(); }).observe(host);
  }

  render() {
    const r = renderRoot(this.s.project, this.s.root, { showHidden: this.showHidden });
    this.W = r.w;
    this.H = r.h;
    const vb = `${-PAD} ${-PAD} ${r.w + 2 * PAD} ${r.h + 2 * PAD}`;
    this.stage.innerHTML = `<svg class="vt" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${r.markup}<g class="grid"></g><g class="overlay"></g></svg>`;
    this.svg = this.stage.firstChild;
    this.applyZoom();
    this.overlay();
  }

  applyZoom() {
    if (!this.svg) return;
    if (this.fit) {
      const aw = this.host.clientWidth - 32, ah = this.host.clientHeight - 32;
      this.zoom = Math.max(0.2, Math.min(4, aw / (this.W + 2 * PAD), ah / (this.H + 2 * PAD)));
    }
    this.svg.setAttribute('width', Math.round((this.W + 2 * PAD) * this.zoom));
    this.svg.setAttribute('height', Math.round((this.H + 2 * PAD) * this.zoom));
    this.drawGrid();
    this.s.emit('zoom', { zoom: this.zoom });
  }

  setZoom(z) {
    this.fit = false;
    this.zoom = Math.max(0.2, Math.min(8, z));
    this.applyZoom();
    this.overlay();
  }

  fitView() { this.fit = true; this.applyZoom(); this.overlay(); }

  drawGrid() {
    const g = this.svg?.querySelector('.grid');
    if (!g) return;
    const step = this.s.project.settings.grid;
    if (!this.showGrid || step < 2 || step * this.zoom < 4) { g.innerHTML = ''; return; }
    const root = this.s.O[this.s.root];
    const [w, hh] = sizeOf(this.s.project, root);
    let d = '';
    for (let x = step; x < w; x += step) d += `M${x} 0V${hh}`;
    for (let y = step; y < hh; y += step) d += `M0 ${y}H${w}`;
    g.innerHTML = `<path d="${d}" class="gridline"/>`;
  }

  /** Pointer position in VT pixels of the page. */
  toVt(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const r = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    return { x: r.x, y: r.y };
  }

  hover(e) {
    if (!this.svg) return;
    const p = this.toVt(e);
    this.s.emit('pointer', { x: Math.floor(p.x), y: Math.floor(p.y) });
  }

  /** Selection rectangle and resize handles. */
  overlay() {
    const g = this.svg?.querySelector('.overlay');
    if (!g) return;
    const sel = this.s.sel;
    g.innerHTML = '';
    if (!sel?.path) return;
    const b = sel.path.length ? boxOfPath(this.s.project, sel.path, sel.id) : { x: 0, y: 0, w: sizeOf(this.s.project, this.s.O[sel.id])[0], h: sizeOf(this.s.project, this.s.O[sel.id])[1] };
    if (!b) return;
    const k = 1 / this.zoom;
    let out = `<rect class="selbox" x="${b.x}" y="${b.y}" width="${Math.max(b.w, 1)}" height="${Math.max(b.h, 1)}"/>`;
    for (const [name, hx, hy] of this.handles(sel, b)) {
      out += `<rect class="handle" data-h="${name}" x="${hx - 4 * k}" y="${hy - 4 * k}" width="${8 * k}" height="${8 * k}"/>`;
    }
    g.innerHTML = out;
  }

  handles(sel, b) {
    if (!sel.path.length || this.s.O[sel.path[sel.path.length - 1][0]]?.type === 4) return [];
    const o = this.s.O[sel.id];
    if (!o || !hasField(o.type, 'width')) return [];
    const { x, y, w, h: hh } = b;
    if (!hasField(o.type, 'height')) return [['e', x + w, y + hh / 2], ['se', x + w, y + hh]];
    return [['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + hh / 2],
      ['se', x + w, y + hh], ['s', x + w / 2, y + hh], ['sw', x, y + hh], ['w', x, y + hh / 2]];
  }

  /** Which level of a nested hit to select: the top level first, deeper with a double click (Alt: deepest). */
  pick(full, deeper, deepest) {
    if (deepest) return full;
    const cur = this.s.sel?.path;
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    if (cur?.length && cur.length <= full.length && cur.every((st, i) => same(st, full[i]))) {
      return deeper && cur.length < full.length ? full.slice(0, cur.length + 1) : cur;
    }
    if (cur?.length > 1) {
      const d = cur.length - 1;
      if (d < full.length && cur.slice(0, d).every((st, i) => same(st, full[i]))) return full.slice(0, d + 1);
    }
    return full.slice(0, 1);
  }

  down(e) {
    if (e.button !== 0 || !this.svg) return;
    const pt = this.toVt(e);
    const handle = e.target.closest('[data-h]');
    const sel = this.s.sel;
    if (handle && sel?.path?.length) {
      e.preventDefault();
      const o = this.s.O[sel.id];
      const [pid, i] = sel.path[sel.path.length - 1];
      const c = this.s.O[pid].children[i];
      this.startDrag(e, { mode: 'resize', h: handle.dataset.h, start: pt, o, c, ox: c.x, oy: c.y, ow: o.width, oh: o.height ?? o.width, points: o.points ? JSON.parse(JSON.stringify(o.points)) : null });
      return;
    }
    const g = e.target.closest('[data-path]');
    if (!g) { this.s.select({ id: this.s.root, path: [] }); return; }
    const full = g.dataset.path.split('/').map((s) => s.split('.').map(Number));
    const path = this.pick(full, e.detail >= 2, e.altKey);
    const [pid, i] = path[path.length - 1];
    const par = this.s.O[pid];
    const id = par.type === 4 ? par.keys[i] : par.children[i].id;
    this.s.select({ id, path });
    if (par.type === 4) return;
    e.preventDefault();
    const c = par.children[i];
    this.startDrag(e, { mode: 'move', start: pt, c, ox: c.x, oy: c.y });
  }

  startDrag(e, d) {
    this.drag = { ...d, moved: false };
    const move = (ev) => this.move(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (this.drag?.moved) this.s.end();
      this.drag = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const pt = this.toVt(e);
    const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) * this.zoom < 3) return;
      d.moved = true;
      this.s.begin();
    }
    const g = e.shiftKey ? 1 : Math.max(1, this.s.project.settings.grid);
    const snap = (v) => Math.round(v / g) * g;
    // the drag keeps references to the objects of the project at begin(); undo replaces the project
    const O = this.s.O;
    if (d.mode === 'move') {
      d.c.x = snap(d.ox + dx);
      d.c.y = snap(d.oy + dy);
    } else {
      const o = d.o;
      const square = !hasField(o.type, 'height');
      let { ox: x, oy: y, ow: w, oh: hh } = d;
      if (d.h.includes('e')) w = snap(d.ox + d.ow + dx) - d.ox;
      if (d.h.includes('s')) hh = snap(d.oy + d.oh + dy) - d.oy;
      if (d.h.includes('w')) { x = snap(d.ox + dx); w = d.ow + d.ox - x; }
      if (d.h.includes('n')) { y = snap(d.oy + dy); hh = d.oh + d.oy - y; }
      w = Math.max(1, w);
      hh = Math.max(o.type === 13 ? 0 : 1, hh);
      if (square && d.h === 'se') w = Math.max(w, hh);
      o.width = Math.round(w);
      if (!square) o.height = Math.round(hh);
      d.c.x = Math.round(x);
      d.c.y = Math.round(y);
      if (d.points && d.ow && d.oh) {
        o.points = d.points.map((p) => ({ x: Math.round((p.x * o.width) / d.ow), y: Math.round((p.y * (o.height ?? 0)) / d.oh) }));
      }
    }
    if (!O[d.c.id]) return;
    this.s.live();
  }
}
