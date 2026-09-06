import { Injectable, Logger } from "@nestjs/common";
import { AnalyticsService } from "../analytics/analytics.service";
import { InsightGeneratorService } from "../analytics/insights/insight-generator.service";
import { DistributorDiscoveryService } from "../distributor-discovery/distributor-discovery.service";
import { BOOTED_AT, COMMIT_SHA } from "../health/build-provenance";
import { InventoryService } from "../inventory/inventory.service";
import { LogsTimelineService } from "../logs/logs-timeline.service";
import { ProcurementService } from "../procurement/procurement.service";
import { VendorComparisonService } from "../vendor-intel/vendor-comparison.service";
import { ToolPayload } from "./mcp-server.types";

/**
 * The ten read tools, each calling the SAME service the page calls.
 *
 * ---------------------------------------------------------------------------
 * ONE QUERY PATH, NOT TWO
 * ---------------------------------------------------------------------------
 * Nothing in this file touches Supabase. Every method delegates to the service
 * that already owns the read, so an MCP client and the browser cannot disagree
 * about what "low stock" means. The alternative — an MCP-shaped query against
 * the same tables — is how two answers to one question get built, and it is the
 * shape ADR 0013 was written about.
 *
 * The cost, stated: these tools inherit their service's posture exactly,
 * including its defects. `getStored` swallows its own read error and returns
 * `[]` (`analytics/insights/insight-generator.service.ts:299-308`), so
 * `insights.list` CANNOT tell "nothing computed" from "the read failed". That
 * is said in the result rather than hidden by it — see `insights`.
 *
 * ---------------------------------------------------------------------------
 * TENANCY
 * ---------------------------------------------------------------------------
 * Every method takes `restaurantId` as its FIRST parameter and every caller
 * passes the credential's restaurant. No method reads a restaurant id out of
 * the tool arguments, and no tool's `inputSchema` in `tool-catalog.ts` declares
 * one. That is the §7.1 seam closed by construction rather than by a guard:
 * `TenantGuard` fails open when `request.user` is unset, which an MCP request
 * always is, so the façade asserts the tenant itself.
 */
@Injectable()
export class McpToolReadersService {
  private readonly logger = new Logger(McpToolReadersService.name);

  constructor(
    private readonly inventory: InventoryService,
    private readonly procurement: ProcurementService,
    private readonly distributors: DistributorDiscoveryService,
    private readonly prices: VendorComparisonService,
    private readonly analytics: AnalyticsService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly timeline: LogsTimelineService,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  async inventoryList(restaurantId: string): Promise<ToolPayload> {
    const readAt = this.now();
    const items = await this.inventory.getRestaurantInventory(restaurantId);
    const rows = Array.isArray(items) ? items.length : 0;
    return {
      value: { items: items ?? [] },
      provenance: { readAt, rows, source: "InventoryService.getRestaurantInventory" },
    };
  }

  async inventoryLowStock(restaurantId: string): Promise<ToolPayload> {
    const readAt = this.now();
    const items = await this.inventory.getLowStockItems(restaurantId);
    const rows = Array.isArray(items) ? items.length : 0;
    return {
      value: {
        items: items ?? [],
        // The sentence a zero needs. `getLowStockItems` throws on a read error
        // rather than returning [], so an empty list here IS a measurement —
        // and saying which of the two it is, is the whole of §7a.
        note:
          rows === 0
            ? "Nothing is at or under par. This is a measurement: the read completed and returned no rows."
            : null,
      },
      provenance: { readAt, rows, source: "InventoryService.getLowStockItems" },
    };
  }

  async ordersList(
    restaurantId: string,
    args: { status?: string; limit?: number },
  ): Promise<ToolPayload> {
    const readAt = this.now();
    const limit = Math.min(100, Math.max(1, args.limit ?? 25));
    const result = await this.procurement.listOrders(restaurantId, {
      page: 1,
      limit,
      ...(args.status ? { status: args.status } : {}),
    } as never);
    const orders = (result as { orders?: unknown[] })?.orders ?? [];
    return {
      value: result,
      provenance: {
        readAt,
        rows: Array.isArray(orders) ? orders.length : 0,
        source: "ProcurementService.listOrders",
      },
    };
  }

  async ordersGet(restaurantId: string, orderId: string): Promise<ToolPayload> {
    const readAt = this.now();
    // The service takes restaurantId as its own predicate, so an order id from
    // another house comes back as a not-found rather than as another house's
    // order. The refusal is therefore the service's, not a check layered on it.
    const order = await this.procurement.getOrder(restaurantId, orderId);
    if (!order) {
      return {
        value: null,
        reason: `No order ${orderId} belongs to this house. If that id exists, it is another house's and this key cannot read it.`,
        provenance: { readAt, rows: 0, source: "ProcurementService.getOrder" },
      };
    }
    return {
      value: order,
      provenance: { readAt, rows: 1, source: "ProcurementService.getOrder" },
    };
  }

  async vendorsSearch(
    restaurantId: string,
    args: { query?: string; limit?: number },
  ): Promise<ToolPayload> {
    const readAt = this.now();
    const limit = Math.min(100, Math.max(1, args.limit ?? 25));
    const result = await this.distributors.search(restaurantId, {
      limit,
      offset: 0,
      ...(args.query ? { q: args.query } : {}),
    } as never);
    const found = (result as { distributors?: unknown[] })?.distributors ?? [];
    return {
      value: result,
      provenance: {
        readAt,
        rows: Array.isArray(found) ? found.length : 0,
        source: "DistributorDiscoveryService.search",
      },
    };
  }

  async pricesCompare(
    restaurantId: string,
    args: { masterWineId: string; windowDays?: number },
  ): Promise<ToolPayload> {
    const readAt = this.now();
    const comparison = await this.prices.compare({
      masterWineId: args.masterWineId,
      restaurantId,
      ...(args.windowDays ? { windowDays: args.windowDays } : {}),
    });
    const offers =
      (comparison as { vendors?: unknown[]; observations?: unknown[] })
        ?.vendors ??
      (comparison as { observations?: unknown[] })?.observations ??
      [];
    const rows = Array.isArray(offers) ? offers.length : 0;
    if (rows === 0) {
      return {
        value: null,
        reason: `No held price observation for ${args.masterWineId} in this window. That is an absence, not a price of zero — nobody has quoted this bottle to this house within the window read.`,
        provenance: { readAt, rows: 0, source: "VendorComparisonService.compare" },
      };
    }
    return {
      value: comparison,
      provenance: { readAt, rows, source: "VendorComparisonService.compare" },
    };
  }

  async insights(
    restaurantId: string,
    args: { limit?: number; categories?: string[] },
  ): Promise<ToolPayload> {
    const readAt = this.now();
    const stored = await this.insightGenerator.getStored(restaurantId, {
      ...(args.limit ? { limit: Math.min(100, Math.max(1, args.limit)) } : {}),
      ...(args.categories?.length ? { categories: args.categories } : {}),
    });
    const rows = Array.isArray(stored) ? stored.length : 0;

    if (rows === 0) {
      // The honest answer to an ambiguous empty. `getStored` logs its error and
      // returns `[]`, so from out here the two cases are indistinguishable —
      // and the tool says that rather than reporting "no insights", which would
      // be the absence-reported-as-health fault reaching a client.
      return {
        value: null,
        reason:
          "No stored insights came back. This reader cannot tell 'none have been computed' from 'the read failed': the generator logs its own error and returns an empty list " +
          "(analytics/insights/insight-generator.service.ts:299-308). Recomputing would spend, and this server does not spend on a read — ask on /recommendations in Mudavym.",
        provenance: {
          readAt,
          rows: 0,
          source: "InsightGeneratorService.getStored",
        },
      };
    }
    return {
      value: { source: "stored", insights: stored },
      provenance: {
        readAt,
        rows,
        source: "InsightGeneratorService.getStored",
      },
    };
  }

  async financial(
    restaurantId: string,
    args: { labor?: number },
  ): Promise<ToolPayload> {
    const readAt = this.now();
    // No default labor figure is invented. The service's own signature defaults
    // to 0, and 0 is a measurement; passing it silently would make prime cost
    // read as computed-from-zero rather than not-computed. When the caller
    // omits it, the result says so alongside the engine's own answer.
    const hasLabor = typeof args.labor === "number" && Number.isFinite(args.labor);
    const summary = await this.analytics.getFinancialSummary(
      restaurantId,
      hasLabor ? (args.labor as number) : 0,
    );
    return {
      value: {
        ...(summary as Record<string, unknown>),
        laborInput: hasLabor
          ? args.labor
          : null,
        laborNote: hasLabor
          ? null
          : "No labor figure was supplied, so any prime-cost figure below was computed against 0 labor and is a floor, not a prime cost.",
      },
      provenance: {
        readAt,
        rows: 1,
        source: "AnalyticsService.getFinancialSummary",
      },
    };
  }

  async timelineRead(
    restaurantId: string,
    args: { limit?: number; correlationId?: string },
  ): Promise<ToolPayload> {
    const readAt = this.now();
    const result = await this.timeline.getTimeline(restaurantId, {
      ...(args.limit ? { limit: Math.min(200, Math.max(1, args.limit)) } : {}),
      ...(args.correlationId ? { correlationId: args.correlationId } : {}),
    });
    const failed = result.failedSources ?? [];
    return {
      value: {
        ...result,
        // The service already names its failed sources. Restating the
        // CONSEQUENCE is what makes the number usable: a count over a feed with
        // a failed source is a floor and must not be summed as a total.
        completeness:
          failed.length === 0
            ? "complete — every source answered"
            : `FLOOR — ${failed.length} of ${result.sourcesQueried.length} sources failed (${failed.join(", ")}); the events below are what could be read, not what happened`,
      },
      provenance: {
        readAt,
        rows: result.events.length,
        source: "LogsTimelineService.getTimeline",
      },
    };
  }

  /**
   * Which build is answering. No service, no database — the same two constants
   * `LivenessController` returns, imported rather than re-derived, so this tool
   * and `/health/live` can never disagree about which revision is up.
   */
  health(): ToolPayload {
    const readAt = this.now();
    return {
      value: { status: "ok", commit: COMMIT_SHA, bootedAt: BOOTED_AT },
      provenance: { readAt, rows: 1, source: "health/build-provenance" },
    };
  }
}
