// Geometry for drawing on the canvas. The pool keeps polygon points relative to the object's own
// box and a line as a box plus a direction, so a drawn shape is turned into that form here.
// Points are { x, y } in whole VT pixels.

/**
 * Points made relative to their own box: the smallest x and y become 0. Returns
 * { points, dx, dy, w, h }, where (dx, dy) is how far the box moved: every placement of the
 * object moves by the same amount, so the shape stays where it was drawn.
 */
export function normalizePoints(points) {
  const dx = Math.min(...points.map((q) => q.x));
  const dy = Math.min(...points.map((q) => q.y));
  const pts = points.map((q) => ({ x: Math.round(q.x - dx), y: Math.round(q.y - dy) }));
  return { points: pts, dx: Math.round(dx), dy: Math.round(dy), w: Math.max(...pts.map((q) => q.x)), h: Math.max(...pts.map((q) => q.y)) };
}

/**
 * Output Line between two points: its box { x, y, w, h } and direction `dir`
 * (0 = top left to bottom right, 1 = bottom left to top right).
 */
export function lineFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
    dir: (b.x - a.x) * (b.y - a.y) < 0 ? 1 : 0,
  };
}

/** The two end points of line `o` placed at (x, y). */
export function lineEnds(o, x, y) {
  const w = o.width ?? 0, h = o.height ?? 0;
  return o.lineDirection ? [{ x, y: y + h }, { x: x + w, y }] : [{ x, y }, { x: x + w, y: y + h }];
}

/**
 * Point `p` seen from `prev`: nearly horizontal or vertical (off by less than 14 %, about 8°)
 * becomes exactly so.
 */
export function straighten(prev, p) {
  const dx = p.x - prev.x, dy = p.y - prev.y;
  if (Math.abs(dy) < 0.14 * Math.abs(dx)) return { x: p.x, y: prev.y };
  if (Math.abs(dx) < 0.14 * Math.abs(dy)) return { x: prev.x, y: p.y };
  return p;
}

const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
/** Segments a–b and c–d cross each other (touching at an end does not count). */
const cross = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;

/** Polygon type for these points: 0 convex, 1 non-convex, 2 complex (edges cross). */
export function polygonKind(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      if (cross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return 2;
    }
  }
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], c = points[(i + 2) % n];
    const turn = Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
    if (!turn) continue;
    if (sign && turn !== sign) return 1;
    sign = turn;
  }
  return 0;
}
