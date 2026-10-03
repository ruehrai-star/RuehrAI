# @ruehrai/api-contracts

OpenAPI **v0.6.0** für die RuehrAI-API. Das ist der Vertrag, den Clients konsumieren. `0.2.0` ergänzt Logout, Zielregion, Filialadressen und Monatsumsatz. `0.3.0` ergänzt die Musteranalyse (`/analysis/input`, `/analysis/runs`, `/analysis/pattern`). `0.4.0` ergänzt Top-3-Empfehlungen (`POST /recommendations`, `GET /recommendations`) mit Titel, Ort, Score und deutscher Begründung. `0.5.0` ergänzt Kartenpins und die Zielregion: Filialen liefern WGS84 `lon`/`lat` (PLZ-Schwerpunkt, wenn der Write beide weglässt), die Zielregion liefert `bounds` (west, south, east, north) für `fitBounds` und `geometry` (GeoJSON Polygon/MultiPolygon) für die farbige Fläche. `0.6.0` ersetzt die einzelne Zielregion durch eine Liste: `GET /target-region` liefert `items`, `POST /target-region` hängt einen Katalogort an, `DELETE /target-region/{geoKey}` nimmt einen Ort heraus, `DELETE /target-region` leert die Liste. Es gibt kein `PUT`, das die einzige Zeile überschreibt. `POST /auth/login` und `POST /auth/register` bleiben in Request und Response unverändert.

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
