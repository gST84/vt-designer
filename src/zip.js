// Minimal ZIP writer: files are stored without compression, which is plenty for a handful of
// PLC source files. Returns the archive as a Uint8Array.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** UTF-8 bytes of a string (without TextEncoder, so the headless tests can use it too). */
export function utf8(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** files: [{ name, data: string | Uint8Array }] → ZIP bytes. Strings are stored as UTF-8. */
export function zip(files, date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8(f.name);
    const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
    const crc = crc32(data);
    // shared part of the local and central headers: version, flags (bit 11 = UTF-8 names),
    // method 0 (stored), time, date, CRC, sizes, name length
    const common = (v, at) => {
      v.setUint16(at, 20, true);
      v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 4, 0, true);
      v.setUint16(at + 6, time, true);
      v.setUint16(at + 8, day, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, data.length, true);
      v.setUint32(at + 18, data.length, true);
      v.setUint16(at + 22, name.length, true);
    };
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    common(local, 4);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // made by
    common(cd, 6);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
