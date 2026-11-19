// Modal dialogs, toasts and the colour palette popup.
import { h } from '../util.js';
import { css, colourName } from '../iso/palette.js';

/**
 * Shows a modal. buttons: [{label, value, primary?, danger?}]. Resolves with the clicked value
 * (undefined when closed). onButton(value) may return false to keep the dialog open.
 */
export function modal({ title, body, buttons = [{ label: 'Sluiten' }], wide = false, onButton }) {
  return new Promise((resolve) => {
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if ([...document.querySelectorAll('.modal-back')].pop() !== back) return;
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = buttons.find((b) => b.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); click(primary.value); }
      }
    };
    const click = async (v) => {
      if (onButton && (await onButton(v)) === false) return;
      close(v);
    };
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(undefined); } },
      h('div', { class: 'modal' + (wide ? ' wide' : '') },
        h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon', title: 'Sluiten', onclick: () => close(undefined) }, '✕')),
        h('div', { class: 'modal-body' }, body),
        buttons.length ? h('div', { class: 'modal-foot' }, buttons.map((b) =>
          h('button', { class: (b.primary ? 'primary' : '') + (b.danger ? ' danger' : ''), onclick: () => click(b.value) }, b.label))) : null));
    document.activeElement?.blur?.();
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => {
      const f = back.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
      f?.focus();
      if (f?.type === 'text') f.select();
    }, 30);
  });
}

export async function prompt(title, value = '', label = '') {
  const input = h('input', { type: 'text', value });
  const ok = await modal({
    title,
    body: h('label', { class: 'field' }, label ? h('span', null, label) : null, input),
    buttons: [{ label: 'Annuleren', value: false }, { label: 'OK', value: true, primary: true }],
  });
  return ok ? input.value : null;
}

export async function confirmDlg(title, text, okLabel = 'OK', danger = false) {
  return !!(await modal({
    title,
    body: h('p', null, text),
    buttons: [{ label: 'Annuleren', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  }));
}

let toastTimer;
export function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) document.body.append((el = h('div', { class: 'toast' })));
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

/** Popup next to `anchor` with the 256 VT colours; calls onPick(index). `max` limits the choice (16-colour pictures). */
export function palettePopup(anchor, current, onPick, max = 256) {
  document.querySelector('.popup')?.remove();
  const pop = h('div', { class: 'popup palette' });
  const sw = (i) => h('button', {
    class: 'sw' + (i === current ? ' active' : ''), title: `${i} – ${colourName(i)}`, style: { background: css(i) },
    onclick: () => { close(); onPick(i); },
  });
  pop.append(h('div', { class: 'hint' }, 'Standaardkleuren'), h('div', { class: 'swrow std' }, Array.from({ length: Math.min(16, max) }, (_, i) => sw(i))));
  if (max > 16) {
    pop.append(h('div', { class: 'hint' }, 'Kleurkubus (16–231)'));
    const grid = h('div', { class: 'swrow cube' });
    // 6 blocks of red, each 6 × 6 green/blue
    for (let g = 0; g < 6; g++) for (let r = 0; r < 6; r++) for (let b = 0; b < 6; b++) grid.append(sw(16 + r * 36 + g * 6 + b));
    pop.append(grid);
  }
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(4, Math.min(window.innerWidth - pr.width - 4, r.left)) + 'px';
  pop.style.top = (r.bottom + pr.height + 4 > window.innerHeight ? Math.max(4, r.top - pr.height - 4) : r.bottom + 4) + 'px';
  const away = (e) => { if (!pop.contains(e.target)) close(); };
  const close = () => { pop.remove(); document.removeEventListener('mousedown', away, true); };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

/** Small colour button: swatch + number. */
export function colourButton(value, onPick, max = 256) {
  const b = h('button', { class: 'colourbtn', type: 'button' },
    h('span', { class: 'swatch', style: { background: css(value) } }), h('span', null, `${value} ${colourName(value)}`));
  b.onclick = () => palettePopup(b, value, onPick, max);
  return b;
}
