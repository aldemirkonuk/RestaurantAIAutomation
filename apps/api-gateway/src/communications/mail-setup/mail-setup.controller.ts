/**
 * `/communications/mail-setup` — the house's mail setup page (founder /goal
 * 2026-11-07). See mail-setup.service.ts for what each answer means.
 *
 * JWT-guarded at the class level and scoped by the house from the SIGNED
 * token (`houseActor`), never from a body field or a path parameter. Who may
 * change it is checked in the service from the token's role, not by a
 * `@Roles` decorator — the same shape as mail.controller.ts, which keeps these
 * routes out of route-access.expected.json.
 *
 * Nothing here sends mail. A test letter is sent by the owner from their own
 * mailbox; this only hands them the address and the code.
 */

import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { houseActor, type TokenUser } from "../letters/house-letters.actor";
import { MailSetupService } from "./mail-setup.service";

@ApiTags("Communications")
@UseGuards(JwtAuthGuard)
@Controller("communications/mail-setup")
export class MailSetupController {
  constructor(private readonly setup: MailSetupService) {}

  @Get()
  @ApiOperation({
    summary:
      "Which mailbox the house's letters leave from, its Mudavym address, and whether its test letter arrived",
  })
  async read(
    @CurrentUser() user: TokenUser,
    @CurrentUser("role") role: string | null,
  ) {
    const { userId, restaurantId } = houseActor(user);
    return this.setup.read(restaurantId, userId, role);
  }
}
