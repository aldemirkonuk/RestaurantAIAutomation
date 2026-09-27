/**
 * Recipient Resolver Service
 * Resolves notification recipients based on restaurant, roles, and channel preferences.
 * Supports multi-restaurant, multi-role routing with fallback to defaults.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { isLiveMembership } from "../common/tenant/live-membership";

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
 *   had no working writer as of 2026-08-26. `NotificationsService
 *   .registerPushSubscription` upserted `onConflict: "user_id"`, but the
 *   table's only unique index was on `(restaurant_id, user_id)`, so Postgres
 *   answered `42P10` and the statement could not even be planned. Repointing
 *   here would have swapped a loud 404 for a permanently empty read that
 *   looks successful — the exact failure ADR 0020 forbids.
 *   **[Fixed 2026-09-18, ADR 0149 row 39 — CLAUDE.md §5b, this bracket is the
 *   correction, the paragraph above is kept as the record.]** The column is
 *   deprecated and unread by any code as of this commit: a subscription now
 *   lives in `notification_push_devices`, upserted on `(user_id, endpoint)`,
 *   a real index. That fix does not change this file's conclusion — reason
 *   below still holds regardless of which table a subscription lives in.
 * - **Both push senders address recipients by USER ID and enumerate devices
 *   themselves**: `NotificationsService.sendWebPush(userId, …)` reads
 *   `notification_push_devices`, and `ExpoPushService.sendToUsers(userIds, …)`
 *   reads `mobile_devices.expo_push_token`. Neither accepts a subscription id,
 *   an endpoint, or a token from outside. There is therefore no push-recipient
 *   shape this resolver could return that both senders would take.
 *
 * If push recipients are ever meant to flow through here, the correct output
 * is user ids — which `getUserIdsForRoles` already computes — not devices.
 * That is a design addition, not a restoration of what was deleted.
 */
export type NotificationChannel = "email" | "sms";

/**
 * The notification categories this resolver can route, one per per-category
 * channel array `notification_preferences` declares
 * (`supabase/migrations/20260805000000_baseline_from_production.sql:3903-3915`).
 *
 * OD-121, founder answer 15 (ADR 0149, 2026-09-16): "map the seven resolver
 * sites to categories, an unmapped category is refused". Before this every
 * send was gated by a UNION across three of the six arrays, so email switched
 * on for financial reports also switched it on for low stock, and the other
 * three arrays were never read at all.
 *
 * The category of every call site is named in `NOTIFICATION_SEND_CATEGORY`
 * below, in one table, so the mapping is reviewable in one place rather than
 * scattered as string literals across the senders.
 */
export const NOTIFICATION_CATEGORIES = [
  "low_stock",
  "order_approval",
  "delivery",
  "financial_reports",
  "inequality_alerts",
  "calendar_reminders",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Every send that resolves recipients here, and the category it belongs to.
 *
 * Re-measured 2026-09-16: OD-121 counted SEVEN call sites (`scheduled-tasks`
 * ×6, `low-stock-alerts` ×1). The tree now has ELEVEN — nine jobs in
 * `scheduled-tasks.service.ts` go through `recipientsFor`, plus
 * `LowStockAlertsService.resolveEmails` and
 * `ExperimentEndedProducer.founderAddress`. Each is named here; a send that is
 * not in this table has no category and is refused by `resolveRecipients`.
 *
 * Row 34 (ADR 0149, 2026-09-17) ratified two of the original four judgement
 * calls: the weekly report is `financial_reports`, the recurring-order
 * reminder is `order_approval`. Row 46 (ADR 0149, 2026-09-18) ratified the
 * remaining two, covering three sends — these were the builder's own call
 * (OD-121) and are now the founder's:
 *   daily-sms-summary       financial_reports — a summary report of the day
 *                           (low-stock count, pending orders), not an alert.
 *                           SMS-only, so `financial_reports_channels`' default
 *                           gained `sms` in the same row (see
 *                           `20260925160600_a_daily_summary_can_reach_a_phone.sql`).
 *   experiment-ended        financial_reports — a report of an ended
 *                           experiment, sent to the founder house's managers.
 *   inventory-audit-reminder calendar_reminders — a scheduled count on a date,
 *                           not a stock alert.
 */
export const NOTIFICATION_SEND_CATEGORY = {
  "daily-sms-summary": "financial_reports",
  "weekly-email-report": "financial_reports",
  "midday-low-stock-report": "low_stock",
  "low-stock-alerts": "low_stock",
  "recurring-order-reminder": "order_approval",
  "delivery-eta-notification": "delivery",
  "inventory-audit-reminder": "calendar_reminders",
  "event-prep-check": "calendar_reminders",
  "custom-reminders-check": "calendar_reminders",
  "low-stock-digest": "low_stock",
  "experiment-ended": "financial_reports",
} as const satisfies Record<string, NotificationCategory>;
export type NotificationSend = keyof typeof NOTIFICATION_SEND_CATEGORY;

/**
 * A resolve was asked for with no category, or one this resolver does not
 * route. REFUSED, not defaulted: falling back to "everyone who holds the role"
 * is exactly the permissiveness OD-121 closes (founder answer 15).
 */
export class UnmappedNotificationCategoryError extends Error {
  constructor(readonly category: unknown) {
    super(
      `Notification category ${JSON.stringify(category)} is not mapped to a ` +
        `preference column (${NOTIFICATION_CATEGORIES.join(", ")}); nothing is ` +
        "resolved and nothing is sent.",
    );
    this.name = "UnmappedNotificationCategoryError";
  }
}

export function isNotificationCategory(
  value: unknown,
): value is NotificationCategory {
  return (
    typeof value === "string" &&
    (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export interface ResolvedRecipients {
  emails: string[];
  phones: string[];
  /**
   * People who hold the role and have an address on that channel but whose
   * own preference withheld it (gate 1 or gate 2). COUNTS only — an address
   * never travels in this field (ADR 0040). Lets a caller record "declined by
   * preference" instead of "nobody to send to", which are different facts.
   * Optional because the env-fallback and empty shapes decline nobody.
   */
  declined?: { email: number; sms: number };
  /**
   * Set when a read this resolve depends on FAILED (the membership roster,
   * the preferences or the contacts). A failed read is not "nobody": the
   * recipient lists above are then only whatever the env fallback supplied
   * (the legacy house) or empty (every other house), and a caller must record
   * `recipient_lookup_failed`, never `no_recipients` (2026-09-17, notify-lane
   * review M2). `reason` carries the read's error text, never an address.
   */
  lookupFailed?: { reason: string };
}

/**
 * Thrown by a caller that cannot carry `lookupFailed` any further (a job whose
 * only output is the email or SMS). Its message starts with
 * `recipient_lookup_failed`, so the per-tenant run log names it as what it is.
 */
export class RecipientLookupFailedError extends Error {
  constructor(
    readonly send: string,
    readonly restaurantId: string,
    readonly reason: string,
  ) {
    super(
      `recipient_lookup_failed: the recipients of ${send} for restaurant ${restaurantId} ` +
        `could not be read (${reason}); this is a failed read, not an empty house, and nothing was sent.`,
    );
    this.name = "RecipientLookupFailedError";
  }
}

export interface RecipientQuery {
  restaurantId: string;
  roles: RecipientRole[];
  /**
   * REQUIRED. Which per-category channel array decides (OD-121). A value that
   * is not one of `NOTIFICATION_CATEGORIES` — reachable at runtime from an
   * untyped caller — throws `UnmappedNotificationCategoryError`.
   */
  category: NotificationCategory;
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
    // Refused BEFORE the try below, on purpose: its catch turns a failure into
    // the env fallback for the legacy tenant, and a refusal must never become
    // a send to anyone (OD-121, founder answer 15).
    if (!isNotificationCategory(query?.category)) {
      this.logger.warn(
        `RECIPIENTS_REFUSED restaurant=${query?.restaurantId} category=${JSON.stringify(query?.category)} — ` +
          "no preference column is mapped to this category, so nobody is resolved.",
      );
      throw new UnmappedNotificationCategoryError(query?.category);
    }
    const category = query.category;

    const result: ResolvedRecipients = {
      emails: [],
      phones: [],
      declined: { email: 0, sms: 0 },
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

      // 2. Get notification preferences for these users, narrowed to THIS
      //    house. Founder answer, ADR 0149 row 39 (2026-09-18): preferences
      //    are per person PER HOUSE, settling the fork
      //    `20260813090000_fix_remaining_upsert_targets.sql` §3 /
      //    `0027-push-recipients-are-not-resolved-here.md` §3 left open.
      //    A member's preferences at house B no longer decide whether they
      //    are emailed for house A.
      const preferences = await this.getNotificationPreferences(
        client,
        userIds,
        query.restaurantId,
      );

      // 3. Get user contact details
      const users = await this.getUserContacts(client, userIds);

      for (const user of users) {
        const prefs = preferences.get(user.user_id);

        // Check if user wants email notifications
        if (channels.includes("email") && user.email) {
          const wantsEmail =
            !prefs || this.checkChannelPreference(prefs, "email", category);
          if (wantsEmail) {
            result.emails.push(user.email);
          } else {
            result.declined!.email += 1;
          }
        }

        // Check if user wants SMS notifications
        if (channels.includes("sms") && user.phone) {
          const wantsSms =
            !prefs || this.checkChannelPreference(prefs, "sms", category);
          if (wantsSms) {
            result.phones.push(user.phone);
          } else {
            result.declined!.sms += 1;
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
      const reason =
        error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(
        `RECIPIENT_LOOKUP_FAILED restaurant=${query.restaurantId} category=${category} — ${reason}`,
      );
      // The failure travels WITH the answer. The legacy house still gets its
      // env address (its historical behaviour, ADR 0022); every other house
      // gets nobody — and either way the caller is told the read failed.
      return {
        ...fallbackOrEmpty(`recipient lookup failed: ${reason}`),
        lookupFailed: { reason },
      };
    }

    this.logger.debug(
      `Resolved recipients for restaurant ${query.restaurantId} (${category}): ` +
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
    // Only LIVE access, by the one membership predicate
    // (`common/tenant/live-membership.ts`): active, `valid_from` not in the
    // future, `valid_until` null or in the future. Until 2026-09-17 this
    // checked `is_active` alone, so a manager past `valid_until` was still
    // notified.
    const { data, error } = await client
      .from("user_restaurant_access")
      .select("user_id, role, is_active, valid_from, valid_until")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", roles);

    // A failed read THROWS. It used to return [], which the caller reports as
    // "no user holds one of those roles here" — a failed read presented as a
    // fact about the house. The catch in resolveRecipients now logs it as the
    // lookup failure it is.
    if (error) {
      throw new Error(`user_restaurant_access read failed: ${error.message}`);
    }
    const now = Date.now();
    return (data ?? [])
      .filter((row: any) => isLiveMembership(row, now))
      .map((row: any) => row.user_id);
  }

  /**
   * Notification preferences for a set of users, narrowed to ONE house.
   *
   * The columns are named rather than `*`, so `check_read_columns_exist.py`
   * verifies every one against the schema — the resolver once read two
   * columns that never existed through a `select("*")` (ADR 0098).
   *
   * Narrowed by `restaurant_id` as of 2026-09-18 (ADR 0149 row 39): a
   * preference is per person PER HOUSE, so a row from a different house this
   * same person also belongs to must not decide this house's send.
   */
  private async getNotificationPreferences(
    client: any,
    userIds: string[],
    restaurantId: string,
  ): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    const { data, error } = await client
      .from("notification_preferences")
      .select(
        "user_id, email_enabled, push_enabled, sms_enabled, low_stock_channels, order_approval_channels, delivery_channels, financial_reports_channels, inequality_alerts_channels, calendar_reminders_channels",
      )
      .eq("restaurant_id", restaurantId)
      .in("user_id", userIds);

    // A failed read THROWS. It used to be swallowed as "no preferences found",
    // and no preferences means every channel is allowed — so an outage of this
    // one table silently re-enabled everything every user had switched off.
    if (error) {
      throw new Error(`notification_preferences read failed: ${error.message}`);
    }
    for (const pref of data ?? []) {
      map.set(pref.user_id, pref);
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
    const { data, error } = await client
      .from("users")
      .select("user_id, email, phone, name")
      .in("user_id", userIds);

    if (error) {
      throw new Error(`users contact read failed: ${error.message}`);
    }
    return data ?? [];
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
   * **Gate 2 is category-aware as of 2026-09-16 (OD-121, founder answer 15).**
   * Until then this method was not told which category it resolved for and
   * took a UNION across `low_stock_channels`, `order_approval_channels` and
   * `financial_reports_channels`, ignoring the other three arrays. It now reads
   * exactly ONE array — the caller's category's — and nothing else. A category
   * with no column is refused before this method is reached
   * (`UnmappedNotificationCategoryError`).
   *
   * What that changes on a stock production row, stated because ADR 0022
   * requires it to be checked before this ships (the row measured on
   * production 2026-09-02, `team/broadcast-preferences.ts:27-33`, and the
   * baseline defaults at :3904-3915):
   *
   *   low_stock           ['sms','push']            email REFUSED (was allowed
   *                                                  through the union)
   *   order_approval      ['sms','push','email']    email allowed
   *   delivery            ['push','email']          email allowed
   *   financial_reports   ['email','dashboard']     email allowed
   *   calendar_reminders  ['push','email']          email allowed
   *   inequality_alerts   ['sms','push']            email refused (no sender
   *                                                  maps here today)
   *
   * [Corrected 2026-09-19: the low_stock row above describes a row already
   * holding the exact prior default (['sms','push']) as measured on production
   * 2026-09-02 -- it no longer describes every row. Migration
   * 20260925160700_a_low_stock_warning_can_reach_an_inbox.sql widened
   * low_stock_channels' DEFAULT to ['sms','push','email'] and, by the
   * founder's standing rule (19-lane blocking round, batch 4, 2026-09-19),
   * backfilled every existing row that still held exactly the old default to
   * match -- a row someone had customised away from it was left alone. A row
   * created after that migration (or reset to the default) gets email
   * ALLOWED for low_stock; a row that still holds a customised, non-default
   * array keeps exactly what it held. Full record: the ADR 0147 amendment's
   * Recipient routing (OD-121) bullet.]
   *
   * SMS is refused on every stock row by gate 1 (`sms_enabled` false).
   *
   * An array that is absent (NULL) expresses no category preference, and gate
   * 1 decides — the same rule as before, applied to one array instead of three.
   */
  private checkChannelPreference(
    prefs: any,
    channel: string,
    category: NotificationCategory,
  ): boolean {
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

    // Gate 2: the ONE per-category channel array, by its real column name.
    const expressed = this.categoryChannels(prefs, category);

    // No preference expressed for this category — gate 1 has already decided.
    if (!Array.isArray(expressed)) {
      return true;
    }

    return expressed.includes(channel);
  }

  /**
   * The channel array for one category. A `switch` over property reads rather
   * than a computed key, so every column this reads is a literal `prefs.<col>`
   * that `check_read_columns_exist.py` can verify against the schema.
   */
  private categoryChannels(
    prefs: any,
    category: NotificationCategory,
  ): unknown {
    switch (category) {
      case "low_stock":
        return prefs.low_stock_channels;
      case "order_approval":
        return prefs.order_approval_channels;
      case "delivery":
        return prefs.delivery_channels;
      case "financial_reports":
        return prefs.financial_reports_channels;
      case "inequality_alerts":
        return prefs.inequality_alerts_channels;
      case "calendar_reminders":
        return prefs.calendar_reminders_channels;
      default: {
        // Unreachable for a typed caller; resolveRecipients refuses first.
        const never: never = category;
        throw new UnmappedNotificationCategoryError(never);
      }
    }
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
  async getManagerEmails(
    restaurantId: string,
    category: NotificationCategory,
  ): Promise<string[]> {
    const result = await this.resolveRecipients({
      restaurantId,
      roles: ["manager"],
      category,
      channels: ["email"],
    });
    // A bare list cannot carry `lookupFailed`, so a failed read throws here
    // rather than reaching the caller as an empty list.
    if (result.lookupFailed && result.emails.length === 0) {
      throw new RecipientLookupFailedError(
        `manager emails (${category})`,
        restaurantId,
        result.lookupFailed.reason,
      );
    }
    return result.emails;
  }

  /**
   * Get all staff emails for a restaurant (convenience method).
   */
  async getStaffEmails(
    restaurantId: string,
    category: NotificationCategory,
  ): Promise<string[]> {
    const result = await this.resolveRecipients({
      restaurantId,
      roles: ["staff"],
      category,
      channels: ["email"],
    });
    if (result.lookupFailed && result.emails.length === 0) {
      throw new RecipientLookupFailedError(
        `staff emails (${category})`,
        restaurantId,
        result.lookupFailed.reason,
      );
    }
    return result.emails;
  }
}
