import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthorityGrantsService } from "./authority-grants.service";
import { IssueAuthorityGrantDto } from "./authority-grants.dto";

/** `request.user` as `JwtStrategy.validate` builds it — the two fields read here. */
interface TokenUser {
  userId?: string | null;
  restaurantId?: string | null;
}

/** The actor and the house, from the SIGNED token and nowhere else. */
function actorOf(user: TokenUser): { userId: string; restaurantId: string } {
  const userId = typeof user?.userId === "string" ? user.userId.trim() : "";
  const restaurantId = typeof user?.restaurantId === "string" ? user.restaurantId.trim() : "";
  if (!userId || !restaurantId) {
    throw new UnauthorizedException("This session names no person or no house.");
  }
  return { userId, restaurantId };
}

/**
 * `/authority/grants` — the ADR 0112 F12 grant row, for vendor sends (ADR 0175
 * D10; founder, 2026-09-21). Every route is JWT-guarded and tenant-scoped from
 * the token; the house is never a body field or a path parameter.
 */
@ApiTags("Authority")
@UseGuards(JwtAuthGuard)
@Controller("authority/grants")
export class AuthorityGrantsController {
  constructor(private readonly grants: AuthorityGrantsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Who an owner has named to send to vendors with one hold. Owners see every grant; anyone else sees their own.",
  })
  async list(@CurrentUser() user: TokenUser) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.list(userId, restaurantId);
  }

  @Post()
  @ApiOperation({ summary: "An owner names a person who may send to vendors with one hold" })
  @ApiResponse({ status: 201, description: "The grant, how many were told, and the sentence" })
  @ApiResponse({ status: 403, description: "The caller is not an owner of this house" })
  async issue(@CurrentUser() user: TokenUser, @Body() dto: IssueAuthorityGrantDto) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.issue(userId, restaurantId, dto);
  }

  @Post(":id/revoke")
  @ApiOperation({ summary: "Any owner revokes a grant" })
  @ApiResponse({ status: 404, description: "No such grant in this house" })
  async revoke(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.revoke(userId, restaurantId, id);
  }
}
