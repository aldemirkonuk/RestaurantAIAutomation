import {
  IsEmail,
  IsString,
  Matches,
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
   * The money this house reports in, ISO 4217 alpha-3, as CONFIRMED on the
   * currency step of the sign-up form.
   *
   * Optional here and NULL in the row when absent — never `USD`. Until
   * 2026-09-05 `restaurants.currency` carried `DEFAULT 'USD'` (baseline:3576)
   * and this insert named no currency key at all, so every house arrived
   * asserting dollars whether or not anybody had been asked: measured on
   * production, `USD` on all fourteen, including two houses in Turkiye and one
   * in London (ADR 0117 Q25). The default is dropped
   * (`20260905120000_a_house_names_its_money.sql`) and the question is asked, so
   * absent must mean absent.
   *
   * The form defaults it from the address's country and shows it as a stated
   * default the manager confirms or changes (ADR 0083: the page says what it
   * will record). Validation is shape only — three capitals. A hardcoded ISO
   * 4217 membership list in the gateway would be a second table to rot, and the
   * codes a manager can pick come from one table in the form
   * (`apps/web/src/lib/currency.ts`), never free text.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: "currency must be an ISO 4217 alpha-3 code in capitals, e.g. TRY.",
  })
  currency?: string;

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
