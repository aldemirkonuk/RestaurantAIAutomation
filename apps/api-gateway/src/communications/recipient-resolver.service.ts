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
export type NotificationChannel = "email" | "sms" | "push";

export interface ResolvedRecipients {
  emails: string[];
  phones: string[];
  pushSubscriptionIds: string[];
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
      pushSubscriptionIds: [],
    };

    const channels = query.channels || ["email", "sms", "push"];
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
      return { emails: [], phones: [], pushSubscriptionIds: [] };
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

        // Check push subscriptions
        if (channels.includes("push")) {
          const wantsPush =
            !prefs || this.checkChannelPreference(prefs, "push");
          if (wantsPush) {
            const subs = await this.getPushSubscriptions(client, user.user_id);
            result.pushSubscriptionIds.push(...subs);
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
      result.pushSubscriptionIds = [...new Set(result.pushSubscriptionIds)];

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
        `${result.emails.length} emails, ${result.phones.length} phones, ${result.pushSubscriptionIds.length} push`,
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
   * Get push subscription IDs for a user.
   */
  private async getPushSubscriptions(
    client: any,
    userId: string,
  ): Promise<string[]> {
    try {
      const { data, error } = await client
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId);

      return (data || []).map((s: any) => s.id);
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
   */
  private checkChannelPreference(prefs: any, channel: string): boolean {
    // Check various preference fields
    const channelArrays = [
      prefs.low_stock_channels,
      prefs.order_channels,
      prefs.report_channels,
    ];

    // If any preference array includes this channel, allow it
    for (const arr of channelArrays) {
      if (Array.isArray(arr) && arr.includes(channel)) {
        return true;
      }
    }

    // Default: allow if no explicit preferences set
    if (
      !prefs.low_stock_channels &&
      !prefs.order_channels &&
      !prefs.report_channels
    ) {
      return true;
    }

    return false;
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
      pushSubscriptionIds: [],
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
