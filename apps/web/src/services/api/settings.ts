import { apiClient } from './client';

/**
 * Only the flags something actually reads.
 *
 * This interface used to list 22 booleans. OD-86 (2026-08-26) found that 21 of
 * them were read by no code anywhere, and that none of the 22 columns behind
 * them existed in the database — so the GET returned invented values and the
 * PUT always failed. The other 21 are now UI-side metadata in
 * `components/settings/inactiveFeatures.ts`, rendered without a switch.
 * See `apps/api-gateway/src/settings/feature-flag-registry.ts`.
 */
export interface FeatureFlags {
  /** AI reads and answers vendor email at all. */
  enable_ai_negotiation: boolean;
  /** AI replies leave for the vendor with no human approval. */
  enable_ai_autonomous_send: boolean;
}

export type UpdateFeatureFlagsRequest = Partial<FeatureFlags>;

export interface FeatureFlagCheckResult {
  enabled: boolean;
  /** False means nothing reads the flag — `enabled` describes nothing. */
  active: boolean;
  feature_name: string;
  restaurant_id: string;
}

export const settingsApi = {
  async getFeatureFlags(): Promise<FeatureFlags> {
    const response = await apiClient.get<FeatureFlags>('/settings/feature-flags');
    return response.data;
  },

  async updateFeatureFlags(flags: UpdateFeatureFlagsRequest): Promise<FeatureFlags> {
    const response = await apiClient.put<FeatureFlags>('/settings/feature-flags', flags);
    return response.data;
  },

  async checkFeatureFlag(
    restaurantId: string,
    featureName: string,
  ): Promise<FeatureFlagCheckResult> {
    const response = await apiClient.post<FeatureFlagCheckResult>(
      '/settings/feature-flags/check',
      { restaurant_id: restaurantId, feature_name: featureName },
    );
    return response.data;
  },
};
