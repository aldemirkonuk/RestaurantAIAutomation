import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  IsIn,
  Min,
  Max,
  MaxLength,
} from "class-validator";

/**
 * DTO for creating a new inventory item
 */
export class CreateInventoryItemDto {
  @ApiProperty({ description: "Wine ID from master library" })
  @IsUUID()
  wineId: string;

  @ApiPropertyOptional({ description: "Provider ID" })
  @IsUUID()
  @IsOptional()
  providerId?: string;

  @ApiProperty({ description: "Initial stock quantity" })
  @IsNumber()
  @Min(0)
  stockLive: number;

  @ApiPropertyOptional({ description: "Cost per bottle in dollars" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPerBottle?: number;

  @ApiPropertyOptional({ description: "Storage location ID" })
  @IsUUID()
  @IsOptional()
  storageLocationId?: string;

  @ApiPropertyOptional({ description: "Notes about the inventory item" })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: "Minimum threshold for alerts" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  thresholdMin?: number;

  @ApiPropertyOptional({ description: "Maximum threshold (par level)" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  thresholdMax?: number;

  @ApiPropertyOptional({ description: "Toast POS menu item GUID" })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  toastItemGuid?: string;

  @ApiPropertyOptional({ description: "Sale type: bottle, glass, or both" })
  @IsOptional()
  @IsIn(["bottle", "glass", "both"])
  saleType?: "bottle" | "glass" | "both";

  @ApiPropertyOptional({ description: "Pour size in ml" })
  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(500)
  pourSizeMl?: number;

  @ApiPropertyOptional({ description: "Menu price per glass" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  menuPriceGlass?: number;

  @ApiPropertyOptional({ description: "Bottle size in ml (override)" })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(18000)
  bottleSizeMl?: number;

  @ApiPropertyOptional({ description: "Glasses per bottle override" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  glassesPerBottleOverride?: number;
}

/**
 * DTO for updating an inventory item
 */
export class UpdateInventoryItemDto {
  @ApiPropertyOptional({ description: "Provider ID" })
  @IsUUID()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional({ description: "Current stock quantity" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  stockLive?: number;

  @ApiPropertyOptional({ description: "Shadow stock (unrecorded)" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  shadowStock?: number;

  @ApiPropertyOptional({ description: "Minimum threshold for alerts" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  thresholdMin?: number;

  @ApiPropertyOptional({ description: "Maximum threshold (par level)" })
  @IsNumber()
  @Min(0)
  @IsOptional()
  thresholdMax?: number;

  @ApiPropertyOptional({ description: "Toast POS menu item GUID" })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  toastItemGuid?: string;

  @ApiPropertyOptional({ description: "Is item active" })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "Sale type: bottle, glass, or both" })
  @IsOptional()
  @IsIn(["bottle", "glass", "both"])
  saleType?: "bottle" | "glass" | "both";

  @ApiPropertyOptional({ description: "Pour size in ml" })
  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(500)
  pourSizeMl?: number;

  @ApiPropertyOptional({ description: "Menu price per glass" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  menuPriceGlass?: number;

  @ApiPropertyOptional({ description: "Bottle size in ml (override)" })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(18000)
  bottleSizeMl?: number;

  @ApiPropertyOptional({ description: "Glasses per bottle override" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  glassesPerBottleOverride?: number;
}

/**
 * DTO for mapping Toast item to inventory
 */
export class MapToastItemDto {
  @ApiProperty({ description: "Inventory item ID to map" })
  @IsUUID()
  inventoryId: string;

  @ApiProperty({ description: "Toast POS menu item GUID" })
  @IsString()
  @MaxLength(100)
  toastItemGuid: string;
}

/**
 * DTO for bulk mapping Toast items
 */
export class BulkMapToastItemsDto {
  @ApiProperty({
    description: "Array of inventory ID to Toast GUID mappings",
    type: [MapToastItemDto],
  })
  mappings: MapToastItemDto[];
}

/**
 * Response DTO for inventory item
 */
export class InventoryItemResponseDto {
  @ApiProperty({ description: "Inventory item ID" })
  id: string;

  @ApiProperty({ description: "Restaurant ID" })
  restaurantId: string;

  @ApiProperty({ description: "Wine ID from master library" })
  wineId: string;

  @ApiPropertyOptional({ description: "Provider ID" })
  providerId?: string;

  @ApiProperty({ description: "Current live stock" })
  stockLive: number;

  @ApiPropertyOptional({ description: "Physical count (last manual)" })
  physicalStock?: number;

  @ApiPropertyOptional({ description: "Shadow stock" })
  shadowStock?: number;

  @ApiProperty({ description: "Minimum threshold" })
  thresholdMin: number;

  @ApiProperty({ description: "Maximum threshold (par)" })
  thresholdMax: number;

  @ApiPropertyOptional({ description: "Toast POS menu item GUID" })
  toastItemGuid?: string;

  @ApiProperty({ description: "Is item active" })
  isActive: boolean;

  @ApiProperty({ description: "Created timestamp" })
  createdAt: string;

  @ApiProperty({ description: "Updated timestamp" })
  updatedAt: string;

  // Joined fields (from view or query)
  @ApiPropertyOptional({ description: "Wine name" })
  wineName?: string;

  @ApiPropertyOptional({ description: "Wine producer" })
  wineProducer?: string;

  @ApiPropertyOptional({ description: "Wine vintage" })
  wineVintage?: number;

  @ApiPropertyOptional({ description: "Provider name" })
  providerName?: string;

  // Volume/measurement fields
  @ApiPropertyOptional({ description: "Bottle size in ml" })
  bottleSizeMl?: number;

  @ApiPropertyOptional({ description: "Bottle size in oz (computed)" })
  bottleSizeOz?: number;

  @ApiPropertyOptional({ description: "Sale type: bottle, glass, or both" })
  saleType?: "bottle" | "glass" | "both";

  @ApiPropertyOptional({ description: "Pour size in ml" })
  pourSizeMl?: number;

  @ApiPropertyOptional({ description: "Pour size in oz (computed)" })
  pourSizeOz?: number;

  @ApiPropertyOptional({ description: "Menu price per glass" })
  menuPriceGlass?: number;

  @ApiPropertyOptional({
    description: "Glasses per bottle (computed or override)",
  })
  glassesPerBottle?: number;

  @ApiPropertyOptional({ description: "Glasses per bottle override" })
  glassesPerBottleOverride?: number;
}

/**
 * Response DTO for inventory summary
 */
export class InventorySummaryResponseDto {
  @ApiProperty({ description: "Total number of inventory items" })
  totalItems: number;

  @ApiProperty({ description: "Total bottles across all items" })
  totalBottles: number;

  @ApiProperty({ description: "Number of low stock items" })
  lowStockCount: number;

  @ApiProperty({ description: "Number of out of stock items" })
  criticalCount: number;

  @ApiProperty({ description: "Number of healthy stock items" })
  healthyCount: number;

  @ApiPropertyOptional({ description: "Number of items mapped to Toast" })
  toastMappedCount?: number;

  @ApiPropertyOptional({ description: "Number of items not mapped to Toast" })
  toastUnmappedCount?: number;
}

/**
 * Response DTO for unmapped Toast items
 */
export class UnmappedToastItemResponseDto {
  @ApiProperty({ description: "Inventory item ID" })
  inventoryId: string;

  @ApiProperty({ description: "Restaurant ID" })
  restaurantId: string;

  @ApiProperty({ description: "Restaurant name" })
  restaurantName: string;

  @ApiProperty({ description: "Wine name" })
  wineName: string;

  @ApiPropertyOptional({ description: "Wine producer" })
  wineProducer?: string;

  @ApiPropertyOptional({ description: "Wine vintage" })
  wineVintage?: number;

  @ApiProperty({ description: "Current stock" })
  currentStock: number;

  @ApiProperty({ description: "Is item active" })
  isActive: boolean;

  @ApiProperty({ description: "Created timestamp" })
  createdAt: string;
}
