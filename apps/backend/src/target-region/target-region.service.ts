import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { emptyToNull, normalizeCoordPair, toCoord, toIso } from "../customer/values";
import { Grain, TargetRegionWriteDto } from "./dto";

export interface TargetRegion {
  label: string;
  grain: Grain | null;
  geoKey: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | null;
  lat: number | null;
  updatedAt: string;
}

interface TargetRegionRow {
  label: string;
  grain: Grain | null;
  geo_key: string | null;
  ags: string | null;
  plz: string | null;
  lon: number | string | null;
  lat: number | string | null;
  updated_at: Date | string;
}

const SELECT_REGION = `
  SELECT label, grain, geo_key, ags, plz, lon, lat, updated_at
  FROM app.target_regions
`;

@Injectable()
export class TargetRegionService {
  constructor(private readonly db: DatabaseService) {}

  async get(userId: string): Promise<TargetRegion> {
    const result = await this.db.query<TargetRegionRow>(
      `${SELECT_REGION} WHERE user_id = $1::bigint`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Target region is not set");
    }
    return toRegion(row);
  }

  async put(userId: string, dto: TargetRegionWriteDto): Promise<TargetRegion> {
    const coords = normalizeCoordPair(dto.lon, dto.lat);
    const result = await this.db.query<TargetRegionRow>(
      `INSERT INTO app.target_regions (
         user_id, label, grain, geo_key, ags, plz, lon, lat
       )
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         label = EXCLUDED.label,
         grain = EXCLUDED.grain,
         geo_key = EXCLUDED.geo_key,
         ags = EXCLUDED.ags,
         plz = EXCLUDED.plz,
         lon = EXCLUDED.lon,
         lat = EXCLUDED.lat,
         updated_at = now()
       RETURNING label, grain, geo_key, ags, plz, lon, lat, updated_at`,
      [
        userId,
        dto.label.trim(),
        dto.grain ?? null,
        emptyToNull(dto.geoKey),
        emptyToNull(dto.ags),
        emptyToNull(dto.plz),
        coords.lon,
        coords.lat,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException("Target region is not set");
    }
    return toRegion(row);
  }

  async delete(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM app.target_regions WHERE user_id = $1::bigint`, [
      userId,
    ]);
  }
}

function toRegion(row: TargetRegionRow): TargetRegion {
  return {
    label: row.label,
    grain: row.grain,
    geoKey: row.geo_key,
    ags: row.ags,
    plz: row.plz,
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
    updatedAt: toIso(row.updated_at),
  };
}
