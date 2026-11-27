"""Static checks of the CODESYS translation (CODESYS itself is not needed): the ST text in the object format of
src/export/scl2st.js (stText) and, optionally, the PLCopen XML of the same package.

  - no SCL left: #name, "name", REGION, SHL(IN := …), LOWER_BOUND(ARR := …), TIME_TCK, Char conversions, HW_IO;
  - blocks balanced (IF, CASE, FOR, WHILE, REPEAT);
  - every name used in the code is declared (locals, GVLs, POUs, types, standard functions, CL2/CAA/CL2I);
  - every type used in a declaration exists; no declared name that is a CODESYS keyword (ST, SUB, …);
  - text literals not longer than the STRING(n) of the member they are assigned to;
  - the XML is well-formed and holds the same objects, each POU with its code and plain-text declaration;
  - every <data> holds exactly one element (PLCopen TC6; CODESYS refuses the file otherwise).

Usage: tools/check-codesys.sh, or python3 tools/check_st.py <bundle.st> [<bundle.xml>]"""
import re, sys, xml.dom.minidom

KEYWORDS = set('''IF THEN ELSE ELSIF END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT
EXIT RETURN CONTINUE AND OR XOR NOT MOD TRUE FALSE ARRAY STRUCT POINTER REFERENCE BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT
USINT UINT UDINT ULINT REAL LREAL TIME STRING WSTRING'''.split())
FUNCS = set('''SHL SHR ROL ROR LEN ABS LOWER_BOUND UPPER_BOUND TIME ADR SEL MIN MAX LIMIT MUX SIZEOF CONCAT LEFT RIGHT MID FIND
TRUNC SQRT'''.split())
NAMESPACES = {'CL2', 'CAA', 'CL2I', 'CB'}
# CODESYS wants every input of a library function, also the optional ones (C0040 "requires exactly n inputs")
CL2_INPUTS = {'DRIVEROPENH': 5, 'CREATEMASKRECEIVER': 13, 'CREATEMESSAGE': 6, 'WRITE': 4, 'READ': 3, 'FREEMESSAGE': 1,
              'GETMESSAGEID': 2, 'GETMESSAGELENGTH': 2, 'GETMESSAGEDATAPOINTER': 2}


def calls(code, ns):
    """(function, number of named inputs) of every call ns.f(…) in the code."""
    for m in re.finditer(rf'\b{ns}\.(\w+)\s*\(', code):
        depth, k, args = 1, m.end(), 0
        while k < len(code) and depth:
            c = code[k]
            depth += c == '('
            depth -= c == ')'
            if depth == 1 and code.startswith(':=', k):
                args += 1
            k += 1
        yield m.group(1), args
# IL operators and other words CODESYS does not accept as a variable name
RESERVED = set('''ST STN LD LDN S R CAL CALC CALCN RET RETC RETCN JMP JMPC JMPCN ADD SUB MUL DIV AND ANDN OR ORN XOR XORN NOT GT GE
EQ NE LE LT MOD AT BY DO OF TO THIS SUPER'''.split())
BASE = KEYWORDS | {'TOD', 'DT', 'DATE', 'LTIME', 'TIME_OF_DAY', 'DATE_AND_TIME'}


def strip(code):
    """Comments out, strings replaced by '' (their length is checked separately)."""
    code = re.sub(r'\(\*.*?\*\)', ' ', code, flags=re.S)
    out, i = [], 0
    while i < len(code):
        c = code[i]
        if code.startswith('//', i):
            j = code.find('\n', i)
            i = len(code) if j < 0 else j
        elif c == "'":
            j = i + 1
            while j < len(code) and code[j] != "'":
                j += 2 if code[j] == '$' else 1
            out.append("''")
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def objects(text):
    parts = re.split(r'^// ======== (DUT|GVL|POU) (\w+)\s*$', text, flags=re.M)
    for k in range(1, len(parts), 3):
        body = parts[k + 2]
        decl, _, impl = body.partition('\n// ---- code\n')
        yield parts[k], parts[k + 1], decl, impl


VAR_LINE = re.compile(r'^\s*([A-Za-z_]\w*)\s*:\s*([^;:=]+?)\s*(?::=.*)?;', re.M)


def decl_vars(decl):
    """{name: type} of the VAR sections (or the STRUCT) of a declaration."""
    return {m.group(1): m.group(2).strip() for m in VAR_LINE.finditer(strip(decl))}


def type_names(t):
    t = re.sub(r'(?i)^ARRAY\s*\[.*?\]\s*OF\s+', '', t.strip())
    t = re.sub(r'(?i)^POINTER\s+TO\s+', '', t)
    t = re.sub(r'(?i)^W?STRING\s*\(\s*\d+\s*\)$', 'STRING', t)
    return t


def check(st_file, xml_file=None):
    text = open(st_file, encoding='utf-8').read()
    objs = list(objects(text))
    errors = []
    pous = {n for k, n, *_ in objs if k == 'POU'}
    duts = {n: decl_vars(d) for k, n, d, _ in objs if k == 'DUT'}
    gvls = {n for k, n, *_ in objs if k == 'GVL'}
    known = {x.upper() for x in pous | set(duts) | gvls | NAMESPACES}
    for kind, name, decl, impl in objs:
        code_decl = strip(decl)
        for what, rx in [('#naam', r'(^|[^0-9A-Za-z_])#[A-Za-z_]'), ('"naam"', r'"'), ('REGION', r'\bREGION\b'),
                         ('SHL/SHR(IN :=', r'\b(SHL|SHR|ROL|ROR)\s*\(\s*IN\s*:='), ('BOUND(ARR :=', r'_BOUND\s*\(\s*ARR\s*:='),
                         ('TIME_TCK', r'\bTIME_TCK\b'), ('CHAR-conversie', r'\b(CHAR_TO_BYTE|BYTE_TO_CHAR)\b'),
                         ('HW_IO', r'\bHW_IO\b'), ('Void', r'(?i)\bVoid\b')]:
            for part, src in (('declaratie', code_decl), ('code', strip(impl))):
                if re.search(rx, src, re.M):
                    errors.append(f'{name}: {what} over in de {part}')
        local = decl_vars(decl)
        for v, t in local.items():
            if v.upper() in RESERVED or v.upper() in KEYWORDS:
                errors.append(f'{name}: naam {v} is gereserveerd in CODESYS')
            tn = type_names(t)
            if tn.upper() not in BASE and tn.upper() not in known and '.' not in tn:
                errors.append(f'{name}: type {tn} van {v} bestaat niet')
        seen = {}
        for m in VAR_LINE.finditer(code_decl):  # CODESYS is case-insensitive: m and M are one name
            u = m.group(1).upper()
            if u in seen:
                errors.append(f'{name}: {m.group(1)} twee keer gedeclareerd')
            seen[u] = True
        if kind != 'POU':
            continue
        if re.match(r'(?i)\s*FUNCTION\b(?!_BLOCK)', code_decl) and re.search(r'(?im)^\s*VAR_TEMP\b', code_decl):
            errors.append(f'{name}: VAR_TEMP in een FUNCTION (CODESYS: enkel VAR)')
        code = strip(impl)
        for f, n in calls(code, 'CL2'):
            want = CL2_INPUTS.get(f.upper())
            if want is not None and n != want:
                errors.append(f'{name}: CL2.{f} met {n} ingangen, CODESYS vraagt er {want}')
        for m in re.finditer(r'(?i)\b(?:L?T|L?TIME)#[0-9A-Za-z.]*_[0-9A-Za-z_.]*', code):
            errors.append(f'{name}: TIME-literal met _ ({m.group(0)}): CODESYS weigert dat')
        for o, c in [('IF', 'END_IF'), ('CASE', 'END_CASE'), ('FOR', 'END_FOR'), ('WHILE', 'END_WHILE'), ('REPEAT', 'END_REPEAT')]:
            no, nc = len(re.findall(rf'\b{o}\b', code)), len(re.findall(rf'\b{c}\b', code))
            if no != nc:
                errors.append(f'{name}: {o} {no}× tegen {c} {nc}×')
        names = {x.upper() for x in local} | {name.upper()}
        depth = 0
        for m in re.finditer(r"[()]|(?<![.\w#])([A-Za-z_]\w*)(?!\s*#)", code):
            tok = m.group(0)
            if tok == '(':
                depth += 1
                continue
            if tok == ')':
                depth -= 1
                continue
            u = tok.upper()
            if u in KEYWORDS or u in FUNCS or u in names or u in known or re.match(r'^[A-Z]+_TO_[A-Z]+$|^TO_[A-Z]+$', u):
                continue
            if depth > 0 and re.match(r'\s*(:=|=>)', code[m.end():]):
                continue  # named parameter of a call
            errors.append(f'{name}: {tok} niet gedeclareerd')
        # text literals against STRING(n) of a member: x.member := '…'
        for m in re.finditer(r"([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*:=\s*'((?:\$.|[^'])*)'", re.sub(r'//.*', '', impl)):
            t = local.get(m.group(1), '')
            member = duts.get(type_names(t), {}).get(m.group(2), '')
            lim = re.match(r'(?i)STRING\s*\(\s*(\d+)\s*\)', member)
            if lim and len(re.sub(r'\$.', 'x', m.group(3))) > int(lim.group(1)):
                errors.append(f"{name}: tekst te lang voor {m.group(1)}.{m.group(2)} ({member}): '{m.group(3)}'")
    if xml_file:
        try:
            d = xml.dom.minidom.parse(xml_file)
        except Exception as e:  # noqa: BLE001
            errors.append(f'XML niet geldig: {e}')
        else:
            counts = {'POU': len(d.getElementsByTagName('pou')), 'DUT': len(d.getElementsByTagName('dataType')),
                      'GVL': len(d.getElementsByTagName('globalVars'))}
            for k in counts:
                n = sum(1 for o in objs if o[0] == k)
                if counts[k] != n:
                    errors.append(f'XML: {counts[k]} {k} tegen {n} in de ST-tekst')
            for p in d.getElementsByTagName('pou'):
                if not p.getElementsByTagName('ST') or not p.getElementsByTagName('InterfaceAsPlainText'):
                    errors.append(f"XML: POU {p.getAttribute('name')} zonder code of declaratie")
            for data in d.getElementsByTagName('data'):
                kids = [c for c in data.childNodes if c.nodeType == c.ELEMENT_NODE]
                if len(kids) != 1:
                    names = ', '.join(c.tagName for c in kids[:3])
                    errors.append(f"XML: <data {data.getAttribute('name').rsplit('/', 1)[-1]}> met {len(kids)} elementen ({names}): "
                                  'PLCopen staat er één toe')
    for e in errors:
        print(e)
    n = {k: sum(1 for o in objs if o[0] == k) for k in ('DUT', 'GVL', 'POU')}
    print(f"{st_file.split('/')[-1]}: {n['DUT']} DUT, {n['GVL']} GVL, {n['POU']} POU – {'OK' if not errors else f'{len(errors)} fout(en)'}")
    return not errors


if __name__ == '__main__':
    sys.exit(0 if check(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None) else 1)
