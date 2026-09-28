# Quelle 02 — Zensus 2022

Gemeinde-Tabellen aus dem Zensus 2022 (Regionaltabellen). Der 100-m-Gitter-Smoke ist ein separater Pre-List-Load (`zensus-2022-grid`) und gehört nicht in diese Fact-Tabellen.

**Owner:** Data-Scout

**Confluence:** [Quelle 02 Zensus 2022](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21889046)

| Feld | Wert |
| --- | --- |
| Source-ID | `zensus-2022-db` |
| Provider | Statistische Ämter des Bundes und der Länder / Destatis |
| Access | `REG` / Download |
| Frequenz | alle 5 Jahre (Zensus 2022) |
| Grain | `ags` (Gemeinde) |
| URL | [ergebnisse.zensus2022.de](https://ergebnisse.zensus2022.de/) |

## Status

Platzhalter. Operativer Status in Confluence. Der Portal-API-Pfad war beim letzten dokumentierten Abruf nicht nutzbar; geladen wurde der Regionaltabellen-Fallback.

## Tabellen / Artefakte

| Tabelle | Grain | `ref_period` |
| --- | --- | --- |
| `zensus2022_bevoelkerung_gemeinden` | `ags` | `2022-05` |
| `zensus2022_demografie_gemeinden` | `ags` | `2022-05` |
| `zensus2022_haushalte_gemeinden` | `ags` | `2022-05` |
| `zensus2022_gebaeude_gemeinden` | `ags` | `2022-05` |
| `zensus2022_wohnungen_gemeinden` | `ags` | `2022-05` |
| `zensus2022_erwerbsstatus_gemeinden` | `ags` | `2022-05` |

Diese sechs Tabellen sind die Supabase-Quelle für den ersten Brain-Batch, siehe [Vektorisierung](../vektorisierung-analytics/README.md).

## How to refresh

1. Offizielle Gemeinde-Regionaltabellen beziehen. Credentials, falls nötig, nur aus dem Secret-Store.
2. Pull `zensus-2022-db` in `scout_pull_run` schreiben.
3. Die sechs Tabellen upserten, Stichtag `2022-05` beibehalten.
4. `zensus-2022-grid` nicht in diese Tabellen mischen.

## Open issues

- Portal-API (`ergebnisse.zensus2022.de`) erneut von einem freigegebenen Netz prüfen.
- Flächendeckendes 100-m-Gitter bleibt deferred; Smoke liegt bei `geo_ref_grid100`.
