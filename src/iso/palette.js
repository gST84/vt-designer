// Standard VT colour palette (ISO 11783-6): 16 fixed colours, a 6×6×6 colour cube (16–231)
// and 24 proprietary entries (232–255, shown black here).

const STD = [
  [0, 0, 0], [255, 255, 255], [0, 153, 0], [0, 153, 153], [153, 0, 0], [153, 0, 153], [153, 153, 0], [204, 204, 204],
  [153, 153, 153], [0, 0, 255], [0, 255, 0], [0, 255, 255], [255, 0, 0], [255, 0, 255], [255, 255, 0], [0, 0, 153],
];
export const STD_NAMES = ['zwart', 'wit', 'groen', 'blauwgroen', 'kastanjebruin', 'paars', 'olijf', 'zilver',
  'grijs', 'blauw', 'limoen', 'cyaan', 'rood', 'magenta', 'geel', 'marineblauw'];

/** 256 × [r, g, b]. */
export const PALETTE = [];
for (let i = 0; i < 256; i++) {
  if (i < 16) PALETTE.push(STD[i]);
  else if (i < 232) {
    const k = i - 16;
    PALETTE.push([Math.floor(k / 36) * 51, (Math.floor(k / 6) % 6) * 51, (k % 6) * 51]);
  } else PALETTE.push([0, 0, 0]);
}

const hex = (v) => v.toString(16).padStart(2, '0');
/** CSS colour of palette index i. */
export const css = (i) => {
  const c = PALETTE[(i ?? 0) & 255];
  return '#' + hex(c[0]) + hex(c[1]) + hex(c[2]);
};

export const colourName = (i) => (i < 16 ? STD_NAMES[i] : i < 232 ? css(i) : 'eigen kleur VT');

/** Nearest palette index for an RGB colour, searching indices [0, n) and skipping `skip`. */
export function nearest(r, g, b, n = 232, skip = -1) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    if (i === skip) continue;
    const c = PALETTE[i];
    // weighted distance (approximates perceived difference)
    const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
