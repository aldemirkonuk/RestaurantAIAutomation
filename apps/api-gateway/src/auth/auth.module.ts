import { Module, Logger, OnModuleInit, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { PasswordResetThrottleGuard } from "./guards/password-reset-throttle.guard";
import { DatabaseModule } from "../database/database.module";
import { CacheModule } from "../common/cache/cache.module";
import { TokenBlacklistService } from "./services/token-blacklist.service";
import { GoogleStrategy } from "./strategies/google.strategy";
import { MicrosoftStrategy } from "./strategies/microsoft.strategy";
import { CommunicationsModule } from "../communications/communications.module";
import { resolveJwtSecret } from "./jwt-secret";

@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    ConfigModule,
    forwardRef(() => CommunicationsModule),
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: resolveJwtSecret(configService.get("JWT_SECRET")),
        signOptions: { expiresIn: "15m" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    PasswordResetThrottleGuard,
    TokenBlacklistService,
    // Google OAuth Strategy - conditionally provided at runtime
    {
      provide: GoogleStrategy,
      useFactory: (authService: AuthService, configService: ConfigService) => {
        const clientId = configService.get("GOOGLE_CLIENT_ID");
        const clientSecret = configService.get("GOOGLE_CLIENT_SECRET");
        if (clientId && clientSecret) {
          Logger.log("Google OAuth enabled", "AuthModule");
          return new GoogleStrategy(authService);
        }
        Logger.warn(
          "Google OAuth disabled - GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured",
          "AuthModule",
        );
        return null;
      },
      inject: [AuthService, ConfigService],
    },
    // Microsoft OAuth Strategy - conditionally provided at runtime
    {
      provide: MicrosoftStrategy,
      useFactory: (authService: AuthService, configService: ConfigService) => {
        const clientId = configService.get("MICROSOFT_CLIENT_ID");
        const clientSecret = configService.get("MICROSOFT_CLIENT_SECRET");
        if (clientId && clientSecret) {
          Logger.log("Microsoft OAuth enabled", "AuthModule");
          return new MicrosoftStrategy(authService);
        }
        Logger.warn(
          "Microsoft OAuth disabled - MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not configured",
          "AuthModule",
        );
        return null;
      },
      inject: [AuthService, ConfigService],
    },
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, TokenBlacklistService],
})
export class AuthModule {}
