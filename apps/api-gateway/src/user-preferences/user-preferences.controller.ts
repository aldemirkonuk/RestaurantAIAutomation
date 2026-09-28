import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserPreferencesService } from "./user-preferences.service";
import {
  UpdatePreferencesDto,
  UserPreferencesResponseDto,
} from "./dto/user-preferences.dto";

/**
 * The user whose preferences a request may read or change: the one on the
 * VERIFIED token (`JwtStrategy.validate` returns `userId`).
 *
 * Found 2026-09-20: GET and PATCH /users/:userId/preferences took the id from
 * the path and read or upserted `user_preferences` by it, so any signed-in
 * user could read another user's favorites, guidance, POS config or switch
 * their service-permission toggles by naming a uuid. `/notifications/preferences`
 * already had this check (2026-09-12); this controller did not.
 *
 * A client-supplied id is still ACCEPTED when it names the caller, because the
 * web client sends its own id (apps/web/src/hooks/useUserPreferences.ts). One
 * that names anybody else is refused, not silently replaced, so a client bug
 * that sends the wrong id is a visible 403 rather than a write to the wrong
 * row going unnoticed. No user on the token is a 401, never a fallback to the
 * client's id.
 */
function scopeOwnUserId(
  req: { user?: { userId?: string | null } } | undefined,
  ...named: Array<string | null | undefined>
): string {
  const own = req?.user?.userId;
  if (!own || String(own).trim() === "") {
    throw new UnauthorizedException(
      "No user on this session; preferences cannot be scoped.",
    );
  }
  const ownId = String(own);
  const mismatched = named.some(
    (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.toLowerCase() !== ownId.toLowerCase(),
  );
  if (mismatched) {
    throw new ForbiddenException(
      "Preferences can only be read or changed by their own user.",
    );
  }
  return ownId;
}

/** A refusal chosen above stays itself; anything else is a 500. */
function rethrow(error: unknown, fallback: string): never {
  if (error instanceof HttpException) throw error;
  throw new HttpException(
    (error as { message?: string })?.message || fallback,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

@ApiTags("user-preferences")
@Controller("users")
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(private readonly preferencesService: UserPreferencesService) {}

  @Get(":userId/preferences")
  @ApiOperation({ summary: "Get user preferences" })
  @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
  async getPreferences(
    @Param("userId") userId: string,
    @Req() req: Request & { user?: { userId?: string | null } },
  ): Promise<UserPreferencesResponseDto> {
    const own = scopeOwnUserId(req, userId);
    try {
      return await this.preferencesService.getPreferences(own);
    } catch (error) {
      rethrow(error, "Failed to fetch user preferences");
    }
  }

  @Patch(":userId/preferences")
  @ApiOperation({ summary: "Update user preferences (deep merge)" })
  @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
  async updatePreferences(
    @Param("userId") userId: string,
    @Body() dto: UpdatePreferencesDto,
    @Req() req: Request & { user?: { userId?: string | null } },
  ): Promise<UserPreferencesResponseDto> {
    const own = scopeOwnUserId(req, userId);
    try {
      return await this.preferencesService.updatePreferences(
        own,
        dto.preferences,
      );
    } catch (error) {
      rethrow(error, "Failed to update user preferences");
    }
  }
}
