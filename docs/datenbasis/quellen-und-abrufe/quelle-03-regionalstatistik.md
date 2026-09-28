# Quelle 03 — Regionalstatistik

Gemeinde-Statistik der Regionaldatenbank Deutschland. Dieses Stub hält den Blocker fest: ohne funktionierende Registrierung gibt es keine Tabellen und keine erfundenen Ersatzdaten.

**Owner:** Data-Scout

**Confluence:** [Quelle 03 Regionalstatistik](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21954561)

| Feld | Wert |
| --- | --- |
| Source-ID | `regionalstatistik` |
| Provider | Regionaldatenbank Deutschland (Statistische Ämter) |
| Access | `REG` |
| Frequenz | jährlich |
| Grain | Ziel `ags` (Gemeinde) |
| URL | [REST 2020](https://www.regionalstatistik.de/genesisws/rest/2020/) |

## Status

**blocked (Auth).** Der REST-Pfad ist erreichbar, die registrierte Anmeldung hängt (Timeout). Katalog und Tabellenabruf sind damit nicht möglich. Zugangsdaten nie in Git oder Confluence; nur Secret-Store.

## Tabellen / Artefakte

Keine. Ziel sind mindestens zwei Gemeinde-Fact-Tabellen, sobald Auth steht. Bis dahin keine Platzhalter-Zeilen in Supabase.

## How to refresh

1. Operator erneuert das REG-Konto und legt das Secret neu ab.
2. Data-Scout wiederholt den Pull (`scout_source` = `regionalstatistik`) und protokolliert `scout_pull_run`.
3. Erst danach Fact-Tabellen anlegen, RLS setzen und dieses Stub sowie die Confluence-Seite um Tabellennamen ergänzen.

## Open issues

- Auth-Blocker offen; null Tabellen.
- Gemeinde-Bevölkerung aus [Quelle 01](quelle-01-destatis-genesis.md) hängt an diesem Abruf.
- Keine Passwort- oder Benutzer-Details in diesem File.
