// VT commands that can be stored in a Macro object (ISO 11783-6, annex F). Every command is
// 8 bytes, except Change String Value (5 + length) and Change Child Position (9).
// A layout lists the bytes after the command code: 'id' (2), 'u8', 'u16', 'u32', 'colour',
// 'rel' (1 byte, offset 127 = no change), 'ff' (reserved, 0xFF), 'text' (u16 length + characters).

export const COMMANDS = [
  { code: 0xa0, name: 'Hide/Show Object', nl: 'Verbergen/tonen', layout: [['id', 'obj', 'Object'], ['u8', 'show', 'Actie', [[0, 'Verbergen'], [1, 'Tonen']]]] },
  { code: 0xa1, name: 'Enable/Disable Object', nl: 'In-/uitschakelen', layout: [['id', 'obj', 'Object'], ['u8', 'enable', 'Actie', [[0, 'Uitschakelen'], [1, 'Inschakelen']]]] },
  { code: 0xa2, name: 'Select Input Object', nl: 'Invoerveld selecteren', layout: [['id', 'obj', 'Object'], ['u8', 'option', 'Optie', [[255, 'Selecteren'], [0, 'Openen voor invoer (v4)']]]] },
  { code: 0x92, name: 'ESC', nl: 'Invoer annuleren (ESC)', layout: [] },
  { code: 0xa3, name: 'Control Audio Signal', nl: 'Geluidssignaal', layout: [['u8', 'repeat', 'Herhalingen'], ['u16', 'freq', 'Frequentie (Hz)'], ['u16', 'on', 'Aan (ms)'], ['u16', 'off', 'Uit (ms)']] },
  { code: 0xa4, name: 'Set Audio Volume', nl: 'Volume', layout: [['u8', 'volume', 'Volume (%)']] },
  { code: 0xa5, name: 'Change Child Location', nl: 'Kind verschuiven', layout: [['id', 'parent', 'Ouder'], ['id', 'obj', 'Kind'], ['rel', 'dx', 'Δx'], ['rel', 'dy', 'Δy']] },
  { code: 0xa6, name: 'Change Size', nl: 'Grootte wijzigen', layout: [['id', 'obj', 'Object'], ['u16', 'w', 'Breedte'], ['u16', 'h', 'Hoogte']] },
  { code: 0xa7, name: 'Change Background Colour', nl: 'Achtergrondkleur wijzigen', layout: [['id', 'obj', 'Object'], ['colour', 'colour', 'Kleur']] },
  { code: 0xa8, name: 'Change Numeric Value', nl: 'Waarde wijzigen', layout: [['id', 'obj', 'Object'], ['ff'], ['u32', 'value', 'Waarde']] },
  { code: 0xa9, name: 'Change End Point', nl: 'Eindpunt lijn wijzigen', layout: [['id', 'obj', 'Lijn'], ['u16', 'w', 'Breedte'], ['u16', 'h', 'Hoogte'], ['u8', 'dir', 'Richting', [[0, 'Linksboven → rechtsonder'], [1, 'Linksonder → rechtsboven']]]] },
  { code: 0xaa, name: 'Change Font Attributes', nl: 'Lettertype wijzigen', layout: [['id', 'obj', 'Lettertype'], ['colour', 'colour', 'Kleur'], ['u8', 'size', 'Grootte (code)'], ['u8', 'type', 'Tekenset'], ['u8', 'style', 'Stijl (bits)']] },
  { code: 0xab, name: 'Change Line Attributes', nl: 'Lijnattributen wijzigen', layout: [['id', 'obj', 'Lijnattributen'], ['colour', 'colour', 'Kleur'], ['u8', 'width', 'Dikte'], ['u16', 'art', 'Patroon']] },
  { code: 0xac, name: 'Change Fill Attributes', nl: 'Vulattributen wijzigen', layout: [['id', 'obj', 'Vulattributen'], ['u8', 'type', 'Vulling'], ['colour', 'colour', 'Kleur'], ['id', 'pattern', 'Patroon']] },
  { code: 0xad, name: 'Change Active Mask', nl: 'Actief masker wijzigen', layout: [['id', 'ws', 'Werkset'], ['id', 'mask', 'Masker']] },
  { code: 0xae, name: 'Change Soft Key Mask', nl: 'Softkeymasker wijzigen', layout: [['u8', 'maskType', 'Soort masker', [[1, 'Datamasker'], [2, 'Alarmmasker']]], ['id', 'mask', 'Masker'], ['id', 'skm', 'Softkeymasker']] },
  { code: 0xaf, name: 'Change Attribute', nl: 'Attribuut wijzigen', layout: [['id', 'obj', 'Object'], ['u8', 'aid', 'Attribuut-ID'], ['u32', 'value', 'Waarde']] },
  { code: 0xb0, name: 'Change Priority', nl: 'Prioriteit alarm wijzigen', layout: [['id', 'obj', 'Alarmmasker'], ['u8', 'priority', 'Prioriteit', [[0, 'Hoog'], [1, 'Middel'], [2, 'Laag']]]] },
  { code: 0xb1, name: 'Change List Item', nl: 'Lijstitem wijzigen', layout: [['id', 'obj', 'Lijst'], ['u8', 'index', 'Index'], ['id', 'item', 'Nieuw item']] },
  { code: 0xb3, name: 'Change String Value', nl: 'Tekst wijzigen', layout: [['id', 'obj', 'Object'], ['text', 'text', 'Tekst']] },
  { code: 0xb4, name: 'Change Child Position', nl: 'Kind verplaatsen', layout: [['id', 'parent', 'Ouder'], ['id', 'obj', 'Kind'], ['u16', 'x', 'X'], ['u16', 'y', 'Y']] },
];

export const CMD = Object.fromEntries(COMMANDS.map((c) => [c.code, c]));
const SIZE = { id: 2, u8: 1, u16: 2, u32: 4, colour: 1, rel: 1, ff: 1 };

/** Length in bytes of the command that starts at data[p]. */
export function commandLength(data, p) {
  const code = data[p];
  if (code === 0xb3) return 5 + (data[p + 3] | (data[p + 4] << 8));
  if (code === 0xb4) return 9;
  return 8;
}

/** Splits macro bytes into commands (arrays of bytes). */
export function splitCommands(data) {
  const out = [];
  for (let p = 0; p < data.length;) {
    const n = Math.min(commandLength(data, p), data.length - p);
    out.push(Array.from(data.slice(p, p + n)));
    p += n;
  }
  return out;
}

export const joinCommands = (cmds) => Uint8Array.from((cmds || []).flat());

/**
 * Projects up to file version 1 stored macros with the codes 0xA3–0xB2 one too high (ESC as 0xA3
 * … Change List Item as 0xB2). Returns the command bytes with the ISO 11783-6 codes. A stored
 * command may hold several commands (raw input), so every command start in it is remapped.
 */
export function upgradeV1Command(bytes) {
  const out = Array.from(bytes);
  for (let p = 0; p < out.length;) {
    const n = commandLength(out, p); // 0xB3/0xB4 (variable length) kept their codes
    if (out[p] === 0xa3) out[p] = 0x92;
    else if (out[p] > 0xa3 && out[p] <= 0xb2) out[p] -= 1;
    p += n;
  }
  return out;
}

/** Values of a command as an object keyed by the layout names (null for unknown codes). */
export function decodeCommand(bytes) {
  const def = CMD[bytes[0]];
  if (!def) return null;
  const v = {};
  let p = 1;
  for (const [k, n] of def.layout) {
    if (k === 'text') {
      const len = bytes[p] | (bytes[p + 1] << 8);
      v[n] = String.fromCharCode(...bytes.slice(p + 2, p + 2 + len));
      p += 2 + len;
      continue;
    }
    const b = (i) => bytes[p + i] ?? 0xff;
    if (k === 'id' || k === 'u16') v[n] = b(0) | (b(1) << 8);
    else if (k === 'u32') v[n] = (b(0) | (b(1) << 8) | (b(2) << 16) | (b(3) << 24)) >>> 0;
    else if (k === 'rel') v[n] = b(0) - 127;
    else if (k !== 'ff') v[n] = b(0);
    p += SIZE[k];
  }
  return v;
}

/** Bytes of a command from its code and values. */
export function encodeCommand(code, v) {
  const def = CMD[code];
  const out = [code];
  for (const [k, n] of def.layout) {
    const x = Number(v[n] ?? 0);
    if (k === 'text') {
      const s = String(v[n] ?? '');
      out.push(s.length & 255, s.length >> 8, ...[...s].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63)));
    } else if (k === 'id' || k === 'u16') out.push(x & 255, (x >> 8) & 255);
    else if (k === 'u32') out.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
    else if (k === 'rel') out.push(Math.max(0, Math.min(255, x + 127)));
    else if (k === 'ff') out.push(0xff);
    else out.push(x & 255);
  }
  if (code !== 0xb3 && code !== 0xb4) while (out.length < 8) out.push(0xff);
  return out;
}

/** Default values for a new command. */
export function defaultsFor(code) {
  const v = {};
  for (const [k, n, , opts] of CMD[code].layout) {
    if (!n) continue;
    v[n] = k === 'id' ? 0xffff : k === 'text' ? '' : opts ? opts[0][0] : 0;
  }
  return v;
}

/** One-line description, e.g. "Waarde wijzigen: Snelheid = 12". `nameOf(id)` gives object names. */
export function describeCommand(bytes, nameOf = (id) => String(id)) {
  const def = CMD[bytes[0]];
  if (!def) return 'Onbekend: ' + bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const v = decodeCommand(bytes);
  const parts = def.layout.filter(([k]) => k !== 'ff').map(([k, n, label, opts]) => {
    let x = v[n];
    if (k === 'id') x = x === 0xffff ? '—' : nameOf(x);
    else if (opts) x = opts.find((o) => o[0] === x)?.[1] ?? x;
    else if (k === 'text') x = '"' + x + '"';
    return `${label} ${x}`;
  });
  return def.nl + (parts.length ? ': ' + parts.join(', ') : '');
}
