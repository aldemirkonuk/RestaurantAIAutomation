import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  MaxLength,
} from "class-validator";

/**
 * DTO for creating a new storage location
 */
export class CreateStorageLocationDto {
  @ApiProperty({ description: "Location name" })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: "Location description" })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: "Capacity in bottles", default: 100 })
  @IsNumber()
  @IsInt()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional({ description: "Temperature setting (e.g. 55°F)" })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  temperature?: string;

  @ApiPropertyOptional({ description: "Humidity setting (e.g. 70%)" })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  humidity?: string;

  @ApiPropertyOptional({ description: "Notes" })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: "Parent location ID for hierarchy" })
  @IsUUID()
  @IsOptional()
  parent_id?: string;

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

  @ApiPropertyOptional({ description: "Location description" })
  @IsString()
  @IsOptional()
  description?: string;

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

  @ApiPropertyOptional({ description: "Temperature setting (e.g. 55°F)" })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  temperature?: string;

  @ApiPropertyOptional({ description: "Humidity setting (e.g. 70%)" })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  humidity?: string;

  @ApiPropertyOptional({ description: "Notes" })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: "Parent location ID for hierarchy" })
  @IsUUID()
  @IsOptional()
  parent_id?: string;

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
