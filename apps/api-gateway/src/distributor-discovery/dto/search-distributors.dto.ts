import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Transform, Type } from "class-transformer";

export const DISTRIBUTOR_TYPES = [
  "distributor",
  "importer",
  "wholesaler",
  "winery_direct",
  "broker",
  "other",
] as const;

export const FACET_KINDS = [
  "region",
  "country",
  "varietal",
  "classification",
  "price_band",
  "certification",
  "producer",
] as const;

/** `kind:slug`, e.g. `region:burgundy`. */
const FACET_PATTERN = new RegExp(`^(${FACET_KINDS.join("|")}):[a-z0-9][a-z0-9-]{0,63}$`);

/** Query strings give us `"a"` for one value and `["a","b"]` for several. */
const toArray = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null
    ? undefined
    : Array.isArray(value)
      ? value
      : [value];

const toBool = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null
    ? undefined
    : value === true || value === "true" || value === "1";

/**
 * NOTE: the global ValidationPipe runs with `forbidNonWhitelisted: true`, so any
 * query parameter not declared here is a 400 rather than being ignored. Every
 * new filter must be added to this class.
 *
 * There is deliberately no `restaurantId` field. The global TenantGuard rejects
 * a request whose `restaurantId` disagrees with the JWT, so the service reads it
 * from the authenticated user instead.
 */
export class SearchDistributorsDto {
  @ApiPropertyOptional({ description: "Free-text match on name or wine specialties" })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({
    description:
      "Only vendors legally able to serve this restaurant. Defaults to true; " +
      "set false to also return out-of-territory vendors (flagged may_serve=false).",
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(toBool)
  territoryOnly?: boolean;

  @ApiPropertyOptional({
    description: "Search origin latitude. Defaults to the restaurant's own location.",
  })
  @IsLatitude()
  @IsOptional()
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({ description: "Search origin longitude." })
  @IsLongitude()
  @IsOptional()
  @Type(() => Number)
  lng?: number;

  @ApiPropertyOptional({ description: "Max distance in metres from the origin.", maximum: 5_000_000 })
  @IsInt()
  @Min(100)
  @Max(5_000_000)
  @IsOptional()
  @Type(() => Number)
  radiusM?: number;

  @ApiPropertyOptional({ description: "Viewport south-west longitude." })
  @IsLongitude()
  @IsOptional()
  @Type(() => Number)
  minLng?: number;

  @ApiPropertyOptional({ description: "Viewport south-west latitude." })
  @IsLatitude()
  @IsOptional()
  @Type(() => Number)
  minLat?: number;

  @ApiPropertyOptional({ description: "Viewport north-east longitude." })
  @IsLongitude()
  @IsOptional()
  @Type(() => Number)
  maxLng?: number;

  @ApiPropertyOptional({ description: "Viewport north-east latitude." })
  @IsLatitude()
  @IsOptional()
  @Type(() => Number)
  maxLat?: number;

  @ApiPropertyOptional({
    description: "Vendor types to include. Repeat the param for several.",
    enum: DISTRIBUTOR_TYPES,
    isArray: true,
  })
  @IsArray()
  @IsIn(DISTRIBUTOR_TYPES as unknown as string[], { each: true })
  @IsOptional()
  @Transform(toArray)
  type?: string[];

  @ApiPropertyOptional({
    description:
      "Portfolio facets as `kind:slug` (e.g. `region:burgundy`). Repeat the param " +
      "for several. Values of the same kind are OR'd; different kinds are AND'd.",
    isArray: true,
    example: ["region:burgundy", "varietal:pinot-noir"],
  })
  @IsArray()
  @Matches(FACET_PATTERN, {
    each: true,
    message: "each facet must look like `kind:slug`, e.g. region:burgundy",
  })
  @IsOptional()
  @Transform(toArray)
  facet?: string[];

  @ApiPropertyOptional({ enum: ["distance", "name"], default: "distance" })
  @IsIn(["distance", "name"])
  @IsOptional()
  sort?: "distance" | "name";

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  offset?: number;
}

export class DistributorFacetsDto {
  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  @Transform(toBool)
  territoryOnly?: boolean;

  @ApiPropertyOptional({ enum: DISTRIBUTOR_TYPES, isArray: true })
  @IsArray()
  @IsIn(DISTRIBUTOR_TYPES as unknown as string[], { each: true })
  @IsOptional()
  @Transform(toArray)
  type?: string[];
}
