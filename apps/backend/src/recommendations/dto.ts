import { Transform } from "class-transformer";
import { IsOptional, Matches } from "class-validator";

function emptyToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class CreateRecommendationsDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(/^[1-9][0-9]{0,18}$/)
  runId?: string;
}
