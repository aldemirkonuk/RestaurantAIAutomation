import { apiClient } from './client';

export interface FeatureFlags {
  enable_inventory_storage_locations: boolean;
  enable_auto_procurement: boolean;
  enable_visual_verification: boolean;
  enable_predictive_analytics: boolean;
  enable_ai_negotiation: boolean;
  enable_sommelier_ai: boolean;
  enable_voice_agent: boolean;
  enable_menu_analyzer: boolean;
  enable_calendar_sync: boolean;
  enable_whatsapp_business: boolean;
  enable_quickbooks_sync: boolean;
  enable_recurring_orders: boolean;
  enable_invoice_scanning: boolean;
  enable_check_scanning: boolean;
  enable_auction_purchases: boolean;
  enable_profit_margin_tracking: boolean;
  enable_guest_crm: boolean;
  enable_wine_pairing_ai: boolean;
  enable_compliance_autopilot: boolean;
  enable_shrinkage_detective: boolean;
  enable_staff_training_simulator: boolean;
  enable_pour_cost_optimizer: boolean;
}

export interface UpdateFeatureFlagsRequest {
  enable_inventory_storage_locations?: boolean;
  enable_auto_procurement?: boolean;
  enable_visual_verification?: boolean;
  enable_predictive_analytics?: boolean;
  enable_ai_negotiation?: boolean;
  enable_sommelier_ai?: boolean;
  enable_voice_agent?: boolean;
  enable_menu_analyzer?: boolean;
  enable_calendar_sync?: boolean;
  enable_whatsapp_business?: boolean;
  enable_quickbooks_sync?: boolean;
  enable_recurring_orders?: boolean;
  enable_invoice_scanning?: boolean;
  enable_check_scanning?: boolean;
  enable_auction_purchases?: boolean;
  enable_profit_margin_tracking?: boolean;
  enable_guest_crm?: boolean;
  enable_wine_pairing_ai?: boolean;
  enable_compliance_autopilot?: boolean;
  enable_shrinkage_detective?: boolean;
  enable_staff_training_simulator?: boolean;
  enable_pour_cost_optimizer?: boolean;
}

export const settingsApi = {
  /**
   * Get feature flags for the current restaurant
   */
  async getFeatureFlags(): Promise<FeatureFlags> {
    const response = await apiClient.get<FeatureFlags>('/settings/feature-flags');
    return response.data;
  },

  /**
   * Update feature flags for the current restaurant
   */
  async updateFeatureFlags(flags: UpdateFeatureFlagsRequest): Promise<FeatureFlags> {
    const response = await apiClient.put<FeatureFlags>('/settings/feature-flags', flags);
    return response.data;
  },

  /**
   * Check if a specific feature is enabled
   */
  async checkFeatureFlag(restaurantId: string, featureName: string): Promise<boolean> {
    const response = await apiClient.post<{ enabled: boolean }>('/settings/feature-flags/check', {
      restaurant_id: restaurantId,
      feature_name: featureName,
    });
    return response.data.enabled;
  },
};
