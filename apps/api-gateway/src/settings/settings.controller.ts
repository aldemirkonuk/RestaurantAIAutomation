import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { SettingsService } from "./settings.service";
import {
  ApprovalThresholdsService,
  type ThresholdsReadout,
} from "./approval-thresholds.service";
import { SetApprovalThresholdDto } from "../vendor-terms/dto/vendor-terms.dto";
import {
  FeatureFlagsDto,
  UpdateFeatureFlagsDto,
  CheckFeatureFlagDto,
  FeatureFlagCheckResultDto,
} from "./dto/feature-flags.dto";

@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings")
@UseGuards(JwtAuthGuard, TenantGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly thresholds: ApprovalThresholdsService,
  ) {}

  @Get("feature-flags")
  @ApiOperation({
    summary: "Get feature flags for current restaurant",
    description: "Returns all feature flags for the authenticated restaurant",
  })
  @ApiResponse({
    status: 200,
    description: "Feature flags retrieved successfully",
    type: FeatureFlagsDto,
  })
  async getFeatureFlags(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.getFeatureFlags(restaurantId);
  }

  @Put("feature-flags")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Update feature flags for current restaurant",
    description:
      "Updates feature flags for the authenticated restaurant. Only provided flags will be updated.",
  })
  @ApiResponse({
    status: 200,
    description: "Feature flags updated successfully",
    type: FeatureFlagsDto,
  })
  async updateFeatureFlags(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() updateDto: UpdateFeatureFlagsDto,
    @CurrentUser("userId") userId: string,
  ): Promise<FeatureFlagsDto> {
    // The author of the change comes from the signed token and nowhere else.
    // `public.users.user_id` — never an `auth.users` id: the two tables are
    // disjoint in this database and `system_audit_log.actor_id` has no FK, so a
    // wrong id would insert cleanly and never resolve to a person.
    return this.settingsService.updateFeatureFlags(restaurantId, updateDto, userId);
  }

  @Get("approval-thresholds")
  @ApiOperation({
    summary: "Who must approve an order above what amount",
    description:
      "The house's own rules, each with who set it and when, plus how often each WOULD have fired over the orders already in the books. `enforcement.enforcedBy` is empty: nothing in the gateway consults these rows yet, and the payload says exactly where enforcement has to land.",
  })
  @ApiResponse({ status: 200, description: "The threshold readout" })
  async getApprovalThresholds(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<ThresholdsReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no policy to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.thresholds.read(restaurantId);
  }

  @Put("approval-thresholds")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set one approval rule",
    description:
      "`enabled: false` keeps the row and its number, so switching a rule back on does not lose the figure somebody chose. The response carries `audited` and `auditReason` so a change whose audit row failed is visible rather than assumed.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  async setApprovalThreshold(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetApprovalThresholdDto,
    @CurrentUser("userId") userId: string,
  ) {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.thresholds.write(restaurantId, dto, userId ?? null);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to record the threshold",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("feature-flags/check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Check one feature flag",
    description:
      "Returns `enabled` alongside `active`. `active: false` means no code reads this flag, so `enabled` describes nothing and must not be shown as a setting.",
  })
  @ApiResponse({
    status: 200,
    description: "Feature flag check result",
    type: FeatureFlagCheckResultDto,
  })
  async checkFeatureFlag(
    @Body() checkDto: CheckFeatureFlagDto,
  ): Promise<FeatureFlagCheckResultDto> {
    const { enabled, active } = await this.settingsService.isFeatureEnabled(
      checkDto.restaurant_id,
      checkDto.feature_name,
    );
    return {
      enabled,
      active,
      feature_name: checkDto.feature_name,
      restaurant_id: checkDto.restaurant_id,
    };
  }

  @Get("feature-flags/:restaurantId")
  @ApiOperation({
    summary: "Get feature flags for a specific restaurant (admin only)",
    description: "Admin endpoint to get feature flags for any restaurant",
  })
  @ApiParam({ name: "restaurantId", description: "Restaurant ID" })
  @ApiResponse({
    status: 200,
    description: "Feature flags retrieved successfully",
    type: FeatureFlagsDto,
  })
  async getFeatureFlagsForRestaurant(
    @Param("restaurantId") restaurantId: string,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.getFeatureFlags(restaurantId);
  }
}
