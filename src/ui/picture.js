// Image import for a Picture Graphic: scale, convert to the VT palette, preview.
import { h, pickFiles } from '../util.js';
import { quantize, b64enc, pictureRaw } from '../iso/picture.js';
import { pictureUrl } from '../render.js';
import { modal, toast } from './dialogs.js';

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Dit bestand kan niet als afbeelding gelezen worden.'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Lets the user pick an image and returns the attributes of a Picture Graphic
 * ({width, actualWidth, actualHeight, format, options, transparencyColour, pixels}) or null.
 * `existing`: a picture whose settings are the starting point.
 */
export async function importPicture(existing) {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return null;
  let img;
  try { img = await loadImage(file); } catch (e) { toast(e.message); return null; }
  const st = {
    w: Math.min(img.naturalWidth, existing?.actualWidth > 1 ? existing.actualWidth : 160),
    format: existing?.format ?? 2,
    rle: existing ? !!(existing.options & 4) : true,
    tc: existing?.transparencyColour ?? 13,
  };
  const ratio = img.naturalHeight / img.naturalWidth;
  let result = null;
  const prev = h('div', { class: 'picprev big' });
  const info = h('small');
  const wIn = h('input', { type: 'number', min: 1, max: 4096, value: st.w });
  const fmt = h('select', null, [[2, '256 kleuren (8 bit)'], [1, '16 kleuren (4 bit)'], [0, 'Monochroom (1 bit)']]
    .map(([v, t]) => h('option', { value: v, selected: v === st.format ? true : null }, t)));
  const rle = h('input', { type: 'checkbox', checked: st.rle });
  const redraw = () => {
    st.w = Math.max(1, Math.min(4096, Math.round(Number(wIn.value) || 1)));
    st.format = Number(fmt.value);
    st.rle = rle.checked;
    const w = st.w, hh = Math.max(1, Math.round(w * ratio));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hh;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, hh);
    const data = g.getImageData(0, 0, w, hh).data;
    const tc = st.format === 1 ? 13 : st.tc;
    const q = quantize(data, w, hh, st.format, tc);
    result = {
      width: existing?.width && existing.actualWidth === w ? existing.width : w,
      actualWidth: w, actualHeight: hh, format: st.format,
      options: (q.transparent ? 1 : 0) | (st.rle ? 4 : 0) | ((existing?.options ?? 0) & 2),
      transparencyColour: tc, pixels: b64enc(q.pixels),
    };
    const bytes = pictureRaw(result).length;
    prev.innerHTML = '';
    prev.append(h('img', { src: pictureUrl(result), style: { width: Math.min(420, w * Math.max(1, Math.floor(200 / w))) + 'px', imageRendering: 'pixelated' } }));
    info.textContent = `${w} × ${hh} px – ${bytes} bytes beelddata${q.transparent ? ', met transparantie' : ''}` + (bytes > 1700 ? ' – groot: past niet in één TP-overdracht van 1784 bytes' : '');
  };
  wIn.oninput = redraw;
  fmt.onchange = redraw;
  rle.onchange = redraw;
  redraw();
  const ok = await modal({
    title: 'Afbeelding importeren',
    wide: true,
    body: h('div', { class: 'form cols2' },
      h('div', null,
        h('p', { class: 'hint' }, `${file.name}: ${img.naturalWidth} × ${img.naturalHeight} px`),
        h('label', { class: 'field' }, h('span', null, 'Breedte (pixels in de pool)'), wIn),
        h('label', { class: 'field' }, h('span', null, 'Kleuren'), fmt),
        h('label', { class: 'check' }, rle, 'RLE-compressie (meestal veel kleiner)'),
        h('p', { class: 'hint' }, 'Kleuren worden omgezet naar het VT-palet. Doorzichtige pixels krijgen de transparante kleur (magenta, 13).')),
      h('div', null, prev, info)),
    buttons: [{ label: 'Annuleren', value: false }, { label: 'Importeren', value: true, primary: true }],
  });
  URL.revokeObjectURL(img.src);
  return ok ? result : null;
}
