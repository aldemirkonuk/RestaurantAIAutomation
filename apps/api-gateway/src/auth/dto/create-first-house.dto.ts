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

  /**
   * The browser's own zone (`Intl.DateTimeFormat().resolvedOptions()
   * .timeZone`). `AuthService.createFirstHouse` re-validates it against
   * `Intl` (`resolveSignUpTimezone`, `sign-up-timezone.ts`) and stores NULL
   * for anything absent or not a real IANA identifier (item 62, 2026-09-27).
   */
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
