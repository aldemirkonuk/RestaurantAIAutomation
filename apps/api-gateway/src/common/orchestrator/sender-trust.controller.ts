import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { SenderReputationService } from "./sender-reputation.service";

/**
 * Manager control for the D5 sender-trust store: trust/untrust a sender domain (which lifts
 * the SPF/DKIM quarantine for that domain — nothing else), and read the reputation list.
 */
@Controller("senders")
@UseGuards(JwtAuthGuard)
export class SenderTrustController {
  constructor(private readonly senderReputation: SenderReputationService) {}

  @Post("trust")
  async setTrust(
    @Body()
    body: {
      domain?: string;
      email?: string;
      trusted?: boolean;
      providerId?: string;
    },
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ domain: string; trusted: boolean }> {
    const target = (body?.domain || body?.email || "").trim();
    if (!target)
      throw new HttpException(
        "domain or email is required",
        HttpStatus.BAD_REQUEST,
      );
    const trusted = body?.trusted !== false;
    try {
      const domain = await this.senderReputation.setTrust(
        user.restaurantId,
        target,
        trusted,
        body?.providerId ?? null,
      );
      return { domain, trusted };
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to update sender trust",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("reputation")
  async list(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.senderReputation.list(user.restaurantId);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to load sender reputation",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
