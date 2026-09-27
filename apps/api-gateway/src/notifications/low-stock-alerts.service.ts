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
import { CRITICAL_RATIO, classifyStock } from "../common/stock-status";
import { NotificationsService } from "./notifications.service";
import { GmailService } from "../communications/gmail.service";
import {
  NOTIFICATION_SEND_CATEGORY,
  RecipientResolverService,
} from "../communications/recipient-resolver.service";
import type { LowStockDigestWine } from "../communications/email-templates";
import { canonicalOrigin } from "../communications/email-templates";
import {
  digestClockFor,
  digestHourOf,
  digestAlreadySentOn,
  hourTick,
  houseWallAt,
  isDigestDue,
  type DigestClock,
  type DigestClockSource,
} from "./low-stock-digest-clock";

type AlertLevel = "ok" | "low" | "critical";

/**
 * The once-a-day digest fence (founder item 74), one row per house:
 * migration 20261021173000_a_low_stock_digest_is_fenced_once_a_house_day.sql.
 */
export const LOW_STOCK_DIGEST_FENCE_TABLE = "low_stock_digest_fence";

interface DigestFence {
  /** `YYYY-MM-DD`, the house-local date claimed, in the zone of that attempt. */
  sentOn: string;
  /** The sweep tick that claimed it — re-read in the house's zone per tick. */
  attemptedAt: Date;
  /** `attempted_at` exactly as read — the compare-and-set's expected value. */
  attemptedAtRaw: string;
}

interface EffectiveLowStockPrefs {
  enabled: boolean;
  instantFirstAlert: boolean;
  criticalImmediate: boolean;
  digestFrequency: string;
  digestTime: string;
}

const LOW_STOCK_PREF_DEFAULTS: EffectiveLowStockPrefs = {
  enabled: true,
  instantFirstAlert: true,
  criticalImmediate: true,
  digestFrequency: "daily",
  digestTime: "12:00",
};

/** `GET /notifications/low-stock/held/:restaurantId` — the held queue. */
export interface HeldCrossingsView {
  restaurant_id: string;
  held: Array<{
    inventory_id: string;
    wine_name: string | null;
    level: string;
    held_at: string;
    reason: string | null;
  }>;
  summary: { count: number; critical: number; oldest_held_at: string | null };
  /**
   * When the held wines will be told, as the digest cron will actually keep
   * it. `null` when the house's preferences, its digest time or its
   * `restaurants` row (the zone) could not be read.
   */
  digest: {
    /** False when every member turned low-stock alerts off. */
    low_stock_enabled: boolean;
    frequency: "daily" | "off";
    /** 0-23; the cron matches the hour only. */
    hour: number;
    /**
     * The IANA zone the digest hour is kept in — the house's own
     * (`restaurants.timezone`), else UTC (founder item 61; ADR 0149 item 56,
     * PR #488). Was the literal New York zone until #488 moved the sweep
     * onto each house's clock.
     */
    timezone: string;
    /**
     * `house` — the house's own zone. `fallback` — no zone this server can
     * read, so UTC; the page says so (item 61: "UTC — this house has no time
     * zone set yet"). `country` is reserved for #435's country step.
     */
    zone_source: DigestClockSource;
  } | null;
}

/**
 * What a low-stock email attempt actually did, written to
 * `notifications.delivery_status.email` (ADR 0093 D5).
 *
 * `recipients` is a COUNT and never an address (ADR 0040). `ok: false` with an
 * `error` is a measured failure; the ABSENCE of this object on a row means the
 * attempt was never recorded, which a reader must render as unknown rather
 * than as "not sent" (ADR 0020).
 */
export interface EmailDeliveryOutcome {
  attempted_at: string;
  ok: boolean;
  error: string | null;
  recipients: number;
  mode: "instant" | "digest";
}

/** What `resolveEmails` could not say in its return value. */
interface RecipientReport {
  /** Members whose preference withheld low-stock email. */
  email: number;
  /** The failed read's words when the lookup failed, else null. */
  lookupFailed: string | null;
}

/**
 * The PostgREST `or` filter every hold-CLEARING write carries: match a row
 * only when it has no hold, or its hold is no newer than `cutoff` -- an
 * instant the writer captured BEFORE it observed the state it is acting on.
 * A hold stamped after that instant was written by someone who saw the wine
 * low later than this writer did, and a clear must not erase it. Postgres
 * evaluates this in the same statement that writes, so there is no
 * read-then-write gap. The cutoff is re-serialised through `Date` so it can
 * only ever be an ISO-8601 instant (no reserved `,()` reaches the filter);
 * the same unquoted `col.lte.<iso>,col.is.null` shape is already used at
 * logs-timeline.service.ts `windowed()`.
 */
export function heldNoNewerThan(cutoff: string): string {
  const iso = new Date(cutoff).toISOString();
  return `last_held_at.is.null,last_held_at.lte.${iso}`;
}

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

  /**
   * Wines at/under 50% of par are "critical"; below that and under par, "low".
   * The number lives in `common/stock-status.ts` now — re-exported here only so
   * the digest copy that quotes it cannot quote a different one.
   */
  private readonly CRITICAL_RATIO = CRITICAL_RATIO;
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
      // Before the read, for the same reason as `evaluateInventoryItems`.
      const lowReadStartedAt = new Date().toISOString();
      const byRestaurant = await this.getLowStockByRestaurant();
      const names = await this.getRestaurantNames([...byRestaurant.keys()]);
      for (const [restaurantId, rows] of byRestaurant) {
        await this.evaluateRestaurant(
          restaurantId,
          rows,
          names.get(restaurantId),
        );
      }
      // Reconcile restocks even for restaurants that dropped off the low list.
      await this.reconcileRecoveries(byRestaurant, lowReadStartedAt);
    } catch (e: any) {
      this.logger.error(`low-stock edge sweep failed: ${e?.message}`);
    }
  }

  /**
   * Digest sweep — runs hourly, on the UTC hour, and for each restaurant
   * sends the batched reminder once per house-local date, on the first
   * evaluated tick at or after that house's OWN local digest hour (item 56 /
   * ADR 0149: "each house's timezone"; item 70: "Catch up same day").
   *
   * The cron itself no longer names a timezone — it fires once per UTC hour
   * — and `runDigestSweepAt` (below) decides per house, per tick, whether
   * the digest is due and not yet sent, using its own clock
   * (`low-stock-digest-clock.ts`: house zone, then UTC when the house has
   * none this server can read — see ADR 0116:297-301).
   */
  @Cron("0 * * * *", { name: "low-stock-digest", timeZone: "UTC" })
  async runDailyDigest(): Promise<void> {
    await this.runDigestSweepAt(new Date());
  }

  /**
   * The digest sweep for one tick, extracted so tests can drive it at any
   * instant without waiting on the cron. `at` is rounded to the nearest UTC
   * hour (`hourTick`) so cron jitter of up to ±30 minutes cannot shift which
   * house-local hour a house is judged against.
   *
   * SAME-DAY CATCH-UP (founder item 70, 2026-09-27, verbatim "Catch up same
   * day (Recommended)"): a house is sent when its local time has reached
   * today's digest hour (`isDigestDue`) AND the house's digest fence
   * (`low_stock_digest_fence`, founder item 74; before it, `last_digest_at`)
   * is not on today's house-local date (`digestAlreadySentOn`). A tick that was skipped, late or
   * never run is therefore made up by the next evaluated tick that day. The
   * price of that is that the fence carries the whole weight of "once a
   * day": when its read or its compare-and-set write fails, the house is
   * SKIPPED this tick — never sent blind — and the next tick tries again
   * (specs k, p). The same holds for the
   * two reads that decide WHETHER and WHEN a house is due: a failed
   * preferences read (spec o) or restaurants read (specs h, i) skips the
   * house this tick; none of the three falls back to a default.
   */
  async runDigestSweepAt(at: Date): Promise<void> {
    try {
      const tick = hourTick(at);
      const byRestaurant = await this.getLowStockByRestaurant();
      if (byRestaurant.size === 0) return;
      // Captured once, right after the read `rows` itself comes from — the
      // true "we observed these holds as of here" instant, before ANY
      // restaurant's email send or writes below (PR #486 round-2 audit,
      // 2026-09-26). Every restaurant in this sweep shares it, which is
      // correct: they all came from the same `getLowStockByRestaurant` call.
      const rowsSnapshotAt = new Date().toISOString();
      const ids = [...byRestaurant.keys()];
      const names = await this.getRestaurantNames(ids);
      const houses = await this.getRestaurantHouses(ids);
      // The once-a-day fence (founder item 74), read once for the tick. A
      // failed read is checked per house below, and only for a house that is
      // due — it SKIPS that house, never sends it blind.
      const fences = await this.readDigestFences(ids);

      for (const [restaurantId, rows] of byRestaurant) {
        // The THROWING prefs read, not `getEffectiveLowStockPrefs`: that one
        // turns a failed read into the defaults (on, daily, 12:00). Under
        // same-day catch-up every tick from local noon to midnight would then
        // be "due" for a house that turned the digest off or set a later
        // hour; the early send stamps `last_digest_at` for today, and that
        // stamp suppresses the house's real hour for the rest of the day
        // (PR #488 audit at 7b2ab8d3f). So an unreadable preference SKIPS the
        // house this tick, like the dedupe and restaurants reads below, and
        // the next readable tick catches it up (spec o).
        let prefs: EffectiveLowStockPrefs;
        try {
          prefs = await this.readLowStockPrefs(restaurantId);
        } catch (e: any) {
          this.logger.warn(
            `LOW_STOCK_DIGEST_PREFS_UNREADABLE restaurant=${restaurantId} — notification preferences could not be read (${e?.message}); skipping this tick rather than sending on the defaults, a later tick today catches it up.`,
          );
          continue;
        }
        if (!prefs.enabled || prefs.digestFrequency === "off") continue;

        const hour = digestHourOf(prefs.digestTime);
        if (hour === null) {
          this.logger.warn(
            `LOW_STOCK_DIGEST_TIME_UNREADABLE restaurant=${restaurantId} digest_time=${JSON.stringify(prefs.digestTime)} — skipping this tick.`,
          );
          continue;
        }

        if (!houses.ok) {
          // The batched restaurants read failed for this whole tick — an
          // unreadable row is never silently "no timezone → UTC" (that would
          // misfire LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN for a house that in
          // fact has a zone this server just failed to read). Skip this
          // house this tick; under same-day catch-up the next tick whose
          // read succeeds sends it, if its hour has passed and it has not
          // been sent today (spec i).
          this.logger.warn(
            `LOW_STOCK_DIGEST_HOUSE_UNREADABLE restaurant=${restaurantId} — restaurants row (timezone/country) could not be read; skipping this tick, a later tick today catches it up.`,
          );
          continue;
        }

        const house = houses.map.get(restaurantId) ?? null;
        const clock = digestClockFor(house);
        if (!isDigestDue(tick, clock.zone, hour)) continue;

        const periodKey = houseWallAt(tick, clock.zone).dateKey;

        // THE FENCE (founder item 74, 2026-09-27, verbatim "Own fence column
        // (Recommended)"): `low_stock_digest_fence`, one row per house,
        // written BEFORE the email is attempted and independent of the inbox
        // row and of `inventory_alert_state.last_digest_at`. It replaced the
        // `last_digest_at` read (item 70's dedupe) and the in-process
        // `digestSentOn` map, which together could not fence a digest that
        // wrote no inbox row across a restart or a second replica.
        if (!fences.ok) {
          // SKIP, never send: under catch-up this read is the only thing
          // between the house and a digest every hour until midnight
          // (founder item 70: "a failed dedupe read SKIPS (never
          // double-send)"). The next tick reads again, so one failed read
          // delays today's digest, it does not lose it (spec k).
          this.logger.warn(
            `LOW_STOCK_DIGEST_DEDUPE_UNREADABLE restaurant=${restaurantId} date=${periodKey} — the digest fence could not be read; skipping this tick so it cannot send twice, a later tick today retries.`,
          );
          continue;
        }
        const fence = fences.map.get(restaurantId) ?? null;
        // The last attempt's INSTANT, read in the house's zone at this tick,
        // so a house whose zone changed mid-day is judged in its new zone
        // (spec n). `sent_on` is the same date in the zone of the attempt.
        if (
          fence &&
          digestAlreadySentOn(
            houseWallAt(fence.attemptedAt, clock.zone).dateKey,
            periodKey,
          )
        ) {
          continue;
        }

        if (clock.source === "fallback") {
          this.logger.warn(
            `LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN restaurant=${restaurantId} timezone=${JSON.stringify(clock.recorded)} — no zone this server can read; the digest runs on ${clock.zone}.`,
          );
        }

        // Claim the date BEFORE the send, compare-and-set: of two replicas
        // (or two runs) that both read the same fence, exactly one claims
        // it. A claim that is lost or cannot be written SKIPS — never sends
        // (spec p). Once claimed, the date is spent whatever the send does:
        // a send that throws part-way, writes no inbox row (#486's early
        // return) or fails its email is not repeated that day by any process
        // (a failed email is recorded on the notification row, as before).
        const claim = await this.claimDigestFence(
          restaurantId,
          fence,
          periodKey,
          tick,
        );
        if (claim !== "claimed") {
          if (claim === "taken") {
            this.logger.log(
              `Low-stock digest for ${restaurantId} date=${periodKey}: another run claimed today's fence first — not sending.`,
            );
          } else {
            this.logger.warn(
              `LOW_STOCK_DIGEST_FENCE_UNWRITTEN restaurant=${restaurantId} date=${periodKey} — the digest fence could not be written; skipping this tick so it cannot send twice, a later tick today retries.`,
            );
          }
          continue;
        }
        await this.sendDigest(
          restaurantId,
          rows,
          names.get(restaurantId),
          rowsSnapshotAt,
          { periodKey },
        );
      }
    } catch (e: any) {
      this.logger.error(`low-stock digest failed: ${e?.message}`);
    }
  }

  // Manual triggers (tests / on-demand — bypass the hour gate).
  async triggerEdgeSweep(): Promise<void> {
    await this.runEdgeSweep();
  }
  async triggerDailyDigest(): Promise<void> {
    const byRestaurant = await this.getLowStockByRestaurant();
    const rowsSnapshotAt = new Date().toISOString();
    const names = await this.getRestaurantNames([...byRestaurant.keys()]);
    for (const [restaurantId, rows] of byRestaurant) {
      const prefs = await this.getEffectiveLowStockPrefs(restaurantId);
      if (!prefs.enabled || prefs.digestFrequency === "off") continue;
      await this.sendDigest(
        restaurantId,
        rows,
        names.get(restaurantId),
        rowsSnapshotAt,
      );
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

      // The LEVEL is written first and unconditionally, because it is the
      // dedupe: only a crossing whose new level we DURABLY recorded is
      // eligible to alert, so a DB blip cannot make us re-send forever.
      //
      // `last_alerted_at` and `alert_count` are NOT written here any more.
      // They used to be, inside this loop, before the cooldown check below and
      // before prefs had decided whether anything would be sent — so the
      // ledger claimed 7 alerts while `notifications` held 2 rows covering 3
      // wines (POS lens, absence-as-health 8). A ledger that timestamps an
      // alert nobody received answers "did we tell them?" with a confident,
      // wrong yes.
      const persisted = await this.upsertState(restaurantId, {
        inventoryId: row.inventoryId,
        wineName: row.wineName,
        level: cur,
      });
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
    const heldByPrefs = persistedNew.filter((w) => !immediate.includes(w));
    const now = Date.now();
    const cooledDown =
      now - (this.lastInstantAt.get(restaurantId) ?? 0) >=
      this.INSTANT_COOLDOWN_MS;

    if (immediate.length > 0 && cooledDown) {
      this.lastInstantAt.set(restaurantId, now);
      const delivered = await this.fireInstantAlert(
        restaurantId,
        immediate,
        restaurantName,
      );
      // Stamped only now, and only for the wines the notification names. If
      // `persistForRestaurant` produced no row, `delivered` is false and these
      // wines are recorded as held rather than as alerted — the same defect
      // one layer down, and it must not be reintroduced there.
      await this.recordAlertOutcome(
        restaurantId,
        immediate,
        // A failed inbox write is held with NO reason rather than "prefs":
        // the held queue writes "prefs" to a person as "this house's settings
        // save low stock for the digest", which is not why this one waited
        // (held-queue lane, 2026-09-26). The column's check allows only the
        // two chosen reasons or NULL, so NULL — "not recorded" — is the
        // honest value without a migration.
        delivered ? { alertedAt: nowIso } : { heldAt: nowIso, reason: null },
      );
    } else if (immediate.length > 0) {
      this.logger.log(
        `Low-stock instant alert for ${restaurantId} suppressed by cooldown (${immediate.length} wines roll into the digest).`,
      );
      await this.recordAlertOutcome(restaurantId, immediate, {
        heldAt: nowIso,
        reason: "instant_cooldown",
      });
    }

    // Crossings the manager's own settings held back are real crossings that
    // nobody has been told about. Recording them as held is what makes
    // "waiting for tonight's digest" visible instead of looking like nothing
    // happened.
    if (heldByPrefs.length > 0) {
      await this.recordAlertOutcome(restaurantId, heldByPrefs, {
        heldAt: nowIso,
        reason: "prefs",
      });
    }

    return { newCrossings };
  }

  /**
   * Crossings that have happened and that nobody has been told about yet.
   *
   * This is the read side of the ledger fix. Before it, a crossing suppressed
   * by the instant cooldown or by the manager's own preferences was
   * indistinguishable from a crossing that never happened — both left
   * `last_alerted_at` looking settled — so "the digest will cover it tonight"
   * and "nothing is wrong" rendered identically. The queue is small and the
   * consequence of not knowing about it is a stockout, so it is worth a row on
   * the screen rather than a line in a log.
   *
   * A failed read throws rather than returning an empty list (ADR 0067): an
   * empty held-queue is good news, and good news must be measured.
   */
  async listHeldCrossings(restaurantId: string): Promise<HeldCrossingsView> {
    const { data, error } = await this.db.supabase
      .from("inventory_alert_state")
      .select(
        "inventory_id, wine_name, last_alert_level, last_held_at, last_held_reason, last_digest_at",
      )
      .eq("restaurant_id", restaurantId)
      .not("last_held_at", "is", null)
      .order("last_held_at", { ascending: false });
    if (error) throw new Error(error.message);

    // (2026-09-26, held-queue lane) Two kinds of row carry a `last_held_at`
    // and are NOT waiting on anybody, and until today both were listed:
    //   - a wine back above par (`last_alert_level = 'ok'`): recovery reset
    //     the level and never cleared the hold;
    //   - a wine the digest already covered (`last_digest_at >= last_held_at`):
    //     the digest stamped its own column and never cleared the hold.
    // The writers now clear the hold in both places. This read-side filter is
    // for the rows written before that fix, which nothing backfills.
    const held = (data || [])
      .filter((r: any) => (r.last_alert_level ?? "low") !== "ok")
      .filter(
        (r: any) =>
          !r.last_digest_at ||
          new Date(r.last_digest_at).getTime() <
            new Date(r.last_held_at).getTime(),
      )
      .map((r: any) => ({
        inventory_id: r.inventory_id,
        wine_name: r.wine_name ?? null,
        level: r.last_alert_level ?? "low",
        held_at: r.last_held_at,
        reason: r.last_held_reason ?? null,
      }));

    // When — or whether — the held wines will be told. A digest that is off
    // means a held crossing is never sent on its own, and the page has to say
    // so rather than promise "the next digest". A preferences read that fails
    // is `null`, never the defaults: "12:00, daily" invented over a failed
    // read would be a claim about this house nobody measured.
    //
    // (2026-09-27, PR #488 merge) The hour and zone are the ones the sweep
    // itself uses: `digestHourOf` (an unreadable `digest_time` is never sent,
    // so it is never reported as 12:00 either) and `digestClockForRestaurant`
    // (the house's zone, else UTC; `null` when the restaurants read failed).
    let digest: HeldCrossingsView["digest"] = null;
    try {
      const prefs = await this.readLowStockPrefs(restaurantId);
      // The digest cron fires on the hour (`0 * * * *`) and matches only the
      // HOUR of `digest_time`, so a 12:30 setting goes out at 12:00. The
      // time reported is the one the cron will actually keep.
      const hour = digestHourOf(prefs.digestTime);
      if (hour === null) {
        throw new Error(
          `digest_time ${JSON.stringify(prefs.digestTime)} is unreadable`,
        );
      }
      const clock = await this.digestClockForRestaurant(restaurantId);
      if (!clock) throw new Error("restaurants row (timezone) unreadable");
      digest = {
        low_stock_enabled: prefs.enabled,
        frequency: prefs.digestFrequency === "daily" ? "daily" : "off",
        hour,
        timezone: clock.zone,
        zone_source: clock.source,
      };
    } catch (e: any) {
      this.logger.warn(
        `held crossings: digest time or zone unreadable for ${restaurantId}: ${e?.message}`,
      );
    }

    return {
      restaurant_id: restaurantId,
      held,
      summary: {
        count: held.length,
        critical: held.filter((h) => h.level === "critical").length,
        oldest_held_at: held.length > 0 ? held[held.length - 1].held_at : null,
      },
      digest,
    };
  }

  /**
   * Write what actually became of a crossing.
   *
   * Exactly one of two things is true of every crossing that reaches here: a
   * notification row exists for it, or it is waiting. Both are recorded;
   * neither is inferred from the absence of the other, because
   * `last_alerted_at IS NULL` already means "no crossing detected" and
   * overloading it with "held" would put us back where we started.
   */
  private async recordAlertOutcome(
    restaurantId: string,
    wines: LowStockRow[],
    outcome:
      | { alertedAt: string }
      | { heldAt: string; reason: "instant_cooldown" | "prefs" | null },
  ): Promise<void> {
    for (const w of wines) {
      const persisted = await this.upsertState(restaurantId, {
        inventoryId: w.inventoryId,
        wineName: w.wineName,
        level: w.severity,
        ...("alertedAt" in outcome
          ? {
              bumpAlert: true,
              alertedAt: outcome.alertedAt,
              clearHold: true,
              // `outcome.alertedAt` is `evaluateRestaurant`'s `nowIso` --
              // captured before `getAlertState`, before the per-row writes,
              // and before `fireInstantAlert`'s own persist + email send --
              // so it is a valid pre-slow-work cutoff for the same guard
              // `sendDigest` uses (PR #486 round-2 audit, 2026-09-26).
              clearHoldNotAfter: outcome.alertedAt,
            }
          : { heldAt: outcome.heldAt, heldReason: outcome.reason }),
      });
      // (PR #486 round-2 audit, secondary finding, 2026-09-26) This return
      // value used to be discarded. When the clear-hold guard skips a write
      // for a wine that WAS actually alerted (a fresher hold arrived in the
      // gap, or the guard's own read failed), `last_held_at` is left set, so
      // `listHeldCrossings` keeps reporting a told wine as still waiting --
      // over-reporting a hold, never under-alerting, but still the exact
      // fault this file exists to close, one call site over. There is
      // nothing more to DO here (the alert already went out and will not be
      // resent), so this is surfaced rather than silently swallowed.
      if ("alertedAt" in outcome && !persisted) {
        this.logger.warn(
          `inventory_alert_state clear-hold for ${restaurantId}/${w.inventoryId} was skipped after a delivered alert -- it will keep reading "held" on the queue until this wine crosses again or the digest covers it.`,
        );
      }
    }
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
      // Captured BEFORE the low-stock read: a hold stamped after this was
      // written by a writer that saw the wine low later than we saw it
      // recovered, so the recovery clear below must leave it (PR #486
      // rounds 3-4 audit).
      const readStartedAt = new Date().toISOString();
      const lowRows = await this.getLowStockForRestaurant(restaurantId);
      const lowById = new Map(lowRows.map((r) => [r.inventoryId, r]));

      const nowLow = inventoryIds
        .map((id) => lowById.get(id))
        .filter((r): r is LowStockRow => !!r);
      if (nowLow.length > 0) {
        const names = await this.getRestaurantNames([restaurantId]);
        await this.evaluateRestaurant(
          restaurantId,
          nowLow,
          names.get(restaurantId),
        );
      }

      // Depleted (or restocked) items that are no longer low → clear stale state.
      const recovered = inventoryIds.filter((id) => !lowById.has(id));
      if (recovered.length > 0) {
        await this.db.supabase
          .from("inventory_alert_state")
          .update({
            last_alert_level: "ok",
            // A wine back above par is not waiting to be told about anything.
            last_held_at: null,
            last_held_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("restaurant_id", restaurantId)
          .in("inventory_id", recovered)
          .neq("last_alert_level", "ok")
          .or(heldNoNewerThan(readStartedAt));
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
    /** True only when an inbox row was actually written. The caller stamps the
     * ledger on this, so it must never report success it did not observe. */
  ): Promise<boolean> {
    const criticalCount = wines.filter((w) => w.severity === "critical").length;
    const priority: "critical" | "high" =
      criticalCount > 0 ? "critical" : "high";
    const list = wines
      .map((w) => `${w.wineName} (${w.currentStock}/${w.threshold})`)
      .join(", ");
    // No emoji in a stored title (ADR 0042 / the 2026-09-03 house rule): the
    // inbox draws the register's mark itself, and an emoji written into the
    // row is unstylable, unsearchable and permanent. The severity the emoji
    // used to carry is stated in WORDS here and repeated in `priority` and
    // `metadata.criticalCount`, so nothing is lost by dropping the picture.
    const title =
      wines.length === 1
        ? `${wines[0].severity === "critical" ? "Critical" : "Low stock"}: ${wines[0].wineName}`
        : criticalCount > 0
          ? `${wines.length} wines dropped below par — ${criticalCount} critical`
          : `${wines.length} wines dropped below par`;

    // 1) In-app inbox — the reliable channel (works even with no email set up).
    const persisted = await this.notifications.persistForRestaurant(
      restaurantId,
      {
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
      },
    );

    // 2) Email — one grouped digest email for the burst.
    const outcome = await this.emailDigest(
      restaurantId,
      wines,
      "instant",
      restaurantName,
    );
    await this.recordEmailOutcome(persisted?.ids, outcome);

    // The INBOX row is what "we told them" means here — email delivery is
    // recorded separately and is allowed to fail (the lens run's two alerts
    // both carried `email = {ok:false, error:"no_recipients"}` and that was
    // correct). No inbox row means nothing was told.
    //
    // (2026-09-26, held-queue lane) This read `Boolean(persisted)`, which is
    // true for EVERY answer `persistForRestaurant` gives: it never resolves
    // falsy — a failed insert, a house with no members and a dedupe hit all
    // come back as `{ inserted: 0, ids: [] }`, an object. So a crossing whose
    // inbox write failed was stamped alerted and dropped out of the held
    // queue — the fault the `last_held_at` column exists to prevent, one layer
    // down. The count is the fact.
    return (persisted?.inserted ?? 0) > 0;
  }

  /**
   * The batched daily reminder — every currently-low wine in one email + one
   * grouped inbox row. Deduped so a double cron fire won't repeat it.
   *
   * `rowsSnapshotAt` is when `rows` was actually read (`getLowStockByRestaurant`
   * in the caller, before this restaurant's — or any restaurant's — digest
   * started sending). It defaults to "now" for a caller with no such instant
   * to hand down (there is currently none — every real caller passes it), but
   * "now" at entry is itself an equally valid, if slightly looser, cutoff:
   * either way it is captured HERE, before the email send and the N writes
   * below, which is the gap the round-2 audit finding named.
   */
  async sendDigest(
    restaurantId: string,
    rows: LowStockRow[],
    restaurantName?: string,
    rowsSnapshotAt?: string,
    /**
     * Passed only by the hourly sweep (`runDigestSweepAt`); omitted by
     * `triggerDailyDigest` and every direct caller, which keep the UTC date
     * and a now-stamp.
     *
     * `periodKey` is the house-local date (`YYYY-MM-DD`) this digest belongs
     * to, from the sweep's `houseWallAt(tick, clock.zone)`.
     *
     * (2026-09-27, founder item 74) The sweep no longer passes a `digestAt`.
     * It stamped `last_digest_at` with its hour TICK, because that stamp was
     * the once-a-day dedupe and had to sit on the tick's house date (spec
     * j2). The tick runs up to 29 minutes ahead of the clock on a late run,
     * and `listHeldCrossings` hides a hold whose `last_held_at` is not after
     * `last_digest_at` — so a hold written in that window was hidden from the
     * held band though this digest never told anyone about it. The dedupe
     * now lives in `low_stock_digest_fence` (which holds the tick), so
     * `last_digest_at` is stamped with `snapshotAt`: the instant the rows
     * this digest tells were read (spec j2, spec q).
     */
    sweep?: { periodKey: string },
  ): Promise<void> {
    if (rows.length === 0) return;
    const snapshotAt = rowsSnapshotAt ?? new Date().toISOString();
    const criticalCount = rows.filter((w) => w.severity === "critical").length;
    const dateStr = sweep?.periodKey ?? new Date().toISOString().slice(0, 10);

    const persisted = await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: "inventory_low_stock",
        title: `Low-stock digest: ${rows.length} wine${rows.length === 1 ? "" : "s"} below par`,
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

    const outcome = await this.emailDigest(
      restaurantId,
      rows,
      "digest",
      restaurantName,
    );
    await this.recordEmailOutcome(persisted?.ids, outcome);

    // Stamp the digest on the ledger — and end every hold it answered.
    //
    // (2026-09-26, held-queue lane) Before this, the digest stamped
    // `last_digest_at` and left `last_held_at` alone, so a wine the digest had
    // just told the house about still read "held — nobody has been told" on
    // /notifications until it happened to cross again. And it stamped even
    // when the inbox write was deduped or failed (`inserted: 0`), which made
    // "a digest went out" a claim about an intention. Both halves now follow
    // the same rule as the instant path: only a written inbox row counts.
    //
    // (2026-09-27, PR #488 merge with #486) On this early return nothing is
    // stamped. That no longer leaves the day unfenced: the sweep claimed
    // `low_stock_digest_fence` for this house date BEFORE calling here
    // (founder item 74), so no restart or second replica sends it again
    // (TD-2026-09-27-LOW-STOCK-DIGEST-UNTOLD-NOT-FENCED, resolved; spec r).
    const told = (persisted?.inserted ?? 0) > 0;
    if (!told) {
      this.logger.warn(
        `Low-stock digest for ${restaurantId} wrote no inbox row — holds are left in place and last_digest_at is not stamped; the sweep's digest fence already holds today.`,
      );
      return;
    }
    // When the rows were read (see `sweep` above) — not the sweep's tick,
    // which can run up to 29 minutes ahead and would hide a hold written in
    // that window from the held band.
    const stampIso = snapshotAt;
    let stamped = 0;
    for (const row of rows) {
      const ok = await this.upsertState(restaurantId, {
        inventoryId: row.inventoryId,
        wineName: row.wineName,
        level: row.severity,
        digestAt: stampIso,
        clearHold: true,
        // The pre-slow-work cutoff (see the doc comment above) — the same
        // instant as the stamp since founder item 74. Never a now-stamp
        // taken after the email send and after every sibling row in this
        // loop, and never the sweep's tick (up to 29 minutes AHEAD of the
        // read): either would clear a hold this digest never told anyone
        // about (round-1 defect of #486).
        clearHoldNotAfter: snapshotAt,
      });
      if (ok) stamped++;
    }
    // None written: the holds this digest answered stay listed as held.
    // The day itself is fenced by `low_stock_digest_fence`, not by this
    // stamp (founder item 74), so nothing is sent again (spec m).
    if (stamped === 0) {
      this.logger.warn(
        `LOW_STOCK_DIGEST_STAMP_UNWRITTEN restaurant=${restaurantId} date=${dateStr} — last_digest_at could not be written; the held queue keeps these wines until the next digest, and the digest fence still holds today.`,
      );
    }
  }

  /**
   * Send the batched email via Gmail, and REPORT what happened.
   *
   * This used to return `void` on every path — sent, threw, no Gmail, no
   * recipients — and the only trace of a failure was a `logger.warn` nobody
   * can query. An email that never left read exactly like one that did
   * ([[absence-reported-as-health]]). The outcome now travels back to the
   * caller, which stamps it on the notification rows (ADR 0093 D5).
   */
  private async emailDigest(
    restaurantId: string,
    rows: LowStockRow[],
    mode: "instant" | "digest",
    restaurantName?: string,
  ): Promise<EmailDeliveryOutcome> {
    const attempted_at = new Date().toISOString();
    if (!this.gmail) {
      this.logger.log(
        `Low-stock ${mode} for ${restaurantId}: Gmail is not configured — inbox only`,
      );
      return {
        attempted_at,
        ok: false,
        error: "gmail_not_configured",
        recipients: 0,
        mode,
      };
    }
    const report: RecipientReport = { email: 0, lookupFailed: null };
    const emails = await this.resolveEmails(restaurantId, report);
    const declinedByPreference = report.email;
    if (emails.length === 0) {
      // Three different facts, kept apart (ADR 0020). "The recipients could
      // not be read", "nobody to send to" and "the people here said no to
      // low-stock email" must not read alike on the row. Since OD-121
      // (2026-09-16) the low-stock category reads only `low_stock_channels`,
      // whose column default holds no email, so the third is the ordinary case
      // on a stock row — for every house except the legacy one, whose env
      // fallback still answers when its members decline. A failed read was
      // recorded as `no_recipients` until 2026-09-17 (notify-lane review M2).
      const error = report.lookupFailed
        ? "recipient_lookup_failed"
        : declinedByPreference > 0
          ? "declined_by_preference"
          : "no_recipients";
      const words = report.lookupFailed
        ? `the recipients could not be read (${report.lookupFailed})`
        : declinedByPreference > 0
          ? `${declinedByPreference} member(s) declined low-stock email by preference`
          : "no email recipients";
      if (report.lookupFailed) {
        this.logger.error(
          `Low-stock ${mode} for ${restaurantId}: ${words} — inbox only`,
        );
      } else {
        this.logger.log(
          `Low-stock ${mode} for ${restaurantId}: ${words} — inbox only`,
        );
      }
      return {
        attempted_at,
        ok: false,
        error,
        recipients: 0,
        mode,
      };
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
      return {
        attempted_at,
        ok: true,
        error: null,
        // COUNT ONLY. ADR 0040: an address never lands in a row a page
        // renders, and "who was told" is not a question this column answers.
        recipients: emails.length,
        mode,
      };
    } catch (e: any) {
      this.logger.warn(`Low-stock ${mode} email failed: ${e?.message}`);
      return {
        attempted_at,
        ok: false,
        error: e?.message ? String(e.message) : "unknown_error",
        recipients: emails.length,
        mode,
      };
    }
  }

  /**
   * Stamp the send outcome onto `notifications.delivery_status.email`.
   *
   * Read-modify-write on purpose: `delivery_status` is a shared jsonb bag and
   * other channels (push, SMS) may own their own keys in it. A blind
   * `update({ delivery_status: { email } })` would DELETE theirs, which is a
   * quieter version of the same fault this whole change is about.
   *
   * Best-effort and never thrown: the alert itself already landed, and losing
   * the audit stamp must not lose the alert. A failure is logged with the ids
   * it could not stamp, so the gap is enumerable rather than invisible.
   */
  private async recordEmailOutcome(
    notificationIds: string[] | undefined,
    outcome: EmailDeliveryOutcome,
  ): Promise<void> {
    if (!notificationIds?.length) return;
    try {
      const { data, error } = await this.db.supabase
        .from("notifications")
        .select("id, delivery_status")
        .in("id", notificationIds);
      if (error) {
        this.logger.warn(
          `delivery_status read failed for ${notificationIds.length} notification(s): ${error.message} — the email outcome (${outcome.ok ? "sent" : outcome.error}) is not recorded on them`,
        );
        return;
      }
      for (const row of data ?? []) {
        const existing =
          row.delivery_status && typeof row.delivery_status === "object"
            ? row.delivery_status
            : {};
        const { error: updateError } = await this.db.supabase
          .from("notifications")
          .update({ delivery_status: { ...existing, email: outcome } })
          .eq("id", row.id);
        if (updateError) {
          this.logger.warn(
            `delivery_status write failed for notification ${row.id}: ${updateError.message}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`delivery_status stamp failed: ${e?.message}`);
    }
  }

  /** Reset the ledger for wines that recovered above par (silent — no spam). */
  private async reconcileRecoveries(
    byRestaurant: Map<string, LowStockRow[]>,
    /** When `byRestaurant` was read -- captured before that read. A hold
     * newer than this was written by someone who saw the wine low after we
     * saw it recovered, and is left in place (next sweep re-decides). */
    lowReadStartedAt: string,
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
            .update({
              last_alert_level: "ok",
              // Recovered: the hold ends with the crossing (held-queue lane).
              last_held_at: null,
              last_held_reason: null,
              updated_at: new Date().toISOString(),
            })
            .eq("restaurant_id", s.restaurant_id)
            .eq("inventory_id", s.inventory_id)
            .or(heldNoNewerThan(lowReadStartedAt));
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
  private async getEffectiveLowStockPrefs(
    restaurantId: string,
  ): Promise<EffectiveLowStockPrefs> {
    try {
      return await this.readLowStockPrefs(restaurantId);
    } catch {
      return { ...LOW_STOCK_PREF_DEFAULTS };
    }
  }

  /**
   * The same aggregate as `getEffectiveLowStockPrefs`, but a failed read
   * THROWS. The senders fall back to the defaults (a missed alert is worse
   * than a default one); a page that reports the digest time to a person must
   * not (held-queue lane, 2026-09-26).
   *
   * This uses `getRestaurantMemberIdsOrThrow`, not the plain
   * `getRestaurantMemberIds` — that one's `catch { return []; }`
   * (database.service.ts) makes a swallowed member-read failure
   * indistinguishable from a legitimate zero-member house, which would have
   * returned DEFAULTS here without throwing on exactly the failure this
   * method exists to surface (PR #486 round-1 audit finding 1, 2026-09-26).
   */
  private async readLowStockPrefs(
    restaurantId: string,
  ): Promise<EffectiveLowStockPrefs> {
    const DEFAULTS = { ...LOW_STOCK_PREF_DEFAULTS };
    const memberIds = await this.db.getRestaurantMemberIdsOrThrow(restaurantId);
    if (memberIds.length === 0) return DEFAULTS;
    const { data, error } = await this.db.supabase
      .from("notification_preferences")
      .select(
        "low_stock_enabled, instant_first_alert, critical_immediate, digest_frequency, digest_time",
      )
      // (2026-09-19, D5) preferences are per (restaurant_id, user_id) since
      // ADR 0149 row 39 -- a member of two houses has a row per house, and
      // an unscoped `.in("user_id", ...)` mixed the OTHER house's row into
      // this restaurant's aggregate.
      .eq("restaurant_id", restaurantId)
      .in("user_id", memberIds);
    if (error) throw new Error(error.message);
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
    // The same `classifyStock` the /inventory chip and /summary now use
    // (common/stock-status.ts, pinned by datasets/sim/fixtures/below-par-cases.json).
    // This service and the page disagreed on the lens run — it called Tsantali
    // at 2/5 "critical" while /summary reported criticalCount 0 — and the only
    // durable fix for two implementations of one rule is to stop having two.
    const band = classifyStock(currentStock, threshold);
    // Rows arrive from v_low_stock_items, which is already `stock < par`, so
    // `at_par`/`healthy` cannot appear here. If one ever does — the view and
    // this predicate having drifted — it is dropped rather than alerted on,
    // and said so, because alerting a venue about a wine that is not low is
    // how people learn to ignore alerts.
    if (band !== "critical" && band !== "low") {
      this.logger.warn(
        `v_low_stock_items returned ${raw.wine_name ?? inventoryId} at ${currentStock}/${threshold}, which classifyStock calls '${band}' — not alerting. The view's predicate and common/stock-status.ts have drifted.`,
      );
      return null;
    }
    const severity: "critical" | "low" = band;
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
      map.set(r.inventory_id, {
        level: (r.last_alert_level || "ok") as AlertLevel,
      });
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
      /** A crossing detected and deliberately not sent yet. */
      heldAt?: string;
      heldReason?: "instant_cooldown" | "prefs" | null;
      /** Something was sent, so the hold is over. */
      clearHold?: boolean;
      /**
       * ONLY meaningful with `clearHold`: the instant the caller observed
       * "this wine is being told about now", captured BEFORE the slow work
       * (an email send, N sibling writes) that separates that decision from
       * this write actually landing. A hold currently on the row that is
       * NEWER than this instant was written by someone else (the edge sweep)
       * DURING that gap, describes a crossing THIS call never told anyone
       * about, and must survive. Omit only when the caller has no slow work
       * between deciding and writing (there is currently no such caller);
       * the cutoff then falls back to the instant this call began.
       */
      clearHoldNotAfter?: string;
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
    if (p.heldAt) {
      row.last_held_at = p.heldAt;
      row.last_held_reason = p.heldReason ?? null;
    }
    // An alert going out ends the hold. Leaving a stale `last_held_at` behind
    // would make an alerted wine look like one still waiting, which is the
    // same fault as the one this column was added to fix, mirrored.
    if (p.clearHold) {
      row.last_held_at = null;
      row.last_held_reason = null;
    }
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

      if (p.clearHold) {
        // The digest snapshots `rows` once and then awaits an email send plus
        // N writes per restaurant (sendDigest) — minutes, not milliseconds —
        // while the independent edge sweep runs every 2 minutes and can
        // record a FRESH, unnotified hold on this same wine in that window.
        // A blind upsert here would silently overwrite that fresher hold
        // (and its level) with the digest's stale snapshot — the exact
        // "absence reported as health" fault this PR exists to close, one
        // layer down (PR #486 round-1 audit finding 2, 2026-09-26).
        //
        // ROUND 1's fix read `last_held_at` immediately before this write and
        // conditioned the write on THAT SAME just-read value. That compares
        // a number to itself: it only protects the read-to-write gap (a
        // single Postgres round trip), never the multi-minute gap between
        // the digest's OWN snapshot and this call, which is the gap the
        // finding actually named. Both an independent correctness pass and
        // an independent security pass converged on this exact defect during
        // the PR #486 round-2 audit (2026-09-26) and the test that claimed to
        // prove the fix exercised a scenario the production code path could
        // not produce under that race.
        //
        // ROUND 2 fix: the caller now hands down `clearHoldNotAfter` — an
        // instant it captured BEFORE its own slow work began, not something
        // read fresh in here. A hold timestamped after that cutoff was
        // written by someone else during the caller's slow work and is left
        // alone.
        //
        // ROUNDS 3-4 fix (PR #486 audits, 2026-09-27): round 2 read
        // `last_held_at` first and ran the `<= cutoff` compare-and-swap only
        // when that read found a hold. When it found none it fell through to
        // the blind `.upsert()` below, so a hold the edge sweep wrote between
        // that read and that write was clobbered -- the swap was atomic only
        // on one of its two branches. There is no read any more. The clear is
        // ONE conditional statement,
        //   UPDATE ... WHERE last_held_at IS NULL OR last_held_at <= cutoff
        // so "no hold" and "an old hold" are decided by Postgres in the same
        // statement that writes, and a newer hold is never matched. Only if
        // that matches nothing is the row inserted -- and only if it does not
        // exist (`ignoreDuplicates`, i.e. ON CONFLICT DO NOTHING), never
        // merged over a row someone else wrote. A row that exists and did not
        // match carries a newer hold, and is left in place.
        //
        // Scope of the claim: this makes THIS clear atomic against a
        // concurrent hold write. The two recovery writers
        // (`evaluateInventoryItems`, `reconcileRecoveries`) carry the same
        // `IS NULL OR <= their own pre-read instant` condition; the
        // level-only and hold-setting writes do not clear a hold and are not
        // conditioned.
        const cutoff = new Date(p.clearHoldNotAfter ?? nowIso).toISOString();
        const { data: updated, error: updateError } = await this.db.supabase
          .from("inventory_alert_state")
          .update(row)
          .eq("restaurant_id", restaurantId)
          .eq("inventory_id", p.inventoryId)
          .or(heldNoNewerThan(cutoff))
          .select("inventory_id");
        if (updateError) {
          this.logger.warn(
            `inventory_alert_state clear-hold update failed: ${updateError.message}`,
          );
          return false;
        }
        if (updated && updated.length > 0) return true;

        const { data: inserted, error: insertError } = await this.db.supabase
          .from("inventory_alert_state")
          .upsert(row, {
            onConflict: "restaurant_id,inventory_id",
            ignoreDuplicates: true,
          })
          .select("inventory_id");
        if (insertError) {
          this.logger.warn(
            `inventory_alert_state clear-hold insert failed: ${insertError.message}`,
          );
          return false;
        }
        if (inserted && inserted.length > 0) return true;

        // The row exists and its hold is newer than the cutoff (or a row
        // appeared between the two statements -- the rarer case, reported
        // the same fail-closed way: the hold, if any, stays).
        this.logger.warn(
          `inventory_alert_state clear-hold skipped for restaurant ${restaurantId} / ${p.inventoryId}: last_held_at is newer than this call's snapshot (${cutoff}) -- a fresher, unnotified crossing was recorded in between and is left in place.`,
        );
        return false;
      }

      const { error } = await this.db.supabase
        .from("inventory_alert_state")
        .upsert(row, { onConflict: "restaurant_id,inventory_id" });
      if (error) {
        this.logger.warn(
          `inventory_alert_state upsert failed: ${error.message}`,
        );
        return false;
      }
      return true;
    } catch (e: any) {
      // supabase-js throws (not returns) on network failures ("fetch failed").
      this.logger.warn(`inventory_alert_state upsert threw: ${e?.message}`);
      return false;
    }
  }

  private async getRestaurantNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const { data } = await this.db.supabase
      .from("restaurants")
      .select("id, name")
      .in("id", ids);
    for (const r of data || []) map.set(r.id, r.name);
    return map;
  }

  /**
   * `getRestaurantNames` widened to the columns the digest clock needs
   * (`timezone`, `country`) so the sweep can decide each house's clock
   * without a second round trip per restaurant.
   *
   * `ok: false` means the read itself failed (network/DB error) — the same
   * shape as `readDigestFences`, and the same reason: this is a batched read
   * for every low-stock restaurant in the tick, so a failure here cannot be
   * attributed to one house. An unreadable row must never be silently read
   * as "no timezone → UTC" (that would make a transient DB failure look like
   * a house that genuinely has no zone, and everyone on that connection
   * would get the wrong warning — `LOW_STOCK_DIGEST_TIMEZONE_UNKNOWN` — for
   * the wrong reason). The caller (`runDigestSweepAt`) checks `ok` and skips
   * each affected house's tick with its own log line instead.
   */
  private async getRestaurantHouses(ids: string[]): Promise<{
    ok: boolean;
    map: Map<
      string,
      { name: string; timezone: string | null; country: string | null }
    >;
  }> {
    const map = new Map<
      string,
      { name: string; timezone: string | null; country: string | null }
    >();
    if (ids.length === 0) return { ok: true, map };
    const { data, error } = await this.db.supabase
      .from("restaurants")
      .select("id, name, timezone, country")
      .in("id", ids);
    if (error) {
      this.logger.warn(
        `restaurants (house timezone/country) read failed: ${error.message}`,
      );
      return { ok: false, map };
    }
    for (const r of data || []) {
      map.set(r.id, {
        name: r.name,
        timezone: r.timezone ?? null,
        country: r.country ?? null,
      });
    }
    return { ok: true, map };
  }

  /**
   * The clock one house's low-stock digest runs on. Public so a caller
   * outside this service (e.g. the held-low-stock queue view) can report
   * which zone a house's digest hour is read on without duplicating the
   * house/country/fallback order.
   *
   * Returns `null` only when the `restaurants` read itself failed — the same
   * honesty rule the held-queue view already applies to an unreadable prefs
   * read: an unreadable fact is `null`, never silently the fallback.
   */
  async digestClockForRestaurant(
    restaurantId: string,
  ): Promise<DigestClock | null> {
    const { data, error } = await this.db.supabase
      .from("restaurants")
      .select("id, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error || !data) return null;
    return digestClockFor({ timezone: data.timezone, country: data.country });
  }

  /**
   * Every due house's digest fence for one tick, batched like
   * `getRestaurantHouses` (founder item 74, 2026-09-27, verbatim "Own fence
   * column (Recommended)": a "digest sent on <house date>" record stamped
   * whenever a digest email is attempted, independent of the inbox row and
   * of `inventory_alert_state.last_digest_at`).
   *
   * `ok: false` means the read itself failed, distinct from `ok: true` with
   * no row for a house (never attempted). A house missing from `map` has
   * never been claimed. `attemptedAtRaw` is the value exactly as PostgREST
   * returned it: `claimDigestFence` compares against it, and a round trip
   * through `Date` would drop microseconds and never match again.
   */
  private async readDigestFences(ids: string[]): Promise<{
    ok: boolean;
    map: Map<string, DigestFence>;
  }> {
    const map = new Map<string, DigestFence>();
    if (ids.length === 0) return { ok: true, map };
    try {
      const { data, error } = await this.db.supabase
        .from(LOW_STOCK_DIGEST_FENCE_TABLE)
        .select("restaurant_id, sent_on, attempted_at")
        .in("restaurant_id", ids);
      if (error) {
        this.logger.warn(
          `${LOW_STOCK_DIGEST_FENCE_TABLE} read failed: ${error.message}`,
        );
        return { ok: false, map };
      }
      for (const r of data || []) {
        const attemptedAt = new Date(r.attempted_at);
        // A row this code cannot read as an instant is a failed read for
        // that house, never "no row" (which would send).
        if (Number.isNaN(attemptedAt.getTime())) return { ok: false, map };
        map.set(r.restaurant_id, {
          sentOn: r.sent_on,
          attemptedAt,
          attemptedAtRaw: r.attempted_at,
        });
      }
      return { ok: true, map };
    } catch (e: any) {
      this.logger.warn(
        `${LOW_STOCK_DIGEST_FENCE_TABLE} read threw: ${e?.message}`,
      );
      return { ok: false, map };
    }
  }

  /**
   * Claim one house's digest for `periodKey`, compare-and-set, BEFORE the
   * email is attempted (founder item 74).
   *
   * - No row read (`prior === null`): INSERT. The primary key on
   *   `restaurant_id` lets exactly one of two concurrent inserts win; the
   *   loser gets 23505 and is `taken`.
   * - A row read: UPDATE ... WHERE `attempted_at` still equals the value
   *   read. Every claim writes a new tick, so a row another run claimed
   *   after this run's read no longer matches, and Postgres re-checks the
   *   WHERE on the committed row before updating (READ COMMITTED), so two
   *   concurrent updates cannot both match.
   *
   * `failed` (any other error, or a write that reports nothing) SKIPS the
   * house like `taken`: never send on a fence this run does not hold.
   */
  private async claimDigestFence(
    restaurantId: string,
    prior: DigestFence | null,
    periodKey: string,
    tick: Date,
  ): Promise<"claimed" | "taken" | "failed"> {
    const row = { sent_on: periodKey, attempted_at: tick.toISOString() };
    try {
      if (!prior) {
        const { data, error } = await this.db.supabase
          .from(LOW_STOCK_DIGEST_FENCE_TABLE)
          .insert({ restaurant_id: restaurantId, ...row })
          .select("restaurant_id");
        if (error) return error.code === "23505" ? "taken" : "failed";
        return (data?.length ?? 0) === 1 ? "claimed" : "failed";
      }
      const { data, error } = await this.db.supabase
        .from(LOW_STOCK_DIGEST_FENCE_TABLE)
        .update(row)
        .eq("restaurant_id", restaurantId)
        .eq("attempted_at", prior.attemptedAtRaw)
        .select("restaurant_id");
      if (error) return "failed";
      return (data?.length ?? 0) === 1 ? "claimed" : "taken";
    } catch {
      return "failed";
    }
  }

  /**
   * Resolve low-stock email recipients for ONE restaurant.
   *
   * `MANAGER_EMAIL` names a single restaurant's manager, so it is only a legal
   * answer for the legacy default tenant (`DEFAULT_RESTAURANT_ID`). This method
   * is called from `emailDigest(restaurantId, …)`, once per restaurant, so
   * reaching for that env var unconditionally sent restaurant B's stock levels
   * to restaurant A's inbox — the same cross-tenant leak OD-87 / ADR 0022 closed
   * inside the resolver, reproduced one layer up in this caller.
   *
   * It leaked twice over, because both layers fell back:
   *   1. `resolveRecipients` was called without `allowDefaultFallback`, which
   *      defaults to `true`, so the resolver substituted the global address; and
   *   2. if that still produced nothing, the `MANAGER_EMAIL` read below
   *      substituted it again.
   *
   * Both are now gated on the restaurant actually being the legacy default.
   * For every other tenant an unresolvable recipient list is an empty list and
   * a WARN — never another tenant's address. The caller already treats empty as
   * "inbox only" and logs it, so nothing is silently dropped.
   *
   * The category is `low_stock` — `NOTIFICATION_SEND_CATEGORY["low-stock-digest"]`
   * (OD-121, founder answer 15, 2026-09-16) — so only `low_stock_channels`
   * decides, never the union of three arrays it used to be. `report`, when
   * given, receives how many members that preference withheld and whether a
   * read FAILED, so the digest can record "declined by preference" and
   * "recipient lookup failed" apart from "nobody to send to".
   */
  private async resolveEmails(
    restaurantId: string,
    report?: RecipientReport,
  ): Promise<string[]> {
    const defaultRestaurantId =
      this.config.get<string>("DEFAULT_RESTAURANT_ID") || null;
    const isLegacyDefault =
      defaultRestaurantId !== null && restaurantId === defaultRestaurantId;

    if (this.recipientResolver) {
      try {
        const res = await this.recipientResolver.resolveRecipients({
          restaurantId,
          roles: ["manager"],
          category: NOTIFICATION_SEND_CATEGORY["low-stock-digest"],
          channels: ["email"],
          allowDefaultFallback: isLegacyDefault,
        });
        if (report && res.lookupFailed) {
          report.lookupFailed = res.lookupFailed.reason;
        }
        if (res.emails?.length) return res.emails;
        if (report) report.email = res.declined?.email ?? 0;
      } catch (error) {
        this.logger.warn(
          `Low-stock recipient resolution failed for ${restaurantId}: ${error}`,
        );
        if (report) {
          report.lookupFailed =
            error instanceof Error ? error.message : String(error);
        }
      }
    } else if (report) {
      // No resolver in this module is a wiring fault, not an empty house.
      report.lookupFailed =
        "no recipient resolver is available to this service";
    }

    if (!isLegacyDefault) {
      this.logger.warn(
        `RECIPIENTS_NONE restaurant=${restaurantId} roles=manager — low-stock email ` +
          "resolved to nobody. The global MANAGER_EMAIL fallback belongs to " +
          "another tenant and is not used here; sending nothing.",
      );
      return [];
    }

    const env = this.config.get<string>("MANAGER_EMAIL") || "";
    return env
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
  }

  private inventoryUrl(): string {
    const base =
      canonicalOrigin(this.config.get<string>("FRONTEND_URL")) ||
      "https://mudavym.com";
    return `${base}/inventory?filter=low-stock`;
  }
}
