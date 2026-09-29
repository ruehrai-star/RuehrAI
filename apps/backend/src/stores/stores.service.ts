import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService, SqlQuery } from "../database/database.service";
import {
  emptyToNull,
  normalizeCoordPair,
  toCoord,
  toIso,
  toRevenue,
  toRevenueParam,
} from "../customer/values";
import { PlaceCatalogService } from "../geo/place-catalog.service";
import { MonthlyRevenueWriteDto, StoreLocationWriteDto } from "./dto";

/** Product window for monthly figures: up to three years. */
export const MAX_REVENUE_MONTHS = 36;

export interface StoreLocation {
  id: string;
  label: string | null;
  street: string;
  postalCode: string;
  city: string;
  countryCode: "DE";
  lon: number | null;
  lat: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyRevenuePoint {
  year: number;
  month: number;
  revenueEur: number | null;
  updatedAt: string;
}

export interface MonthlyRevenueSeries {
  points: MonthlyRevenuePoint[];
}

interface StoreRow {
  id: string;
  label: string | null;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  lon: number | string | null;
  lat: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RevenueRow {
  year: number;
  month: number;
  revenue_eur: string | number | null;
  updated_at: Date | string;
}

const STORE_COLUMNS = `
  id::text AS id,
  label,
  street,
  postal_code,
  city,
  country_code,
  lon,
  lat,
  created_at,
  updated_at
`;

@Injectable()
export class StoresService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: PlaceCatalogService,
  ) {}

  async list(userId: string): Promise<{ stores: StoreLocation[] }> {
    const result = await this.db.query<StoreRow>(
      `SELECT ${STORE_COLUMNS}
       FROM app.store_locations
       WHERE user_id = $1::bigint
       ORDER BY created_at ASC, id ASC`,
      [userId],
    );
    const stores = result.rows.map(toStore);
    await this.fillMissingCoords(stores);
    return { stores };
  }

  async get(userId: string, storeId: string): Promise<StoreLocation> {
    const store = await this.findOwned(this.db.query.bind(this.db), userId, storeId);
    if (!store) throw new NotFoundException("Store not found");
    await this.fillMissingCoords([store]);
    return store;
  }

  async create(userId: string, dto: StoreLocationWriteDto): Promise<StoreLocation> {
    const values = await this.writeValues(dto);
    const result = await this.db.query<StoreRow>(
      `INSERT INTO app.store_locations (
         user_id, label, street, postal_code, city, country_code, lon, lat
       )
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${STORE_COLUMNS}`,
      [userId, ...values],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Store not found");
    return toStore(row);
  }

  async update(
    userId: string,
    storeId: string,
    dto: StoreLocationWriteDto,
  ): Promise<StoreLocation> {
    const values = await this.writeValues(dto);
    const result = await this.db.query<StoreRow>(
      `UPDATE app.store_locations
       SET label = $3,
           street = $4,
           postal_code = $5,
           city = $6,
           country_code = $7,
           lon = $8,
           lat = $9,
           updated_at = now()
       WHERE id = $1::bigint
         AND user_id = $2::bigint
       RETURNING ${STORE_COLUMNS}`,
      [storeId, userId, ...values],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Store not found");
    return toStore(row);
  }

  async delete(userId: string, storeId: string): Promise<void> {
    const result = await this.db.query(
      `DELETE FROM app.store_locations
       WHERE id = $1::bigint
         AND user_id = $2::bigint`,
      [storeId, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new NotFoundException("Store not found");
    }
  }

  async listRevenue(userId: string, storeId: string): Promise<MonthlyRevenueSeries> {
    return this.db.withTransaction(async (query) => {
      const store = await this.findOwned(query, userId, storeId);
      if (!store) throw new NotFoundException("Store not found");
      return { points: await this.readPoints(query, storeId) };
    });
  }

  async putRevenue(
    userId: string,
    storeId: string,
    dto: MonthlyRevenueWriteDto,
  ): Promise<MonthlyRevenueSeries> {
    assertUniqueMonths(dto.points);
    return this.db.withTransaction(async (query) => {
      const store = await this.findOwned(query, userId, storeId);
      if (!store) throw new NotFoundException("Store not found");
      await query(`SELECT pg_advisory_xact_lock($1::bigint)`, [storeId]);
      for (const point of dto.points) {
        await query(
          `INSERT INTO app.store_monthly_revenue (
             store_location_id, year, month, revenue_eur
           )
           VALUES ($1::bigint, $2::smallint, $3::smallint, $4::numeric)
           ON CONFLICT (store_location_id, year, month)
           DO UPDATE SET
             revenue_eur = EXCLUDED.revenue_eur,
             updated_at = now()`,
          [storeId, point.year, point.month, toRevenueParam(point.revenueEur)],
        );
      }
      const count = await query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM app.store_monthly_revenue
         WHERE store_location_id = $1::bigint`,
        [storeId],
      );
      if ((count.rows[0]?.n ?? 0) > MAX_REVENUE_MONTHS) {
        throw new BadRequestException(
          "A store can have at most 36 monthly revenue points",
        );
      }
      return { points: await this.readPoints(query, storeId) };
    });
  }

  async deleteRevenueMonth(
    userId: string,
    storeId: string,
    year: number,
    month: number,
  ): Promise<void> {
    const store = await this.findOwned(this.db.query.bind(this.db), userId, storeId);
    if (!store) throw new NotFoundException("Store not found");
    await this.db.query(
      `DELETE FROM app.store_monthly_revenue
       WHERE store_location_id = $1::bigint
         AND year = $2::smallint
         AND month = $3::smallint`,
      [storeId, year, month],
    );
  }

  private async findOwned(
    query: SqlQuery,
    userId: string,
    storeId: string,
  ): Promise<StoreLocation | undefined> {
    const result = await query<StoreRow>(
      `SELECT ${STORE_COLUMNS}
       FROM app.store_locations
       WHERE id = $1::bigint
         AND user_id = $2::bigint`,
      [storeId, userId],
    );
    const row = result.rows[0];
    return row ? toStore(row) : undefined;
  }

  private async writeValues(dto: StoreLocationWriteDto): Promise<unknown[]> {
    const coords = await this.resolveCoords(dto);
    return [
      emptyToNull(dto.label),
      dto.street.trim(),
      dto.postalCode.trim(),
      dto.city.trim(),
      dto.countryCode ?? "DE",
      coords.lon,
      coords.lat,
    ];
  }

  /** Explicit WGS84 pair is kept. Otherwise the PLZ centroid from the local catalog. */
  private async resolveCoords(
    dto: StoreLocationWriteDto,
  ): Promise<{ lon: number | null; lat: number | null }> {
    const coords = normalizeCoordPair(dto.lon, dto.lat);
    if (coords.lon !== null && coords.lat !== null) return coords;
    const postalCode = dto.postalCode.trim();
    const found = await this.catalog.plzCentroids([postalCode]);
    return found.get(postalCode) ?? coords;
  }

  /**
   * Fills a missing pair from the PLZ catalog and writes that pair onto
   * `app.store_locations`. Create and update still resolve coordinates
   * before insert. A later read persists a hit that those writes missed.
   */
  private async fillMissingCoords(stores: StoreLocation[]): Promise<void> {
    const missing = [
      ...new Set(
        stores.filter((store) => store.lon === null || store.lat === null).map((store) => store.postalCode),
      ),
    ];
    if (missing.length === 0) return;
    const found = await this.catalog.plzCentroids(missing);
    const hits: StoreLocation[] = [];
    for (const store of stores) {
      if (store.lon !== null && store.lat !== null) continue;
      const point = found.get(store.postalCode);
      if (!point) continue;
      store.lon = point.lon;
      store.lat = point.lat;
      hits.push(store);
    }
    if (hits.length === 0) return;
    const saved = await this.db.query<{ id: string; updated_at: Date | string }>(
      `UPDATE app.store_locations AS s
       SET lon = v.lon,
           lat = v.lat,
           updated_at = now()
       FROM unnest($1::bigint[], $2::double precision[], $3::double precision[])
         AS v(id, lon, lat)
       WHERE s.id = v.id
         AND s.lon IS NULL
         AND s.lat IS NULL
       RETURNING s.id::text AS id, s.updated_at`,
      [hits.map((store) => store.id), hits.map((store) => store.lon), hits.map((store) => store.lat)],
    );
    const updatedAt = new Map(saved.rows.map((row) => [row.id, toIso(row.updated_at)]));
    for (const store of hits) {
      const at = updatedAt.get(store.id);
      if (at) store.updatedAt = at;
    }
  }

  private async readPoints(query: SqlQuery, storeId: string): Promise<MonthlyRevenuePoint[]> {
    const result = await query<RevenueRow>(
      `SELECT year, month, revenue_eur::text AS revenue_eur, updated_at
       FROM app.store_monthly_revenue
       WHERE store_location_id = $1::bigint
       ORDER BY year ASC, month ASC`,
      [storeId],
    );
    return result.rows.map((row) => ({
      year: row.year,
      month: row.month,
      revenueEur: toRevenue(row.revenue_eur),
      updatedAt: toIso(row.updated_at),
    }));
  }
}

function assertUniqueMonths(points: { year: number; month: number }[]): void {
  const seen = new Set<string>();
  for (const point of points) {
    const key = `${point.year}-${point.month}`;
    if (seen.has(key)) {
      throw new BadRequestException("Duplicate year and month");
    }
    seen.add(key);
  }
}

function toStore(row: StoreRow): StoreLocation {
  return {
    id: row.id,
    label: row.label,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    countryCode: "DE",
    lon: toCoord(row.lon),
    lat: toCoord(row.lat),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
