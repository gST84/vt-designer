# TC_Client: werktuig voor de task controller (TIA Portal)

De task controller (TC) van een terminal stuurt volgens een taakkaart secties aan/uit en instelwaarden
(dosis, diepte, hoogte, …) naar het werktuig, en verzamelt werkelijke waarden en totalen voor de documentatie
(ISO 11783-10). `TC_Client` doet dat voor de PLC, naast `VT_Client` (zelfde adres en NAME).

| Bestand | Herkomst |
|---|---|
| `01_TCC_Types.udt` | vast (dit pakket) |
| `02_TC_Client.scl` | vast: FB `TC_Client` + FC's `TCC_Elapsed`, `TCC_Push` |
| `TC_Pool.db` | VT Designer › Werktuig, Exporteren › *TC-pool* |
| `TC_Io.db` | VT Designer › Exporteren › *TC-interface* |
| `TC_IoMap.scl` | VT Designer › Exporteren › *TC-koppel-FC* |

## Hardware

In de CM CAN (CAN transparent) naast die van `VT_Client`:

1. **Een receive proxy voor TC-verkeer** (bv. index 4) en **een tweede transmit proxy**. `TC_Client` en
   `VT_Client` mogen geen proxy delen: elk blok schrijft elke cyclus zijn proxy-uitgangen.
2. Tags op de beginadressen, met de types `LCan_typeRcvIn/OutTransparentMessage` en
   `LCan_typeSendIn/OutTransparentMessage`.
3. Zet bij `VT_Client` `otherAddress2 := 16#F7` (adres van de TC), zodat ook verzoeken van de TC beantwoord worden.

De CM CAN nam op de testbank een gewijzigde filterlijst pas over na een spanningsonderbreking. Komt een TC-bericht
nooit binnen (`diag.rxFrames` blijft 0 terwijl de TC er is): station even spanningsloos maken.

## Importeren

`01_TCC_Types.udt` → `TC_Pool.db` → `TC_Io.db` → `TC_IoMap.scl` → `02_TC_Client.scl`.
Na een wijziging van het werktuig in de designer: de drie geëxporteerde bestanden samen opnieuw importeren.

## Aanroepen (elke cyclus, na VT_Client)

```
"TC_Client_DB"(enable       := "VT_Client_DB".running,   // adres geclaimd door VT_Client
               myAddress    := 16#90,
               tcAddress    := 16#F7,
               canStatus    := "PLC_1.CM CAN_1.CAN transparent.Status",
               hwIdCmCan    := <systeemconstante CM CAN>,
               rxProxyIndex := 4,
               info         := "TC_Pool".info,
               sectionCount := "TC_Io".par.sectionCount,
               autoLayout   := "TC_Io".par.autoLayout,
               pool         := "TC_Pool".data,
               objStart     := "TC_Pool".objStart,
               objLength    := "TC_Pool".objLength,
               objSection   := "TC_Pool".objSection,
               patchOffset  := "TC_Pool".patchOffset,
               patchKind    := "TC_Pool".patchKind,
               patchSection := "TC_Pool".patchSection,
               sectionWidth := "TC_Io".par.sectionWidth,
               sectionX     := "TC_Io".par.sectionX,
               sectionY     := "TC_Io".par.sectionY,
               pd           := "TC_Io".sys.pd,
               ctrl         := "TC_Io".sys.ctrl,
               rxProxyIn    := "TcRcvIn",
               rxProxyOut   := "TcRcvOut",
               txProxyIn    := "TcSendIn",
               txProxyOut   := "TcSendOut");
"TC_IoMap"();

// eigen logica, bv. secties volgen de TC als de sectiebesturing automatisch staat
FOR #i := 1 TO 8 DO
    "TC_Io".out.section[#i] := "TC_Io".in.section[#i] AND "TC_Io".io.sectionAuto;
END_FOR;
"TC_Io".out.workState := "TC_Io".in.workState;
"TC_Io".out.actual[1] := #gemetenDosis;   // in de eenheid van de instelwaarde, bv. L/ha
```

Gebruik dezelfde NAME-ingangen als bij `VT_Client` (standaard zijn ze gelijk).

## Wat er gebeurt

1. Wacht `startupDelay` (6 s) en op het statusbericht van de TC, stuurt Working Set Master en elke 2 s zijn status.
2. Wisselt versies uit (wij: versie 3, documentatie + TC-GEO + sectiebesturing, 1 boom, n secties).
3. Maakt de beschrijving klaar met `par.sectionCount` secties en de maten uit `par` (Y uit de breedtes als
   `autoLayout`), de NAME en een structuurlabel dat met de secties en maten verandert.
4. Vraagt het structuur- en taallabel dat de TC van ons heeft. Kent de TC deze beschrijving al, dan meteen activeren;
   anders oude wissen, overdracht aanvragen en sturen (TP tot 1785 bytes, ETP daarboven), en activeren.
5. Verbonden: zet waarden die de TC stuurt in `in`/`io`, antwoordt op vragen, stuurt waarden volgens de
   meetopdrachten van de TC (tijdsinterval, bij verandering) en alle standaardwaarden op vraag.
6. Valt het statusbericht van de TC 6 s weg, of stuurt de TC een NACK: opnieuw aanmelden.

Nieuwe waarden in `par`: `enable` uit en weer aan.

## TC_Io

| Deel | Inhoud |
|---|---|
| `par` | `sectionCount` (1 tot het maximum uit de designer), `autoLayout`, `sectionWidth/X/Y[]` in mm |
| `in` | van de TC: `workState`, `section[]`, `setpoint[]` (eenheid van de instelwaarde) en `setpointRaw[]` |
| `io` | beide richtingen: `sectionAuto`, `prescriptionAuto[]`, `totalTime` (s) |
| `out` | naar de TC: `workState`, `section[]`, `actual[]`, `content[]` (L/kg), `total[]`, `totalArea` (m²) |
| `status` | `connected`, `taskActive`, `sectionCount`, `tcVersion` |

## Testen zonder GPS

Zonder positie start de TC geen sectiebesturing of taakkaart. Verbinden, de beschrijving en de documentatie zijn wel
te testen: het werktuig hoort in de TC of de toestellenlijst van de terminal te verschijnen (`connected` = TRUE).

## Nog na te kijken bij het testen

- **Niet gecompileerd**: geschreven zonder TIA Portal.
- De prioriteit waarmee de TC procesdata stuurt verschilt per terminal; de FB filtert op 3, 5, 6 en 7.
- Meetopdrachten op afstand en min/max-drempels worden aanvaard maar niet gebruikt (enkel tijd en verandering).
