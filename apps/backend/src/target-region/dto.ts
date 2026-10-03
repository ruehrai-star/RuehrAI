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
   * Optional extent. Stored as a rectangular polygon when `geometry` is omitted.
   * Add responds 400 when this, `geometry`, and the catalog are all empty.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatBoundsDto)
  bounds?: LonLatBoundsDto | null;

  /**
   * GeoJSON Polygon or MultiPolygon. Validated in the service.
   * A search place id is not an outline. Add copies Brain `geo` (PLZ, Bezirk,
   * Stadtteil, Ortsteil), then a non-stub `app.map_features` row, then
   * Data-Scout, and never persists null geometry. Bounds and points are not
   * turned into a rectangle. Berlin Bezirk aliases are stored as `1100000N`.
   * A second add of the same catalog key leaves the list unchanged.
   */
  @IsOptional()
  @Allow()
  geometry?: unknown;
}

export class TargetRegionGeoKeyDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  geoKey!: string;
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
