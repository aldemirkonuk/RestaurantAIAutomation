import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import { RateLimit, SkipRateLimit } from "../../common/rate-limit";
import {
  houseActor,
  type TokenUser,
} from "../../communications/letters/house-letters.actor";
import { DigestSubscriptionDto } from "./recommendation-digest.dto";
import {
  RecommendationDigestService,
  type UnsubscribeLinkState,
} from "./recommendation-digest.service";
import { unsubscribePage } from "./recommendation-digest.template";

/**
 * The recommendations digest's two doors.
 *
 * `subscription` — the person, in their session's house. Tenant and person come
 * from the token (`houseActor`), never from a path or a body; nobody can ask for
 * the digest on somebody else's behalf, or for a house they are not in.
 *
 * `unsubscribe/:token` — the link in a mail. No session: the token is the only
 * authority, and all it can do is stop that one person's digest from that one
 * house. GET renders a page and changes nothing (mail scanners follow links);
 * POST stops it — the page's button, or a mail client's RFC 8058 one-click, which
 * posts `List-Unsubscribe=One-Click` and ignores what comes back.
 */
@ApiTags("recommendations-digest")
@Controller("recommendations/digest")
export class RecommendationDigestController {
  constructor(private readonly digest: RecommendationDigestService) {}

  @Get("subscription")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Your recommendations digest, and every reason it would not reach you",
  })
  getSubscription(@CurrentUser() user: TokenUser) {
    const { userId, restaurantId } = houseActor(user);
    return this.digest.statusFor(userId, restaurantId);
  }

  @Put("subscription")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Ask for (or change) your recommendations digest in this house",
  })
  putSubscription(
    @CurrentUser() user: TokenUser,
    @Body() body: DigestSubscriptionDto,
  ) {
    const { userId, restaurantId } = houseActor(user);
    return this.digest.subscribe(userId, restaurantId, body);
  }

  @Delete("subscription")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Stop your recommendations digest in this house" })
  deleteSubscription(@CurrentUser() user: TokenUser) {
    const { userId, restaurantId } = houseActor(user);
    return this.digest.stopForSelf(userId, restaurantId);
  }

  @Get("unsubscribe/:token")
  @Public()
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "digest-unsubscribe" })
  @ApiOperation({ summary: "The unsubscribe link's page. Changes nothing." })
  @ApiParam({ name: "token", description: "64-char hex, from one digest mail" })
  async unsubscribeLanding(
    @Param("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.render(res, () => this.digest.readUnsubscribeLink(token));
  }

  @Post("unsubscribe/:token")
  @Public()
  // Not rate-limited. An RFC 8058 one-click POST is sent by the mailbox
  // PROVIDER's servers, not the recipient's browser, so a per-IP bucket (the
  // guard keys on the leftmost X-Forwarded-For) would be shared by every
  // recipient on that provider and answer a real stop with a JSON 429. Nor was
  // the limit a control: that header is client-set, and the token carries 256
  // bits, so there is nothing to guess (review D6).
  @SkipRateLimit()
  @ApiOperation({
    summary: "Stop the digest this link was mailed with (one click)",
  })
  @ApiParam({ name: "token", description: "64-char hex, from one digest mail" })
  async unsubscribe(
    @Param("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.render(res, () => this.digest.stopByLink(token));
  }

  private async render(
    res: Response,
    act: () => Promise<UnsubscribeLinkState>,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    // The token is in this URL; nothing on the page may carry it anywhere else.
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.type("html");
    try {
      const state = await act();
      const { status, html } = pageFor(state);
      res.status(status).send(html);
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 503;
      res.status(status >= 500 ? status : 503).send(
        unsubscribePage({
          title: "This link could not be checked",
          body: "We could not read our own records just now, so nothing was changed and your digest is exactly as it was. Try the link again in a few minutes.",
        }),
      );
    }
  }
}

function pageFor(state: UnsubscribeLinkState): {
  status: number;
  html: string;
} {
  switch (state.kind) {
    case "malformed":
    case "unknown":
      return {
        status: 404,
        html: unsubscribePage({
          title: "This is not a link we sent",
          body: "No digest was mailed with this link, so there is nothing for it to stop. If you copied it from a mail, check that the whole address came across.",
        }),
      };
    case "active":
      return {
        status: 200,
        html: unsubscribePage({
          title: "Stop the recommendations digest?",
          body: `This stops the recommendations digest from ${state.houseName} to you. Nothing else changes: other mail, your account and the house's recommendations stay exactly as they are.`,
          confirmLabel: "Stop the digest",
        }),
      };
    case "stopped":
      return {
        status: 200,
        html: unsubscribePage({
          title: "The digest is stopped",
          body: `No more recommendations digests from ${state.houseName} will be sent to you. You can ask for it again from the house, signed in.`,
        }),
      };
    case "already_stopped":
      return {
        status: 200,
        html: unsubscribePage({
          title: "Already stopped",
          body: `The recommendations digest from ${state.houseName} is not being sent to you, so there was nothing to stop.`,
        }),
      };
  }
}
