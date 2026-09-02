import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService, JwtPayload } from "../auth.service";
import { resolveJwtSecret } from "../jwt-secret";

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
    const restaurantId =
      payload.restaurantId && String(payload.restaurantId).trim().length > 0
        ? payload.restaurantId
        : user.restaurant_id;

    // OD-79. The signed payload has carried `emailVerified` since
    // `generateTokens` (auth.service.ts) built it, but this projection dropped
    // it — so `req.user.emailVerified` was `undefined` in every guard and
    // controller, and no server-side verification check was even expressible.
    //
    // Sourced from the DATABASE row, not `payload.emailVerified`: the payload
    // is a snapshot up to 15 minutes stale, so a user who verifies would keep
    // presenting `false` until their access token expired, and a flag cleared
    // by an operator would keep presenting `true`. `validateJwtPayload`
    // already SELECTs `*`, so this costs no extra query.
    const emailVerified = user.email_verified ?? false;

    return {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role ?? payload.role,
      restaurantId,
      emailVerified,
    };
  }
}
