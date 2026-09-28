# Runbooks

Checklisten für Abruf, Schema und Geo. Die erzählende Erst-Woche steht in Confluence. Dieses Stub ist die technische Kurzform ohne Secrets.

**Owner:** Data-Scout (Quellen), Location-Guide (Geo), Data-Engineer (Schema und Brain)

**Confluence:** [Runbooks & Onboarding](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21889025)

Lies zuerst den [Überblick](../README.md).

## Status

Runbooks sind beschrieben, noch nicht als ausführbare Skripte im Repo. Quelle 03 bleibt der bekannte Auth-Blocker, siehe [Regionalstatistik](../quellen-und-abrufe/quelle-03-regionalstatistik.md).

## Tabellen / Artefakte

Beim Anlegen einer Quelle anfassen:

| Artefakt | Wo |
| --- | --- |
| `scout_source`, `scout_pull_run` | Supabase `public` |
| Fact `{quelle}_{thema}_{grain}` | Supabase, RLS `service_role_all` |
| Stub `quelle-NN-*.md` | [Quellen & Abrufe](../quellen-und-abrufe/README.md) |
| Narrativ | Confluence-Kindseite unter Quellen & Abrufe |

## How to refresh

### Neue Quelle

1. `scout_source`: `source_id`, Name, Domain, `access_type` (`OPEN` oder `REG`), Grain, Cadence, URL, Notes.
2. Stub unter `quellen-und-abrufe/` und Confluence-Kindseite mit denselben Feldern.
3. Secret-Name nennen, Wert nur im Secret-Store. Nichts in Chat, Confluence oder Git pasten.
4. Pull schreiben, Fact-Tabelle laden, Policy `service_role_all` setzen.
5. Stub und Confluence um Tabellennamen ergänzen. Row-Counts bleiben in Confluence.

### Mindest-Checks

- Row-Count größer als 0 und plausibel gegenüber der Quelle.
- Primary Key und Dedup eingehalten.
- AGS- und Zeitspalten vorhanden und typisiert.
- Keine erfundenen Geometrien; `null` ist erlaubt.
- Lizenz in Notes (Beispiele: ODbL für OSM, CC BY für GTFS.de).

### Credentials

Erlaubt im Stub: Secret-Name und System (CI-Env, Secret-Store, Supabase-Dashboard).

Nicht erlaubt: Passwörter, API-Keys, Service-Role-Keys, Connection-Strings mit Geheimnissen, gefüllte Login-Screenshots.

## Open issues

- Erste-Woche-Zugang (Atlassian, Supabase-Rolle) ist ein Confluence-Checklisteneintrag, kein Git-Secret.
- Loader-Skripte und Migrationen fehlen in diesem Skeleton.
- Qualitätstoleranzen (zum Beispiel Sperrzeichen der Statistikämter) pro Quelle in Confluence fortschreiben, nicht als CSV hier.
