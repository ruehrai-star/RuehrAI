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

**ok.** Kreisstatistik (Grain `ags5`) aus GENESIS geladen: Bevölkerung und Ausländer etwa 2022-12…2025-12, Alter 2024-12…2025-12. Secrets nur im Secret-Store. RLS auf diesen frühen Tabellen nicht als gesetzt führen — siehe Open issues.

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

- Gemeinde-Bevölkerung gehört zu [Quelle 03](quelle-03-regionalstatistik.md) und bleibt offen, solange die Registrierung fehlt.
- Ältere Jahre von 12411-0018 brauchen GENESIS `job=true`.
- Zum Pull-Zeitpunkt war RLS auf den Destatis-Tabellen noch deaktiviert. Neuere Quellen nutzen RLS plus `service_role_all`; Posture hier mit Confluence / Operator abgleichen.
- Weitere GENESIS-Themen (Bildung, Erwerb, Haushalte) sind noch nicht als Tabellen geführt.
