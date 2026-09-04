import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsNumber,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class RegisterRestaurantDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @MinLength(8) password: string;
  @IsString() restaurantName: string;
  @IsString() address: string;
  @IsString() city: string;
  @IsString() country: string;
  @IsOptional() @IsString() stateProvince?: string; // US: "IL", Turkey: "Antalya", UK: "Greater London"
  @IsOptional() @IsString() postalCode?: string; // US: "60601", UK: "SW1A 1AA", TR: "07050"
  @IsOptional() @IsString() neighborhood?: string; // US: "River North", TR: "Konyaaltı", UK: "Mayfair"
  @IsOptional() @IsEmail() restaurantEmail?: string; // restaurant contact email; defaults to owner email
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() cuisineType?: string;
  @IsOptional() @IsString() timezone?: string;

  /**
   * The coordinate of the Google Places selection the sign-up form resolved.
   *
   * Both optional and both validated as real degrees. The service refuses a
   * half-pair rather than storing a longitude with no latitude, and it never
   * substitutes a default: `restaurants.latitude/longitude` NULL means "this
   * house has not asserted a point", which is a state the product renders in
   * words. 0,0 is a legal coordinate in the Gulf of Guinea and is exactly what
   * a defaulted pair would claim.
   *
   * `@Type(() => Number)` is required: the global ValidationPipe runs
   * `transform: true` WITHOUT `enableImplicitConversion` (main.ts), so a numeric
   * JSON field arrives typed but a form-encoded one would not — the same trap
   * that 400'd `?limit=` on the calendar until 2026-09-03.
   */
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

  /** Google's stable id for that place — the key a later backfill can re-ask. */
  @IsOptional() @IsString() googlePlaceId?: string;
}
