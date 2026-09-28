# Quelle 01 — Destatis GENESIS

Kreisstatistik aus Destatis GENESIS-Online. Technische Identifikatoren für Loader und Schema; Pull-Protokoll in Confluence.

**Owner:** Data-Scout

**Confluence:** [Quelle 01 Destatis GENESIS](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21921793)

| Feld | Wert |
| --- | --- |
| Source-ID | `destatis-genesis` |
| Provider | Statistisches Bundesamt (Destatis), GENESIS-Online |
| Access | `REG` |
| Frequenz | jährlich / quartalsweise |
| Grain | `ags5` (Kreis) |
| URL | [GENESIS REST 2020](https://www-genesis.destatis.de/genesisWS/rest/2020/) |

## Status

Platzhalter für den letzten erfolgreichen Pull. Operativer Status steht in Confluence (dort zuletzt `ok`). Secrets nur im Secret-Store.

## Tabellen / Artefakte

| Tabelle | Grain |
| --- | --- |
| `destatis_bevoelkerung_kreise` | `ags5` |
| `destatis_bevoelkerung_alter` | `ags5` |
| `destatis_auslaender_kreise` | `ags5` |

Gemeinde-Bevölkerung ist nicht Teil der nationalen Destatis-DB; siehe [Quelle 03](quelle-03-regionalstatistik.md).

## How to refresh

1. GENESIS-Credentials aus dem Secret-Store laden.
2. Pull in `scout_pull_run` für `destatis-genesis` protokollieren.
3. Die drei Fact-Tabellen upserten; keine Roh-CSV ins Repo.
4. Confluence aktualisieren, wenn Perioden oder Tabellen sich ändern.

## Open issues

- Weitere GENESIS-Themen (Bildung, Erwerb, Haushalte) sind noch nicht als Tabellen geführt.
- Abgrenzung zu Regionalstatistik (Gemeinde) offen, solange Quelle 03 blockiert ist.
