# Quelle 04 — KBA Open Data

Fahrzeugstatistik des Kraftfahrt-Bundesamts aus öffentlichen Excel-Produkten (keine Credentials).

**Owner:** Data-Scout

**Confluence:** [Quelle 04 KBA](https://ruehrai.atlassian.net/wiki/spaces/~71202025d18744898f43209641d6b31d2aa674/pages/21987329)

| Feld | Wert |
| --- | --- |
| Source-ID | `kba-open` |
| Provider | Kraftfahrt-Bundesamt (KBA) |
| Access | `OPEN` |
| Frequenz | monatlich / quartalsweise / jährlich je Produkt |
| Grain | Bundesland; Außerbetriebsetzungen `ags5` |
| URL | [KBA registrierte Fahrzeuge](https://www.kba.de/DE/Statistik/registrierte-fahrzeuge/registriertefahrzeuge_node.html) |

## Status

Platzhalter. Operativer Status in Confluence. Produkte im letzten dokumentierten Load: FZ 8, FZ 27, FZ 5.

## Tabellen / Artefakte

| Tabelle | Grain |
| --- | --- |
| `kba_neuzulassungen_laender` | Land (+ Bund) |
| `kba_bestand_laender` | Land (+ Bund) |
| `kba_ausserbetrieb_kreise` | `ags5` |

## How to refresh

1. Aktuelle KBA-Excel-Dateien von der öffentlichen Statistikseite laden.
2. Pull `kba-open` in `scout_pull_run` protokollieren.
3. Die drei Tabellen upserten. Leere Quellzellen bleiben leer.
4. Keine Excel-Dateien committen.

## Open issues

- Neuzulassungen und Bestand sind auf Bundesland begrenzt, nicht auf Kreis.
- Abgrenzung zu späteren Mobilithek-/KBA-Duplikaten in Confluence halten.
