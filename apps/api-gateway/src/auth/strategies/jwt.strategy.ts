import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService, JwtPayload } from "../auth.service";
import { resolveJwtSecret } from "../jwt-secret";
import { devBypassEnvEnabled } from "../dev-bypass.util";
import { tokenHouse } from "../house-role";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(process.env.JWT_SECRET),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.authService.validateJwtPayload(payload);

    if (!user) {
      throw new UnauthorizedException();
    }

    // Tenant for this session must come from the signed JWT. `switchRestaurant`
    // re-issues tokens with a new `restaurantId` but does not update
    // `users.restaurant_id` in the database — using the DB column here overwrote
    // the active restaurant and broke tenant-scoped reads (e.g. getPendingDraft).
    const house = tokenHouse(payload);
    const restaurantId = house ?? user.restaurant_id;

    // OD-79: sourced from the database row, not `payload.emailVerified`.
    // Tokens are signed with the flag as it was at issue time, so a user who
    // verified after their last login would still carry `false` for 15
    // minutes. The row is authoritative; the token is a snapshot. That still
    // holds for every real session — the ONE exception is below, and it is not
    // a token snapshot either: it is re-derived from the environment here.
    //
    // A dev-bypass session is verified FOR THE PURPOSE OF THIS REQUEST. This is
    // the field `assertEmailVerified` reads in JwtAuthGuard
    // (guards/jwt-auth.guard.ts:82), so without the gate here the bypass could
    // open a page and then take 403 EMAIL_NOT_VERIFIED on every data call
    // behind it — a session that renders the shell and nothing in it.
    //
    // It is a server-side authorisation change and is written as one: BOTH
    // halves are re-checked HERE, on every request, rather than trusted from
    // the token. The marker alone does nothing — a validly-signed token
    // carrying it is inert wherever NODE_ENV=production or DEV_AUTH_BYPASS is
    // not "true", which is every deployed environment. The database row is not
    // read differently and is not written.
    const devBypass = payload.devBypass === true && devBypassEnvEnabled();

    // The role IN THE HOUSE THIS TOKEN NAMES (ADR 0162, answer A: "Only that
    // house"), read by `validateJwtPayload` the way `assertMembership` reads a
    // member. `RolesGuard` gates every `@Roles` route on this field, and it
    // used to be the global `users.role`, so a role changed in one house
    // decided what the person could do in another (v3.0-TECH-DEBT 44.1q). Null
    // is no role, and `@Roles` refuses it; it never falls back to `users.role`
    // or to the token's own snapshot. A token that names no house keeps
    // today's behaviour: `users.role`, then the token's claim.
    const role = house
      ? (user.house_role ?? null)
      : (user.role ?? payload.role);

    return {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      role,
      restaurantId,
      emailVerified: devBypass ? true : (user.email_verified ?? false),
      // The marker itself stays a straight report of what the token claims,
      // ungated — it answers "is this a dev session?", which is true or false
      // regardless of whether the environment honours it. Folding the env gate
      // into this field too would collapse "not a dev session" and "a dev
      // session this server refuses to honour" into one value, and the second
      // is the one worth being able to see in a log.
      devBypass: payload.devBypass === true,
      // When this session last proved who it is (ADR 0229; founder 2026-09-25
      // item 29): seconds since the epoch, stamped at an interactive sign-in
      // and carried by refresh and house switch. Null on a token minted before
      // the claim existed -- which reads as "not recent", never as "now".
      authTime:
        typeof payload.auth_time === "number" ? payload.auth_time : null,
    };
  }
}
