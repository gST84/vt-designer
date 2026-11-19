// VT Designer: start-up, top bar, toolbar, status bar and keyboard shortcuts.
import { Store } from './store.js';
import { Editor } from './editor.js';
import { Tree } from './ui/tree.js';
import { Props } from './ui/props.js';
import { h, icon, download, pickFiles, fileBase } from './util.js';
import { exportDialog, settingsDialog, problemsDialog } from './ui/export.js';
import { confirmDlg, modal, toast } from './ui/dialogs.js';
import { importPicture } from './ui/picture.js';
import { parsePool, encodePool } from './iso/codec.js';
import { validate } from './iso/validate.js';
import { TYPES, CHILD_TYPES, ROOT_TYPES } from './iso/schema.js';
import { addObject, newProject, projectFromObjects, deleteObject, findPath, sizeOf, refsTo } from './model.js';

const store = new Store();
const $ = (s) => document.querySelector(s);

// ---------- placing new objects ----------
/** Where a new object of `type` goes: the selected container/button/key, its parent, or the page. */
function target(type) {
  const O = store.O;
  const sel = store.sel;
  const ok = (o) => o && (CHILD_TYPES[o.type] || []).includes(type);
  if (sel && ok(O[sel.id]) && (sel.path || sel.id === store.root)) return { parent: O[sel.id], path: sel.path || [] };
  if (sel?.path?.length) {
    const [pid] = sel.path[sel.path.length - 1];
    if (ok(O[pid])) return { parent: O[pid], path: sel.path.slice(0, -1) };
  }
  if (ok(O[store.root])) return { parent: O[store.root], path: [] };
  return null;
}

const canPlace = (type) => !!target(type);

async function place(type) {
  const t = target(type);
  if (!t) { toast(`Een ${TYPES[type].name} kan hier niet geplaatst worden.`); return; }
  let attrs = {};
  if (type === 20) {
    const r = await importPicture(null);
    if (!r) return;
    attrs = r;
  }
  let obj, path;
  store.edit((p) => {
    const par = p.objects[t.parent.id];
    obj = addObject(p, type, attrs);
    if (type === 6) {
      const label = addObject(p, 11, { value: 'Knop', length: 8, width: obj.width - 8, height: 16, options: 1, justification: 1 | 4 });
      obj.children.push({ id: label.id, x: 4, y: Math.max(0, Math.round((obj.height - 16) / 2)) });
    }
    const n = par.children.length;
    const [pw, ph] = sizeOf(p, par);
    const [w, hh] = sizeOf(p, obj);
    const off = 10 + (n % 8) * 10;
    par.children.push({ id: obj.id, x: Math.max(0, Math.min(off, pw - w)), y: Math.max(0, Math.min(off, ph - hh)) });
    path = [...t.path, [par.id, n]];
  });
  store.select({ id: obj.id, path });
}

const app = { store, canPlace, place };
window.vtd = app; // handy in the console

// ---------- layout ----------
const editor = new Editor(store, $('#canvas'));
const tree = new Tree(store, $('#tree'), $('#left-tabs'), app);
const props = new Props(store, $('#props'), app);
app.editor = editor;

const btn = (label, title, onclick, cls = '') => h('button', { title, 'aria-label': title, onclick, class: cls }, label);
const sep = () => h('span', { class: 'sep' });
const saveEl = h('span', { class: 'savestate' });
const nameEl = h('button', { class: 'projname', title: 'Project en terminal', onclick: () => settingsDialog(store) });
const undoBtn = btn('↶', 'Ongedaan maken (Ctrl+Z)', () => store.undo());
const redoBtn = btn('↷', 'Opnieuw (Ctrl+Y)', () => store.redo());

$('#top').append(
  h('div', { class: 'brand' }, h('span', { class: 'logo', html: '<svg viewBox="0 0 22 22" width="22" height="22"><rect x="1.5" y="3" width="19" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4.5" y="6" width="9" height="8" fill="currentColor" opacity=".25"/><path d="M16 6.5h2M16 9.5h2M16 12.5h2M7 20h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' }),
    'VT Designer', h('span', { class: 'appname' }, 'ISOBUS')),
  nameEl,
  h('div', { class: 'menu' },
    btn(icon('new'), 'Nieuw project', newProj, 'iconbtn'),
    btn(icon('open'), 'Openen: project (.vtd.json) of object pool (.iop)', openFile, 'iconbtn'),
    btn(icon('save'), 'Project opslaan als bestand (.vtd.json)', saveFile, 'iconbtn'),
    sep(),
    btn([icon('export'), ' Exporteren'], 'Exporteren voor TIA Portal, CODESYS of als .iop (Ctrl+E)', () => exportDialog(store), 'primary'),
    sep(), undoBtn, redoBtn, sep(),
    btn(icon('settings'), 'Project en terminal', () => settingsDialog(store), 'iconbtn')),
  saveEl);

// ---------- toolbar ----------
const ADD = [[11, 'Tekst'], [12, 'Getal'], [14, 'Rechthoek'], [15, 'Ellips'], [13, 'Lijn'], [16, 'Veelhoek'], [20, 'Afbeelding (bestand kiezen)'],
  [17, 'Meter'], [18, 'Staafmeter'], [19, 'Boogmeter'], [6, 'Knop'], [3, 'Container'], [27, 'Verwijzing']];
const INPUT = [[7, 'Invoer ja/nee'], [8, 'Invoer tekst'], [9, 'Invoer getal'], [10, 'Invoer keuzelijst']];
const rootLabel = h('span', { class: 'rootname' });
const addBtns = [];
/** Icon button per object type; the tooltip says where the object goes, or why it cannot. */
const mk = ([t, label]) => {
  const b = h('button', { class: 'tool iconbtn', 'aria-label': `${label} toevoegen`, onclick: () => (b.classList.contains('off') ? toast(b.dataset.tip) : place(t)) }, icon('t' + t));
  addBtns.push([t, b, label]);
  return b;
};
const group = (list) => list.map(mk);
const zoomLbl = h('span', { class: 'zoom' });
const gridChk = h('input', { type: 'checkbox' });
gridChk.onchange = () => { editor.showGrid = gridChk.checked; editor.drawGrid(); };
const hidChk = h('input', { type: 'checkbox', checked: true });
hidChk.onchange = () => { editor.showHidden = hidChk.checked; editor.render(); };
$('#toolbar').append(
  rootLabel, sep(),
  ...group(ADD.slice(0, 2)), sep(), ...group(ADD.slice(2, 7)), sep(), ...group(ADD.slice(7, 10)), sep(), ...group(ADD.slice(10)), sep(),
  ...group(INPUT));

function toolbar() {
  const root = store.O[store.root];
  rootLabel.textContent = root ? `${TYPES[root.type].nl}: ${root.name}` : '';
  const where = root ? `een ${TYPES[root.type].nl.toLowerCase()}` : 'dit scherm';
  for (const [t, b, label] of addBtns) {
    const tg = target(t);
    b.classList.toggle('off', !tg);
    b.setAttribute('aria-disabled', tg ? 'false' : 'true');
    b.dataset.tip = tg ? `${label} (${TYPES[t].name}) – toevoegen aan ${tg.parent.name}` : `${label} (${TYPES[t].name}) kan niet in ${where}`;
  }
}

// ---------- status bar ----------
const stPool = h('span');
const stProb = h('button', { class: 'link probs', onclick: () => showProblems() });
const stPos = h('span');
// view settings sit with the status (the toolbar above is for adding objects)
$('#status').append(stPool, stProb, h('span', { class: 'grow' }), stPos,
  h('span', { class: 'view' },
    h('label', { class: 'check small', title: 'Raster tonen' }, gridChk, 'raster'),
    h('label', { class: 'check small', title: 'Verborgen containers tonen' }, hidChk, 'verborgen'),
    btn('−', 'Uitzoomen', () => editor.setZoom(editor.zoom / 1.25), 'icon'), zoomLbl,
    btn('+', 'Inzoomen', () => editor.setZoom(editor.zoom * 1.25), 'icon'),
    btn('Passend', 'Passend in beeld', () => editor.fitView())));

function status() {
  try {
    const pool = encodePool(store.O, store.project.export.chunkMax);
    stPool.textContent = `Pool: ${pool.bytes.length} bytes · ${Object.keys(store.O).length} objecten · ${pool.chunks.length} TP-${pool.chunks.length === 1 ? 'deel' : 'delen'}`;
  } catch (e) {
    stPool.textContent = 'Pool: ' + e.message;
  }
  const v = validate(store.project);
  const e = v.filter((m) => m.level === 'error').length, w = v.filter((m) => m.level === 'warn').length;
  stProb.className = 'link probs' + (e ? ' error' : w ? ' warn' : '');
  stProb.textContent = e || w ? `${e} fout${e === 1 ? '' : 'en'}, ${w} waarschuwing${w === 1 ? '' : 'en'}` : 'geen problemen';
}

function showProblems() {
  problemsDialog(store, (id) => {
    if (!findPath(store.project, store.root, id)) {
      const pages = Object.values(store.O).filter((o) => ROOT_TYPES.includes(o.type));
      const page = pages.find((r) => findPath(store.project, r.id, id));
      if (page) store.setRoot(page.id, false);
    }
    store.selectObject(id);
  });
}

function topState() {
  nameEl.textContent = store.project.name;
  undoBtn.disabled = !store.undoStack.length;
  redoBtn.disabled = !store.redoStack.length;
  saveEl.className = 'savestate ' + store.saveState;
  saveEl.textContent = { saved: 'Bewaard in de browser', dirty: 'Bewaren…', error: 'Niet bewaard (browseropslag vol?)' }[store.saveState];
}

store.on('change', ({ source }) => { topState(); toolbar(); if (source !== 'drag') status(); });
store.on('saved', topState);
store.on('select', toolbar);
store.on('root', toolbar);
store.on('zoom', ({ zoom }) => { zoomLbl.textContent = Math.round(zoom * 100) + '%'; });
store.on('pointer', ({ x, y }) => { stPos.textContent = `x ${x}  y ${y}`; });

// ---------- files ----------
async function newProj() {
  if (!(await confirmDlg('Nieuw project', 'Het huidige project wordt vervangen door een nieuw project (één scherm met één tekst). Bewaar het eerst met Opslaan als je het wil houden.', 'Nieuw project'))) return;
  store.setProject(newProject());
}

function saveFile() {
  download(`${fileBase(store.project.name)}.vtd.json`, JSON.stringify(store.project, null, 1), 'application/json');
}

async function openFile() {
  const [f] = await pickFiles({ accept: '.json,.vtd,.iop,application/json,application/octet-stream' });
  if (!f) return;
  let p;
  try {
    if (/\.iop$/i.test(f.name)) {
      p = projectFromObjects(parsePool(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.iop$/i, ''));
    } else {
      p = JSON.parse(await f.text());
      if (!p || typeof p.objects !== 'object') throw new Error('geen VT Designer-project');
    }
  } catch (e) {
    await modal({ title: 'Openen mislukt', body: h('p', null, `${f.name}: ${e.message}`), buttons: [{ label: 'OK', value: true, primary: true }] });
    return;
  }
  if (!(await confirmDlg('Openen', `${f.name} vervangt het huidige project. Bewaar dat eerst met Opslaan als je het wil houden.`, 'Openen'))) return;
  store.setProject(p);
  toast(`${f.name} geopend: ${Object.keys(store.O).length} objecten`);
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (document.querySelector('.modal-back')) return;
  if (mod && k === 's') { e.preventDefault(); saveFile(); return; }
  if (mod && k === 'e') { e.preventDefault(); exportDialog(store); return; }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
  const sel = store.sel;
  if (!sel) return;
  if (mod && k === 'd') { e.preventDefault(); props.duplicate(); return; }
  if (e.key === 'Escape') {
    if (sel.path?.length > 1) {
      const up = sel.path.slice(0, -1);
      const [pid, i] = up[up.length - 1];
      const par = store.O[pid];
      store.select({ id: par.type === 4 ? par.keys[i] : par.children[i].id, path: up });
    } else store.select({ id: store.root, path: [] });
    return;
  }
  const last = sel.path?.[sel.path.length - 1];
  const par = last && store.O[last[0]];
  if (e.key.startsWith('Arrow') && par && par.type !== 4) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
    const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    store.edit((p) => { const c = p.objects[last[0]].children[last[1]]; c.x += dx; c.y += dy; }, 'canvas', 'nudge');
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (sel.id === store.root || store.O[sel.id].type === 0) return;
    const refs = refsTo(store.project, sel.id);
    if (par && refs.length > 1) {
      store.edit((p) => {
        const pp = p.objects[last[0]];
        if (pp.type === 4) pp.keys.splice(last[1], 1); else pp.children.splice(last[1], 1);
      });
      toast(`${store.O[sel.id].name} weggehaald uit ${par.name}; het wordt nog elders gebruikt.`);
    } else {
      store.edit((p) => deleteObject(p, sel.id));
    }
    store.select(null);
  }
});

// ---------- start ----------
topState();
toolbar();
status();
tree.render();
props.render();
editor.render();
window.addEventListener('beforeunload', () => store.saveNow());
