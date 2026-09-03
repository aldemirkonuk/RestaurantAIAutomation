/**
 * Recipient Resolver Service
 * Resolves notification recipients based on restaurant, roles, and channel preferences.
 * Supports multi-restaurant, multi-role routing with fallback to defaults.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";

export type RecipientRole =
  | "manager"
  | "staff"
  | "provider"
  | "sommelier"
  | "customer";
/**
 * The channels this resolver can answer for.
 *
 * **`"push"` is deliberately absent, and asking for it is a compile error
 * rather than an empty array** (ADR 0027 / OD-95). This resolver never
 * resolved a single push recipient, and the shape it offered could not have
 * been used if it had:
 *
 * - It read `push_subscriptions`, which does not exist in production
 *   (`to_regclass` → NULL, 2026-08-26) and is declared only by an archived
 *   migration. It must NOT be created: it is an abandoned storage model.
 * - The store that replaced it, `notification_preferences.push_subscription`,
 *   has no working writer. `NotificationsService.registerPushSubscription`
 *   upserts `onConflict: "user_id"`, but the table's only unique index is on
 *   `(restaurant_id, user_id)`, so Postgres answers `42P10` and the statement
 *   cannot even be planned (verified against production, 2026-08-26; the fork
 *   is held open by `supabase/migrations/20260813090000_fix_remaining_upsert_targets.sql` §3).
 *   Repointing here would have swapped a loud 404 for a permanently empty
 *   read that looks successful — the exact failure ADR 0020 forbids.
 * - **Both push senders address recipients by USER ID and enumerate devices
 *   themselves**: `NotificationsService.sendWebPush(userId, …)` reads
 *   `notification_preferences.push_subscription`, and
 *   `ExpoPushService.sendToUsers(userIds, …)` reads
 *   `mobile_devices.expo_push_token`. Neither accepts a subscription id, an
 *   endpoint, or a token from outside. There is therefore no push-recipient
 *   shape this resolver could return that both senders would take.
 *
 * If push recipients are ever meant to flow through here, the correct output
 * is user ids — which `getUserIdsForRoles` already computes — not devices.
 * That is a design addition, not a restoration of what was deleted.
 */
export type NotificationChannel = "email" | "sms";

export interface ResolvedRecipients {
  emails: string[];
  phones: string[];
}

export interface RecipientQuery {
  restaurantId: string;
  roles: RecipientRole[];
  channels?: NotificationChannel[];
  providerId?: string; // For provider-specific notifications
  /**
   * Allow falling back to the global MANAGER_EMAIL / MANAGER_PHONE env vars when
   * this restaurant resolves to no recipients of its own.
   *
   * Defaults to `true`, which is the historical behaviour every existing caller
   * relies on. Multi-tenant callers MUST pass `false` for any restaurant other
   * than `DEFAULT_RESTAURANT_ID` (OD-87 / ADR 0022): those env vars name ONE
   * restaurant's manager, so falling back sends restaurant B's operational data
   * to restaurant A's inbox.
   *
   * This is not hypothetical. Verified in production on 2026-08-26: 6 of 10
   * restaurants have only an `owner` row in `user_restaurant_access` and no
   * `manager`, while the scheduled jobs ask for `["manager"]` — so those six
   * resolve to zero users and hit this fallback every time.
   */
  allowDefaultFallback?: boolean;
}

@Injectable()
export class RecipientResolverService {
  private readonly logger = new Logger(RecipientResolverService.name);
  private defaultEmail: string;
  private defaultRestaurantId: string | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    this.defaultEmail = this.configService.get<string>("MANAGER_EMAIL") || "";
    this.defaultRestaurantId =
      this.configService.get<string>("DEFAULT_RESTAURANT_ID") || null;
  }

  /**
   * Resolve recipients for a notification based on restaurant and roles.
   */
  async resolveRecipients(query: RecipientQuery): Promise<ResolvedRecipients> {
    const result: ResolvedRecipients = {
      emails: [],
      phones: [],
    };

    const channels = query.channels || ["email", "sms"];
    const allowDefaultFallback = query.allowDefaultFallback !== false;

    /**
     * The env-var fallback, or nothing when this caller has forbidden it.
     * Silence is logged at WARN rather than dropped: a restaurant receiving no
     * notifications is precisely the failure OD-87 was, and it must be visible
     * in the logs instead of being inferred from an empty inbox.
     */
    const fallbackOrEmpty = (why: string): ResolvedRecipients => {
      if (allowDefaultFallback) return this.getDefaultRecipients(channels);
      this.logger.warn(
        `RECIPIENTS_NONE restaurant=${query.restaurantId} roles=${query.roles.join(",")} — ` +
          `${why}. The global MANAGER_EMAIL/MANAGER_PHONE fallback is disabled for this ` +
          "restaurant because it belongs to another tenant; sending nothing.",
      );
      return { emails: [], phones: [] };
    };

    try {
      const client = this.databaseService.getClient();

      // 1. Find users with matching roles for this restaurant
      const userIds = await this.getUserIdsForRoles(
        client,
        query.restaurantId,
        query.roles,
      );

      if (userIds.length === 0) {
        return fallbackOrEmpty("no user holds one of those roles here");
      }

      // 2. Get notification preferences for these users
      const preferences = await this.getNotificationPreferences(
        client,
        userIds,
      );

      // 3. Get user contact details
      const users = await this.getUserContacts(client, userIds);

      for (const user of users) {
        const prefs = preferences.get(user.user_id);

        // Check if user wants email notifications
        if (channels.includes("email") && user.email) {
          const wantsEmail =
            !prefs || this.checkChannelPreference(prefs, "email");
          if (wantsEmail) {
            result.emails.push(user.email);
          }
        }

        // Check if user wants SMS notifications
        if (channels.includes("sms") && user.phone) {
          const wantsSms = !prefs || this.checkChannelPreference(prefs, "sms");
          if (wantsSms) {
            result.phones.push(user.phone);
          }
        }
      }

      // 4. If provider-specific, also resolve provider contacts from contacts table
      if (query.providerId && query.roles.includes("provider")) {
        const providerContacts = await this.getProviderContacts(
          client,
          query.providerId,
        );
        if (channels.includes("email")) {
          result.emails.push(...providerContacts.emails);
        }
        if (channels.includes("sms")) {
          result.phones.push(...providerContacts.phones);
        }
      }

      // Deduplicate
      result.emails = [...new Set(result.emails)];
      result.phones = [...new Set(result.phones)];

      // Fallback: if no emails found, use defaults
      if (result.emails.length === 0 && channels.includes("email")) {
        result.emails = fallbackOrEmpty(
          "matching users have no email address or have opted out of email",
        ).emails;
      }
    } catch (error) {
      this.logger.error(`Failed to resolve recipients: ${error}`);
      return fallbackOrEmpty(`recipient lookup failed: ${error}`);
    }

    this.logger.debug(
      `Resolved recipients for restaurant ${query.restaurantId}: ` +
        `${result.emails.length} emails, ${result.phones.length} phones`,
    );

    return result;
  }

  /**
   * Get user IDs that have specified roles for a restaurant.
   */
  private async getUserIdsForRoles(
    client: any,
    restaurantId: string,
    roles: RecipientRole[],
  ): Promise<string[]> {
    try {
      // Query user_restaurant_access for users with matching roles
      const { data, error } = await client
        .from("user_restaurant_access")
        .select("user_id, role")
        .eq("restaurant_id", restaurantId)
        .in("role", roles);

      if (error || !data) return [];

      return data.map((row: any) => row.user_id);
    } catch {
      // Fallback: query users table directly
      try {
        const { data, error } = await client
          .from("users")
          .select("user_id, role")
          .eq("restaurant_id", restaurantId)
          .in("role", roles);

        if (error || !data) return [];
        return data.map((row: any) => row.user_id);
      } catch {
        return [];
      }
    }
  }

  /**
   * Get notification preferences for a set of user IDs.
   */
  private async getNotificationPreferences(
    client: any,
    userIds: string[],
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    try {
      const { data, error } = await client
        .from("notification_preferences")
        .select("*")
        .in("user_id", userIds);

      if (data) {
        for (const pref of data) {
          map.set(pref.user_id, pref);
        }
      }
    } catch {
      // No preferences found - will use defaults
    }
    return map;
  }

  /**
   * Get user contact details (email, phone).
   */
  private async getUserContacts(
    client: any,
    userIds: string[],
  ): Promise<
    Array<{ user_id: string; email: string; phone?: string; name?: string }>
  > {
    try {
      const { data, error } = await client
        .from("users")
        .select("user_id, email, phone, name")
        .in("user_id", userIds);

      return data || [];
    } catch {
      return [];
    }
  }

  /**
   * Get provider contacts from the contacts + contact_addresses tables.
   */
  private async getProviderContacts(
    client: any,
    providerId: string,
  ): Promise<{ emails: string[]; phones: string[] }> {
    const result = { emails: [] as string[], phones: [] as string[] };

    try {
      // Find contact linked to this provider
      const { data: contacts, error: contactError } = await client
        .from("contacts")
        .select("id")
        .eq("linked_provider_id", providerId)
        .eq("is_active", true);

      if (!contacts || contacts.length === 0) {
        // Fallback: try providers table directly
        const { data: provider } = await client
          .from("providers")
          .select("contact_email, contact_phone")
          .eq("id", providerId)
          .single();

        if (provider) {
          if (provider.contact_email)
            result.emails.push(provider.contact_email);
          if (provider.contact_phone)
            result.phones.push(provider.contact_phone);
        }
        return result;
      }

      const contactIds = contacts.map((c: any) => c.id);

      // Get addresses for these contacts
      const { data: addresses } = await client
        .from("contact_addresses")
        .select("channel, address_value")
        .in("contact_id", contactIds)
        .eq("is_primary", true);

      if (addresses) {
        for (const addr of addresses) {
          if (addr.channel === "email") result.emails.push(addr.address_value);
          if (addr.channel === "phone") result.phones.push(addr.address_value);
        }
      }
    } catch (error) {
      this.logger.debug(`Failed to get provider contacts: ${error}`);
    }

    return result;
  }

  /**
   * Check if a user's notification preferences allow a specific channel.
   *
   * Two gates, applied in order.
   *
   * **Gate 1 — the global per-channel switch.** `email_enabled`,
   * `push_enabled` and `sms_enabled` are what a user actually toggles in
   * Settings, and their defaults are deliberately asymmetric: email and push
   * are opt-OUT (default true), SMS is opt-IN (default false). Those exact
   * defaults are already read in
   * `notifications.service.ts:1051-1053`; this method is the second reader
   * and has to agree with the first, or the same row means two things
   * depending on which code path looks at it.
   *
   * **Gate 2 — the per-category channel arrays.** The real column names come
   * from `supabase/migrations/20260805000000_baseline_from_production.sql:3899-3939`:
   * `low_stock_channels`, `order_approval_channels`,
   * `financial_reports_channels`.
   *
   * Until 2026-09-02 gate 1 did not exist and gate 2 read `order_channels`
   * and `report_channels`, **which no migration has ever declared**. Both
   * reads were therefore permanently `undefined`, which had two consequences
   * that compounded:
   *
   *   - the "no explicit preferences set" escape hatch could never fire once
   *     `low_stock_channels` held its default, because that one column was
   *     truthy while the other two were undefined; and
   *   - the only array that could match was `low_stock_channels`, whose
   *     default is `['sms','push']`.
   *
   * So with stock production rows the check ran backwards on both axes at
   * once: **email was refused to every user who had it enabled** (not in
   * `low_stock_channels`, and the escape hatch was blocked) while **SMS was
   * permitted to every user who had it disabled** (in `low_stock_channels`,
   * and `sms_enabled` was never consulted). Fixing only the column names
   * fixes the first half and leaves the second, which is why gate 1 is here.
   *
   * This method is not told which notification CATEGORY it is resolving for,
   * so gate 2 is a union across the three arrays. That is deliberately
   * permissive rather than wrong: making it category-aware means threading a
   * category through all seven call sites and deciding which category each
   * belongs to, which is a product decision. Recorded as the open half of
   * ADR 0093.
   */
  private checkChannelPreference(prefs: any, channel: string): boolean {
    // Gate 1: the global per-channel switch. Defaults must stay identical to
    // notifications.service.ts:1051-1053.
    const globallyEnabled: Record<string, boolean> = {
      email: prefs.email_enabled ?? true,
      push: prefs.push_enabled ?? true,
      sms: prefs.sms_enabled ?? false,
    };
    if (globallyEnabled[channel] === false) {
      return false;
    }

    // Gate 2: the per-category channel arrays, by their real column names.
    const expressed = [
      prefs.low_stock_channels,
      prefs.order_approval_channels,
      prefs.financial_reports_channels,
    ].filter((arr) => Array.isArray(arr));

    // No category preference expressed at all — gate 1 has already decided.
    if (expressed.length === 0) {
      return true;
    }

    return expressed.some((arr) => arr.includes(channel));
  }

  /**
   * Get default recipients when no specific ones are found.
   */
  private getDefaultRecipients(
    channels: NotificationChannel[],
  ): ResolvedRecipients {
    const defaults = this.defaultEmail
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e);
    const managerPhone =
      this.configService.get<string>("MANAGER_PHONE") || null;

    return {
      emails: channels.includes("email") ? defaults : [],
      phones: channels.includes("sms") && managerPhone ? [managerPhone] : [],
    };
  }

  /**
   * Get all manager emails for a restaurant (convenience method).
   */
  async getManagerEmails(restaurantId: string): Promise<string[]> {
    const result = await this.resolveRecipients({
      restaurantId,
      roles: ["manager"],
      channels: ["email"],
    });
    return result.emails;
  }

  /**
   * Get all staff emails for a restaurant (convenience method).
   */
  async getStaffEmails(restaurantId: string): Promise<string[]> {
    const result = await this.resolveRecipients({
      restaurantId,
      roles: ["staff"],
      channels: ["email"],
    });
    return result.emails;
  }
}
