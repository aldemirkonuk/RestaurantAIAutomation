/**
 * `/communications/retention` — what the consent screen prints before a person
 * hands over their mailbox (ADR 0118, retention, decided 2026-09-05).
 *
 * ONE ROUTE, AND IT IS A READ. The consent screen must not compose its own
 * retention copy, for exactly the reason `AuthorizeIntegration.tsx` already
 * does not compose its own scope list: a page that writes its own privacy
 * sentence is right on the day it is written and silently wrong afterwards. The
 * figure, its derivation, the jurisdiction floor and its statutes all come from
 * here.
 *
 * Tenant-scoped from the SIGNED token, never from a query parameter: the figure
 * is a fact about a house's own dispute history, and a route that let a caller
 * name the house would let one restaurant read another's.
 */

import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { RawMailRetentionService } from "./raw-mail-retention.service";

interface Actor {
  id: string;
  restaurantId: string;
}

@ApiTags("Communications")
@UseGuards(JwtAuthGuard)
@Controller("communications/retention")
export class RetentionController {
  constructor(private readonly retention: RawMailRetentionService) {}

  @Get("disclosure")
  @ApiOperation({
    summary:
      "How long this house keeps the raw mail of a mirrored vendor reply, what happens on revocation, and which statute fixes the floor for the order's own facts",
  })
  @ApiResponse({
    status: 200,
    description:
      "`figureDays` is the window in force and `figureFrom` says whether it is the stored quarterly derivation or a figure measured on this request because none has been stored yet. `basis` is the derivation in words. `jurisdiction.defaultedBecause` is non-null only when no country is recorded and the strictest rule was applied. `appliesTo` names the grants this disclosure covers, so the page never hard-codes an integration id.",
  })
  async disclosure(@CurrentUser() user: Actor) {
    return {
      success: true,
      retention: await this.retention.disclosureFor(user.restaurantId),
    };
  }
}
