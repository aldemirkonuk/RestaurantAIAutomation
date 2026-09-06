/**
 * The commodity index-series endpoints.
 *
 *   GET /commodity-index/status  — the register itself: which series exist,
 *                                  whose terms are what, and whether a
 *                                  scheduled reader is armed (it is not).
 *   GET /commodity-index/me      — the series that speak for the caller's own
 *                                  house, each with its newest observation and
 *                                  the house items a person mapped to it.
 *
 * Owner/manager, exactly like `/price-index`: this states the house's buying
 * context and it renders inside that register's own box on `/notifications`.
 *
 * `status` is declared before `me` for the reason `PriceIndexController` gives:
 * a literal segment that could be captured by a parameter route must come
 * first. There is no `:series` route here at all — a caller who could name any
 * series would be reading another house's register scoping for free, and
 * nothing on the page needs it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WRITES, ADDED 2026-09-05 ON THE FOUNDER'S ANSWERS TO Q3 AND Q5
 * ─────────────────────────────────────────────────────────────────────────────
 * Two acts, and they are gated by DIFFERENT things for a measured reason.
 *
 *   ARMING a series      `admin/series/:key/{proposal,arm,disarm,history}`
 *                        A Mudavym admin's act, gated by `ServiceKeyGuard` —
 *                        the X-Admin-Key credential ADR 0099 settled, and the
 *                        same shape the experiment report's `winner` route
 *                        uses. NOT a new role: `RolesGuard` knows owner,
 *                        manager and staff, all three of which are roles WITHIN
 *                        a house, and arming a series arms it for every house.
 *
 *   ASSERTING an exposure `exposures`, `exposures/:id/retire`
 *                        An owner's or a manager's act about their OWN item, so
 *                        it is JWT + role gated like everything else here, and
 *                        SEALED through the tenant seal store.
 *
 * `@Public()` on the admin routes does NOT mean unauthenticated. Nest runs
 * class guards before method guards and requires all of them, so a method guard
 * can only ADD to the class-level `JwtAuthGuard`. `@Public()` short-circuits the
 * JWT check so that `ServiceKeyGuard` — which FAILS CLOSED on an unset or empty
 * `ADMIN_API_KEY` — is what actually decides. Same shape as
 * `POST /communications/email` and `POST /ux/experiments/:key/winner`.
 *
 * TENANCY. `restaurantId` on the exposure routes is ALWAYS taken from the
 * authenticated principal and never from the body, so a manager cannot map
 * another house's item. The admin routes carry no tenant at all, by design:
 * `ServiceKeyGuard` authenticates a machine and its own header says a route
 * using it must derive neither a user nor a tenant from `request.user`.
 */

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CommodityService } from "./commodity.service";
import { CommodityAlertService } from "./commodity-alert.service";
import { CommodityAdminService } from "./commodity-admin.service";
import {
  CommodityExposureService,
  type ExposureAssertion,
} from "./commodity-exposure.service";

@ApiTags("Commodity Index")
@ApiBearerAuth()
@Controller("commodity-index")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class CommodityController {
  constructor(
    private readonly service: CommodityService,
    private readonly alerts: CommodityAlertService,
    private readonly admin: CommodityAdminService,
    private readonly exposures: CommodityExposureService,
  ) {}

  @Get("status")
  @ApiOperation({
    summary:
      "The index-series register: every series, its terms, its cadence, and whether the scheduled reader is armed (off by default)",
  })
  status() {
    return {
      success: true,
      ...this.service.status(),
      // Named here rather than left to be inferred from silence: the alert is
      // built and dark, and a status route that showed only the fetch flag
      // would let a reader conclude no alert exists.
      // `standingNote`, never `reportLine` over a zeroed tally: the latter
      // would say "0 series evaluated, 0 would have interrupted this house",
      // which describes a run that did not happen, on the one route somebody
      // reads to find out whether this is on at all.
      alert: {
        armed: this.alerts.armed(),
        note: this.alerts.standingNote(),
      },
    };
  }

  @Get("me")
  @ApiOperation({
    summary:
      "The index series that speak for this house, each with its newest observation and the items a person mapped to it. A context line, never a claim",
  })
  async forHouse(@CurrentUser() user: { restaurantId: string }) {
    const result = await this.service.forHouse(user?.restaurantId ?? null);
    return { success: true, ...result };
  }
  // ───────────────────────────────────────────────────────────────────────────
  // Arming. A Mudavym admin, one series at a time, on numbers they were shown.
  // ───────────────────────────────────────────────────────────────────────────

  @Get("admin/series/:key/proposal")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "The calibration's proposed thresholds for one series at every budget, with the sentence each would produce. PROPOSES ONLY: this route writes nothing",
  })
  async proposal(@Param("key") key: string) {
    return { success: true, ...(await this.admin.propose(key)) };
  }

  /**
   * Arm one series.
   *
   * `proposalHash` is required and is compared against a proposal RECOMPUTED
   * here, now. There is no override and no force flag: the whole value of the
   * hash is that it cannot be worked around by the person it is meant to slow
   * down. `commodity-calibration.ts` explains why this is the seal's real
   * property, and the measured reason the tenant seal store cannot hold an
   * admin act (`mcp_seal_challenges.actor_user_id` is a NOT NULL FK to
   * `public.users`, and a service caller has no such row).
   */
  @Post("admin/series/:key/arm")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "Arm ONE series on a budget, carrying back the hash of the proposal that was shown. Refuses if the numbers moved since",
  })
  async arm(
    @Param("key") key: string,
    @Body()
    body: {
      firesPerYear?: number;
      proposalHash?: string;
      actorLabel?: string;
      note?: string;
    },
  ) {
    const outcome = await this.admin.arm({
      seriesKey: key,
      firesPerYear: Number(body?.firesPerYear ?? 0),
      proposalHash: body?.proposalHash ?? "",
      // A label, not a user id: this caller is a machine credential and has no
      // public.users row. Defaulted to the literal rather than to a name, so a
      // caller that names nobody is recorded as having named nobody.
      actorLabel: (body?.actorLabel ?? "").trim() || "mudavym_admin (unnamed)",
      note: body?.note ?? null,
    });
    return { success: true, ...outcome };
  }

  /**
   * Turn one series off. Deliberately NOT hash-gated: the hash stops a series
   * being armed on numbers nobody read, and the same friction on the OFF
   * direction is how a thing that is firing wrongly stays on for another ten
   * minutes.
   */
  @Post("admin/series/:key/disarm")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({ summary: "Disarm one series. Not hash-gated, on purpose" })
  async disarm(
    @Param("key") key: string,
    @Body() body: { actorLabel?: string; note?: string },
  ) {
    const outcome = await this.admin.disarm({
      seriesKey: key,
      actorLabel: (body?.actorLabel ?? "").trim() || "mudavym_admin (unnamed)",
      note: body?.note ?? null,
    });
    return { success: true, ...outcome };
  }

  @Get("admin/series/:key/history")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "Every act that armed or DISARMED this series, newest first. An empty log says so in words rather than as a zero",
  })
  async history(@Param("key") key: string) {
    return { success: true, ...(await this.admin.history(key)) };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The exposure mapping. An owner's or a manager's sealed, named act.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Begin the hold. The seal is issued here and spent by `assert`, so
   * `sealed: true` can never be an assertion in the same request as the thing
   * it claims about (ADR 0107/0116 addenda).
   */
  @Post("exposures/challenge")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Issue the one-time seal that asserting an exposure must carry back. Refuses first if the assertion would be refused anyway",
  })
  async exposureChallenge(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Body() body: Partial<ExposureAssertion>,
  ) {
    const result = await this.exposures.challenge(
      { userId: user.userId, restaurantId: user.restaurantId },
      assertionFrom(body),
    );
    return { success: true, ...result };
  }

  @Post("exposures")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Assert that one of this house's items is exposed to a series. Sealed, named, and never inferred. A failed write says why",
  })
  async assertExposure(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Body() body: Partial<ExposureAssertion> & { challenge?: string },
  ) {
    const outcome = await this.exposures.assert(
      { userId: user.userId, restaurantId: user.restaurantId },
      assertionFrom(body),
      body?.challenge ?? null,
    );
    return { success: true, ...outcome };
  }

  @Post("exposures/:id/retire")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Retire one exposure, naming a reason. Retired, never deleted: an alert that once fired on it can still be accounted for",
  })
  async retireExposure(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ) {
    const outcome = await this.exposures.retire(
      { userId: user.userId, restaurantId: user.restaurantId },
      id,
      body?.reason ?? "",
    );
    return { success: true, ...outcome };
  }
}

/**
 * Read one assertion out of a request body.
 *
 * The bases default to `unset` and the figures to null, which is the honest
 * common case AND the pair the service and the database both require to move
 * together. A body that sends a figure and forgets the basis is refused with a
 * sentence rather than written with an invented one.
 */
function assertionFrom(body: Partial<ExposureAssertion>): ExposureAssertion {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const basis = (v: unknown): ExposureAssertion["passThroughBasis"] =>
    v === "issuer_published" || v === "house_measured" ? v : "unset";
  return {
    seriesKey: String(body?.seriesKey ?? ""),
    houseItemId: String(body?.houseItemId ?? ""),
    passThrough: num(body?.passThrough),
    passThroughBasis: basis(body?.passThroughBasis),
    lagDays: num(body?.lagDays),
    lagBasis: basis(body?.lagBasis),
    note: typeof body?.note === "string" && body.note.trim() ? body.note : null,
  };
}
