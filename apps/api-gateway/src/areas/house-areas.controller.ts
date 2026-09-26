import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { type HouseActor, HouseAreasService } from "./house-areas.service";
import { SetAreaDto, SetAwayDto, SetMembershipDto } from "./house-areas.dto";
import type { HouseRole } from "./area-routing";

/**
 * The person on the verified token, in the house the token names (ADR 0218).
 *
 * The house is the token's, never the URL's or the body's: switching venue
 * re-issues the token, which is what makes it the right source (the same rule
 * `notifications.controller.ts` states). No house on the token is a 400, and a
 * token with no role in its house is a 403 — never a fallback to staff.
 */
export function actorOf(req: any): HouseActor {
  const u = req?.user ?? {};
  const restaurantId = typeof u.restaurantId === "string" ? u.restaurantId.trim() : "";
  if (!restaurantId) {
    throw new BadRequestException(
      "No active restaurant on this session, so areas and Away cannot be scoped to a house.",
    );
  }
  if (!u.userId) throw new ForbiddenException("Missing user identity");
  const raw = typeof u.role === "string" ? u.role.toLowerCase() : "";
  if (!raw) throw new ForbiddenException("You hold no role in this house.");
  // `admin` is accepted by RolesGuard as an owner/manager alias; what it means
  // is an open question (judge §6), so an area gate does not widen on it.
  const role: HouseRole = raw === "owner" || raw === "manager" ? raw : "staff";
  return { userId: u.userId, restaurantId, role, name: u.name ?? null };
}

@Controller("house")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class HouseAreasController {
  constructor(private readonly areas: HouseAreasService) {}

  /** Everyone: the six areas and their names. Staff see only their own memberships. */
  @Get("areas")
  readout(@Req() req: any) {
    return this.areas.readout(actorOf(req));
  }

  /** Owners and managers: rename an area or switch it off. */
  @Patch("areas/:kind")
  setArea(@Req() req: any, @Param("kind") kind: string, @Body() dto: SetAreaDto) {
    return this.areas.setArea(actorOf(req), kind, dto);
  }

  /** Owners and managers: put someone in an area, or set/clear their lead mark. */
  @Put("areas/:kind/members/:memberId")
  setMembership(
    @Req() req: any,
    @Param("kind") kind: string,
    @Param("memberId", new ParseUUIDPipe()) memberId: string,
    @Body() dto: SetMembershipDto,
  ) {
    return this.areas.setMembership(actorOf(req), kind, memberId, dto);
  }

  /** Owners and managers: take someone out of an area (and its lead mark with it). */
  @Delete("areas/:kind/members/:memberId")
  removeMembership(
    @Req() req: any,
    @Param("kind") kind: string,
    @Param("memberId", new ParseUUIDPipe()) memberId: string,
  ) {
    return this.areas.removeMembership(actorOf(req), kind, memberId);
  }

  /** Every Away window not yet over, dates only: owners and managers read all of them; staff read their own and a colleague's only once it is under way (ADR 0218 round 3), and are not told who set a colleague's. */
  @Get("away")
  listAway(@Req() req: any) {
    return this.areas.listAway(actorOf(req));
  }

  /** Your own Away dates (anyone), or someone else's (owners and managers, logged; an owner's only by an owner). */
  @Put("away/:userId")
  setAway(
    @Req() req: any,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() dto: SetAwayDto,
  ) {
    return this.areas.setAway(actorOf(req), userId, dto);
  }

  /** End Away early: your own (anyone), or someone else's (owners and managers, logged; an owner's only by an owner). */
  @Delete("away/:userId")
  endAway(@Req() req: any, @Param("userId", new ParseUUIDPipe()) userId: string) {
    return this.areas.endAway(actorOf(req), userId);
  }
}
