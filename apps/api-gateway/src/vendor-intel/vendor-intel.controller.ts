import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { VendorComparisonService } from "./vendor-comparison.service";
import { VendorPageExtractorService } from "./vendor-page-extractor.service";
import { VendorSiteSweepService } from "./vendor-site-sweep.service";
import { OutlierRejudgeService } from "./outlier-rejudge.service";
import { ShopReferenceSweepService } from "./shop-reference-sweep.service";
import { IdentityService } from "./identity.service";
import { ManualObservationDto } from "./dto/manual-observation.dto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_HASH_RE = /^[0-9a-f]{64}$/i;

/**
 * Vendor price intelligence.
 *
 * Owner/manager only. Vendor pricing is commercially sensitive — it is the
 * restaurant's negotiating position — so it is deliberately not visible to
 * staff-level accounts, matching the role gate on the pricing column.
 */
@ApiTags("Vendor Intelligence")
@ApiBearerAuth()
@Controller("vendor-intel")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class VendorIntelController {
  constructor(
    private readonly comparison: VendorComparisonService,
    private readonly extractor: VendorPageExtractorService,
    private readonly siteSweep: VendorSiteSweepService,
    private readonly rejudge: OutlierRejudgeService,
    private readonly shopSweep: ShopReferenceSweepService,
    private readonly identity: IdentityService,
  ) {}

  @Get("compare")
  @ApiOperation({
    summary:
      "Vendor price ladder + 7/30/90d trends for one product, across all sources",
  })
  async compare(
    @CurrentUser() user: { restaurantId: string },
    @Query("masterWineId") masterWineId?: string,
    @Query("signatureHash") signatureHash?: string,
    @Query("windowDays") windowDays?: string,
  ) {
    if (!masterWineId && !signatureHash) {
      throw new BadRequestException(
        "Provide masterWineId or signatureHash to identify the product.",
      );
    }
    // Validate the shape before it reaches Postgres. Without this, typing a
    // wine name into the search box produced 22P02 "invalid input syntax for
    // type uuid", which surfaced as a 500 — an outage message for a typo.
    // signatureHash is checked as strict hex because it is interpolated into a
    // PostgREST filter string when both keys are queried together.
    if (masterWineId && !UUID_RE.test(masterWineId)) {
      throw new BadRequestException(
        "masterWineId must be a wine id. Search for the wine by name and pick it from the list instead of typing it.",
      );
    }
    if (signatureHash && !SIGNATURE_HASH_RE.test(signatureHash)) {
      throw new BadRequestException(
        "signatureHash must be a 64-character hex digest.",
      );
    }
    const parsedWindow = windowDays ? Number(windowDays) : undefined;
    const result = await this.comparison.compare({
      masterWineId,
      signatureHash,
      restaurantId: user.restaurantId,
      windowDays:
        parsedWindow && Number.isFinite(parsedWindow)
          ? parsedWindow
          : undefined,
    });
    return { success: true, ...result };
  }

  /**
   * The market-price box on /notifications: which products are being quoted
   * below what they had lately been going for.
   *
   * Owner/manager like the rest of this controller — it states this house's
   * buying position. `windowDays` and `minObservations` are clamped rather
   * than trusted: a 1-day window with 0 required history would report noise
   * as news, and the page prints both numbers next to the answer so the
   * reader can see the rule that produced it.
   */
  @Get("below-average")
  @ApiOperation({
    summary:
      "Products whose newest sighting is below the mean of the earlier sightings in the window",
  })
  async belowAverage(
    @CurrentUser() user: { restaurantId: string },
    @Query("windowDays") windowDays?: string,
    @Query("minObservations") minObservations?: string,
    @Query("limit") limit?: string,
  ) {
    const clamp = (
      raw: string | undefined,
      min: number,
      max: number,
      dflt: number,
    ) => {
      const n = raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(n)) return dflt;
      return Math.min(max, Math.max(min, Math.trunc(n)));
    };
    const result = await this.comparison.belowTrailingAverage({
      restaurantId: user.restaurantId,
      windowDays: clamp(windowDays, 7, 365, 30),
      minObservations: clamp(minObservations, 2, 50, 3),
      limit: clamp(limit, 1, 25, 5),
    });
    return { success: true, ...result };
  }

  /**
   * Record a price someone was told — the phone quote, the WhatsApp message.
   *
   * Manager-level rather than owner-only: managers are the people who actually
   * take these calls, and a price that has to wait for the owner to log in is
   * a price that never gets recorded.
   */
  @Post("observations")
  @ApiOperation({ summary: "Record a hand-entered vendor price observation" })
  async recordObservation(
    @CurrentUser() user: { restaurantId: string; userId?: string; id?: string },
    @Body() body: ManualObservationDto,
  ) {
    const observation = await this.comparison.recordManualObservation({
      ...body,
      restaurantId: user.restaurantId,
      userId: user.userId ?? user.id,
    });
    return { success: true, observation };
  }

  /**
   * Kick a scrape manually. Owner-only: it makes outbound requests in the
   * restaurant's name and costs model tokens, so it should not be a
   * one-click action for every manager.
   */
  @Post("scrape")
  @Roles("owner")
  @ApiOperation({ summary: "Extract prices from one vendor page" })
  async scrape(
    @CurrentUser() user: { restaurantId: string },
    @Body()
    body: {
      url: string;
      providerId?: string;
      vendorCatalogueId?: string;
      vendorName?: string;
      dryRun?: boolean;
    },
  ) {
    if (!body?.url) throw new BadRequestException("url is required");
    const result = await this.extractor.extractFromUrl({
      url: body.url,
      // The sighting is filed to the house that asked for it. A null here is a
      // refusal (`vendor-site-sighting.ts`), and before that refusal existed it
      // was a row every other house could read.
      restaurantId: user.restaurantId,
      providerId: body.providerId ?? null,
      vendorCatalogueId: body.vendorCatalogueId ?? null,
      vendorName: body.vendorName ?? null,
      dryRun: body.dryRun ?? false,
    });
    return { success: true, result };
  }

  @Post("sweep")
  @Roles("owner")
  @ApiOperation({
    summary:
      "Sweep active vendor_catalogue websites (sequential, rate-limited)",
  })
  async sweep(
    @CurrentUser() user: { restaurantId: string },
    @Body() body: { limit?: number; dryRun?: boolean },
  ) {
    const results = await this.extractor.sweepCatalogue({
      limit: body?.limit,
      dryRun: body?.dryRun ?? false,
      restaurantId: user.restaurantId,
    });
    return {
      success: true,
      swept: results.length,
      observationsWritten: results.reduce(
        (a, r) => a + r.observationsWritten,
        0,
      ),
      results,
    };
  }

  /**
   * What the scheduled vendor-site sweep has done, per vendor — and, for every
   * vendor it has done nothing to, why.
   *
   * This endpoint exists because the alternative is a register that is empty
   * for six different reasons that all look identical from the outside: the
   * sweep is off, the vendor has no site, its robots.txt forbids the page, the
   * fetch failed, the page had no prices, or every price on it was refused for
   * not naming its unit. Reading rows-written alone cannot tell those apart,
   * and a reader who cannot tell them apart will read absence as health.
   *
   * Owner-only, matching `POST /vendor-intel/sweep`: it names this house's
   * vendors and what their public pages say.
   */
  @Get("site-sweep/status")
  @Roles("owner")
  @ApiOperation({
    summary:
      "Per-vendor state of the scheduled site sweep: last fetch, rows written, refusals by reason, and why a vendor is silent",
  })
  async siteSweepStatus(@CurrentUser() user: { restaurantId: string }) {
    return {
      success: true,
      ...(await this.siteSweep.status(user.restaurantId)),
    };
  }

  /**
   * Run the scheduled sweep now, for this house.
   *
   * Still gated on `VENDOR_SITE_SWEEP_ENABLED`: a hand-run must not be a way
   * around the switch, or the switch is not a switch. A disarmed call returns
   * the sentence saying so rather than an empty result.
   */
  @Post("site-sweep/run")
  @Roles("owner")
  @ApiOperation({ summary: "Run the vendor-site sweep now for this house" })
  async runSiteSweep(
    @CurrentUser() user: { restaurantId: string },
    @Body() body: { dryRun?: boolean; limit?: number },
  ) {
    const summary = await this.siteSweep.sweep({
      restaurantId: user.restaurantId,
      limitPerRestaurant: body?.limit,
      dryRun: body?.dryRun ?? false,
    });
    return { success: true, ...summary };
  }

  /**
   * State of the nightly outlier re-judge.
   *
   * Deliberately its own route rather than a field on `site-sweep/status`: the
   * sweep's status is per-vendor and tenant-scoped, and the re-judge is
   * neither — it runs once for the whole register, market rows included, so
   * folding it into a per-house answer would make a platform-wide fact look
   * like a fact about this house's vendors.
   *
   * It carries the last run, what it flipped, and — when nothing has happened
   * — the SENTENCE saying why. An empty flip count from a job that is switched
   * off must never read as "the register agrees with itself".
   *
   * Owner-only, matching the sweep: it describes a job that rewrites verdicts
   * on rows the market box reads.
   */
  @Get("outlier-rejudge/status")
  @Roles("owner")
  @ApiOperation({
    summary:
      "State of the nightly is_outlier re-judge: armed or not, last run, rows judged, flags set and cleared, and why it is silent",
  })
  outlierRejudgeStatus() {
    return { success: true, ...this.rejudge.status() };
  }

  /**
   * Run the re-judge now.
   *
   * Still gated on `PRICE_OUTLIER_REJUDGE_ENABLED`, like the sweep's hand-run:
   * a manual trigger that bypasses the switch is not a switch. A disarmed call
   * returns the status sentence saying so and writes nothing.
   */
  @Post("outlier-rejudge/run")
  @Roles("owner")
  @ApiOperation({ summary: "Run the outlier re-judge now over the whole register" })
  async runOutlierRejudge(@Body() body: { dryRun?: boolean; windowDays?: number }) {
    if (!this.rejudge.armed()) {
      return { success: false, ran: false, ...this.rejudge.status() };
    }
    const summary = await this.rejudge.rejudge({
      dryRun: body?.dryRun ?? false,
      windowDays: body?.windowDays,
    });
    return { success: true, ran: true, ...summary };
  }

  /**
   * State of the merchant-shop sweep — the class-D retail reference line.
   *
   * Its own route, not a field on `site-sweep/status`, because it is a
   * different register with a different scope: the vendor sweep is per house
   * and writes `vendor_price_observations`; this one is per JURISDICTION and
   * writes `price_index_postings`, which no house owns. Folding a public
   * register's state into a per-house answer would make it look like a fact
   * about this house's vendors, which is exactly the confusion ADR 0117 draws
   * the class line to prevent.
   *
   * Every registered shop is returned, including the ones deliberately not
   * fetched, each with the reason and the day it was measured.
   */
  @Get("shop-sweep/status")
  @Roles("owner")
  @ApiOperation({
    summary:
      "Per-shop state of the merchant-shop (class D) sweep: armed or not, last fetch, postings written, refusals by reason, and why a shop is silent",
  })
  shopSweepStatus() {
    return { success: true, ...this.shopSweep.status() };
  }

  /**
   * Run the merchant-shop sweep now, over the pages named in the body.
   *
   * Gated on `PRICE_REFERENCE_SHOP_SWEEP_ENABLED` exactly like the vendor
   * sweep's hand-run: a manual trigger that bypasses the switch is not a
   * switch. It reads the pages it is given and never enumerates a catalogue —
   * see the service's header for why.
   */
  @Post("shop-sweep/run")
  @Roles("owner")
  @ApiOperation({
    summary: "Run the merchant-shop sweep now over the named pages",
  })
  async runShopSweep(
    @Body() body: { pages?: Record<string, string[]>; dryRun?: boolean },
  ) {
    if (!this.shopSweep.armed()) {
      return { success: false, ran: false, ...this.shopSweep.status() };
    }
    const summary = await this.shopSweep.sweep({
      pages: body?.pages ?? {},
      dryRun: body?.dryRun ?? false,
    });
    return { success: true, ran: true, ...summary };
  }

  // -------------------------------------------------------------------------
  // The identity register (ADR 0124). Owner/manager, like everything here.
  // -------------------------------------------------------------------------

  @Get("identity/status")
  @ApiOperation({
    summary:
      "What the bottle-identity register holds, and why it is quiet when it is",
  })
  async identityStatus() {
    return { success: true, ...(await this.identity.status()) };
  }

  /**
   * "Which bottle does this code name?"
   *
   * Answers with one identity, with several (which is a refusal to choose), or
   * with "not recorded" — never with a guess. A GTIN's check digit is verified
   * before the lookup so a mis-typed code is told apart from an unknown one.
   */
  @Get("identity/lookup")
  @ApiOperation({ summary: "Look one bottle identity up by GTIN, LWIN or source code" })
  async identityLookup(
    @Query("namespace") namespace?: string,
    @Query("value") value?: string,
  ) {
    if (!namespace || !value) {
      throw new BadRequestException(
        "Give both a namespace (gtin, lwin, or source:<key>) and a value.",
      );
    }
    return { success: true, ...(await this.identity.lookupByKey(namespace, value)) };
  }

  /**
   * Suggestions for a described bottle. Writes nothing and links nothing.
   */
  @Post("identity/suggest")
  @ApiOperation({ summary: "Suggest register identities for a described bottle" })
  async identitySuggest(
    @Body()
    body: {
      producer?: string;
      name?: string;
      vintage?: string | number | null;
      sizeMl?: number | null;
      pack?: number | null;
    },
  ) {
    return { success: true, ...(await this.identity.suggest(body ?? {})) };
  }

  /** Record a bottle as an identity, asserted by the person doing it. */
  @Post("identity/assert")
  @ApiOperation({ summary: "Record a bottle identity, attributed to this person" })
  async identityAssert(
    @CurrentUser() user: { userId?: string; id?: string },
    @Body()
    body: {
      producer?: string;
      name?: string;
      vintage?: string | number | null;
      sizeMl?: number | null;
      pack?: number | null;
      note?: string;
    },
  ) {
    const userId = user?.userId ?? user?.id ?? "";
    return {
      success: true,
      ...(await this.identity.assertIdentity({
        subject: body ?? {},
        userId,
        note: body?.note ?? null,
      })),
    };
  }

  @Get("identity/candidates")
  @ApiOperation({ summary: "Identity links proposed and waiting for a person" })
  async identityCandidates(
    @CurrentUser() user: { restaurantId: string },
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    const items = await this.identity.pending(
      user?.restaurantId ?? null,
      Number.isFinite(n) && (n as number) > 0 ? Math.min(n as number, 200) : 50,
    );
    return { success: true, items, count: items.length };
  }

  /**
   * A person confirms or rejects one proposed link.
   *
   * There is deliberately no bulk route and no "confirm everything above X".
   * The whole point of the queue is that a confidence is not a decision.
   */
  @Post("identity/candidates/decide")
  @ApiOperation({ summary: "Confirm or reject one proposed identity link" })
  async identityDecide(
    @CurrentUser() user: { userId?: string; id?: string; restaurantId: string },
    @Body() body: { candidateId?: string; decision?: string; note?: string },
  ) {
    if (!body?.candidateId || !UUID_RE.test(body.candidateId)) {
      throw new BadRequestException("candidateId must be a candidate id.");
    }
    if (body?.decision !== "confirmed" && body?.decision !== "rejected") {
      throw new BadRequestException(
        'decision must be "confirmed" or "rejected". There is no third answer and no default.',
      );
    }
    const userId = user?.userId ?? user?.id ?? "";
    return {
      success: true,
      ...(await this.identity.decide({
        candidateId: body.candidateId,
        decision: body.decision,
        userId,
        restaurantId: user?.restaurantId ?? null,
        note: body?.note ?? null,
      })),
    };
  }
}
