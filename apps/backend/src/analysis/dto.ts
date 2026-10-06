import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

function emptyToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class AnalysisRunParamsDto {
  @Matches(/^[1-9][0-9]{0,18}$/)
  id!: string;
}

export class AnalysisPatternQueryDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  geoKey?: string;
}

export class CreateAnalysisRunDto {
  /**
   * Catalog key of the marked Zielregion. Optional; omit to keep the previous
   * behaviour (newest saved Zielregion as `input.region`).
   */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  markedTargetRegionGeoKey?: string;

  /**
   * Alias the web client already sends (`JSON.stringify({ geoKey })`).
   * `markedTargetRegionGeoKey` wins when both are set.
   */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  geoKey?: string;
}

/** Body `markedTargetRegionGeoKey`, else body `geoKey`, else `?geoKey=`. */
export function markedTargetRegionFromCreate(
  body?: CreateAnalysisRunDto,
  query?: AnalysisPatternQueryDto,
): string | undefined {
  return body?.markedTargetRegionGeoKey ?? body?.geoKey ?? query?.geoKey;
}
