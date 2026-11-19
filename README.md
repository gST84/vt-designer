# VT Designer

Web-app om ISOBUS object pools (ISO 11783-6, Virtual Terminal versie 3) te ontwerpen en als binaire pool
te exporteren voor **TIA Portal** en **CODESYS**. Plain JavaScript (ES-modules) + SVG, geen build-stap.

**Online:** <https://gst84.github.io/vt-designer/>

De map [`isobus_project_bundle`](isobus_project_bundle) bevat de bijhorende PLC-code: de TIA-FB `VT_TestClient`
(werkset op een S7-1500 met ET 200SP CM CAN), een decoder voor tractorberichten en tools voor CAN-logs.

## Starten

```bash
./start.command
```

of `python3 serve.py` en dan <http://localhost:8766>. Het project wordt automatisch in de browser bewaard;
met *Opslaan* krijg je een `.vtd.json`-bestand. *Openen* leest zo'n bestand of een bestaande `.iop`-pool.

## Exporteren

| Doel | Bestand | Inhoud |
|---|---|---|
| TIA Portal | `<DB>.db` | DB-bron: `data` (Array of Byte), `size`, `chunkCount/chunkStart/chunkLength`, `id.<naam>`, `textLength.<naam>` |
| CODESYS | `<GVL>.st` | GVL-tekst: `Pool`, `POOL_SIZE`, `ChunkStart/ChunkLength`, constanten `ID_<naam>` / `LEN_<naam>` |
| CODESYS | `<GVL>.xml` | dezelfde GVL als PLCopen XML |
| Overig | `.iop`, listing | de binaire pool, en een uitleg byte per byte |

De pool wordt opgedeeld in delen van hele objecten van max. 1784 bytes (één TP-overdracht per
*Object Pool Transfer*). De nieuwe-projectpool is byte voor byte gelijk aan
`isobus_project_bundle/vt_test_project/VT_TestPool.iop`.

## Opbouw

| Map | Wat |
|---|---|
| `src/iso/` | objectschema (alle VT v3-objecten), encoder/parser, afbeeldingen, macro-opdrachten, validatie |
| `src/export/` | TIA Portal, CODESYS, listing |
| `src/render.js`, `src/editor.js` | weergave als SVG en het canvas (selecteren, slepen, schalen) |
| `src/ui/` | panelen en dialogen |

## Tests

`test.html` in de browser, of zonder browser op macOS:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tools/run-tests.mjs
```
