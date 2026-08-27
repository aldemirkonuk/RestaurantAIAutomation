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

    // `oid` is OPTIONAL in `IProfile` and Azure omits it for some account
    // shapes. Two lines above, a missing email is guarded and the login is
    // refused; a missing `oid` was not, and it does not fail loudly — it flows
    // into `findOrCreateOAuthUser`, whose `providerId: string` says it cannot
    // be undefined, and lands in `users.oauth_id`, which is nullable `text`
    // (baseline:5857). The result is a Microsoft account persisted with NO
    // provider id: no exception, no log, and a row that cannot be matched by
    // provider afterwards.
    //
    // Refusing is right rather than generating a placeholder. `oid` is the
    // stable per-tenant subject identifier — inventing one would create an
    // account keyed to a value Microsoft will never send again, which is worse
    // than not creating it. The user retries or signs in another way; nothing
    // half-real is written.
    const providerId = profile.oid;
    if (!providerId) {
      return null;
    }

    const user = await this.authService.findOrCreateOAuthUser({
      provider: "microsoft",
      providerId,
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
