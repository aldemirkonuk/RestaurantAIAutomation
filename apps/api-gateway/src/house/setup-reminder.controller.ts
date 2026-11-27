import { Controller, Get, HttpException, Param, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { RateLimit, SkipRateLimit } from "../common/rate-limit";
import { unsubscribePage } from "../analytics/digest/recommendation-digest.template";
import {
  SetupReminderService,
  type SetupReminderLinkState,
} from "./setup-reminder.service";

/** The setup letter's unsubscribe link, on the digest's pattern (DD-r108-57). */
@ApiTags("setup-reminder")
@Controller("house/setup-reminder")
export class SetupReminderController {
  constructor(private readonly reminders: SetupReminderService) {}

  @Get("unsubscribe/:token")
  @Public()
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "setup-reminder-unsubscribe" })
  @ApiOperation({ summary: "The setup letter's unsubscribe page. Changes nothing." })
  @ApiParam({ name: "token" })
  async landing(@Param("token") token: string, @Res() res: Response): Promise<void> {
    await this.render(res, () => this.reminders.readLink(token));
  }

  @Post("unsubscribe/:token")
  @Public()
  // One-click POSTs come from the provider's servers (digest review D6).
  @SkipRateLimit()
  @ApiOperation({ summary: "Stop letters like the setup reminder (one click)" })
  @ApiParam({ name: "token" })
  async stop(@Param("token") token: string, @Res() res: Response): Promise<void> {
    await this.render(res, () => this.reminders.stopByLink(token));
  }

  private async render(res: Response, act: () => Promise<SetupReminderLinkState>): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.type("html");
    try {
      const state = await act();
      if (state.kind === "malformed" || state.kind === "unknown") {
        res.status(404).send(
          unsubscribePage({
            title: "This is not a link we sent",
            body: "No letter was mailed with this link.",
          }),
        );
      } else if (state.kind === "active") {
        res.status(200).send(
          unsubscribePage({
            title: "Stop letters about setting up?",
            body: `This stops letters about setting up ${state.houseName}. Nothing else changes.`,
            confirmLabel: "Stop these letters",
          }),
        );
      } else {
        res.status(200).send(
          unsubscribePage({
            title: "They are stopped",
            body: `No more letters about setting up ${state.houseName} will be sent to you.`,
          }),
        );
      }
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 503;
      res.status(status >= 500 ? status : 503).send(
        unsubscribePage({
          title: "This link could not be checked",
          body: "Nothing was changed. Try the link again in a few minutes.",
        }),
      );
    }
  }
}
