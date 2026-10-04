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
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ExpoPushService } from "../push/expo-push.service";
import { MobileService } from "./mobile.service";
import {
  FeedResponse,
  RegisterDeviceDto,
  TodayPulseResponse,
} from "./dto/mobile.dto";

@ApiTags("mobile")
@Controller("mobile")
@UseGuards(JwtAuthGuard)
export class MobileController {
  constructor(
    private readonly mobileService: MobileService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  // `user.role` is the caller's role IN THIS HOUSE, re-read from their access
  // row on every request by `JwtStrategy.validate` (ADR 0162); null is no role.
  // The service decides from it who sees money (ADR 0253 round 2).
  @Get("feed")
  @ApiOperation({
    summary: "Unified ranked decision feed for the mobile app",
    description:
      "Owners and managers get every card as written. Anyone else in the house gets no order-approval cards, no `amount` on any card and no `counts.orderApprovals`; on a card built from a notification, the subtitle is the notification's message only for a type on the service's money-free list (otherwise the card's neutral line), and `meta` carries only the non-money keys `orderId`, `orderNumber`, `wineName` and `quantity` (ADR 0253, answered 2026-10-01 round 2).",
  })
  async getFeed(
    @CurrentUser()
    user: {
      userId: string;
      restaurantId: string;
      role?: string | null;
    },
  ): Promise<FeedResponse> {
    try {
      return await this.mobileService.getFeed(
        user.userId,
        user.restaurantId,
        user.role ?? null,
      );
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to build feed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("today-pulse")
  @ApiOperation({
    summary: "Today's sales snapshot + decision counts",
    description:
      "The sales figures (`revenueToday`, `checksToday`, `revenueLastWeek`, `deltaPct`) are returned to owners and managers only; for anyone else they are absent and the sales are not read (ADR 0253, answered 2026-10-01 round 2).",
  })
  async getTodayPulse(
    @CurrentUser()
    user: { userId: string; restaurantId: string; role?: string | null },
    @Query("start") start?: string,
    @Query("end") end?: string,
  ): Promise<TodayPulseResponse> {
    try {
      return await this.mobileService.getTodayPulse(
        user.userId,
        user.restaurantId,
        user.role ?? null,
        start,
        end,
      );
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
