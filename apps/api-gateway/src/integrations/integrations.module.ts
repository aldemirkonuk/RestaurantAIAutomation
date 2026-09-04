import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";
import { CryptoModule } from "../common/crypto/crypto.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
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
  ],
  controllers: [IntegrationsOauthController],
  providers: [IntegrationsOauthService],
  exports: [IntegrationsOauthService],
})
export class IntegrationsModule {}
