// Shared parts of the PLC exports: the encoded pool, the named object IDs and string lengths.
import { encodePool } from '../iso/codec.js';
import { TYPES } from '../iso/schema.js';

export const APP = 'PLC VT Designer';
/**
 * Version of the designer. It is shown in the app and written into every generated block (title,
 * comment, VERSION), so the PLC shows which export it holds. Raise it with every change of the app.
 */
export const APP_VERSION = '1.3';

/** IEC 61131-3 / SCL words that cannot be used as names. */
const RESERVED = new Set(`ABS ACOS ACTION ADD AND ANY ARRAY ASIN AT ATAN BEGIN BOOL BY BYTE CASE CHAR CONST CONSTANT COS DATE DINT DIV DO DT DWORD ELSE ELSIF END_ACTION
END_CASE END_FOR END_FUNCTION END_FUNCTION_BLOCK END_IF END_PROGRAM END_REPEAT END_STRUCT END_TYPE END_VAR END_WHILE EQ EXIT EXP EXPT FALSE FOR FUNCTION
FUNCTION_BLOCK GE GT IF INT INTERFACE LE LEN LINT LN LOG LREAL LT LWORD MAX MID MIN MOD MUL NE NOT OF OR POINTER PROGRAM REAL REF REPEAT RETAIN RETURN
SEL SIN SINT SIZE SQRT STRING STRUCT SUB TAN THEN TIME TO TOD TRUE TYPE UDINT UINT ULINT UNION UNTIL USINT VAR VAR_GLOBAL VAR_INPUT VAR_OUTPUT
VAR_TEMP WCHAR WHILE WORD WSTRING XOR`.split(/\s+/));

export const plcName = (n) => (RESERVED.has(String(n).toUpperCase()) ? 'o_' + n : n);

export const h2 = (b) => '16#' + b.toString(16).toUpperCase().padStart(2, '0');

export function buildExport(p) {
  const pool = encodePool(p.objects, p.export.chunkMax || 1784);
  const named = pool.entries.map((e) => e.obj);
  const strings = named.filter((o) => TYPES[o.type].fields.some((f) => f.k === 'string' && f.fixed));
  return { pool, named, strings, size: pool.bytes.length };
}

export function summary(p, ex) {
  const n = ex.pool.chunks.length;
  return `${ex.size} bytes, ${ex.named.length} objecten, ${n} ${n === 1 ? 'deel' : 'delen'} voor TP (max. ${p.export.chunkMax} bytes per Object Pool Transfer)`;
}

/** Local date and time of the export, e.g. 2026-11-25 14:05. */
export function stamp() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** "gegenereerd door PLC VT Designer 1.0 (2026-11-25 14:05)" for the header comments. */
export const generatedBy = () => `gegenereerd door ${APP} ${APP_VERSION} (${stamp()})`;

/** SCL string literal: $ and ' escaped, characters outside Latin-1 as ?. */
export const sclText = (s) => "'" + [...String(s)].map((c) => (c.charCodeAt(0) > 255 ? '?' : c)).join('').replace(/\$/g, '$$$$').replace(/'/g, "$$'") + "'";

/** TITLE line of a generated block: what it is, the designer version and the export time. */
export const blockTitle = (what) => `TITLE = ${sclText(`${what} - VT Designer ${APP_VERSION}, ${stamp()}`)}`;

