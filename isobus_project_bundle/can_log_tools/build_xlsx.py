import sys, collections, datetime
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import decode as D
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import LineChart, Reference

LOG, OUT = sys.argv[1], sys.argv[2]
rows = D.read_log(LOG)
frames, signals, vt, tp, gnss, names, dm1 = D.process(rows)
T0 = rows[0]["t"]; START = datetime.datetime(2026, 11, 18, 11, 24, 45)
rel = lambda t: round(t - T0, 4)
klok = lambda t: (START + datetime.timedelta(seconds=t - T0)).strftime("%H:%M:%S.%f")[:-3]
dur = rows[-1]["t"] - T0

ROLE = {0x80: "Terminal (VT) – toont de werkschermen", 0x81: "Telematica-gateway van de terminal (zelfde toestel als 82/F5)",
        0x82: "Tweede TECU-functie van de terminal: zendt GPS-snelheid als Machine Selected Speed",
        0xAA: "GNSS-ontvanger/stuursysteem; heeft ook een eigen VT-scherm (VT-client)",
        0xA4: "Werktuig of extra controller met VT-scherm (geen address claim in log)",
        0xAC: "Tweede navigatie-functie van CNH (address claim gezien, verder stil)",
        0xCD: "CNH systeemmonitor (alleen address claim)", 0xF0: "Tractor-ECU (TECU) van de trekker",
        0xF5: "Display-functie van de terminal (proprietary dialoog met AA)", 0xF7: "Task Controller van de terminal",
        0xFE: "Nuladres (toestel zonder adres vraagt address claims op)"}

wb = Workbook()
F = "Arial"; thin = Side(style="thin", color="C9CED6"); bd = Border(left=thin, right=thin, top=thin, bottom=thin)
HF = PatternFill("solid", fgColor="1F4E78"); BAND = PatternFill("solid", fgColor="EEF3F8")

def sheet(title, headers, data, widths, wrap=()):
    ws = wb.create_sheet(title)
    for c, h in enumerate(headers, 1):
        x = ws.cell(row=1, column=c, value=h); x.font = Font(name=F, bold=True, color="FFFFFF"); x.fill = HF
        x.alignment = Alignment(vertical="center", wrap_text=True); x.border = bd
    for r, row in enumerate(data, 2):
        for c, v in enumerate(row, 1):
            x = ws.cell(row=r, column=c, value=v); x.font = Font(name=F, size=9); x.border = bd
            x.alignment = Alignment(vertical="top", wrap_text=(c in wrap))
            if r % 2 == 1: x.fill = BAND
    for c, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(c)].width = w
    ws.freeze_panes = "A2"
    if data: ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(data)+1}"
    return ws

# ---------- statistiek
cnt = collections.Counter(); first = {}; last = {}; example = {}
for f in frames:
    k = (f["sa"], f["pgn"], f["da"]); cnt[k] += 1
    first.setdefault(k, f["t"]); last[k] = f["t"]; example.setdefault(k, f)
sent = collections.Counter(f["sa"] for f in frames)

# verlies 100 ms-berichten
import statistics
ts = [r["t"] for r in rows if r["pgn"] == 0xF004 and r["sa"] == 0xF0]
expected = (ts[-1] - ts[0]) / 0.1 + 1; loss = 1 - len(ts) / expected
ts2 = [r["t"] for r in rows if r["pgn"] == 0xFFE9 and r["sa"] == 0xF0]
loss2 = 1 - len(ts2) / ((ts2[-1] - ts2[0]) / 0.02 + 1)

# tijdlijn
key_ev = []; prev = None
for s in signals:
    if s["sig"].startswith("Sleutel") and s["val"] != prev: key_ev.append((s["t"], s["val"])); prev = s["val"]
rpm = [(s["t"], s["val"]) for s in signals if s["sig"] == "Motortoerental"]
run = [t for t, v in rpm if v > 600]
idle = statistics.median([v for t, v in rpm if v > 600]) if run else 0
vt_ws = collections.Counter(v["det"].split(",")[0] for v in vt if v["func"] == "VT Status")

# ---------- 1 samenvatting
summ = [
    ("Bestand", "Microchip CAN BUS Analyzer-log, gestart 18/11/2026 11:24:45"),
    ("Duur / frames", f"{dur:.1f} s, {len(rows)} frames, allemaal 29-bit (J1939/ISOBUS), 250 kbit/s aangenomen"),
    ("Busbelasting", f"≈{len(rows)/dur:.0f} frames/s ontvangen ≈ {len(rows)/dur*130/250000*100:.0f} % van 250 kbit/s (zonder verloren frames)"),
    ("FRAMEVERLIES", f"De analyzer heeft frames gemist: EEC1 (100 ms) {loss*100:.0f} % weg, PGN 0xFFE9 (20 ms) {loss2*100:.0f} % weg. "
                     "Gaten van 0,3–1,5 s. Daardoor zijn ook {} TP-pakketten en de meeste GNSS-posities onvolledig. "
                     "Waarschijnlijk is de Microchip-analyzer/USB te traag; de bus zelf is niet overbelast.".format(sum(1 for f in frames if 'niet in log' in f['txt']))),
    ("Trekker", "CNH-tractor-ECU op adres 0xF0 (fabrikantcode 94 = CNH Industrial). Stilstaand: wielsnelheid 0 km/h."),
    ("Motor", f"Sleutel aan bij start log; motor gestart op t≈{(run[0]-T0) if run else 0:.1f} s, stationair ≈{idle:.0f} rpm, "
              f"sleutel uit op t≈{key_ev[-1][0]-T0:.1f} s en motor valt stil. Sleutelwissels: " +
              ", ".join(f"t={t-T0:.1f}s {'aan' if v else 'uit'}" for t, v in key_ev)),
    ("Hefinrichting", "Achterhef ≈91,6–92 % (bijna volledig omhoog), trekkracht 2,5–5 kN; fronthef ≈28,4 %."),
    ("Hydrauliek", "Aux-ventielen 0–3, 5, 6 gemeld met 0 % debiet (geblokkeerd); ventiel 4, 7, 8 en gemeten debiet: n.b."),
    ("Terminal", "Raven/CNH-terminal (fabrikantcode 151) op 0x80 = Virtual Terminal, 0xF7 = Task Controller (geen taak actief), "
                 "0x81/0x82/0xF5 = andere functies van hetzelfde toestel."),
    ("VT-verkeer", f"{len(vt)} VT-berichten. Werksets: 0xAA (GNSS/stuursysteem) en 0xA4. VT Status: "
                   + ", ".join(f"{k} ({n}×)" for k, n in vt_ws.most_common()) + " – geen van beide werksets stond op het scherm; ze werden op de achtergrond bijgewerkt. Vooral Change Numeric Value, Hide/Show en Change List Item; "
                   "geen softkey- of knopdrukken in deze periode, geen object-pool-upload."),
    ("GNSS", f"0xAA zendt NMEA2000-berichten (houding, koers/snelheid, DOP, positie). {len(gnss)} volledige posities: "
             f"{gnss[0]['fix'] if gnss else '-'} (geen RTK), PDOP {gnss[0]['pdop']:.1f}. Coördinaten staan op tabblad 'GNSS & storingen'."),
    ("Storingen", "DM1 van 0xAA (GNSS): " + (dm1[0]["text"].replace("DM1: ", "") if dm1 else "geen") +
                  ". Betekenis van de SPN's: zie documentatie van Raven/CNH."),
    ("Niet te decoderen", "Fabrikantspecifieke berichten (Proprietary A 0xEF00, Proprietary B 0xFFxx: 0xFFE8/0xFFE9 van de trekker, "
                          "0xFF1D/0xFF20/0xFF70/0xFFA0 van 0xAA): geen openbare definitie."),
    ("Let op", "Decodering volgt ISO 11783-6/-7, SAE J1939 en NMEA 2000. Velden gemarkeerd 'niet geverifieerd' zijn uit kennis van de norm, niet "
               "gecontroleerd tegen de officiële tekst."),
]
ws = wb.active; ws.title = "Samenvatting"
ws["A1"] = "Decodering CAN-log 18/11/2026 – ISOBUS"; ws["A1"].font = Font(name=F, bold=True, size=14)
for i, (a, b) in enumerate(summ, 3):
    ws.cell(row=i, column=1, value=a).font = Font(name=F, bold=True, size=10, color="C00000" if a == "FRAMEVERLIES" else "000000")
    c = ws.cell(row=i, column=2, value=b); c.font = Font(name=F, size=10); c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.cell(row=i, column=1).alignment = Alignment(vertical="top")
ws.column_dimensions["A"].width = 20; ws.column_dimensions["B"].width = 130

# ---------- 2 deelnemers
addrs = sorted(sent)
data = []
for sa in addrs:
    n = names.get(sa)
    data.append([f"0x{sa:02X}", sa, ROLE.get(sa, ""), n["manuf_name"] if n else "(geen address claim gezien)",
                 n["func_name"] if n else "", n["function"] if n else "", n["func_inst"] if n else "",
                 n["dev_class"] if n else "", n["identity"] if n else "", sent[sa]])
sheet("Deelnemers", ["Adres", "Dec", "Rol (interpretatie)", "Fabrikant (NAME)", "Functie", "Functiecode", "Functie-inst.",
                     "Apparaatklasse", "Identiteitsnr", "Frames"], data, [8, 6, 55, 30, 30, 11, 11, 13, 12, 9], wrap=(3,))

# ---------- 3 berichten
data = []
for (sa, pg, da), n in sorted(cnt.items(), key=lambda x: (x[0][0], x[0][1])):
    e = example[(sa, pg, da)]; span = last[(sa, pg, da)] - first[(sa, pg, da)]
    data.append([f"0x{sa:02X}", f"0x{da:02X}" if da != 0xFF else "alle", f"0x{pg:04X}", pg, D.pgn_name(pg), n,
                 round((n - 1) / span, 2) if span > 0 and n > 1 else None, D.H(e["data"]), e["txt"]])
sheet("Berichten", ["Bron", "Doel", "PGN hex", "PGN", "Naam", "Aantal", "Freq. (Hz, gemeten)", "Voorbeeld data", "Voorbeeld gedecodeerd"],
      data, [7, 7, 9, 8, 34, 8, 10, 25, 90], wrap=(9,))

# ---------- 4 tractordata (breed) + grafiek
cur = {}; wide = []
cols = ["Motortoerental", "Sleutelschakelaar (1=aan)", "Wielsnelheid", "Achterhef positie", "Achterhef trekkracht", "Fronthef positie"]
for s in signals:
    if s["sig"] in cols: cur[s["sig"]] = s["val"]
    if s["sig"] == "Motortoerental":
        wide.append([rel(s["t"]), klok(s["t"])] + [cur.get(c) for c in cols])
ws4 = sheet("Tractordata", ["t (s)", "Klok", "Motortoerental (rpm)", "Sleutel (1=aan)", "Wielsnelheid (km/h)", "Achterhef (%)",
                            "Achterhef trekkracht (N)", "Fronthef (%)"], wide, [9, 13, 18, 14, 17, 13, 20, 13])
ch = LineChart(); ch.title = "Motortoerental en sleutelschakelaar"; ch.y_axis.title = "rpm"; ch.x_axis.title = "t (s)"
ch.add_data(Reference(ws4, min_col=3, min_row=1, max_row=len(wide) + 1), titles_from_data=True)
ch.set_categories(Reference(ws4, min_col=1, min_row=2, max_row=len(wide) + 1))
ch.height, ch.width = 9, 22; ch.x_axis.number_format = "0"; ch.x_axis.tickLblSkip = 20
ws4.add_chart(ch, "J2")

# ---------- 5 VT
data = [[rel(v["t"]), klok(v["t"]), f"0x{v['sa']:02X}", f"0x{v['da']:02X}" if v["da"] != 0xFF else "alle", v["richting"], v["func"],
         v["obj"] if v["obj"] != "" else None, v["det"], v["via"], v["raw"]] for v in vt]
sheet("VT-dialoog", ["t (s)", "Klok", "Van", "Naar", "Richting", "Functie", "Object-ID", "Details", "Via", "Ruwe bytes"],
      data, [9, 13, 7, 7, 9, 26, 10, 60, 12, 45], wrap=(8,))

# ---------- 6 transport
data = [[rel(x["t"]), f"0x{x['sa']:02X}", f"0x{x['da']:02X}" if x["da"] != 0xFF else "alle", x["txt"]] for x in tp]
sheet("Transportprotocol", ["t (s)", "Van", "Naar", "Gebeurtenis"], data, [9, 7, 7, 140], wrap=(4,))

# ---------- 7 GNSS & storingen
ws7 = wb.create_sheet("GNSS & storingen")
hdr = ["t (s)", "UTC", "Breedte (°)", "Lengte (°)", "Hoogte ell. (m)", "Geoïde (m)", "Fix", "PDOP"]
for c, h in enumerate(hdr, 1):
    x = ws7.cell(row=1, column=c, value=h); x.font = Font(name=F, bold=True, color="FFFFFF"); x.fill = HF
for r, g in enumerate(gnss, 2):
    for c, v in enumerate([rel(g["t"]), g["utc"], round(g["lat"], 7), round(g["lon"], 7), round(g["alt"], 2), g["geoid"], g["fix"], round(g["pdop"], 2)], 1):
        ws7.cell(row=r, column=c, value=v).font = Font(name=F, size=9)
r0 = len(gnss) + 4
ws7.cell(row=r0, column=1, value="DM1 – actieve storingen van 0xAA (GNSS-ontvanger)").font = Font(name=F, bold=True)
for c, h in enumerate(["SPN", "FMI", "FMI-betekenis", "Aantal keer", "Opmerking"], 1):
    x = ws7.cell(row=r0 + 1, column=c, value=h); x.font = Font(name=F, bold=True, color="FFFFFF"); x.fill = HF
for i, cd in enumerate(dm1[0]["codes"] if dm1 else [], r0 + 2):
    for c, v in enumerate([cd["spn"], cd["fmi"], cd["fmi_txt"], cd["oc"], "fabrikantspecifieke SPN" if cd["prop"] else "betekenis: J1939DA / Raven-documentatie"], 1):
        ws7.cell(row=i, column=c, value=v).font = Font(name=F, size=9)
ws7.cell(row=r0 + 7, column=1, value=f"Lampstatus: {dm1[0]['lamps'] if dm1 else '-'}. Slechts 1 van {sum(1 for x in tp if 'FECA' in x['txt'] and 'BAM' in x['txt'])} DM1-uitzendingen volledig ontvangen (frameverlies).").font = Font(name=F, size=9, italic=True)
for c, w in enumerate([10, 20, 13, 13, 15, 11, 30, 30], 1): ws7.column_dimensions[get_column_letter(c)].width = w

# ---------- 8 alle frames
data = [[rel(f["t"]), klok(f["t"]), f"0x{f['id']:08X}", f["prio"], f"0x{f['pgn']:04X}", D.pgn_name(f["pgn"]), f"0x{f['sa']:02X}",
         f"0x{f['da']:02X}" if f["da"] != 0xFF else "alle", D.H(f["data"]), f["txt"]] for f in frames]
sheet("Alle frames", ["t (s)", "Klok", "CAN-ID", "Prio", "PGN", "Naam", "Bron", "Doel", "Data", "Gedecodeerd"],
      data, [9, 13, 12, 5, 9, 32, 6, 6, 25, 90])

wb.save(OUT)
print("ok", OUT, "| verlies EEC1 %.0f%%, FFE9 %.0f%%" % (loss * 100, loss2 * 100))
