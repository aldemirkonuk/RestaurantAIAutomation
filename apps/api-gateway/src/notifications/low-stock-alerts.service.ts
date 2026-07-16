import {
  Injectable,
  Logger,
  Inject,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "./notifications.service";
import { GmailService } from "../communications/gmail.service";
import { RecipientResolverService } from "../communications/recipient-resolver.service";
import type { LowStockDigestWine } from "../communications/email-templates";

type AlertLevel = "ok" | "low" | "critical";

interface LowStockRow {
  inventoryId: string;
  wineId: string;
  wineName: string;
  currentStock: number;
  threshold: number;
  severity: "critical" | "low";
}

/**
 * LOW-STOCK ALERT ENGINE
 * ----------------------
 * Replaces the old per-wine email loop with a state-diffing reconciliation
 * loop that gives the manager the SOTA behaviour they asked for:
 *
 *   • INSTANT (edge-triggered): the first time a wine crosses below par it is
 *     alerted right away — but a burst of simultaneous crossings coalesces into
 *     ONE email + ONE grouped inbox notification (not N).
 *   • BATCHED (level-triggered): wines that merely REMAIN low are not re-alerted
 *     every tick; they roll into a periodic digest.
 *
 * Detection is decoupled from the inventory/POS write path: an edge sweep diffs
 * the current low-stock set (v_low_stock_items) against `inventory_alert_state`,
 * so a crossing caused by a POS pour, an order, or a manual edit is all caught
 * the same way — without coupling a pour to email-sending.
 *
 * Cadence uses server-side defaults now ("defaults first"); a Settings UI can
 * later override these per restaurant/user via notification_preferences.
 */
@Injectable()
export class LowStockAlertsService {
  private readonly logger = new Logger(LowStockAlertsService.name);

  /** Wines at/under 50% of par are "critical"; between 50%–100% are "low". */
  private readonly CRITICAL_RATIO = 0.5;
  /** Re-running the daily digest inside this window won't double-post. */
  private readonly DIGEST_DEDUPE_MINUTES = 12 * 60;

  /**
   * Backstop against alert storms if the state ledger READ is flaky (returns
   * empty so everything looks "new"): never send more than one instant alert
   * per restaurant within this window. In-memory is enough — the daily digest
   * is the durable safety net, and a restart only relaxes the cap once.
   */
  private readonly INSTANT_COOLDOWN_MS = 15 * 60_000;
  private readonly lastInstantAt = new Map<string, number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(forwardRef(() => GmailService))
    private readonly gmail?: GmailService,
    @Optional()
    private readonly recipientResolver?: RecipientResolverService,
  ) {}

  // ==========================================================================
  // CRON ENTRY POINTS
  // ==========================================================================

  /**
   * Edge sweep — near-real-time. Detects NEW threshold crossings and fires the
   * instant (grouped) alert. Every 2 minutes ≈ "instant" for wine inventory,
   * while keeping email-sending off the hot pour/order path.
   */
  @Cron("*/2 * * * *", { name: "low-stock-edge-sweep" })
  async runEdgeSweep(): Promise<void> {
    try {
      const byRestaurant = await this.getLowStockByRestaurant();
      const names = await this.getRestaurantNames([...byRestaurant.keys()]);
      for (const [restaurantId, rows] of byRestaurant) {
        await this.evaluateRestaurant(restaurantId, rows, names.get(restaurantId));
      }
      // Reconcile restocks even for restaurants that dropped off the low list.
      await this.reconcileRecoveries(byRestaurant);
    } catch (e: any) {
      this.logger.error(`low-stock edge sweep failed: ${e?.message}`);
    }
  }

  /**
   * Digest sweep — runs hourly and, for each restaurant, sends the batched
   * reminder only when the current hour matches that restaurant's configured
   * `digest_time` (and the digest isn't turned off). One email + one grouped
   * inbox row per restaurant.
   */
  @Cron("0 * * * *", {
    name: "low-stock-digest",
    timeZone: "America/New_York",
  })
  async runDailyDigest(): Promise<void> {
    try {
      const etHour = this.currentEtHour();
      const byRestaurant = await this.getLowStockByRestaurant();
      const names = await this.getRestaurantNames([...byRestaurant.keys()]);
      for (const [restaurantId, rows] of byRestaurant) {
        const prefs = await this.getEffectiveLowStockPrefs(restaurantId);
        if (!prefs.enabled || prefs.digestFrequency === "off") continue;
        const digestHour = parseInt(
          (prefs.digestTime || "12:00").split(":")[0],
          10,
        );
        if (etHour !== digestHour) continue;
        await this.sendDigest(restaurantId, rows, names.get(restaurantId));
      }
    } catch (e: any) {
      this.logger.error(`low-stock digest failed: ${e?.message}`);
    }
  }

  /** Current hour (0–23) in the digest timezone. */
  private currentEtHour(): number {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    );
  }

  // Manual triggers (tests / on-demand — bypass the hour gate).
  async triggerEdgeSweep(): Promise<void> {
    await this.runEdgeSweep();
  }
  async triggerDailyDigest(): Promise<void> {
    const byRestaurant = await this.getLowStockByRestaurant();
    const names = await this.getRestaurantNames([...byRestaurant.keys()]);
    for (const [restaurantId, rows] of byRestaurant) {
      const prefs = await this.getEffectiveLowStockPrefs(restaurantId);
      if (!prefs.enabled || prefs.digestFrequency === "off") continue;
      await this.sendDigest(restaurantId, rows, names.get(restaurantId));
    }
  }

  // ==========================================================================
  // CORE LOGIC
  // ==========================================================================

  /**
   * Diff current low-stock rows against the alert ledger. New crossings (OK→low
   * or low→critical escalation) fire one instant grouped alert; ongoing-low
   * wines are left for the digest. Always advances the ledger.
   */
  async evaluateRestaurant(
    restaurantId: string,
    rows: LowStockRow[],
    restaurantName?: string,
  ): Promise<{ newCrossings: LowStockRow[] }> {
    const prefs = await this.getEffectiveLowStockPrefs(restaurantId);
    if (!prefs.enabled) return { newCrossings: [] };

    const state = await this.getAlertState(restaurantId);
    const newCrossings: LowStockRow[] = [];
    const persistedNew: LowStockRow[] = [];
    const nowIso = new Date().toISOString();

    for (const row of rows) {
      const prev = state.get(row.inventoryId)?.level ?? "ok";
      const cur = row.severity; // "low" | "critical"
      const isNew = prev === "ok" || (prev === "low" && cur === "critical");
      if (isNew) newCrossings.push(row);

      const persisted = await this.upsertState(restaurantId, {
        inventoryId: row.inventoryId,
        wineName: row.wineName,
        level: cur,
        bumpAlert: isNew,
        alertedAt: isNew ? nowIso : undefined,
      });
      // Fail-closed: only a crossing whose new level we DURABLY recorded is
      // eligible to alert. If the write failed, we leave it untouched and retry
      // next sweep — so a DB blip can't make us re-send the same alert forever.
      if (isNew && persisted) persistedNew.push(row);
    }

    // Honor the manager's settings: a crossing alerts immediately only if
    // instant-first is on, OR it's critical and criticals are set to interrupt.
    // Anything held back is still marked low and will surface in the digest.
    const immediate = persistedNew.filter(
      (w) =>
        prefs.instantFirstAlert ||
        (w.severity === "critical" && prefs.criticalImmediate),
    );
    const now = Date.now();
    const cooledDown =
      now - (this.lastInstantAt.get(restaurantId) ?? 0) >= this.INSTANT_COOLDOWN_MS;
    if (immediate.length > 0 && cooledDown) {
      this.lastInstantAt.set(restaurantId, now);
      await this.fireInstantAlert(restaurantId, immediate, restaurantName);
    } else if (immediate.length > 0) {
      this.logger.log(
        `Low-stock instant alert for ${restaurantId} suppressed by cooldown (${immediate.length} wines roll into the digest).`,
      );
    }

    return { newCrossings };
  }

  // ==========================================================================
  // REAL-TIME ENTRY POINTS — called from the pour / POS write path
  // ==========================================================================

  /**
   * Real-time edge check for a SINGLE just-depleted item. Called fire-and-forget
   * from `InventoryService.recordPour` so a pour that crosses par alerts within
   * milliseconds instead of waiting for the 2-minute sweep.
   */
  async evaluateInventoryItem(
    restaurantId: string,
    inventoryId: string,
  ): Promise<void> {
    await this.evaluateInventoryItems(restaurantId, [inventoryId]);
  }

  /**
   * Real-time edge check for a SET of just-depleted items (e.g. all the lines in
   * one Toast POS order). New crossings in the set fire ONE grouped alert; items
   * that are no longer low have their alert-state cleared (recovery).
   */
  async evaluateInventoryItems(
    restaurantId: string,
    inventoryIds: string[],
  ): Promise<void> {
    if (!restaurantId || inventoryIds.length === 0) return;
    try {
      const lowRows = await this.getLowStockForRestaurant(restaurantId);
      const lowById = new Map(lowRows.map((r) => [r.inventoryId, r]));

      const nowLow = inventoryIds
        .map((id) => lowById.get(id))
        .filter((r): r is LowStockRow => !!r);
      if (nowLow.length > 0) {
        const names = await this.getRestaurantNames([restaurantId]);
        await this.evaluateRestaurant(restaurantId, nowLow, names.get(restaurantId));
      }

      // Depleted (or restocked) items that are no longer low → clear stale state.
      const recovered = inventoryIds.filter((id) => !lowById.has(id));
      if (recovered.length > 0) {
        await this.db.supabase
          .from("inventory_alert_state")
          .update({
            last_alert_level: "ok",
            updated_at: new Date().toISOString(),
          })
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", recovered)
          .neq("last_alert_level", "ok");
      }
    } catch (e: any) {
      this.logger.warn(`evaluateInventoryItems failed: ${e?.message}`);
    }
  }

  /**
   * Send ONE instant grouped alert (email + inbox) for a batch of wines that
   * just crossed below par.
   */
  private async fireInstantAlert(
    restaurantId: string,
    wines: LowStockRow[],
    restaurantName?: string,
  ): Promise<void> {
    const criticalCount = wines.filter((w) => w.severity === "critical").length;
    const priority: "critical" | "high" = criticalCount > 0 ? "critical" : "high";
    const list = wines
      .map((w) => `${w.wineName} (${w.currentStock}/${w.threshold})`)
      .join(", ");
    const title =
      wines.length === 1
        ? `${criticalCount > 0 ? "🚨" : "⚠️"} ${wines[0].severity === "critical" ? "Critical" : "Low stock"}: ${wines[0].wineName}`
        : `${criticalCount > 0 ? "🚨" : "⚠️"} ${wines.length} wines dropped below par`;

    // 1) In-app inbox — the reliable channel (works even with no email set up).
    await this.notifications.persistForRestaurant(restaurantId, {
      type: "inventory_low_stock",
      title,
      message:
        wines.length === 1
          ? `Only ${wines[0].currentStock} bottles remaining (par: ${wines[0].threshold})`
          : `Just crossed below par: ${list}`,
      priority,
      actionUrl: "/inventory?filter=low-stock",
      actionLabel: "View Inventory",
      groupKey: `low_stock_instant:${Date.now()}`,
      metadata: {
        mode: "instant",
        count: wines.length,
        criticalCount,
        wines: wines.map((w) => ({
          wineId: w.wineId,
          wineName: w.wineName,
          currentStock: w.currentStock,
          threshold: w.threshold,
          severity: w.severity,
        })),
      },
    });

    // 2) Email — one grouped digest email for the burst.
    await this.emailDigest(restaurantId, wines, "instant", restaurantName);
  }

  /**
   * The batched daily reminder — every currently-low wine in one email + one
   * grouped inbox row. Deduped so a double cron fire won't repeat it.
   */
  async sendDigest(
    restaurantId: string,
    rows: LowStockRow[],
    restaurantName?: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    const criticalCount = rows.filter((w) => w.severity === "critical").length;
    const dateStr = new Date().toISOString().slice(0, 10);

    await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: "inventory_low_stock",
        title: `⚠️ Low-stock digest: ${rows.length} wine${rows.length === 1 ? "" : "s"} below par`,
        message: `${criticalCount} critical · ${rows.length - criticalCount} low. Tap to review and reorder.`,
        priority: criticalCount > 0 ? "critical" : "high",
        actionUrl: "/inventory?filter=low-stock",
        actionLabel: "View Inventory",
        groupKey: `low_stock_digest:${dateStr}`,
        metadata: {
          mode: "digest",
          count: rows.length,
          criticalCount,
          wines: rows.map((w) => ({
            wineId: w.wineId,
            wineName: w.wineName,
            currentStock: w.currentStock,
            threshold: w.threshold,
            severity: w.severity,
          })),
        },
      },
      { dedupeWithinMinutes: this.DIGEST_DEDUPE_MINUTES },
    );

    await this.emailDigest(restaurantId, rows, "digest", restaurantName);

    // Stamp the digest time on the ledger.
    const nowIso = new Date().toISOString();
    for (const row of rows) {
      await this.upsertState(restaurantId, {
        inventoryId: row.inventoryId,
        wineName: row.wineName,
        level: row.severity,
        digestAt: nowIso,
      });
    }
  }

  /** Send the batched email via Gmail, resolving low-stock email recipients. */
  private async emailDigest(
    restaurantId: string,
    rows: LowStockRow[],
    mode: "instant" | "digest",
    restaurantName?: string,
  ): Promise<void> {
    if (!this.gmail) return;
    const emails = await this.resolveEmails(restaurantId);
    if (emails.length === 0) {
      this.logger.log(
        `Low-stock ${mode} for ${restaurantId}: no email recipients — inbox only`,
      );
      return;
    }
    const wines: LowStockDigestWine[] = rows.map((w) => ({
      wineName: w.wineName,
      currentStock: w.currentStock,
      threshold: w.threshold,
      severity: w.severity,
      wineId: w.wineId,
    }));
    try {
      await this.gmail.sendLowStockDigest({
        to: emails,
        wines,
        mode,
        restaurantName,
        inventoryUrl: this.inventoryUrl(),
      });
    } catch (e: any) {
      this.logger.warn(`Low-stock ${mode} email failed: ${e?.message}`);
    }
  }

  /** Reset the ledger for wines that recovered above par (silent — no spam). */
  private async reconcileRecoveries(
    byRestaurant: Map<string, LowStockRow[]>,
  ): Promise<void> {
    try {
      const { data: stale } = await this.db.supabase
        .from("inventory_alert_state")
        .select("restaurant_id, inventory_id")
        .neq("last_alert_level", "ok");
      if (!stale || stale.length === 0) return;

      for (const s of stale) {
        const stillLow = (byRestaurant.get(s.restaurant_id) || []).some(
          (r) => r.inventoryId === s.inventory_id,
        );
        if (!stillLow) {
          await this.db.supabase
            .from("inventory_alert_state")
            .update({ last_alert_level: "ok", updated_at: new Date().toISOString() })
            .eq("restaurant_id", s.restaurant_id)
            .eq("inventory_id", s.inventory_id);
        }
      }
    } catch (e: any) {
      this.logger.warn(`recovery reconciliation failed: ${e?.message}`);
    }
  }

  // ==========================================================================
  // DATA HELPERS
  // ==========================================================================

  /** All currently-low wines across every restaurant, grouped by restaurant. */
  private async getLowStockByRestaurant(): Promise<Map<string, LowStockRow[]>> {
    const map = new Map<string, LowStockRow[]>();
    const { data, error } = await this.db.supabase
      .from("v_low_stock_items")
      .select("*");
    if (error) {
      this.logger.warn(`v_low_stock_items query failed: ${error.message}`);
      return map;
    }
    for (const raw of data || []) {
      const restaurantId = raw.restaurant_id;
      if (!restaurantId) continue;
      const row = this.mapRow(raw);
      if (!row) continue;
      if (!map.has(restaurantId)) map.set(restaurantId, []);
      map.get(restaurantId)!.push(row);
    }
    return map;
  }

  /**
   * Effective low-stock settings for a restaurant, derived from its members'
   * per-user `notification_preferences` (OR semantics: the restaurant alerts if
   * ANY member wants it; the earliest configured digest time wins). Falls back
   * to all-on defaults when no prefs exist. This is what makes the Settings
   * page actually change behaviour.
   */
  private async getEffectiveLowStockPrefs(restaurantId: string): Promise<{
    enabled: boolean;
    instantFirstAlert: boolean;
    criticalImmediate: boolean;
    digestFrequency: string;
    digestTime: string;
  }> {
    const DEFAULTS = {
      enabled: true,
      instantFirstAlert: true,
      criticalImmediate: true,
      digestFrequency: "daily",
      digestTime: "12:00",
    };
    try {
      const memberIds = await this.db.getRestaurantMemberIds(restaurantId);
      if (memberIds.length === 0) return DEFAULTS;
      const { data } = await this.db.supabase
        .from("notification_preferences")
        .select(
          "low_stock_enabled, instant_first_alert, critical_immediate, digest_frequency, digest_time",
        )
        .in("user_id", memberIds);
      if (!data || data.length === 0) return DEFAULTS;

      const dailyTimes = data
        .filter((p: any) => (p.digest_frequency ?? "daily") === "daily")
        .map((p: any) => p.digest_time || "12:00")
        .sort();
      return {
        enabled: data.some((p: any) => p.low_stock_enabled !== false),
        instantFirstAlert: data.some((p: any) => p.instant_first_alert !== false),
        criticalImmediate: data.some((p: any) => p.critical_immediate !== false),
        digestFrequency: dailyTimes.length > 0 ? "daily" : "off",
        digestTime: dailyTimes[0] || "12:00",
      };
    } catch {
      return DEFAULTS;
    }
  }

  /** Currently-low wines for a single restaurant (used by the real-time path). */
  private async getLowStockForRestaurant(
    restaurantId: string,
  ): Promise<LowStockRow[]> {
    const { data, error } = await this.db.supabase
      .from("v_low_stock_items")
      .select("*")
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.warn(`v_low_stock_items (single) failed: ${error.message}`);
      return [];
    }
    const rows: LowStockRow[] = [];
    for (const raw of data || []) {
      const row = this.mapRow(raw);
      if (row) rows.push(row);
    }
    return rows;
  }

  /** Defensive mapping — the view's column names vary across environments. */
  private mapRow(raw: any): LowStockRow | null {
    const inventoryId = raw.id ?? raw.inventory_id;
    if (!inventoryId) return null;
    const currentStock = Number(raw.stock_live ?? raw.current_stock ?? 0);
    const threshold = Number(raw.threshold_min ?? raw.par_level ?? 10);
    if (!(threshold > 0)) return null;
    const severity: "critical" | "low" =
      currentStock <= threshold * this.CRITICAL_RATIO ? "critical" : "low";
    return {
      inventoryId,
      wineId: raw.wine_id ?? raw.master_wine_id ?? inventoryId,
      wineName: raw.wine_name ?? raw.name ?? "Unknown wine",
      currentStock,
      threshold,
      severity,
    };
  }

  private async getAlertState(
    restaurantId: string,
  ): Promise<Map<string, { level: AlertLevel }>> {
    const map = new Map<string, { level: AlertLevel }>();
    const { data } = await this.db.supabase
      .from("inventory_alert_state")
      .select("inventory_id, last_alert_level")
      .eq("restaurant_id", restaurantId);
    for (const r of data || []) {
      map.set(r.inventory_id, { level: (r.last_alert_level || "ok") as AlertLevel });
    }
    return map;
  }

  /**
   * Persist the alert level for one item. Returns true ONLY when the write
   * durably succeeded. The caller uses this to stay fail-closed: an alert is
   * emitted only after we've recorded that we alerted, so a transient DB error
   * (the "fetch failed" Supabase blips) can never cause the same wine to be
   * re-alerted on the next 2-minute sweep.
   */
  private async upsertState(
    restaurantId: string,
    p: {
      inventoryId: string;
      wineName: string;
      level: AlertLevel;
      bumpAlert?: boolean;
      alertedAt?: string;
      digestAt?: string;
    },
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const row: Record<string, any> = {
      restaurant_id: restaurantId,
      inventory_id: p.inventoryId,
      wine_name: p.wineName,
      last_alert_level: p.level,
      updated_at: nowIso,
    };
    if (p.alertedAt) row.last_alerted_at = p.alertedAt;
    if (p.digestAt) row.last_digest_at = p.digestAt;
    try {
      // Count how many times we've alerted on this item (best-effort, +1 per
      // new crossing). Read-modify is fine: the sweep is single-writer.
      if (p.bumpAlert) {
        const { data: cur } = await this.db.supabase
          .from("inventory_alert_state")
          .select("alert_count")
          .eq("restaurant_id", restaurantId)
          .eq("inventory_id", p.inventoryId)
          .maybeSingle();
        row.alert_count = (cur?.alert_count ?? 0) + 1;
      }

      const { error } = await this.db.supabase
        .from("inventory_alert_state")
        .upsert(row, { onConflict: "restaurant_id,inventory_id" });
      if (error) {
        this.logger.warn(`inventory_alert_state upsert failed: ${error.message}`);
        return false;
      }
      return true;
    } catch (e: any) {
      // supabase-js throws (not returns) on network failures ("fetch failed").
      this.logger.warn(`inventory_alert_state upsert threw: ${e?.message}`);
      return false;
    }
  }

  private async getRestaurantNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const { data } = await this.db.supabase
      .from("restaurants")
      .select("id, name")
      .in("id", ids);
    for (const r of data || []) map.set(r.id, r.name);
    return map;
  }

  /** Resolve low-stock email recipients (honours low_stock_channels), env fallback. */
  private async resolveEmails(restaurantId: string): Promise<string[]> {
    if (this.recipientResolver) {
      try {
        const res = await this.recipientResolver.resolveRecipients({
          restaurantId,
          roles: ["manager"],
          channels: ["email"],
        });
        if (res.emails?.length) return res.emails;
      } catch {
        /* fall through to env */
      }
    }
    const env = this.config.get<string>("MANAGER_EMAIL") || "";
    return env
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
  }

  private inventoryUrl(): string {
    const base = this.config.get<string>("FRONTEND_URL") || "";
    return base ? `${base}/inventory?filter=low-stock` : "#";
  }
}
