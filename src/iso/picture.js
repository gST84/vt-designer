// Picture Graphic raw data. In the project a picture keeps one palette index per pixel
// (`pixels`, base64); the encoder packs that as 1, 4 or 8 bits per pixel (rows start on a byte
// boundary, first pixel in the most significant bits) and optionally run-length encodes it
// (pairs of count 1–255 + data byte).
import { nearest, PALETTE } from './palette.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function b64enc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
  }
  return s;
}

export function b64dec(s) {
  s = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < s.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export const pixelsOf = (obj) => {
  const px = b64dec(obj.pixels);
  const n = obj.actualWidth * obj.actualHeight;
  if (px.length === n) return px;
  const fixed = new Uint8Array(n);
  fixed.set(px.subarray(0, n));
  return fixed;
};

const BPP = [1, 4, 8];
const rowBytes = (w, format) => Math.ceil((w * BPP[format]) / 8);

/** Packed (and optionally RLE-compressed) raw data of a picture object. */
export function pictureRaw(obj) {
  const w = obj.actualWidth, h = obj.actualHeight, f = obj.format;
  const px = pixelsOf(obj);
  const rb = rowBytes(w, f);
  const raw = new Uint8Array(rb * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = px[y * w + x];
      const o = y * rb;
      if (f === 2) raw[o + x] = v;
      else if (f === 1) raw[o + (x >> 1)] |= (v & 15) << (x & 1 ? 0 : 4);
      else if (v & 1) raw[o + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return obj.options & 4 ? rleEncode(raw) : raw;
}

/** Palette indices (one per pixel) from raw picture data. */
export function pixelsFromRaw(obj, data) {
  const w = obj.actualWidth, h = obj.actualHeight, f = obj.format;
  const raw = obj.options & 4 ? rleDecode(data) : data;
  const rb = rowBytes(w, f);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * rb;
      let v;
      if (f === 2) v = raw[o + x];
      else if (f === 1) v = (raw[o + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15;
      else v = (raw[o + (x >> 3)] >> (7 - (x & 7))) & 1;
      px[y * w + x] = v ?? 0;
    }
  }
  return px;
}

export function rleEncode(raw) {
  const out = [];
  for (let i = 0; i < raw.length;) {
    let n = 1;
    while (n < 255 && i + n < raw.length && raw[i + n] === raw[i]) n++;
    out.push(n, raw[i]);
    i += n;
  }
  return Uint8Array.from(out);
}

export function rleDecode(data) {
  const out = [];
  for (let i = 0; i + 1 < data.length; i += 2) for (let k = 0; k < data[i]; k++) out.push(data[i + 1]);
  return Uint8Array.from(out);
}

/** Number of palette entries per format. */
export const COLOURS = [2, 16, 232];

/**
 * Converts RGBA pixels to palette indices for a format. Pixels with alpha < 128 get the
 * transparency colour; other pixels never get that index.
 */
export function quantize(rgba, w, h, format, transparencyColour) {
  const px = new Uint8Array(w * h);
  let transparent = false;
  const cache = new Map();
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (a < 128 && format > 0) { px[i] = transparencyColour; transparent = true; continue; }
    if (format === 0) { px[i] = 0.3 * r + 0.59 * g + 0.11 * b >= 128 ? 1 : 0; continue; }
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = nearest(r, g, b, COLOURS[format], transparencyColour)));
    px[i] = v;
  }
  return { pixels: px, transparent };
}

/** Maps the pixels of a picture onto a (smaller) palette after its format changed. */
export function requantize(obj, fromFormat) {
  if (obj.format >= fromFormat) return;
  const px = pixelsOf(obj);
  const n = COLOURS[obj.format];
  for (let i = 0; i < px.length; i++) {
    const v = px[i];
    if (v < n) continue;
    if (obj.format === 0) px[i] = v === 0 ? 0 : 1;
    else {
      const m = (v === obj.transparencyColour) ? v : remap(v, n);
      px[i] = m;
    }
  }
  obj.pixels = b64enc(px);
}

const remap = (v, n) => nearest(...PALETTE[v], n);
