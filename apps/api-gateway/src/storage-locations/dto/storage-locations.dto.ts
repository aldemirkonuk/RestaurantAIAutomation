import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  MaxLength,
} from "class-validator";

/**
 * An owner or manager assigns, or withdraws, one staff member's right to set
 * up this house's zones (ADR 0238, the founder 2026-09-29: "managers/owners+
 * the people they assign").
 */
export class SetZoneSetupAccessDto {
  @ApiProperty({
    description:
      "true = this staff member may create, rename, resize and delete zones; false = withdrawn.",
  })
  @IsBoolean()
  allowed!: boolean;
}

/**
 * F-1332. The zone form's humidity is the one fact storage_locations can hold
 * about it, a yes/no (humidity_controlled), so these are the only two words
 * the gateway takes, and the same two the read answers. The form's free-text
 * "Description" is gone: full_location is rewritten from the zone name by a
 * trigger on every write, so a typed description had nowhere to live.
 */
export const HUMIDITY_WORDS = ["Controlled", "None"] as const;

/**
 * DTO for creating a new storage location
 */
export class CreateStorageLocationDto {
  @ApiProperty({ description: "Location name" })
  @IsString()
  @MaxLength(255)
  name: string;

  /**
   * REQUIRED. `storage_locations.capacity_bottles` is NOT NULL, so an omitted
   * capacity used to be silently recorded as 100 — a number nobody measured,
   * sitting under the cellar map's fill-bar percentage. ADR 0051: the surface
   * shows what was recorded, so recording requires someone to record it.
   */
  @ApiProperty({ description: "Capacity in bottles" })
  @IsNumber()
  @IsInt()
  @Min(1)
  capacity: number;

  @ApiPropertyOptional({
    description: "Temperature setting (e.g. 13°C). Stored in temperature_zone.",
  })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  temperature?: string;

  @ApiPropertyOptional({
    description:
      "Whether the zone's humidity is controlled. Stored in humidity_controlled.",
    enum: HUMIDITY_WORDS,
  })
  @IsIn(HUMIDITY_WORDS)
  @IsOptional()
  humidity?: (typeof HUMIDITY_WORDS)[number];

  @ApiPropertyOptional({ description: "Notes" })
  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * `null` means "no parent" (top level) and is how the web clears one
   * (@IsOptional lets null through). Stored in storage_locations.parent_id
   * (migration 20261203110000); the service refuses another restaurant's
   * zone, the zone itself, and a cycle with a 422.
   */
  @ApiPropertyOptional({
    description: "Parent location ID for hierarchy (null = no parent)",
    nullable: true,
  })
  @IsUUID()
  @IsOptional()
  parent_id?: string | null;

  @ApiPropertyOptional({ description: "Hex color for UI (e.g. #be123c)" })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: "Location type (e.g. cellar, bar)" })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  location_type?: string;
}

/**
 * DTO for updating a storage location
 */
export class UpdateStorageLocationDto {
  @ApiPropertyOptional({ description: "Location name" })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: "Capacity in bottles" })
  @IsNumber()
  @IsInt()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ description: "Current count (bottles)" })
  @IsNumber()
  @IsInt()
  @Min(0)
  @IsOptional()
  current_count?: number;

  @ApiPropertyOptional({
    description: "Temperature setting (e.g. 13°C). Stored in temperature_zone.",
  })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  temperature?: string;

  @ApiPropertyOptional({
    description:
      "Whether the zone's humidity is controlled. Stored in humidity_controlled.",
    enum: HUMIDITY_WORDS,
  })
  @IsIn(HUMIDITY_WORDS)
  @IsOptional()
  humidity?: (typeof HUMIDITY_WORDS)[number];

  @ApiPropertyOptional({ description: "Notes" })
  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * `null` means "no parent" (top level) and is how the web clears one
   * (@IsOptional lets null through). Stored in storage_locations.parent_id
   * (migration 20261203110000); the service refuses another restaurant's
   * zone, the zone itself, and a cycle with a 422.
   */
  @ApiPropertyOptional({
    description: "Parent location ID for hierarchy (null = no parent)",
    nullable: true,
  })
  @IsUUID()
  @IsOptional()
  parent_id?: string | null;

  @ApiPropertyOptional({ description: "Hex color for UI" })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: "Location type" })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  location_type?: string;
}

/**
 * DTO for assigning a wine to a location
 */
export class AssignWineToLocationDto {
  @ApiProperty({ description: "Wine ID (from master library or external)" })
  @IsString()
  wineId: string;

  @ApiProperty({ description: "Storage location ID" })
  @IsUUID()
  locationId: string;

  @ApiPropertyOptional({ description: "Quantity", default: 1 })
  @IsNumber()
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;
}
