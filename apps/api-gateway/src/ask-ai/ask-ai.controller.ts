import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  AuthedRateLimit,
  AuthedRateLimitGuard,
} from "../common/rate-limit/authed-rate-limit.guard";
import { AskAiService } from "./ask-ai.service";
import { ConfirmDto, ProposeDto } from "./dto/ask-ai.dto";

type AuthedUser = { userId: string; restaurantId: string };

/**
 * Ask AI — ask → propose → confirm → execute (FUTURES §8).
 *
 *   POST /ask-ai/propose              turn an utterance into ONE typed proposal
 *   GET  /ask-ai/actions              what is waiting for this restaurant
 *   GET  /ask-ai/candidates           the ids an action may point at, labelled
 *   POST /ask-ai/actions/:id/confirm  the gate: confirm, then execute
 *   POST /ask-ai/actions/:id/discard  the operator says no
 *
 * Every route is guarded. That is not boilerplate here: this surface creates
 * purchase orders and vendor email, and the register still carries entries for
 * unauthenticated endpoints that cost money — an analytics consultant anyone
 * could drive, a Vision endpoint whose $2 cap had never once fired. An
 * unguarded route on THIS controller would be the worst version of that.
 *
 * `restaurantId` always comes from the token, never from the path or body, so
 * a caller cannot propose against a tenant they do not belong to.
 *
 * ## What "guarded" means here, corrected 2026-09-12
 *
 * It used to mean `JwtAuthGuard` and nothing else, and the paragraph above
 * read as if that were the whole defence. Four things were measured on this
 * controller and all four are now closed:
 *
 * 1. **The bodies were not validated.** `@Body() body: { utterance?: string }`
 *    is an inline TYPE. It erases at runtime, Nest hands the global
 *    `ValidationPipe` an `Object` metatype, and the pipe — configured with
 *    `whitelist`, `forbidNonWhitelisted` and `transform` — returned the body
 *    untouched. An unbounded string went into a model prompt and an arbitrary
 *    object went into the confirm path. The bodies are DTO classes now.
 *
 * 2. **Nothing bounded what one member could spend.** The gateway does carry a
 *    global `RateLimitGuard`, so the earlier reading of "no rate limiting at
 *    all" was wrong; but it is an `APP_GUARD`, it runs before `JwtAuthGuard`,
 *    and it therefore keys on the IP and fell through to the default bucket of
 *    100 requests a minute for this route. A hundred model calls a minute is
 *    not a limit on a route that calls the model on every request.
 *    `AuthedRateLimitGuard` runs after authentication and binds the person.
 *
 * 3. **The spend ceiling never saw a first call.** It was written to suppress
 *    retry storms and was consulted in exactly the two retry branches, so a
 *    caller who never retried was never metered. `propose` now opts into
 *    `gateFirstAttempt`.
 *
 * 4. **Any member could confirm any proposal.** Confirming is the act that
 *    writes — a purchase order, vendor email. It now takes owner or manager.
 *
 * The four compose, and none is sufficient alone: validation bounds the
 * REQUEST, the limit bounds the RATE in one process, the ceiling bounds the
 * COST across the fleet because it reads a shared ledger, and the role bounds
 * WHO. A ledger outage degrades the third to the second rather than to nothing.
 */
@ApiTags("ask-ai")
@ApiBearerAuth()
@Controller("ask-ai")
// Order matters and is load-bearing: JwtAuthGuard must populate request.user
// before AuthedRateLimitGuard reads it and before RolesGuard reads the role.
// AuthedRateLimitGuard fails closed with a 500 and a log line naming this
// controller if it ever runs without a user, so a future reordering surfaces
// as a refusal rather than as a silently absent limit.
@UseGuards(JwtAuthGuard, AuthedRateLimitGuard, RolesGuard)
export class AskAiController {
  constructor(private readonly askAi: AskAiService) {}

  /**
   * The only route on this controller that spends money, and the only one
   * whose limits are this tight.
   *
   * The two windows answer different questions. Ten a minute is what a person
   * using this surface actually does — they read the proposal before asking
   * again — and it is well above any real burst while being far below what a
   * loop achieves. Two hundred an hour is the one that matters against a
   * patient caller: it is what stops "ten a minute, forever" from being a
   * viable way to spend a house's allowance, and it is deliberately per-HOUSE,
   * so several members cannot each run at their own per-person limit.
   *
   * These numbers are a starting position, not a measured optimum; no ADR
   * prices this surface (OD-23, pricing is founder-deferred). They can be
   * raised the moment a real house hits one, and the spend ceiling behind them
   * is what makes that safe to do.
   */
  @Post("propose")
  @AuthedRateLimit(
    {
      limit: 10,
      windowSeconds: 60,
      scope: "user",
      bucket: "mudavym-ask",
      message:
        "That is a lot of questions at once. Give it a minute and ask again.",
    },
    {
      limit: 200,
      windowSeconds: 3600,
      scope: "restaurant",
      bucket: "mudavym-ask",
      message:
        "This restaurant has asked a great deal in the last hour. It clears on its own.",
    },
  )
  @ApiOperation({
    summary:
      "Propose one typed, allowlisted action from a natural-language ask",
    description:
      "Never executes. Returns a proposal for a human to confirm, or a reason it could not.",
  })
  async propose(@Body() body: ProposeDto, @CurrentUser() user: AuthedUser) {
    return this.askAi.propose(user.restaurantId, user.userId, body.utterance);
  }

  @Get("actions")
  @ApiOperation({ summary: "Proposals awaiting confirmation" })
  async list(@CurrentUser() user: AuthedUser) {
    return this.askAi.listOpen(user.restaurantId);
  }

  @Get("candidates")
  @ApiOperation({
    summary: "The ids this restaurant's actions may point at, with labels",
    description:
      "The SAME capped set the propose prompt is handed and the confirm grounds against — so every option a picker builds from this is an id `confirm` will accept. " +
      "Read-only: no model call, no row written. Not paginated, deliberately; the grounding set is the first page, so a second page would offer ids that fail grounding. " +
      "`capped` says when a list is at its limit rather than complete.",
  })
  async candidates(@CurrentUser() user: AuthedUser) {
    return this.askAi.listCandidates(user.restaurantId);
  }

  @Post("actions/:id/confirm")
  @ApiOperation({
    summary: "Confirm a proposal and execute it through the owning service",
    description:
      "The confirm is a compare-and-swap on the row's status, so a double tap or a retry executes exactly once. " +
      "An optional `payload` carries the operator's edits — re-validated through the same allowlist and grounding " +
      "check as a model proposal, because an editable field is an id-injection hole the moment it is trusted. " +
      "Owner or manager only: confirming is the act that WRITES, and until 2026-09-12 any member of a house could " +
      "confirm a proposal any other member had made.",
  })
  @Roles("owner", "manager")
  @AuthedRateLimit({
    limit: 60,
    windowSeconds: 60,
    scope: "user",
    message: "Too many confirmations at once. Try again shortly.",
  })
  async confirm(
    @Param("id") id: string,
    @Body() body: ConfirmDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.askAi.confirm(
      user.restaurantId,
      user.userId,
      id,
      body?.payload,
    );
  }

  @Post("actions/:id/discard")
  @ApiOperation({ summary: "Discard a proposal without executing it" })
  async discard(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    return this.askAi.discard(user.restaurantId, user.userId, id);
  }
}
