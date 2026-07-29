import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { InventoryService } from "./inventory.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  MapToastItemDto,
  BulkMapToastItemsDto,
  BulkCreateInventoryItemsDto,
  BulkCreateInventoryResultDto,
  InventoryItemResponseDto,
  InventorySummaryResponseDto,
  UnmappedToastItemResponseDto,
} from "./dto/inventory.dto";

@ApiTags("inventory")
@Controller("inventory")
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get(":restaurantId")
  @ApiOperation({ summary: "Get all inventory items for a restaurant" })
  @ApiResponse({ status: 200, description: "Returns all inventory items" })
  async getRestaurantInventory(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.inventoryService.getRestaurantInventory(restaurantId);
    } catch (error) {
      const msg =
        error?.message || String(error) || "Failed to fetch inventory";
      this.inventoryService["logger"]?.error?.(
        `getRestaurantInventory failed: ${msg}`,
        error?.stack,
      );
      console.error("[inventory] GET /:restaurantId 500:", msg, error?.stack);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(":restaurantId/items")
  @ApiOperation({ summary: "Create a new inventory item" })
  @ApiResponse({
    status: 201,
    description: "Inventory item created",
    type: InventoryItemResponseDto,
  })
  @ApiResponse({ status: 409, description: "Wine already exists in inventory" })
  async createInventoryItem(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: CreateInventoryItemDto,
  ) {
    try {
      return await this.inventoryService.createInventoryItem(restaurantId, dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to create inventory item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/items/bulk")
  @ApiOperation({
    summary: "Receive many wines at once (menu scan, delivery, sample drop)",
    description:
      "Per-line results keyed by request index; one failed line never aborts the batch. A wine already in inventory has its stock topped up instead of returning 409, and a line carrying wineDraft is resolved against the Master Library (creating a Provisional entry when nothing matches).",
  })
  @ApiResponse({
    status: 201,
    description: "Batch processed — inspect per-line results",
    type: BulkCreateInventoryResultDto,
  })
  async bulkCreateInventoryItems(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: BulkCreateInventoryItemsDto,
  ) {
    try {
      return await this.inventoryService.bulkCreateInventoryItems(
        restaurantId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to receive inventory batch",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/low-stock")
  @ApiOperation({ summary: "Get low stock items" })
  @ApiResponse({ status: 200, description: "Returns low stock items" })
  async getLowStockItems(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.inventoryService.getLowStockItems(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch low stock items",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/item/:itemId")
  @ApiOperation({ summary: "Get single inventory item" })
  @ApiResponse({ status: 200, description: "Returns inventory item details" })
  async getInventoryItem(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
  ) {
    try {
      return await this.inventoryService.getInventoryItem(restaurantId, itemId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch inventory item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/item/:itemId/activity")
  @ApiOperation({
    summary:
      "Depletion activity for one item: 14-day daily series + busy-hours heatmap",
  })
  async getItemActivity(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
  ) {
    try {
      return await this.inventoryService.getItemActivity(restaurantId, itemId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch item activity",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/summary")
  @ApiOperation({ summary: "Get inventory summary statistics" })
  @ApiResponse({ status: 200, type: InventorySummaryResponseDto })
  async getInventorySummary(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.inventoryService.getInventorySummary(restaurantId);
    } catch (error) {
      const msg =
        error?.message || String(error) || "Failed to fetch inventory summary";
      console.error(
        "[inventory] GET /:restaurantId/summary 500:",
        msg,
        error?.stack,
      );
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ==================== Toast Mapping Endpoints ====================

  @Get(":restaurantId/toast/unmapped")
  @ApiOperation({ summary: "Get inventory items without Toast GUID mapping" })
  @ApiResponse({
    status: 200,
    description: "Returns unmapped inventory items",
    type: [UnmappedToastItemResponseDto],
  })
  async getUnmappedItems(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.inventoryService.getUnmappedItems(restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch unmapped items",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/toast/lookup/:toastItemGuid")
  @ApiOperation({ summary: "Find inventory item by Toast item GUID" })
  @ApiParam({ name: "toastItemGuid", description: "Toast POS menu item GUID" })
  @ApiResponse({
    status: 200,
    description: "Returns the mapped inventory item",
    type: InventoryItemResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "No inventory item mapped to this Toast GUID",
  })
  async findByToastGuid(
    @Param("restaurantId") restaurantId: string,
    @Param("toastItemGuid") toastItemGuid: string,
  ) {
    const item = await this.inventoryService.findByToastGuid(
      restaurantId,
      toastItemGuid,
    );
    if (!item) {
      throw new HttpException(
        "Inventory item not found for Toast GUID",
        HttpStatus.NOT_FOUND,
      );
    }
    return item;
  }

  @Post(":restaurantId/toast/map")
  @ApiOperation({ summary: "Map a Toast item GUID to an inventory item" })
  @ApiResponse({ status: 200, description: "Mapping created successfully" })
  @ApiResponse({ status: 404, description: "Inventory item not found" })
  @ApiResponse({
    status: 409,
    description: "Toast GUID already mapped to another item",
  })
  async mapToastItem(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: MapToastItemDto,
  ) {
    try {
      return await this.inventoryService.mapToastItem(restaurantId, dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to map Toast item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/toast/map/bulk")
  @ApiOperation({ summary: "Bulk map Toast items to inventory" })
  @ApiResponse({
    status: 200,
    description: "Returns success/failure counts",
  })
  async bulkMapToastItems(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: BulkMapToastItemsDto,
  ) {
    try {
      return await this.inventoryService.bulkMapToastItems(restaurantId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to bulk map Toast items",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":restaurantId/toast/map/:inventoryId")
  @ApiOperation({ summary: "Remove Toast item mapping from an inventory item" })
  @ApiResponse({ status: 200, description: "Mapping removed successfully" })
  async unmapToastItem(
    @Param("restaurantId") restaurantId: string,
    @Param("inventoryId") inventoryId: string,
  ) {
    try {
      return await this.inventoryService.unmapToastItem(
        restaurantId,
        inventoryId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to unmap Toast item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Update Endpoint ====================

  @Patch(":restaurantId/item/:itemId")
  @ApiOperation({ summary: "Update an inventory item" })
  @ApiResponse({ status: 200, type: InventoryItemResponseDto })
  async updateInventoryItem(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    try {
      return await this.inventoryService.updateInventoryItem(
        restaurantId,
        itemId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to update inventory item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/item/:itemId/transfer")
  @ApiOperation({ summary: "Move bottles of a wine between storage locations" })
  @ApiResponse({ status: 200, type: InventoryItemResponseDto })
  async transferStock(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body()
    dto: {
      fromLocationId?: string | null;
      toLocationId?: string | null;
      qty: number;
      reason?: string;
    },
  ) {
    try {
      return await this.inventoryService.transferStock(
        restaurantId,
        itemId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to transfer stock",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/item/:itemId/pour")
  @ApiOperation({
    summary: "Record by-the-glass pours (POS or manual override)",
  })
  async recordPour(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body()
    dto: {
      pours?: number;
      pourMl?: number | null;
      locationId?: string | null;
      source?: string;
      reason?: string;
    },
  ) {
    try {
      return await this.inventoryService.recordPour(restaurantId, itemId, dto);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to record pour",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":restaurantId/item/:itemId")
  @ApiOperation({
    summary: "Soft delete an inventory item (set is_active = false)",
  })
  @ApiResponse({ status: 200, description: "Item soft-deleted" })
  async deleteInventoryItem(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.inventoryService.softDeleteItem(restaurantId, itemId);
      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to delete inventory item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
