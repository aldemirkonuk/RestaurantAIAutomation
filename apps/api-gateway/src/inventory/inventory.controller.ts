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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { OrganizationsService } from "../organizations/organizations.service";
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
  constructor(
    private readonly inventoryService: InventoryService,
    // ADR 0193: a wine's selling price is the manager's to change ("it should
    // be changed whenever the manager wants", founder 2026-09-21). The role
    // is resolved from the house's access rows, not from the token's claim.
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * The one gate on every price a route here writes (ADR 0193; founder,
   * 2026-09-21: price edits are owner/manager only, audited, and every price
   * version names who set it). A session naming nobody is refused before the
   * role is even read.
   */
  private async assertMayPrice(userId: string | undefined, restaurantId: string) {
    if (!userId) {
      throw new HttpException(
        "A price change names the person who made it, and this session names nobody. Nothing was changed.",
        HttpStatus.FORBIDDEN,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "change a wine's price",
    );
  }

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
    @CurrentUser() user?: { userId?: string },
  ) {
    // A price set when the wine is added is a price edit: owner or manager
    // only, and it names the person (founder, 2026-09-21, answers 1 and 5).
    // Checked before anything is written.
    if (dto.menuPriceBottle !== undefined || dto.menuPriceGlass !== undefined) {
      await this.assertMayPrice(user?.userId, restaurantId);
    }
    try {
      return await this.inventoryService.createInventoryItem(
        restaurantId,
        dto,
        user?.userId ?? null,
      );
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
    @CurrentUser() user?: { userId?: string },
  ) {
    // Same rule as one wine: a batch that names any price is an owner's or a
    // manager's, refused whole before any line is received otherwise.
    if (
      (dto.items ?? []).some(
        (l) => l.menuPriceBottle !== undefined || l.menuPriceGlass !== undefined,
      )
    ) {
      await this.assertMayPrice(user?.userId, restaurantId);
    }
    try {
      return await this.inventoryService.bulkCreateInventoryItems(
        restaurantId,
        dto,
        user?.userId ?? null,
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
    @CurrentUser() user?: { userId?: string },
  ) {
    // Only an owner or a manager may change the house's own bottle or glass
    // price. Checked before anything in this PATCH is written, so a refused
    // price change does not half-apply the other fields beside it.
    if (dto.menuPriceBottle !== undefined || dto.menuPriceGlass !== undefined) {
      await this.assertMayPrice(user?.userId, restaurantId);
    }
    try {
      return await this.inventoryService.updateInventoryItem(
        restaurantId,
        itemId,
        dto,
        user?.userId ?? null,
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
    @CurrentUser() user?: { userId?: string },
  ) {
    try {
      return await this.inventoryService.transferStock(
        restaurantId,
        itemId,
        dto,
        user?.userId ?? null,
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
      idempotencyKey?: string | null;
    },
    @CurrentUser() user?: { userId?: string },
  ) {
    try {
      return await this.inventoryService.recordPour(
        restaurantId,
        itemId,
        dto,
        user?.userId ?? null,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to record pour",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/item/:itemId/count")
  @ApiOperation({
    summary:
      "Record a spot count (manual, voice-confirmed, or a confirmed photo proposal)",
    description:
      "ADR 0078: writes a stock_counts row UNCONDITIONALLY through record_stock_count, and applies a stock movement only as a consequence of a non-zero difference. A count that agrees is recorded with variance 0 and a null transactionId — previously it wrote nothing at all, because set_stock_absolute returns NULL on a zero delta and inventory_transactions CHECKs quantity_change <> 0. last_counted_at is still stamped (decision E41), now inside the same transaction. The idempotency key count:{inventoryId}:{clientCountId} (decision E43) now covers the count row as well as the movement, so a retry on flaky signal records one count, not two.",
  })
  async recordSpotCount(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body()
    dto: {
      countedQty: number;
      stockState?: "live" | "shadow";
      clientCountId: string;
      reason?: string;
    },
    @CurrentUser() user?: { userId?: string },
  ) {
    try {
      return await this.inventoryService.recordSpotCount(
        restaurantId,
        itemId,
        // ADR 0078 (attribution): performedBy came from the request BODY, so a
        // client could name anyone as the counter. It now comes from the
        // verified JWT and the body field is ignored — an attributed ledger
        // whose attribution is client-asserted is worse than none, because it
        // reads as evidence.
        { ...dto, performedBy: user?.userId ?? null },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to record spot count",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/item/:itemId/count-photo-estimate")
  @ApiOperation({
    summary:
      "Vision-derived count suggestion from a photo — never writes stock",
    description:
      "Decision E46: photo counting produces a suggestion, never a direct stock write. The response fills the spot-count screen's quantity field, exactly like the voice path (decision E45) — a human still has to review and call POST .../count to commit it.",
  })
  async estimateCountFromPhoto(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() body: { imageBase64: string },
  ) {
    try {
      return await this.inventoryService.estimateCountFromPhoto(
        restaurantId,
        itemId,
        body?.imageBase64 || "",
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to estimate count from photo",
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
