import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CellarAgingService } from "./cellar-aging.service";
import { CountFreshnessService } from "./count-freshness.service";
import { PurchaseReasonService } from "./purchase-reason.service";
import { RecordPurchaseReasonDto } from "./dto/dashboard-signals.dto";

/**
 * Every route here is guarded. OD-20's lesson (see dashboard.controller.ts) is
 * that an absent decorator is not a decision — TenantGuard fails OPEN by
 * design, so JwtAuthGuard is the only thing standing between an unauthenticated
 * caller and a restaurant's cellar. All three of these payloads are tenant
 * data.
 */

/** Comma-separated query lists, tolerant of whitespace and empties. */
function parseIdList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

function parseLimit(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function rethrow(error: any, fallback: string): never {
  if (error instanceof HttpException) throw error;
  throw new HttpException(
    error?.message || fallback,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

// ===========================================================================

@ApiTags("cellar")
@Controller("cellar")
@UseGuards(JwtAuthGuard)
export class CellarAgingController {
  constructor(private readonly cellarAging: CellarAgingService) {}

  @Get("drink-window/:restaurantId")
  @ApiOperation({
    summary: "Cellar stock ranked by how close it is to the end of its window",
    description:
      "Built entirely from data already held — delivery dates, lots, and the wine catalogue's aging potential. Nobody logs anything for this to work. Ranked by URGENCY, never by dollar value. An item whose window is not knowable returns window: null with a per-item reason and ranks last; a default window is never assumed (ADR 0051). Every window is labelled estimated, because aging potential is a property of the wine in the catalogue rather than a measurement of this bottle. Sales are not read here.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description:
      "Row cap (default 500, max 2000). When the cap is hit, coverage.truncated is true and every coverage count is a floor.",
  })
  @ApiResponse({ status: 200, description: "Drink-window rows plus coverage" })
  async getDrinkWindow(
    @Param("restaurantId") restaurantId: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.cellarAging.getDrinkWindow(restaurantId, {
        limit: parseLimit(limit),
      });
    } catch (error) {
      rethrow(error, "Failed to compute the drink window");
    }
  }
}

// ===========================================================================

@ApiTags("purchase-reasons")
@Controller("purchase-reasons")
@UseGuards(JwtAuthGuard)
export class PurchaseReasonController {
  constructor(private readonly purchaseReasons: PurchaseReasonService) {}

  // Declared before `:restaurantId` so "options" is not swallowed as an id.
  @Get("options")
  @ApiOperation({
    summary: "The five preset chips",
    description:
      "Served from the server so no surface can drift from the decided wording. Tap-once and complete: nothing else is ever required.",
  })
  @ApiResponse({ status: 200, description: "Chip codes and labels" })
  listOptions() {
    return { options: this.purchaseReasons.listOptions() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Record why a purchase was made — at ORDERING",
    description:
      "Refuses once the goods have landed: receiving is chaos and a weeks-later flag cannot recover the intent. restaurant_id and inventory_id are taken from the order row, never from the body, and the order's real status at the moment of capture is stored so a reader can say 'recorded at ordering' and be right.",
  })
  @ApiResponse({ status: 201, description: "The reason as stored" })
  @ApiResponse({
    status: 404,
    description: "Order not found for this restaurant",
  })
  @ApiResponse({ status: 409, description: "The ordering window has closed" })
  async record(@Body() dto: RecordPurchaseReasonDto) {
    try {
      return await this.purchaseReasons.recordReason(dto);
    } catch (error) {
      rethrow(error, "Failed to record the purchase reason");
    }
  }

  @Get(":restaurantId/idle-stock")
  @ApiOperation({
    summary: "Idle stock with its reason attached",
    description:
      "The vendor strip's read. 'Idle' is inventory_analytics.dead_stock — nothing sold in 90 days, or never sold, while stock is on hand. Ordered by how long it has sat, never by dollars. An item with no reason recorded reads as 'no reason recorded'. capitalLocked is a three-way answer: a number, a real 0 meaning nothing is idle, or null meaning idle stock exists but nothing knows what it cost.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Row cap (default 200)",
  })
  @ApiResponse({ status: 200, description: "Idle stock rows plus totals" })
  async idleStock(
    @Param("restaurantId") restaurantId: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.purchaseReasons.getIdleStockWithReasons(restaurantId, {
        limit: parseLimit(limit),
      });
    } catch (error) {
      rethrow(error, "Failed to read idle stock");
    }
  }

  @Get(":restaurantId")
  @ApiOperation({
    summary: "Recorded reasons for this restaurant's inventory items",
    description:
      "Every requested item comes back. An item with no recorded reason returns reason: null and reasonUnknownReason 'no reason recorded' — it is never omitted, so no surface can fall through to a default of its own.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "inventoryIds",
    required: false,
    description:
      "Comma-separated inventory UUIDs. Omitted returns every item that has a reason recorded.",
  })
  @ApiResponse({ status: 200, description: "Per-item reasons" })
  async forItems(
    @Param("restaurantId") restaurantId: string,
    @Query("inventoryIds") inventoryIds?: string,
  ) {
    try {
      const items = await this.purchaseReasons.getReasonsForItems(
        restaurantId,
        parseIdList(inventoryIds),
      );
      return { restaurantId, items };
    } catch (error) {
      rethrow(error, "Failed to read purchase reasons");
    }
  }
}

// ===========================================================================

@ApiTags("counts")
@Controller("counts")
@UseGuards(JwtAuthGuard)
export class CountFreshnessController {
  constructor(private readonly countFreshness: CountFreshnessService) {}

  @Get("freshness/:restaurantId")
  @ApiOperation({
    summary: "When each item was last counted, and what that count changed",
    description:
      "Carries the freshness of every figure derived from a count, plus the before/after the sommelier asked for ('4 days left → corrected to 2 days, because of your count on 8/29'). Attribution is derived from real reconciliation rows: lastCountChangedStock is true when a ledger row is attributable to the last count, false when the count confirmed the number (set_stock_absolute writes no row on a zero delta), and null when the item has never been counted. Where the effect cannot be traced, lastCorrection is null and the surface should say nothing rather than claim credit.",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiQuery({
    name: "inventoryIds",
    required: false,
    description: "Comma-separated inventory UUIDs to narrow to",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description:
      "Row cap (default 500, max 2000). When hit, coverage.truncated is true and the counts are floors.",
  })
  @ApiResponse({
    status: 200,
    description: "Per-item freshness and attribution",
  })
  async freshness(
    @Param("restaurantId") restaurantId: string,
    @Query("inventoryIds") inventoryIds?: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.countFreshness.getCountFreshness(restaurantId, {
        inventoryIds: parseIdList(inventoryIds),
        limit: parseLimit(limit),
      });
    } catch (error) {
      rethrow(error, "Failed to read count freshness");
    }
  }
}
