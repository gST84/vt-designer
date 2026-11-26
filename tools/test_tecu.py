"""Round-trip test of ISO_TractorEcu (isobus_project_bundle/tecu) without TIA Portal.

The byte layout of every message the TECU writes is copied here from 02_ISO_TractorEcu.scl (encode) and read
back with the rules of ISO_TractorDecode (tia_isobus_decoder) or, for messages the decoder does not know, with the
layout of AgIsoStack++ / ISO 11783-7. A wrong bit position or scaling on either side shows up as a difference.

Usage: python3 tools/test_tecu.py"""
import math, random, struct

fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('OK   ' if cond else 'FOUT ') + name + (f'  ({info})' if info and not cond else ''))


# ---------------------------------------------------------------- encode: copy of the SCL (TEC_Raw…, TEC_Encode…)
def raw8(v, f, o, ok):
    if not ok:
        return 0xFF
    x = min(max((v - o) / f, 0.0), 250.0)
    return int(round(x))


def raw16(v, f, o, ok):
    if not ok:
        return 0xFFFF
    return int(round(min(max((v - o) / f, 0.0), 64255.0)))


def raw32(v, f, o, ok):
    if not ok:
        return 0xFFFFFFFF
    return int(round(min(max((v - o) / f, 0.0), 4211081215.0)))


le16 = lambda w: [w & 0xFF, (w >> 8) & 0xFF]
le32 = lambda d: [(d >> (8 * i)) & 0xFF for i in range(4)]


def enc_speed(s, kind):
    d = le16(raw16(s['speed_ms'], 0.001, 0, s['speedOk'])) + le32(raw32(s['distance_m'], 0.001, 0, s['distanceOk']))
    if kind == 0:
        d += [s['maxTime'], (s['dir'] & 3) | (s['key'] & 3) << 2 | (s['startStop'] & 3) << 4 | (s['opRev'] & 3) << 6]
    elif kind == 1:
        d += [0xFF, 0xFC | (s['dir'] & 3)]
    else:
        d += [0xC0 | (s['exit'] & 0x3F), (s['dir'] & 3) | (s['source'] & 7) << 2 | (s['limit'] & 7) << 5]
    return d


def enc_hitch(h):
    return ([raw8(h['pos'], 0.4, 0, h['posOk']), 0x07 | (h['limit'] & 7) << 3 | (h['inWork'] & 3) << 6,
             raw8(h['link'], 0.8, -100, h['linkOk'])] + le16(raw16(h['draft'], 10, -320000, h['draftOk']))
            + [0xC0 | (h['exit'] & 0x3F), 0xFF, 0xFF])


def enc_pto(p):
    return (le16(raw16(p['speed'], 0.125, 0, p['speedOk'])) + le16(raw16(p['set'], 0.125, 0, p['setOk']))
            + [(p['engReq'] & 3) | (p['eco'] & 3) << 2 | (p['m1000'] & 3) << 4 | (p['engaged'] & 3) << 6,
               0x01 | (p['limit'] & 7) << 1 | (p['ecoReq'] & 3) << 4 | (p['modeReq'] & 3) << 6, 0xC0 | (p['exit'] & 0x3F), 0xFF])


def enc_engine(e):
    return ([0xFF, raw8(e['demand'], 1, -125, e['demandOk']), raw8(e['actual'], 1, -125, e['actualOk'])]
            + le16(raw16(e['speed'], 0.125, 0, e['speedOk'])) + [0xFF, 0xF0 | (e['starter'] & 0x0F), 0xFF])


def enc_aux(v):
    return [raw8(v['ext'], 1, -125, v['extOk']), raw8(v['ret'], 1, -125, v['retOk']),
            (v['state'] & 0x0F) | 0x30 | (v['fail'] & 3) << 6, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]


# ---------------------------------------------------------------- decode: the rules of ISO_TractorDecode
bits = lambda b, start, n: (b >> (start - 1)) & ((1 << n) - 1)
u16 = lambda d, i: d[i] | d[i + 1] << 8
u32 = lambda d, i: d[i] | d[i + 1] << 8 | d[i + 2] << 16 | d[i + 3] << 24


def sc8(raw, f, o):
    return (False, 0.0) if raw >= 251 else (True, raw * f + o)


def sc16(raw, f, o):
    return (False, 0.0) if raw >= 0xFB00 else (True, raw * f + o)


def dec_speed(d, kind):
    ok, sp = sc16(u16(d, 0), 0.001, 0)
    dist = u32(d, 2)
    r = dict(speedOk=ok, speed_ms=sp, distanceOk=dist < 0xFB000000, distance_m=dist * 0.001 if dist < 0xFB000000 else 0.0,
             dir=bits(d[7], 1, 2))
    if kind == 0:
        r.update(maxTime=d[6], key=bits(d[7], 3, 2), startStop=bits(d[7], 5, 2), opRev=bits(d[7], 7, 2))
    if kind == 2:
        r.update(exit=bits(d[6], 1, 6), source=bits(d[7], 3, 3), limit=bits(d[7], 6, 3))
    return r


def dec_hitch(d):
    a, pos = sc8(d[0], 0.4, 0)
    b, link = sc8(d[2], 0.8, -100)
    c, draft = sc16(u16(d, 3), 10, -320000)
    return dict(posOk=a, pos=pos, limit=bits(d[1], 4, 3), inWork=bits(d[1], 7, 2), linkOk=b, link=link, draftOk=c, draft=draft,
                exit=bits(d[5], 1, 6))


def dec_pto(d):
    a, sp = sc16(u16(d, 0), 0.125, 0)
    b, st = sc16(u16(d, 2), 0.125, 0)
    return dict(speedOk=a, speed=sp, setOk=b, set=st, engReq=bits(d[4], 1, 2), eco=bits(d[4], 3, 2), m1000=bits(d[4], 5, 2),
                engaged=bits(d[4], 7, 2), limit=bits(d[5], 2, 3), ecoReq=bits(d[5], 5, 2), modeReq=bits(d[5], 7, 2), exit=bits(d[6], 1, 6))


def dec_engine(d):
    a, dem = sc8(d[1], 1, -125)
    b, act = sc8(d[2], 1, -125)
    c, sp = sc16(u16(d, 3), 0.125, 0)
    return dict(demandOk=a, demand=dem, actualOk=b, actual=act, speedOk=c, speed=sp, starter=bits(d[6], 1, 4))


def dec_aux(d):
    a, e = sc8(d[0], 1, -125)
    b, r = sc8(d[1], 1, -125)
    return dict(extOk=a, ext=e, retOk=b, ret=r, state=bits(d[2], 1, 4), fail=bits(d[2], 7, 2))


def same(exp, got, tol):
    bad = []
    for k, v in exp.items():
        if k not in got:
            continue
        g = got[k]
        okk = {'speed_ms': 'speedOk', 'distance_m': 'distanceOk'}.get(k, k + 'Ok')
        okk = okk if okk in exp else None
        if okk and not exp[okk]:
            continue  # not available: the value does not matter
        if isinstance(v, float):
            if abs(v - g) > tol.get(k, 1e-6):
                bad.append(f'{k}: {v} -> {g}')
        elif v != g:
            bad.append(f'{k}: {v} -> {g}')
    return bad


rnd = random.Random(7)
ok_or = lambda: rnd.random() > 0.15
problems = []
for n in range(300):
    for kind in (0, 1, 2):
        s = dict(speed_ms=rnd.uniform(0, 64), speedOk=ok_or(), distance_m=rnd.uniform(0, 4e6), distanceOk=ok_or(), dir=rnd.randrange(4),
                 maxTime=rnd.randrange(251), key=rnd.randrange(4), startStop=rnd.randrange(4), opRev=rnd.randrange(4),
                 exit=rnd.randrange(64), source=rnd.randrange(8), limit=rnd.randrange(8))
        d = enc_speed(s, kind)
        problems += [f'snelheid {kind}: {x}' for x in same(s, dec_speed(d, kind), dict(speed_ms=0.0006, distance_m=0.0006))]
        if len(d) != 8:
            problems.append(f'snelheid {kind}: {len(d)} bytes')
    h = dict(pos=rnd.uniform(0, 100), posOk=ok_or(), limit=rnd.randrange(8), inWork=rnd.randrange(4), link=rnd.uniform(-100, 100),
             linkOk=ok_or(), draft=rnd.uniform(-320000, 322550), draftOk=ok_or(), exit=rnd.randrange(64))
    problems += ['hef: ' + x for x in same(h, dec_hitch(enc_hitch(h)), dict(pos=0.21, link=0.41, draft=5.1))]
    p = dict(speed=rnd.uniform(0, 8000), speedOk=ok_or(), set=rnd.uniform(0, 8000), setOk=ok_or(), engReq=rnd.randrange(4), eco=rnd.randrange(4),
             m1000=rnd.randrange(4), engaged=rnd.randrange(4), limit=rnd.randrange(8), ecoReq=rnd.randrange(4), modeReq=rnd.randrange(4),
             exit=rnd.randrange(64))
    problems += ['aftakas: ' + x for x in same(p, dec_pto(enc_pto(p)), dict(speed=0.07, set=0.07))]
    e = dict(demand=rnd.uniform(-125, 125), demandOk=ok_or(), actual=rnd.uniform(-125, 125), actualOk=ok_or(), speed=rnd.uniform(0, 8000),
             speedOk=ok_or(), starter=rnd.randrange(16))
    problems += ['motor: ' + x for x in same(e, dec_engine(enc_engine(e)), dict(demand=0.51, actual=0.51, speed=0.07))]
    v = dict(ext=rnd.uniform(-125, 125), extOk=ok_or(), ret=rnd.uniform(-125, 125), retOk=ok_or(), state=rnd.randrange(16), fail=rnd.randrange(4))
    problems += ['aux-ventiel: ' + x for x in same(v, dec_aux(enc_aux(v)), dict(ext=0.51, ret=0.51))]
    # "niet beschikbaar" moet ook zo terugkomen
    for name, enc, dec, val, key in [('hef', enc_hitch, dec_hitch, h, 'posOk'), ('aftakas', enc_pto, dec_pto, p, 'speedOk'), ('motor', enc_engine, dec_engine, e, 'speedOk')]:
        if dec(enc(val))[key] != val[key]:
            problems.append(f'{name}: {key} {val[key]} -> {dec(enc(val))[key]}')
check('snelheden, hef, aftakas, motor en aux-ventielen: 300 × heen en terug gelijk (ook "niet beschikbaar")', not problems, '; '.join(problems[:5]))

check('niet beschikbaar: 16#FF / 16#FFFF / 16#FFFFFFFF', enc_hitch(dict(pos=1, posOk=False, limit=7, inWork=3, link=0, linkOk=False, draft=0, draftOk=False, exit=63))
      == [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF] and enc_speed(dict(speed_ms=1, speedOk=False, distance_m=1, distanceOk=False, dir=3), 1) == [0xFF] * 8)
check('grenzen: 16#FA / 16#FAFF als maximum', raw8(1e9, 1, 0, True) == 0xFA and raw16(1e9, 1, 0, True) == 0xFAFF and raw32(1e18, 1, 0, True) == 0xFAFFFFFF)

# ---------------------------------------------------------------- navigation (J1939), as the decoder
lat, lon = 50.98765432, 3.76543210
dw = raw32(lat, 1e-7, -210, True)
check('Vehicle Position 1e-7 °, offset -210', abs(dw * 1e-7 - 210 - lat) < 1e-7)
w = raw16(181.3, 0.0078125, 0, True)
check('Vehicle Direction: koers 1/128 °', abs(w * 0.0078125 - 181.3) < 0.004)

# ---------------------------------------------------------------- Hitch and PTO Commands (ISO 11783-7 B.10): the parsing of the FB
cmd = [100, 150, *le16(4320), *le16(8000), (1 << 6) | (0 << 4) | 0x0F, (0 << 6) | (1 << 4) | (3 << 2) | 1]
rear_hitch, front_hitch = cmd[1] * 0.4, cmd[0] * 0.4
rear = dict(speed=u16(cmd, 4) * 0.125, engage=(cmd[6] >> 4) & 3, mode=(cmd[7] >> 4) & 3, eco=cmd[7] & 3)
front = dict(speed=u16(cmd, 2) * 0.125, engage=(cmd[6] >> 6) & 3, mode=(cmd[7] >> 6) & 3, eco=(cmd[7] >> 2) & 3)
check('HPTOC: achterhef byte 2, voorhef byte 1', rear_hitch == 60.0 and front_hitch == 40.0)
check('HPTOC: aftakas achter bytes 5-6 / 7.6-5 / 8.6-5 / 8.2-1, voor bytes 3-4 / 7.8-7 / 8.8-7 / 8.4-3',
      rear == dict(speed=1000.0, engage=0, mode=1, eco=1) and front == dict(speed=540.0, engage=1, mode=0, eco=3))

# ---------------------------------------------------------------- Language Command (AgIsoStack parse)
units = 0
lang = [ord('n'), ord('l'), 0x0F | (0 << 4) | (0 << 6), 0, units | units << 2 | units << 4 | units << 6, units | units << 2 | units << 4 | units << 6,
        ord('B'), ord('E')]
check('Language Command: "nl", komma, 24 u, metrisch, land "BE"',
      bytes(lang[:2]) == b'nl' and (lang[2] >> 4) & 3 == 0 and (lang[2] >> 6) & 3 == 0 and lang[4] == 0 and lang[5] == 0 and bytes(lang[6:]) == b'BE')
dec_point = 0x0F | (1 << 4) | (1 << 6)
check('Language Command: punt en 12 u in byte 3 bits 7-8 en 5-6', (dec_point >> 6) & 3 == 1 and (dec_point >> 4) & 3 == 1)

# ---------------------------------------------------------------- Time/Date (AgIsoStack)
sec, minute, hour, month, day, year, off = 37, 5, 14, 11, 26, 2026, 60
td = [sec * 4, minute, hour, month, (day - 1) * 4 + 1, year - 1985, off % 60 + 125, off // 60 + 125]
check('Time/Date: 0,25 s, dag × 4 + 1, jaar - 1985, offsets + 125',
      td[0] / 4 == sec and (td[4] - 1) // 4 + 1 == day and td[5] + 1985 == year and td[7] - 125 == 1 and td[6] - 125 == 0)
offMin = -90  # SCL: MOD en / kappen af naar nul
check('Time/Date: negatieve verschuiving (-1 u 30)', int(math.fmod(offMin, 60)) + 125 == 95 and int(offMin / 60) + 125 == 124)

# ---------------------------------------------------------------- Tractor Facilities Response (ISO 11783-7 B.25.3)
cls = 3
d0 = (cls - 1) << 6 | 1 << 5 | 1 << 4 | 0x08 | 1 << 2 | 1 << 1 | 1
check('Tractor Facilities: klasse in byte 1 bits 8-7 (10 = klasse 3)', d0 >> 6 == 2 and d0 & 0x3F == 0x3F)

# ---------------------------------------------------------------- NMEA 2000 (AgIsoStack serialize)
def days(y, m, d):  # TEC_DaysSince1970
    y = y - 1 if m <= 2 else y
    era = y // 400
    yoe = y - era * 400
    mp = m - 3 if m > 2 else m + 9
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


import datetime
check('dagen sinds 1970 (2026-11-26, 2000-03-01, 1970-01-01)',
      all(days(*t) == (datetime.date(*t) - datetime.date(1970, 1, 1)).days for t in [(2026, 11, 26), (2000, 3, 1), (1970, 1, 1), (2024, 2, 29)]))
g = bytearray(43)
g[0] = 9
g[1:3] = struct.pack('<H', days(2026, 11, 26))
g[3:7] = struct.pack('<I', (14 * 3600 + 5 * 60 + 37) * 10000)
g[7:15] = struct.pack('<q', int(lat * 1e16))
g[15:23] = struct.pack('<q', int(lon * 1e16))
g[23:31] = struct.pack('<q', int(17.25 * 1e6))
g[31] = 0 | (4 << 4)
g[32] = 0xFC
g[33] = 14
g[34:36] = struct.pack('<h', 80)
g[36:38] = struct.pack('<h', 150)
g[38:42] = struct.pack('<i', 4710)
g[42] = 0
frames = []
seq = 3
for n in range(7):  # the fast packet loop of the FB
    f = [0xFF] * 8
    f[0] = seq << 5 | n
    if n == 0:
        f[1] = 43
        f[2:8] = g[0:6]
    else:
        for i in range(7):
            if 6 + 7 * (n - 1) + i <= 42:
                f[1 + i] = g[6 + 7 * (n - 1) + i]
    frames.append(f)
back = bytearray(frames[0][2:8])
for f in frames[1:]:
    back += bytes(f[1:8])
back = back[:frames[0][1]]
check('129029 fast packet: 7 frames, 43 bytes terug', len(frames) == 7 and bytes(back) == bytes(g))
check('129029: breedte 1e-16 °, methode RTK fixed in de hoge nibble', abs(struct.unpack_from('<q', back, 7)[0] * 1e-16 - lat) < 1e-9 and back[31] >> 4 == 4)
cog = int(round(271.5 * 0.017453292 * 10000))
check('129026: COG 1e-4 rad', abs(cog * 1e-4 * 180 / math.pi - 271.5) < 0.01)
check('CAN-ID 129025 prioriteit 2 van 0xF0 = 0x09F801F0', (2 << 26 | 0x1F801 << 8 | 0xF0) == 0x09F801F0)
check('CAN-ID 129029 prioriteit 3 = 0x0DF805F0', (0x0DF80500 | 0xF0) == 0x0DF805F0)
check('CAN-ID wielsnelheid prioriteit 3 = 0x0CFE48F0 (zoals op de tractor gemeten)', (3 << 26 | 0xFE48 << 8 | 0xF0) == 0x0CFE48F0)

print(f'\n{fails} fout(en)' if fails else '\nAlle TECU-tests geslaagd')
raise SystemExit(1 if fails else 0)
