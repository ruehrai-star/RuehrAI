# @ruehrai/api-contracts

OpenAPI **v0.9.0** für die RuehrAI-API. Das ist der Vertrag, den Clients konsumieren. `0.2.0` ergänzt Logout, Zielregion, Filialadressen und Monatsumsatz. `0.3.0` ergänzt die Musteranalyse (`/analysis/input`, `/analysis/runs`, `/analysis/pattern`). `0.4.0` ergänzt Top-3-Empfehlungen (`POST /recommendations`, `GET /recommendations`) mit Titel, Ort, Score und deutscher Begründung. `0.5.0` ergänzt Kartenpins und die Zielregion: Filialen liefern WGS84 `lon`/`lat` (PLZ-Schwerpunkt, wenn der Write beide weglässt), die Zielregion liefert `bounds` (west, south, east, north) für `fitBounds` und `geometry` (GeoJSON Polygon/MultiPolygon) für die farbige Fläche. `0.6.0` ersetzt die einzelne Zielregion durch eine Liste: `GET /target-region` liefert `items`, `POST /target-region` hängt einen Katalogort an, `DELETE /target-region/{geoKey}` nimmt einen Ort heraus, `DELETE /target-region` leert die Liste. Es gibt kein `PUT`, das die einzige Zeile überschreibt. `0.6.1` ergänzt `gemeinde` in `CatalogLevel` für eine Gemeinde (grain `ags`). `0.7.0` ergänzt `POST /address-pair`: zwei Adressen, Lookup nur über die PLZ, Themen auf Gemeinde / Kreis / Land. `0.8.0` ergänzt `AnalysisPattern.yearlySeries`: Dreijahresreihe der kleinräumigen Brain-Kennzahlen für die Zielregionen. `coverage: single` ist kein Trend. `0.9.0` mappt die weiteren Brain-Mehrjahres-Themen (einschließlich `ba_sgb2`), bevorzugt lokales Unfallatlas Gebiet, verankert das Jahresfenster an verfügbaren Brain-Perioden und berechnet `yearlySeries` bei GET neu. `POST /auth/login` und `POST /auth/register` bleiben in Request und Response unverändert.

| Datei | Rolle |
| --- | --- |
| [`openapi/openapi.yaml`](openapi/openapi.yaml) | Quelle |
| [`openapi/openapi.json`](openapi/openapi.json) | Dieselbe Beschreibung als JSON |
| [`src/generated.ts`](src/generated.ts) | TypeScript-Typen aus dem YAML (`pnpm generate`) |
| [`src/index.ts`](src/index.ts) | Benannte Schema-Typen (`SearchHit`, `FeatureCollection`, …) |

Basis-URL ist umgebungsabhängig. Lokal steht im Dokument `http://localhost:3000` (Backend-`PORT`, Default 3000).

```bash
pnpm --filter @ruehrai/api-contracts test
pnpm --filter @ruehrai/api-contracts build
```

`src/generated.ts` und `openapi/openapi.json` werden aus dem YAML erzeugt. Änderungen am Vertrag gehören ins YAML, danach `pnpm generate`.
