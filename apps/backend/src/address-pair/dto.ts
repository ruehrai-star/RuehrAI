import { Transform, Type } from "class-transformer";
import { IsObject, IsString, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export class AddressInputDto {
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
}

export class AddressPairRequestDto {
  @IsObject()
  @ValidateNested()
  @Type(() => AddressInputDto)
  left!: AddressInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => AddressInputDto)
  right!: AddressInputDto;
}
