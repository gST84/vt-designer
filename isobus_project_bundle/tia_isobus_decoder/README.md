# ISO_TractorDecode – ISOBUS/J1939-tractorberichten in TIA Portal

Decodeert de standaard broadcastberichten van een tractor (TECU) naar één gestructureerde variabele
van het type `"typeIsoTractor"`. Bedoeld voor een S7-1500 met een **ET 200SP CM CAN** in **transparante modus**.

Bestanden:

| Bestand | Inhoud |
|---|---|
| `01_ISO_Types.udt` | PLC-datatypes (eerst importeren) |
| `02_ISO_TractorDecode.scl` | FB `ISO_TractorDecode` + hulp-FC's (`ISO_Bits`, `ISO_U16`, `ISO_U32`, `ISO_Scale8/16`, `ISO_StatRx/Age`, `ISO_Decode…`) |

## Importeren

1. Projectnavigator › PLC › **Externe bronbestanden** › *Nieuw extern bestand toevoegen* › `01_ISO_Types.udt`.
2. Idem voor `02_ISO_TractorDecode.scl`.
3. Rechtsklik op elk bestand (eerst de .udt) › **Blokken genereren uit bron**.
4. Maak een global DB `TractorData` met één variabele `tractor : "typeIsoTractor"`.

## Gedecodeerde berichten

| PGN | Hex | Bericht | Veld in `tractor` | Timeout |
|---|---|---|---|---|
| 61444 | F004 | EEC1 motor | `engine` | snel |
| 65096 | FE48 | Wheel-based Speed and Distance | `wheelSpeed` | snel |
| 65097 | FE49 | Ground-based Speed and Distance | `groundSpeed` | snel |
| 61474 | F022 | Machine Selected Speed | `selectedSpeed` | snel |
| 65093 / 65094 | FE45 / FE46 | Rear / Front Hitch Status | `rearHitch` / `frontHitch` | snel |
| 65091 / 65092 | FE43 / FE44 | Rear / Front PTO | `rearPto` / `frontPto` | snel |
| 65040–65055 | FE10–FE1F | Aux Valve 0–15 Estimated Flow | `auxValveFlow[0..15]` | traag |
| 65267 | FEF3 | Vehicle Position | `vehiclePosition` | traag |
| 65256 | FEE8 | Vehicle Direction/Speed | `vehicleDirSpeed` | traag |

Elk bericht heeft een `stat` met `valid` (ontvangen binnen de timeout), `sourceAddress` en `rxCount`.
Elke waarde heeft een `…Ok`-bit: FALSE als de tractor "fout" of "niet beschikbaar" stuurt (ruw ≥ 0xFB / 0xFB00).
Statusvelden van 2 bits: 0 = uit/nee, 1 = aan/ja, 2 = fout, 3 = n.b.

## Aanroep

De FB verwerkt **één frame per aanroep** en bewaakt bij elke aanroep de timeouts. Roep hem elke cyclus aan;
staat er een frame klaar, dan met `newFrame := TRUE`.

```
"IsoDecode_DB"(newFrame      := #frameReady,
               frameId       := #rxId,        // 29-bit identifier als DWord
               frameExtended := #rxIs29Bit,
               frameLength   := #rxLength,
               frameData     := #rxData,      // Array[0..7] of Byte
               filterSa      := 16#F0,        // alleen de TECU; 16#FF = alle bronnen
               timeoutFast   := T#500MS,
               timeoutSlow   := T#3S,
               tractor       := "TractorData".tractor);
```

`filterSa := 16#F0` is aan te raden: Machine Selected Speed komt op jouw bus ook van de terminal (bronadres 0x82,
op basis van GPS). Zonder filter overschrijven die twee elkaar.

### Koppelen aan de CM CAN (receive proxy)

Siemens levert bij de CM CAN de bibliotheek **LCan** met o.a. `LCan_SetTransparentFilter`, `LCan_RcvTransparentMessage`
en de datatypes `LCan_typeRcvInTransparentMessage` / `LCan_typeRcvOutTransparentMessage`
(applicatievoorbeeld 109779316). Het principe:

1. Configureer in de hardware een **receive proxy** en zet met `LCan_SetTransparentFilter` de identifiers die je wilt
   ontvangen (max. 16 per proxy, exacte ID-match).
2. Roep `LCan_RcvTransparentMessage` elke cyclus aan. Staat er een bericht klaar, geef ID, 29-bit-vlag, lengte en
   data door aan `ISO_TractorDecode` met `newFrame := TRUE`, en bevestig daarna het bericht (`ackMessage`) zodat de
   module het volgende aanbiedt.

De exacte parameternamen van de LCan-blokken hangen af van de bibliotheekversie: neem ze over uit het voorbeeld van
Siemens. `ISO_TractorDecode` is bewust onafhankelijk van de LCan-blokken gehouden.

### Filter-ID's (gemeten op jouw tractor, prioriteit 3, bronadres 0xF0)

| ID | Bericht |
|---|---|
| 16#0CF004F0 | EEC1 motor |
| 16#0CFE48F0 | Wheel-based speed |
| 16#0CFE49F0 | Ground-based speed |
| 16#0CF022F0 | Machine selected speed |
| 16#0CFE45F0 | Rear hitch |
| 16#0CFE46F0 | Front hitch |
| 16#0CFE43F0 / 16#0CFE44F0 | Rear / front PTO (niet gezien in de log: PTO stond uit) |
| 16#0CFE10F0 … 16#0CFE18F0 | Aux valve 0–8 estimated flow |

Een J1939-ID bevat prioriteit en bronadres. Verandert een van beide (andere tractor, ander adres), dan moet het filter mee.

### Doorvoer

Met een receive proxy wordt elk bericht afzonderlijk bevestigd. Deze lijst geeft ±110 berichten/s. Verdeel de ID's over
**meerdere receive proxies** (bv. 3 proxies met elk een eigen `LCan_RcvTransparentMessage`-instantie) en roep
`ISO_TractorDecode` per proxy één keer per cyclus aan. Hou `receiveBufferOverFlow` in de gaten.

### Alternatief: configured messages

Elke ID kan ook als vast bericht in het procesbeeld staan. Dat is eenvoudiger, maar je weet dan niet of een bericht
opnieuw ontvangen is: de module houdt de laatste waarde vast. Roep je de FB dan elke cyclus met `newFrame := TRUE` aan,
dan werkt de timeoutbewaking niet.

## Nog te controleren

- **Compileren**: de code is niet in TIA Portal gecompileerd (geen TIA beschikbaar bij het schrijven). Getest is de
  logica: PGN-extractie, bitvelden en schaling, met een Python-kopie tegen jouw log van 18/11/2026 (647 waarden, 0 afwijkingen).
- **Aux valve**: bitposities van `valveState` en `failSafeMode` zijn niet geverifieerd tegen de norm.
- **PTO byte 6** (`speedLimitStatus` vanaf bit 2): controleren met een log waarin de aftakas draait.
- **Navigatie** (65267/65256) volgt SAE J1939-71 en is niet gecontroleerd tegen de ISOBUS-dictionary; jouw GNSS-ontvanger
  stuurt NMEA 2000-berichten (129029 enz.), die deze FB niet decodeert.
