import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthedRateLimit, AuthedRateLimitGuard } from "../common/rate-limit/authed-rate-limit.guard";
import { READING_CATALOGUE } from "../ask-readings/reading-catalogue";
import { ReadingFolioStore } from "../ask-readings/reading-folio.store";
import { BoundAskService } from "./bound-ask.service";
import { BoundAskDto } from "./dto/bound-ask.dto";

type AskRequest = { user: { userId: string; restaurantId: string } };
@Controller("ask")
@UseGuards(JwtAuthGuard, AuthedRateLimitGuard, RolesGuard)
export class BoundAskController {
  constructor(private readonly ask: BoundAskService, private readonly folios: ReadingFolioStore) {}
  @Get("catalogue")
  catalogue() { return { readings: READING_CATALOGUE }; }
  @Post("folios")
  @AuthedRateLimit(
    { limit: 10, windowSeconds: 60, scope: "user", bucket: "mudavym-ask" },
    { limit: 200, windowSeconds: 3600, scope: "restaurant", bucket: "mudavym-ask" },
  )
  submit(@Req() req: AskRequest, @Body() body: BoundAskDto) {
    return this.ask.submit(req.user.restaurantId, req.user.userId, body);
  }
  @Get("folios")
  list(@Req() req: AskRequest) { return this.folios.list(req.user.restaurantId, req.user.userId); }
  @Get("folios/:id")
  get(@Req() req: AskRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.folios.get(req.user.restaurantId, req.user.userId, id);
  }
}
