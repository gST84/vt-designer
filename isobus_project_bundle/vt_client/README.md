# VT_Client: VT-scherm met PLC-interface (TIA Portal)

Opvolger van `vt_test_project` met eigen namen (`VT_Client`, `VTC_…`, `typeVtc…`), zodat beide naast elkaar
in hetzelfde project kunnen staan. Je PLC-programma werkt met benoemde velden in de DB `VT_Io`; de FB houdt het
scherm daarmee gelijk.

| Bestand | Herkomst |
|---|---|
| `01_VTC_Types.udt` | vast (dit pakket) |
| `02_VT_Client.scl` | vast: FB `VT_Client` + FC's `VTC_Elapsed`, `VTC_Push` |
| `VT_Pool.db` | VT Designer › Exporteren › *TIA Portal* |
| `VT_Io.db` | VT Designer › Exporteren › *TIA: interface-DB* |
| `VT_IoMap.scl` | VT Designer › Exporteren › *TIA: koppel-FC* |

## Importeren

*Blokken genereren uit bron*, in deze volgorde:
`01_VTC_Types.udt` → `VT_Pool.db` → `VT_Io.db` → `VT_IoMap.scl` → `02_VT_Client.scl`.
Na een wijziging in de designer: de drie geëxporteerde bestanden samen opnieuw importeren.

## Aanroepen (elke cyclus, in deze volgorde)

```
"VT_Client_DB"(enable       := "VtEnable",
               myAddress    := 16#90,
               vtAddress    := 16#80,
               canStatus    := "PLC_1.CM CAN_1.CAN transparent.Status",
               hwIdCmCan    := <systeemconstante CM CAN>,
               rxProxyIndex := 2,
               poolSize     := "VT_Pool".size,
               chunkCount   := "VT_Pool".chunkCount,
               pool         := "VT_Pool".data,
               chunkStart   := "VT_Pool".chunkStart,
               chunkLength  := "VT_Pool".chunkLength,
               num          := "VT_Io".sys.num,
               str          := "VT_Io".sys.str,
               flag         := "VT_Io".sys.flag,
               key          := "VT_Io".sys.key,
               ctrl         := "VT_Io".sys.ctrl,
               rxProxyIn    := "RcvProxy2_In",
               rxProxyOut   := "RcvProxy2_Out",
               txProxyIn    := "TxProxy1_In",
               txProxyOut   := "TxProxy1_Out");
"VT_IoMap"();

// eigen logica
"VT_Io".out.Snelheid := REAL_TO_UDINT(#speed * 10.0);
IF "VT_Io".in.Start.onPress THEN #startCmd := TRUE; END_IF;
"VT_Io".activeMask := "VT_Pool".id.Hoofdscherm;
```

Hardware en proxies zoals in `vt_test_project` (receive proxy 2 voor VT-verkeer, één transmit proxy).
De FB zet 7 ID-filters: naast die van de testclient ook TP.DT van de VT naar ons (lange ingevoerde teksten).

## Wat er gebeurt

- **PLC → scherm:** alleen wat veranderd is, als Change Numeric Value, Change String Value, Hide/Show Object
  of Change Active Mask. Per getal of tekst hoogstens om de `minInterval` (standaard 100 ms), en hoogstens
  `maxPerCycle` opdrachten per cyclus.
- **Scherm → PLC:** softkeys en knoppen in `in.<naam>` (`pressed`, `onPress`/`onRelease` één cyclus, `count`),
  ingevoerde waarden en teksten in `in.<naam>`. Invoervelden kan de PLC ook zelf zetten.
- **Na elke (her)start van de pool** stuurt de FB alle waarden opnieuw.
- `diag` toont de toestand, foutantwoorden van de VT (`cmdErrors`, `lastCmd…`) en meldingen voor objecten die
  niet in `VT_Io` staan (`unknownEvents`, `lastUnknownId`).

## Nog na te kijken bij het testen

- **Niet gecompileerd**: geschreven zonder TIA Portal.
- `echoResponses` (standaard TRUE): de FB beantwoordt Soft Key/Button Activation en VT Change Numeric Value met
  hetzelfde bericht. Of de werkset dat moet doen, is nog niet tegen ISO 11783-6 nagekeken; zet FALSE als de
  terminal er vreemd op reageert.
- Bij invoervelden met een variabele aanvaardt de FB het object-ID van het veld én van de variabele.
- Ingevoerde teksten worden omgezet met `Chars_TO_Strg`.
