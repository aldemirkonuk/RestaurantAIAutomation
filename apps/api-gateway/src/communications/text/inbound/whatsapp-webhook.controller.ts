/**
 * The one door a vendor's WhatsApp reply comes through.
 *
 * WHY THIS ROUTE IS PUBLIC, AND WHAT REPLACES THE TOKEN
 * -----------------------------------------------------
 * Meta calls it; there is no JWT to carry. Authentication is
 * `X-Hub-Signature-256` — HMAC-SHA256 of the RAW body keyed on this
 * deployment's Meta app secret — verified by
 * `verifyMetaSignature`, and the route refuses with **401** on every failure
 * including the one that is ours (no secret configured). It is `@Public()` for
 * ADR 0096's reason: a route that declines to say whether it is authenticated
 * cannot be told from one where somebody forgot.
 *
 * WHAT THIS DOES TO ADR 0084's ASSERTION, AND WHY IT IS A REPLACEMENT
 * -------------------------------------------------------------------
 * `gateway-honesty.spec.ts:328` asserts that no inbound SMS handler exists,
 * because two outbound prompts ("Reply YES to approve") promised a reply nobody
 * could receive. That assertion is untouched and still passes — this is
 * WhatsApp, not SMS, and no SMS inbound handler exists. ADR 0121's consequences
 * section requires that when an inbound handler does land, the assertion is
 * *replaced* by one requiring it to be guarded and tenant-scoped rather than
 * deleted. `whatsapp-inbound.spec.ts` carries that second assertion: this file
 * must verify a signature, and the tenant must come from our own credential row
 * rather than from the payload.
 *
 * ALWAYS 200 ONCE THE SIGNATURE PASSES, AND THE BODY SAYS WHY
 * -----------------------------------------------------------
 * Meta retries any webhook it does not get a 200 for. A 500 on an unthreadable
 * message therefore turns one message we cannot store into an unbounded retry
 * loop for a message we still cannot store. So an authenticated payload is
 * always acknowledged — and the response enumerates every message with what
 * happened to it, so "we stored nothing" is never indistinguishable from "we
 * received nothing". Those counts are also logged, because the only reader of
 * this response is Meta.
 */

import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../../../auth/decorators/public.decorator";
import { TextConfigService } from "../text-config.service";
import {
  META_SIGNATURE_HEADER,
  verifyMetaHandshake,
  verifyMetaSignature,
} from "./meta-webhook-signature";
import { parseWhatsAppWebhook } from "./meta-webhook-payload";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import type {
  InboundDisposition,
  InboundResult,
} from "./whatsapp-inbound.service";

@ApiExcludeController()
@Controller("communications/webhooks/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly config: TextConfigService,
    private readonly inbound: WhatsAppInboundService,
  ) {}

  /**
   * Meta's subscription handshake.
   *
   * `hub.mode` must be `subscribe`, `hub.verify_token` must match this
   * deployment's, and the answer is a 200 whose BODY is `hub.challenge`
   * (`developers.facebook.com/docs/graph-api/webhooks/getting-started`, fetched
   * 2026-09-06). `res.send` is used directly because Meta compares the body
   * bytes and a JSON-wrapped challenge fails the subscription.
   */
  @Public() // Meta's handshake; authenticated by the verify token, not a JWT
  @Get()
  handshake(@Query() query: Record<string, string>, @Res() res: Response) {
    const result = verifyMetaHandshake({
      mode: query["hub.mode"],
      token: query["hub.verify_token"],
      challenge: query["hub.challenge"],
      verifyToken: this.config.webhookVerifyToken,
    });

    if (!result.ok) {
      this.logger.warn(`WhatsApp handshake refused: ${result.reason}`);
      // 403, which is what Meta's own guidance expects for a token mismatch,
      // and the body carries no hint about the configured token.
      res.status(403).send(result.says);
      return;
    }

    res.status(200).send(result.challenge);
  }

  /**
   * One webhook payload.
   *
   * `@Body()` is present so Nest parses the JSON, but the SIGNATURE is checked
   * against `req.rawBody` — the exact bytes Meta signed. `JSON.stringify(body)`
   * is a different string (key order, unicode escaping, number formatting), so
   * a re-serialised body fails against a real signature and the tempting fix is
   * to loosen the check. `main.ts` sets `rawBody: true` for this.
   */
  @Public() // authenticated by X-Hub-Signature-256, not JWT
  @Post()
  async receive(@Req() req: Request, @Body() body: unknown) {
    const verdict = verifyMetaSignature({
      rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
      header: req.headers[META_SIGNATURE_HEADER] as string | undefined,
      appSecret: this.config.appSecret,
    });

    if (!verdict.ok) {
      this.logger.warn(`WhatsApp webhook refused: ${verdict.reason}`);
      // 401 for every failure, INCLUDING `no-secret`. A deployment with no app
      // secret must refuse rather than accept, and it must not disclose which
      // of the two it was — the operator learns that from the log, which is
      // ours; the caller learns only that it was not authenticated.
      throw new UnauthorizedException(verdict.says);
    }

    const parsed = parseWhatsAppWebhook(body);

    const results: InboundResult[] = [];
    for (const message of parsed.messages) {
      results.push(await this.inbound.thread(message));
    }

    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.disposition] = (acc[r.disposition] ?? 0) + 1;
      return acc;
    }, {});

    // LOGGED AS COUNTS, ALWAYS — including the all-zero case. The only reader
    // of the response below is Meta, so a payload whose messages all failed to
    // thread would otherwise leave no trace anywhere a person looks.
    this.logger.log(
      `WhatsApp webhook: ${parsed.messages.length} message(s), ${parsed.statusCount} status callback(s), ${parsed.skipped.length} unreadable; ${JSON.stringify(counts)}`,
    );
    for (const s of parsed.skipped) this.logger.warn(`WhatsApp webhook: ${s.why}`);

    return {
      received: parsed.messages.length,
      statusCallbacks: parsed.statusCount,
      unreadable: parsed.skipped.length,
      counts: counts as Record<InboundDisposition, number>,
      messages: results.map((r) => ({
        wamid: r.wamid,
        disposition: r.disposition,
        says: r.says,
      })),
    };
  }
}
