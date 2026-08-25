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

  @Get("feed")
  @ApiOperation({ summary: "Unified ranked decision feed for the mobile app" })
  async getFeed(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<FeedResponse> {
    try {
      return await this.mobileService.getFeed(user.userId, user.restaurantId);
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
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Query("start") start?: string,
    @Query("end") end?: string,
  ): Promise<TodayPulseResponse> {
    try {
      return await this.mobileService.getTodayPulse(
        user.userId,
        user.restaurantId,
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
  async unregisterDevice(@Param("token") token: string): Promise<void> {
    await this.expoPushService.unregisterDevice(token);
  }
}
