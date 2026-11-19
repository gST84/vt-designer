#!/usr/bin/env python3
"""Genereert een minimale ISOBUS VT object pool (ISO 11783-6) en exporteert die als
  - VT_TestPool.iop            : binaire pool
  - 03_VT_TestPool.db          : TIA Portal DB-bron (Array of Byte)
  - pool_listing.txt           : leesbare uitleg per byte

Gebruik: python3 make_pool.py <uitvoermap> ["tekst"]
"""
import sys, os, struct

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
TEXT = sys.argv[2] if len(sys.argv) > 2 else "Hallo vanuit S7-1500"
STRLEN = 32                      # vaste lengte: Change String Value mag tot 32 tekens
DESIG = "S7 VT"

WHITE, BLACK, GREEN = 1, 0, 2    # standaard VT-kleurenpalet
FONT_8x12, FONT_12x16 = 2, 3

objs = []                        # (id, naam, bytes, beschrijving)

def u16(v): return struct.pack("<H", v)
def s16(v): return struct.pack("<h", v)

def working_set(oid, bg, selectable, active_mask, children, langs):
    b = u16(oid) + bytes([0, bg, selectable]) + u16(active_mask) + bytes([len(children), 0, len(langs)])
    for cid, x, y in children: b += u16(cid) + s16(x) + s16(y)
    for l in langs: b += l.encode("ascii")
    objs.append((oid, "Working Set", b, f"achtergrond {bg}, actief masker {active_mask}, kinderen {children}, talen {langs}"))

def data_mask(oid, bg, softkey_mask, children):
    b = u16(oid) + bytes([1, bg]) + u16(softkey_mask) + bytes([len(children), 0])
    for cid, x, y in children: b += u16(cid) + s16(x) + s16(y)
    objs.append((oid, "Data Mask", b, f"achtergrond {bg}, softkeymasker {softkey_mask} (65535 = geen), kinderen {children}"))

def output_string(oid, w, h, bg, font, options, justification, text, length):
    val = text.ljust(length)[:length].encode("latin-1")
    b = (u16(oid) + bytes([11]) + u16(w) + u16(h) + bytes([bg]) + u16(font) + bytes([options]) +
         u16(0xFFFF) + bytes([justification]) + u16(length) + val + bytes([0]))
    objs.append((oid, "Output String", b, f"{w}x{h}, font {font}, tekst \"{text}\" (lengte {length})"))

def font_attr(oid, colour, size, style=0):
    b = u16(oid) + bytes([23, colour, size, 0, style, 0])
    objs.append((oid, "Font Attributes", b, f"kleur {colour}, grootte-code {size}, ISO 8859-1"))

# ------------------------------------------------------------------ de pool
working_set(0, WHITE, 1, 1000, [(11001, 0, 0)], ["en"])
data_mask(1000, WHITE, 0xFFFF, [(11000, 20, 40)])
output_string(11000, 400, 40, WHITE, 23000, 0, 1, TEXT, STRLEN)      # hoofdtekst, horizontaal gecentreerd
output_string(11001, 60, 32, WHITE, 23001, 0, 1, DESIG, len(DESIG))  # designator in werksetlijst
font_attr(23000, BLACK, FONT_12x16)
font_attr(23001, BLACK, FONT_8x12)

pool = b"".join(o[2] for o in objs)

# ------------------------------------------------------------------ controle: terug parsen
def parse(p):
    i, out = 0, []
    while i < len(p):
        oid, typ = struct.unpack_from("<HB", p, i)
        if typ == 0:
            nobj, nmac, nlang = p[i + 7], p[i + 8], p[i + 9]; ln = 10 + 6 * nobj + 2 * nmac + 2 * nlang
        elif typ == 1:
            nobj, nmac = p[i + 6], p[i + 7]; ln = 8 + 6 * nobj + 2 * nmac
        elif typ == 11:
            slen = struct.unpack_from("<H", p, i + 14)[0]; ln = 16 + slen + 1 + 2 * p[i + 16 + slen]
        elif typ == 23:
            ln = 8 + 2 * p[i + 7]
        else:
            raise ValueError(f"onbekend type {typ}")
        out.append((oid, typ, ln)); i += ln
    assert i == len(p), "lengtes kloppen niet"
    return out
parsed = parse(pool)
ids = {o[0] for o in parsed}
for ref in (1000, 11000, 11001, 23000, 23001):
    assert ref in ids, f"verwijzing {ref} ontbreekt"
assert len(pool) + 1 <= 1785, "pool te groot voor één TP-overdracht"

# ------------------------------------------------------------------ uitvoer
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "VT_TestPool.iop"), "wb").write(pool)

lines = [
    "// =====================================================================",
    "//  VT_TestPool – gegenereerd door tools/make_pool.py",
    f"//  {len(pool)} bytes, {len(objs)} objecten. Niet met de hand aanpassen: opnieuw genereren.",
    "//  Objecten: " + ", ".join(f"{o[0]} {o[1]}" for o in objs),
    "// =====================================================================",
    'DATA_BLOCK "VT_TestPool"',
    "{ S7_Optimized_Access := 'TRUE' }",
    "VERSION : 0.1",
    "NON_RETAIN",
    "   VAR ",
    "      size : UDInt;   // aantal bytes in data",
    "      chunkCount : UInt;   // aantal Object Pool Transfer-delen (elk enkel hele objecten)",
    "      chunkStart : Array[0..0] of UDInt;   // beginindex van elk deel in data",
    "      chunkLength : Array[0..0] of UInt;   // lengte van elk deel",
    "      textObjectId : UInt;   // Output String die de PLC mag wijzigen",
    "      textMaxLength : UInt;   // vaste lengte van die Output String",
    f"      data : Array[0..{len(pool) - 1}] of Byte;",
    "   END_VAR",
    "",
    "",
    "BEGIN",
    f"   size := {len(pool)};",
    "   chunkCount := 1;   // deze pool past in één TP-overdracht",
    f"   chunkStart[0] := 0; chunkLength[0] := {len(pool)};",
    "   textObjectId := 11000;",
    f"   textMaxLength := {STRLEN};",
]
pos = 0
for oid, name, b, desc in objs:
    lines.append(f"   // ---- object {oid}: {name} ({len(b)} bytes) – {desc}")
    for k in range(0, len(b), 8):
        chunk = b[k:k + 8]
        lines.append("   " + " ".join(f"data[{pos + j}] := 16#{c:02X};" for j, c in enumerate(chunk)))
        pos += len(chunk)
lines.append("")
lines.append("END_DATA_BLOCK")
open(os.path.join(OUT, "03_VT_TestPool.db"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

with open(os.path.join(OUT, "pool_listing.txt"), "w", encoding="utf-8") as fh:
    fh.write(f"VT test pool – {len(pool)} bytes\n\n")
    off = 0
    for oid, name, b, desc in objs:
        fh.write(f"offset {off:4d}  object {oid:5d}  {name:16s} {len(b):3d} bytes  {desc}\n")
        fh.write("              " + " ".join(f"{c:02X}" for c in b) + "\n\n")
        off += len(b)
print(f"pool {len(pool)} bytes, objecten {[(o[0], o[1], o[2]) for o in parsed]}")
