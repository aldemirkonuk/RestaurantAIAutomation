import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";
import { CryptoModule } from "../common/crypto/crypto.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { RetentionModule } from "../communications/retention/retention.module";
import { IntegrationsOauthController } from "./integrations-oauth.controller";
import { IntegrationsOauthService } from "./integrations-oauth.service";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CryptoModule,
    AuthModule,
    // For `assertCanManageRestaurant` on the house-grants routes: a manager may
    // SEE what members have connected, and one implementation of "who may"
    // rather than a second copy of the rule (ADR 0114).
    OrganizationsModule,
    // ADR 0118 (retention) — revoking a reading grant deletes the raw mail it
    // mirrored, inside `disconnect`. `RetentionModule` imports only Database,
    // Notifications and Auth, so this edge closes no ring: nothing on
    // `AuthModule`'s own require chain reaches this module, and only
    // `app.module` imports this one.
    RetentionModule,
  ],
  controllers: [IntegrationsOauthController],
  providers: [IntegrationsOauthService],
  exports: [IntegrationsOauthService],
})
export class IntegrationsModule {}
