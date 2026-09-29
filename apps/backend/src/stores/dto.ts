import { Transform, Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  registerDecorator,
} from "class-validator";

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function trimToNull({ value }: { value: unknown }): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function upperTrim({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

/** `revenueEur` is required and may be JSON null (month marked missing). */
function IsRevenueEur(object: object, propertyName: string): void {
  registerDecorator({
    name: "isRevenueEur",
    target: object.constructor,
    propertyName,
    validator: {
      validate(value: unknown) {
        if (value === null) return true;
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        if (value < 0 || value > 9_999_999_999.99) return false;
        const fraction = value.toString().split(".")[1];
        return fraction === undefined || fraction.length <= 2;
      },
      defaultMessage() {
        return "revenueEur must be null or a non-negative amount with at most 2 decimal places";
      },
    },
  });
}

export class StoreParamsDto {
  @Matches(/^[1-9][0-9]{0,18}$/)
  id!: string;
}

export class RevenueMonthParamsDto extends StoreParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class StoreLocationWriteDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string | null;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  street!: string;

  @Transform(trimString)
  @Matches(/^[0-9]{5}$/)
  postalCode!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @Transform(upperTrim)
  @Equals("DE")
  countryCode?: string;

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
}

export class MonthlyRevenuePointDto {
  @IsInt()
  @Min(1990)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Allow()
  @IsRevenueEur
  revenueEur!: number | null;
}

export class MonthlyRevenueWriteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(36)
  @ValidateNested({ each: true })
  @Type(() => MonthlyRevenuePointDto)
  points!: MonthlyRevenuePointDto[];
}
