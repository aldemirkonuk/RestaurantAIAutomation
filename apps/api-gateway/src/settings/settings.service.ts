import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { FeatureFlagsDto, UpdateFeatureFlagsDto } from './dto/feature-flags.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Get feature flags for a restaurant
   */
  async getFeatureFlags(restaurantId: string): Promise<FeatureFlagsDto> {
    const { data, error } = await this.databaseService.client
      .from('restaurant_feature_flags')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No flags found, return defaults (all enabled)
        return this.getDefaultFeatureFlags();
      }
      this.logger.error(`Error fetching feature flags: ${error.message}`, error);
      throw new Error(`Failed to fetch feature flags: ${error.message}`);
    }

    // Remove id, restaurant_id, created_at, updated_at from response
    const {
      id,
      restaurant_id,
      created_at,
      updated_at,
      ...flags
    } = data;

    return flags as FeatureFlagsDto;
  }

  /**
   * Update feature flags for a restaurant
   */
  async updateFeatureFlags(
    restaurantId: string,
    updateDto: UpdateFeatureFlagsDto,
  ): Promise<FeatureFlagsDto> {
    // Check if flags exist
    const { data: existing } = await this.databaseService.client
      .from('restaurant_feature_flags')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .single();

    if (existing) {
      // Update existing flags
      const { data, error } = await this.databaseService.client
        .from('restaurant_feature_flags')
        .update(updateDto)
        .eq('restaurant_id', restaurantId)
        .select()
        .single();

      if (error) {
        this.logger.error(`Error updating feature flags: ${error.message}`, error);
        throw new Error(`Failed to update feature flags: ${error.message}`);
      }

      const {
        id,
        restaurant_id,
        created_at,
        updated_at,
        ...flags
      } = data;

      return flags as FeatureFlagsDto;
    } else {
      // Create new flags with defaults + updates
      const defaultFlags = this.getDefaultFeatureFlags();
      const newFlags = {
        restaurant_id: restaurantId,
        ...defaultFlags,
        ...updateDto,
      };

      const { data, error } = await this.databaseService.client
        .from('restaurant_feature_flags')
        .insert(newFlags)
        .select()
        .single();

      if (error) {
        this.logger.error(`Error creating feature flags: ${error.message}`, error);
        throw new Error(`Failed to create feature flags: ${error.message}`);
      }

      const {
        id,
        restaurant_id,
        created_at,
        updated_at,
        ...flags
      } = data;

      return flags as FeatureFlagsDto;
    }
  }

  /**
   * Check if a specific feature is enabled for a restaurant
   */
  async isFeatureEnabled(
    restaurantId: string,
    featureName: string,
  ): Promise<boolean> {
    const { data, error } = await this.databaseService.client
      .rpc('get_restaurant_feature_flag', {
        p_restaurant_id: restaurantId,
        p_feature_name: featureName,
      });

    if (error) {
      this.logger.error(
        `Error checking feature flag: ${error.message}`,
        error,
      );
      // Default to enabled if check fails
      return true;
    }

    return data ?? true;
  }

  /**
   * Get default feature flags (all enabled)
   */
  private getDefaultFeatureFlags(): FeatureFlagsDto {
    return {
      enable_inventory_storage_locations: true,
      enable_auto_procurement: true,
      enable_visual_verification: true,
      enable_predictive_analytics: true,
      enable_ai_negotiation: true,
      enable_sommelier_ai: true,
      enable_voice_agent: true,
      enable_menu_analyzer: true,
      enable_calendar_sync: true,
      enable_whatsapp_business: true,
      enable_quickbooks_sync: true,
      enable_recurring_orders: true,
      enable_invoice_scanning: true,
      enable_check_scanning: true,
      enable_auction_purchases: true,
      enable_profit_margin_tracking: true,
      enable_guest_crm: true,
      enable_wine_pairing_ai: true,
      enable_compliance_autopilot: true,
      enable_shrinkage_detective: true,
      enable_staff_training_simulator: true,
      enable_pour_cost_optimizer: true,
    };
  }
}
