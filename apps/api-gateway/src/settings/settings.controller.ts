import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { SettingsService } from './settings.service';
import {
  FeatureFlagsDto,
  UpdateFeatureFlagsDto,
  CheckFeatureFlagDto,
} from './dto/feature-flags.dto';

@ApiTags('settings')
@ApiBearerAuth('JWT-auth')
@Controller('settings')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('feature-flags')
  @ApiOperation({
    summary: 'Get feature flags for current restaurant',
    description: 'Returns all feature flags for the authenticated restaurant',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flags retrieved successfully',
    type: FeatureFlagsDto,
  })
  async getFeatureFlags(
    @CurrentUser('restaurantId') restaurantId: string,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.getFeatureFlags(restaurantId);
  }

  @Put('feature-flags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update feature flags for current restaurant',
    description: 'Updates feature flags for the authenticated restaurant. Only provided flags will be updated.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flags updated successfully',
    type: FeatureFlagsDto,
  })
  async updateFeatureFlags(
    @CurrentUser('restaurantId') restaurantId: string,
    @Body() updateDto: UpdateFeatureFlagsDto,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.updateFeatureFlags(restaurantId, updateDto);
  }

  @Post('feature-flags/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if a specific feature is enabled',
    description: 'Checks if a specific feature is enabled for a restaurant',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag check result',
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        feature_name: { type: 'string' },
        restaurant_id: { type: 'string' },
      },
    },
  })
  async checkFeatureFlag(
    @Body() checkDto: CheckFeatureFlagDto,
  ): Promise<{ enabled: boolean; feature_name: string; restaurant_id: string }> {
    const enabled = await this.settingsService.isFeatureEnabled(
      checkDto.restaurant_id,
      checkDto.feature_name,
    );
    return {
      enabled,
      feature_name: checkDto.feature_name,
      restaurant_id: checkDto.restaurant_id,
    };
  }

  @Get('feature-flags/:restaurantId')
  @ApiOperation({
    summary: 'Get feature flags for a specific restaurant (admin only)',
    description: 'Admin endpoint to get feature flags for any restaurant',
  })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant ID' })
  @ApiResponse({
    status: 200,
    description: 'Feature flags retrieved successfully',
    type: FeatureFlagsDto,
  })
  async getFeatureFlagsForRestaurant(
    @Param('restaurantId') restaurantId: string,
  ): Promise<FeatureFlagsDto> {
    return this.settingsService.getFeatureFlags(restaurantId);
  }
}
