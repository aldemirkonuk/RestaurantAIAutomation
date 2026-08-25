import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { SimposService } from "./simpos.service";

/**
 * SimPOS — the fake POS terminal's backend surface (SimPOS testbed plan).
 *
 * Consumed by the SimPOS terminal UI (chrome-free route group, decision C26),
 * never by WineOps pages — SimPOS is a synthetic test fixture, not a WineOps
 * feature. Every write here stays inside SimPOS's own tables; the only way
 * anything crosses into WineOps is the signed webhook fired on check close
 * (decision C25).
 */
@ApiTags("simpos")
@Controller("simpos/:restaurantId")
export class SimposController {
  constructor(private readonly simpos: SimposService) {}

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
    summary: "Edit POS: add or reprice a SKU",
    description:
      "Body: { id?, wineName, producer?, vintage?, sizeMl?, price }. Omit id to create.",
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
      price: body.price,
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
}
