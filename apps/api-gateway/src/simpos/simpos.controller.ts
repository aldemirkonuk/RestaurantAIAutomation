import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SimposService } from "./simpos.service";
import { ScenarioVerifyService } from "./scenario-verify.service";

/**
 * SimPOS — the fake POS terminal's backend surface (SimPOS testbed plan).
 *
 * Consumed by the SimPOS terminal UI (chrome-free route group, decision C26),
 * never by WineOps pages — SimPOS is a synthetic test fixture, not a WineOps
 * feature. Every write here stays inside SimPOS's own tables; the only way
 * anything crosses into WineOps is the signed webhook fired on check close
 * (decision C25).
 *
 * ---
 *
 * OD-35 — guarded at class level, added 2026-08-25.
 *
 * This controller had no guard and no `@Public()`, and `POST check/:id/close`
 * makes OUR OWN SERVER HMAC-sign a webhook into
 * `/pos-hub/webhook/generic_webhook/:restaurantId` — which the perimeter then
 * trusts, because the signature is genuinely valid. That is a confused deputy,
 * and the deputy depletes stock.
 *
 * Two things the register got wrong, both verified rather than assumed:
 *  - `app.module.ts:89` DOES gate the module on `NODE_ENV !== "production"`,
 *    and the gate works: `GET /api/v1/simpos/<uuid>/catalog` returns 404 in
 *    production while `/api/v1/pos-hub/providers` returns 401, so the app is
 *    routing and this module simply is not loaded there.
 *  - So this was never remotely exploitable in production.
 *
 * It still needed the guard, for a reason the entry did not name: **dev and
 * staging point at the same Supabase instance as production.** An unauthenticated
 * endpoint in a local or preview environment writes to real rows. The sim-tenant
 * check (`slug LIKE 'sim-%'`) bounds the blast radius to sim restaurants; it does
 * not make the surface authenticated.
 */
@ApiTags("simpos")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("simpos/:restaurantId")
export class SimposController {
  constructor(
    private readonly simpos: SimposService,
    private readonly scenarios: ScenarioVerifyService,
  ) {}

  @Post("catalog/seed")
  @ApiOperation({
    summary:
      "Seed simpos_catalog once from the sim restaurant's live inventory",
  })
  @ApiParam({ name: "restaurantId", description: "sim.* restaurant UUID" })
  seedCatalog(@Param("restaurantId") restaurantId: string) {
    return this.simpos.seedCatalogIfEmpty(restaurantId);
  }

  @Get("catalog")
  @ApiOperation({ summary: "List the SimPOS catalog (Menu pane data source)" })
  listCatalog(@Param("restaurantId") restaurantId: string) {
    return this.simpos.listCatalog(restaurantId);
  }

  @Post("catalog")
  @ApiOperation({
    summary: "Edit POS: add, reprice or recategorise a SKU",
    description:
      "Body: { id?, wineName, producer?, vintage?, sizeMl?, price?, category? }. Omit id to create. `price` may be null — a button nobody has priced renders as 'unpriced' rather than at a placeholder figure (ADR 0020). `category` is one of wine/beer/spirit/sake/cider/cocktail/non_alcoholic/food/other; anything else, or absent, stores null and the button is NOT declared wine on the outbound webhook.",
  })
  upsertCatalogItem(
    @Param("restaurantId") restaurantId: string,
    @Body() body: any,
  ) {
    return this.simpos.upsertCatalogItem(restaurantId, {
      id: body.id,
      wineName: body.wineName,
      producer: body.producer,
      vintage: body.vintage,
      sizeMl: body.sizeMl,
      price: body.price ?? null,
      category: body.category ?? null,
    });
  }

  @Delete("catalog/:catalogId")
  @ApiOperation({ summary: "Edit POS: remove a SKU" })
  removeCatalogItem(
    @Param("restaurantId") restaurantId: string,
    @Param("catalogId") catalogId: string,
  ) {
    return this.simpos.removeCatalogItem(restaurantId, catalogId);
  }

  @Get("venue")
  @ApiOperation({
    summary: "The venue's timezone and published hours",
    description:
      "So the terminal and the order log can render times in the RESTAURANT's zone rather than the viewer's, and say when a check rang outside the published hours. Returns `timezone: null` / `operating_hours: null` when the venue has not set them — never a default zone, because rendering a Palo Alto check at 2:20 AM EDT is exactly the defect this answers (ADR 0093 D1).",
  })
  getVenue(@Param("restaurantId") restaurantId: string) {
    return this.simpos.getVenue(restaurantId);
  }

  @Get("tables")
  @ApiOperation({
    summary: "Tables 1-20 strip (decision C29 — visible, disabled, future)",
  })
  listTables(@Param("restaurantId") restaurantId: string) {
    return this.simpos.listTables(restaurantId);
  }

  @Get("check")
  @ApiOperation({
    summary: "The Home pane's current check — open one if none exists",
  })
  getOrCreateOpenCheck(@Param("restaurantId") restaurantId: string) {
    return this.simpos.getOrCreateOpenCheck(restaurantId);
  }

  @Get("orders")
  @ApiOperation({
    summary:
      "Full-page order log: every check ever produced, with lines, Loss total, and webhook status",
    description:
      "Debugging view over SimPOS's own data only — distinct from the cross-cutting WineOps logs timeline. Reached via 'check logs in full page' from the Home tab.",
  })
  listOrders(@Param("restaurantId") restaurantId: string) {
    return this.simpos.listOrders(restaurantId);
  }

  @Get("check/:checkId")
  @ApiOperation({
    summary: "Check detail with lines and the running Loss total",
  })
  getCheck(
    @Param("restaurantId") restaurantId: string,
    @Param("checkId") checkId: string,
  ) {
    return this.simpos.getCheck(restaurantId, checkId);
  }

  @Patch("check/:checkId")
  @ApiOperation({
    summary: "Record the covers, table and server on the open check",
    description:
      "Body: { covers?, tableId?, serverName? }. Every field is optional and every field accepts null — `covers: null` means nobody said how many guests, which is what a check rung without opening a table honestly is, and it reaches pos_checks.covers as NULL rather than 0 (ADR 0105 D5). These three are what made pos_checks.covers/table_id/server_name NULL on 44 of 44 rows on the 2026-09-03 lens run: SimPOS had nowhere to put them.",
  })
  updateCheckContext(
    @Param("restaurantId") restaurantId: string,
    @Param("checkId") checkId: string,
    @Body()
    body: {
      covers?: number | null;
      tableId?: string | null;
      serverName?: string | null;
    },
  ) {
    return this.simpos.updateCheckContext(restaurantId, checkId, body || {});
  }

  @Post("check/:checkId/lines")
  @ApiOperation({
    summary:
      "Add Item: append a catalog SKU (vintage + size already chosen) to the open check",
    description: "Body: { catalogId, qty? }",
  })
  addLine(
    @Param("restaurantId") restaurantId: string,
    @Param("checkId") checkId: string,
    @Body() body: { catalogId: string; qty?: number },
  ) {
    return this.simpos.addLine(
      restaurantId,
      checkId,
      body.catalogId,
      body.qty ?? 1,
    );
  }

  @Patch("lines/:lineId")
  @ApiOperation({
    summary: "Void / comp / discount a line (feeds the Loss indicator)",
    description:
      "Body: { status: 'active'|'voided'|'comped'|'discounted', reason?, discountAmount? }",
  })
  setLineStatus(
    @Param("restaurantId") restaurantId: string,
    @Param("lineId") lineId: string,
    @Body()
    body: {
      status: "active" | "voided" | "comped" | "discounted";
      reason?: string;
      discountAmount?: number;
    },
  ) {
    return this.simpos.setLineStatus(restaurantId, lineId, body.status, {
      reason: body.reason,
      discountAmount: body.discountAmount,
    });
  }

  @Post("check/:checkId/close")
  @ApiOperation({
    summary: "Order: close the check and fire the signed webhook to pos-hub",
    description:
      "Only close deplete real WineOps stock (decision B18) — this is SimPOS's only channel into WineOps (decision C25).",
  })
  closeCheck(
    @Param("restaurantId") restaurantId: string,
    @Param("checkId") checkId: string,
  ) {
    return this.simpos.closeCheck(restaurantId, checkId);
  }

  // ==========================================================================
  // Scenario harness (ADR 0093)
  //
  // The class guard and `assertSimRestaurant` apply here exactly as they do to
  // everything else on this controller: the verifier reads Mudavym tables, so
  // it is bounded to sim tenants for the same reason the terminal is
  // (OD-35 — dev and production share one Supabase instance).
  // ==========================================================================

  @Get("scenarios/runs")
  @ApiOperation({
    summary: "Scenario runs for this sim restaurant, newest first",
    description:
      "Capped at 50. The cap is returned as `cap` and `capped`, and the page renders it as a floor (\u2265), never as a total.",
  })
  listScenarioRuns(@Param("restaurantId") restaurantId: string) {
    return this.scenarios.listRuns(restaurantId);
  }

  @Get("scenarios/runs/:runId")
  @ApiOperation({
    summary: "One scenario run, expectation included",
  })
  getScenarioRun(
    @Param("restaurantId") restaurantId: string,
    @Param("runId") runId: string,
  ) {
    return this.scenarios.getRun(restaurantId, runId);
  }

  @Get("scenarios/runs/:runId/verify")
  @ApiOperation({
    summary: "Compare what the product did against what the scenario expected",
    description:
      "One row per named check with pass / fail / unverifiable. A failed read turns every check that depended on it into `unverifiable` and is listed in `reads` (ADR 0067); an empty expectation is never a pass (ADR 0020).",
  })
  verifyScenarioRun(
    @Param("restaurantId") restaurantId: string,
    @Param("runId") runId: string,
  ) {
    return this.scenarios.verify(restaurantId, runId);
  }

  @Post("scenarios/runs/:runId/sweep")
  @ApiOperation({
    summary: "Run the low-stock edge sweep now",
    description:
      "The cron runs every 2 minutes; this runs it immediately and returns the low-stock notifications raised since the run was posted, each with its `delivery_status` so 'emailed' is a fact on the row (ADR 0093 D5).",
  })
  runScenarioSweep(
    @Param("restaurantId") restaurantId: string,
    @Param("runId") runId: string,
  ) {
    return this.scenarios.runSweep(restaurantId, runId);
  }

  @Post("scenarios/runs/:runId/insights")
  @ApiOperation({
    summary: "Generate and persist insights now",
    description:
      "`candidateTypesAvailable` is an UPPER BOUND on the types with the data to fire, not a count of what this restaurant will receive.",
  })
  runScenarioInsights(@Param("restaurantId") restaurantId: string) {
    return this.scenarios.generateInsights(restaurantId);
  }
}
