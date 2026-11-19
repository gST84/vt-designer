"""ISOBUS/J1939-decoder voor een Microchip CAN BUS Analyzer-log (.CAN)."""
import sys, struct, collections, statistics, math, datetime

# ------------------------------------------------------------------ inlezen
def read_log(path):
    rows = []
    for ln in open(path, encoding="latin-1"):
        p = ln.strip().split(";")
        if len(p) < 5:
            continue
        try:
            t = float(p[0].replace(",", "."))
        except ValueError:
            continue
        cid = int(p[2].rstrip("x"), 16)
        dlc = int(p[3])
        data = bytes(int(x, 16) for x in p[4:4 + dlc])
        pf = (cid >> 16) & 0xFF; ps = (cid >> 8) & 0xFF; sa = cid & 0xFF
        dp = (cid >> 24) & 1; edp = (cid >> 25) & 1
        pgn = (edp << 17) | (dp << 16) | (pf << 8) | (ps if pf >= 240 else 0)
        da = ps if pf < 240 else 0xFF
        rows.append(dict(t=t, dir=p[1], id=cid, prio=(cid >> 26) & 7, pgn=pgn, sa=sa, da=da, data=data))
    return rows

H = lambda b: " ".join(f"{x:02X}" for x in b)
u16 = lambda b, i: b[i] | (b[i + 1] << 8)
u32 = lambda b, i: b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)
s16 = lambda b, i: struct.unpack_from("<h", b, i)[0]
def bits(b, byte, start, n):  # byte 1..8, start 1..8 (1 = LSB)
    return (b[byte - 1] >> (start - 1)) & ((1 << n) - 1)
def v8(x, sc, off=0, unit=""):
    if x >= 0xFB: return "n.b." if x == 0xFF else ("fout" if x == 0xFE else "gereserveerd")
    return f"{x*sc+off:g} {unit}".strip()
def v16(x, sc, off=0, unit="", fmt="g"):
    if x >= 0xFB00: return "n.b." if x >= 0xFF00 else ("fout" if x >= 0xFE00 else "gereserveerd")
    return f"{x*sc+off:{fmt}} {unit}".strip()
ST2 = {0: "uit/nee", 1: "aan/ja", 2: "fout", 3: "n.b."}

# ------------------------------------------------------------------ namen
PGN_NAMES = {
    0xAC00: "Guidance Machine Status", 0xAD00: "Guidance System Command", 0xCB00: "Process Data (TC)",
    0xE600: "VT → ECU", 0xE700: "ECU → VT", 0xE800: "Acknowledgement", 0xEA00: "Request",
    0xEB00: "TP.DT (transportdata)", 0xEC00: "TP.CM (transportbeheer)", 0xEE00: "Address Claimed",
    0xEF00: "Proprietary A", 0xF004: "EEC1 (motor)", 0xF022: "Machine Selected Speed",
    0xFD02: "All Implements Stop Operations Switch State", 0xFE41: "Lighting Command",
    0xFE43: "Rear PTO", 0xFE44: "Front PTO", 0xFE45: "Rear Hitch Status", 0xFE46: "Front Hitch Status",
    0xFE48: "Wheel-based Speed and Distance", 0xFE49: "Ground-based Speed and Distance",
    0xFEDA: "Software Identification", 0xFECA: "DM1 actieve storingen", 0xFE0F: "Language Command",
    0x1F119: "NMEA2000 Attitude", 0x1F802: "NMEA2000 COG & SOG Rapid", 0x1F803: "NMEA2000 Position Delta HP Rapid",
    0x1F804: "NMEA2000 Altitude Delta Rapid", 0x1F805: "NMEA2000 GNSS Position Data", 0x1FA03: "NMEA2000 GNSS DOPs",
    0x1F801: "NMEA2000 Position Rapid Update",
}
for i in range(16):
    PGN_NAMES[0xFE10 + i] = f"Aux Valve {i} Estimated Flow"
    PGN_NAMES[0xFE20 + i] = f"Aux Valve {i} Measured Flow"
    PGN_NAMES[0xFE30 + i] = f"Aux Valve {i} Command"
def pgn_name(p):
    if p in PGN_NAMES: return PGN_NAMES[p]
    if 0xFF00 <= p <= 0xFFFF: return "Proprietary B (fabrikantspecifiek)"
    return "onbekend"

MANUF = {94: "CNH Industrial", 151: "Raven Industries (sinds 2021 CNH)", 98: "PTx Trimble / Müller-Elektronik", 97: "Ag Leader"}
FUNC_G = {0: "Engine", 3: "Transmission", 7: "Axle-steering", 16: "Steering controller", 19: "Instrument cluster",
          23: "Vehicle navigation (GNSS)", 25: "Network interconnect ECU", 28: "Off-vehicle gateway (telematica)",
          29: "Virtual Terminal", 30: "Management computer", 33: "System monitor", 61: "Cab display",
          128: "Non-VT display", 129: "Operator controls", 130: "Task Controller", 131: "Position control",
          132: "Machine control", 134: "Tractor ECU", 137: "Product treatment", 139: "Datalogger"}
IG = {0: "Global", 1: "On-highway", 2: "Landbouw & bosbouw", 3: "Bouw", 4: "Maritiem", 5: "Industrie"}

def decode_name(b):
    n = int.from_bytes(b[:8], "little")
    d = dict(identity=n & 0x1FFFFF, manuf=(n >> 21) & 0x7FF, ecu_inst=(n >> 32) & 7, func_inst=(n >> 35) & 0x1F,
             function=(n >> 40) & 0xFF, dev_class=(n >> 49) & 0x7F, dev_class_inst=(n >> 56) & 0xF,
             ind_group=(n >> 60) & 7, aac=(n >> 63) & 1)
    d["manuf_name"] = MANUF.get(d["manuf"], f"code {d['manuf']}")
    d["func_name"] = FUNC_G.get(d["function"], f"functie {d['function']}")
    d["text"] = (f"{d['manuf_name']} · {d['func_name']} (functie {d['function']}, inst {d['func_inst']}) · "
                 f"apparaatklasse {d['dev_class']} · {IG.get(d['ind_group'], d['ind_group'])} · "
                 f"identiteit {d['identity']} · {'arbitrary address capable' if d['aac'] else 'vast adres'}")
    return d

# ------------------------------------------------------------------ VT
VT_FUNC = {
    0x00: "Soft Key Activation", 0x01: "Button Activation", 0x02: "Pointing Event", 0x03: "VT Select Input Object",
    0x04: "VT ESC", 0x05: "VT Change Numeric Value", 0x06: "VT Change Active Mask", 0x07: "VT Change Soft Key Mask",
    0x08: "VT Change String Value", 0x09: "VT On User-Layout Hide/Show", 0x0A: "VT Control Audio Signal Termination",
    0x11: "Object Pool Transfer", 0x12: "End of Object Pool", 0x20: "Aux Assignment Type 1", 0x21: "Aux Input Status Type 1",
    0x22: "Aux Assignment Type 2", 0x23: "Aux Input Status Type 2", 0x24: "Aux Capabilities", 0x25: "Preferred Assignment",
    0x26: "Aux Input Type 2 Maintenance", 0x27: "Aux Input Status Type 2 Enable",
    0xA0: "Hide/Show Object", 0xA1: "Enable/Disable Object", 0xA2: "Select Input Object", 0xA3: "Control Audio Signal",
    0xA4: "Set Audio Volume", 0xA5: "Change Child Location", 0xA6: "Change Size", 0xA7: "Change Background Colour",
    0xA8: "Change Numeric Value", 0xA9: "Change End Point", 0xAA: "Change Font Attributes", 0xAB: "Change Line Attributes",
    0xAC: "Change Fill Attributes", 0xAD: "Change Active Mask", 0xAE: "Change Soft Key Mask", 0xAF: "Change Attribute",
    0xB0: "Change Priority", 0xB1: "Change List Item", 0xB2: "Delete Object Pool", 0xB3: "Change String Value",
    0xB4: "Change Child Position", 0xB5: "Change Object Label", 0xB6: "Change Polygon Point", 0xB7: "Change Polygon Scale",
    0xB8: "Graphics Context", 0xB9: "Get Attribute Value", 0xBA: "Select Colour Map", 0xBB: "Identify VT",
    0xBC: "Execute Extended Macro", 0xBD: "Lock/Unlock Mask", 0xBE: "Execute Macro", 0xC0: "Get Memory",
    0xC1: "Get Supported Widechars", 0xC2: "Get Number of Soft Keys", 0xC3: "Get Text Font Data",
    0xC4: "Get Window Mask Data", 0xC5: "Get Supported Objects", 0xC7: "Get Hardware", 0xD0: "Store Version",
    0xD1: "Load Version", 0xD2: "Delete Version", 0xD3: "Extended Get Versions", 0xD4: "Extended Store Version",
    0xD5: "Extended Load Version", 0xD6: "Extended Delete Version", 0xDF: "Get Versions", 0xE0: "Get Versions Response",
    0xFE: "VT Status", 0xFF: "Working Set Maintenance",
}
KEYACT = {0: "losgelaten", 1: "ingedrukt", 2: "ingedrukt gehouden", 3: "afgebroken"}

def obj(b, i): return u16(b, i)
def txt(b):
    return "".join(chr(c) if 32 <= c < 127 else "·" for c in b)

def decode_vt(m, to_vt):
    """m = volledig bericht (bytes). Geeft (functie, object, details)."""
    if not m: return ("", "", "")
    f = m[0]; name = VT_FUNC.get(f, f"functie 0x{f:02X}")
    o, d = "", ""
    try:
        if to_vt:  # ECU -> VT: commando's
            if f == 0xFF: d = f"init-bit={m[1]&1}, VT-versie {m[2]}"
            elif f in (0xA0, 0xA1): o = obj(m, 1); d = ("toon" if m[3] else "verberg") if f == 0xA0 else ("actief" if m[3] else "inactief")
            elif f == 0xA8: o = obj(m, 1); d = f"waarde = {u32(m, 4)}"
            elif f == 0xB3:
                o = obj(m, 1); ln = u16(m, 3); d = f"lengte {ln}: \"{txt(m[5:5+ln])}\""
            elif f == 0xB4: o = obj(m, 3); d = f"ouder {obj(m,1)} → x={s16(m,5)}, y={s16(m,7)}"
            elif f == 0xA5: o = obj(m, 3); d = f"ouder {obj(m,1)} → dx={m[5]-127}, dy={m[6]-127}"
            elif f == 0xA6: o = obj(m, 1); d = f"breedte {u16(m,3)}, hoogte {u16(m,5)}"
            elif f == 0xA7: o = obj(m, 1); d = f"kleur {m[3]}"
            elif f == 0xAD: o = obj(m, 3); d = f"working set {obj(m,1)} → masker {obj(m,3)}"
            elif f == 0xAE: o = obj(m, 4); d = f"masker {obj(m,2)} → softkeymasker {obj(m,4)}"
            elif f == 0xAF: o = obj(m, 1); d = f"attribuut {m[3]} = {u32(m,4)}"
            elif f == 0xB1: o = obj(m, 1); d = f"index {m[3]} → object {obj(m,4)}"
            elif f == 0xA2: o = obj(m, 1); d = f"optie {m[3]}"
            elif f == 0xBE: o = m[1]; d = "macro"
            elif f == 0xBD: o = obj(m, 2); d = ("vergrendel" if m[1] == 1 else "ontgrendel") + f", timeout {u16(m,4)} ms"
            elif f == 0x11: d = f"{len(m)-1} bytes object pool-data"
            elif f in (0xD0, 0xD1, 0xD2): d = f"versie \"{txt(m[1:8])}\""
            elif f == 0xC0: d = f"geheugen nodig: {u32(m,2)} bytes"
            elif f == 0xAA: o = obj(m, 1); d = f"kleur {m[3]}, grootte {m[4]}, type {m[5]}, stijl {m[6]}"
        else:  # VT -> ECU: events en antwoorden
            if f == 0xFE:
                d = ("geen werkset op de voorgrond (terminal toont eigen scherm)" if m[1] == 0xFE else f"actieve werkset 0x{m[1]:02X}, masker {obj(m,2)}, softkeymasker {obj(m,4)}") + f", busy 0x{m[6]:02X}"
            elif f in (0x00, 0x01):
                o = obj(m, 2); d = f"{KEYACT.get(m[1], m[1])}, oudermasker {obj(m,4)}, toets {m[6]}"
            elif f == 0x05: o = obj(m, 1); d = f"nieuwe waarde {u32(m,4)}"
            elif f == 0x08: o = obj(m, 1); ln = m[3]; d = f"\"{txt(m[4:4+ln])}\""
            elif f == 0x03: o = obj(m, 1); d = f"geselecteerd={m[3]}, open voor invoer={m[4]}"
            elif f == 0x04: o = obj(m, 1); d = f"ESC, fout 0x{m[3]:02X}"
            elif f == 0x06: o = obj(m, 1); d = f"actief masker, fout 0x{m[3]:02X}"
            elif f == 0xA8: o = obj(m, 1); d = f"antwoord: fout 0x{m[3]:02X}, waarde {u32(m,4)}"
            elif f == 0xB3: o = obj(m, 3); d = f"antwoord: fout 0x{m[5]:02X}"
            elif f == 0xB4: o = obj(m, 3); d = f"antwoord: ouder {obj(m,1)}, fout 0x{m[5]:02X}"
            elif f in (0xA0, 0xA1, 0xA5, 0xA6, 0xA7, 0xAF, 0xA2): o = obj(m, 1); d = f"antwoord: fout 0x{m[4] if f in (0xA0,0xA1) else m[3]:02X}"
            elif f == 0xAD: o = obj(m, 1); d = f"antwoord: fout 0x{m[3]:02X}"
            elif f == 0xC2: d = f"{m[4]} softkeys/scherm, fysiek {m[7]}, virtueel {m[8] if len(m)>8 else '?'}"
            elif f == 0xC7: d = f"hardware: {m[1]} grafisch type, {u16(m,4)}×{u16(m,6)} px"
            elif f == 0xE0: d = f"{m[1]} opgeslagen versies"
            elif f == 0xD1: d = f"Load Version antwoord: fout 0x{m[5]:02X}"
            elif f == 0xC0: d = f"VT-versie {m[1]}, geheugen {'OK' if m[2]==0 else 'te klein'}"
    except IndexError:
        d += " (bericht te kort)"
    return (name, o, d)

# ------------------------------------------------------------------ enkelvoudige berichten
LIMIT = {0: "niet begrensd", 1: "door bestuurder", 2: "begrensd hoog", 3: "begrensd laag", 6: "onherstelbare fout", 7: "n.b."}
SRC = {0: "wiel", 1: "grond", 2: "navigatie", 3: "gemengd", 4: "gesimuleerd", 7: "n.b."}
DIR = {0: "achteruit", 1: "vooruit", 2: "fout", 3: "n.b."}

def decode_single(r, sig):
    """Geeft tekst; vult sig (lijst van (signaal, waarde, eenheid)) met numerieke waarden."""
    p, b = r["pgn"], r["data"]
    if p == 0xF004 and len(b) >= 8:
        rpm = u16(b, 3)
        if rpm < 0xFB00: sig.append(("Motortoerental", rpm * 0.125, "rpm"))
        return (f"toerental {v16(rpm,0.125,0,'rpm')}, act. koppel {v8(b[2],1,-125,'%')}, "
                f"gevraagd koppel {v8(b[1],1,-125,'%')}, startermodus {b[6]&0xF}, bron SA 0x{b[5]:02X}")
    if p in (0xFE48, 0xFE49, 0xF022) and len(b) >= 8:
        spd = u16(b, 0)
        if spd < 0xFB00: sig.append(({0xFE48: "Wielsnelheid", 0xFE49: "Grondsnelheid", 0xF022: f"Machine selected speed SA{r['sa']:02X}"}[p], spd * 0.001 * 3.6, "km/h"))
        s = f"snelheid {v16(spd,0.0036,0,'km/h','.2f')}, afstand {('n.b.' if u32(b,2)>=0xFB000000 else f'{u32(b,2)*0.001:g} m')}"
        if p == 0xFE48:
            key = bits(b, 8, 3, 2)
            sig.append(("Sleutelschakelaar (1=aan)", key, ""))
            s += (f", max. tijd tractorvermogen {v8(b[6],1,0,'min')}, richting {DIR[bits(b,8,1,2)]}, "
                  f"sleutel {({0:'uit',1:'aan',2:'fout',3:'n.b.'})[key]}, start/stop {({0:'stop',1:'start',2:'fout',3:'n.b.'})[bits(b,8,5,2)]}")
        elif p == 0xFE49:
            s += f", richting {DIR[bits(b,8,1,2)]}"
        else:
            s += f", richting {DIR[bits(b,8,1,2)]}, bron {SRC.get(bits(b,8,3,3),'?')}, limiet {LIMIT.get(bits(b,8,6,3),'?')}"
        return s
    if p in (0xFE45, 0xFE46) and len(b) >= 8:
        nm = "Achterhef" if p == 0xFE45 else "Fronthef"
        if b[0] < 0xFB: sig.append((f"{nm} positie", b[0] * 0.4, "%"))
        dr = u16(b, 3)
        if dr < 0xFB00: sig.append((f"{nm} trekkracht", dr * 10 - 320000, "N"))
        return (f"positie {v8(b[0],0.4,0,'%')}, in werkstand {ST2[bits(b,2,7,2)]}, limiet {LIMIT.get(bits(b,2,4,3),'?')}, "
                f"nom. onderstangkracht {v8(b[2],0.8,-100,'%')}, trekkracht {v16(dr,10,-320000,'N')}")
    if 0xFE10 <= p <= 0xFE1F:
        if b[:2] == b"\xff\xff": return "ventiel niet aanwezig / n.b."
        return (f"extend {v8(b[0],1,-125,'%')}, retract {v8(b[1],1,-125,'%')}, ventielstatus {bits(b,3,1,4)} "
                f"(0=geblokkeerd,1=extend,2=retract,3=zweven), fail-safe {bits(b,3,7,2)}  [bitposities status: niet geverifieerd]")
    if 0xFE20 <= p <= 0xFE2F:
        if b == b"\xff" * 8: return "geen meting (n.b.)"
        return f"extend {v8(b[0],1,-125,'%')}, retract {v8(b[1],1,-125,'%')}"
    if p == 0xFE41:
        return f"verlichtingsbits {H(b)} (per 2 bits: 00 uit, 01 aan, 11 n.b.)"
    if p == 0xAC00:
        if b == b"\xff" * 8: return "alle velden n.b. (geen stuursysteem actief)"
        cur = u16(b, 0)
        return (f"kromming {v16(cur,0.25,-8032,'1/km')}, mech. lockout {bits(b,3,1,2)}, stuurgereedheid {bits(b,3,3,2)}  [layout uit AgIsoStack++, niet geverifieerd]")
    if p == 0xFD02:
        return f"stop-schakelaar: {({0:'STOP alle werktuigen',1:'werktuigen toegestaan',2:'fout',3:'n.b.'})[bits(b,8,1,2)]}, teller {b[6]}  [layout niet geverifieerd]"
    if p == 0xCB00:
        cmd = b[0] & 0xF; el = (b[0] >> 4) | (b[1] << 4); ddi = u16(b, 2)
        if cmd == 0xE: return f"TC-status: taak {'actief' if b[4] & 1 else 'niet actief'}, status 0x{b[4]:02X}"
        return f"commando {cmd}, element {el}, DDI {ddi}, waarde {struct.unpack_from('<i', b, 4)[0]}"
    if p == 0xEA00:
        rq = b[0] | (b[1] << 8) | (b[2] << 16)
        return f"vraagt PGN 0x{rq:04X} ({pgn_name(rq)})"
    if p == 0xEE00:
        return decode_name(b)["text"]
    if p == 0x1F119:
        y, pi, ro = s16(b, 1), s16(b, 3), s16(b, 5)
        out = []
        for nm, v in (("yaw", y), ("pitch", pi), ("roll", ro)):
            if v != 0x7FFF: out.append(f"{nm} {math.degrees(v*1e-4):.2f}°")
        if ro != 0x7FFF: sig.append(("GNSS roll", math.degrees(ro * 1e-4), "°"))
        if pi != 0x7FFF: sig.append(("GNSS pitch", math.degrees(pi * 1e-4), "°"))
        return "houding: " + ", ".join(out)
    if p == 0x1F802:
        cog, sog = u16(b, 2), u16(b, 4)
        if sog != 0xFFFF: sig.append(("GNSS snelheid (SOG)", sog * 0.01 * 3.6, "km/h"))
        return f"koers {math.degrees(cog*1e-4):.1f}° ({'waar' if (b[1]&3)==0 else 'magnetisch'}), snelheid {sog*0.036:.2f} km/h"
    if p == 0x1FA03:
        mode = {0: "1D", 1: "2D", 2: "3D", 3: "auto", 6: "fout", 7: "n.b."}
        return f"modus {mode.get((b[1]>>3)&7,'?')}, HDOP {s16(b,2)*0.01:.2f}, VDOP {s16(b,4)*0.01:.2f}"
    if p in (0x1F803, 0x1F804):
        return "rapid update (delta-waarden, niet verder gedecodeerd)"
    if 0xFF00 <= p <= 0xFFFF or p == 0xEF00:
        return "fabrikantspecifiek: geen openbare definitie"
    return ""

FMI = {0: "boven normaal (ernstig)", 1: "onder normaal (ernstig)", 2: "data onregelmatig/ongeldig", 3: "spanning te hoog/kortsluiting naar +",
       4: "spanning te laag/kortsluiting naar massa", 5: "stroom te laag/open circuit", 6: "stroom te hoog/kortsluiting",
       7: "mechanisch systeem reageert niet", 8: "abnormale frequentie/puls", 9: "abnormale updatesnelheid", 10: "abnormale verandering",
       11: "oorzaak onbekend", 12: "slecht toestel/component", 13: "buiten kalibratie", 14: "speciale instructies",
       15: "boven normaal (minst ernstig)", 16: "boven normaal (matig)", 17: "onder normaal (minst ernstig)",
       18: "onder normaal (matig)", 19: "netwerkdata fout", 31: "conditie aanwezig"}
def decode_dm1(m):
    lamps = m[0]; codes = []
    for i in range(2, len(m) - 3, 4):
        d = m[i:i + 4]
        if d == b"\x00\x00\x00\x00" or d == b"\xff\xff\xff\xff": continue
        spn = d[0] | (d[1] << 8) | ((d[2] >> 5) << 16); fmi = d[2] & 0x1F; oc = d[3] & 0x7F
        codes.append(dict(spn=spn, fmi=fmi, oc=oc, fmi_txt=FMI.get(fmi, "?"), prop=520192 <= spn <= 524287))
    lt = "alle lampen uit" if lamps == 0 else f"lampbyte 0x{lamps:02X}"
    return dict(lamps=lt, codes=codes, text=f"DM1: {lt}; " + "; ".join(
        f"SPN {c['spn']}{' (fabrikantspecifiek)' if c['prop'] else ''} FMI {c['fmi']} ({c['fmi_txt']}) ×{c['oc']}" for c in codes))

FIX = {0: "geen fix", 1: "GNSS-fix", 2: "DGNSS", 3: "precise GNSS", 4: "RTK fixed", 5: "RTK float", 6: "geschat (DR)",
       7: "handmatig", 8: "gesimuleerd", 14: "fout", 15: "n.b."}
def decode_129029(m):
    days = u16(m, 1); secs = u32(m, 3) * 1e-4
    lat = struct.unpack_from("<q", m, 7)[0] * 1e-16; lon = struct.unpack_from("<q", m, 15)[0] * 1e-16
    alt = struct.unpack_from("<q", m, 23)[0] * 1e-6
    meth = (m[31] >> 4) & 0xF; nsv = m[33]; hdop = s16(m, 34) * 0.01; pdop = s16(m, 36) * 0.01
    geoid = struct.unpack_from("<i", m, 38)[0] * 0.01
    dt = datetime.datetime(1970, 1, 1) + datetime.timedelta(days=days, seconds=secs)
    return dict(lat=lat, lon=lon, alt=alt, fix=FIX.get(meth, meth), nsv=nsv, hdop=hdop, pdop=pdop, geoid=geoid, utc=dt.strftime("%Y-%m-%d %H:%M:%S"))

# ------------------------------------------------------------------ verwerking
def process(rows):
    frames, signals, vt, tp_log, gnss, dm1 = [], [], [], [], [], []
    sessions = {}          # (sa, da) -> dict
    fastp = {}             # (sa, pgn) -> dict
    names = {}
    def emit_msg(t, sa, da, pgn, msg, via):
        if pgn in (0xE700, 0xE600):
            f, o, d = decode_vt(msg, pgn == 0xE700)
            vt.append(dict(t=t, sa=sa, da=da, richting="ECU→VT" if pgn == 0xE700 else "VT→ECU", func=f,
                           obj=o, det=d, raw=H(msg), via=via))
        elif pgn == 0xFECA:
            d = decode_dm1(msg); dm1.append(dict(t=t, sa=sa, **d))
            return d["text"]
        elif pgn == 0x1F805 and len(msg) >= 36:
            g = decode_129029(msg); g["t"] = t; g["via"] = via; gnss.append(g)
            return f"GNSS: {g['fix']}, PDOP {g['pdop']:.2f}, hoogte {g['alt']:.1f} m (geoïde {g['geoid']:.1f} m), UTC {g['utc']}"
        return ""
    for r in rows:
        b, p, sa, da, t = r["data"], r["pgn"], r["sa"], r["da"], r["t"]
        sig = []
        txt_ = ""
        if p == 0xEC00:
            c = b[0]; pg = b[5] | (b[6] << 8) | (b[7] << 16)
            if c in (0x10, 0x20):
                sessions[(sa, da)] = dict(pgn=pg, size=u16(b, 1), n=b[3], data={}, t0=t, kind="BAM" if c == 0x20 else "RTS/CTS")
                txt_ = f"{'BAM' if c==0x20 else 'RTS'}: {u16(b,1)} bytes in {b[3]} pakketten, PGN 0x{pg:04X} ({pgn_name(pg)})"
            elif c == 0x11: txt_ = f"CTS: {b[1]} pakketten vanaf nr {b[2]}, PGN 0x{pg:04X}"
            elif c == 0x13: txt_ = f"End of Msg Ack: {u16(b,1)} bytes, PGN 0x{pg:04X} ({pgn_name(pg)})"
            elif c == 0xFF: txt_ = f"ABORT reden {b[1]}, PGN 0x{pg:04X}"
            else: txt_ = f"controlebyte 0x{c:02X}"
            tp_log.append(dict(t=t, sa=sa, da=da, txt=txt_))
        elif p == 0xEB00:
            s = sessions.get((sa, da))
            if s is None:
                txt_ = f"DT pakket {b[0]} (begin van sessie niet in log)"
            else:
                s["data"][b[0]] = b[1:8]
                txt_ = f"DT pakket {b[0]}/{s['n']} van PGN 0x{s['pgn']:04X}"
                if len(s["data"]) == s["n"]:
                    msg = b"".join(s["data"][i] for i in sorted(s["data"]))[:s["size"]]
                    extra = emit_msg(t, sa, da, s["pgn"], msg, "TP " + s["kind"])
                    tp_log.append(dict(t=t, sa=sa, da=da, txt=f"bericht compleet: PGN 0x{s['pgn']:04X} ({pgn_name(s['pgn'])}), {len(msg)} bytes: {H(msg)}"))
                    txt_ += " → bericht compleet" + (f"; {extra}" if extra else "")
                    del sessions[(sa, da)]
        elif p == 0x1F805:  # NMEA2000 fast packet
            seq, idx = b[0] >> 5, b[0] & 0x1F
            k = (sa, p)
            if idx == 0:
                fastp[k] = dict(seq=seq, size=b[1], data=bytearray(b[2:8]), next=1)
                txt_ = f"fast packet start, {b[1]} bytes"
            else:
                fp = fastp.get(k)
                if fp and fp["seq"] == seq and fp["next"] == idx:
                    fp["data"] += b[1:8]; fp["next"] += 1
                    txt_ = f"fast packet frame {idx}"
                    if len(fp["data"]) >= fp["size"]:
                        extra = emit_msg(t, sa, 0xFF, p, bytes(fp["data"][:fp["size"]]), "fast packet")
                        txt_ += " → compleet; " + extra
                        del fastp[k]
                else:
                    txt_ = f"fast packet frame {idx} (start gemist of frame verloren)"
                    fastp.pop(k, None)
        elif p in (0xE600, 0xE700):
            emit_msg(t, sa, da, p, b, "enkel frame")
            txt_ = " · ".join(str(x) for x in vt[-1].values() if x not in ("",) )
            txt_ = f"{vt[-1]['func']}" + (f" obj {vt[-1]['obj']}" if vt[-1]['obj'] != "" else "") + (f": {vt[-1]['det']}" if vt[-1]['det'] else "")
        else:
            txt_ = decode_single(r, sig)
            if p == 0xEE00: names[sa] = decode_name(b)
        frames.append(dict(r, txt=txt_))
        for s_, v, u in sig:
            signals.append(dict(t=t, sa=sa, pgn=p, sig=s_, val=round(v, 3) if isinstance(v, float) else v, unit=u))
    return frames, signals, vt, tp_log, gnss, names, dm1

if __name__ == "__main__":
    rows = read_log(sys.argv[1])
    frames, signals, vt, tp, gnss, names, dm1 = process(rows)
    print(len(frames), "frames;", len(vt), "VT-berichten;", len(gnss), "GNSS-posities;", len(signals), "signaalwaarden")
    for sa, n in sorted(names.items()): print(f"SA 0x{sa:02X}: {n['text']}")
    c = collections.Counter((v["richting"], v["sa"], v["da"], v["func"]) for v in vt)
    for k, n in sorted(c.items(), key=lambda x: -x[1]): print(n, k)
    for v in vt[:12]: print(v)
    print(collections.Counter(f["txt"].split(" →")[0] for f in frames if f["pgn"] == 0xEC00 or "compleet" in f["txt"]).most_common(15))
    for g in gnss[:3]: print(g)
    sg = collections.defaultdict(list)
    for s in signals: sg[s["sig"]].append(s["val"])
    for k, v in sg.items(): print(f"{k}: min {min(v):.2f} max {max(v):.2f} n {len(v)}")
