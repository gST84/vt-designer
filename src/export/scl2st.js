// TIA Portal SCL → CODESYS ST.
//
// Translates the SCL subset used by VT_Client, TC_Client and the designer's own exports (UDT files,
// DB sources, FC/FB sources) into CODESYS objects:
//   { kind: 'dut' | 'gvl' | 'pou', name, decl, impl, ... }
// with the declaration and implementation as text (to paste in CODESYS) and the parsed variables
// (for PLCopen XML, src/export/codesys.js). SCL stays the only source: a fix in the TIA blocks reaches
// CODESYS through this translation.
//
// What changes:
//   #x → x, "x" → x, REGION → comment, SHL/SHR(IN := a, N := b) → SHL(a, b),
//   LOWER_BOUND/UPPER_BOUND(ARR := a, DIM := n) → (a, n), TIME_TCK() → TIME(), String → STRING(254),
//   String[n] → STRING(n), Char → BYTE, a function without result (Void) → BOOL, BYTE_TO_CHAR(x) → x, CHAR_TO_BYTE(s[i]) → Strg_Byte(ADR(s), i)
//   (LCan_CL2.st; an index on the STRING itself gave the first character every time in CODESYS), locals with an IL keyword as name (st, sub, …) get another name,
//   a DB becomes a GVL ({attribute 'qualified_only'}) with a DUT per inline Struct and its start values
//   as initialisations, the CM CAN parameters become the CAN layer of LCan_CL2.st (CODESYS CL2).

/** Local names that are keywords in CODESYS (IL operators, standard functions) and get another name. */
export const RENAME = { st: 'step', sub: 'subCmd', len: 'lenB', ld: 'ldV', s: 'sV', r: 'rV', cal: 'calV', ret: 'retV', jmp: 'jmpV' };

const BASE = new Set(['BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT',
  'REAL', 'LREAL', 'TIME', 'LTIME', 'DATE', 'TOD', 'TIME_OF_DAY', 'DT', 'DATE_AND_TIME', 'WSTRING']);

// ---------- masking of comments and strings ----------

/**
 * Replaces comments and string literals by placeholders, so the code can be rewritten with regular
 * expressions. `restore` puts them back.
 */
export function mask(text) {
  const saved = [];
  let out = '';
  let i = 0;
  const keep = (s) => { saved.push(s); out += `\u0001${saved.length - 1}\u0002`; };
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') {
      const e = text.indexOf('\n', i);
      const end = e < 0 ? text.length : e;
      keep(text.slice(i, end));
      i = end;
    } else if (c === '(' && n === '*') {
      const e = text.indexOf('*)', i + 2);
      const end = e < 0 ? text.length : e + 2;
      keep(text.slice(i, end));
      i = end;
    } else if (c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== "'") j += text[j] === '$' ? 2 : 1;
      keep(text.slice(i, j + 1));
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, restore: (s) => s.replace(/\u0001(\d+)\u0002/g, (_, k) => saved[Number(k)]) };
}

// ---------- calls ----------

/**
 * Rewrites every call `name(args)` in `s` (comments and strings masked): fn(args) gives the
 * replacement, with the arguments split at the top level and already rewritten themselves.
 */
export function rewriteCalls(s, name, fn) {
  const re = new RegExp(`(^|[^0-9A-Za-z_#.])${name}\\s*\\(`, 'gi');
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[1].length;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let k = open;
    let argStart = open + 1;
    const args = [];
    for (; k < s.length; k++) {
      const ch = s[k];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') {
        depth--;
        if (depth === 0) break;
      } else if (ch === ',' && depth === 1) {
        args.push(s.slice(argStart, k));
        argStart = k + 1;
      }
    }
    if (k >= s.length) throw new Error(`${name}(: sluitend haakje ontbreekt`);
    const last = s.slice(argStart, k);
    if (last.trim() || args.length) args.push(last);
    out += s.slice(pos, start) + fn(args.map((a) => rewriteCalls(a, name, fn).trim()));
    pos = k + 1;
    re.lastIndex = pos;
  }
  return out + s.slice(pos);
}

const named = (args, names, fn) => {
  const v = {};
  args.forEach((a, i) => {
    const m = /^(\w+)\s*:=\s*([\s\S]*)$/.exec(a);
    if (m && names.includes(m[1].toUpperCase())) v[m[1].toUpperCase()] = m[2].trim();
    else v[names[i]] = a;
  });
  return fn(v);
};

/** CHAR_TO_BYTE(expr[idx]) → Strg_Byte(ADR(expr), idx): character idx (from 1, as in TIA) of a string, read through a
 * pointer by Strg_Byte in LCan_CL2.st. CODESYS documents expr[idx - 1] on a STRING, but on a controller it gave the
 * first character every time ('GEREED' became GGGGGG on the VT). Not a string (Array of Char = BYTE): (expr). */
function charToByte(args) {
  const a = args[0];
  if (!a.endsWith(']')) return `(${a})`;
  let depth = 0;
  for (let k = a.length - 1; k >= 0; k--) {
    if (a[k] === ']') depth++;
    else if (a[k] === '[') {
      depth--;
      if (depth === 0) return `Strg_Byte(ADR(${a.slice(0, k)}), ${a.slice(k + 1, -1)})`;
    }
  }
  return `(${a})`;
}

/** Rewrites the code part (comments and strings masked) of SCL to CODESYS ST. */
function rewriteCode(s, renames) {
  // locals with a reserved name, then #x → x
  s = s.replace(/(^|[^0-9A-Za-z_])#([A-Za-z_]\w*)/g, (_, pre, n) => pre + (renames[n.toLowerCase()] ?? n));
  // "x" → x (quoted names of blocks, types and DBs)
  s = s.replace(/"([A-Za-z_][\w.]*)"/g, '$1');
  for (const f of ['SHL', 'SHR', 'ROL', 'ROR']) {
    s = rewriteCalls(s, f, (a) => named(a, ['IN', 'N'], (v) => `${f}(${v.IN}, ${v.N})`));
  }
  for (const f of ['LOWER_BOUND', 'UPPER_BOUND']) {
    s = rewriteCalls(s, f, (a) => named(a, ['ARR', 'DIM'], (v) => `${f}(${v.ARR}, ${v.DIM})`));
  }
  s = s.replace(/\bTIME_TCK\s*\(\s*\)/g, 'TIME()');
  s = s.replace(/\b(L?T|L?TIME)#([0-9A-Za-z_.]+)/gi, (_, p, v) => `${p}#${v.replace(/_/g, '')}`); // CODESYS: no '_' in a TIME literal
  s = rewriteCalls(s, 'BYTE_TO_CHAR', (a) => `(${a[0]})`);
  s = rewriteCalls(s, 'CHAR_TO_BYTE', charToByte);
  return s;
}

// ---------- types and declarations ----------

/** SCL type text → CODESYS type text. */
export function stType(t) {
  return t.trim()
    .replace(/"([A-Za-z_][\w.]*)"/g, '$1')
    .replace(/\bString\s*\[\s*(\d+)\s*\]/gi, 'STRING($1)')
    .replace(/\bString\b(?!\s*\()/gi, 'STRING(254)')
    .replace(/\bWString\b(?!\s*\()/gi, 'WSTRING(254)')
    .replace(/\bChar\b/gi, 'BYTE')
    .replace(/\bArray\s*\[/gi, 'ARRAY[')
    .replace(/\]\s*of\s+/gi, '] OF ')
    .replace(/\b(Bool|Byte|Word|DWord|LWord|SInt|Int|DInt|LInt|USInt|UInt|UDInt|ULInt|Real|LReal|Time)\b/g, (w) => w.toUpperCase());
}

/** Parsed type: { kind: 'base' | 'string' | 'array' | 'derived' | 'pointer', ... }. */
export function parseType(t) {
  t = t.trim();
  let m;
  if ((m = /^ARRAY\s*\[(.*?)\]\s*OF\s+([\s\S]+)$/i.exec(t))) {
    const dims = m[1].split(',').map((d) => (d.trim() === '*' ? '*' : d.split('..').map((x) => x.trim())));
    return { kind: 'array', dims, of: parseType(m[2]) };
  }
  if ((m = /^POINTER\s+TO\s+([\s\S]+)$/i.exec(t))) return { kind: 'pointer', of: parseType(m[1]) };
  if ((m = /^(W?STRING)\s*\(\s*(\d+)\s*\)$/i.exec(t))) return { kind: 'string', wide: /^W/i.test(m[1]), len: Number(m[2]) };
  if (/^W?STRING$/i.test(t)) return { kind: 'string', wide: /^W/i.test(t), len: 80 };
  if (BASE.has(t.toUpperCase())) return { kind: 'base', name: t.toUpperCase() };
  return { kind: 'derived', name: t };
}

/** Parses an initial value: { kind: 'simple', text } | { kind: 'array', items: [{ rep, value }] } | { kind: 'struct', members: [{ name, value }] }. */
export function parseValue(s) {
  s = s.trim();
  const split = (inner) => {
    const parts = [];
    let depth = 0, q = false, start = 0;
    for (let k = 0; k < inner.length; k++) {
      const c = inner[k];
      if (q) { if (c === '$') k++; else if (c === "'") q = false; continue; }
      if (c === "'") q = true;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { parts.push(inner.slice(start, k)); start = k + 1; }
    }
    parts.push(inner.slice(start));
    return parts.map((x) => x.trim()).filter((x) => x !== '');
  };
  if (s.startsWith('[') && s.endsWith(']')) {
    return {
      kind: 'array',
      items: split(s.slice(1, -1)).map((x) => {
        const m = /^(\d+)\s*\(([\s\S]*)\)$/.exec(x);
        return m ? { rep: Number(m[1]), value: parseValue(m[2]) } : { rep: 1, value: parseValue(x) };
      }),
    };
  }
  if (s.startsWith('(') && s.endsWith(')') && /^\(\s*\w+\s*:=/.test(s)) {
    return {
      kind: 'struct',
      members: split(s.slice(1, -1)).map((x) => {
        const m = /^(\w+)\s*:=\s*([\s\S]*)$/.exec(x);
        return { name: m[1], value: parseValue(m[2]) };
      }),
    };
  }
  return { kind: 'simple', text: s };
}

/** Initial value → ST text; long arrays are wrapped, `ind` is the indentation of continuation lines. */
export function valueText(v, ind = '\t\t') {
  if (v.kind === 'simple') return v.text;
  if (v.kind === 'struct') return `(${v.members.map((m) => `${m.name} := ${valueText(m.value, ind + '\t')}`).join(', ')})`;
  const items = v.items.map((it) => (it.rep > 1 ? `${it.rep}(${valueText(it.value, ind + '\t')})` : valueText(it.value, ind + '\t')));
  const simple = v.items.every((it) => it.value.kind === 'simple');
  if (simple && items.length <= 16) return `[${items.join(', ')}]`;
  const per = simple ? 16 : 1;
  const rows = [];
  for (let k = 0; k < items.length; k += per) rows.push(ind + items.slice(k, k + per).join(', '));
  return `[\n${rows.join(',\n')}\n${ind.slice(1)}]`;
}

/**
 * One declaration line of a VAR section: { name, type, init, comment } or null (blank or comment line).
 * `type` and `init` are already CODESYS text.
 */
export function parseVarLine(line) {
  const { text, restore } = mask(line);
  const m = /^\s*([A-Za-z_]\w*)\s*:\s*([^;]*?)\s*(?::=\s*([^;]*?))?\s*;\s*(\u0001\d+\u0002)?\s*$/.exec(text);
  if (!m) return null;
  const comment = m[4] ? restore(m[4]).replace(/^\/\/\s?/, '').replace(/^\(\*\s*|\s*\*\)$/g, '') : '';
  return { name: m[1], type: stType(restore(m[2])), init: m[3] ? restore(m[3]).trim() : null, comment };
}

// ---------- CAN layer (CM CAN → LCan_CL2.st) ----------

/**
 * The CM CAN parameters of VT_Client / TC_Client on CODESYS: the hardware ID becomes the CAN
 * interface number, the proxy areas and the CM CAN status byte disappear (LCan_CL2.st works with
 * CL2 handles). Works on SCL text, before the general translation.
 */
function canLayer(src) {
  if (!/LCan_/.test(src)) return src;
  const NET = 'canNet : USInt := 0;   // CAN-interface van de sturing (0 = de eerste)';
  const hasHw = /^\s*hwIdCmCan\s*:/m.test(src);
  const hasProxyIndex = /^\s*rxProxyIndex\s*:/m.test(src);
  return src
    .replace(/^\s*(rx|tx)Proxy(In|Out)\s*:\s*"LCan_type\w+"\s*;.*\n/gm, '')
    // without hwIdCmCan (a block that sets no filters) the CM CAN status byte becomes the CAN interface
    .replace(/^(\s*)canStatus\s*:\s*Byte\s*;.*\n/gm, hasHw ? '' : `$1${NET}\n`)
    .replace(/^(\s*)hwIdCmCan\s*:\s*HW_IO\s*;.*$/gm, `$1${NET}`)
    .replace(/^\s*canModulStatusByte\s*:=\s*#canStatus\s*,\s*\n/gm, '')
    .replace(/^(\s*)inputArea\s*:=\s*#rxProxyIn\s*,/gm, '$1netId := #canNet,')
    // the filter list of the receive proxy; a block without rxProxyIndex receives everything (no filter list)
    .replace(/^(\s*)outputArea\s*:=\s*#rxProxyOut\s*,[^\n]*\n/gm, (m, ind) => (hasProxyIndex ? `${ind}proxyIndex := #rxProxyIndex,\n` : ''))
    .replace(/^(\s*)inputArea\s*:=\s*#txProxyIn\s*,/gm, '$1netId := #canNet,')
    .replace(/^\s*outputArea\s*:=\s*#txProxyOut\s*,\s*\n/gm, '')
    .replace(/#hwIdCmCan\b/g, '#canNet');
}

// ---------- blocks ----------

const HEADER_KEYS = /^\s*(TITLE\s*=|VERSION\s*:|AUTHOR\s*:|FAMILY\s*:|NAME\s*:|NON_RETAIN|\{)/i;
const SECTION = /^\s*(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR_GLOBAL|VAR\s+CONSTANT|VAR\s+RETAIN|VAR)\b/i;

/** Splits an SCL source into its blocks: { kind, name, ret, lines, lead } (lead = comment lines before it). */
function splitBlocks(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let lead = [];
  let cur = null;
  for (const line of lines) {
    if (!cur) {
      const m = /^\s*(TYPE|DATA_BLOCK|FUNCTION_BLOCK|FUNCTION)\s+"?([A-Za-z_]\w*)"?\s*(?::\s*(\w+))?/.exec(line);
      if (m) {
        cur = { kind: m[1].toUpperCase(), name: m[2], ret: m[3] || null, lines: [], lead };
        lead = [];
      } else if (/^\s*\/\//.test(line)) lead.push(line);
      else if (!line.trim()) { if (lead.length) lead.push(line); }
      continue;
    }
    if (new RegExp(`^\\s*END_${cur.kind}\\b`, 'i').test(line)) {
      blocks.push(cur);
      cur = null;
    } else cur.lines.push(line);
  }
  if (cur) throw new Error(`${cur.name}: END_${cur.kind} ontbreekt`);
  return blocks;
}

/** Title and version of a block from its header lines. */
function headerInfo(lines) {
  const title = (lines.map((l) => /^\s*TITLE\s*=\s*'(.*)'\s*$/i.exec(l)).find(Boolean) || [])[1] || '';
  const version = (lines.map((l) => /^\s*VERSION\s*:\s*([\d.]+)/i.exec(l)).find(Boolean) || [])[1] || '';
  return { title, version };
}

/** Declaration lines (VAR sections) → CODESYS text and parsed sections. */
function declSections(lines, renames, isFunction = false) {
  const sections = [];
  const out = [];
  let sec = null;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '   ');
    const s = SECTION.exec(line);
    if (s) {
      const kind = s[1].toUpperCase().replace(/\s+/, ' ');
      sec = { kind: isFunction && kind === 'VAR_TEMP' ? 'VAR' : kind, vars: [] }; // CODESYS: no VAR_TEMP in a FUNCTION
      sections.push(sec);
      out.push(sec.kind);
      continue;
    }
    if (/^\s*END_VAR\b/i.test(line)) {
      if (!sec.vars.length && out[out.length - 1] === sec.kind) { // empty (e.g. only the CM CAN proxies): leave it out
        out.pop();
        sections.pop();
      } else out.push('END_VAR');
      sec = null;
      continue;
    }
    if (!sec) {
      if (/^\s*\/\//.test(line)) out.push(line.trim());
      continue;
    }
    const v = parseVarLine(line);
    if (!v) {
      out.push(line.trim() ? '\t' + line.trim() : '');
      continue;
    }
    v.name = renames[v.name.toLowerCase()] ?? v.name;
    sec.vars.push(v);
    out.push(`\t${v.name} : ${v.type}${v.init !== null ? ' := ' + v.init : ''};${v.comment ? '\t// ' + v.comment : ''}`);
  }
  return { sections, text: out };
}

/** Body lines → CODESYS implementation text. */
function bodyText(lines, renames) {
  const src = lines
    .map((l) => l.replace(/^\t/, ''))
    .map((l) => l.replace(/^(\s*)REGION\s+(.*)$/i, '$1// ---- $2').replace(/^\s*END_REGION\s*;?\s*$/i, '\u0003'))
    .filter((l) => l !== '\u0003')
    .join('\n');
  const { text, restore } = mask(src);
  return restore(rewriteCode(text, renames)).replace(/^\n+|\s+$/g, '') + '\n';
}

const NOTE = (ver) => `// CODESYS-vertaling van de TIA-bron door VT Designer ${ver}; niet met de hand aanpassen, opnieuw vertalen.`;

/** A UDT file → DUTs. */
function translateType(b, ver) {
  const { version } = headerInfo(b.lines);
  const body = b.lines.filter((l) => !HEADER_KEYS.test(l) && !/^\s*(END_)?STRUCT\b/i.test(l));
  const fields = [];
  const text = [];
  for (const raw of body) {
    const v = parseVarLine(raw);
    if (v) {
      fields.push(v);
      text.push(`\t${v.name} : ${v.type}${v.init !== null ? ' := ' + v.init : ''};${v.comment ? '\t// ' + v.comment : ''}`);
    } else if (raw.trim()) text.push('\t' + raw.trim());
  }
  const decl = [`TYPE ${b.name} :`, 'STRUCT', `\t// versie ${version || '-'}; ${NOTE(ver).slice(3)}`, ...text, 'END_STRUCT', 'END_TYPE'].join('\n') + '\n';
  return { kind: 'dut', name: b.name, fields, decl };
}

/** An FC or FB → POU. */
function translatePou(b, ver, fileLead) {
  const { title } = headerInfo(b.lines);
  const begin = b.lines.findIndex((l) => /^\s*BEGIN\s*$/i.test(l));
  const head = begin < 0 ? b.lines : b.lines.slice(0, begin);
  const body = begin < 0 ? [] : b.lines.slice(begin + 1);
  // locals with a reserved name
  const renames = {};
  for (const l of head) {
    const v = parseVarLine(l);
    if (v && RENAME[v.name.toLowerCase()]) renames[v.name.toLowerCase()] = RENAME[v.name.toLowerCase()];
  }
  const isFb = b.kind === 'FUNCTION_BLOCK';
  const decls = declSections(head.filter((l) => !HEADER_KEYS.test(l)), renames, !isFb);
  // a TIA function without result (Void) gets BOOL: not every CODESYS version accepts a function without type
  const ret = b.ret ? (/^void$/i.test(b.ret) ? 'BOOL' : stType(b.ret)) : null;
  const top = isFb ? `FUNCTION_BLOCK ${b.name}` : `FUNCTION ${b.name}${ret ? ' : ' + ret : ''}`;
  const decl = [top, ...(title ? [`// ${title}`] : []), NOTE(ver), ...fileLead.map((l) => l.trimEnd()).filter((l) => l), ...decls.text]
    .join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  return {
    kind: 'pou', pouType: isFb ? 'functionBlock' : 'function', name: b.name, ret, sections: decls.sections,
    decl, impl: bodyText(body, renames), renames,
  };
}

/**
 * The named arguments of every call `fn(…)` in `s` renamed with `map` (old name in lower case → new name): a
 * parameter of a function with a reserved name (len, s, …) got another name, and so must the calls
 * (ISO_Bits(value := x, len := 2) → ISO_Bits(value := x, lenB := 2)). Only the arguments of fn itself, not those
 * of calls nested in them.
 */
export function renameArgs(s, fn, map) {
  const re = new RegExp(`(^|[^0-9A-Za-z_#.])${fn}\\s*\\(`, 'gi');
  const at = [];
  let m;
  while ((m = re.exec(s))) {
    let depth = 0;
    for (let k = m.index + m[0].length - 1; k < s.length; k++) {
      const ch = s[k];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') {
        if (--depth === 0) break;
      }
      if (depth === 1 && (ch === '(' || ch === ',')) {
        const a = /^(\s*)([A-Za-z_]\w*)\s*(?::=|=>)/.exec(s.slice(k + 1));
        const to = a && map[a[2].toLowerCase()];
        if (to) at.push([k + 1 + a[1].length, a[2].length, to]);
      }
    }
  }
  for (const [i, n, to] of at.sort((x, y) => y[0] - x[0])) s = s.slice(0, i) + to + s.slice(i + n);
  return s;
}

// ---------- DB → GVL ----------

/** Parses the VAR section of a DB into a tree of fields; inline Structs get { struct: [fields] }. */
function dbFields(lines) {
  const root = [];
  const stack = [root];
  let inVar = false;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '   ');
    if (/^\s*VAR\b/i.test(line)) { inVar = true; continue; }
    if (/^\s*END_VAR\b/i.test(line)) { inVar = false; continue; }
    if (!inVar) continue;
    let m;
    if ((m = /^\s*([A-Za-z_]\w*)\s*:\s*Struct\b\s*(?:\/\/\s?(.*))?$/i.exec(line))) {
      const f = { name: m[1], struct: [], comment: (m[2] || '').trim() };
      stack[stack.length - 1].push(f);
      stack.push(f.struct);
      continue;
    }
    if (/^\s*END_STRUCT\s*;/i.test(line)) { stack.pop(); continue; }
    const v = parseVarLine(line);
    if (v) stack[stack.length - 1].push(v);
  }
  return root;
}

/** Statements `path := value;` of the BEGIN part, as [{ path: [{ name, index? }], value }]. */
function dbAssignments(lines) {
  const { text, restore } = mask(lines.join('\n'));
  const out = [];
  for (const st of text.split(';')) {
    const s = st.replace(/\u0001\d+\u0002/g, (t) => (restore(t).startsWith("'") ? t : ' ')).trim();
    if (!s) continue;
    const m = /^([A-Za-z_][\w.[\]\s]*?)\s*:=\s*([\s\S]+)$/.exec(s);
    if (!m) throw new Error(`startwaarde niet begrepen: ${restore(s)}`);
    const path = m[1].replace(/\s+/g, '').split('.').flatMap((seg) => {
      const parts = /^(\w+)((?:\[\d+\])*)$/.exec(seg);
      if (!parts) throw new Error(`pad niet begrepen: ${m[1]}`);
      return [{ name: parts[1] }, ...[...parts[2].matchAll(/\[(\d+)\]/g)].map((x) => ({ index: Number(x[1]) }))];
    });
    out.push({ path, value: restore(m[2]).trim() });
  }
  return out;
}

const defaultOf = (t) => (t.kind === 'string' ? "''" : t.kind === 'base' ? (t.name === 'BOOL' ? 'FALSE' : t.name === 'TIME' ? 'T#0MS' : /REAL/.test(t.name) ? '0.0' : '0') : null);

/** Value tree (from assignments) → initial value for a variable of type `t` (fields: inline struct). */
function initOf(node, t, fields, where) {
  if (node === undefined) return null;
  if (typeof node === 'string') return { kind: 'simple', text: node };
  if (fields || (t && t.kind === 'derived')) {
    const members = [];
    for (const [name, sub] of Object.entries(node.members || {})) {
      const f = fields?.find((x) => x.name === name);
      const v = initOf(sub, f ? (f.struct ? null : parseType(f.type)) : null, f?.struct, `${where}.${name}`);
      if (v) members.push({ name, value: v });
    }
    return members.length ? { kind: 'struct', members } : null;
  }
  if (t && t.kind === 'array') {
    const [lo, hi] = t.dims[0].map(Number);
    const idx = Object.keys(node.items || {}).map(Number).sort((a, b) => a - b);
    if (!idx.length) return null;
    const items = [];
    for (let k = lo; k <= idx[idx.length - 1]; k++) {
      const sub = node.items[k];
      if (sub === undefined) {
        const d = defaultOf(t.of);
        if (d === null) throw new Error(`${where}[${k}]: geen startwaarde (gat in een array van structs)`);
        items.push({ rep: 1, value: { kind: 'simple', text: d } });
      } else items.push({ rep: 1, value: initOf(sub, t.of, null, `${where}[${k}]`) || { kind: 'simple', text: defaultOf(t.of) ?? '0' } });
    }
    if (idx[idx.length - 1] > hi) throw new Error(`${where}: index ${idx[idx.length - 1]} buiten [${lo}..${hi}]`);
    return { kind: 'array', items };
  }
  throw new Error(`${where}: startwaarde voor een ${t?.kind ?? 'onbekend'} type niet begrepen`);
}

/** A DB → DUTs (one per inline Struct) and a GVL with the start values as initialisations. */
function translateDb(b, ver, fileLead) {
  const { title } = headerInfo(b.lines);
  const begin = b.lines.findIndex((l) => /^\s*BEGIN\s*$/i.test(l));
  const fields = dbFields(begin < 0 ? b.lines : b.lines.slice(0, begin));
  const assigns = begin < 0 ? [] : dbAssignments(b.lines.slice(begin + 1));
  // value tree
  const tree = { members: {} };
  for (const a of assigns) {
    let node = tree;
    a.path.forEach((seg, k) => {
      const lastSeg = k === a.path.length - 1;
      const key = seg.index !== undefined ? 'items' : 'members';
      const id = seg.index !== undefined ? seg.index : seg.name;
      node[key] = node[key] || {};
      if (lastSeg) node[key][id] = a.value;
      else node = node[key][id] = node[key][id] || {};
    });
  }
  const duts = [];
  const dutFor = (path, flds) => {
    const name = `${b.name}_${path.join('_')}`;
    const lines = [];
    const vars = [];
    for (const f of flds) {
      if (f.struct) {
        const sub = dutFor([...path, f.name], f.struct);
        vars.push({ name: f.name, type: sub, init: null, comment: f.comment });
        lines.push(`\t${f.name} : ${sub};${f.comment ? '\t// ' + f.comment : ''}`);
      } else {
        vars.push(f);
        lines.push(`\t${f.name} : ${f.type}${f.init !== null ? ' := ' + f.init : ''};${f.comment ? '\t// ' + f.comment : ''}`);
      }
    }
    duts.push({ kind: 'dut', name, fields: vars, decl: [`TYPE ${name} :`, 'STRUCT', `\t// deel van ${b.name}; ${NOTE(ver).slice(3)}`, ...lines, 'END_STRUCT', 'END_TYPE'].join('\n') + '\n' });
    return name;
  };
  const vars = [];
  const text = [];
  for (const f of fields) {
    const type = f.struct ? dutFor([f.name], f.struct) : f.type;
    let init = initOf(tree.members[f.name], f.struct ? null : parseType(type), f.struct, f.name);
    if (!init && f.init !== null && !f.struct) init = parseValue(f.init);
    vars.push({ name: f.name, type, init, comment: f.comment });
    text.push(`\t${f.name} : ${type}${init ? ' := ' + valueText(init) : ''};${f.comment ? '\t// ' + f.comment : ''}`);
  }
  const decl = [
    ...fileLead.map((l) => l.trimEnd()).filter((l) => l),
    ...(title ? [`// ${title}`] : []),
    NOTE(ver),
    "{attribute 'qualified_only'}",
    'VAR_GLOBAL',
    ...text,
    'END_VAR',
  ].join('\n') + '\n';
  return [...duts, { kind: 'gvl', name: b.name, vars, decl, attrs: ['qualified_only'] }];
}

/**
 * Translates one SCL / UDT / DB source file into CODESYS objects.
 * `ver`: the designer version written into every object.
 */
export function translateScl(src, ver = '') {
  const blocks = splitBlocks(canLayer(src));
  // the comment at the top of the file (changelog) goes to the main block: the FB, else the first block
  const fileLead = (blocks[0]?.lead || []).filter((l) => /^\s*\/\//.test(l) && !/^\s*\/\/\s*=+\s*$/.test(l));
  const main = Math.max(0, blocks.findIndex((b) => b.kind === 'FUNCTION_BLOCK'));
  const out = [];
  blocks.forEach((b, i) => {
    const lead = i === main ? fileLead : [];
    if (b.kind === 'TYPE') out.push(translateType(b, ver));
    else if (b.kind === 'DATA_BLOCK') out.push(...translateDb(b, ver, lead));
    else out.push(translatePou(b, ver, lead));
  });
  // calls to a function of this file whose parameters were renamed (FB instances are not called by type name)
  for (const f of out.filter((o) => o.pouType === 'function' && Object.keys(o.renames).length)) {
    for (const o of out) if (o.kind === 'pou') o.impl = renameArgs(o.impl, f.name, f.renames);
  }
  return out;
}

// ---------- ST text (to paste) ----------

const KIND_TAG = { dut: 'DUT', gvl: 'GVL', pou: 'POU' };

/**
 * Objects → one text file: per object a line `// ======== <DUT|GVL|POU> <name>`, the declaration and,
 * for a POU, `// ---- code` with the implementation. The same format is read back by parseStObjects
 * (used for the hand-written LCan_CL2.st).
 */
export function stText(objects, header = []) {
  const L = [...header];
  for (const o of objects) {
    L.push('', `// ======== ${KIND_TAG[o.kind]} ${o.name}`, o.decl.trimEnd());
    if (o.kind === 'pou') L.push('// ---- code', o.impl.trimEnd());
  }
  return L.join('\n') + '\n';
}

/** Reads a file in the format of stText (CODESYS text, e.g. LCan_CL2.st) back into objects. */
export function parseStObjects(text) {
  const out = [];
  const parts = text.replace(/\r\n?/g, '\n').split(/^\/\/ ======== /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const [tag, name] = part.slice(0, nl).trim().split(/\s+/);
    const rest = part.slice(nl + 1);
    const kind = Object.keys(KIND_TAG).find((k) => KIND_TAG[k] === tag);
    if (!kind) throw new Error(`onbekend objecttype ${tag}`);
    const [declPart, implPart = ''] = rest.split(/^\/\/ ---- code\s*$/m);
    const decl = declPart.replace(/\s+$/, '') + '\n';
    const o = { kind, name, decl };
    const lines = decl.split('\n');
    if (kind === 'pou') {
      const m = /^\s*(FUNCTION_BLOCK|FUNCTION)\s+(\w+)\s*(?::\s*(.+))?$/m.exec(decl);
      o.pouType = m[1].toUpperCase() === 'FUNCTION' ? 'function' : 'functionBlock';
      o.ret = m[3] ? m[3].trim() : null;
      o.sections = declSections(lines.slice(1), {}).sections;
      o.impl = implPart.replace(/^\n+|\s+$/g, '') + '\n';
    } else if (kind === 'dut') {
      o.fields = lines.map(parseVarLine).filter(Boolean);
    } else {
      o.vars = lines.map(parseVarLine).filter(Boolean).map((v) => ({ ...v, init: v.init !== null ? parseValue(v.init) : null }));
      o.attrs = [...decl.matchAll(/\{attribute '(\w+)'\}/g)].map((x) => x[1]);
    }
    out.push(o);
  }
  return out;
}
