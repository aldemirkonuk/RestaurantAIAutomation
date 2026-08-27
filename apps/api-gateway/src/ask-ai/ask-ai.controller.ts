import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AskAiService } from "./ask-ai.service";

type AuthedUser = { userId: string; restaurantId: string };

/**
 * Ask AI — ask → propose → confirm → execute (FUTURES §8).
 *
 *   POST /ask-ai/propose              turn an utterance into ONE typed proposal
 *   GET  /ask-ai/actions              what is waiting for this restaurant
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
 */
@ApiTags("ask-ai")
@ApiBearerAuth()
@Controller("ask-ai")
@UseGuards(JwtAuthGuard)
export class AskAiController {
  constructor(private readonly askAi: AskAiService) {}

  @Post("propose")
  @ApiOperation({
    summary:
      "Propose one typed, allowlisted action from a natural-language ask",
    description:
      "Never executes. Returns a proposal for a human to confirm, or a reason it could not.",
  })
  async propose(
    @Body() body: { utterance?: string },
    @CurrentUser() user: AuthedUser,
  ) {
    return this.askAi.propose(
      user.restaurantId,
      user.userId,
      body?.utterance ?? "",
    );
  }

  @Get("actions")
  @ApiOperation({ summary: "Proposals awaiting confirmation" })
  async list(@CurrentUser() user: AuthedUser) {
    return this.askAi.listOpen(user.restaurantId);
  }

  @Post("actions/:id/confirm")
  @ApiOperation({
    summary: "Confirm a proposal and execute it through the owning service",
    description:
      "The confirm is a compare-and-swap on the row's status, so a double tap or a retry executes exactly once.",
  })
  async confirm(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    return this.askAi.confirm(user.restaurantId, user.userId, id);
  }

  @Post("actions/:id/discard")
  @ApiOperation({ summary: "Discard a proposal without executing it" })
  async discard(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    return this.askAi.discard(user.restaurantId, user.userId, id);
  }
}
