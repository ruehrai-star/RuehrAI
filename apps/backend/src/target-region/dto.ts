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

  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatBoundsDto)
  bounds?: LonLatBoundsDto | null;

  /** GeoJSON Polygon or MultiPolygon. Validated in the service. */
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
