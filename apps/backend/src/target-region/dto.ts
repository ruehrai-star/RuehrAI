import { Transform, Type } from "class-transformer";
import {
  Allow,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export const GRAINS = [
  "address",
  "grid100",
  "plz8",
  "plz5",
  "ags",
  "ags5",
  "other",
] as const;

export type Grain = (typeof GRAINS)[number];

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function trimToNull({ value }: { value: unknown }): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export class TargetRegionWriteDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @IsOptional()
  @IsIn(GRAINS)
  grain?: Grain | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  geoKey?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(/^[0-9]{2,8}$/)
  ags?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(/^[0-9]{5}([0-9]{3})?$/)
  plz?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  /**
   * Optional extent. When `geometry` is omitted this becomes a rectangular
   * polygon. A successful PUT always stores bounds. If the body and the
   * catalog still have no area, the write is rejected and the previous row
   * stays unchanged.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatBoundsDto)
  bounds?: LonLatBoundsDto | null;

  /**
   * Optional GeoJSON Polygon or MultiPolygon (EPSG:4326). Validated in the
   * service. When omitted, the catalog polygon is copied, or the interim
   * stub is built around a point. A successful PUT never persists null.
   * Places that are not polygons in `app.map_features` need that catalog
   * polygon (Location-Guide); this DTO does not invent further stub seeds.
   */
  @IsOptional()
  @Allow()
  geometry?: unknown;
}

export class LonLatBoundsDto {
  @IsNumber()
  @Min(-180)
  @Max(180)
  west!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  south!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  east!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  north!: number;
}
