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

import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PriceIndexService } from "./price-index.service";
import { PriceIndexFetchService } from "./price-index-fetch.service";
import { PriceIndexUploadService } from "./price-index-upload.service";
import { PriceIndexReviewService } from "./price-index-review.service";

@ApiTags("Price Index")
@ApiBearerAuth()
@Controller("price-index")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class PriceIndexController {
  constructor(
    private readonly service: PriceIndexService,
    private readonly fetchService: PriceIndexFetchService,
    private readonly uploadService: PriceIndexUploadService,
    private readonly reviewService: PriceIndexReviewService,
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

  /**
   * The human-fetch path (ADR 0117, "Michigan and Illinois", 2026-09-05).
   *
   * Michigan publishes the licensee price its houses actually pay and publishes
   * it behind a WAF that refuses every automated reader while serving a browser
   * normally. So a manager brings the file. It is a POST, so it never shadows
   * `GET :state`.
   *
   * DRY RUN BY DEFAULT: without `commit: true` this parses, gates and reports
   * what it WOULD write, and writes nothing. `commit: true` additionally
   * requires `PRICE_INDEX_UPLOAD_ENABLED`, which is off unless armed — so the
   * route is inert on a fresh deployment even for an owner.
   */
  @Post("upload")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Upload a posted price book a person downloaded (Michigan). Dry run unless commit is true AND uploads are armed; the edition date is read from the file name and never from the clock",
  })
  async upload(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Body()
    body: {
      sourceKey?: string;
      fileName?: string;
      fileBase64?: string;
      commit?: boolean;
    },
  ) {
    const outcome = await this.uploadService.ingest({
      sourceKey: body?.sourceKey ?? "",
      fileName: body?.fileName ?? "",
      fileBase64: body?.fileBase64 ?? "",
      commit: body?.commit === true,
      uploadedByUserId: user?.userId ?? null,
      uploadedByRestaurantId: user?.restaurantId ?? null,
    });
    return { success: true, armed: this.uploadService.armed(), ...outcome };
  }

  /**
   * The books this house's jurisdiction is holding (ADR 0128).
   *
   * Declared BEFORE `GET :state`, like `status`, or the word "uploads" would be
   * captured as a jurisdiction and this route would be unreachable.
   *
   * Scoped to the caller's own jurisdiction rather than taking one as a
   * parameter: `price_index_postings` has no restaurant_id, so a book's reach
   * is its STATE, and the people who may act on it are the people that state's
   * lines are drawn for. Letting a manager list another state's held books
   * would be a cross-tenant read with no reason behind it.
   */
  @Get("uploads")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Price books brought in for this house's jurisdiction: the ones waiting for a second pair of eyes, and the recent decisions",
  })
  async uploads(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    const state = await this.reviewService.jurisdictionOfHouse(
      user?.restaurantId ?? null,
    );
    if (!state) {
      return {
        success: true,
        state: null,
        pending: [],
        recent: [],
        othersWhoCouldAdmit: null,
        note: "This house records no jurisdiction this register recognises, so there is no set of books to hold for it. Set the address in Settings.",
      };
    }
    const { pending, recent, readFailed } =
      await this.reviewService.forJurisdiction(state);
    const pool = await this.reviewService.admittersFor(state, user?.userId);
    return {
      success: true,
      state,
      pending,
      recent,
      // Not a number the page has to derive: how many OTHER people could act is
      // what decides whether the person reading this may ever admit their own
      // book, and it is a fact about the estate rather than about them.
      othersWhoCouldAdmit: pool.readFailed ? null : pool.people.length,
      note: readFailed
        ? "The register of carried books could not be read. This is unknown, not empty."
        : null,
    };
  }

  /**
   * Begin the hold on a held book. The seal is issued here and spent by
   * `confirm`, so `sealed: true` can never be an assertion in the same request
   * as the thing it claims about (ADR 0107/0116 addenda).
   */
  @Post("uploads/:reviewId/challenge")
  @Roles("owner", "manager")
  @ApiOperation({
    summary: "Issue the one-time seal that admitting a held price book must carry back",
  })
  async challenge(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Param("reviewId") reviewId: string,
  ) {
    const review = await this.reviewService.byId(reviewId);
    const challenge = await this.reviewService.challenge(review, {
      userId: user.userId,
      restaurantId: user.restaurantId,
    });
    return { success: true, ...challenge };
  }

  /**
   * Let a held book into the market.
   *
   * `fileBase64` is OPTIONAL and is the strong form: the confirmer fetches the
   * book from the issuer themselves and the sha256 must agree. That is the only
   * evidence a book whose issuer publishes no signature can carry, and it is
   * recorded as `byte_match` rather than as the same word a click earns.
   */
  @Post("uploads/:reviewId/confirm")
  @Roles("owner", "manager")
  @ApiOperation({
    summary:
      "Admit a held price book. Sealed. Send the file too and the bytes are compared, which is the only evidence this book can carry",
  })
  async confirmUpload(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Param("reviewId") reviewId: string,
    @Body()
    body: { challenge?: string; reason?: string; fileBase64?: string },
  ) {
    const review = await this.reviewService.byId(reviewId);
    const result = await this.reviewService.confirm(
      review,
      { userId: user.userId, restaurantId: user.restaurantId },
      {
        challenge: body?.challenge ?? null,
        reason: body?.reason ?? null,
        fileBase64: body?.fileBase64 ?? null,
      },
    );
    return {
      success: true,
      review: result.review,
      postingsAdmitted: result.postingsAdmitted,
      note: result.sentence,
    };
  }

  /**
   * Never let this book in. Not sealed, deliberately: the seal guards the act
   * that puts numbers on other people's screens, and refusing is the direction
   * that takes them off. A refusal still names a person and a reason.
   */
  @Post("uploads/:reviewId/refuse")
  @Roles("owner", "manager")
  @ApiOperation({
    summary: "Refuse a held price book. The rows stay written and stay out of the market",
  })
  async refuseUpload(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Param("reviewId") reviewId: string,
    @Body() body: { reason?: string },
  ) {
    const review = await this.reviewService.byId(reviewId);
    const updated = await this.reviewService.refuse(
      review,
      { userId: user.userId, restaurantId: user.restaurantId },
      body?.reason ?? "",
    );
    return { success: true, review: updated };
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
