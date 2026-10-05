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
