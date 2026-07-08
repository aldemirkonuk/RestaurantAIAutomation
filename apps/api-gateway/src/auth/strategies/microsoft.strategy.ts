import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import {
  OIDCStrategy,
  IOIDCStrategyOptionWithoutRequest,
  IProfile,
} from "passport-azure-ad";
import { AuthService } from "../auth.service";

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(
  OIDCStrategy,
  "microsoft",
) {
  constructor(private authService: AuthService) {
    const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
    const options: IOIDCStrategyOptionWithoutRequest = {
      identityMetadata: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
      clientID: process.env.MICROSOFT_CLIENT_ID || "",
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
      responseType: "code",
      responseMode: "query",
      redirectUrl:
        process.env.MICROSOFT_CALLBACK_URL ||
        "/api/v1/auth/oauth/microsoft/callback",
      allowHttpForRedirectUrl: true,
      scope: ["profile", "email", "openid"],
      passReqToCallback: false,
    };
    super(options);
  }

  async validate(profile: IProfile) {
    const email = profile.upn || profile._json?.preferred_username;
    if (!email) {
      return null;
    }

    const user = await this.authService.findOrCreateOAuthUser({
      provider: "microsoft",
      providerId: profile.oid,
      email,
      name: profile.displayName || email,
    });

    return {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantId: user.restaurant_id,
    };
  }
}
