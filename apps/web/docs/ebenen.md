# Ebenen: Badge and name use the same word

UX Trefferliste v4 / v5 (Confluence 31227905). This **replaces** the earlier decision that the Treffer badge always showed Quartier.

| Keys / `kind` | Badge | Name |
| --- | --- | --- |
| `lor:plr:…`, `kind: lor` (Berlin) | Planungsraum | `name`. Missing name or `Planungsraum [8-digit]` → `Planungsraum ohne Namen`. Never the LOR number. |
| `koeln:sq:…`, `kind: quartier` (Köln) | Quartier | `name`. Missing name or `Quartier [Nummer]` → `Quartier ohne Namen`. Never the Quartier number. |
| `grid100` | 100-m-Raster | always `100-m-Rasterzelle` (no cell ID) |

Code: `hitBadge` / `mapDisplayName` / `areaKindBadge` / `SERIES_LEVEL_BADGE` in `lib/recommendations/model.ts` and `hit-copy.ts`. Catalog keys and cell IDs are never shown. Search and Zielregion use the same Berlin word via `catalogBadge` (`lor:*` → Planungsraum, not LOR).

Lage-Satz and Details overlap names use the same mapping as Treffer names (`mapDisplayName`): Planungsraum in Berlin, Quartier in Köln, raster `100-m-Rasterzelle`. Unnamed shows only the kind (`Planungsraum ohne Namen`, `Quartier ohne Namen`). Backend labels matching `^Planungsraum \d{8}$` or `^Quartier \d+$` map the same way. Never a number or catalog key. Gated by `SHOW_OVERLAP_LAGE_FROM_CLIPPED_HIT` (on: #69 already clips shares to `items[].geometry`).

# Async Analyse polling

`GET /analysis/runs/{id}` is polled until `completed` or `failed`, or until client `POLL_DEADLINE` **180 s** from start or resume.

- Interval starts at **2 s** and, after 502 / 504 / `NetworkError` from `fetch` / fetch abort, backs off toward **~10 s** with jitter.
- Those GET errors are not a final state. The UI keeps **Analyse läuft …** with no error flicker.
- A `TypeError` from parsing or rendering is **not** a network error. It ends the run and is not retried.
- **Analyse fehlgeschlagen: Die Berechnung hat zu lange gedauert.** only for backend `failureReason=timeout` or after the 180 s deadline.
- 404 (unknown run) and a definitive `failed` status stay final.
- The STAGE gateway idle limit is about **60 s**, not 150 s. A 504 on GET is expected on a long run and is retried.

`POST /analysis/runs` is **not** retried on 502/504. A timed-out POST may already have created a run. Retrying would start a second one, and there is no list endpoint to recover the id.

# Begründung without catalog keys

Heuristic `items[].rationale` may still contain a parenthesized geoKey (`Die Teilfläche Alexanderplatzviertel (lor:plr:01100310) im Vergleich…`). The Web strips those tokens with `visibleRationale` / `stripInternalKeys` before Trefferliste and Verlauf render the sentence. Keys, empty parentheses, and leftover double spaces never reach the UI.

# Verlauf bind

Verlauf binds from `GET /analysis/pattern?geoKey=` first (`loadVerlaufPatternForMarkedRegion`) and paints the Muster without waiting for `GET /analysis/runs/{id}` or `GET /recommendations`. Those follow in the background.

If the pattern GET does not return within `VERLAUF_BIND_TIMEOUT_MS` (**30 s**), Verlauf leaves **Verlauf wird geladen …** and shows **Der Verlauf konnte nicht geladen werden.** with **Erneut versuchen**.

A run belongs to the marked Zielregion when that place is on `input.regions` or `input.region` (`runIsForMarkedRegion` / `samePlace` / catalog-key helpers), even if `input.region` is a sibling (STAGE: Lichterfelde primary, Tempelhof also on the snapshot). `startedRunId === run.id` is still accepted and is not required after reload. A run that does not list the mark stays excluded. Trefferliste also binds when `set.targetRegions[].geoKey` covers the mark (including bare OSM ids such as `162894` vs `ortsteil:osm:162894`). Hits stay filtered by `items[].targetRegionGeoKey`.
