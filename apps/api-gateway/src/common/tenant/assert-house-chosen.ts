import { ForbiddenException } from "@nestjs/common";
import { HOUSE_REQUIRED } from "../../auth/house-choice";

/**
 * A session in no house may call only a route marked `@AllowsNoHouse()` (ADR
 * 0164, R4). Runs inside `JwtAuthGuard` after passport, for the reason every
 * check there does: it is the first line at which `request.user` exists.
 */
export function assertHouseChosen(
  request: { user?: { restaurantId?: string | null } | null },
  allowsNoHouse: boolean,
): void {
  if (allowsNoHouse) return;
  const user = request.user;
  if (!user) return; // authentication is JwtAuthGuard's job, not this one's
  if (!user.restaurantId) {
    throw new ForbiddenException({
      message: "Choose a house first.",
      code: HOUSE_REQUIRED,
    });
  }
}
