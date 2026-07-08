import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { CacheService } from "../../common/cache/cache.service";

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly keyPrefix = "auth:blacklist:";

  constructor(private readonly cacheService: CacheService) {}

  async blacklistToken(token: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    if (ttlSeconds <= 0) {
      return;
    }

    const key = this.getKey(token);
    await this.cacheService.set(key, { blacklisted: true }, ttlSeconds);
    this.logger.log({
      message: "Token blacklisted",
      ttlSeconds,
    });
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const key = this.getKey(token);
    const value = await this.cacheService.get<{ blacklisted: boolean }>(key);
    return Boolean(value?.blacklisted);
  }

  private getKey(token: string): string {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return `${this.keyPrefix}${hash}`;
  }
}
