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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
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
  CreateAuctionLotRecordDto,
  AuctionLotRecordResponseDto,
} from "./dto/inventory.dto";
import type { RecordSpotCountBody } from "./dto/inventory.dto";
import { AuctionLotRecordsService } from "./auction-lot-records.service";
import { blindCountForStaff } from "./stock-count-result";
import { holdsHouseMoney } from "../procurement/documents/document-money-gate";

/**
 * What the house paid for a wine, on an inventory row: the weighted-average
 * cost (`wac`, per row and per location), the buying prices on the row, and
 * the markup and margin, from which the cost follows once the menu price is
 * known. The menu prices and the market price stay: they are what the floor
 * sells at and what the wine costs anywhere, not what this house paid.
 */
const HOUSE_COST_KEYS = [
  "wac",
  "last_purchase_price",
  "negotiated_price",
  "target_price",
  "max_price",
  "custom_price",
  "margin_percentage",
  "markup_ratio",
  "markupRatio",
] as const;

/**
 * The inventory as this role may read it (F-562). Staff see stock, never
 * money (ADR 0145; the founder's "do not give money ... to the staff"), and
 * hiding the cost on the page alone would not keep it private. A reader who
 * does not hold the house's money (`holdsHouseMoney`) gets every row with its
 * cost keys OMITTED, never nulled: a null `wac` reads as "no cost recorded".
 */
export function inventoryForRole<T extends Record<string, any>>(
  items: T[],
  role: string | null | undefined,
): T[] {
  if (holdsHouseMoney(role ?? null)) return items;
  return items.map((item) => {
    const out: Record<string, any> = { ...item };
    for (const k of HOUSE_COST_KEYS) delete out[k];
    if (Array.isArray(out.locations))
      out.locations = out.locations.map((l: Record<string, any>) => {
        const loc = { ...l };
        delete loc.wac;
        return loc;
      });
    return out as T;
  });
}

/**
 * One item as this role may read it: the same rule as the list above, for
 * every route that answers with a single wine (the drill-down, a Toast lookup
 * and each write that hands the saved item back). Null stays null.
 */
export function inventoryItemForRole<T extends Record<string, any> | null>(
  item: T,
  role: string | null | undefined,
): T {
  if (!item || typeof item !== "object") return item;
  return inventoryForRole([item as Record<string, any>], role)[0] as T;
}

/**
 * Whether a line says what the house paid: a cost (a sample's deliberate $0
 * included) or how the cost was established. A line that leaves both out is
 * received at an unknown cost, which writes no figure (F-312).
 */
function namesACost(line: {
  costPerBottle?: number | null;
  costProvenance?: unknown;
}): boolean {
  return (
    (line.costPerBottle !== undefined && line.costPerBottle !== null) ||
    line.costProvenance !== undefined
  );
}

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
    private readonly auctionLotRecords: AuctionLotRecordsService,
  ) {}

  /**
   * The one gate on every price a route here writes (ADR 0193; founder,
   * 2026-09-21: price edits are owner/manager only, audited, and every price
   * version names who set it). A session naming nobody is refused before the
   * role is even read.
   *
   * What the house paid for a wine is held to the same rule (F-312,
   * 2026-10-08): a cost typed on add or receive, and an auction lot's hammer
   * price, become the wine's cost basis, so they pass here too.
   */
  private async assertMayPrice(
    userId: string | undefined,
    restaurantId: string,
    action = "change a wine's price",
  ) {
    if (!userId) {
      throw new HttpException(
        "This change names the person who made it, and this session names nobody. Nothing was changed.",
        HttpStatus.FORBIDDEN,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      action,
    );
  }

  // ==========================================================================
  // AUCTION LOT RECORDS — an auction lot's own details, kept. Built
  // 2026-09-21 (founder answer 2) closing the gap AuctionLotStart.tsx and
  // inventory.md §9 named 2026-09-06 (ADR 0083). Tenant scope comes from the
  // JWT, never the body or a path param — unlike the rest of this
  // controller, which predates that rule. Declared BEFORE `:restaurantId`
  // below on purpose: Nest/Express match routes in declaration order, and a
  // single dynamic segment there would otherwise swallow GET
  // /inventory/auction-lots as `restaurantId = "auction-lots"`.
  // ==========================================================================

  @Post("auction-lots")
  @ApiOperation({
    summary:
      "Record an auction lot's own details against the stock it produced",
  })
  @ApiResponse({ status: 201, type: AuctionLotRecordResponseDto })
  async createAuctionLotRecord(
    @Body() dto: CreateAuctionLotRecordDto,
    @CurrentUser()
    user: {
      userId: string;
      restaurantId: string;
      name?: string;
      email?: string;
    },
  ): Promise<AuctionLotRecordResponseDto> {
    // A lot's hammer price and premium are what the house paid: owner or
    // manager only, like the cost on the wine it produced (F-312).
    await this.assertMayPrice(
      user.userId,
      user.restaurantId,
      "record what an auction lot cost",
    );
    const recordedByName = (user.name ?? user.email ?? "").trim();
    return this.auctionLotRecords.create(
      user.restaurantId,
      user.userId,
      recordedByName,
      dto,
    );
  }

  @Get("auction-lots")
  @ApiOperation({
    summary: "Every auction lot recorded for one inventory item, newest first",
  })
  @ApiResponse({ status: 200, type: [AuctionLotRecordResponseDto] })
  async listAuctionLotRecords(
    @Query("inventoryId") inventoryId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<AuctionLotRecordResponseDto[]> {
    if (!inventoryId) {
      throw new HttpException(
        "inventoryId is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.auctionLotRecords.listForInventoryItem(
      user.restaurantId,
      inventoryId,
    );
  }

  // ==========================================================================
  // RESEARCH — a house item the wine library does not have (founder,
  // 2026-09-21, ADR 0192's amendment). Read by the /inventory flag. Tenant
  // scope from the JWT, like the auction lots above, and declared before
  // `:restaurantId` for the same routing reason.
  // ==========================================================================

  @Get("research")
  @ApiOperation({
    summary:
      "This house's items the wine library does not have, and where each stands on the research queue",
  })
  async listHouseItemResearch(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    if (!user?.restaurantId) {
      throw new HttpException(
        "Your sign-in names no house, so there is nothing to read.",
        HttpStatus.FORBIDDEN,
      );
    }
    return this.inventoryService.listHouseItemResearch(user.restaurantId);
  }

  // ==========================================================================
  // EVERY HOUSE — the /inventory "Export all locations" read (F-596). The
  // token names one house, so reading `GET /inventory/<other house>` is a
  // tenant violation (assert-tenant-match.ts) and the export always failed for
  // an owner of two houses. This route names no house in its path: it reads
  // the caller's houses from their access rows and, for each one, checks the
  // caller's role in THAT house. Only an owner's or a manager's houses are
  // read; the rest are listed by name as not included. Declared before
  // `:restaurantId` for the same routing reason as the routes above.
  // ==========================================================================

  @Get("across-houses")
  @ApiOperation({
    summary:
      "Inventory of every house the caller owns or manages, for the all-locations export",
  })
  async getInventoryAcrossHouses(@CurrentUser() user: { userId?: string }) {
    if (!user?.userId) {
      throw new HttpException(
        "This sign-in names nobody, so there are no houses to read.",
        HttpStatus.FORBIDDEN,
      );
    }
    const branches = await this.organizations.getBranchesForUser(user.userId);
    const houses: Array<{
      restaurantId: string;
      name: string;
      currency: { code: string | null; readable: boolean };
      items: unknown[];
    }> = [];
    const notIncluded: Array<{ restaurantId: string; name: string }> = [];
    for (const branch of branches) {
      let role: string | null;
      try {
        role = await this.organizations.readRestaurantRole(
          user.userId,
          branch.id,
        );
      } catch {
        // "Could not check" never means "yes", and never quietly drops a house.
        throw new HttpException(
          `Your role at ${branch.name} could not be checked, so nothing was exported. Try again in a moment.`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (role !== "owner" && role !== "manager") {
        notIncluded.push({ restaurantId: branch.id, name: branch.name });
        continue;
      }
      const [currency, items] = await Promise.all([
        this.inventoryService.readHouseCurrency(branch.id),
        this.inventoryService.getRestaurantInventory(branch.id),
      ]);
      houses.push({
        restaurantId: branch.id,
        name: branch.name,
        currency,
        items,
      });
    }
    return { houses, notIncluded };
  }

  @Get(":restaurantId")
  @ApiOperation({ summary: "Get all inventory items for a restaurant" })
  @ApiResponse({ status: 200, description: "Returns all inventory items" })
  @ApiQuery({
    name: "active",
    required: false,
    description:
      "`false` lists the wines marked inactive instead of the active cellar",
  })
  async getRestaurantInventory(
    @Param("restaurantId") restaurantId: string,
    @Query("active") active?: string,
    @CurrentUser() user?: { role?: string | null },
  ) {
    let items: Record<string, any>[];
    try {
      items = await this.inventoryService.getRestaurantInventory(
        restaurantId,
        active !== "false",
      );
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
    return inventoryForRole(items, user?.role);
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
    @CurrentUser() user?: { userId?: string; role?: string | null },
  ) {
    // A price set when the wine is added is a price edit: owner or manager
    // only, and it names the person (founder, 2026-09-21, answers 1 and 5).
    // Checked before anything is written.
    if (dto.menuPriceBottle !== undefined || dto.menuPriceGlass !== undefined) {
      await this.assertMayPrice(user?.userId, restaurantId);
    }
    // A wine's par is the house's low-stock line: an owner's or a manager's
    // too (F-1064, F-1060), checked before anything is written.
    if (dto.thresholdMin !== undefined || dto.thresholdMax !== undefined) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "change a wine's par",
      );
    }
    // So is what the house paid for it (F-312). A wine added with no cost
    // stays open to everyone: its cost is recorded as unknown.
    if (namesACost(dto)) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "set what a wine cost",
      );
    }
    try {
      return inventoryItemForRole(
        await this.inventoryService.createInventoryItem(
          restaurantId,
          dto,
          user?.userId ?? null,
        ),
        user?.role,
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
    // And a line naming a par: on a wine already carried it overwrites that
    // wine's low-stock line (F-1064, F-1060). A line with no par takes the
    // house default on a new wine and leaves a carried one's alone.
    if (
      (dto.items ?? []).some(
        (l) => l.thresholdMin !== undefined || l.thresholdMax !== undefined,
      )
    ) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "change a wine's par",
      );
    }
    if ((dto.items ?? []).some(namesACost)) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "set what a wine cost",
      );
    }
    // ADR 0335 §3, F-1514: opening stock is an owner's or a manager's. Its
    // counts are left out of the month's count variance, so nobody else may
    // book a count as one.
    if (dto.source === "opening_stock") {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "load opening stock",
      );
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
  async getLowStockItems(
    @Param("restaurantId") restaurantId: string,
    @CurrentUser() user?: { role?: string | null },
  ) {
    try {
      // v_low_stock_items selects the buying prices and margin beside the stock.
      const rows = await this.inventoryService.getLowStockItems(restaurantId);
      return rows ? inventoryForRole(rows, user?.role) : rows;
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
    @CurrentUser() user?: { role?: string | null },
  ) {
    try {
      return inventoryItemForRole(
        await this.inventoryService.getInventoryItem(restaurantId, itemId),
        user?.role,
      );
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
    @CurrentUser() user?: { role?: string | null },
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
    return inventoryItemForRole(item, user?.role);
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
    @CurrentUser() user?: { role?: string | null },
  ) {
    try {
      return inventoryItemForRole(
        await this.inventoryService.mapToastItem(restaurantId, dto),
        user?.role,
      );
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
    @CurrentUser() user?: { role?: string | null },
  ) {
    try {
      return inventoryItemForRole(
        await this.inventoryService.unmapToastItem(restaurantId, inventoryId),
        user?.role,
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
    @CurrentUser() user?: { userId?: string; role?: string | null },
  ) {
    // Only an owner or a manager may change the house's own bottle or glass
    // price. Checked before anything in this PATCH is written, so a refused
    // price change does not half-apply the other fields beside it.
    if (dto.menuPriceBottle !== undefined || dto.menuPriceGlass !== undefined) {
      await this.assertMayPrice(user?.userId, restaurantId);
    }
    // A wine's par is the house's low-stock line: an owner's or a manager's
    // too (F-1064, F-1060), checked before anything is written.
    if (dto.thresholdMin !== undefined || dto.thresholdMax !== undefined) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "change a wine's par",
      );
    }
    // Taking a wine off the list or putting it back is the owner's or the
    // manager's call, like removing it (F-633); the service files who did it
    // (F-1416).
    if (dto.isActive !== undefined) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        dto.isActive
          ? "put a wine back on the list"
          : "take a wine off the list",
      );
    }
    try {
      return inventoryItemForRole(
        await this.inventoryService.updateInventoryItem(
          restaurantId,
          itemId,
          dto,
          user?.userId ?? null,
        ),
        user?.role,
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
    @CurrentUser() user?: { userId?: string; role?: string | null },
  ) {
    try {
      return inventoryItemForRole(
        await this.inventoryService.transferStock(
          restaurantId,
          itemId,
          dto,
          user?.userId ?? null,
        ),
        user?.role,
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
      /** F-1731: a pour kept on a phone says how long ago it was tapped. */
      occurredAgoMs?: number;
    },
    @CurrentUser() user?: { userId?: string; role?: string | null },
  ) {
    try {
      const out = await this.inventoryService.recordPour(
        restaurantId,
        itemId,
        dto,
        user?.userId ?? null,
        user?.role ?? null,
      );
      return (
        out && { ...out, item: inventoryItemForRole(out.item, user?.role) }
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
      "ADR 0078: writes a stock_counts row UNCONDITIONALLY through record_stock_count, and applies a stock movement only as a consequence of a non-zero difference. A count that agrees is recorded with variance 0 and a null transactionId — previously it wrote nothing at all, because set_stock_absolute returns NULL on a zero delta and inventory_transactions CHECKs quantity_change <> 0. last_counted_at is still stamped (decision E41), now inside the same transaction. The idempotency key count:{inventoryId}:{clientCountId} (decision E43) now covers the count row as well as the movement, so a retry on flaky signal records one count, not two. F-291: an optional locationId counts that one shelf: the expected figure and the correction are that shelf's lots only. Without it the count is of every shelf at once, as before. F-1544: an optional sessionId makes it a line of that stock-take (a second line for the same item and shelf in one stock-take is held, not posted, and answers held: true); openMl or openTenths counts the open bottles (stored as ml). A stock-take line's answer leaves out the expected figure and the difference for anyone who does not hold the house's money.",
  })
  async recordSpotCount(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() dto: RecordSpotCountBody,
    @CurrentUser() user?: { userId?: string; role?: string | null },
  ) {
    // ADR 0335 §3: only an owner or a manager loads opening stock, and an
    // opening count is left out of the month's count variance.
    if (dto?.opening === true) {
      await this.assertMayPrice(
        user?.userId,
        restaurantId,
        "load opening stock",
      );
    }
    try {
      const out = await this.inventoryService.recordSpotCount(
        restaurantId,
        itemId,
        // ADR 0078 (attribution): performedBy came from the request BODY, so a
        // client could name anyone as the counter. It now comes from the
        // verified JWT and the body field is ignored — an attributed ledger
        // whose attribution is client-asserted is worse than none, because it
        // reads as evidence.
        {
          ...dto,
          opening: dto?.opening === true,
          // F-1524: a cost sent here was typed by a person, whatever the body says.
          costProvenance: "manual",
          performedBy: user?.userId ?? null,
          // ADR 0286: whose word keeps a line older than 72 h is the token's.
          role: user?.role ?? null,
        },
      );
      return (
        out && {
          ...out,
          item: inventoryItemForRole(out.item, user?.role),
          // F-1544: a stock-take is a blind count. What the books expected,
          // and the difference, are the owner's and the manager's (DASH-G6);
          // a spot count's answer is as it was.
          ...(dto?.sessionId && !holdsHouseMoney(user?.role ?? null)
            ? { count: blindCountForStaff(out.count) }
            : {}),
        }
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

  // F-145: a drink 86'd. Any member of the house may mark and end one; the
  // person is the JWT's, never the body's. Each answers the item's open
  // stock-out (or null) and its last ten.
  @Get(":restaurantId/item/:itemId/stock-out")
  @ApiOperation({
    summary: "Whether an item is sold out (86'd), and its recent stock-outs",
  })
  async getStockOuts(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.inventoryService.getStockOuts(restaurantId, itemId);
  }

  @Post(":restaurantId/item/:itemId/stock-out")
  @ApiOperation({ summary: "Mark an item sold out (86), with why" })
  async startStockOut(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() dto: { cause?: string; note?: string | null },
    @CurrentUser() user?: { userId?: string },
  ) {
    return this.inventoryService.startStockOut(
      restaurantId,
      itemId,
      dto ?? {},
      user?.userId ?? null,
    );
  }

  // F-1521: the body names the stock-out the person saw; another open one
  // since is refused with 409, never ended unseen.
  @Post(":restaurantId/item/:itemId/stock-out/end")
  @ApiOperation({ summary: "Bring a sold-out item back" })
  async endStockOut(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @Body() dto?: { stockOutId?: string | null },
    @CurrentUser() user?: { userId?: string },
  ) {
    return this.inventoryService.endStockOut(
      restaurantId,
      itemId,
      user?.userId ?? null,
      dto?.stockOutId ?? null,
    );
  }

  @Delete(":restaurantId/item/:itemId")
  @ApiOperation({
    summary: "Soft delete an inventory item (set is_active = false)",
  })
  @ApiResponse({ status: 200, description: "Item soft-deleted" })
  @ApiResponse({
    status: 403,
    description: "Only managers and owners may remove a wine",
  })
  @ApiResponse({
    status: 409,
    description: "The wine still has bottles on the books",
  })
  async deleteInventoryItem(
    @Param("restaurantId") restaurantId: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user?: { userId?: string },
  ): Promise<{ success: boolean; audited: boolean }> {
    // F-633: removing a wine is an owner/manager act, the same house-role
    // check a price edit runs, and the removal names who did it.
    if (!user?.userId) {
      throw new HttpException(
        "Removing a wine names the person who did it, and this session names nobody. Nothing was removed.",
        HttpStatus.FORBIDDEN,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      restaurantId,
      "remove a wine from inventory",
    );
    try {
      const { audited } = await this.inventoryService.softDeleteItem(
        restaurantId,
        itemId,
        user.userId,
      );
      return { success: true, audited };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to delete inventory item",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
