# Quelle 07 — Wegweiser Kommune

Ist-Daten der Bertelsmann Stiftung (Wegweiser Kommune), öffentlicher CSV-Export. Die OpenAPI-Oberfläche ist [Quelle 08](quelle-08-wegweiser-kommune-api.md) und lädt diese Tabellen nicht ein zweites Mal.

**Owner:** Data-Scout

**Confluence:** [Quelle 07/08 Wegweiser Kommune](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/22118401)

| Feld | Wert |
| --- | --- |
| Source-ID | `wegweiser-kommune` |
| Provider | Bertelsmann Stiftung — Wegweiser Kommune |
| Access | `OPEN` |
| Frequenz | jährlich |
| Grain | `ags` (Filter Gemeinden und Städte) |
| URL | [wegweiser-kommune.de](https://www.wegweiser-kommune.de/) |

## Status

Platzhalter. Operativer Status in Confluence. Indikatoren liegen als JSONB-Map pro Gemeinde-Jahr; `k.A.` der Quelle bleibt `k.A.`.

## Tabellen / Artefakte

| Tabelle | Grain |
| --- | --- |
| `wwk_demografie_gemeinden` | `ags` |
| `wwk_finanzen_gemeinden` | `ags` |
| `wwk_bildung_gemeinden` | `ags` |
| `wwk_soziale_lage_gemeinden` | `ags` |
| `wwk_integration_gemeinden` | `ags` |

## How to refresh

1. Öffentlichen CSV-Export je Themenfamilie laden (kein API-Key).
2. Pull `wegweiser-kommune` in `scout_pull_run` protokollieren.
3. Die fünf Tabellen upserten. Quelle 08 nicht parallel mit denselben Rows befüllen.
4. CSV nicht committen.

## Open issues

- Weitere Topics (Beschäftigung, Pflege, Pendler, Prognose) sind deferred.
- Bildungswerte sind quellenbedingt lückenhaft.
- Neuere Berichtsjahre nachziehen, sobald veröffentlicht.
