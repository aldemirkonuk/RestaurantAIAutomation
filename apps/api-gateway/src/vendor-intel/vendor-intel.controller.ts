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

  /**
   * Record a bottle as an identity, asserted by the person and the house.
   *
   * ADR 0124 Q3: the house's assertion is **provisional** and goes into
   * Mudavym's curation queue. The house is taken from the token, never from the
   * body, so a house cannot assert an identity in another house's name.
   */
  @Post("identity/assert")
  @ApiOperation({
    summary:
      "Record a bottle identity, attributed to this person and house (provisional until curated)",
  })
  async identityAssert(
    @CurrentUser() user: { userId?: string; id?: string; restaurantId?: string },
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
        restaurantId: user?.restaurantId ?? null,
        note: body?.note ?? null,
      })),
    };
  }

  /**
   * The queue, open to staff.
   *
   * STAFF, ON THE FOUNDER'S CALL OF 2026-09-05 — *"staff may confirm, log the
   * decisions."* This is the one part of `/vendor-intel` that is not
   * owner/manager, and the asymmetry is deliberate rather than an oversight:
   * every other route here exposes what a vendor quoted this house, which is
   * its negotiating position. A candidate exposes only "are these two bottles
   * the same bottle" — no price, no vendor, no terms — and the people who can
   * answer it are the ones holding the bottles. Confirming without being able
   * to see the queue is not a capability, so the queue moves with the decision.
   */
  @Get("identity/candidates")
  @Roles("owner", "manager", "staff")
  @ApiOperation({ summary: "Identity links proposed and waiting for a person" })
  async identityCandidates(
    @CurrentUser() user: { restaurantId: string },
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    const capped =
      Number.isFinite(n) && (n as number) > 0 ? Math.min(n as number, 200) : 50;
    const items = await this.identity.pending(user?.restaurantId ?? null, capped);
    return {
      success: true,
      items,
      count: items.length,
      limit: capped,
      // A full page is a FLOOR. `count` must not be printed as a total when the
      // query stopped at exactly that many.
      complete: items.length < capped,
    };
  }

  /**
   * A person confirms or rejects one proposed link, and it is logged.
   *
   * Staff may take this decision (see the queue route above). There is
   * deliberately no bulk route and no "confirm everything above X": the whole
   * point of the queue is that a confidence is not a decision.
   */
  @Post("identity/candidates/decide")
  @Roles("owner", "manager", "staff")
  @ApiOperation({
    summary: "Confirm or reject one proposed identity link (staff may; logged)",
  })
  async identityDecide(
    @CurrentUser()
    user: {
      userId?: string;
      id?: string;
      name?: string;
      email?: string;
      role?: string;
      restaurantId: string;
    },
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
    return {
      success: true,
      ...(await this.identity.decide({
        candidateId: body.candidateId,
        decision: body.decision,
        actor: this.actorOf(user),
        restaurantId: user?.restaurantId ?? null,
        note: body?.note ?? null,
      })),
    };
  }

  /**
   * A manager takes a decision back. The undo is itself a logged decision.
   *
   * Owner/manager — the class default, stated here anyway because the two
   * neighbouring routes deliberately differ from it and a reader should not
   * have to infer this one from silence.
   */
  @Post("identity/decisions/undo")
  @Roles("owner", "manager")
  @ApiOperation({
    summary: "Undo one identity decision (manager only; the undo is logged too)",
  })
  async identityUndo(
    @CurrentUser()
    user: {
      userId?: string;
      id?: string;
      name?: string;
      email?: string;
      role?: string;
      restaurantId: string;
    },
    @Body() body: { decisionId?: string; note?: string },
  ) {
    if (!body?.decisionId || !UUID_RE.test(body.decisionId)) {
      throw new BadRequestException("decisionId must be a decision id.");
    }
    return {
      success: true,
      ...(await this.identity.undo({
        decisionId: body.decisionId,
        actor: this.actorOf(user),
        restaurantId: user?.restaurantId ?? null,
        note: body?.note ?? null,
      })),
    };
  }

  /**
   * This house's identity decision log.
   *
   * Staff-readable, for the same reason staff may decide: a person who takes a
   * decision has to be able to see the decisions. A failed read is a failure
   * with its reason, never an empty log — the service throws rather than
   * returning `[]`.
   */
  @Get("identity/decisions")
  @Roles("owner", "manager", "staff")
  @ApiOperation({ summary: "Every identity decision this house has taken" })
  async identityDecisions(
    @CurrentUser() user: { restaurantId: string },
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    return {
      success: true,
      ...(await this.identity.decisions(
        user?.restaurantId ?? null,
        Number.isFinite(n) && (n as number) > 0 ? (n as number) : 50,
      )),
    };
  }

  // -------------------------------------------------------------------------
  // Q4 — two ways a bottle gets into the register.
  // -------------------------------------------------------------------------

  /**
   * Search the recorded LWIN file. Staff, like the rest of identity work.
   *
   * Returns `available: false` with the reason when no file is recorded on this
   * deployment, rather than an empty hit list: "no wine matched" and "there is
   * no file" are different answers.
   */
  @Get("identity/lwin/search")
  @Roles("owner", "manager", "staff")
  @ApiOperation({ summary: "Search the recorded LWIN file for a wine" })
  async lwinSearch(@Query("q") q?: string, @Query("limit") limit?: string) {
    if (!q || !q.trim()) {
      throw new BadRequestException("Give some words to search for.");
    }
    const n = limit ? Number(limit) : undefined;
    return {
      success: true,
      ...(await this.identity.lwinSearch(
        q,
        Number.isFinite(n) && (n as number) > 0 ? Math.min(n as number, 100) : 20,
      )),
    };
  }

  /**
   * Confirm one LWIN row as an identity, with the format this house states.
   *
   * The LWIN names the wine; the vintage, size and pack come from the bottle in
   * front of the person and are never invented from the code.
   */
  @Post("identity/lwin/confirm")
  @Roles("owner", "manager", "staff")
  @ApiOperation({ summary: "Confirm an identity from the recorded LWIN file" })
  async lwinConfirm(
    @CurrentUser() user: { userId?: string; id?: string },
    @Body()
    body: {
      lwin?: string;
      displayName?: string;
      producer?: string;
      vintage?: string | number | null;
      sizeMl?: number | null;
      pack?: number | null;
      note?: string;
    },
  ) {
    if (!body?.lwin || !/^\d{7}$/.test(body.lwin)) {
      throw new BadRequestException("lwin must be the seven-digit LWIN-7.");
    }
    if (!body?.displayName || !body?.producer) {
      throw new BadRequestException(
        "Send the row's displayName and producer as the file states them, so the identity records what was read rather than what was typed.",
      );
    }
    return {
      success: true,
      ...(await this.identity.confirmFromLwin({
        lwin: body.lwin,
        displayName: body.displayName,
        producer: body.producer,
        vintage: body.vintage ?? null,
        sizeMl: body.sizeMl ?? null,
        pack: body.pack ?? null,
        userId: user?.userId ?? user?.id ?? "",
        note: body.note ?? null,
      })),
    };
  }

  /**
   * Nominate a wine by hand. The second way in.
   *
   * This is `assertIdentity` with the house attached, which makes it
   * PROVISIONAL and queues it for curation (Q3). It exists as its own route
   * because "nominate" is what the founder called it and because the response
   * says the standing out loud — a house that nominates should be told, in the
   * same breath, that what it just made is provisional.
   */
  @Post("identity/nominate")
  @Roles("owner", "manager", "staff")
  @ApiOperation({
    summary: "Nominate a wine by hand — a named, provisional identity assertion",
  })
  async identityNominate(
    @CurrentUser() user: { userId?: string; id?: string; restaurantId?: string },
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
    if (!user?.restaurantId) {
      throw new BadRequestException(
        "A nomination is a house's assertion, and this session names no house.",
      );
    }
    const out = await this.identity.assertIdentity({
      subject: body ?? {},
      userId: user?.userId ?? user?.id ?? "",
      restaurantId: user.restaurantId,
      note: body?.note ?? null,
    });
    return {
      success: true,
      ...out,
      note:
        out.standing === "provisional"
          ? "Recorded as this house's own, provisional, and queued for Mudavym to curate. It is shown as provisional everywhere until it is promoted."
          : "This bottle was already in the register; nothing was re-attributed.",
    };
  }

  /**
   * How many confirmed identities a sweep would read.
   *
   * The founder's Q4 text: "The sweep reads confirmed identities and says how
   * many it read." Provisional ones are excluded — a house's own unconfirmed
   * name is not a subject to go fetching prices for.
   */
  @Get("identity/sweep-subjects")
  @Roles("owner", "manager", "staff")
  @ApiOperation({
    summary: "How many confirmed identities a shop sweep would read",
  })
  async identitySweepSubjects(@CurrentUser() user: { restaurantId?: string }) {
    return {
      success: true,
      ...(await this.identity.confirmedIdentityCount(user?.restaurantId ?? null)),
    };
  }

  /**
   * The token's own account, shaped for the log.
   *
   * The name and role are read HERE, from the request, and travel into the log
   * row — never joined back out of `public.users` at read time, because
   * `decided_by` is ON DELETE SET NULL and a person who leaves would take the
   * answer with them.
   */
  private actorOf(user: {
    userId?: string;
    id?: string;
    name?: string;
    email?: string;
    role?: string;
  }) {
    return {
      userId: user?.userId ?? user?.id ?? "",
      name: user?.name ?? null,
      email: user?.email ?? null,
      role: user?.role ?? null,
    };
  }
}
