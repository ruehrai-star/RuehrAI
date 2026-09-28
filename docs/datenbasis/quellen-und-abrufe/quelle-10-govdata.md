# Quelle 10 — GovData

Katalog-first über GovData (CKAN) plus nachgelagerte Open-Data-Anbieter (BBSR, SBF und weitere). GovData verlinkt; die Fact-Tabellen kommen von den jeweiligen Download-Seiten.

**Owner:** Data-Scout

**Confluence:** [Quelle 10 GovData](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/22151169)

| Feld | Wert |
| --- | --- |
| Source-ID | `govdata` |
| Provider | GovData (CKAN), BBSR, SBF und weitere |
| Access | `OPEN` |
| Frequenz | variabel |
| Grain | `ags` (Kreis/Gemeinde), Katalog-Metadaten, other |
| URL | [govdata.de](https://www.govdata.de/) |

## Status

**ok.** Katalog-first: GovData verlinkt, Fact-Dateien bei den Herausgebern geladen. `govdata_dresden_kaufkraft` bleibt Grain other (Regionstext, kein AGS). RLS aktiv, Policy `service_role_all`. Koordinaten bleiben null, wenn die Veröffentlichung keine liefert.

## Tabellen / Artefakte

| Tabelle | Grain |
| --- | --- |
| `govdata_bbsr_kreis_raumtypen` | `ags` |
| `govdata_bbsr_gemeinde_raumtypen` | `ags` |
| `govdata_sbf_sozialer_zusammenhalt` | `ags` |
| `govdata_dresden_kaufkraft` | other (kein AGS in der Quelle) |
| `govdata_catalog_entries` | Katalog-Metadaten |

## How to refresh

1. Paket auf govdata.de prüfen und die aktuelle Datei beim Herausgeber laden (Deep-Links können 404 sein).
2. Pull `govdata` in `scout_pull_run` protokollieren.
3. Fact- und Katalogtabellen upserten. Kein AGS raten, wenn die Datei nur Regionstext hat.
4. Rohdateien nicht committen.

## Open issues

- INKAR-Gesamtdownload über Quelle 28 (BBSR), nicht über GovData. Portal bleibt katalog-first.
- Weitere Katalogtreffer nur ohne Duplikat zu den Quellen 01–09.
- AGS-Mapping für `govdata_dresden_kaufkraft` braucht den Location-Guide.
