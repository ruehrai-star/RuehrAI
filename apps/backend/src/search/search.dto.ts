import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

function emptyToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class SearchQueryDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(["address", "ags", "plz"])
  type?: "address" | "ags" | "plz";

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(/^\d{2,8}$/)
  ags?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(/^\d{5}(\d{3})?$/)
  plz?: string;
}
