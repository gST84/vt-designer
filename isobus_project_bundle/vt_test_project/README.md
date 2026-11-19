# VT-testproject: tekst op de ISOBUS-terminal vanuit een S7-1500

De PLC meldt zich via de ET 200SP CM CAN aan als ISOBUS-werkset, uploadt een kleine object pool
(één scherm met één tekst) naar de terminal en kan die tekst daarna wijzigen.

| Bestand | Inhoud |
|---|---|
| `01_VT_Types.udt` | PLC-datatypes: zendwachtrij en diagnose |
| `02_VT_TestClient.scl` | FB `VT_TestClient` + FC's `VT_Elapsed`, `VT_Push` |
| `03_VT_TestPool.db` | DB `VT_TestPool` met de binaire pool (119 bytes) |
| `VT_TestPool.iop` | dezelfde pool als bestand (om te bekijken in een pool-editor) |
| `pool_listing.txt` | de pool byte per byte uitgelegd |
| `tools/make_pool.py` | genereert de pool en de DB opnieuw: `python3 make_pool.py . "Mijn tekst"` |

## Wat er op het scherm komt

- **Werksetlijst van de terminal:** een knop met de tekst "S7 VT" (designator, object 11001).
- **Na selecteren:** wit scherm (Data Mask 1000) met de tekst "Hallo vanuit S7-1500" (Output String 11000,
  400×40 px op positie 20,40, lettertype 12×16).

## 1. Hardware aanvullen

In de eigenschappen van de CM CAN (CAN transparent) naast de bestaande receive proxy voor de tractordata:

1. **Een transmit proxy** toevoegen.
2. **Een tweede receive proxy** toevoegen, alleen voor VT-verkeer. Noteer het **proxynummer** (bv. 2).
3. Hardware compileren en laden. De configuratie-DB voor `ET200SPCM_CANConfig_1500` wordt dan opnieuw gegenereerd.
4. In een PLC-tagtabel tags leggen op de I/O-beginadressen van de nieuwe proxies:

| Tag | Datatype | Adres |
|---|---|---|
| `RcvProxy2_In` | `LCan_typeRcvInTransparentMessage` | beginadres ingangen receive proxy 2 |
| `RcvProxy2_Out` | `LCan_typeRcvOutTransparentMessage` | beginadres uitgangen receive proxy 2 |
| `TxProxy1_In` | `LCan_typeSendInTransparentMessage` | beginadres ingangen transmit proxy |
| `TxProxy1_Out` | `LCan_typeSendOutTransparentMessage` | beginadres uitgangen transmit proxy |

5. Zoek de **hardware-ID van de CM CAN**: standaard-tagtabel › tabblad *Systeemconstanten* (type `Hw_SubModule`).
   Die gaat naar `hwIdCmCan` en wordt gebruikt door `LCan_SetTransparentFilter`.

## 2. Importeren

Externe bronbestanden › toevoegen › in deze volgorde *Blokken genereren uit bron*:
`01_VT_Types.udt` → `02_VT_TestClient.scl` → `03_VT_TestPool.db`.
De LCan-bibliotheek moet al in het project zitten (die gebruik je al voor de ontvangst).

## 3. Aanroepen (elke cyclus, bv. in OB1)

```
"VT_TestClient_DB"(enable        := "VtEnable",          // Bool, TRUE = starten
                   myAddress     := 16#90,               // vrij adres (niet gezien in je log)
                   vtAddress     := 16#80,               // Raven/CNH-terminal uit je log
                   canStatus     := "PLC_1.CM CAN_1.CAN transparent.Status",
                   hwIdCmCan     := <systeemconstante CM CAN>,
                   rxProxyIndex  := 2,
                   poolSize      := "VT_TestPool".size,
                   chunkCount    := "VT_TestPool".chunkCount,
                   textObjectId  := "VT_TestPool".textObjectId,
                   textMaxLength := "VT_TestPool".textMaxLength,
                   text          := "VtText",            // String[32]
                   sendText      := "VtSendText",        // flank = tekst versturen
                   pool          := "VT_TestPool".data,
                   chunkStart    := "VT_TestPool".chunkStart,
                   chunkLength   := "VT_TestPool".chunkLength,
                   rxProxyIn     := "RcvProxy2_In",
                   rxProxyOut    := "RcvProxy2_Out",
                   txProxyIn     := "TxProxy1_In",
                   txProxyOut    := "TxProxy1_Out");
```

Roep hem pas aan als de CM CAN **Operational** is (statusbyte 16#03/16#07), dus na je bestaande
`ET200SPCM_CANConfig_1500` en het zetten van de controlebyte.

## 4. Testen

1. Trekker/terminal aan, `VtEnable` := TRUE.
2. Volg `"VT_TestClient_DB".diag.stateText`:
   `filter instellen` → `address claim` → `wacht op VT Status` → `Get Memory` → `Get Hardware` →
   `pool uploaden` → `VT controleert pool` → **`actief`**.
3. Open op de terminal de lijst met werksets / ISOBUS-toepassingen en kies **S7 VT**.
   `diag.onScreen` wordt TRUE zodra jouw scherm op de voorgrond staat.
4. Zet `VtText` op bv. `'Test 123'` en geef `VtSendText` een flank: de tekst verandert. `diag.stringError` = 0 is OK.

Na `diag.dataMaskWidth`/`Height` weet je hoe groot het scherm is; pas eventueel de positie en breedte aan
in `make_pool.py` en genereer de DB opnieuw.

## Wat de FB doet

1. Zet 5 ID-filters op receive proxy 2: VT Status (`16#1CE6FF80`), VT→ons (`16#1CE69080`, `16#18E69080`) en
   TP.CM van de VT naar ons (`16#1CEC9080`, `16#18EC9080`). Met de standaardadressen 0x90/0x80.
2. Address claim met de NAME uit de instantie-DB (`isoName`, standaard identiteit 12345, fabrikantcode 0).
3. Wacht op VT Status, stuurt Working Set Master, Working Set Maintenance (met initiating bit) en Get Memory.
4. Get Hardware (alleen diagnose), daarna de pool via het transport protocol: RTS → CTS → DT → EoMA.
5. End of Object Pool en controle van het antwoord.
6. Elke seconde Working Set Maintenance. Valt de VT Status 3 s weg, dan begint hij opnieuw vanaf stap 3.

## Foutcodes (`state` ≥ 900)

| state | Betekenis | Kijk naar |
|---|---|---|
| 900 | filter niet ingesteld | `diag.filterStatus`, `hwIdCmCan`, `rxProxyIndex` |
| 901 | te weinig geheugen in de VT | |
| 902 | geen antwoord op Get Memory | `diag.rcvStatus`, filters, VT-adres |
| 903 | pool leeg of delen ongeldig (deel > 1784 bytes, buiten de pool, of samen ≠ `poolSize`) | `poolSize`, `chunkCount`, `chunkStart`/`chunkLength` |
| 904 | pool-overdracht afgebroken | `diag.tpAbortReason` |
| 905 | VT weigert de pool | `diag.eopErrorCodes`, `eopFaultyObject`, `eopPoolErrors` |
| 906 | geen antwoord op End of Object Pool | |

Herstarten: `VtEnable` even FALSE en terug TRUE.

## Beperkingen van deze testversie

- **Niet gecompileerd**: geschreven zonder TIA Portal. Verwacht een paar kleine compileerfouten (bv. parameternamen
  van je LCan-versie). De object pool is wel nagecontroleerd met een parser.
- **Geen adresconflict-afhandeling** en geen antwoord op *Request for Address Claim*. Kies een adres dat zeker vrij is.
- **Fabrikantcode 0** in de NAME: prima voor een test, niet voor een product.
- **Geen Store/Load Version**: de pool wordt bij elke start opnieuw geüpload (bij 119 bytes is dat een fractie van een seconde).
- **Geen softkeys of knoppen**; de terminal stuurt ook geen events terug die verwerkt worden.
- Objectformaten volgen ISO 11783-6 bijlage B voor VT-versie 3; ze zijn niet tegen de officiële tekst gecontroleerd.
