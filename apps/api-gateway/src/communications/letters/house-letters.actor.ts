/**
 * The person and the house a letters or archive request acts for, read from
 * the SIGNED token and nowhere else.
 *
 * WHY THIS FILE EXISTS (2026-09-12)
 * ---------------------------------
 * `house-letters.controller.ts` and `house-mail-archive.controller.ts` each
 * typed their caller as `{ id, restaurantId }` and read `user.id`.
 * `JwtStrategy.validate` builds `request.user` with `userId` and has never had
 * an `id` (auth/strategies/jwt.strategy.ts), and `@CurrentUser()` hands that
 * object over untyped, so the annotation compiled and every read was
 * `undefined`. The consequences were silent, which is why they lasted:
 *
 *   - GET /communications/letters/sender never recognised the caller's own
 *     sending grant, and told a manager their letter leaves from somebody
 *     else's mailbox.
 *   - POST /communications/letters and /letters/templates wrote a writer and
 *     an editor of `undefined`, which JSON drops: rows that name nobody, and an
 *     edited template that kept the previous editor's name.
 *   - Every archive act minted, redeemed and FILED its seal with no actor, so
 *     no seal could be minted (`mcp_seal_challenges.actor_user_id` is NOT
 *     NULL) and every refusal went into `system_audit_log` naming nobody.
 *
 * Both controllers now take their actor through `houseActor`, which returns
 * the two ids by the names the token really uses, or refuses. There is no
 * fallback to another field and no default: a record that names nobody is not
 * a smaller record, it is a false one.
 *
 * The services that write the row refuse a blank actor as well
 * (`assertNamedActor`), so a future caller that is not one of these two
 * controllers cannot write a nameless row either.
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";

/**
 * `request.user` as `JwtStrategy.validate` builds it — only the two fields
 * read here. Both are optional in the type because `@CurrentUser()` is
 * untyped at runtime, and that is exactly how `id` went unnoticed.
 */
export interface TokenUser {
  userId?: string | null;
  restaurantId?: string | null;
}

/** Who is acting, and for which house. Both are always non-blank. */
export interface HouseActor {
  userId: string;
  restaurantId: string;
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * The actor, or a refusal before anything is read or written.
 *
 * No person is 401, matching the gateway's existing wording for the same fact
 * (organizations.controller.ts, mcp-connections.controller.ts). No house is
 * 400, again matching mcp-connections: a session with no active restaurant
 * cannot address a house's mail, and saying so is not the same as answering
 * "this house has nothing".
 */
export function houseActor(user: TokenUser | null | undefined): HouseActor {
  const userId = nonBlank(user?.userId);
  if (!userId) {
    throw new UnauthorizedException(
      "Missing user identity. This session does not name a person, so nothing was read and nothing was recorded.",
    );
  }
  const restaurantId = nonBlank(user?.restaurantId);
  if (!restaurantId) {
    throw new BadRequestException(
      "This session has no active restaurant, so there is no house whose mail this request could address. Nothing was read and nothing was recorded.",
    );
  }
  return { userId, restaurantId };
}

/**
 * The writer's own refusal: the row about to be written must name a person.
 *
 * `act` completes the sentence "Nothing was ...", e.g. "queued".
 */
export function assertNamedActor(userId: unknown, act: string): string {
  const named = nonBlank(userId);
  if (!named) {
    throw new UnauthorizedException(
      `Missing user identity. A record that names nobody is not written, so nothing was ${act}.`,
    );
  }
  return named;
}
