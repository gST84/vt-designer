// Draws VT objects as SVG markup, the way a terminal shows them (as far as the standard defines it).
// Every placed child is a <g data-path="parentId.index/…"> so the editor can find what was clicked.
import { FONT_SIZES, NONE } from './iso/schema.js';
import { css } from './iso/palette.js';
import { pixelsOf } from './iso/picture.js';
import { fixedString } from './iso/codec.js';
import { sizeOf } from './model.js';
import { esc } from './util.js';

const SK_GAP = 12;

/**
 * Markup of a page. Returns { markup, w, h }.
 * Masks get their soft key column on the right; a Soft Key Mask shows its keys stacked.
 */
export function renderRoot(p, rootId, opt = {}) {
  const rc = { p, O: p.objects, depth: 0, defs: new Map(), showHidden: opt.showHidden !== false };
  const root = rc.O[rootId];
  if (!root) return { markup: '', w: 100, h: 100 };
  const s = p.settings;
  const [w, h] = sizeOf(p, root);
  let body = '';
  let W = w, H = h;
  switch (root.type) {
    case 0: case 1: case 2: case 5:
      body = `<rect class="area" width="${w}" height="${h}" fill="${css(root.bgColour)}"/>` + children(rc, root, '');
      if ((root.type === 1 || root.type === 2)) {
        const col = softKeyColumn(rc, root, w + SK_GAP);
        body += col;
        W = w + SK_GAP + s.skWidth;
        H = Math.max(h, s.skHeight * s.skCount);
      }
      break;
    case 4:
      body = `<rect class="area" width="${w}" height="${h}" fill="${css(root.bgColour)}"/>`;
      root.keys.forEach((kid, i) => { body += placement(rc, kid, 0, i * s.skHeight, `${root.id}.${i}`); });
      for (let i = root.keys.length; i < Math.max(s.skCount, root.keys.length); i++) body += `<rect class="slot" x="0" y="${i * s.skHeight}" width="${s.skWidth}" height="${s.skHeight}"/>`;
      break;
    default:
      body = `<rect class="area free" width="${w}" height="${h}"/>` + objectBody(rc, root, w, h, '');
  }
  const defs = rc.defs.size ? `<defs>${[...rc.defs.values()].join('')}</defs>` : '';
  return { markup: defs + body, w: W, h: H };
}

function softKeyColumn(rc, mask, x0) {
  const s = rc.p.settings;
  const skm = rc.O[mask.softKeyMask];
  let out = `<g class="skcol" transform="translate(${x0} 0)">`;
  for (let i = 0; i < s.skCount; i++) {
    const kid = skm?.type === 4 ? skm.keys[i] : undefined;
    const key = keyOf(rc, kid);
    const y = i * s.skHeight;
    if (!key) { out += `<rect class="slot" x="0" y="${y}" width="${s.skWidth}" height="${s.skHeight}"/>`; continue; }
    out += `<g class="skslot" data-open="${key.id}" transform="translate(0 ${y})"><title>${esc(key.name)} – dubbelklik om te openen</title>`
      + objectBody(rc, key, s.skWidth, s.skHeight, null) + `<rect class="slotline" width="${s.skWidth}" height="${s.skHeight}"/></g>`;
  }
  if (skm?.keys.length > s.skCount) out += `<text class="more" x="${s.skWidth / 2}" y="${s.skCount * s.skHeight + 12}">+${skm.keys.length - s.skCount}</text>`;
  return out + '</g>';
}

const keyOf = (rc, id) => {
  const o = rc.O[id];
  if (o?.type === 27) return rc.O[o.value]?.type === 5 ? rc.O[o.value] : null;
  return o?.type === 5 ? o : null;
};

function children(rc, o, path) {
  return (o.children || []).map((c, i) => placement(rc, c.id, c.x, c.y, path === null ? null : (path ? path + '/' : '') + `${o.id}.${i}`)).join('');
}

/** One placed object. `path` null = not selectable on its own (list items, soft key column). */
function placement(rc, id, x, y, path) {
  const o = rc.O[id];
  if (!o) return `<g transform="translate(${x} ${y})"${path ? ` class="pl" data-path="${path}"` : ''}><rect class="missing" width="16" height="16"/></g>`;
  if (rc.depth > 12) return '';
  let [w, h] = sizeOf(rc.p, o);
  if (o.type === 27 && !rc.O[o.value]) [w, h] = [20, 20];
  rc.depth++;
  const body = objectBody(rc, o, w, h, path);
  rc.depth--;
  const hidden = o.type === 3 && o.hidden ? ' hiddenobj' : '';
  const attrs = path === null ? '' : ` class="pl${hidden}" data-path="${path}"`;
  return `<g${attrs} transform="translate(${x} ${y})"><rect class="hit" width="${Math.max(w, 2)}" height="${Math.max(h, 2)}"/>${body}</g>`;
}

const clip = (w, h, inner) => `<svg width="${w}" height="${h}" overflow="hidden">${inner}</svg>`;

function objectBody(rc, o, w, h, path) {
  switch (o.type) {
    case 0: case 1: case 2:
      return `<rect width="${w}" height="${h}" fill="${css(o.bgColour)}"/>` + clip(w, h, children(rc, o, path));
    case 3:
      if (o.hidden && !rc.showHidden) return '';
      return clip(w, h, children(rc, o, path)) + `<rect class="${o.hidden ? 'hiddenframe' : 'contframe'}" width="${w}" height="${h}"/>`;
    case 5:
      return `<rect width="${w}" height="${h}" fill="${css(o.bgColour)}"/>` + clip(w, h, children(rc, o, path));
    case 6: return button(rc, o, w, h, path);
    case 7: return inputBoolean(rc, o, w);
    case 8: case 11: {
      const v = rc.O[o.variableReference];
      const text = v?.type === 22 ? fixedString(v.value, v.length) : o.value;
      return field(o, w, h, textSvg(rc, text, w, h, o.fontAttributes, o.justification, o.options & 2), o.type === 8);
    }
    case 9: case 12: {
      const v = rc.O[o.variableReference];
      const raw = v?.type === 21 ? v.value : o.value;
      const f = fontInfo(rc, o.fontAttributes);
      const text = formatNumber(o, raw, Math.floor(w / f.cw));
      return field(o, w, h, textSvg(rc, text, w, h, o.fontAttributes, o.justification, false), o.type === 9);
    }
    case 10: {
      const v = rc.O[o.variableReference];
      const idx = v?.type === 21 ? v.value : o.value;
      const item = o.items[idx];
      const inner = item !== undefined && item !== NONE ? placement(rc, item, 0, 0, null) : '';
      return clip(w, h, inner) + `<rect class="inp" width="${w}" height="${h}"/>`;
    }
    case 13: return outputLine(rc, o, w, h);
    case 14: return outputRect(rc, o, w, h);
    case 15: return outputEllipse(rc, o, w, h);
    case 16: return outputPolygon(rc, o);
    case 17: return meter(rc, o, w);
    case 18: return linearBar(rc, o, w, h);
    case 19: return archedBar(rc, o, w, h);
    case 20: return `<image href="${pictureUrl(o)}" width="${w}" height="${h}" preserveAspectRatio="none" style="image-rendering:pixelated"/>`;
    case 27: {
      const t = rc.O[o.value];
      if (!t) return '<rect class="missing" width="20" height="20"/>';
      if (rc.depth > 12) return '';
      const [tw, th] = sizeOf(rc.p, t);
      rc.depth++;
      const out = objectBody(rc, t, tw, th, path === null ? null : path);
      rc.depth--;
      return out;
    }
    default: return '';
  }
}

function field(o, w, h, text, input) {
  const bg = o.options & 1 ? '' : `<rect width="${w}" height="${h}" fill="${css(o.bgColour)}"/>`;
  return bg + text + (input ? `<rect class="inp" width="${w}" height="${h}"/>` : '');
}

// ---------- text ----------
export function fontInfo(rc, fid) {
  const f = rc.O[fid];
  if (!f || f.type !== 23) return { cw: 8, ch: 12, col: 0, style: 0, missing: true };
  const [cw, ch] = FONT_SIZES[f.fontSize] || [8, 12];
  return { cw, ch, col: f.fontColour, style: f.fontStyle };
}

function wrapLines(text, cols, wrap) {
  const out = [];
  for (const para of String(text ?? '').split(/\r\n|\r|\n/)) {
    if (!wrap) { out.push(para); continue; }
    let rest = para;
    while (rest.length > cols) {
      let cut = rest.lastIndexOf(' ', cols);
      if (cut <= 0) cut = cols;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, '');
    }
    out.push(rest);
  }
  return out;
}

function textSvg(rc, text, w, h, fontId, just, wrap) {
  const f = fontInfo(rc, fontId);
  const cols = Math.max(1, Math.floor(w / f.cw));
  const lines = wrapLines(text, cols, wrap).map((l) => l.replace(/ +$/, ''));
  const hj = just & 3, vj = (just >> 2) & 3;
  const total = lines.length * f.ch;
  const y0 = vj === 1 ? Math.floor((h - total) / 2) : vj === 2 ? h - total : 0;
  const inv = f.style & 16;
  const fg = css(f.col);
  let s = '';
  const deco = (f.style & 1 ? ' font-weight="bold"' : '') + (f.style & 8 ? ' font-style="italic"' : '');
  lines.forEach((ln, i) => {
    if (!ln) return;
    const lw = ln.length * f.cw;
    const x = hj === 1 ? Math.floor((w - lw) / 2) : hj === 2 ? w - lw : 0;
    const y = y0 + i * f.ch;
    if (inv) s += `<rect x="${x}" y="${y}" width="${lw}" height="${f.ch}" fill="${fg}"/>`;
    s += `<text class="vt" x="${x}" y="${y + f.ch * 0.8}" font-size="${f.ch * 0.92}" textLength="${lw}" lengthAdjust="spacingAndGlyphs" fill="${inv ? '#fff' : fg}"${deco}>${esc(ln)}</text>`;
    if (f.style & 4) s += `<rect x="${x}" y="${y + f.ch - Math.max(1, f.ch / 12)}" width="${lw}" height="${Math.max(1, f.ch / 12)}" fill="${fg}"/>`;
    if (f.style & 2) s += `<rect x="${x}" y="${y + f.ch / 2}" width="${lw}" height="${Math.max(1, f.ch / 12)}" fill="${fg}"/>`;
  });
  if (f.missing) s += `<rect class="missing" width="${w}" height="${h}"/>`;
  return clip(w, h, s);
}

/** Text of an Output/Input Number: (raw + offset) × scale with the given decimals. */
export function formatNumber(o, raw, cols) {
  let v = ((raw >>> 0) + o.offset) * o.scale;
  if (o.options & 4 && v === 0) return '';
  let s;
  if (o.format === 1) s = v.toExponential(o.decimals);
  else {
    if (o.options & 8) { const k = 10 ** o.decimals; v = Math.trunc(v * k) / k; }
    s = v.toFixed(o.decimals);
  }
  if (o.options & 2) {
    const neg = s.startsWith('-');
    s = (neg ? '-' : '') + (neg ? s.slice(1) : s).padStart(cols - (neg ? 1 : 0), '0');
  }
  return s;
}

// ---------- shapes ----------
function lineOf(rc, lid) {
  const l = rc.O[lid];
  if (!l || l.type !== 24) return { w: 1, col: '#000', dash: '' };
  return { w: l.lineWidth, col: css(l.lineColour), dash: dashOf(l.lineArt) };
}

function dashOf(art) {
  if (art === 0xffff) return '';
  if (art === 0) return '0 16';
  const runs = [];
  for (let i = 15; i >= 0; i--) {
    const b = (art >> i) & 1;
    if (runs.length && runs[runs.length - 1][0] === b) runs[runs.length - 1][1]++;
    else runs.push([b, 1]);
  }
  if (runs.length > 1 && runs[0][0] === runs[runs.length - 1][0]) runs[0][1] += runs.pop()[1];
  while (runs[0][0] === 0) runs.push(runs.shift());
  return runs.map((r) => r[1]).join(' ');
}

const strokeAttrs = (st) => (st.w ? ` stroke="${st.col}" stroke-width="${st.w}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}` : ' stroke="none"');

function fillOf(rc, fid, lineCol) {
  const f = rc.O[fid];
  if (!f || f.type !== 25 || f.fillType === 0) return 'none';
  if (f.fillType === 1) return lineCol;
  if (f.fillType === 2) return css(f.fillColour);
  const pic = rc.O[f.fillPattern];
  if (pic?.type !== 20) return css(f.fillColour);
  const id = `pat${pic.id}`;
  rc.defs.set(id, `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${pic.actualWidth}" height="${pic.actualHeight}"><image href="${pictureUrl(pic)}" width="${pic.actualWidth}" height="${pic.actualHeight}" style="image-rendering:pixelated"/></pattern>`);
  return `url(#${id})`;
}

function outputLine(rc, o, w, h) {
  const st = lineOf(rc, o.lineAttributes);
  const [y1, y2] = o.lineDirection ? [h, 0] : [0, h];
  return `<line x1="0" y1="${y1}" x2="${w}" y2="${y2}" stroke-linecap="square"${strokeAttrs(st)}/>`;
}

function outputRect(rc, o, w, h) {
  const st = lineOf(rc, o.lineAttributes);
  const fill = fillOf(rc, o.fillAttributes, st.col);
  let s = fill !== 'none' ? `<rect width="${w}" height="${h}" fill="${fill}"/>` : '';
  if (st.w) {
    const a = st.w / 2;
    const sides = [[0, a, w, a], [w - a, 0, w - a, h], [w, h - a, 0, h - a], [a, h, a, 0]];
    sides.forEach(([x1, y1, x2, y2], i) => {
      if (!(o.lineSuppression & (1 << i))) s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${strokeAttrs(st)}/>`;
    });
  }
  return s;
}

/** Points along an arc (VT angles in degrees, 0 = right, anticlockwise positive). */
function arcPoints(cx, cy, rx, ry, a0, a1, dir = 1) {
  let sweep = dir > 0 ? a1 - a0 : a0 - a1;
  sweep = ((sweep % 360) + 360) % 360 || 360;
  const n = Math.max(8, Math.ceil(sweep / 4));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (dir * sweep * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy - ry * Math.sin(a)]);
  }
  return pts;
}
const ptsStr = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

function outputEllipse(rc, o, w, h) {
  const st = lineOf(rc, o.lineAttributes);
  const fill = fillOf(rc, o.fillAttributes, st.col);
  const a = st.w / 2;
  const cx = w / 2, cy = h / 2, rx = Math.max(0, w / 2 - a), ry = Math.max(0, h / 2 - a);
  if (o.ellipseType === 0 || o.startAngle === o.endAngle) return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${strokeAttrs(st)}/>`;
  const pts = arcPoints(cx, cy, rx, ry, o.startAngle * 2, o.endAngle * 2);
  if (o.ellipseType === 1) return `<polyline points="${ptsStr(pts)}" fill="none"${strokeAttrs(st)}/>`;
  if (o.ellipseType === 3) pts.unshift([cx, cy]);
  return `<polygon points="${ptsStr(pts)}" fill="${fill}"${strokeAttrs(st)}/>`;
}

function outputPolygon(rc, o) {
  const st = lineOf(rc, o.lineAttributes);
  const pts = o.points.map((p) => `${p.x},${p.y}`).join(' ');
  if (o.polygonType === 3) return `<polyline points="${pts}" fill="none"${strokeAttrs(st)}/>`;
  const fill = fillOf(rc, o.fillAttributes, st.col);
  return `<polygon points="${pts}" fill="${fill}" fill-rule="evenodd"${strokeAttrs(st)}/>`;
}

const valueOf = (rc, o, ref = 'variableReference', own = 'value') => {
  const v = rc.O[o[ref]];
  return v?.type === 21 ? v.value : o[own];
};
const frac = (v, min, max) => (max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0);

function meter(rc, o, w) {
  const r = w / 2;
  const cw = o.options & 8 ? -1 : 1;
  const a0 = o.startAngle * 2, a1 = o.endAngle * 2;
  let sweep = cw > 0 ? a1 - a0 : a0 - a1;
  sweep = ((sweep % 360) + 360) % 360 || 360;
  const ang = (t) => ((a0 + cw * sweep * t) * Math.PI) / 180;
  const at = (t, rr) => [r + rr * Math.cos(ang(t)), r - rr * Math.sin(ang(t))];
  let s = '';
  if (o.options & 2) s += `<circle cx="${r}" cy="${r}" r="${r - 0.5}" fill="none" stroke="${css(o.borderColour)}"/>`;
  if (o.options & 1) s += `<polyline points="${ptsStr(arcPoints(r, r, r * 0.86, r * 0.86, a0, a1, cw))}" fill="none" stroke="${css(o.arcColour)}" stroke-width="1"/>`;
  if (o.options & 4 && o.ticks > 0) {
    for (let i = 0; i < o.ticks; i++) {
      const t = o.ticks === 1 ? 0 : i / (o.ticks - 1);
      const [x1, y1] = at(t, r * 0.86), [x2, y2] = at(t, r * 0.72);
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${css(o.arcColour)}"/>`;
    }
  }
  const [nx, ny] = at(frac(valueOf(rc, o), o.minValue, o.maxValue), r * 0.8);
  s += `<line x1="${r}" y1="${r}" x2="${nx}" y2="${ny}" stroke="${css(o.needleColour)}" stroke-width="2" stroke-linecap="round"/>`;
  s += `<circle cx="${r}" cy="${r}" r="${Math.max(2, r / 20)}" fill="${css(o.needleColour)}"/>`;
  return s;
}

function linearBar(rc, o, w, h) {
  const col = css(o.colour);
  const horiz = o.options & 16, rev = o.options & 32, line = o.options & 8;
  const pos = (t) => (horiz ? (rev ? w - t * w : t * w) : rev ? t * h : h - t * h);
  const f = frac(valueOf(rc, o), o.minValue, o.maxValue);
  let s = '';
  const p = pos(f), p0 = pos(0);
  if (line) s += horiz ? `<line x1="${p}" y1="0" x2="${p}" y2="${h}" stroke="${col}" stroke-width="2"/>` : `<line x1="0" y1="${p}" x2="${w}" y2="${p}" stroke="${col}" stroke-width="2"/>`;
  else s += horiz ? `<rect x="${Math.min(p, p0)}" y="0" width="${Math.abs(p - p0)}" height="${h}" fill="${col}"/>` : `<rect x="0" y="${Math.min(p, p0)}" width="${w}" height="${Math.abs(p - p0)}" fill="${col}"/>`;
  if (o.options & 4 && o.ticks > 0) {
    for (let i = 0; i < o.ticks; i++) {
      const q = pos(o.ticks === 1 ? 0 : i / (o.ticks - 1));
      s += horiz ? `<line x1="${q}" y1="${h - 4}" x2="${q}" y2="${h}" stroke="${col}"/>` : `<line x1="0" y1="${q}" x2="4" y2="${q}" stroke="${col}"/>`;
    }
  }
  if (o.options & 2) {
    const q = pos(frac(valueOf(rc, o, 'targetVariableReference', 'targetValue'), o.minValue, o.maxValue));
    s += horiz ? `<line x1="${q}" y1="0" x2="${q}" y2="${h}" stroke="${css(o.targetLineColour)}" stroke-width="2"/>` : `<line x1="0" y1="${q}" x2="${w}" y2="${q}" stroke="${css(o.targetLineColour)}" stroke-width="2"/>`;
  }
  if (o.options & 1) s += `<rect x=".5" y=".5" width="${Math.max(0, w - 1)}" height="${Math.max(0, h - 1)}" fill="none" stroke="${col}"/>`;
  return s;
}

function archedBar(rc, o, w, h) {
  const col = css(o.colour);
  const dir = o.options & 16 ? -1 : 1;
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
  const bw = Math.min(o.barWidth, rx, ry);
  const a0 = o.startAngle * 2, a1 = o.endAngle * 2;
  let sweep = dir > 0 ? a1 - a0 : a0 - a1;
  sweep = ((sweep % 360) + 360) % 360 || 360;
  const angAt = (t) => a0 + dir * sweep * t;
  const band = (t0, t1) => {
    const outer = arcPoints(cx, cy, rx, ry, angAt(t0), angAt(t1), dir);
    const inner = arcPoints(cx, cy, rx - bw, ry - bw, angAt(t0), angAt(t1), dir).reverse();
    return ptsStr([...outer, ...inner]);
  };
  const radial = (t, c, sw = 2) => {
    const a = (angAt(t) * Math.PI) / 180;
    return `<line x1="${cx + rx * Math.cos(a)}" y1="${cy - ry * Math.sin(a)}" x2="${cx + (rx - bw) * Math.cos(a)}" y2="${cy - (ry - bw) * Math.sin(a)}" stroke="${c}" stroke-width="${sw}"/>`;
  };
  const f = frac(valueOf(rc, o), o.minValue, o.maxValue);
  let s = '';
  if (o.options & 8) s += radial(f, col);
  else if (f > 0) s += `<polygon points="${band(0, f)}" fill="${col}"/>`;
  if (o.options & 2) s += radial(frac(valueOf(rc, o, 'targetVariableReference', 'targetValue'), o.minValue, o.maxValue), css(o.targetLineColour));
  if (o.options & 1) s += `<polygon points="${band(0, 1)}" fill="none" stroke="${col}"/>`;
  return s;
}

function button(rc, o, w, h, path) {
  const noBorder = o.options & (4 | 32);
  const pressed = o.options & 2;
  let s = o.options & 8 ? '' : `<rect width="${w}" height="${h}" fill="${css(o.bgColour)}"/>`;
  s += clip(w, h, children(rc, o, path));
  if (!noBorder) {
    const b = css(o.borderColour);
    s += `<rect x="1" y="1" width="${Math.max(0, w - 2)}" height="${Math.max(0, h - 2)}" fill="none" stroke="${b}" stroke-width="2"/>`;
    s += pressed
      ? `<path d="M3 ${h - 3}V3H${w - 3}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>`
      : `<path d="M3 ${h - 3}H${w - 3}V3" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>`;
  }
  if (o.options & 16) s += `<rect width="${w}" height="${h}" fill="#fff" fill-opacity=".5"/>`;
  return s;
}

function inputBoolean(rc, o, w) {
  const f = rc.O[o.foreground];
  const fg = css(f?.type === 23 ? f.fontColour : 0);
  const on = valueOf(rc, o);
  let s = `<rect width="${w}" height="${w}" fill="${css(o.bgColour)}"/><rect x=".5" y=".5" width="${w - 1}" height="${w - 1}" fill="none" stroke="${fg}"/>`;
  if (on) s += `<polyline points="${w * 0.2},${w * 0.52} ${w * 0.42},${w * 0.74} ${w * 0.8},${w * 0.26}" fill="none" stroke="${fg}" stroke-width="${Math.max(1.5, w / 10)}"/>`;
  if (!o.enabled) s += `<rect width="${w}" height="${w}" fill="#888" fill-opacity=".35"/>`;
  return s + `<rect class="inp" width="${w}" height="${w}"/>`;
}

// ---------- pictures ----------
const picCache = new Map();
/** Data URL (PNG) of a Picture Graphic, cached per content. */
export function pictureUrl(o) {
  const key = `${o.actualWidth}x${o.actualHeight}|${o.format}|${o.options & 1}|${o.transparencyColour}|${o.pixels}`;
  let url = picCache.get(key);
  if (url) return url;
  const w = Math.max(1, o.actualWidth), h = Math.max(1, o.actualHeight);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const px = pixelsOf(o);
  const transparent = o.options & 1;
  for (let i = 0; i < w * h; i++) {
    const v = px[i] ?? 0;
    const hex = css(v);
    img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i * 4 + 3] = transparent && v === o.transparencyColour ? 0 : 255;
  }
  g.putImageData(img, 0, 0);
  url = c.toDataURL();
  if (picCache.size > 200) picCache.clear();
  picCache.set(key, url);
  return url;
}

/** Absolute box of a placement path on the page: {x, y, w, h}. */
export function boxOfPath(p, path, id) {
  let x = 0, y = 0;
  for (const [pid, i] of path) {
    const par = p.objects[pid];
    if (!par) return null;
    if (par.type === 4) { y += i * p.settings.skHeight; continue; }
    const c = par.children?.[i];
    if (!c) return null;
    x += c.x;
    y += c.y;
  }
  const [w, h] = sizeOf(p, p.objects[id]);
  return { x, y, w, h };
}
