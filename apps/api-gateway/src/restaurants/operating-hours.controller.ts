import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  OperatingHoursResponse,
  OperatingHoursService,
} from "./operating-hours.service";

interface AuthenticatedUser {
  userId: string;
  role: string;
}

/**
 * `restaurants/:restaurantId/operating-hours` (ADR 0093 D1).
 *
 * No `ValidationPipe` here, deliberately. The body is one free-shaped jsonb
 * value whose contract lives in `parseOperatingHours`, which reports EVERY
 * fault at once; a class-validator DTO would either duplicate that rule (a
 * third copy, after the Python module and the TypeScript mirror) or reject with
 * a message that names the wrong thing. The service validates and answers 400
 * with `{ message, errors[] }`.
 */
@Controller("restaurants")
@UseGuards(JwtAuthGuard)
export class OperatingHoursController {
  constructor(private readonly operatingHoursService: OperatingHoursService) {}

  @Get(":restaurantId/operating-hours")
  async getOperatingHours(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
  ): Promise<OperatingHoursResponse> {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    return this.operatingHoursService.getOperatingHours(userId, restaurantId);
  }

  /**
   * Body: `{ operatingHours: OperatingHours | null }`.
   *
   * `null` is a real value — "we do not know this venue's hours" — and is not
   * the same as seven empty days, which claims the venue never opens. A body
   * with no `operatingHours` key at all is refused rather than read as null,
   * because a typo in the field name would otherwise silently erase the hours.
   */
  @Put(":restaurantId/operating-hours")
  async putOperatingHours(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("restaurantId") restaurantId: string,
    @Body() body: { operatingHours?: unknown },
  ): Promise<OperatingHoursResponse> {
    const userId = (req.user as AuthenticatedUser)?.userId;
    if (!userId) throw new ForbiddenException("Missing user identity");
    const hasKey =
      body !== null && typeof body === "object" && "operatingHours" in body;
    return this.operatingHoursService.putOperatingHours(
      userId,
      restaurantId,
      hasKey ? body.operatingHours : undefined,
      { explicit: hasKey },
    );
  }
}
