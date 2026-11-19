// Application state: the project, the page on the canvas (root), the selection and undo/redo.
// Every change goes through edit() (or begin/live/end for drags) so it can be undone and saved.
import { newProject, normalizeProject, renumber as renumberIds, findPath } from './model.js';
import { debounce } from './util.js';

const KEY = 'vtd.project';
const MAX_UNDO = 200;

/**
 * Selection: { id, path } – path is the chain of placements from the root, [[parentId, index], …]
 * (index into parent.children, or into the keys of a Soft Key Mask); null when the object was
 * picked from a list and is not placed on the current page.
 */
export class Store {
  constructor() {
    this.handlers = {};
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.dragSnap = null;
    let p = null;
    try { p = JSON.parse(localStorage.getItem(KEY)); } catch { /* no saved project */ }
    this.project = p && p.objects ? normalizeProject(p) : newProject();
    this.root = this.defaultRoot();
    this.saveState = 'saved';
    this.persist = debounce(() => this.saveNow(), 400);
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, detail = {}) { for (const fn of this.handlers[ev] || []) fn(detail); }

  get O() { return this.project.objects; }

  defaultRoot() {
    const ws = Object.values(this.O).find((o) => o.type === 0);
    if (ws && this.O[ws.activeMask]) return ws.activeMask;
    return ws?.id ?? Number(Object.keys(this.O)[0] ?? 0);
  }

  /**
   * Runs fn(project); records an undo step when something changed. `source` tells listeners who
   * changed it. Edits with the same `merge` key in quick succession (typing) form one undo step.
   */
  edit(fn, source = 'edit', merge = null) {
    const before = JSON.stringify(this.project);
    const r = fn(this.project);
    if (JSON.stringify(this.project) === before) return r;
    const now = Date.now();
    if (!(merge && merge === this.lastMerge && now - this.lastMergeT < 2000)) {
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.lastMerge = merge;
    this.lastMergeT = now;
    this.redoStack = [];
    this.fix();
    this.changed(source);
    return r;
  }

  /** Start of a drag: changes until end() form one undo step. */
  begin() { this.dragSnap = JSON.stringify(this.project); }
  live() { this.emit('change', { source: 'drag' }); }
  end() {
    if (this.dragSnap === null) return;
    if (JSON.stringify(this.project) !== this.dragSnap) {
      this.undoStack.push(this.dragSnap);
      this.redoStack = [];
      this.changed('canvas');
    }
    this.dragSnap = null;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.undoStack.pop());
    this.fix();
    this.changed('undo');
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.redoStack.pop());
    this.fix();
    this.changed('undo');
  }

  setProject(p) {
    this.project = normalizeProject(p);
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.root = this.defaultRoot();
    this.changed('load');
    this.emit('root');
  }

  select(sel) {
    this.sel = sel && this.O[sel.id] ? { id: sel.id, path: sel.path || null } : null;
    this.emit('select');
  }

  /** Selects an object, with its place on the open page when it is there. */
  selectObject(id) {
    this.select({ id, path: findPath(this.project, this.root, id) });
  }

  setRoot(id, selectIt = true) {
    if (!this.O[id]) return;
    this.root = id;
    this.sel = selectIt ? { id, path: [] } : null;
    this.emit('root');
    this.emit('select');
  }

  /** Changes an object ID everywhere, including selection and root. Returns an error text or null. */
  renumber(oldId, newId) {
    let msg = null;
    this.edit((p) => { msg = renumberIds(p, oldId, Number(newId)); });
    if (msg) return msg;
    newId = Number(newId);
    const map = (id) => (id === oldId ? newId : id);
    if (this.root === oldId) this.root = newId;
    if (this.sel) this.sel = { id: map(this.sel.id), path: this.sel.path?.map(([pid, i]) => [map(pid), i]) ?? null };
    this.emit('root');
    this.emit('select');
    return null;
  }

  /** Drops a selection or root that no longer exists (after undo, delete). */
  fix() {
    if (!this.O[this.root]) { this.root = this.defaultRoot(); this.emit('root'); }
    const s = this.sel;
    if (!s) return;
    if (!this.O[s.id]) { this.sel = null; return; }
    if (s.path && s.path.length) {
      const ok = s.path.every(([pid, i], k) => {
        const par = this.O[pid];
        const childId = par?.type === 4 ? par.keys[i] : par?.children?.[i]?.id;
        const next = k + 1 < s.path.length ? s.path[k + 1][0] : s.id;
        // the next parent may sit behind an Object Pointer
        return childId !== undefined && (childId === next || this.O[childId]?.type === 27);
      }) && s.path[0][0] === this.root;
      if (!ok) this.sel = { id: s.id, path: null };
    }
  }

  changed(source) {
    this.saveState = 'dirty';
    this.emit('change', { source });
    this.persist();
  }

  saveNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.project));
      this.saveState = 'saved';
    } catch {
      this.saveState = 'error';
    }
    this.emit('saved');
  }
}
