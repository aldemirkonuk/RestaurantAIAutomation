import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Headers,
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
import {
  HouseTimeZoneService,
  type HouseTimeZoneReadout,
} from "./house-time-zone.service";
import {
  HouseToneScoringService,
  type HouseToneScoringReadout,
} from "./house-tone-scoring.service";
import { SetHouseTimeZoneDto } from "./dto/house-time-zone.dto";
import { SetHouseToneScoringDto } from "./dto/house-tone-scoring.dto";
import {
  HouseDataTermsService,
  type DataTermsReadout,
} from "./data-terms/house-data-terms.service";
import { AcceptDataTermsDto } from "./dto/house-data-terms.dto";

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
    private readonly houseTimeZone: HouseTimeZoneService,
    private readonly houseToneScoring: HouseToneScoringService,
    private readonly houseDataTerms: HouseDataTermsService,
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

  /* ── The clock this house keeps ──────────────────────────────────────
   *
   * THE FOUNDER, 2026-09-21: *"Add it to Settings"*. The vendor scorecard reads
   * every on-time verdict against midnight at the end of the expected day ON
   * THE HOUSE'S CLOCK (ADR 0207 question 6), from `restaurants.timezone` — a
   * column no person could write. A house that has not stated one keeps the
   * span rule (a landing within a day of midnight is listed, not counted).
   */

  @Get("time-zone")
  @ApiOperation({
    summary: "The house's time zone, and who last stated it",
    description:
      "`zone: null` means nobody has stated one — the on-time line then counts only a verdict that holds in every zone. `unreadZone` is a value in the column this server cannot resolve, kept verbatim and never read as a zone. `readable: false` means the row could not be READ, which is a different state and says so in words.",
  })
  @ApiResponse({ status: 200, description: "The time-zone readout" })
  async getHouseTimeZone(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<HouseTimeZoneReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no time zone to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseTimeZone.read(restaurantId);
  }

  @Put("time-zone")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "State the house's time zone — owner or manager only",
    description:
      "The zone must be an IANA name this server's `Intl` lists (`Europe/Istanbul`, `America/Los_Angeles`, or `UTC`); abbreviations, offsets and misspellings are refused with a sentence. The write is explicit: no zone is ever derived or written here. The response carries `audited` and `auditReason`.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not an owner or manager of this restaurant. The clock every on-time verdict is read on is not a per-person setting.",
  })
  async setHouseTimeZone(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseTimeZoneDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseTimeZoneReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "state the time zone this restaurant keeps",
    );
    return this.houseTimeZone.write(restaurantId, dto?.zone, userId);
  }

  /* ── Whether Jev reads this house's vendor mail ───────────────────────
   *
   * THE FOUNDER, 2026-09-21: *"this feature can also be disabled"*; the mail
   * leaves *"Only with names removed"*. Off by default (ADR 0207).
   */

  @Get("vendor-tone-scoring")
  @ApiOperation({
    summary: "Whether Jev reads this house's vendor mail, and who last set it",
    description:
      "`enabled: false` is the default: nothing is sent. `readable: false` means the row could not be read, and is never reported as off.",
  })
  async getHouseToneScoring(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<HouseToneScoringReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is nothing to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseToneScoring.read(restaurantId);
  }

  @Put("vendor-tone-scoring")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Turn Jev's reading of vendor mail on or off — owner only, and only with the data terms accepted",
    description:
      "On, this house's inbound vendor mail is sent to Jev (TypeSafe) with emails, phone numbers, person names and sensitive topics removed first, and scored on a point scale kept as internal data; the vendor sheet shows one word per message. Off, nothing is sent and the sheet reads the inbound model's existing label. Audited. ADR 0207 round 4: owner only (was owner or manager) — turning this on is folded into accepting the house's data terms (`POST /settings/data-terms/acceptances`), which is the normal way to turn it on for the first time or after a version bump.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not an owner of this restaurant. Sending the house's mail to a third party, under its data terms, is an owner's act.",
  })
  @ApiResponse({
    status: 409,
    description:
      "`enabled: true` was sent, but no owner has accepted the CURRENT version of this house's data terms. Accept them first at `POST /settings/data-terms/acceptances`, or read them at `GET /settings/data-terms`.",
  })
  async setHouseToneScoring(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseToneScoringDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseToneScoringReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    // ADR 0207 round 4 — owner only (was owner or manager). Turning Jev on is
    // an owner accepting the house's complete data terms; turning it off
    // needs no such acceptance and stays as easy as it was.
    await this.houseDataTerms.assertOwner(
      userId,
      restaurantId,
      "decide whether Jev reads this restaurant's vendor mail",
    );
    if (typeof dto?.enabled !== "boolean") {
      throw new HttpException(
        "Send true to have Jev read this house's vendor mail, or false to stop it. Nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.enabled) {
      const acceptance = await this.houseDataTerms.effectiveAcceptance(
        restaurantId,
      );
      if (!acceptance.ok) {
        throw new HttpException(
          `Whether the data terms have been accepted could not be read (${acceptance.reason}), so nothing was turned on.`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (!acceptance.current) {
        throw new HttpException(
          // Shown to an owner as-is on Settings, so it is written for them,
          // not for a client of the API (the 409 description above names the
          // routes). [Last call, 2026-09-22: this sentence named the routes.]
          "Jev stays off: turning it on means an owner accepting this house's data-and-privacy terms, and no owner has accepted their current version. Nothing was changed.",
          HttpStatus.CONFLICT,
        );
      }
    }
    return this.houseToneScoring.write(restaurantId, dto.enabled, userId);
  }

  /* ── The house's data-and-privacy terms — accepting turns Jev on ──────
   *
   * THE FOUNDER, 2026-09-22, round 6y, verbatim: "owner only, but also we're
   * going to use this as complete data and privacy usage, they have to
   * accept that, and when they do they'd accept the jev too with their names
   * and sensitive topics redacted." (ADR 0207 round 4.)
   */

  @Get("data-terms")
  @ApiOperation({
    summary: "The house's data-and-privacy terms, and who last accepted them",
    description:
      "Any member of the house may read this. `acceptance` is the latest one on record, of any version; `current` is true only when it is of the CURRENT version. A failed read is `readable: false` with its reason, never silently 'not accepted'.",
  })
  async getDataTerms(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<DataTermsReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is nothing to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseDataTerms.read(restaurantId);
  }

  @Post("data-terms/seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal an acceptance has to carry back — owner only",
  })
  async issueDataTermsSealChallenge(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
  ): Promise<{ challenge: string; expiresAt: string }> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was minted.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseDataTerms.issueSealChallenge(restaurantId, userId);
  }

  @Post("data-terms/acceptances")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Accept the house's data terms — owner only, sealed. Turns Jev on.",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner of this restaurant.",
  })
  @ApiResponse({
    status: 409,
    description:
      "`version`/`digest` are not the CURRENT ones — the terms changed while they were being read. Read them again before accepting.",
  })
  async acceptDataTerms(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: AcceptDataTermsDto,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseDataTerms.accept(
      restaurantId,
      userId,
      dto.version,
      dto.digest,
      challenge ?? null,
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
