# Quelle 05 — Mobilithek

Konkrete Open-Datensätze aus dem BMDV-Katalog Mobilithek. Der Katalog selbst ist Metadaten; GTFS-Deutschland liegt bei [Quelle 06](quelle-06-gtfs-deutschland.md).

**Owner:** Data-Scout

**Confluence:** [Quelle 05 Mobilithek](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/22020097)

| Feld | Wert |
| --- | --- |
| Source-ID | `mobilithek` |
| Provider | BMDV Mobilithek |
| Access | `OPEN` |
| Frequenz | variabel |
| Grain | `ags` und other (Stop-Punkte) |
| URL | [mobilithek.info](https://mobilithek.info/) |

## Status

Platzhalter. Operativer Status in Confluence. Geladen wurden katalogierte Open-Sets, keine reinen GTFS.de-Duplikate.

## Tabellen / Artefakte

| Tabelle | Grain |
| --- | --- |
| `mobilithek_bast_dtv_zaehlstellen` | other |
| `mobilithek_oev_guete_gemeinden` | `ags` |
| `mobilithek_mobidata_bw_stops` | other (Smoke, nicht der volle Stop-Bestand) |

Koordinaten nur setzen, wenn die Quelle sie liefert.

## How to refresh

1. Datensatz im Mobilithek-Katalog prüfen und die veröffentlichte Datei laden.
2. Pull `mobilithek` in `scout_pull_run` protokollieren.
3. Fact-Tabellen upserten; Smoke-Caps im Stub vermerken.
4. Keine Feed-Archive ins Repo.

## Open issues

- MobiData-BW-Stops sind ein Smoke-Subset; Full-Load oder nationaler Feed über Quelle 06 ist offen.
- BASt- und ÖV-Güte-Koordinaten fehlen in der Quelle und werden nicht ergänzt.
