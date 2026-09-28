# Quelle 08 — Wegweiser Kommune API

OpenAPI-Twin zu [Quelle 07](quelle-07-wegweiser-kommune.md). Dieses Stub inventarisiert die API-Oberfläche. Fact-Zeilen leben in den `wwk_*`-Tabellen und werden hier nicht dupliziert.

**Owner:** Data-Scout

**Confluence:** [Quelle 07/08 Wegweiser Kommune](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/22118401)

| Feld | Wert |
| --- | --- |
| Source-ID | `wegweiser-kommune-api` |
| Provider | Bertelsmann Stiftung — Wegweiser Kommune |
| Access | `OPEN` |
| Frequenz | jährlich (an Quelle 07 gekoppelt) |
| Grain | `ags` |
| URL | [OpenAPI](https://www.wegweiser-kommune.de/openapi) |

## Status

Inventar / Audit. Kein eigener Fact-Load. Operative Notiz in Confluence auf derselben Seite wie Quelle 07.

## Tabellen / Artefakte

Keine eigenen Fact-Tabellen.

Zugehörige Tabellen (Owner Quelle 07): `wwk_demografie_gemeinden`, `wwk_finanzen_gemeinden`, `wwk_bildung_gemeinden`, `wwk_soziale_lage_gemeinden`, `wwk_integration_gemeinden`.

## How to refresh

1. OpenAPI-Beschreibung öffentlich abrufen und mit den fünf Fact-Tabellen abgleichen.
2. Pull `wegweiser-kommune-api` in `scout_pull_run` nur als Inventar-Lauf schreiben (`row_count` 0, wenn nichts Neues geladen wird).
3. Schema-Änderungen an Quelle 07 melden, bevor ein zweiter Load entsteht.

## Open issues

- OpenAPI-Inventar und CSV-Loads synchron halten.
- Kein Bulk-Zweitload der Indikatoren.
