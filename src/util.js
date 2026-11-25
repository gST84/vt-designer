// Small DOM helpers.

/** Hyperscript: h('div', {class: 'x', onclick}, ...children). Attributes starting with "on" become listeners. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function download(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Opens a file picker; resolves with the chosen files (empty on cancel). */
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

const ICONS = {
  new: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/><path d="M8.5 8v5M6 10.5h5"/>',
  open: '<path d="M1.5 4V13h11.5l1.8-6.5H4.2L2.5 13"/><path d="M1.5 4V2.5h4.5l1.5 1.5h5V6.5"/>',
  save: '<path d="M2 2h9.5L14 4.5V14H2z"/><path d="M5 2v4h5.5V2M4.5 14V9.5h7V14"/>',
  import: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/><path d="M8.5 13V8M6.3 10.2 8.5 8l2.2 2.2"/>',
  export: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/><path d="M8.5 8v5M6.3 10.8 8.5 13l2.2-2.2"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  check: '<path d="M2.5 8.5 6 12l7.5-8"/>',
  implement: '<path d="M1.5 11.5h13"/><path d="M3 11.5V8.5h10v3"/><path d="M4.5 11.5v2M8 11.5v2M11.5 11.5v2"/><path d="M8 8.5V5.5M6 5.5h4"/>',
  // object types (toolbar)
  t11: '<path d="M3.5 4.5V3h9v1.5M8 3v10M6 13h4"/>',
  t12: '<path d="M6.5 2.5 5 13.5M11 2.5l-1.5 11M3 6h10.5M2.5 10h10.5"/>',
  t14: '<rect x="2.5" y="4" width="11" height="8" rx=".5"/>',
  t15: '<ellipse cx="8" cy="8" rx="6" ry="4.5"/>',
  t13: '<path d="M3 13 13 3"/>',
  t16: '<path d="M8 2.5l5.5 4-2 6.5h-7l-2-6.5z"/>',
  t20: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="m2.5 12.5 4-4.5 3 3 1.8-1.8 2.2 2.8"/><circle cx="10.8" cy="6" r="1.1"/>',
  t17: '<path d="M2.5 11.5a5.5 5.5 0 0 1 11 0"/><path d="M8 11.5 11 7"/><circle cx="8" cy="11.5" r=".9" fill="currentColor"/>',
  t18: '<rect x="5.5" y="2.5" width="5" height="11" rx=".5"/><path d="M5.5 8.5h5v5h-5z" fill="currentColor"/>',
  t19: '<path d="M2.5 12a5.5 5.5 0 0 1 11 0H11a3 3 0 0 0-6 0z"/><path d="M2.5 12a5.5 5.5 0 0 1 3.4-5.1L7 9.2A3 3 0 0 0 5 12z" fill="currentColor"/>',
  t6: '<rect x="1.5" y="4" width="13" height="8.5" rx="2"/><path d="M3.5 10.5h9" stroke-opacity=".45"/><path d="M5.5 7.5h5"/>',
  t3: '<rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke-dasharray="2 1.6"/><rect x="4" y="5" width="3.5" height="3.5"/><path d="M9.5 10.5h3"/>',
  t27: '<path d="M1.5 8h6.5M5.5 5.5 8 8l-2.5 2.5"/><rect x="10" y="4.5" width="4.5" height="7" rx=".5"/>',
  t7: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="m5 8.2 2.1 2.1L11 5.8"/>',
  t8: '<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M5 6v4M4 6h2M4 10h2"/>',
  t9: '<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M4.2 6.6 5.4 6v4"/><path d="m10.3 7 1.2-1.2L12.7 7M10.3 9l1.2 1.2L12.7 9"/>',
  t10: '<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M4 8h4.5"/><path d="m10.4 7.2 1.2 1.4 1.2-1.4"/>',
};

/** 16 × 16 line icon in the current text colour. */
export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

/** Safe filename from a project name. */
export const fileBase = (s) => String(s || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'project';
