import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SearchQueryDto } from "./search.dto";
import { toContainsPattern } from "./search.util";

export interface SearchHit {
  id: string;
  label: string;
  grain: string;
  lon: number | null;
  lat: number | null;
}

interface PlaceRow {
  id: string;
  label: string;
  grain: string;
  lon: number | string | null;
  lat: number | string | null;
}

@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(query: SearchQueryDto): Promise<{ hits: SearchHit[] }> {
    const result = await this.db.query<PlaceRow>(
      `
      SELECT id, label, grain, lon, lat
      FROM app.search_places
      WHERE ($1::text IS NULL OR ags = $1)
        AND ($2::text IS NULL OR plz = $2)
        AND (
          $3::text IS NULL
          OR address ILIKE $3 ESCAPE '\\'
          OR label ILIKE $3 ESCAPE '\\'
        )
        AND (
          $4::text IS NULL
          OR ($5::text = 'ags' AND ags ILIKE $4 ESCAPE '\\')
          OR ($5::text = 'plz' AND plz ILIKE $4 ESCAPE '\\')
          OR (
            $5::text = 'address'
            AND (
              address ILIKE $4 ESCAPE '\\'
              OR label ILIKE $4 ESCAPE '\\'
            )
          )
          OR (
            $5::text IS NULL
            AND (
              label ILIKE $4 ESCAPE '\\'
              OR COALESCE(ags, '') ILIKE $4 ESCAPE '\\'
              OR COALESCE(plz, '') ILIKE $4 ESCAPE '\\'
              OR COALESCE(address, '') ILIKE $4 ESCAPE '\\'
            )
          )
        )
      ORDER BY label ASC, id ASC
      LIMIT 50
      `,
      [
        query.ags ?? null,
        query.plz ?? null,
        query.address ? toContainsPattern(query.address) : null,
        query.q ? toContainsPattern(query.q) : null,
        query.type ?? null,
      ],
    );

    return {
      hits: result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        grain: row.grain,
        lon: toCoord(row.lon),
        lat: toCoord(row.lat),
      })),
    };
  }
}

function toCoord(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
