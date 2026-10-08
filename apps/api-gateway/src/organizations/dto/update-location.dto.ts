import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  chainId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /** Billing / restaurant contact email (manager+ only) */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Billing / restaurant contact phone (manager+ only) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /**
   * The house's country (ADR 0289): owners only, checked against the one
   * country table and recorded in the settings log by `updateLocation`.
   * Declared here because `ValidationPipe({ whitelist: true })` strips every
   * key a DTO does not name, silently: until ADR 0289 an owner who sent it
   * got a 200 and no change. Optional so a name-only PATCH stays valid;
   * `null` reaches the service, which refuses it (a country is never
   * cleared).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string | null;

  /**
   * The house's state or province (ADR 0289), sent together with `country`.
   * `null` means none (the whole country), which a United States house may
   * not choose. `restaurants.state_province` is varchar(100).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  stateProvince?: string | null;
}
