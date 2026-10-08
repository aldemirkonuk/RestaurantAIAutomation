import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { ISO_4217_CODES } from "../../common/iso-4217";
import {
  CAP,
  FitsInBytes,
  GOOGLE_PLACE_ID_MAX_BYTES,
  PLACE_ID_TOO_LONG,
} from "../house-opening";

export class CreateFirstHouseDto {
  @IsString() @MaxLength(249, CAP.name) restaurantName: string;
  @IsString() address: string;
  @IsString() @MaxLength(100, CAP.city) city: string;
  @IsString() @MaxLength(100, CAP.country) country: string;
  @IsOptional() @IsString() @MaxLength(100, CAP.state) stateProvince?: string;
  @IsOptional() @IsString() @MaxLength(20, CAP.postal) postalCode?: string;
  @IsOptional()
  @IsString()
  @MaxLength(100, CAP.neighborhood)
  neighborhood?: string;
  @IsOptional() @IsEmail() restaurantEmail?: string;
  @IsOptional()
  @IsString()
  @MaxLength(50, CAP.phone)
  restaurantPhone?: string;

  /**
   * The browser's own zone (`Intl.DateTimeFormat().resolvedOptions()
   * .timeZone`). `AuthService.createFirstHouse` re-validates it against
   * `Intl` (`resolveSignUpTimezone`, `sign-up-timezone.ts`) and stores NULL
   * for anything absent, unrecognised or a bare UTC offset — otherwise `Intl`'s
   * resolved zone name, not the caller's spelling (item 62, 2026-09-27).
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

  @IsOptional()
  @IsString()
  @FitsInBytes(GOOGLE_PLACE_ID_MAX_BYTES, PLACE_ID_TOO_LONG)
  googlePlaceId?: string;
}
