/**
 * The distributor-connection catalogue endpoint.
 *
 *   GET /distributor-feed/catalog          — every distributor measured
 *   GET /distributor-feed/:jurisdiction    — one state, or 'me' for the caller's
 *
 * Owner/manager, like `/price-index` and `/vendor-intel`: this states the
 * house's buying context and renders on `/connections`, which is already
 * manager-and-owner (ADR 0114).
 *
 * THERE IS NO WRITE ROUTE, AND THAT IS THE DECISION, NOT AN OMISSION. A declare
 * route would take a distributor login, and both Illinois distributors whose
 * terms were read forbid exactly that — Southern Glazer's in the words "agree
 * not to provide any other person with access to this Website … using your
 * username, password, or other security information". Building the box first and
 * asking later is how a product ends up holding credentials it may not use.
 *
 * `catalog` is declared before `:jurisdiction` on purpose — otherwise the word
 * would be captured as a jurisdiction and the route would be unreachable. Same
 * reason `price-index.controller.ts` declares `status` first.
 */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { DistributorFeedService } from "./distributor-feed.service";
import { PriceCodeMappingsService } from "./price-code-mappings.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { FEED_REQUEST_LETTER } from "./feed-request-letter";

@ApiTags("Distributor Feed")
@ApiBearerAuth()
@Controller("distributor-feed")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class DistributorFeedController {
  constructor(
    private readonly service: DistributorFeedService,
    private readonly mappings: PriceCodeMappingsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * What this house has said one sender's price codes mean (ADR 0126 Q3).
   *
   * Read is manager-gated like the writes, and for the same reason ADR 0114
   * gave for `payment_methods`: a read posture and a write posture that
   * disagree is a defect, and these rows name a person and their evidence.
   */
  @Get("codes/:distributorKey")
  @ApiOperation({
    summary:
      "The price-code meanings a manager of this house has stated for one sender, live and withdrawn",
  })
  async codesFor(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Param("distributorKey") distributorKey: string,
  ) {
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      user.restaurantId,
      "read this house's distributor price-code mappings",
    );
    const out = await this.mappings.forSender(user.restaurantId, distributorKey);
    return { success: true, ...out };
  }

  /**
   * A manager states what a code means. Once, with evidence, under their name.
   *
   * There is no default and nothing seeded: until this is called, every priced
   * line under that code is refused as `unmapped_price_basis`, which is the
   * behaviour before this route existed and stays the behaviour after it.
   */
  @Post("codes/:distributorKey")
  @ApiOperation({
    summary:
      "State what one of a sender's price-identifier codes means for this house — recorded against your name, and stamped on every row it admits",
  })
  async declareCode(
    @CurrentUser()
    user: { userId: string; restaurantId: string; fullName?: string; email?: string },
    @Param("distributorKey") distributorKey: string,
    @Body() body: { priceCode?: string; priceBasis?: string; evidence?: string },
  ) {
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      user.restaurantId,
      "state what a distributor price code means",
    );
    const outcome = await this.mappings.declare({
      restaurantId: user.restaurantId,
      distributorKey,
      priceCode: body?.priceCode ?? "",
      priceBasis: body?.priceBasis ?? "",
      evidence: body?.evidence ?? "",
      declaredBy: user.userId,
      // The name AS THE TOKEN CARRIES IT. Never a placeholder: if the session
      // resolves no name the service refuses, because an unsigned attestation
      // is the thing this whole decision exists to avoid.
      declaredByName: (user.fullName ?? user.email ?? "").trim(),
    });
    return { success: outcome.ok, ...outcome };
  }

  /**
   * A manager withdraws a statement.
   *
   * The rows it already admitted are MARKED, never deleted: the foreign key is
   * ON DELETE RESTRICT and the mark is the join to `withdrawn_at`. The count of
   * those rows is returned, because "how far did this go" is the first question
   * anyone asks — and it is `null`, never 0, when it could not be counted.
   */
  @Post("codes/:distributorKey/:mappingId/withdraw")
  @ApiOperation({
    summary:
      "Withdraw a price-code meaning. Nothing is deleted: the rows it admitted keep naming it and are marked by the withdrawal",
  })
  async withdrawCode(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Param("mappingId") mappingId: string,
    @Body() body: { reason?: string },
  ) {
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      user.restaurantId,
      "withdraw a distributor price-code mapping",
    );
    const outcome = await this.mappings.withdraw({
      mappingId,
      restaurantId: user.restaurantId,
      withdrawnBy: user.userId,
      reason: body?.reason ?? "",
    });
    const admitted = await this.mappings.rowsAdmittedBy(mappingId);
    return {
      success: outcome.ok,
      ...outcome,
      rowsAdmitted: admitted.count,
      rowsAdmittedUnreadable: admitted.unreadable,
      note:
        admitted.count === null
          ? "The prices this mapping admitted could not be counted. That is unknown, not none."
          : `${admitted.count} price ${admitted.count === 1 ? "row names" : "rows name"} this mapping. None was deleted; each is now marked by the withdrawal and findable with one query on price_code_mapping_id.`,
    };
  }

  @Get("catalog")
  @ApiOperation({
    summary:
      "Every licensed-distributor connection this register has measured, each with the sentence saying whether it can be connected today",
  })
  catalog() {
    return { success: true, ...this.service.forJurisdiction(null) };
  }

  /**
   * The letter a house sends its distributor asking for an invoice feed.
   *
   * A READ. It returns text for a person to print, complete and sign; there is
   * no route on this gateway that sends it, no address field and no schedule,
   * and the panel says so beside the download. Declared before `:jurisdiction`
   * for the same reason `catalog` is — otherwise the word is captured as a
   * jurisdiction and this route is unreachable.
   */
  @Get("letter")
  @ApiOperation({
    summary:
      "The invoice-feed request letter, for the house to sign on its own letterhead. This product never sends it",
  })
  letter() {
    return { success: true, letter: FEED_REQUEST_LETTER };
  }

  @Get(":jurisdiction")
  @ApiOperation({
    summary:
      "The distributors measured for one jurisdiction — or 'me' for the caller's own house",
  })
  async forJurisdiction(
    @CurrentUser() user: { restaurantId: string },
    @Param("jurisdiction") jurisdiction: string,
  ) {
    if (jurisdiction.toLowerCase() === "me") {
      const result = await this.service.forHouse(user?.restaurantId ?? null);
      return { success: true, ...result };
    }
    return { success: true, ...this.service.forJurisdiction(jurisdiction) };
  }
}
