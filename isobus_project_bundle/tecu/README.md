# ISO_TractorEcu: de PLC als tractor-ECU (TECU, ISO 11783-9)

`ISO_TractorEcu` laat een S7-1500 met een ET 200SP CM CAN de **tractor-ECU** spelen op de ISOBUS. Het blok is het
spiegelbeeld van `ISO_TractorDecode` (`tia_isobus_decoder`): het stuurt de waarden uit dezelfde structuur
`"typeIsoTractor"`, met dezelfde schaling. Daarnaast levert het de diensten van een TECU, GNSS-positie (NMEA 2000) en,
als klasse-3-tractor, de opdrachten van werktuigen.

| Bestand | Inhoud |
|---|---|
| `../tia_isobus_decoder/01_ISO_Types.udt` | `typeIsoTractor` en zijn delen (eerst importeren) |
| `01_TECU_Types.udt` | configuratie, vrijgave, GNSS, opdrachten, Maintain Power, diagnose, zendwachtrij |
| `02_ISO_TractorEcu.scl` | FB `ISO_TractorEcu` + FC's `TEC_Elapsed`, `TEC_Push`, `TEC_Raw8/16/32`, `TEC_DaysSince1970`, `TEC_Encode…` |

Importeren (Externe bronbestanden › toevoegen › Blokken genereren uit bron), in deze volgorde:
`01_ISO_Types.udt` → `01_TECU_Types.udt` → `02_ISO_TractorEcu.scl`. Vereist ook de Siemens-bibliotheek **LCan**.

## Hardware en cyclustijd

- **Eén receive proxy zonder filter.** Een TECU moet elk toestel op de bus antwoorden en opdrachten van elk werktuig
  aannemen. De CM CAN filtert enkel op exacte ID's (max. 16 per proxy), dus de FB ontvangt alles
  (`ignoreRcvFilterSetting`) en filtert zelf. `LCan_SetTransparentFilter` is niet nodig.
- **Eén transmit proxy.** Niet dezelfde als die van `VT_Client` of `TC_Client`.
- **Doorvoer:** één frame per twee aanroepen, in elke richting. Roep de FB daarom aan in een **cyclische
  interrupt-OB van 2 ms** (bv. OB30), met een eigen deelprocesbeeld voor de twee proxy's. Dat geeft 250 frames/s per
  richting.

| Berichten (standaard) | Frames/s |
|---|---|
| motor, wiel- en grondsnelheid, MSS, achterhef, achterste aftakas (100 ms) | 60 |
| tijd en datum (1 s) | 1 |
| GNSS: 129025 (100 ms), 129026 (250 ms), 129029 (1 s, 7 frames) | 21 |
| voorhef en voorste aftakas (`addendumF`) | 20 |
| per aux-ventiel in `cfg.auxValveMask` | 10 |

Is de cyclus te traag of staan er te veel berichten aan, dan loopt de wachtrij vol en telt `diag.txLate`. Ontvangen
frames die niet tijdig verwerkt worden, gaan verloren. Een verzoek wordt dan herhaald, een opdracht verloopt (zie
Veiligheid).

## Aanroepen

```
// global DB "Tecu" met: tractor : "typeIsoTractor"; cfg : "typeTecuConfig"; allow : "typeTecuAllow"; gnss : "typeTecuGnss";
"Tecu_DB"(enable         := TRUE,
          myAddress      := 16#F0,
          canStatus      := "PLC_1.CM CAN_1.CAN transparent.Status",
          nameIdentity   := 1,            // uniek per tractor van dezelfde fabrikant
          cfg            := "Tecu".cfg,
          allow          := "Tecu".allow, // vrijgave door de bestuurder (standaard alles FALSE)
          gnss           := "Tecu".gnss,
          stopOperations := #knopAllesStop,
          tractor        := "Tecu".tractor,
          rxProxyIn      := "TecuRcvIn",
          rxProxyOut     := "TecuRcvOut",
          txProxyIn      := "TecuSendIn",
          txProxyOut     := "TecuSendOut");

// eigen logica: sensoren → "Tecu".tractor (snelheden, hef, aftakas, ...), "Tecu_DB".cmd → aansturing (zie Veiligheid)
```

Vul in `tractor` de waarden én de `…Ok`-bits in. Een waarde met `…Ok = FALSE` gaat als "niet beschikbaar" (16#FF…) de
bus op. De velden `stat` worden niet gebruikt. Na een wijziging van `nameIdentity` of `myAddress`: `enable` uit en weer
aan.

## Berichten van de tractor

| PGN | Bericht | Uit | Aan met |
|---|---|---|---|
| 61444 (F004) | EEC1 motor | `tractor.engine` | `cfg.sendEngine` |
| 65096 (FE48) | Wheel-based Speed and Distance, met sleutelstand | `tractor.wheelSpeed` | `cfg.sendWheelSpeed` |
| 65097 (FE49) | Ground-based Speed and Distance | `tractor.groundSpeed` | `cfg.sendGroundSpeed` |
| 61474 (F022) | Machine Selected Speed | `tractor.selectedSpeed` | `cfg.sendSelectedSpeed` |
| 65093 / 65094 | hef achter / voor, met limit status en exit/reason code | `tractor.rearHitch` / `frontHitch` | `cfg.sendRearHitch` / `sendFrontHitch` |
| 65091 / 65092 | aftakas achter / voor | `tractor.rearPto` / `frontPto` | `cfg.sendRearPto` / `sendFrontPto` |
| 65040 + n | Aux Valve n Estimated Flow | `tractor.auxValveFlow[n]` | bit n van `cfg.auxValveMask` |
| 65267 / 65256 | Vehicle Position, Direction/Speed (J1939) | `tractor.vehiclePosition` / `vehicleDirSpeed` | `cfg.sendVehiclePosition` / `sendVehicleDirSpeed` |

Perioden: `cfg.periodFast` (100 ms), `periodAux` (100 ms), `periodNav` (1 s). Een Request (PGN 59904) voor een van
deze berichten stuurt het meteen.

## Diensten van de TECU

- **Adres:** claim op `myAddress` (16#F0) met NAME-functie 134 (Tractor ECU), industriegroep 2.
  - Requests for Address Claimed van iedereen worden beantwoord.
  - Op andere verzoeken aan ons komt een NACK.
  - Verliest de TECU het adres aan een toestel met voorrang, dan stuurt ze Cannot Claim en stopt (909).
- **Tractor Facilities Response (65033):** bij het opstarten, op Required Tractor Facilities (65032) en op verzoek.
  - De klasse komt uit `cfg.tecuClass`.
  - De faciliteiten volgen uit wat aan staat in `cfg`: geen verlichting.
  - Klasse 3 meldt de opdrachten voor achterhef, achterste aftakas en, als `auxValveMask` <> 0, aux-ventielen; met
    `addendumF` ook die voor de voorkant.
- **Language Command (65039):** bij het opstarten, op verzoek en bij elke wijziging van `cfg.language`, `country`,
  `decimalComma`, `time12h`, `dateFormat` of `units`.
- **Time/Date (65254):** elke seconde, UTC uit de PLC-klok (`RD_SYS_T`), met de lokale verschuiving uit `RD_LOC_T`.
  Zet de klok en de tijdzone van de CPU juist.
- **All Implements Stop (64770):** `stopOperations = TRUE` meldt "stop", anders "toegelaten". Het bericht gaat
  elke seconde en bij elke wijziging, met een teller van de wijzigingen (`cfg.sendStopState`).
- **Maintain Power (65095) van werktuigen:** `power.ecuPower` en `power.actuatorPower` zijn TRUE zolang een werktuig
  dat vraagt (time-out `cfg.powerTimeout`). Je eigen logica houdt dan de voeding aan na key-off, binnen de grenzen van
  ISO 11783-9. De sleutelstand meld je in `tractor.wheelSpeed.keySwitch`, de resterende tijd in
  `maxTimeTractorPower_min`.

## GNSS (NMEA 2000)

Met `cfg.sendGnss` gaan de volgende berichten uit `gnss` de bus op:
- 129025 Position Rapid Update (100 ms);
- 129026 COG & SOG Rapid Update (250 ms);
- 129029 GNSS Position Data (1 s, fast packet van 43 bytes, met hoogte, methode, satellieten, HDOP en PDOP).

Datum en tijd van 129029 komen uit de PLC-klok (UTC). Een task controller heeft deze positie nodig voor
sectiebesturing.

## Opdrachten van werktuigen (klasse 3)

| PGN | Opdracht | In `cmd` |
|---|---|---|
| 65090 (FE42) Hitch and PTO Commands | hefpositie voor/achter, aftakastoerental, in/uit, 540/1000, economy | `rearHitch`, `frontHitch`, `rearPto`, `frontPto` |
| 65072 + n | Auxiliary Valve n Command: debiet, uitschuiven/intrekken/zweven/blokkeren, fail-safe | `auxValve[n]` |
| 64835 (FD43) | Machine Selected Speed Command: rijsnelheid, maximum, richting | `speed` (enkel met `cfg.acceptSpeedCommand`) |

`cmd.<functie>.active` is enkel TRUE als **alle** voorwaarden kloppen:
- de tractor is klasse 3 (`cfg.tecuClass = 3`; voor de voorkant ook `cfg.addendumF`);
- de bestuurder gaf die functie vrij (`allow.<functie>`; standaard FALSE);
- de opdracht is vers: herhaald binnen `cfg.cmdTimeout` (standaard 3 s; werktuigen sturen ze minstens elke seconde
  en bij elke wijziging);
- ze komt van het werktuig dat de controle heeft (`source`). Het eerste werktuig neemt de controle; opdrachten van een
  ander werktuig worden genegeerd (`diag.cmdRejected`) tot de opdrachten van het eerste verlopen.

## Veiligheid

> **De FB stuurt nooit zelf een actor aan.** Hij levert enkel de gevraagde waarden en de vlag `active`. Wat de tractor
> daarmee doet, en of dat veilig is, beslist en bewaakt je eigen logica.

Bij een echte tractor hoort minstens:

- **Vrijgave door de bestuurder** per functie (`allow`), zichtbaar bevestigd, en op elk moment in te trekken. Een
  ingreep van de bestuurder (bediening in de cabine, hef- of aftakasknop, noodstop) heeft altijd voorrang.
- **Bij het intrekken of bij een ingreep:** de functie terug naar de bestuurder of naar een veilige toestand. Meld dat
  aan het werktuig met de **exit/reason code** en de **limit status** in `tractor` (bv. `tractor.rearHitch.exitCode`).
- **Grenzen** in je eigen logica: hefbereik, maximaal aftakastoerental, rijsnelheid, en vergrendelingen (bv. de
  aftakas niet inschakelen zonder bestuurder op de stoel of bij geheven hef).
- **Wat bij `active = FALSE`:** opdracht verlopen, vrijgave weg of een ander werktuig. Dan de functie niet bevriezen
  op de laatste opdracht, maar zoals bij de bestuurder: stoppen of overnemen.
- **Normen:** de machineveiligheid valt onder ISO 25119 (functionele veiligheid landbouwmachines) en ISO 11783-9
  (TECU). Dit blok alleen maakt een tractor niet conform.
- **Eerst testen zonder actoren:** de opdrachten van een werktuig enkel in `cmd` bekijken (bv. met de TC of VT van
  een testbank), daarna stap voor stap aansluiten.

## Diagnose

| `diag` | Betekenis |
|---|---|
| `stateText` | uit, adres claimen, actief (tractor-ECU), fout: adres verloren |
| `rxFrames`, `txFrames` | ontvangen en verzonden frames |
| `txLate` | berichten die moesten wachten: cyclus te traag of te veel berichten |
| `sendTimeouts`, `sendStatus`, `rcvStatus` | LCan-status; frame na 1 s zonder antwoord van de proxy opgegeven |
| `requests`, `lastRequestPgn`, `lastRequestSa` | verzoeken (PGN 59904) |
| `facilityRequests`, `cmdFrames`, `cmdRejected`, `powerFrames` | Required Tractor Facilities, opdrachten, Maintain Power |

## Nog na te kijken

- **Niet gecompileerd**: geschreven zonder TIA Portal. Gecontroleerd met `tools/check_scl.py` (alles gedeclareerd,
  velden van de types) en `tools/test_tecu.py`. Die test codeert elk bericht met dezelfde regels als de FB en leest het
  terug zoals `ISO_TractorDecode` en AgIsoStack++ (300 willekeurige waarden per bericht, ook "niet beschikbaar").
- **Bronnen van de byte-indeling:**
  - statusberichten: zoals `ISO_TractorDecode`, gecontroleerd met een tractorlog;
  - Hitch and PTO Commands, Aux Valve Command en Tractor Facilities: ISO 11783-7:2002, bijlage B. Latere edities
    gebruiken sommige gereserveerde bits en bytes; die stuurt de FB als 0 (faciliteiten) of negeert hij (opdrachten);
  - Maintain Power, Language Command, Time/Date, MSS Command, All Implements Stop en NMEA 2000: zoals AgIsoStack++,
    niet tegen de normtekst gecontroleerd.
- **CODESYS:** de FB vertaalt met de vertaler van de designer, behalve de klok (`RD_SYS_T`, `RD_LOC_T`, `DTL`). Daarvoor
  is in CODESYS nog een vervanging nodig.

Versie 0.1 – 2026-11-26.
