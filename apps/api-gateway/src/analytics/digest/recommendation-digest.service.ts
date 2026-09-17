import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { GmailService } from "../../communications/gmail.service";
import {
  ScheduledTenantsService,
  type ScheduledTenant,
} from "../../communications/scheduled-tenants.service";
import {
  isKnownTimeZone,
  isWithinQuietHours,
  type QuietHours,
} from "../../calendar/reminder-window";
import { RecommendationsService } from "../recommendations.service";
import {
  DIGEST_CATEGORY,
  DIGEST_LATE_LIMIT_MS,
  DIGEST_SEND_FLAG,
  URGENCY_WORDS,
  digestSendArmed,
  hashUnsubscribeToken,
  isDigestUrgency,
  isWellFormedUnsubscribeToken,
  meetsUrgencyFloor,
  mostRecentDue,
  newUnsubscribeToken,
  nextDue,
  sourcesUnreadWords,
  type DigestDue,
  type DigestFrequency,
  type DigestUrgency,
} from "./digest-schedule";
import {
  buildDigestLetter,
  type DigestEntry,
} from "./recommendation-digest.template";

/**
 * The recommendations digest sender — the thing `recommendation_digest_prefs`
 * waited for since the production baseline (founder, 2026-09-16, ADR 0149 row
 * 26: "Build the sender").
 *
 * WHO GETS A DIGEST — FIVE FACTS, ALL REQUIRED
 * -------------------------------------------
 *  1. The house runs one: `recommendation_digest_prefs.digest_enabled`, with its
 *     `digest_hour` (house wall clock) and `digest_min_urgency` floor.
 *  2. The PERSON asked for it: an active row in
 *     `recommendation_digest_subscriptions`, carrying their own frequency. No row
 *     is created for anybody but the person themselves; there is no default.
 *  3. They are still a member: an active, unexpired `user_restaurant_access` row
 *     (or, for a house with no access rows at all — revoked rows count as rows —
 *     `users.restaurant_id`). An ex-member keeps their subscription row and is
 *     sent nothing, including in a house whose every access row is revoked.
 *  4. Their email channel is on (`notification_preferences.email_enabled`).
 *  5. Their `ai` category is on (`categories.ai`; see `DIGEST_CATEGORY`).
 * A member with no preferences row gets the defaults `NotificationsService
 * .getPreferences` returns for one — email on, every category on, quiet hours off.
 *
 * THE SIX PROPERTIES THIS JOB IS BUILT AROUND
 * ------------------------------------------
 *  1. **It never sends twice.** Every send is preceded by an INSERT into
 *     `recommendation_digest_sends` whose UNIQUE `(restaurant_id, user_id,
 *     period_key)` index is the idempotency key. Two gateway instances sweeping
 *     the same house at the same instant cannot both win that insert, so they
 *     cannot both mail. A provider failure is recorded `failed` and NOT retried:
 *     retrying mail whose delivery is uncertain is how a person gets it twice.
 *  2. **It is the house's clock.** Due times are read on `restaurants.timezone`;
 *     a house with none is read in UTC and the letter says so.
 *  3. **It honours quiet hours** per person, on the house's wall clock, with the
 *     half-open `[start, end)` reading `reminder-window.ts` documents. A member
 *     inside their window is DEFERRED — no row, no send — and the next sweep after
 *     it closes serves them, up to `DIGEST_LATE_LIMIT_MS` after the due time.
 *     Past that the digest is recorded `expired`, never sent late at midnight —
 *     unless the house's digest row or the subscription was saved after it fell
 *     due, in which case nothing is recorded (it may never have been owed). A
 *     save after the due time never stops a TIMELY digest from going out.
 *  4. **It quotes the engine and recomputes nothing.** The letter carries each
 *     entry's own `observation` / `recommendation` / `rationale` from
 *     `RecommendationsService.getRecommendations` — the same call the page makes
 *     — with the rule, category and first-seen date beside it.
 *  5. **An empty digest is not sent, and says why.** Nothing at or above the
 *     house's floor → the row is recorded `skipped_empty` with a sentence naming
 *     how many rules the engine evaluated and what stood.
 *  6. **A failed read is an error.** Every read throws on failure, which hands
 *     the house to `runPerTenant` (logged `SCHEDULED_JOB_TENANT_FAILED`) and
 *     leaves the digest owed for the next sweep. A dismissal store that cannot
 *     be read is also a refusal: a digest that might carry what the manager
 *     dismissed is not sent (the founder's "avoided at all costs", recommendations.md
 *     §1b second pass).
 *
 * WHICH SENDER, AND WHY NOT THE HOUSE'S
 * ------------------------------------
 * The digest is Mudavym writing to a member about their own house — the same
 * kind of mail as a verification link or a password reset — so it goes through
 * `GmailService.sendEmail`, the path `auth.service.ts` uses for those, with the
 * From name "Mudavym". It deliberately does NOT use `HouseSenderService`: that
 * resolves a letter in the HOUSE's name to a vendor, riding one member's own
 * Google grant (ADR 0118). Sending Mudavym's digest from a member's personal
 * mailbox would put our words in their "Sent" folder.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *  - It sends nothing while `DIGEST_SEND_ENABLED` is unset (off by default).
 *  - It serves only houses the scheduler enumerates (ADR 0022 opt-in).
 *  - It never mails `recommendation_digest_prefs.recipient_email`. That column is
 *    a free address; a digest goes only to members of the house who asked
 *    (ADR 0147 row 15 limits the house's mail to its members and vendors).
 *  - It never sends without a working unsubscribe link: no `API_PUBLIC_URL`,
 *    no digest.
 */
const DIGEST_CRON = "*/15 * * * *";
const DIGEST_JOB_NAME = "recommendation-digest";
const DIGEST_INTERVAL_MINUTES = 15;

/** The most entries one letter carries. The letter states how many more stand. */
const DIGEST_ENTRY_CAP = 10;

const DIGEST_FROM_NAME = "Mudavym";

/** The public unsubscribe route, under the gateway's global `api/v1` prefix. */
export const DIGEST_UNSUBSCRIBE_PATH =
  "/api/v1/recommendations/digest/unsubscribe/";

const MEMBER_DEFAULTS: MemberPrefs = {
  emailEnabled: true,
  categoryOn: true,
  quiet: { enabled: false, start: "22:00", end: "08:00" },
  usingDefaults: true,
};

@Injectable()
export class RecommendationDigestService {
  private readonly logger = new Logger(RecommendationDigestService.name);

  static readonly JOB_NAME = DIGEST_JOB_NAME;
  static readonly CRON_EXPRESSION = DIGEST_CRON;
  static readonly INTERVAL_MINUTES = DIGEST_INTERVAL_MINUTES;
  static readonly ENTRY_CAP = DIGEST_ENTRY_CAP;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly recommendations: RecommendationsService,
    private readonly gmail: GmailService,
    private readonly tenants: ScheduledTenantsService,
    private readonly configService: ConfigService,
  ) {}

  private armed(): boolean {
    return digestSendArmed(
      this.configService.get<string>(DIGEST_SEND_FLAG) ??
        process.env[DIGEST_SEND_FLAG],
    );
  }

  /** The gateway's public origin, or null — never a guessed one. */
  private publicApiOrigin(): string | null {
    const raw = this.configService.get<string>("API_PUBLIC_URL");
    return raw && raw.trim() ? raw.trim().replace(/\/+$/, "") : null;
  }

  /** The web app's origin (first `FRONTEND_URL` entry), or null. */
  private appOrigin(): string | null {
    const raw = this.configService.get<string>("FRONTEND_URL");
    const first = raw?.split(",")[0]?.trim();
    return first ? first.replace(/\/+$/, "") : null;
  }

  // ==========================================================================
  // THE CRON
  // ==========================================================================

  @Cron(DIGEST_CRON, { name: DIGEST_JOB_NAME })
  async sweep(): Promise<void> {
    if (!this.armed()) {
      this.logger.log(
        `${DIGEST_JOB_NAME} skipped — ${DIGEST_SEND_FLAG} is not set. This job is off by default and sends nothing until it is armed.`,
      );
      return;
    }
    await this.tenants.runPerTenant(DIGEST_JOB_NAME, async (tenant) => {
      await this.sweepTenant(tenant);
    });
  }

  // ==========================================================================
  // ONE HOUSE
  // ==========================================================================

  /** Sweep one house with a fixed clock. Public so a spec can drive it. */
  async sweepTenant(
    tenant: ScheduledTenant,
    now: Date = new Date(),
  ): Promise<DigestTally> {
    const tally = emptyTally();
    const timeZoneIsFallback = !isKnownTimeZone(tenant.timezone);
    const timeZone = timeZoneIsFallback ? "UTC" : tenant.timezone;

    const house = await this.readHousePref(tenant.id);
    if (!house || !house.enabled) {
      tally.house = house ? "off" : "no_row";
      return tally;
    }
    tally.house = "on";
    if (timeZoneIsFallback) {
      // Said only for a house that runs a digest: every other house's missing
      // zone is already logged once per enumeration by ScheduledTenantsService.
      this.logger.warn(
        `RECOMMENDATION_DIGEST_TIMEZONE_UNKNOWN restaurant=${tenant.id} timezone=${JSON.stringify(tenant.timezone)} — ` +
          "digest hours for this house are read in UTC, and the letter says so.",
      );
    }

    const subs = await this.readActiveSubscriptions(tenant.id);
    tally.subscribed = subs.length;
    if (subs.length === 0) return tally;

    const members = await this.readMemberIds(tenant.id, now);
    const memberSubs = subs.filter((s) => members.has(s.userId));
    tally.notMembers = subs.length - memberSubs.length;
    if (memberSubs.length === 0) return this.finish(tenant, tally);

    const ids = memberSubs.map((s) => s.userId);
    const [people, prefs] = await Promise.all([
      this.readPeople(ids),
      this.readMemberPrefs(tenant.id, ids),
    ]);

    const candidates: Candidate[] = [];
    for (const sub of memberSubs) {
      const p = prefs.get(sub.userId) ?? MEMBER_DEFAULTS;
      if (!p.emailEnabled) {
        tally.emailOff++;
        continue;
      }
      if (!p.categoryOn) {
        tally.categoryOff++;
        continue;
      }
      const person = people.get(sub.userId);
      if (!person || !isSingleMailbox(person.email)) {
        tally.noAddress++;
        this.logger.warn(
          `RECOMMENDATION_DIGEST_NO_ADDRESS restaurant=${tenant.id} user=${sub.userId} — the users row carries no single usable address; nothing sent.`,
        );
        continue;
      }
      const due = mostRecentDue(now, timeZone, {
        frequency: sub.frequency,
        weekday: sub.weekday,
        hour: house.hour,
      });
      candidates.push({ sub, person, prefs: p, due });
    }
    if (candidates.length === 0) return this.finish(tenant, tally);

    const handled = await this.readHandled(tenant.id, candidates);
    const open = candidates.filter(
      (c) => !handled.has(periodOf(c.sub.userId, c.due.periodKey)),
    );
    tally.alreadyHandled = candidates.length - open.length;

    const pastLimit = open.filter(
      (c) => now.getTime() - c.due.dueAt.getTime() > DIGEST_LATE_LIMIT_MS,
    );
    const timely = open.filter((c) => !pastLimit.includes(c));

    // A due that is past the late limit AND predates the latest save of the
    // house's digest row or of the person's subscription is not recorded
    // `expired`: the save may be what made it due at all (subscribing at 20:00 to
    // a 07:00 digest; a house switching its digest on in the evening), and an
    // `expired` row for a mail nobody owed is a false miss. This gate applies to
    // the late branch ONLY. A timely due is sent whatever was saved after it:
    // until 2026-09-17 the gate stood in front of every due, so re-saving the
    // house's recipient address at 07:02 cancelled that morning's digest for every
    // subscriber with no mail and no row (review D1, probes P-B and P-E).
    const late: Candidate[] = [];
    for (const c of pastLimit) {
      const changedAt = Math.max(
        Date.parse(c.sub.updatedAt) || 0,
        Date.parse(house.updatedAt ?? "") || 0,
      );
      if (c.due.dueAt.getTime() < changedAt) tally.lateBeforeChange++;
      else late.push(c);
    }

    if (late.length) {
      const hours = Math.round(DIGEST_LATE_LIMIT_MS / 3_600_000);
      const claimed = await this.claim(
        tenant.id,
        timeZone,
        late.map((c) => ({
          candidate: c,
          extra: {
            outcome: "expired",
            finished_at: now.toISOString(),
            // The row states what is known — it went unsent past the limit — and
            // no single cause, because this sweep cannot see which gate held it
            // back on the sweeps before (review D4, probe P-C).
            reason: expiredReason(c.due.dueAt, hours),
          },
        })),
      );
      tally.expired += claimed.length;
    }

    const ready: Candidate[] = [];
    for (const c of timely) {
      if (isWithinQuietHours(now, timeZone, c.prefs.quiet)) {
        tally.deferredQuietHours++;
      } else {
        ready.push(c);
      }
    }
    if (ready.length === 0) return this.finish(tenant, tally);

    const apiOrigin = this.publicApiOrigin();
    if (!apiOrigin) {
      throw new Error(
        "API_PUBLIC_URL is not set, so no digest could carry a working unsubscribe link; nothing was sent for this house.",
      );
    }

    // ── compose once, from the engine the page reads ────────────────────────
    const feed = await this.recommendations.getRecommendations(tenant.id, {
      recordImpressions: false,
    });
    if (!feed.suppressionsReadable) {
      throw new Error(
        "the dismissal store could not be read, so this digest might carry entries the house already dismissed; nothing was sent and the digest stays owed for the next sweep.",
      );
    }
    const standing = feed.recommendations.filter((r) =>
      meetsUrgencyFloor(r.urgency, house.floor),
    );
    const sourcesUnread = Array.isArray(feed.sourcesUnread)
      ? feed.sourcesUnread
      : [];
    const unreadNote = sourcesUnreadWords(sourcesUnread);

    const provenance = {
      rules_evaluated: feed.rulesEvaluated,
      engine_generated_at: feed.generatedAt,
    };

    if (standing.length === 0) {
      const withheld =
        feed.suppressed > 0
          ? ` ${feed.suppressed} more fired and ${feed.suppressed === 1 ? "was" : "were"} withheld because the house dismissed ${feed.suppressed === 1 ? "it" : "them"}.`
          : "";
      // "Nothing stands" and "nothing could be read" are different facts, and
      // the log row is the only place the second one would otherwise vanish.
      const reason =
        `Nothing to send: the engine evaluated ${feed.rulesEvaluated} rules at ${feed.generatedAt}; ` +
        `${feed.recommendations.length} ${feed.recommendations.length === 1 ? "entry stood" : "entries stood"} and none at or above "${URGENCY_WORDS[house.floor]}".${withheld}` +
        (unreadNote
          ? ` ${unreadNote} This empty result is therefore not proof that nothing stands.`
          : "");
      const claimed = await this.claim(
        tenant.id,
        timeZone,
        ready.map((c) => ({
          candidate: c,
          extra: {
            outcome: "skipped_empty",
            finished_at: now.toISOString(),
            reason,
            entries_count: 0,
            rule_keys: [],
            ...provenance,
          },
        })),
      );
      tally.skippedEmpty += claimed.length;
      tally.claimedElsewhere += ready.length - claimed.length;
      return this.finish(tenant, tally);
    }

    const carried = standing.slice(0, DIGEST_ENTRY_CAP);
    const entries: DigestEntry[] = carried.map((r) => ({
      ruleKey: r.ruleKey,
      category: r.category,
      urgency: r.urgency,
      observation: r.observation,
      recommendation: r.recommendation,
      rationale: r.rationale,
      firstSeenAt: r.firstSeenAt ?? null,
    }));

    const tokens = new Map<string, string>();
    const claimed = await this.claim(
      tenant.id,
      timeZone,
      ready.map((c) => {
        const token = newUnsubscribeToken();
        tokens.set(c.sub.userId, token);
        return {
          candidate: c,
          extra: {
            entries_count: entries.length,
            rule_keys: entries.map((e) => e.ruleKey),
            unsubscribe_token_hash: hashUnsubscribeToken(token),
            ...provenance,
          },
        };
      }),
    );
    tally.claimedElsewhere += ready.length - claimed.length;

    const byUser = new Map(ready.map((c) => [c.sub.userId, c]));
    for (const row of claimed) {
      const c = byUser.get(row.user_id);
      const token = tokens.get(row.user_id);
      if (!c || !token) continue; // cannot happen: the claim only returns our rows

      // Composing the letter sits inside the same try as the send: this row is
      // already claimed, and a throw that escaped here would leave it (and every
      // row after it) with outcome NULL for ever instead of a recorded failure.
      let outcome: { success: boolean; messageId?: string; error?: string };
      let stage: "compose" | "provider" = "compose";
      try {
        const letter = buildDigestLetter({
          houseName: tenant.name,
          recipientName: c.person.name,
          frequency: c.sub.frequency,
          weekday: c.sub.weekday,
          hour: house.hour,
          timeZone,
          timeZoneIsFallback,
          urgencyFloor: house.floor,
          entries,
          standing: standing.length,
          rulesEvaluated: feed.rulesEvaluated,
          engineGeneratedAt: feed.generatedAt,
          sourcesUnread,
          subscribedAt: c.sub.subscribedAt,
          unsubscribeUrl: `${apiOrigin}${DIGEST_UNSUBSCRIBE_PATH}${token}`,
          appOrigin: this.appOrigin(),
        });
        stage = "provider";
        outcome = await this.gmail.sendEmail({
          to: [c.person.email],
          subject: letter.subject,
          html: letter.html,
          text: letter.text,
          fromName: DIGEST_FROM_NAME,
          listUnsubscribe: {
            url: `${apiOrigin}${DIGEST_UNSUBSCRIBE_PATH}${token}`,
            oneClick: true,
          },
        });
      } catch (err) {
        outcome = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (outcome.success) {
        tally.sent++;
        const at = new Date().toISOString();
        await this.confirm(row.id, {
          outcome: "sent",
          sent_at: at,
          finished_at: at,
          provider_message_id: outcome.messageId ?? null,
          // A sent row carries a reason only when the letter was partial.
          reason: unreadNote
            ? `Sent with a gap the letter states: ${unreadNote}`
            : null,
        });
      } else {
        tally.failed++;
        const words =
          (outcome.error ?? "").trim() || "the provider gave no reason";
        this.logger.error(
          `RECOMMENDATION_DIGEST_SEND_FAILED restaurant=${tenant.id} user=${row.user_id} — ${words}`,
        );
        await this.confirm(row.id, {
          outcome: "failed",
          finished_at: new Date().toISOString(),
          reason:
            stage === "compose"
              ? `The letter could not be composed, so nothing reached the provider: ${words}. Not retried.`
              : `The mail provider did not accept it: ${words}. Not retried, so it cannot arrive twice.`,
        });
      }
    }

    if (tally.sent > 0) await this.stampLastSent(tenant.id, now);
    return this.finish(tenant, tally);
  }

  /**
   * One line per house per sweep that DID something (sent, failed, expired,
   * skipped, deferred, or lost a claim). A house with nothing due logs at debug:
   * ninety-six identical lines a day per house would bury the ones that matter.
   */
  private finish(tenant: ScheduledTenant, tally: DigestTally): DigestTally {
    const line =
      `RECOMMENDATION_DIGEST_SWEEP restaurant=${tenant.id} ` +
      Object.entries(tally)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
    const acted =
      tally.sent +
        tally.failed +
        tally.expired +
        tally.skippedEmpty +
        tally.deferredQuietHours +
        tally.claimedElsewhere >
      0;
    if (acted) this.logger.log(line);
    else this.logger.debug(line);
    return tally;
  }

  // ==========================================================================
  // THE LEDGER
  // ==========================================================================

  /**
   * Insert claim rows, ignoring the ones another sweep already owns. Returns
   * only the rows THIS call inserted — which is what makes the send safe.
   */
  private async claim(
    restaurantId: string,
    timeZone: string,
    items: Array<{ candidate: Candidate; extra: Record<string, unknown> }>,
  ): Promise<Array<{ id: string; user_id: string; period_key: string }>> {
    if (items.length === 0) return [];
    const rows = items.map(({ candidate: c, extra }) => ({
      restaurant_id: restaurantId,
      user_id: c.sub.userId,
      period_key: c.due.periodKey,
      frequency: c.sub.frequency,
      due_at: c.due.dueAt.toISOString(),
      time_zone: timeZone,
      claimed_at: new Date().toISOString(),
      ...extra,
    }));
    const { data, error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_sends")
      .upsert(rows, {
        onConflict: "restaurant_id,user_id,period_key",
        ignoreDuplicates: true,
      })
      .select("id, user_id, period_key");
    if (error) {
      // A failed claim must never fall through to a send.
      throw new Error(
        `recommendation_digest_sends claim failed: ${error.message}. Nothing was sent for this house on this sweep.`,
      );
    }
    return (data ?? []) as Array<{
      id: string;
      user_id: string;
      period_key: string;
    }>;
  }

  private async confirm(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_sends")
      .update(patch)
      .eq("id", id)
      .is("outcome", null);
    if (error) {
      // The provider already answered; only the record of it did not land. The
      // row stays claimed with outcome NULL, which is reported as unknown and is
      // never retried — so this cannot turn into a second mail.
      this.logger.error(
        `RECOMMENDATION_DIGEST_CONFIRM_FAILED send=${id} outcome=${String(patch.outcome)} — ${error.message}`,
      );
    }
  }

  /** The roll-up the baseline column has been waiting for. */
  private async stampLastSent(restaurantId: string, now: Date): Promise<void> {
    const { error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_prefs")
      .update({ last_sent_at: now.toISOString() })
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.warn(
        `RECOMMENDATION_DIGEST_LAST_SENT_STAMP_FAILED restaurant=${restaurantId} — ${error.message}; the send log is still correct.`,
      );
    }
  }

  // ==========================================================================
  // READS — every one throws on failure
  // ==========================================================================

  private async readHousePref(restaurantId: string): Promise<HousePref | null> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_prefs")
      .select(
        "restaurant_id, digest_enabled, digest_hour, digest_min_urgency, updated_at",
      )
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `recommendation_digest_prefs could not be read: ${error.message}`,
      );
    }
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const hour = Number(row.digest_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error(
        `digest_hour ${JSON.stringify(row.digest_hour)} is not an hour of the day; this house's digest is not sent until it is.`,
      );
    }
    if (!isDigestUrgency(row.digest_min_urgency)) {
      throw new Error(
        `digest_min_urgency ${JSON.stringify(row.digest_min_urgency)} is not now / this_week / this_month; this house's digest is not sent until it is.`,
      );
    }
    return {
      enabled: row.digest_enabled === true,
      hour,
      floor: row.digest_min_urgency,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    };
  }

  private async readActiveSubscriptions(
    restaurantId: string,
  ): Promise<Subscription[]> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_subscriptions")
      .select(
        "user_id, frequency, weekday, subscribed_at, updated_at, unsubscribed_at",
      )
      .eq("restaurant_id", restaurantId)
      .is("unsubscribed_at", null);
    if (error) {
      throw new Error(
        `recommendation_digest_subscriptions could not be read: ${error.message}`,
      );
    }
    return ((data ?? []) as Record<string, any>[]).map(toSubscription);
  }

  /** Active members of the house. Throws on a failed read — never "nobody". */
  async readMemberIds(restaurantId: string, now: Date): Promise<Set<string>> {
    const client = this.databaseService.getClient();
    // Every access row, revoked ones included: whether the house HAS a roster is
    // decided on all of them. Filtering `is_active` in the query made a house
    // whose rows were all revoked look roster-less, so the `users.restaurant_id`
    // fallback below counted its revoked members back in (review D2, probe P-A).
    const { data, error } = await client
      .from("user_restaurant_access")
      .select("user_id, is_active, valid_from, valid_until")
      .eq("restaurant_id", restaurantId);
    if (error) {
      throw new Error(
        `user_restaurant_access could not be read: ${error.message}`,
      );
    }
    const rows = (data ?? []) as Array<{
      user_id: string;
      is_active: boolean | null;
      valid_from: string | null;
      valid_until: string | null;
    }>;
    if (rows.length > 0) {
      // Membership is an active row inside its window: begun (`valid_from`) and
      // not yet ended (`valid_until`). A row that is revoked, not yet open or
      // closed is not a member today — and a house with only such rows has no
      // members, never "fall back to whoever names it".
      return new Set(
        rows
          .filter((r) => r.is_active === true)
          .filter(
            (r) => !r.valid_from || Date.parse(r.valid_from) <= now.getTime(),
          )
          .filter(
            (r) => !r.valid_until || Date.parse(r.valid_until) > now.getTime(),
          )
          .map((r) => r.user_id),
      );
    }
    // A house with no access rows at all — active or revoked — predates the
    // roster; its members are the users whose own row names it (the fallback
    // getRestaurantMemberIds uses, which decides it on active rows only and so
    // still has the defect this read no longer has).
    const { data: users, error: usersError } = await client
      .from("users")
      .select("user_id")
      .eq("restaurant_id", restaurantId);
    if (usersError) {
      throw new Error(
        `users (legacy membership) could not be read: ${usersError.message}`,
      );
    }
    return new Set(
      ((users ?? []) as Array<{ user_id: string }>).map((u) => u.user_id),
    );
  }

  private async readPeople(ids: string[]): Promise<Map<string, Person>> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("users")
      .select("user_id, email, name")
      .in("user_id", ids);
    if (error) throw new Error(`users could not be read: ${error.message}`);
    const out = new Map<string, Person>();
    for (const r of (data ?? []) as Record<string, any>[]) {
      out.set(r.user_id, {
        email: typeof r.email === "string" ? r.email.trim() : "",
        name:
          typeof r.name === "string" && r.name.trim() ? r.name.trim() : null,
      });
    }
    return out;
  }

  private async readMemberPrefs(
    restaurantId: string,
    ids: string[],
  ): Promise<Map<string, MemberPrefs>> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("notification_preferences")
      .select(
        "user_id, restaurant_id, email_enabled, categories, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
      )
      .in("user_id", ids);
    if (error) {
      // Not "defaults": a read failure must neither wake somebody inside quiet
      // hours nor mail somebody who switched email off.
      throw new Error(
        `notification_preferences could not be read: ${error.message}`,
      );
    }
    const out = new Map<string, MemberPrefs>();
    for (const raw of (data ?? []) as Record<string, any>[]) {
      if (out.has(raw.user_id) && raw.restaurant_id !== restaurantId) continue;
      out.set(raw.user_id, toMemberPrefs(raw));
    }
    return out;
  }

  private async readHandled(
    restaurantId: string,
    candidates: Candidate[],
  ): Promise<Set<string>> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_sends")
      .select("user_id, period_key")
      .eq("restaurant_id", restaurantId)
      .in("user_id", Array.from(new Set(candidates.map((c) => c.sub.userId))))
      .in(
        "period_key",
        Array.from(new Set(candidates.map((c) => c.due.periodKey))),
      );
    if (error) {
      throw new Error(
        `recommendation_digest_sends could not be read: ${error.message}`,
      );
    }
    return new Set(
      ((data ?? []) as Array<{ user_id: string; period_key: string }>).map(
        (r) => periodOf(r.user_id, r.period_key),
      ),
    );
  }

  // ==========================================================================
  // THE PERSON'S OWN SUBSCRIPTION (JWT: the caller, in the session's house)
  // ==========================================================================

  async statusFor(
    userId: string,
    restaurantId: string,
    now: Date = new Date(),
  ): Promise<DigestSubscriptionStatus> {
    const client = this.databaseService.getClient();
    try {
      const armed = this.armed();

      const tenant = (await this.tenants.list()).find(
        (t) => t.id === restaurantId,
      );
      const served = !!tenant;
      // Worded for the member reading it, who cannot change it. The operator's
      // fact (which flag opts a house in) is ScheduledTenantsService.OPT_IN_FLAG
      // and ADR 0022, not a sentence in a member's response.
      const servedReason = tenant
        ? null
        : "Scheduled mail has not been switched on for this house yet, so the digest does not run here. " +
          "Mudavym switches it on per house; no setting a member can change turns it on.";

      const [house, members, subRes, prefs, lastRes] = await Promise.all([
        this.readHousePref(restaurantId),
        this.readMemberIds(restaurantId, now),
        client
          .from("recommendation_digest_subscriptions")
          .select(
            "user_id, frequency, weekday, subscribed_at, updated_at, unsubscribed_at, unsubscribed_via",
          )
          .eq("restaurant_id", restaurantId)
          .eq("user_id", userId)
          .maybeSingle(),
        this.readMemberPrefs(restaurantId, [userId]),
        client
          .from("recommendation_digest_sends")
          .select(
            "period_key, frequency, due_at, claimed_at, finished_at, sent_at, outcome, reason, entries_count",
          )
          .eq("restaurant_id", restaurantId)
          .eq("user_id", userId)
          .order("claimed_at", { ascending: false })
          .limit(1),
      ]);
      if (subRes.error)
        throw new Error(
          `recommendation_digest_subscriptions could not be read: ${subRes.error.message}`,
        );
      if (lastRes.error)
        throw new Error(
          `recommendation_digest_sends could not be read: ${lastRes.error.message}`,
        );

      const subRow = subRes.data as Record<string, any> | null;
      const active = !!subRow && !subRow.unsubscribed_at;
      const p = prefs.get(userId) ?? MEMBER_DEFAULTS;
      const isMember = members.has(userId);
      const zoneKnown = !!tenant && isKnownTimeZone(tenant.timezone);
      const timeZone = zoneKnown ? (tenant as ScheduledTenant).timezone : "UTC";

      const blockers: string[] = [];
      if (!armed)
        blockers.push(
          `The digest sender is built and switched off on this deployment (${DIGEST_SEND_FLAG} is not set), so nothing is sent to anybody yet.`,
        );
      if (!served) blockers.push(servedReason as string);
      if (!this.publicApiOrigin())
        blockers.push(
          "API_PUBLIC_URL is not set, so no digest could carry a working unsubscribe link; none is sent until it is.",
        );
      if (!house)
        blockers.push(
          "This house has never set a digest preference, so it runs no digest.",
        );
      else if (!house.enabled)
        blockers.push("This house's digest is switched off.");
      if (!isMember)
        blockers.push("You are not an active member of this house.");
      if (!active) blockers.push("You have not asked for this digest.");
      if (!p.emailEnabled) blockers.push("Your email notifications are off.");
      if (!p.categoryOn)
        blockers.push(
          `Your "${DIGEST_CATEGORY}" notification category is off.`,
        );

      const last = ((lastRes.data ?? []) as Record<string, any>[])[0] ?? null;
      let next: DigestDue | null = null;
      if (active && house) {
        next = nextDue(now, timeZone, {
          frequency: subRow!.frequency,
          weekday: subRow!.weekday ?? null,
          hour: house.hour,
        });
      }

      return {
        armed,
        armedFlag: DIGEST_SEND_FLAG,
        served,
        servedReason,
        unsubscribeLinkReady: !!this.publicApiOrigin(),
        house: house
          ? {
              set: true,
              enabled: house.enabled,
              hour: house.hour,
              urgencyFloor: house.floor,
            }
          : { set: false, enabled: false, hour: null, urgencyFloor: null },
        timeZone: tenant ? { zone: timeZone, isFallback: !zoneKnown } : null,
        isMember,
        subscription: subRow
          ? {
              frequency: subRow.frequency,
              weekday: subRow.weekday ?? null,
              subscribedAt: subRow.subscribed_at,
              updatedAt: subRow.updated_at,
              unsubscribedAt: subRow.unsubscribed_at ?? null,
              unsubscribedVia: subRow.unsubscribed_via ?? null,
            }
          : null,
        preferences: {
          email: p.emailEnabled,
          category: { key: DIGEST_CATEGORY, on: p.categoryOn },
          quietHours: p.quiet,
          usingDefaults: p.usingDefaults,
        },
        willReceive: blockers.length === 0,
        blockers,
        nextDueAt:
          blockers.length === 0 && next ? next.dueAt.toISOString() : null,
        lastSend: last
          ? {
              periodKey: last.period_key,
              frequency: last.frequency,
              dueAt: last.due_at,
              claimedAt: last.claimed_at,
              finishedAt: last.finished_at ?? null,
              sentAt: last.sent_at ?? null,
              outcome: last.outcome ?? null,
              reason: last.reason ?? null,
              entriesCount: last.entries_count ?? null,
            }
          : null,
      };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException
      )
        throw err;
      throw new ServiceUnavailableException(
        `The digest subscription could not be read, so nothing about it is stated: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async subscribe(
    userId: string,
    restaurantId: string,
    body: { frequency?: unknown; weekday?: unknown },
    now: Date = new Date(),
  ): Promise<DigestSubscriptionStatus> {
    const frequency = body.frequency;
    if (frequency !== "daily" && frequency !== "weekly") {
      throw new BadRequestException(
        'frequency must be "daily" or "weekly"; nothing was recorded.',
      );
    }
    const weekday = body.weekday ?? null;
    if (frequency === "weekly") {
      if (
        !Number.isInteger(weekday) ||
        (weekday as number) < 1 ||
        (weekday as number) > 7
      ) {
        throw new BadRequestException(
          "A weekly digest needs a weekday, 1 (Monday) to 7 (Sunday); nothing was recorded.",
        );
      }
    } else if (weekday !== null) {
      throw new BadRequestException(
        "A daily digest has no weekday; nothing was recorded.",
      );
    }

    let members: Set<string>;
    try {
      members = await this.readMemberIds(restaurantId, now);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Membership could not be read, so nothing was recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!members.has(userId)) {
      throw new ForbiddenException(
        "You are not an active member of this house, so you cannot ask for its digest. Nothing was recorded.",
      );
    }

    const client = this.databaseService.getClient();
    const { data: existing, error: readError } = await client
      .from("recommendation_digest_subscriptions")
      .select("id, frequency, weekday, unsubscribed_at")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) {
      throw new ServiceUnavailableException(
        `The subscription could not be read, so nothing was recorded: ${readError.message}`,
      );
    }

    const nextWeekday = frequency === "weekly" ? weekday : null;
    const prior = existing as Record<string, unknown> | null;
    if (
      prior &&
      !prior.unsubscribed_at &&
      prior.frequency === frequency &&
      (prior.weekday ?? null) === nextWeekday
    ) {
      // Saving the subscription the person already has changes nothing, so it
      // writes nothing: `updated_at` means "the cadence changed", and a re-save
      // that moved it would tell the sweep a change happened that did not.
      return this.statusFor(userId, restaurantId, now);
    }

    const stamp = now.toISOString();
    const base = {
      frequency,
      weekday: nextWeekday,
      updated_at: stamp,
    };
    const write = existing
      ? client
          .from("recommendation_digest_subscriptions")
          .update(
            (existing as Record<string, unknown>).unsubscribed_at
              ? {
                  ...base,
                  subscribed_at: stamp,
                  unsubscribed_at: null,
                  unsubscribed_via: null,
                }
              : base,
          )
          .eq("restaurant_id", restaurantId)
          .eq("user_id", userId)
      : client.from("recommendation_digest_subscriptions").insert({
          restaurant_id: restaurantId,
          user_id: userId,
          subscribed_at: stamp,
          ...base,
        });
    const { error: writeError } = await write;
    if (writeError) {
      throw new ServiceUnavailableException(
        `The subscription was not recorded: ${writeError.message}`,
      );
    }
    return this.statusFor(userId, restaurantId, now);
  }

  async stopForSelf(
    userId: string,
    restaurantId: string,
    now: Date = new Date(),
  ): Promise<DigestSubscriptionStatus> {
    const { error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_subscriptions")
      .update({
        unsubscribed_at: now.toISOString(),
        unsubscribed_via: "settings",
        updated_at: now.toISOString(),
      })
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .is("unsubscribed_at", null);
    if (error) {
      throw new ServiceUnavailableException(
        `The digest was not stopped: ${error.message}`,
      );
    }
    return this.statusFor(userId, restaurantId, now);
  }

  // ==========================================================================
  // THE LINK IN THE MAIL (no session — the token is the only authority)
  // ==========================================================================

  async readUnsubscribeLink(token: string): Promise<UnsubscribeLinkState> {
    const found = await this.lookupToken(token);
    if (found.kind !== "found") return found;
    return found.stopped
      ? { kind: "already_stopped", houseName: found.houseName }
      : { kind: "active", houseName: found.houseName };
  }

  async stopByLink(
    token: string,
    now: Date = new Date(),
  ): Promise<UnsubscribeLinkState> {
    const found = await this.lookupToken(token);
    if (found.kind !== "found") return found;
    if (found.stopped)
      return { kind: "already_stopped", houseName: found.houseName };

    const { data, error } = await this.databaseService
      .getClient()
      .from("recommendation_digest_subscriptions")
      .update({
        unsubscribed_at: now.toISOString(),
        unsubscribed_via: "link",
        updated_at: now.toISOString(),
      })
      .eq("restaurant_id", found.restaurantId)
      .eq("user_id", found.userId)
      .is("unsubscribed_at", null)
      .select("id");
    if (error) {
      throw new ServiceUnavailableException(
        `The digest was not stopped: ${error.message}`,
      );
    }
    return (data ?? []).length > 0
      ? { kind: "stopped", houseName: found.houseName }
      : { kind: "already_stopped", houseName: found.houseName };
  }

  private async lookupToken(token: string): Promise<
    | { kind: "malformed" }
    | { kind: "unknown" }
    | {
        kind: "found";
        restaurantId: string;
        userId: string;
        houseName: string;
        stopped: boolean;
      }
  > {
    if (!isWellFormedUnsubscribeToken(token)) return { kind: "malformed" };
    const client = this.databaseService.getClient();
    const { data: send, error: sendError } = await client
      .from("recommendation_digest_sends")
      .select("restaurant_id, user_id")
      .eq("unsubscribe_token_hash", hashUnsubscribeToken(token))
      .maybeSingle();
    if (sendError) {
      throw new ServiceUnavailableException(
        `The link could not be checked: ${sendError.message}`,
      );
    }
    if (!send) return { kind: "unknown" };
    const { restaurant_id: restaurantId, user_id: userId } = send as Record<
      string,
      string
    >;

    const [subRes, houseRes] = await Promise.all([
      client
        .from("recommendation_digest_subscriptions")
        .select("unsubscribed_at")
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle(),
    ]);
    if (subRes.error) {
      throw new ServiceUnavailableException(
        `The subscription could not be read: ${subRes.error.message}`,
      );
    }
    if (houseRes.error) {
      throw new ServiceUnavailableException(
        `The house could not be read: ${houseRes.error.message}`,
      );
    }
    const houseName =
      (
        (houseRes.data as Record<string, unknown> | null)?.name as
          | string
          | undefined
      )?.trim() || "this house";
    const sub = subRes.data as Record<string, unknown> | null;
    return {
      kind: "found",
      restaurantId,
      userId,
      houseName,
      // No subscription row behind a real send reads as already stopped: nothing
      // is being sent, and the page says exactly that.
      stopped: !sub || !!sub.unsubscribed_at,
    };
  }
}

/* ── shapes ───────────────────────────────────────────────────────────────── */

function periodOf(userId: string, periodKey: string): string {
  return `${userId}|${periodKey}`;
}

/**
 * The `expired` row's sentence. It states the one fact the sweep knows — the
 * digest went unsent past the late limit — and lists the gates that can cause
 * that as POSSIBLE causes, because the sweeps that did not send it wrote no row
 * saying which one held it back.
 */
export function expiredReason(dueAt: Date, hours: number): string {
  return (
    `Not sent within ${hours} hours of its due time (${dueAt.toISOString()}), and a late digest is not sent. ` +
    "This log does not record which gate held it back; any of these can: the person's quiet hours; " +
    'their email notifications or their "ai" notification category switched off; not being an active member of the house, ' +
    "or having no usable address, at the time; the digest sender switched off or failing for this house; or no sweep running."
  );
}

/**
 * One mailbox, and nothing that could become a second header or a second
 * recipient. `users.email` is validated at sign-up, but this is the last place
 * the value is looked at before it becomes a `To:` line.
 */
export function isSingleMailbox(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 254) {
    return false;
  }
  // Whitespace (CR/LF included), list separators and the characters of a
  // display-name form. Checked by class, not by a backtracking pattern.
  if (/[\s,;<>"()\\]/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return (
    domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".")
  );
}

function toSubscription(r: Record<string, any>): Subscription {
  return {
    userId: r.user_id,
    frequency: r.frequency as DigestFrequency,
    weekday: typeof r.weekday === "number" ? r.weekday : null,
    subscribedAt: r.subscribed_at,
    updatedAt: r.updated_at,
  };
}

function toMemberPrefs(raw: Record<string, any>): MemberPrefs {
  const categories =
    raw.categories && typeof raw.categories === "object" ? raw.categories : {};
  return {
    emailEnabled: raw.email_enabled !== false,
    categoryOn:
      (categories as Record<string, unknown>)[DIGEST_CATEGORY] !== false,
    quiet: {
      enabled: raw.quiet_hours_enabled === true,
      start: raw.quiet_hours_start || "22:00",
      end: raw.quiet_hours_end || "08:00",
    },
    usingDefaults: false,
  };
}

function emptyTally(): DigestTally {
  return {
    house: "no_row",
    subscribed: 0,
    notMembers: 0,
    emailOff: 0,
    categoryOff: 0,
    noAddress: 0,
    lateBeforeChange: 0,
    alreadyHandled: 0,
    deferredQuietHours: 0,
    expired: 0,
    skippedEmpty: 0,
    claimedElsewhere: 0,
    sent: 0,
    failed: 0,
  };
}

interface HousePref {
  enabled: boolean;
  hour: number;
  floor: DigestUrgency;
  updatedAt: string | null;
}

interface Subscription {
  userId: string;
  frequency: DigestFrequency;
  weekday: number | null;
  subscribedAt: string;
  updatedAt: string;
}

interface Person {
  email: string;
  name: string | null;
}

interface MemberPrefs {
  emailEnabled: boolean;
  categoryOn: boolean;
  quiet: QuietHours;
  usingDefaults: boolean;
}

interface Candidate {
  sub: Subscription;
  person: Person;
  prefs: MemberPrefs;
  due: DigestDue;
}

export interface DigestTally {
  house: "no_row" | "off" | "on";
  subscribed: number;
  notMembers: number;
  emailOff: number;
  categoryOff: number;
  noAddress: number;
  /** Past the late limit, but due before the latest save of the house row or the subscription: no `expired` row. */
  lateBeforeChange: number;
  alreadyHandled: number;
  deferredQuietHours: number;
  expired: number;
  skippedEmpty: number;
  /** Rows another instance claimed first — proof the lock did its job. */
  claimedElsewhere: number;
  sent: number;
  failed: number;
}

export type UnsubscribeLinkState =
  | { kind: "malformed" }
  | { kind: "unknown" }
  | { kind: "active"; houseName: string }
  | { kind: "already_stopped"; houseName: string }
  | { kind: "stopped"; houseName: string };

export interface DigestSubscriptionStatus {
  armed: boolean;
  armedFlag: string;
  served: boolean;
  servedReason: string | null;
  unsubscribeLinkReady: boolean;
  house:
    | { set: true; enabled: boolean; hour: number; urgencyFloor: DigestUrgency }
    | { set: false; enabled: false; hour: null; urgencyFloor: null };
  timeZone: { zone: string; isFallback: boolean } | null;
  isMember: boolean;
  subscription: {
    frequency: DigestFrequency;
    weekday: number | null;
    subscribedAt: string;
    updatedAt: string;
    unsubscribedAt: string | null;
    unsubscribedVia: "link" | "settings" | null;
  } | null;
  preferences: {
    email: boolean;
    category: { key: string; on: boolean };
    quietHours: QuietHours;
    usingDefaults: boolean;
  };
  willReceive: boolean;
  /** Every reason this person will not receive a digest, in words. Empty = will. */
  blockers: string[];
  nextDueAt: string | null;
  lastSend: {
    periodKey: string;
    frequency: DigestFrequency;
    dueAt: string;
    claimedAt: string;
    finishedAt: string | null;
    sentAt: string | null;
    outcome: "sent" | "failed" | "skipped_empty" | "expired" | null;
    reason: string | null;
    entriesCount: number | null;
  } | null;
}
