// Readable listing of the pool, byte by byte per object (like pool_listing.txt).
import { TYPES } from '../iso/schema.js';
import { buildExport, summary } from './common.js';

export function listing(p) {
  const ex = buildExport(p);
  const L = [`Object pool "${p.name}" – ${summary(p, ex)}`, ''];
  ex.pool.chunks.forEach((c, i) => L.push(`deel ${i + 1}: offset ${c.start}, ${c.length} bytes, ${c.count} objecten`));
  L.push('');
  for (const e of ex.pool.entries) {
    L.push(`offset ${String(e.offset).padStart(6)}  object ${String(e.obj.id).padStart(5)}  ${TYPES[e.obj.type].name.padEnd(24)} ${String(e.length).padStart(5)} bytes  ${e.obj.name}`);
    for (let k = 0; k < e.length; k += 24) {
      L.push('              ' + Array.from(e.bytes.slice(k, k + 24), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    }
    L.push('');
  }
  return L.join('\n');
}
