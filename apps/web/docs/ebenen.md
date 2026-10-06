# Ebenen: Badge and name use the same word

UX Trefferliste v4 (Confluence 31227905). This **replaces** the earlier decision that the Treffer badge always showed Quartier.

| Keys / `kind` | Badge | Name |
| --- | --- | --- |
| `lor:plr:…`, `kind: lor` (Berlin) | Planungsraum | `name` (last fallback `Planungsraum [amtliche Nummer]`) |
| `koeln:sq:…`, `kind: quartier` (Köln) | Quartier | `name` (`Quartier [Nummer]` only as a backend fallback) |
| `grid100` | 100-m-Raster | always `100-m-Rasterzelle` (no cell ID) |

Code: `hitBadge` / `areaKindBadge` / `SERIES_LEVEL_BADGE` in `lib/recommendations/model.ts` and `hit-copy.ts`. Catalog keys and cell IDs are never shown.

Lage-Satz from `overlaps` uses only `label` and `share`. It is gated by `SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT` (on: #69 already clips shares to `items[].geometry`).

# Async Analyse polling

`GET /analysis/runs/{id}` is polled until `completed` or `failed`, or until client `POLL_DEADLINE` **180 s** from start or resume.

- Interval starts at **2 s** and, after 502 / 504 / `NetworkError` from `fetch` / fetch abort, backs off toward **~10 s** with jitter.
- Those GET errors are not a final state. The UI keeps **Analyse läuft …** with no error flicker.
- A `TypeError` from parsing or rendering is **not** a network error. It ends the run and is not retried.
- **Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.** only for backend `failureReason=timeout` or after the 180 s deadline.
- 404 (unknown run) and a definitive `failed` status stay final.
- The STAGE gateway idle limit is about **60 s**, not 150 s. A 504 on GET is expected on a long run and is retried.

`POST /analysis/runs` is **not** retried on 502/504. A timed-out POST may already have created a run. Retrying would start a second one, and there is no list endpoint to recover the id.
