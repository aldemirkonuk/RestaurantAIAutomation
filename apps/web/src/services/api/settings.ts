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
  /**
   * A scheduled job reads this house's mailbox through a person's Gmail grant.
   * Writable since 2026-09-05, when `PUT /settings/feature-flags` gained
   * `assertCanManageRestaurant` — the condition ADR 0118 D8-D11 withheld it on.
   */
  enable_house_inbox_read: boolean;
}

export type UpdateFeatureFlagsRequest = Partial<FeatureFlags>;

export interface FeatureFlagCheckResult {
  enabled: boolean;
  /** False means nothing reads the flag — `enabled` describes nothing. */
  active: boolean;
  feature_name: string;
  restaurant_id: string;
}

/**
 * The house's reporting currency, as `GET /settings/currency` answers it.
 *
 * THREE STATES, never two. `readable: false` is a failed READ and carries a
 * `reason`; `code: null` is an unanswered QUESTION; a code is an answer. A
 * caller that collapses the first two into "no currency" reports an outage as a
 * settled fact, which is the [[absence-reported-as-health]] shape (ADR 0083).
 * Mirrors `HouseCurrencyReadout` on the gateway and the identical interface in
 * `pages/settings/next/useSettingsNextData.ts`, which owns the settings page's
 * own copy.
 */
export interface HouseCurrency {
  restaurantId: string;
  code: string | null;
  country: string | null;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
}

export const settingsApi = {
  /**
   * Read-only. Used by the receiving door to OFFER the house's code beside a
   * typed price (founder, 2026-09-06 batch 67) — offered as a labelled choice,
   * never written into the field for somebody.
   */
  async houseCurrency(): Promise<HouseCurrency> {
    const response = await apiClient.get<HouseCurrency>('/settings/currency');
    return response.data;
  },

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
