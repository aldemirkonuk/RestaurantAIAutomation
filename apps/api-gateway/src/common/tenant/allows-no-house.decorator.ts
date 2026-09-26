import { SetMetadata } from "@nestjs/common";

export const ALLOWS_NO_HOUSE_KEY = "allowsNoHouse";

/**
 * Marks a route a session in NO house may call (ADR 0164, R4).
 *
 * A session names no house when the person has no membership, or has several
 * and has not chosen one yet. Such a session can say who it is, list its own
 * houses, choose one, accept an invitation, manage its own account and sign
 * out; everything else answers 403 `HOUSE_REQUIRED` from `JwtAuthGuard`, and
 * the client sends the person to the chooser. This is Clerk's "pending
 * session", treated as signed out for everything that belongs to a house.
 *
 * Why a list of exceptions and not a check per route: a route that reads
 * `req.user.restaurantId` and meets `null` fails in whatever way its queries
 * happen to fail, and a conditional filter (`if (restaurantId) q.eq(...)`)
 * would fail OPEN. Refusing every route that did not opt in closes that whole
 * class in one place. The routes marked are all in `AuthController`, plus the
 * person's own membership list (`GET /organizations/branches`).
 */
export const AllowsNoHouse = () => SetMetadata(ALLOWS_NO_HOUSE_KEY, true);
