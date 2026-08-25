import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";
import { CryptoModule } from "../common/crypto/crypto.module";
import { AuthModule } from "../auth/auth.module";
import { IntegrationsOauthController } from "./integrations-oauth.controller";
import { IntegrationsOauthService } from "./integrations-oauth.service";

@Module({
  imports: [ConfigModule, DatabaseModule, CryptoModule, AuthModule],
  controllers: [IntegrationsOauthController],
  providers: [IntegrationsOauthService],
  exports: [IntegrationsOauthService],
})
export class IntegrationsModule {}
