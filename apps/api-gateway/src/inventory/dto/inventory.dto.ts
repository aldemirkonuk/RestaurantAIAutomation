import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  Min,
  Max,
  MaxLength,
} from "class-validator";

/** Provenances accepted by inventory_lots.cost_provenance (see 20260729120000 migration). */
export const COST_PROVENANCES = [
  "invoice",
  "manual",
  "estimated",
  "sample",
] as const;
export type CostProvenance = (typeof COST_PROVENANCES)[number];

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

  @ApiPropertyOptional({
    description:
      "How the cost was established. 'sample' records a deliberate zero cost (free sample / consignment): the bottles count as stock but are excluded from weighted-average cost.",
    enum: COST_PROVENANCES,
  })
  @IsOptional()
  @IsIn(COST_PROVENANCES as unknown as string[])
  costProvenance?: CostProvenance;

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

  /**
   * The house's own name for this bottle (ADR 0124, the naming rule).
   *
   * The founder, 2026-09-05 (batch 49): "One alias on the item, library
   * immutable." The rule as put to him: "Names are the house's; identity is the
   * library's."
   *
   * This is `restaurant_inventory.wine_name`, which ALREADY EXISTED and which
   * this page already renders (`inventory.service.ts:83` reads
   * `row.wine_name || row.master_wine_library?.name`). NO second column was
   * added: that column is the alias, and until now nothing let a house set it.
   * Measured on production 2026-09-05: present on 180 of 233 rows, 156 distinct
   * values, and 0 of them differ from the library's own name -- the column
   * existed and carried no house-specific value at all.
   *
   * An empty string CLEARS the alias and the row falls back to the library
   * name; it is not a name of "". Nothing here writes to master_wine_library.
   */
  @ApiPropertyOptional({
    description:
      "The house's own display name for this item. Empty clears it and the library name shows instead. Never writes to master_wine_library.",
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  wineName?: string;

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
 * Identity for a wine that may not exist in the Master Library yet. Resolved
 * server-side by exact signature, then normalized name + producer; a Provisional
 * (library_tier 3) row is created when nothing matches.
 */
export class WineDraftDto {
  @ApiProperty({ description: "Wine name as printed on the menu or invoice" })
  @IsString()
  @MaxLength(300)
  name: string;

  @ApiPropertyOptional({ description: "Producer / winery" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  producer?: string;

  @ApiPropertyOptional({ description: "Vintage year; null for non-vintage" })
  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2200)
  vintage?: number | null;

  @ApiPropertyOptional({ description: "Country of origin" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @ApiPropertyOptional({ description: "Region" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;

  @ApiPropertyOptional({ description: "Grape variety" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  grapeVariety?: string;
}

/**
 * One line of a bulk receipt. Supply `wineId` for a known Master Library wine,
 * or `wineDraft` to have the server resolve-or-create one.
 */
export class BulkInventoryLineDto {
  @ApiPropertyOptional({ description: "Master library wine ID" })
  @IsOptional()
  @IsUUID()
  wineId?: string;

  @ApiPropertyOptional({
    description: "Wine identity to resolve-or-create when wineId is unknown",
    type: WineDraftDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WineDraftDto)
  wineDraft?: WineDraftDto;

  @ApiPropertyOptional({ description: "Bottles received on this line" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  stockLive?: number;

  @ApiPropertyOptional({ description: "Cost per bottle in dollars" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPerBottle?: number | null;

  @ApiPropertyOptional({
    description: "Cost provenance; 'sample' for deliberate zero cost",
    enum: COST_PROVENANCES,
  })
  @IsOptional()
  @IsIn(COST_PROVENANCES as unknown as string[])
  costProvenance?: CostProvenance;

  @ApiPropertyOptional({ description: "Storage location ID" })
  @IsOptional()
  @IsUUID()
  storageLocationId?: string | null;

  @ApiPropertyOptional({ description: "Provider ID" })
  @IsOptional()
  @IsUUID()
  providerId?: string | null;

  @ApiPropertyOptional({ description: "Minimum threshold for alerts" })
  @IsOptional()
  @IsInt()
  @Min(0)
  thresholdMin?: number;

  @ApiPropertyOptional({ description: "Maximum threshold (par level)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  thresholdMax?: number;

  @ApiPropertyOptional({ description: "Bottle size in ml (override)" })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(18000)
  bottleSizeMl?: number;

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
}

/**
 * DTO for receiving many wines at once (menu scan, delivery, sample drop).
 */
export class BulkCreateInventoryItemsDto {
  @ApiProperty({
    description: "Lines to receive",
    type: [BulkInventoryLineDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkInventoryLineDto)
  items: BulkInventoryLineDto[];

  @ApiPropertyOptional({
    description: "Where the batch came from, for the audit trail",
    example: "menu_scan",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;

  @ApiPropertyOptional({ description: "Human-readable reason for the ledger" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class BulkInventoryLineResultDto {
  @ApiProperty({ description: "Index of this line in the request array" })
  index: number;

  @ApiProperty({
    description:
      "created = new inventory row; stock_added = quantity appended to an item already carried; reactivated = soft-deleted item revived; failed = see error",
    enum: ["created", "stock_added", "reactivated", "failed"],
  })
  status: "created" | "stock_added" | "reactivated" | "failed";

  @ApiPropertyOptional({ description: "Resulting inventory item ID" })
  inventoryId?: string;

  @ApiPropertyOptional({ description: "Resolved master library wine ID" })
  masterWineId?: string;

  @ApiProperty({ description: "Wine name, for display in the result summary" })
  wineName: string;

  @ApiPropertyOptional({
    description:
      "false when no library match existed, so a Provisional (tier 3) entry was created",
  })
  libraryMatched?: boolean;

  @ApiPropertyOptional({ description: "Library governance tier of the wine" })
  libraryTier?: number | null;

  @ApiPropertyOptional({ description: "Why this line failed" })
  error?: string;
}

export class BulkCreateInventoryResultDto {
  @ApiProperty({ description: "Lines that created a new inventory item" })
  created: number;

  @ApiProperty({ description: "Lines that topped up an existing item" })
  stockAdded: number;

  @ApiProperty({ description: "Lines that revived a soft-deleted item" })
  reactivated: number;

  @ApiProperty({ description: "Lines that failed" })
  failed: number;

  @ApiProperty({ type: [BulkInventoryLineResultDto] })
  results: BulkInventoryLineResultDto[];
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
