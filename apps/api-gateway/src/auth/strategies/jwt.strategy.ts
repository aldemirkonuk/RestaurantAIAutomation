import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService, JwtPayload } from "../auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET || "your-secret-key-change-in-production",
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

    return {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role ?? payload.role,
      restaurantId,
    };
  }
}
