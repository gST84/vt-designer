// Canvas: shows the current page (mask, key, container …) at a zoom factor, selects objects,
// moves them, resizes them with handles, drags the points of polygons and lines, and draws new
// objects with the pointer (tools).
import { renderRoot, boxOfPath } from './render.js';
import { hasField } from './iso/schema.js';
import { sizeOf, placementsOf } from './model.js';
import { normalizePoints, lineFromPoints, lineEnds, straighten, polygonKind } from './geom.js';
import { h } from './util.js';

const PAD = 8;

/**
 * Types drawn with the pointer: drag a box (a click gives the default size), a line from point to
 * point, a polygon point by point. The other types are added at once (a picture needs a file, an
 * object pointer takes the size of what it points to).
 */
export const DRAW_TYPES = [3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

/** A drag shorter than this (screen pixels) is a click; also the distance to close a polygon. */
const CLICK = 4;
const CLOSE = 8;

export class Editor {
  constructor(store, host) {
    this.s = store;
    this.host = host;
    this.zoom = 1;
    this.fit = true;
    this.showHidden = true;
    this.showGrid = false;
    this.drag = null;
    /** Drawing tool: { type, t: where the object goes, pts: points so far, cur: pointer } or null. */
    this.tool = null;
    /** Set by the app: target(type, point, quiet) → { parent, path, origin } and create(type, target, attrs). */
    this.target = null;
    this.create = null;
    this.scroller = h('div', { class: 'scroller' });
    this.stage = h('div', { class: 'stage' });
    this.scroller.append(this.stage);
    /** What to do with the current tool; the app fills in the text. */
    this.hint = h('div', { class: 'toolhint', hidden: true });
    host.append(this.scroller, this.hint);
    this.stage.addEventListener('pointerdown', (e) => this.down(e));
    this.stage.addEventListener('pointermove', (e) => { if (!this.drag) this.hover(e); });
    this.stage.addEventListener('dblclick', (e) => {
      if (this.tool) { if (this.tool.type === 16) this.finishPolygon(false); return; }
      const key = e.target.closest('[data-open]');
      if (key) this.s.setRoot(Number(key.dataset.open));
    });
    this.scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.scroller.addEventListener('pointerdown', (e) => {
      if (this.tool) return;
      if (e.target === this.scroller || e.target === this.stage) this.s.select({ id: this.s.root, path: [] });
    });
    store.on('change', () => this.render());
    store.on('root', () => { this.fit = true; this.restartTool(); this.render(); });
    store.on('select', () => this.overlay());
    new ResizeObserver(() => { if (this.fit) this.applyZoom(); }).observe(host);
  }

  render() {
    const r = renderRoot(this.s.project, this.s.root, { showHidden: this.showHidden });
    this.W = r.w;
    this.H = r.h;
    const vb = `${-PAD} ${-PAD} ${r.w + 2 * PAD} ${r.h + 2 * PAD}`;
    this.stage.innerHTML = `<svg class="vt" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${r.markup}<g class="grid"></g><g class="overlay"></g><g class="drafting"></g></svg>`;
    this.svg = this.stage.firstChild;
    this.applyZoom();
    this.overlay();
    this.drawDraft();
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
    this.drawDraft();
  }

  fitView() { this.fit = true; this.applyZoom(); this.overlay(); this.drawDraft(); }

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

  /** Grid step for a drag: the project grid, or 1 pixel with Shift. */
  step(e) { return e.shiftKey ? 1 : Math.max(1, this.s.project.settings.grid); }

  hover(e) {
    if (!this.svg) return;
    const p = this.toVt(e);
    this.s.emit('pointer', { x: Math.floor(p.x), y: Math.floor(p.y) });
    const T = this.tool;
    if (T) {
      if (!T.t) T.hoverOrigin = this.target?.(T.type, p, true)?.origin;
      T.cur = this.toolPoint(e, p);
      this.drawDraft();
    }
  }

  /** Selection rectangle, resize handles and point handles. */
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
    for (const [name, hx, hy] of this.pointHandles(sel, b)) {
      out += `<circle class="handle pt" data-h="${name}" cx="${hx}" cy="${hy}" r="${4.5 * k}"/>`;
    }
    g.innerHTML = out;
  }

  /** The selection can be changed on the canvas: placed on this page, not as a key of a Soft Key Mask. */
  editable(sel) {
    return sel.path.length && this.s.O[sel.path[sel.path.length - 1][0]]?.type !== 4;
  }

  handles(sel, b) {
    if (!this.editable(sel)) return [];
    const o = this.s.O[sel.id];
    if (!o || !hasField(o.type, 'width') || o.type === 13) return [];
    const { x, y, w, h: hh } = b;
    if (!hasField(o.type, 'height')) return [['e', x + w, y + hh / 2], ['se', x + w, y + hh]];
    return [['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + hh / 2],
      ['se', x + w, y + hh], ['s', x + w / 2, y + hh], ['sw', x, y + hh], ['w', x, y + hh / 2]];
  }

  /** A handle per polygon point (p:i) and per line end (l:0, l:1). */
  pointHandles(sel, b) {
    if (!this.editable(sel)) return [];
    const o = this.s.O[sel.id];
    if (o?.type === 16) return o.points.map((q, i) => [`p:${i}`, b.x + q.x, b.y + q.y]);
    if (o?.type === 13) return lineEnds(o, b.x, b.y).map((q, i) => [`l:${i}`, q.x, q.y]);
    return [];
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
    if (this.tool) { if (this.svg.contains(e.target)) this.toolDown(e); return; }
    const pt = this.toVt(e);
    const handle = e.target.closest('[data-h]');
    const sel = this.s.sel;
    if (handle && sel?.path?.length) {
      e.preventDefault();
      const o = this.s.O[sel.id];
      const [pid, i] = sel.path[sel.path.length - 1];
      const c = this.s.O[pid].children[i];
      const name = handle.dataset.h;
      if (/^[pl]:/.test(name)) {
        // every placement of the object moves along when its box changes, so the shape stays put everywhere
        const b = boxOfPath(this.s.project, sel.path, sel.id);
        const places = placementsOf(this.s.project, sel.id).map(({ parent, index }) => {
          const pc = parent.children[index];
          return { c: pc, x: pc.x, y: pc.y };
        });
        const base = { start: pt, o, c, ox: c.x, oy: c.y, porg: { x: b.x - c.x, y: b.y - c.y }, places, i: Number(name.slice(2)) };
        if (name[0] === 'p') this.startDrag(e, { ...base, mode: 'point', points: o.points.map((q) => ({ ...q })), kind: o.polygonType });
        else this.startDrag(e, { ...base, mode: 'end', ends: lineEnds(o, c.x, c.y) });
        return;
      }
      this.startDrag(e, { mode: 'resize', h: name, start: pt, o, c, ox: c.x, oy: c.y, ow: o.width, oh: o.height ?? o.width, points: o.points ? JSON.parse(JSON.stringify(o.points)) : null });
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
    const g = this.step(e);
    const snap = (v) => Math.round(v / g) * g;
    // the drag keeps references to the objects of the project at begin(); undo replaces the project
    const O = this.s.O;
    if (d.mode === 'move') {
      d.c.x = snap(d.ox + dx);
      d.c.y = snap(d.oy + dy);
    } else if (d.mode === 'point' || d.mode === 'end') {
      // pointer in the coordinates of the parent, on its grid
      let lp = { x: snap(pt.x - d.porg.x), y: snap(pt.y - d.porg.y) };
      let shift;
      if (d.mode === 'point') {
        let q = { x: lp.x - d.ox, y: lp.y - d.oy };
        const n = d.points.length, open = d.kind === 3;
        if (!e.altKey) {
          if (d.i > 0 || !open) q = straighten(d.points[(d.i - 1 + n) % n], q);
          if (d.i < n - 1 || !open) q = straighten(d.points[(d.i + 1) % n], q);
        }
        const norm = normalizePoints(d.points.map((p, k) => (k === d.i ? q : p)));
        d.o.points = norm.points;
        d.o.width = norm.w;
        d.o.height = norm.h;
        if (!open) d.o.polygonType = polygonKind(norm.points);
        shift = [norm.dx, norm.dy];
      } else {
        const other = d.ends[1 - d.i];
        if (!e.altKey) lp = straighten(other, lp);
        const L = d.i === 0 ? lineFromPoints(lp, other) : lineFromPoints(other, lp);
        d.o.width = L.w;
        d.o.height = L.h;
        d.o.lineDirection = L.dir;
        shift = [L.x - d.ox, L.y - d.oy];
      }
      for (const pl of d.places) { pl.c.x = pl.x + shift[0]; pl.c.y = pl.y + shift[1]; }
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

  // ---------- drawing tools ----------

  /** Starts drawing objects of `type` (null, or the type of the current tool: back to selecting). */
  setTool(type) {
    this.tool = type == null || this.tool?.type === type ? null : { type, t: null, pts: [], cur: null };
    this.stage.classList.toggle('drawing', !!this.tool);
    this.hint.hidden = !this.tool;
    this.drawDraft();
    this.s.emit('tool', { type: this.tool?.type ?? null });
  }

  /** Forgets the points drawn so far (other page); the tool stays. */
  restartTool() {
    if (!this.tool) return;
    Object.assign(this.tool, { t: null, pts: [], cur: null, hoverOrigin: null });
  }

  /** Pointer as a point of the tool: in the coordinates of the parent, on the grid, straightened against the previous point. */
  toolPoint(e, p) {
    const T = this.tool;
    const o = T.t?.origin || T.hoverOrigin || { x: 0, y: 0 };
    const g = this.step(e);
    let q = { x: Math.round((p.x - o.x) / g) * g, y: Math.round((p.y - o.y) / g) * g };
    const prev = T.pts[T.pts.length - 1];
    if (prev && (T.type === 16 || T.type === 13) && !e.altKey) q = straighten(prev, q);
    return q;
  }

  toolDown(e) {
    const T = this.tool;
    const pt = this.toVt(e);
    e.preventDefault();
    if (!T.t) {
      T.t = this.target?.(T.type, pt, false);
      if (!T.t) { this.setTool(null); return; }
    }
    const q = this.toolPoint(e, pt);
    T.cur = q;
    if (T.type === 16) {
      const first = T.pts[0];
      const raw = { x: pt.x - T.t.origin.x, y: pt.y - T.t.origin.y };
      if (T.pts.length >= 3 && Math.hypot(raw.x - first.x, raw.y - first.y) * this.zoom < CLOSE) { this.finishPolygon(true); return; }
      const last = T.pts[T.pts.length - 1];
      if (!last || last.x !== q.x || last.y !== q.y) T.pts.push(q);
      this.drawDraft();
      return;
    }
    if (T.type === 13 && T.pts.length === 1) { this.finishLine(q); return; }
    // box or the start of a line: follow the pointer until it is released
    T.pts = [q];
    const sx = e.clientX, sy = e.clientY;
    const move = (ev) => { if (this.tool === T) { T.cur = this.toolPoint(ev, this.toVt(ev)); this.drawDraft(); } };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (this.tool !== T) return;
      const dragged = Math.hypot(ev.clientX - sx, ev.clientY - sy) >= CLICK;
      if (T.type === 13) { if (dragged) this.finishLine(T.cur); return; } // after a click: wait for the end point
      this.finishBox(dragged);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.drawDraft();
  }

  /** Box tools: the dragged rectangle, or the default size at the click. */
  finishBox(dragged) {
    const T = this.tool;
    const a = T.pts[0], b = T.cur;
    const attrs = { x: a.x, y: a.y };
    if (dragged && (a.x !== b.x || a.y !== b.y)) {
      const w = Math.max(1, Math.abs(b.x - a.x)), hh = Math.max(1, Math.abs(b.y - a.y));
      attrs.x = Math.min(a.x, b.x);
      attrs.y = Math.min(a.y, b.y);
      if (hasField(T.type, 'height')) Object.assign(attrs, { width: w, height: hh });
      else attrs.width = Math.max(w, hh); // square: Input Boolean, Meter
    }
    this.done(attrs);
  }

  finishLine(b) {
    const a = this.tool.pts[0];
    if (a.x === b.x && a.y === b.y) return;
    const L = lineFromPoints(a, b);
    this.done({ x: L.x, y: L.y, width: L.w, height: L.h, lineDirection: L.dir });
  }

  /** Closed: back at the first point (type from the shape); open: Enter or a double click (open polygon). */
  finishPolygon(closed) {
    const pts = this.tool.pts;
    if (pts.length < (closed ? 3 : 2)) return;
    const n = normalizePoints(pts);
    this.done({ x: n.dx, y: n.dy, width: n.w, height: n.h, points: n.points, polygonType: closed ? polygonKind(n.points) : 3 });
  }

  done(attrs) {
    const { type, t } = this.tool;
    this.setTool(null);
    this.create?.(type, t, attrs);
  }

  /** Keys while drawing: Esc stops, Enter ends a polygon as an open line, Backspace removes the last point. Returns true when used. */
  key(e) {
    const T = this.tool;
    if (!T || e.ctrlKey || e.metaKey) return false;
    if (e.key === 'Escape') { this.setTool(null); return true; }
    if (e.key === 'Enter' && T.type === 16) { e.preventDefault(); this.finishPolygon(false); return true; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && T.pts.length) {
      e.preventDefault();
      T.pts.pop();
      if (!T.pts.length) T.t = null;
      this.drawDraft();
      return true;
    }
    return false;
  }

  /** What is being drawn: the rectangle or the points so far, the pointer and the size. */
  drawDraft() {
    const g = this.svg?.querySelector('.drafting');
    if (!g) return;
    const T = this.tool;
    if (!T?.cur) { g.innerHTML = ''; return; }
    const o = T.t?.origin || T.hoverOrigin || { x: 0, y: 0 };
    const at = (q) => [q.x + o.x, q.y + o.y];
    const k = 1 / this.zoom;
    const [cx, cy] = at(T.cur);
    let s = '';
    let label = '';
    if (T.type === 16 || T.type === 13) {
      if (T.pts.length) s += `<polyline class="draft" points="${[...T.pts, T.cur].map((q) => at(q).join(',')).join(' ')}"/>`;
      if (T.type === 16 && T.pts.length >= 3) {
        const [fx, fy] = at(T.pts[0]);
        s += `<circle class="draft-close" cx="${fx}" cy="${fy}" r="${CLOSE * k}"/>`;
      }
      for (const q of T.pts) {
        const [x, y] = at(q);
        s += `<circle class="draft-pt" cx="${x}" cy="${y}" r="${2.5 * k}"/>`;
      }
      const prev = T.pts[T.pts.length - 1];
      if (prev) label = `${Math.abs(T.cur.x - prev.x)} × ${Math.abs(T.cur.y - prev.y)}`;
    } else if (T.pts.length) {
      const [ax, ay] = at(T.pts[0]);
      const w = Math.abs(cx - ax), hh = Math.abs(cy - ay);
      s += `<rect class="draft" x="${Math.min(ax, cx)}" y="${Math.min(ay, cy)}" width="${w}" height="${hh}"/>`;
      label = hasField(T.type, 'height') ? `${w} × ${hh}` : `${Math.max(w, hh)}`;
    }
    s += `<circle class="draft-pt" cx="${cx}" cy="${cy}" r="${2.5 * k}"/>`;
    if (label) s += `<text class="draft-txt" x="${cx + 8 * k}" y="${cy - 8 * k}" font-size="${11 * k}">${label}</text>`;
    g.innerHTML = s;
  }
}
