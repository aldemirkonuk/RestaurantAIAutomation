import { SetMetadata } from "@nestjs/common";

export const ALLOW_UNVERIFIED_KEY = "allowUnverified";

/**
 * Marks a route as reachable by an authenticated user who has NOT verified
 * their email address (OD-79).
 *
 * The allowlist has to exist, and it has to stay short. An unverified session
 * still needs to be able to (a) find out that it is unverified, (b) get
 * another verification email, and (c) leave. Block those and enforcement
 * becomes a trap rather than a gate: the web client populates its `user` from
 * `/auth/me`, so blocking that endpoint would leave the app unable to
 * discover why it was blocked, and the redirect loop it produces looks
 * exactly like a broken login.
 *
 * Everything not marked here is gated. Add to this list only when a route is
 * genuinely part of getting verified or getting out — never to make a feature
 * work for an unverified account.
 */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
