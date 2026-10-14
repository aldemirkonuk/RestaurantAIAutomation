import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ExpoPushService } from "../push/expo-push.service";
import { holdsHouseMoney } from "../procurement/documents/document-money-gate";
import { MobileService } from "./mobile.service";
import {
  FeedResponse,
  RegisterDeviceDto,
  TodayPulseResponse,
} from "./dto/mobile.dto";

/**
 * The pulse as this role may read it (F-957). Tonight's sales are the house's
 * money (ADR 0145's `money` row, DASH-W22): a role that does not hold it gets
 * no takings, no check count and no change on last week, and `salesState`
 * says why, so the phone tells staff the figures are kept for the owner and
 * managers rather than that the read failed. The decision count stays.
 * DASH-G6 will redraw this line when floor coverage gives each waiter their
 * own tables; until then it is the house's whole night or nothing.
 */
export function pulseForRole(
  pulse: TodayPulseResponse,
  role: string | null | undefined,
): TodayPulseResponse {
  if (holdsHouseMoney(role)) return pulse;
  return {
    ...pulse,
    salesState: "withheld",
    revenueToday: null,
    checksToday: null,
    netChecksToday: null,
    netNotRecordedByTaxToday: null,
    revenueLastWeek: null,
    deltaPct: null,
  };
}

@ApiTags("mobile")
@Controller("mobile")
@UseGuards(JwtAuthGuard)
export class MobileController {
  constructor(
    private readonly mobileService: MobileService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  @Get("feed")
  @ApiOperation({ summary: "Unified ranked decision feed for the mobile app" })
  async getFeed(
    @CurrentUser()
    user: {
      userId: string;
      restaurantId: string;
      role?: string | null;
    },
  ): Promise<FeedResponse> {
    try {
      // Staff get the order cards without their amounts (F-957).
      return await this.mobileService.getFeed(
        user.userId,
        user.restaurantId,
        user.role,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to build feed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("today-pulse")
  @ApiOperation({ summary: "Today's sales snapshot + decision counts" })
  async getTodayPulse(
    @CurrentUser()
    user: {
      userId: string;
      restaurantId: string;
      role?: string | null;
    },
  ): Promise<TodayPulseResponse> {
    try {
      // "Today" is the house's day (F-674); a phone's `start` is ignored.
      const pulse = await this.mobileService.getTodayPulse(
        user.userId,
        user.restaurantId,
      );
      // Staff get no takings (F-957): the token's house role decides.
      return pulseForRole(pulse, user.role);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to build today pulse",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("devices")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Register this device's Expo push token" })
  async registerDevice(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Body() dto: RegisterDeviceDto,
  ): Promise<void> {
    try {
      await this.expoPushService.registerDevice({
        userId: user.userId,
        restaurantId: user.restaurantId,
        expoPushToken: dto.expoPushToken,
        platform: dto.platform,
        appVersion: dto.appVersion,
      });
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to register device",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete("devices/:token")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Unregister a device push token (logout)" })
  async unregisterDevice(
    @CurrentUser("userId") userId: string,
    @Param("token") token: string,
  ): Promise<void> {
    await this.expoPushService.unregisterDevice(userId, token);
  }
}
