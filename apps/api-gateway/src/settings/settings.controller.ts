import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { SettingsService } from "./settings.service";
import {
  HouseCurrencyService,
  type HouseCurrencyReadout,
} from "./house-currency.service";
import {
  HouseCarryingCostService,
  type HouseCarryingCostReadout,
} from "./house-carrying-cost.service";
import {
  ApprovalThresholdsService,
  type ThresholdsReadout,
} from "./approval-thresholds.service";
import { SetApprovalThresholdDto } from "../vendor-terms/dto/vendor-terms.dto";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  FeatureFlagsDto,
  UpdateFeatureFlagsDto,
  CheckFeatureFlagDto,
  FeatureFlagCheckResultDto,
} from "./dto/feature-flags.dto";
import { SetHouseCurrencyDto } from "./dto/house-currency.dto";
import { SetHouseCarryingCostDto } from "./dto/house-carrying-cost.dto";

@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings")
@UseGuards(JwtAuthGuard, TenantGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly organizations: OrganizationsService,
    private readonly houseCurrency: HouseCurrencyService,
    private readonly houseCarryingCost: HouseCarryingCostService,
  ) {}

  @Get("feature-flags")
  @ApiOperation({
    summary: "Get feature flags for current restaurant",
    description: "Returns all feature flags for the authenticated restaurant",
  })
  @ApiResponse({
    status: 200,
    description: "Feature flags retrieved successfully",
    type: FeatureFlagsDto,
  })
  async getFeatureFlags(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.getFeatureFlags(restaurantId);
  }

  @Put("feature-flags")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Update feature flags for current restaurant",
    description:
      "Updates feature flags for the authenticated restaurant. Only provided flags will be updated.",
  })
  @ApiResponse({
    status: 200,
    description: "Feature flags updated successfully",
    type: FeatureFlagsDto,
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not an owner or manager of this restaurant. A switch anybody may flip is not a policy.",
  })
  async updateFeatureFlags(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() updateDto: UpdateFeatureFlagsDto,
    @CurrentUser("userId") userId: string,
  ): Promise<FeatureFlagsDto> {
    // ONE RULE FOR EVERY FLAG (the founder's call, 2026-09-05).
    //
    // Until today this route carried `JwtAuthGuard, TenantGuard` and no role
    // check, while the approval thresholds fifty lines below called
    // `assertCanManageRestaurant`. The two routes govern the same kind of thing
    // — what this house lets the system do without a person — and disagreed
    // about who may say it. Neither consequence was theoretical: any
    // authenticated member could flip `enable_ai_autonomous_send`, which sends
    // AI-written email to a vendor with nobody having read it; and
    // `enable_house_inbox_read` was kept OUT of the DTO for exactly this reason
    // (commit `3925cde6`, ADR 0118 D8-D11), which left the mailbox reader with
    // no way to be switched on by anything at all.
    //
    // The check is the SAME helper the thresholds use
    // (`organizations/organizations.service.ts:192` ->
    // `assertManagerOrOwner:124`), so "may this person manage this house" keeps
    // one implementation and one spec behind it; the refusal is the sentence
    // that helper already writes, so the page prints the server's words rather
    // than a guess of its own.
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "change a feature flag for this restaurant",
    );
    // The author of the change comes from the signed token and nowhere else.
    // `public.users.user_id` — never an `auth.users` id: the two tables are
    // disjoint in this database and `system_audit_log.actor_id` has no FK, so a
    // wrong id would insert cleanly and never resolve to a person.
    return this.settingsService.updateFeatureFlags(restaurantId, updateDto, userId);
  }

  @Get("approval-thresholds")
  @ApiOperation({
    summary: "Who must approve an order above what amount",
    description:
      "The house's own rules, each with who set it and when, plus how often each WOULD have fired over the orders already in the books. `enforcement.enforcedBy` names every code path that consults these rows before an order can be sealed — it is measured, not asserted, so an empty array means nothing enforces them.",
  })
  @ApiResponse({ status: 200, description: "The threshold readout" })
  async getApprovalThresholds(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<ThresholdsReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no policy to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.thresholds.read(restaurantId);
  }

  @Put("approval-thresholds")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set one approval rule — owner or manager only",
    description:
      "`enabled: false` keeps the row and its number, so switching a rule back on does not lose the figure somebody chose. The response carries `audited` and `auditReason` so a change whose audit row failed is visible rather than assumed. Only an owner or a manager of this restaurant may write a rule; anyone else is refused with 403.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not an owner or manager of this restaurant. A limit anybody may raise is not a limit.",
  })
  async setApprovalThreshold(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetApprovalThresholdDto,
    @CurrentUser("userId") userId: string,
  ) {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    // THE ROLE CHECK LIVES HERE, NOT IN THE BROWSER (founder's call,
    // 2026-09-03: "only certain high tier like manager or owner can adjust
    // it"). A ceiling that stops an order from being sealed is worth nothing if
    // the person it stops can raise it; the page also disables the editor, but
    // the page is a courtesy and this line is the rule.
    //
    // `assertCanManageRestaurant` is the existing shape
    // (`organizations/organizations.service.ts:162`), already used by
    // `payment-methods` and `mcp-connections`, so there is one implementation of
    // "may this person manage this house" and one spec behind it.
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "set an approval threshold for this restaurant",
    );
    try {
      return await this.thresholds.write(restaurantId, dto, userId ?? null);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to record the threshold",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* ── The money this house reports in ──────────────────────────────────
   *
   * `CurrencyStep` asks a house being CREATED. Until these two routes existed
   * an EXISTING house had no way to answer at all, and eleven of the fourteen
   * production houses print "currency not recorded" against every money figure
   * with no control anywhere that could change it (ADR 0117 Q25, founder call
   * 2026-09-05). A state the product can be in and cannot be got out of is a
   * missing field, not a copy problem.
   */

  @Get("currency")
  @ApiOperation({
    summary: "The house's reporting currency, and who last stated it",
    description:
      "`code: null` means nobody has stated one — every money figure renders as \"currency not recorded\". `readable: false` means the row could not be READ, which is a different state and says so in words. `country` is returned so the page can offer the default its own country table derives, which is shown as a sentence before anything is recorded; the gateway never derives one and never writes on a read.",
  })
  @ApiResponse({ status: 200, description: "The currency readout" })
  async getHouseCurrency(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<HouseCurrencyReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no currency to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseCurrency.read(restaurantId);
  }

  @Put("currency")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "State the house's reporting currency — owner or manager only",
    description:
      "The code must be ISO 4217 alpha-3 (`^[A-Z]{3}$`), which is exactly what `restaurants_currency_check` allows, so a value this route accepts is a value the database accepts. The write is explicit: no default is ever derived or written here. The response carries `audited` and `auditReason`, so a change whose audit row failed is visible rather than assumed.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not an owner or manager of this restaurant. The money every figure on every screen is stated in is not a per-person setting.",
  })
  async setHouseCurrency(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseCurrencyDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseCurrencyReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    // Same helper, same sentence, as the flags above and the thresholds below.
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "state the currency this restaurant reports in",
    );
    // The author comes from the signed token and nowhere else:
    // `public.users.user_id`, never an `auth.users` id.
    return this.houseCurrency.write(restaurantId, dto?.code, userId);
  }

  /* ── What holding stock costs this house ─────────────────────────────
   *
   * THE FOUNDER, 2026-09-05, batch 59, answering the commodity plan's §12 Q5:
   * *"Twice a year, and the house types its carrying cost."* Measured on 440
   * recorded FAO months, the alert's whole gain is spent by a carrying cost of
   * about one percent a month, and between 0.5 % and 1 % the recommendation
   * flips from "worth having on six series" to "worth having on one". Nothing
   * in this product had ever asked a house for that number, so the alert's
   * money clause is gated on the answer rather than on an invented default.
   */

  @Get("carrying-cost")
  @ApiOperation({
    summary: "What holding stock costs this house, and who last stated it",
    description:
      "`percentPerMonth: null` means nobody has typed one — the commodity alert then says its saving is UNMEASURED and which number is missing, rather than pricing a fire off a figure nobody chose. `readable: false` means the row could not be READ, which is a different state and says so in words. The value is a PERCENT per month: 0.75 is three quarters of one percent.",
  })
  @ApiResponse({ status: 200, description: "The carrying-cost readout" })
  async getHouseCarryingCost(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<HouseCarryingCostReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no carrying cost to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseCarryingCost.read(restaurantId);
  }

  @Put("carrying-cost")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "State what holding stock costs this house — owner or manager only",
    description:
      "The value must be between 0.01 and 25 percent a month, which is exactly what `restaurants_carrying_cost_is_a_plausible_percent` allows, so a value this route accepts is a value the database accepts. Those bounds are a UNITS check: 0.0075 (the fraction spelling) and 75 (percent-a-year typed as percent-a-month) are both refused with a sentence saying which spelling the field wants. The value, the author and the moment are written as one fact and the database's CHECK refuses any two of the three. The response carries `audited` and `auditReason`.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not an owner or manager of this restaurant. What holding stock costs the house is not a per-person setting.",
  })
  async setHouseCarryingCost(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseCarryingCostDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseCarryingCostReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "state what holding stock costs this restaurant",
    );
    // The author comes from the signed token and nowhere else:
    // `public.users.user_id`, never an `auth.users` id.
    return this.houseCarryingCost.write(
      restaurantId,
      dto?.percentPerMonth,
      dto?.basis,
      userId,
    );
  }

  @Post("feature-flags/check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Check one feature flag",
    description:
      "Returns `enabled` alongside `active`. `active: false` means no code reads this flag, so `enabled` describes nothing and must not be shown as a setting.",
  })
  @ApiResponse({
    status: 200,
    description: "Feature flag check result",
    type: FeatureFlagCheckResultDto,
  })
  async checkFeatureFlag(
    @Body() checkDto: CheckFeatureFlagDto,
  ): Promise<FeatureFlagCheckResultDto> {
    const { enabled, active } = await this.settingsService.isFeatureEnabled(
      checkDto.restaurant_id,
      checkDto.feature_name,
    );
    return {
      enabled,
      active,
      feature_name: checkDto.feature_name,
      restaurant_id: checkDto.restaurant_id,
    };
  }

  @Get("feature-flags/:restaurantId")
  @ApiOperation({
    summary: "Get feature flags for a specific restaurant (admin only)",
    description: "Admin endpoint to get feature flags for any restaurant",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant ID" })
  @ApiResponse({
    status: 200,
    description: "Feature flags retrieved successfully",
    type: FeatureFlagsDto,
  })
  async getFeatureFlagsForRestaurant(
    @Param("restaurantId") restaurantId: string,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.getFeatureFlags(restaurantId);
  }
}
