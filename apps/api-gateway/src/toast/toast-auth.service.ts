import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { CacheService } from "../common/cache/cache.service";

interface ToastTokenResponse {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class ToastAuthService {
  private readonly logger = new Logger(ToastAuthService.name);
  private readonly cachePrefix = "toast:token:";
  private readonly sandboxApiUrl = "https://ws-api-sandbox.toasttab.com";
  private readonly productionApiUrl = "https://ws-api.toasttab.com";

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  async getAccessToken(restaurantGuid: string): Promise<string> {
    const cacheKey = `${this.cachePrefix}${restaurantGuid}`;
    const cached = await this.cacheService.get<{ token: string }>(cacheKey);
    if (cached?.token) {
      return cached.token;
    }

    const token = await this.fetchToken(restaurantGuid);
    return token;
  }

  async refreshToken(restaurantGuid: string): Promise<string> {
    return this.fetchToken(restaurantGuid, true);
  }

  async getTokenForRestaurant(restaurantGuid: string): Promise<string> {
    return this.getAccessToken(restaurantGuid);
  }

  private async fetchToken(
    restaurantGuid: string,
    forceRefresh = false,
  ): Promise<string> {
    const cacheKey = `${this.cachePrefix}${restaurantGuid}`;
    if (!forceRefresh) {
      const cached = await this.cacheService.get<{ token: string }>(cacheKey);
      if (cached?.token) {
        return cached.token;
      }
    }

    const clientId = this.configService.get<string>("TOAST_CLIENT_ID", "");
    const clientSecret = this.configService.get<string>(
      "TOAST_CLIENT_SECRET",
      "",
    );
    const environment = this.configService.get<string>(
      "TOAST_ENVIRONMENT",
      "sandbox",
    );
    const apiUrl =
      environment === "production" ? this.productionApiUrl : this.sandboxApiUrl;

    try {
      const response = await axios.post(
        `${apiUrl}/authentication/v1/authentication/login`,
        {
          clientId,
          clientSecret,
          userAccessType: "TOAST_MACHINE_CLIENT",
        },
        {
          headers: {
            "Toast-Restaurant-External-ID": restaurantGuid,
          },
        },
      );

      const data = response.data as ToastTokenResponse;
      const ttl = Math.max(60, data.expiresIn - 60);
      await this.cacheService.set(cacheKey, { token: data.accessToken }, ttl);

      return data.accessToken;
    } catch (error) {
      this.logger.error({
        message: "Failed to fetch Toast token",
        restaurantGuid,
        error: error.message,
      });
      throw error;
    }
  }
}
