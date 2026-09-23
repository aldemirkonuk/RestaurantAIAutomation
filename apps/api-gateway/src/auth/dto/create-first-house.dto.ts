import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { ISO_4217_CODES } from "../../common/iso-4217";

export class CreateFirstHouseDto {
  @IsString() restaurantName: string;
  @IsString() address: string;
  @IsString() city: string;
  @IsString() country: string;
  @IsOptional() @IsString() stateProvince?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsEmail() restaurantEmail?: string;
  @IsOptional() @IsString() restaurantPhone?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsIn(ISO_4217_CODES as string[]) currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional() @IsString() googlePlaceId?: string;
}
