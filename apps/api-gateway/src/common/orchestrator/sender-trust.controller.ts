import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { DatabaseService } from "../../database/database.service";
import { SenderReputationService } from "./sender-reputation.service";

/**
 * The body of POST /senders/trust. A class, not an inline type: an inline type erases to
 * `Object`, and the global ValidationPipe (main.ts) skips `Object`, so nothing was validated
 * and `trusted: "false"` read as trust.
 */
export class SetSenderTrustDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  email?: string;

  /** Omitted means trust (the existing contract). Present means a real boolean; null is refused. */
  @ValidateIf((o: SetSenderTrustDto) => o.trusted !== undefined)
  @IsBoolean()
  trusted?: boolean;

  @IsOptional()
  @IsUUID()
  providerId?: string;
}

/**
 * Owner or manager control for the D5 sender-trust store: trust/untrust a sender domain (which
 * lifts the SPF/DKIM quarantine for that domain — nothing else), and read the reputation list.
 *
 * RolesGuard is listed AFTER JwtAuthGuard: it reads request.user.role, which only JwtAuthGuard
 * sets. Before 2026-09-12 the only guard was JwtAuthGuard, so any member of a house could lift
 * the quarantine for any domain.
 */
@Controller("senders")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class SenderTrustController {
  constructor(
    private readonly senderReputation: SenderReputationService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Post("trust")
  async setTrust(
    @Body() body: SetSenderTrustDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ domain: string; trusted: boolean }> {
    const target = (body?.domain || body?.email || "").trim();
    if (!target)
      throw new HttpException(
        "domain or email is required",
        HttpStatus.BAD_REQUEST,
      );
    const trusted = body?.trusted ?? true;
    const providerId = body?.providerId ?? null;
    if (providerId) {
      await this.assertVendorOfHouse(user.restaurantId, providerId);
    }
    try {
      const domain = await this.senderReputation.setTrust(
        user.restaurantId,
        target,
        trusted,
        providerId,
      );
      return { domain, trusted };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
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

  /**
   * A providerId names a live vendor of THIS house, or the request is refused before anything is
   * written. sender_reputation.provider_id has no foreign key (baseline_from_production.sql:5325),
   * so nothing below this check would stop another house's vendor id, a deleted vendor, or an id
   * that names nothing. A failed read is a 503: an unread check is not a passed one.
   */
  private async assertVendorOfHouse(
    restaurantId: string,
    providerId: string,
  ): Promise<void> {
    const { data, error } = await this.databaseService.supabase
      .from("providers")
      .select("id")
      .eq("id", providerId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException(
        "Could not check that vendor; sender trust was not changed",
      );
    }
    if (!data) {
      throw new BadRequestException(
        "providerId does not name a vendor of this restaurant",
      );
    }
  }
}
