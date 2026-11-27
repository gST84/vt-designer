# VT_Client en TC_Client in CODESYS

Dezelfde blokken als voor TIA Portal, voor een CODESYS-sturing met CAN (bv. een mobiele sturing van ifm, Epec of
TTControl). De VT Designer **vertaalt de TIA-bronnen** uit `vt_client/` en `tc_client/` naar CODESYS ST, zodat een
fix in de TIA-blokken ook in CODESYS terechtkomt. Enkel de CAN-laag is eigen code: `LCan_CL2.st`.

| Bestand | Herkomst |
|---|---|
| `LCan_CL2.st` | vast (dit pakket): de blokken van de Siemens-bibliotheek LCan, op de CODESYS-bibliotheek **CAA CanL2** |
| `VT_Client`, `TC_Client` en hun datatypes | vertaald uit `vt_client/` en `tc_client/` |
| `VT_Pool`, `VT_Io`, `VT_IoMap` (en `TC_Pool`, `TC_Io`, `TC_IoMap`) | VT Designer, vertaald uit dezelfde export als voor TIA |

## Exporteren (VT Designer › Exporteren › CODESYS)

| Knop | Bestand | Inhoud |
|---|---|---|
| **Alles** | `<project>_CODESYS.xml` | alles hierboven in één PLCopen XML |
| Pool en interface | `<project>_CODESYS_project.xml` | enkel wat bij het ontwerp hoort; na een wijziging van het ontwerp opnieuw importeren |
| Alles als ST-tekst | `<project>_CODESYS_st.zip` | dezelfde objecten als tekst, als de XML-import niet lukt |

De namen (`VT_Pool`, `VT_Io`, …) zijn dezelfde als in TIA en stel je in bij het exporteren. Een DB wordt een
globale variabelenlijst met `{attribute 'qualified_only'}` (dus `VT_Io.out.Snelheid`, zoals in TIA); een `Struct` in
een DB wordt een datatype `<DB>_<naam>` (bv. `VT_Io_out`).

## Importeren

1. **Bibliotheken** (Bibliotheekbeheer › Bibliotheek toevoegen), alle drie nodig:
   - **CAA CanL2** (CAA Can Low Level Extern, namespace `CL2`): `CL2.Read`, `CL2.Write`, `CL2.ERROR`, …;
   - **CAA Types** (CAA Types Extern, namespace `CAA`): `CAA.HANDLE`, `CAA.gc_hINVALID`;
   - **CAA Can Low Level Imp Extern** (namespace `CL2I`): `CL2I.DATA`, `CL2I.COBID`.
   Zonder deze drie geeft de compiler "Unknown type 'CAA.HANDLE'" of "'CL2.ERROR'" in de LCan-blokken.
2. **Project › PLCopenXML importeren**, het `.xml`-bestand kiezen en alles aanvinken. Bij een nieuwe export van
   het ontwerp: bestaande objecten vervangen.
3. **CAN-interface** van de sturing op 250 kbit/s (ISOBUS). Gebruik op dezelfde interface niet ook de J1939- of
   ISOBUS-stack van de fabrikant met hetzelfde adres.

Lukt de XML-import niet: in de zip staat per object een regel `// ======== DUT|GVL|POU <naam>`, de declaratie en bij
een POU na `// ---- code` de implementatie. Maak in CODESYS een object met die naam en plak beide delen.

## Aanroepen

```
PROGRAM PLC_PRG
VAR
    vt : VT_Client;
    tc : TC_Client;
    i : INT;
END_VAR

// Eén frame per 2 à 3 aanroepen (de handshake van de CM CAN blijft): roep de blokken daarom meerdere
// keren per cyclus aan. 10× bij een cyclus van 10 ms haalt ongeveer de snelheid van de S7-testbank.
FOR i := 1 TO 10 DO
    vt(enable := TRUE, myAddress := 16#90, vtAddress := 16#FF, canNet := 0, rxProxyIndex := 2,
       poolSize := VT_Pool.size, chunkCount := VT_Pool.chunkCount,
       pool := VT_Pool.data, chunkStart := VT_Pool.chunkStart, chunkLength := VT_Pool.chunkLength,
       num := VT_Io.sys.num, str := VT_Io.sys.str, flag := VT_Io.sys.flag, key := VT_Io.sys.key, ctrl := VT_Io.sys.ctrl);
    tc(enable := vt.running, myAddress := 16#90, tcAddress := 16#FF, canNet := 0, rxProxyIndex := 4,
       info := TC_Pool.info, sectionCount := TC_Io.par.sectionCount, autoLayout := TC_Io.par.autoLayout,
       pool := TC_Pool.data, objStart := TC_Pool.objStart, objLength := TC_Pool.objLength, objSection := TC_Pool.objSection,
       patchOffset := TC_Pool.patchOffset, patchKind := TC_Pool.patchKind, patchSection := TC_Pool.patchSection,
       sectionWidth := TC_Io.par.sectionWidth, sectionX := TC_Io.par.sectionX, sectionY := TC_Io.par.sectionY,
       pd := TC_Io.sys.pd, ctrl := TC_Io.sys.ctrl);
END_FOR;
VT_IoMap();
TC_IoMap();

// eigen logica met VT_Io.out / VT_Io.in en TC_Io.in / TC_Io.out, zoals in TIA
```

Zonder VT (enkel een task controller): `tc(enable := TRUE, ownClaim := TRUE, …)` en `vt` niet aanroepen.

## Verschillen met TIA

| TIA | CODESYS |
|---|---|
| `hwIdCmCan` (hardware-ID van de CM CAN) | `canNet`: nummer van de CAN-interface, 0 = de eerste |
| `canStatus`, `rxProxyIn/Out`, `txProxyIn/Out` | vervallen |
| `rxProxyIndex`: receive proxy van de CM CAN | nummer van de filterlijst in `LCan_CL2` (0..31); `VT_Client` en `TC_Client` elk een ander |
| `diag.rcvStatus`, `diag.sendStatus`, `diag.filterStatus`: LCan-codes | 16#7000 wacht, 16#0000 in orde, anders de CL2-foutcode (bv. 10203 = verkeerde baudrate) |

`LCan_CL2` geeft elk blok een eigen CL2-ontvanger voor alle 29-bit dataframes en filtert in software met dezelfde
lijst als de CM CAN. Werkt je sturing niet met CAA CanL2 (bv. enkel een eigen CAN-bibliotheek van de fabrikant), dan is
`LCan_CL2.st` het enige bestand dat aangepast moet worden.

## Nog na te kijken

- **Niet gecompileerd en niet getest in CODESYS**: vertaald en statisch gecontroleerd met `tools/check-codesys.sh`
  (geen SCL-resten, alles gedeclareerd, blokken in evenwicht, geldige XML). Fouten bij importeren of compileren:
  graag melden, met de melding van CODESYS.
- Of de PLCopen-import van jouw CODESYS-versie de declaratie als platte tekst overneemt (nodig voor `ARRAY[*]`);
  anders de ST-tekst gebruiken.
