# Ebenen: Quartier and Planungsraum

The Treffer **badge** is the Ebene. The hit **name** / Backend evidence text is the Flächenart. They are allowed to differ.

| Keys / `kind` / `sourceLevel` | Badge (Ebene) | Flächenart in Backend text |
| --- | --- | --- |
| `lor:plr:…`, `kind: lor`, `sourceLevel: lor` | Quartier | Planungsraum (Berlin LOR) |
| `lor:…` (other LOR) | Quartier | LOR / Planungsraum as stored |
| `koeln:sq:…`, `kind: quartier`, `sourceLevel: quartier` | Quartier | Stadtquartier (Köln) |

Code: `hitBadge` / `areaKindBadge` / `SERIES_LEVEL_BADGE` in `lib/recommendations/model.ts`. Catalog keys are never shown.

# Async Analyse polling

`GET /analysis/runs/{id}` is polled until `completed` or `failed`, or until client `POLL_DEADLINE` **180 s** from start or resume.

- Interval starts at **2 s** and, after 502 / 504 / `NetworkError` from `fetch` / fetch abort, backs off toward **~10 s** with jitter.
- Those GET errors are not a final state. The UI keeps **Analyse läuft …** with no error flicker.
- A `TypeError` from parsing or rendering is **not** a network error. It ends the run and is not retried.
- **Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.** only for backend `failureReason=timeout` or after the 180 s deadline.
- 404 (unknown run) and a definitive `failed` status stay final.
- The STAGE gateway idle limit is about **60 s**, not 150 s. A 504 on GET is expected on a long run and is retried.

`POST /analysis/runs` is **not** retried on 502/504. A timed-out POST may already have created a run. Retrying would start a second one, and there is no list endpoint to recover the id.
