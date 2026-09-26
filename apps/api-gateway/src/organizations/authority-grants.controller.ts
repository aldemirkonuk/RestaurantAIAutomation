import {
  Body,
  Controller,
  Get,
  Headers,
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
import { GrantActSealDto, IssueAuthorityGrantDto, SetGrantOwnerOnlyDto } from "./authority-grants.dto";

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
 * the token; the house is never a body field or a path parameter. Issue,
 * revoke, re-approve and delete each carry a seal minted by the matching
 * `seal-challenge` route (`x-seal-challenge`), founder answer 4.
 */
@ApiTags("Authority")
@UseGuards(JwtAuthGuard)
@Controller("authority/grants")
export class AuthorityGrantsController {
  constructor(private readonly grants: AuthorityGrantsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Who an owner has named to send to vendors with one hold. Owners see every grant; managers see every grant not marked owner-only; anyone else sees their own.",
  })
  async list(@CurrentUser() user: TokenUser) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.list(userId, restaurantId);
  }

  @Post("seal-challenge")
  @ApiOperation({ summary: "Begin the hold on naming someone: a one-time seal over the grant as it will be issued" })
  @ApiResponse({ status: 403, description: "The caller is not an owner of this house" })
  async issueSeal(@CurrentUser() user: TokenUser, @Body() dto: IssueAuthorityGrantDto) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.issueSeal(userId, restaurantId, dto);
  }

  @Post()
  @ApiOperation({ summary: "An owner names a person who may send to vendors with one hold, behind a redeemed seal" })
  @ApiResponse({ status: 201, description: "The grant, how many were told, and the sentence" })
  @ApiResponse({ status: 403, description: "The caller is not an owner of this house, or the seal was absent, spent or over a different grant" })
  async issue(
    @CurrentUser() user: TokenUser,
    @Body() dto: IssueAuthorityGrantDto,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.issue(userId, restaurantId, dto, challenge);
  }

  @Post(":id/seal-challenge")
  @ApiOperation({ summary: "Begin the hold on revoking, re-approving or deleting one grant" })
  @ApiResponse({ status: 409, description: "The grant is not in a state that act applies to" })
  async actSeal(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: GrantActSealDto,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.actSeal(userId, restaurantId, id, dto.act);
  }

  @Post(":id/revoke")
  @ApiOperation({ summary: "Any owner revokes a grant, behind a redeemed seal" })
  @ApiResponse({ status: 404, description: "No such grant in this house" })
  async revoke(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.revoke(userId, restaurantId, id, challenge);
  }

  @Post(":id/reapprove")
  @ApiOperation({
    summary:
      "A current owner re-approves a grant whose owner went, behind a redeemed seal; it then rests on them (founder, 2026-09-21)",
  })
  async reapprove(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.reapprove(userId, restaurantId, id, challenge);
  }

  @Post(":id/delete")
  @ApiOperation({ summary: "An owner deletes a grant waiting for re-approval, behind a redeemed seal; the ledger keeps its history" })
  async remove(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.remove(userId, restaurantId, id, challenge);
  }

  @Post(":id/owner-only")
  @ApiOperation({ summary: "An owner marks a grant owner-only (hidden from managers), or not" })
  async setOwnerOnly(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SetGrantOwnerOnlyDto,
  ) {
    const { userId, restaurantId } = actorOf(user);
    return this.grants.setOwnerOnly(userId, restaurantId, id, dto.ownerOnly);
  }
}
