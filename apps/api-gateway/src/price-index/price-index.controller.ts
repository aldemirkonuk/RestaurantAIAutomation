/**
 * The price-index endpoints.
 *
 *   GET /price-index/status        — per source: when it last fetched, how many
 *                                     rows it holds, and why it is silent.
 *   GET /price-index/:state?product — the labelled index line(s) for one state,
 *                                     for the market box's neighbour panel.
 *
 * Owner/manager, like vendor-intel: this states the house's buying context, and
 * it renders beside the market box which is already owner/manager. The lines it
 * returns are a SEPARATE register (ADR 0111): each carries its class, issuer and
 * date so the caller draws it as its own line and never beside a vendor quote.
 *
 * `status` is declared before `:state` on purpose — otherwise the word "status"
 * would be captured as a jurisdiction and the status route would be unreachable.
 */

import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PriceIndexService } from "./price-index.service";
import { PriceIndexFetchService } from "./price-index-fetch.service";

@ApiTags("Price Index")
@ApiBearerAuth()
@Controller("price-index")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class PriceIndexController {
  constructor(
    private readonly service: PriceIndexService,
    private readonly fetchService: PriceIndexFetchService,
  ) {}

  @Get("status")
  @ApiOperation({
    summary:
      "Per source: last fetch, row count, cadence, and why it is silent (fetch is off by default)",
  })
  async status() {
    const status = await this.service.status();
    // Overlay the in-memory outcome of this process's last attempt, so a run
    // that was refused for staleness says so even before it has written a row.
    const sources = status.sources.map((s) => ({
      ...s,
      lastRun: this.fetchService.lastRunFor(s.key),
    }));
    return { success: true, ...status, sources };
  }

  @Get(":state")
  @ApiOperation({
    summary:
      "The posted-list / index lines for one state — or 'me' for the caller's own house (labelled register, never beside a vendor quote)",
  })
  async forState(
    @CurrentUser() user: { restaurantId: string },
    @Param("state") state: string,
    @Query("product") product?: string,
    @Query("basis") basis?: string,
    @Query("limit") limit?: string,
  ) {
    // 'me' resolves the caller's own house state server-side, so the web (which
    // does not carry state_province) can render the panel with one call.
    if (state.toLowerCase() === "me") {
      const result = await this.service.forHouse(user?.restaurantId ?? null);
      return { success: true, ...result };
    }
    const parsedLimit = limit ? Number(limit) : undefined;
    const result = await this.service.forState(
      state,
      product,
      basis,
      parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
    return { success: true, ...result };
  }
}
