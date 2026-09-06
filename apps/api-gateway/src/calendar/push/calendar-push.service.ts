import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { resolveZone } from "../zoned-time";
import {
  GoogleCalendarAnswer,
  GoogleCalendarClient,
  isRateLimited,
} from "./google-calendar.client";

/**
 * Direction 1 of ADR 0111 §5: Mudavym writes its day-book into a
 * Mudavym-OWNED SECONDARY calendar on a connected Google account.
 *
 * ONE WRITE PER MUTATION. NOTHING IS READ BACK. NOTHING IS TWO-WAY.
 * ---------------------------------------------------------------------------
 * The ADR fixed the order of the four directions — push, pull, two-way, expose
 * — with the reasoning that "each direction earns the trust the next one
 * spends". Everything this file does is a write, and there is deliberately no
 * verb here that could read Google's copy back. The scope permits it; the
 * direction does not.
 *
 * THE THREE PROMISES THIS FILE IS ACCOUNTABLE FOR
 * ---------------------------------------------------------------------------
 * 1. "An idempotency key on (restaurant, entry, provider account)." It is
 *    `sha256(restaurant | entry | connection)` in hex, and it is ALSO the id
 *    Google stores the event under, so a retried create is one provider event
 *    and not two — Google answers the second insert of an id it already holds
 *    with 409 `duplicate`, which this file reads as delivered rather than as a
 *    failure. No search, ever: searching for "the event that looks like ours"
 *    is how a push overwrites somebody else's appointment.
 * 2. "Update by the provider's own event id, never by search." Every update
 *    and delete is addressed to `calendar_push_mappings.provider_event_id`.
 * 3. "Only we can delete." A copy deleted inside Google COMES BACK on the next
 *    push: an update that meets 404/410 re-inserts the entry under the same
 *    idempotency key and the outcome row says in words that it did. The
 *    consent screen and `/connections` both say so before anyone connects.
 *
 * ABSENCE IS NEVER HEALTH
 * ---------------------------------------------------------------------------
 * A push that silently does not happen leaves NO trace: the house's Google
 * calendar simply lacks an event, and every internal count still agrees with
 * itself. So each attempt that was OWED writes a row to
 * `calendar_push_outcomes` naming what happened, and `status()` reports
 * "n of N pushed" against the house's own entry count — never "in sync", which
 * is the sentence an empty mapping table would otherwise be read as.
 *
 * The one case that writes no row is a house with NO live grant. Nothing was
 * owed, nothing was attempted, and a row per mutation saying "still not
 * connected" would bury the rows that matter. `status()` answers that case
 * from the connection register instead, which is where the fact actually is.
 */

export type PushVerb = "create" | "update" | "delete";

export type PushOutcome =
  | "delivered"
  | "not_connected"
  | "unavailable"
  | "house_stopped"
  | "token_expired"
  | "rate_limited"
  | "refused"
  | "failed";

export interface PushResult {
  outcome: PushOutcome;
  detail: string;
  providerEventId: string | null;
  /** True when a copy someone deleted inside Google was put back. */
  restored: boolean;
}

export interface PushStatus {
  /** Whether this deployment can offer the connector at all. */
  available: boolean;
  unavailableReason: string | null;
  /** Whether pushing is switched on at all (`CALENDAR_PUSH_ENABLED`). */
  armed: boolean;
  connected: boolean;
  /** Whose grant. The Google ADDRESS is never read — see the definition row. */
  ownerUserId: string | null;
  ownerName: string | null;
  accountEmail: string | null;
  houseStopped: boolean;
  reconnectRequired: boolean;
  reconnectReason: string | null;
  calendar: {
    providerCalendarId: string;
    summary: string;
    timeZone: string | null;
    createdAt: string | null;
  } | null;
  /** The house's own entries, and how many of them have a copy in Google. */
  entries: number | null;
  pushed: number | null;
  unpushed: number | null;
  pendingDeletes: number | null;
  /** One sentence. Never blank, and never "in sync" over an empty mapping. */
  sentence: string;
  lastOutcome: {
    verb: string;
    outcome: string;
    detail: string;
    attemptedAt: string;
  } | null;
  /** Set when a count could not be read; the counts are then null, not zero. */
  error: string | null;
}

const INTEGRATION_ID = "google_calendar" as const;

/** Minutes a house is left alone after Google says it is going too fast. */
const DEFAULT_BACKOFF_SECONDS = 60;

/** An entry with a start time but no end time is given this much room. */
const DEFAULT_EVENT_MINUTES = 60;

@Injectable()
export class CalendarPushService {
  private readonly logger = new Logger(CalendarPushService.name);

  /**
   * Per-house rate-limit gate, in memory.
   *
   * In memory ON PURPOSE and the limitation is stated rather than hidden: it is
   * lost on restart and not shared between instances. It is a courtesy that
   * stops one house hammering Google inside a single process, and the DURABLE
   * half is the `rate_limited` outcome row carrying `retry_after_seconds`,
   * which the reconcile sweep reads before it tries again. Quotas are not a
   * constraint for this product's volume (ADR 0111 §5 direction 2 measured
   * 10,000 requests/minute per project); backing off is politeness and a
   * defence against a loop, not capacity planning.
   */
  private readonly backoffUntil = new Map<string, number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly oauth: IntegrationsOauthService,
    private readonly google: GoogleCalendarClient,
  ) {}

  /**
   * The switch. Default OFF, like `CALENDAR_REMINDERS_ENABLED` and unlike the
   * weather prefetch, and for the reason ADR 0111 §4 gives: a push is a write
   * to a system other humans read, which is the same class of act as sending
   * mail. A first ship of that arms deliberately.
   */
  get armed(): boolean {
    const raw = (process.env.CALENDAR_PUSH_ENABLED ?? "").trim().toLowerCase();
    return raw === "true" || raw === "1" || raw === "on";
  }

  // ── the one entry point ──────────────────────────────────────────────────

  /**
   * Push one mutation. Called from exactly one place in `CalendarService`.
   *
   * NEVER THROWS. A calendar entry is the house's own record and it is saved
   * whether or not Google accepted a copy; a push that threw would roll a
   * person's edit back because somebody else's server was down. Every failure
   * becomes an outcome row and a returned result.
   */
  async push(
    restaurantId: string,
    calendarEventId: string,
    verb: PushVerb,
    options: { fromReconcile?: boolean } = {},
  ): Promise<PushResult> {
    try {
      return await this.attempt(restaurantId, calendarEventId, verb, options);
    } catch (error) {
      const detail = `The push did not complete: ${(error as Error).message}`;
      this.logger.error(
        `Calendar push (${verb}) for entry ${calendarEventId} threw — ${detail}`,
      );
      await this.record({
        restaurantId,
        calendarEventId,
        verb,
        outcome: "failed",
        detail,
        fromReconcile: options.fromReconcile ?? false,
      });
      return { outcome: "failed", detail, providerEventId: null, restored: false };
    }
  }

  private async attempt(
    restaurantId: string,
    calendarEventId: string,
    verb: PushVerb,
    options: { fromReconcile?: boolean },
  ): Promise<PushResult> {
    const fromReconcile = options.fromReconcile ?? false;

    if (!this.armed) {
      // No row. Nothing was owed: the house has not switched pushing on, and a
      // row per mutation saying so would drown the rows that mean something.
      // `status()` says `armed: false` in words, which is where the fact is.
      return {
        outcome: "not_connected",
        detail:
          "Pushing to Google is switched off on this deployment (CALENDAR_PUSH_ENABLED).",
        providerEventId: null,
        restored: false,
      };
    }

    const availability = this.oauth.availability()[INTEGRATION_ID];
    if (!availability?.available) {
      return {
        outcome: "unavailable",
        detail:
          availability?.reason ??
          "Google OAuth is not configured on this deployment.",
        providerEventId: null,
        restored: false,
      };
    }

    const connection = await this.connectionFor(restaurantId);
    if (!connection) {
      return {
        outcome: "not_connected",
        detail:
          "No one in this house has connected a Google account for the day-book.",
        providerEventId: null,
        restored: false,
      };
    }

    const until = this.backoffUntil.get(restaurantId) ?? 0;
    if (until > Date.now()) {
      const seconds = Math.ceil((until - Date.now()) / 1000);
      const detail = `Google asked this house to slow down; the next attempt is held for ${seconds} more second(s). The reconcile sweep will pick this entry up.`;
      await this.record({
        restaurantId,
        calendarEventId,
        verb,
        outcome: "rate_limited",
        detail,
        retryAfterSeconds: seconds,
        fromReconcile,
      });
      return { outcome: "rate_limited", detail, providerEventId: null, restored: false };
    }

    // The house's own switch (ADR 0114) and the token, at the one door feature
    // code is allowed to use. `getAccessToken` throws Forbidden for a grant the
    // house has stopped and BadRequest for one that needs reconnecting; both
    // are outcomes here, not exceptions to bubble.
    let accessToken: string;
    try {
      accessToken = await this.oauth.getAccessToken(
        connection.userId,
        restaurantId,
        INTEGRATION_ID,
      );
    } catch (error) {
      const message = (error as Error).message;
      const stopped = /stopped using/i.test(message);
      const outcome: PushOutcome = stopped ? "house_stopped" : "token_expired";
      const detail = stopped
        ? message
        : `${message} The grant row now says a reconnect is needed, and nothing was written to Google.`;
      await this.record({
        restaurantId,
        calendarEventId,
        verb,
        outcome,
        detail,
        fromReconcile,
      });
      return { outcome, detail, providerEventId: null, restored: false };
    }

    if (verb === "delete") {
      return this.pushDelete(
        restaurantId,
        calendarEventId,
        connection,
        accessToken,
        fromReconcile,
      );
    }

    return this.pushUpsert(
      restaurantId,
      calendarEventId,
      connection,
      accessToken,
      verb,
      fromReconcile,
    );
  }

  // ── create / update ──────────────────────────────────────────────────────

  private async pushUpsert(
    restaurantId: string,
    calendarEventId: string,
    connection: HouseConnection,
    accessToken: string,
    verb: PushVerb,
    fromReconcile: boolean,
  ): Promise<PushResult> {
    // Scoped read, and this is the cross-house refusal: an entry belonging to
    // another restaurant is simply not found, so no house can push a row it
    // does not own even if a caller passes the wrong pair.
    const { data: entry, error: entryError } = await this.db.client
      .from("calendar_events")
      .select(
        "id, restaurant_id, title, description, event_type, start_date, end_date, all_day, start_time, end_time, status",
      )
      .eq("id", calendarEventId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (entryError) {
      throw new Error(`the entry could not be read — ${entryError.message}`);
    }
    if (!entry) {
      const detail =
        "That entry does not belong to this house, so nothing was pushed.";
      await this.record({
        restaurantId,
        calendarEventId,
        verb,
        outcome: "refused",
        detail,
        fromReconcile,
      });
      return { outcome: "refused", detail, providerEventId: null, restored: false };
    }

    const target = await this.ensureTarget(
      restaurantId,
      connection,
      accessToken,
      fromReconcile,
    );
    if ("failure" in target) return target.failure;

    const key = idempotencyKey(restaurantId, calendarEventId, connection.id);
    const mapping = await this.upsertMapping(
      restaurantId,
      target.id,
      calendarEventId,
      key,
    );

    const body = this.eventBody(entry, target.timeZone, restaurantId);
    let restored = false;
    let answer: GoogleCalendarAnswer;

    if (mapping.providerEventId) {
      answer = await this.google.call(accessToken, {
        method: "PUT",
        path: `/calendars/${encodeURIComponent(target.providerCalendarId)}/events/${encodeURIComponent(mapping.providerEventId)}`,
        body,
      });

      // "Only we can delete." Somebody removed our copy inside Google, so the
      // update has nothing to address — and the answer is to put it back under
      // the same id, not to give up and leave a hole nobody can see.
      if (answer.status === 404 || answer.status === 410) {
        restored = true;
        answer = await this.google.call(accessToken, {
          method: "POST",
          path: `/calendars/${encodeURIComponent(target.providerCalendarId)}/events`,
          body: { ...body, id: key },
        });
      }
    } else {
      answer = await this.google.call(accessToken, {
        method: "POST",
        path: `/calendars/${encodeURIComponent(target.providerCalendarId)}/events`,
        body: { ...body, id: key },
      });
    }

    // A repeat of an id Google already holds. That is the idempotency key
    // doing its job on a retry: one provider event exists and it is ours.
    const duplicate =
      answer.status === 409 ||
      (answer.status === 400 && answer.reason === "duplicate");

    if (answer.status >= 200 && answer.status < 300) {
      const providerEventId =
        (typeof answer.body?.id === "string" ? answer.body.id : null) ?? key;
      await this.markPushed(mapping.id, providerEventId, verb);
      const detail = restored
        ? `The copy of this entry had been deleted inside Google; it was put back, because the house's day-book is the original. Google event ${providerEventId}.`
        : `Written to ${target.summary} as Google event ${providerEventId}.`;
      await this.record({
        restaurantId,
        calendarEventId,
        targetId: target.id,
        mappingId: mapping.id,
        verb,
        outcome: "delivered",
        detail,
        providerStatus: answer.status,
        fromReconcile,
      });
      return { outcome: "delivered", detail, providerEventId, restored };
    }

    if (duplicate) {
      await this.markPushed(mapping.id, key, verb);
      const detail = `Google already held this entry under the same idempotency key, so one event exists and not two. Google event ${key}.`;
      await this.record({
        restaurantId,
        calendarEventId,
        targetId: target.id,
        mappingId: mapping.id,
        verb,
        outcome: "delivered",
        detail,
        providerStatus: answer.status,
        providerReason: answer.reason,
        fromReconcile,
      });
      return { outcome: "delivered", detail, providerEventId: key, restored };
    }

    return this.recordFailure({
      restaurantId,
      calendarEventId,
      targetId: target.id,
      mappingId: mapping.id,
      verb,
      answer,
      fromReconcile,
    });
  }

  // ── delete ───────────────────────────────────────────────────────────────

  private async pushDelete(
    restaurantId: string,
    calendarEventId: string,
    connection: HouseConnection,
    accessToken: string,
    fromReconcile: boolean,
  ): Promise<PushResult> {
    const { data: rows, error } = await this.db.client
      .from("calendar_push_mappings")
      .select("id, target_id, provider_event_id")
      .eq("restaurant_id", restaurantId)
      .eq("calendar_event_id", calendarEventId);

    if (error) {
      throw new Error(`the mapping could not be read — ${error.message}`);
    }

    const mapping = (rows ?? [])[0] as
      | { id: string; target_id: string; provider_event_id: string | null }
      | undefined;

    if (!mapping?.provider_event_id) {
      // Nothing was ever copied, so nothing has to be removed. No row: this is
      // the one silence that is honest, because there is no missing write.
      return {
        outcome: "delivered",
        detail: "This entry had no copy in Google, so nothing had to be removed.",
        providerEventId: null,
        restored: false,
      };
    }

    // Marked BEFORE the call. If the process dies mid-delete the reconcile
    // sweep finds a mapping whose entry is gone and finishes the job; if it
    // were marked after, that copy would sit in somebody's Google account with
    // nothing left pointing at it.
    await this.db.client
      .from("calendar_push_mappings")
      .update({
        deleted_locally_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", mapping.id);

    const target = await this.targetById(mapping.target_id);
    if (!target) {
      throw new Error("the secondary calendar this copy lives on is unknown");
    }

    const answer = await this.google.call(accessToken, {
      method: "DELETE",
      path: `/calendars/${encodeURIComponent(target.providerCalendarId)}/events/${encodeURIComponent(mapping.provider_event_id)}`,
    });

    const gone =
      (answer.status >= 200 && answer.status < 300) ||
      answer.status === 404 ||
      answer.status === 410;

    if (gone) {
      await this.db.client
        .from("calendar_push_mappings")
        .delete()
        .eq("id", mapping.id);
      const detail =
        answer.status === 404 || answer.status === 410
          ? "The copy was already gone from Google; the mapping is closed."
          : `The copy was removed from ${target.summary}.`;
      await this.record({
        restaurantId,
        calendarEventId,
        targetId: target.id,
        verb: "delete",
        outcome: "delivered",
        detail,
        providerStatus: answer.status,
        fromReconcile,
      });
      return { outcome: "delivered", detail, providerEventId: null, restored: false };
    }

    return this.recordFailure({
      restaurantId,
      calendarEventId,
      targetId: target.id,
      mappingId: mapping.id,
      verb: "delete",
      answer,
      fromReconcile,
    });
  }

  // ── the secondary calendar, created once per (restaurant, account) ───────

  private async ensureTarget(
    restaurantId: string,
    connection: HouseConnection,
    accessToken: string,
    fromReconcile: boolean,
  ): Promise<Target | { failure: PushResult }> {
    const existing = await this.targetFor(restaurantId, connection.id);
    if (existing) return existing;

    const house = await this.house(restaurantId);
    const summary = `Mudavym — ${house.name}`;
    const answer = await this.google.call(accessToken, {
      method: "POST",
      path: "/calendars",
      body: {
        summary,
        description:
          "This restaurant's day-book, written by Mudavym. Entries here are copies: edit them in Mudavym, because a change made in Google is not read back and a deletion made here returns on the next push.",
        timeZone: house.timeZone ?? undefined,
      },
    });

    if (answer.status < 200 || answer.status >= 300) {
      return {
        failure: await this.recordFailure({
          restaurantId,
          verb: "ensure_calendar",
          answer,
          fromReconcile,
        }),
      };
    }

    const providerCalendarId =
      typeof answer.body?.id === "string" ? answer.body.id : null;
    if (!providerCalendarId) {
      throw new Error(
        "Google made a calendar and did not return its id, so nothing can be addressed to it",
      );
    }

    // `upsert` on the unique pair rather than an insert: two mutations racing
    // would otherwise make two calendars in the person's account, and the ADR
    // says one per (restaurant, account). The loser of the race re-reads the
    // winner's row.
    const { error } = await this.db.client
      .from("calendar_push_targets")
      .upsert(
        {
          restaurant_id: restaurantId,
          connection_id: connection.id,
          provider: "google",
          provider_calendar_id: providerCalendarId,
          provider_calendar_summary: summary,
          time_zone: house.timeZone,
          created_by: connection.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,connection_id", ignoreDuplicates: true },
      );

    if (error) {
      throw new Error(
        `the secondary calendar was made in Google and could not be recorded here — ${error.message}`,
      );
    }

    await this.record({
      restaurantId,
      targetId: null,
      verb: "ensure_calendar",
      outcome: "delivered",
      detail: `A secondary calendar "${summary}" was created in the connected Google account (${providerCalendarId}).`,
      providerStatus: answer.status,
      fromReconcile,
    });

    const stored = await this.targetFor(restaurantId, connection.id);
    if (!stored) {
      throw new Error(
        "the secondary calendar was recorded and could not be read back",
      );
    }
    return stored;
  }

  // ── status: the honest count ─────────────────────────────────────────────

  /**
   * What this house's push actually is, in numbers and one sentence.
   *
   * The counts are `null` on a failed read, never zero — "0 of 0 pushed" and
   * "the register could not be read" are different facts and the second must
   * not wear the first's clothes.
   */
  async status(restaurantId: string): Promise<PushStatus> {
    const availability = this.oauth.availability()[INTEGRATION_ID];

    const base: PushStatus = {
      available: availability?.available ?? false,
      unavailableReason: availability?.reason ?? null,
      armed: this.armed,
      connected: false,
      ownerUserId: null,
      ownerName: null,
      accountEmail: null,
      houseStopped: false,
      reconnectRequired: false,
      reconnectReason: null,
      calendar: null,
      entries: null,
      pushed: null,
      unpushed: null,
      pendingDeletes: null,
      sentence: "",
      lastOutcome: null,
      error: null,
    };

    // Returned BEFORE the grant register is touched. A deployment with no
    // Google credentials can hold no grant for this connector — there is
    // nothing to read, and reading anyway makes an unrelated schema problem
    // (a migration not yet applied, say) surface as a 500 on a surface whose
    // true answer is the plain sentence "this deployment cannot offer one".
    // Measured on localhost 2026-09-06: the first draft read first and
    // answered 500 `column integration_oauth_connections.reconnect_required_at
    // does not exist` where the honest answer was already known.
    if (!base.available) {
      base.sentence =
        base.unavailableReason ??
        "This deployment cannot offer a Google connection.";
      return base;
    }

    const connection = await this.connectionFor(restaurantId, {
      includeStopped: true,
    });
    base.connected = Boolean(connection);
    base.ownerUserId = connection?.userId ?? null;
    base.ownerName = connection?.ownerName ?? null;
    base.accountEmail = connection?.accountEmail ?? null;
    base.houseStopped = connection?.houseStopped ?? false;
    base.reconnectRequired = Boolean(connection?.reconnectRequiredAt);
    base.reconnectReason = connection?.reconnectReason ?? null;

    if (!connection) {
      base.sentence =
        "No Google account is connected, so none of this house's entries has a copy in Google.";
      return base;
    }

    const target = await this.targetFor(restaurantId, connection.id);
    if (target) {
      base.calendar = {
        providerCalendarId: target.providerCalendarId,
        summary: target.summary,
        timeZone: target.timeZone,
        createdAt: target.createdAt,
      };
    }

    const [entries, pushed, unpushed, pendingDeletes, last] = await Promise.all([
      // The table names are LITERAL in each call rather than a parameter. A
      // dynamic `from(table)` is invisible to
      // `scripts/check_queried_tables_exist.py`, which reported "the
      // unresolvable set grew from 26 to 27" against the first version of this
      // method — a guard going blind is worse than the typo it was meant to
      // catch, so the four counts are written out.
      this.count(
        this.db.client
          .from("calendar_events")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId),
        "calendar_events",
      ),
      this.count(
        this.db.client
          .from("calendar_push_mappings")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .not("provider_event_id", "is", null),
        "calendar_push_mappings",
      ),
      this.count(
        this.db.client
          .from("calendar_push_mappings")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .is("provider_event_id", null),
        "calendar_push_mappings",
      ),
      this.count(
        this.db.client
          .from("calendar_push_mappings")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .not("deleted_locally_at", "is", null)
          .not("provider_event_id", "is", null),
        "calendar_push_mappings",
      ),
      this.lastOutcome(restaurantId),
    ]);

    base.entries = entries;
    base.pushed = pushed;
    base.unpushed = unpushed;
    base.pendingDeletes = pendingDeletes;
    base.lastOutcome = last;

    if (entries === null || pushed === null) {
      base.error =
        "The push register could not be counted, so no figure is given here rather than a zero that would read as health.";
      base.sentence = base.error;
      return base;
    }

    base.sentence = pushSentence({
      armed: base.armed,
      houseStopped: base.houseStopped,
      reconnectRequired: base.reconnectRequired,
      hasCalendar: Boolean(target),
      entries,
      pushed,
      summary: target?.summary ?? null,
    });
    return base;
  }

  // ── the reconcile's own reads (used by the sweep service) ────────────────

  /** Houses with a live, house-permitted `google_calendar` grant. */
  async housesWithAGrant(): Promise<string[] | null> {
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("restaurant_id")
      .eq("integration_id", INTEGRATION_ID)
      .is("revoked_at", null)
      .not("restaurant_id", "is", null);

    if (error) {
      this.logger.error(
        `The push reconcile could not read the grant register: ${error.message}`,
      );
      return null;
    }
    return Array.from(
      new Set((data ?? []).map((r) => String(r.restaurant_id))),
    );
  }

  /**
   * Entries in this house that are owed a copy: every entry with no mapping at
   * all, plus every mapping whose `provider_event_id` is NULL.
   *
   * Returns null on a failed read. The sweep must be able to say "I could not
   * find out" rather than "there was nothing to do".
   */
  async entriesOwedACopy(
    restaurantId: string,
    limit: number,
  ): Promise<string[] | null> {
    const { data: entries, error: entriesError } = await this.db.client
      .from("calendar_events")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .order("start_date", { ascending: false })
      .limit(limit);

    if (entriesError) {
      this.logger.error(
        `The push reconcile could not read this house's entries: ${entriesError.message}`,
      );
      return null;
    }

    const { data: mapped, error: mappedError } = await this.db.client
      .from("calendar_push_mappings")
      .select("calendar_event_id, provider_event_id")
      .eq("restaurant_id", restaurantId);

    if (mappedError) {
      this.logger.error(
        `The push reconcile could not read this house's mappings: ${mappedError.message}`,
      );
      return null;
    }

    const withACopy = new Set(
      (mapped ?? [])
        .filter((m) => m.provider_event_id)
        .map((m) => String(m.calendar_event_id)),
    );
    return (entries ?? [])
      .map((e) => String(e.id))
      .filter((id) => !withACopy.has(id));
  }

  /** Copies whose entry the house deleted and whose removal has not landed. */
  async copiesAwaitingRemoval(
    restaurantId: string,
    limit: number,
  ): Promise<string[] | null> {
    const { data, error } = await this.db.client
      .from("calendar_push_mappings")
      .select("calendar_event_id")
      .eq("restaurant_id", restaurantId)
      .not("deleted_locally_at", "is", null)
      .not("provider_event_id", "is", null)
      .limit(limit);

    if (error) {
      this.logger.error(
        `The push reconcile could not read the pending removals: ${error.message}`,
      );
      return null;
    }
    return (data ?? []).map((r) => String(r.calendar_event_id));
  }

  /** Seconds this house is still being held back, from the DURABLE record. */
  async persistedBackoffSeconds(restaurantId: string): Promise<number> {
    const { data, error } = await this.db.client
      .from("calendar_push_outcomes")
      .select("outcome, retry_after_seconds, attempted_at")
      .eq("restaurant_id", restaurantId)
      .order("attempted_at", { ascending: false })
      .limit(1);

    if (error) return 0;
    const row = (data ?? [])[0] as
      | { outcome: string; retry_after_seconds: number | null; attempted_at: string }
      | undefined;
    if (!row || row.outcome !== "rate_limited") return 0;

    const seconds = row.retry_after_seconds ?? DEFAULT_BACKOFF_SECONDS;
    const elapsed = (Date.now() - new Date(row.attempted_at).getTime()) / 1000;
    return Math.max(0, Math.ceil(seconds - elapsed));
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  private async connectionFor(
    restaurantId: string,
    options: { includeStopped?: boolean } = {},
  ): Promise<HouseConnection | null> {
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select(
        "id, user_id, account_email, reconnect_required_at, reconnect_reason",
      )
      .eq("restaurant_id", restaurantId)
      .eq("integration_id", INTEGRATION_ID)
      .is("revoked_at", null)
      .order("connected_at", { ascending: true })
      .limit(1);

    if (error) {
      throw new Error(`the grant register could not be read — ${error.message}`);
    }
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const connection: HouseConnection = {
      id: String(row.id),
      userId: String(row.user_id),
      accountEmail: (row.account_email as string | null) ?? null,
      reconnectRequiredAt: (row.reconnect_required_at as string | null) ?? null,
      reconnectReason: (row.reconnect_reason as string | null) ?? null,
      ownerName: null,
      houseStopped: false,
    };

    if (options.includeStopped) {
      const [name, stopped] = await Promise.all([
        this.ownerName(connection.userId),
        this.isHouseStopped(restaurantId, connection.id),
      ]);
      connection.ownerName = name;
      connection.houseStopped = stopped;
    }
    return connection;
  }

  /**
   * The person whose grant this house pushes through.
   *
   * `name`, not `full_name` — `public.users` has never had a `full_name`
   * column (baseline:5848-5861) and PostgREST answers a request for one with
   * 42703, failing the WHOLE select. Caught by
   * `scripts/check_read_columns_exist.py` on this build's first run.
   *
   * A failed read returns null and SAYS so in the log rather than being
   * swallowed: a person's name going missing from the register is a small
   * thing, and a read failing without a trace is not.
   */
  private async ownerName(userId: string): Promise<string | null> {
    const { data, error } = await this.db.client
      .from("users")
      .select("user_id, name, email")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      this.logger.warn(
        `The owner of the day-book's Google grant could not be named: ${error.message}`,
      );
      return null;
    }
    const name = (data?.name as string | null) ?? null;
    return name ?? ((data?.email as string | null) ?? null);
  }

  /**
   * Whether a manager has stopped the house using this grant (ADR 0114).
   *
   * Asked of `getAccessToken` for the ENFORCEMENT — that is the one door — and
   * read here only so `status()` can say so in words. It is deliberately a
   * second read of the same fact rather than a second rule.
   */
  private async isHouseStopped(
    restaurantId: string,
    connectionId: string,
  ): Promise<boolean> {
    try {
      const grants = await this.oauth.listHouseGrants(restaurantId);
      const row = grants.grants.find((g) => g.connectionId === connectionId);
      return row?.houseAccess.revoked ?? false;
    } catch {
      return false;
    }
  }

  private async house(
    restaurantId: string,
  ): Promise<{ name: string; timeZone: string | null }> {
    const { data, error } = await this.db.client
      .from("restaurants")
      .select("name, timezone")
      .eq("id", restaurantId)
      .maybeSingle();

    if (error) {
      throw new Error(`the restaurant could not be read — ${error.message}`);
    }
    return {
      name: (data?.name as string | null) ?? "this restaurant",
      timeZone: resolveZone(data?.timezone as string | null),
    };
  }

  private async targetFor(
    restaurantId: string,
    connectionId: string,
  ): Promise<Target | null> {
    const { data, error } = await this.db.client
      .from("calendar_push_targets")
      .select(
        "id, provider_calendar_id, provider_calendar_summary, time_zone, created_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("connection_id", connectionId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `the house's secondary calendar could not be read — ${error.message}`,
      );
    }
    return data ? toTarget(data) : null;
  }

  private async targetById(id: string): Promise<Target | null> {
    const { data, error } = await this.db.client
      .from("calendar_push_targets")
      .select(
        "id, provider_calendar_id, provider_calendar_summary, time_zone, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `the house's secondary calendar could not be read — ${error.message}`,
      );
    }
    return data ? toTarget(data) : null;
  }

  private async upsertMapping(
    restaurantId: string,
    targetId: string,
    calendarEventId: string,
    key: string,
  ): Promise<{ id: string; providerEventId: string | null }> {
    const { error } = await this.db.client
      .from("calendar_push_mappings")
      .upsert(
        {
          restaurant_id: restaurantId,
          target_id: targetId,
          calendar_event_id: calendarEventId,
          idempotency_key: key,
          // Cleared on every upsert: an entry being pushed again is not an
          // entry the house has deleted, and a stale mark would make the
          // reconcile try to remove a live copy.
          deleted_locally_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );

    if (error) {
      throw new Error(`the mapping could not be written — ${error.message}`);
    }

    const { data, error: readError } = await this.db.client
      .from("calendar_push_mappings")
      .select("id, provider_event_id")
      .eq("idempotency_key", key)
      .maybeSingle();

    if (readError || !data) {
      throw new Error(
        `the mapping could not be read back — ${readError?.message ?? "no row"}`,
      );
    }
    return {
      id: String(data.id),
      providerEventId: (data.provider_event_id as string | null) ?? null,
    };
  }

  private async markPushed(
    mappingId: string,
    providerEventId: string,
    verb: PushVerb,
  ) {
    const { error } = await this.db.client
      .from("calendar_push_mappings")
      .update({
        provider_event_id: providerEventId,
        last_verb: verb,
        last_pushed_at: new Date().toISOString(),
        deleted_locally_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mappingId);

    if (error) {
      // Loud, because this is the shape that produces duplicates: the copy
      // exists in Google and we failed to remember its id, so the next push
      // would insert again — which the idempotency key survives, but only
      // because the key is derived and not stored.
      this.logger.error(
        `A copy was written to Google and its id could not be stored: ${error.message}. ` +
          `Mapping ${mappingId}, Google event ${providerEventId}.`,
      );
    }
  }

  /**
   * A count, or NULL — never a zero standing in for a failed read.
   *
   * The whole point of this method's return type. "0 of 0 pushed" over a
   * register that could not be read is the single most reassuring thing this
   * surface could say, and the one thing it must never say by accident.
   */
  private async count(
    query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
    label: string,
  ): Promise<number | null> {
    const { count, error } = await query;
    if (error) {
      this.logger.warn(`Could not count ${label}: ${error.message}`);
      return null;
    }
    return count ?? 0;
  }

  private async lastOutcome(restaurantId: string): Promise<
    PushStatus["lastOutcome"]
  > {
    const { data, error } = await this.db.client
      .from("calendar_push_outcomes")
      .select("verb, outcome, detail, attempted_at")
      .eq("restaurant_id", restaurantId)
      .order("attempted_at", { ascending: false })
      .limit(1);

    if (error) return null;
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      verb: String(row.verb),
      outcome: String(row.outcome),
      detail: String(row.detail),
      attemptedAt: String(row.attempted_at),
    };
  }

  private async recordFailure(params: {
    restaurantId: string;
    calendarEventId?: string;
    targetId?: string | null;
    mappingId?: string | null;
    verb: PushVerb | "ensure_calendar";
    answer: GoogleCalendarAnswer;
    fromReconcile: boolean;
  }): Promise<PushResult> {
    const { answer } = params;
    const limited = isRateLimited(answer);
    const retryAfter =
      answer.retryAfterSeconds ?? (limited ? DEFAULT_BACKOFF_SECONDS : null);

    if (limited) {
      this.backoffUntil.set(
        params.restaurantId,
        Date.now() + (retryAfter ?? DEFAULT_BACKOFF_SECONDS) * 1000,
      );
    }

    const outcome: PushOutcome = limited
      ? "rate_limited"
      : answer.status === 401
        ? "token_expired"
        : answer.status === 0
          ? "failed"
          : "refused";

    const said = answer.message ?? "Google gave no reason.";
    const detail = limited
      ? `Google asked us to slow down (${answer.status}${answer.reason ? ` ${answer.reason}` : ""}): ${said} Nothing was written; the next attempt is held for ${retryAfter ?? DEFAULT_BACKOFF_SECONDS} second(s) and the reconcile sweep retries.`
      : answer.status === 0
        ? said
        : `Google refused with ${answer.status}${answer.reason ? ` (${answer.reason})` : ""}: ${said}`;

    await this.record({
      restaurantId: params.restaurantId,
      calendarEventId: params.calendarEventId,
      targetId: params.targetId ?? null,
      mappingId: params.mappingId ?? null,
      verb: params.verb,
      outcome,
      detail,
      providerStatus: answer.status || null,
      providerReason: answer.reason,
      retryAfterSeconds: retryAfter,
      fromReconcile: params.fromReconcile,
    });

    return { outcome, detail, providerEventId: null, restored: false };
  }

  /**
   * Write the outcome row. Best effort by necessity — it is the LAST thing in
   * every path — but never silent: a failure to record is logged with the whole
   * sentence it failed to record, so the account survives in the log even when
   * it does not survive in the table.
   */
  private async record(params: {
    restaurantId: string;
    calendarEventId?: string;
    targetId?: string | null;
    mappingId?: string | null;
    verb: PushVerb | "ensure_calendar";
    outcome: PushOutcome;
    detail: string;
    providerStatus?: number | null;
    providerReason?: string | null;
    retryAfterSeconds?: number | null;
    fromReconcile: boolean;
  }) {
    const { error } = await this.db.client
      .from("calendar_push_outcomes")
      .insert({
        restaurant_id: params.restaurantId,
        calendar_event_id: params.calendarEventId ?? null,
        target_id: params.targetId ?? null,
        mapping_id: params.mappingId ?? null,
        verb: params.verb,
        outcome: params.outcome,
        detail: params.detail,
        provider_status: params.providerStatus ?? null,
        provider_reason: params.providerReason ?? null,
        retry_after_seconds: params.retryAfterSeconds ?? null,
        from_reconcile: params.fromReconcile,
      });

    if (error) {
      this.logger.error(
        `A push outcome could not be recorded (${error.message}). The outcome was ` +
          `${params.outcome} for ${params.verb} on entry ${params.calendarEventId ?? "-"}: ${params.detail}`,
      );
    }
  }

  /** The Google event body for one entry. Exported through the spec, not here. */
  private eventBody(
    entry: Record<string, unknown>,
    calendarZone: string | null,
    restaurantId: string,
  ): Record<string, unknown> {
    const allDay = entry.all_day !== false;
    const startDate = String(entry.start_date);
    const endDate = String(entry.end_date ?? entry.start_date);

    const start = allDay
      ? { date: startDate }
      : {
          dateTime: `${startDate}T${padTime(String(entry.start_time ?? "00:00:00"))}`,
          timeZone: calendarZone ?? undefined,
        };

    const end = allDay
      ? // Google's all-day end date is EXCLUSIVE. Sending the same date for
        // both makes a zero-length event that some clients do not draw at all.
        { date: addDays(endDate, 1) }
      : {
          dateTime: `${endDate}T${padTime(
            String(
              entry.end_time ??
                plusMinutes(
                  String(entry.start_time ?? "00:00:00"),
                  DEFAULT_EVENT_MINUTES,
                ),
            ),
          )}`,
          timeZone: calendarZone ?? undefined,
        };

    return {
      summary: String(entry.title ?? "Untitled entry"),
      description: buildDescription(entry),
      start,
      end,
      status: entry.status === "cancelled" ? "cancelled" : "confirmed",
      // Stamped so a copy can be recognised as ours from inside Google, and so
      // direction 3's echo rule (ADR 0111 §5, rule 4) has something to key on
      // when it is built. It is written now because adding it later would leave
      // every event pushed before that day unstamped.
      extendedProperties: {
        private: {
          mudavym_restaurant_id: restaurantId,
          mudavym_entry_id: String(entry.id),
          mudavym_source: "mudavym.calendar.push",
        },
      },
    };
  }
}

// ── free functions, so the spec can assert on them directly ────────────────

interface HouseConnection {
  id: string;
  userId: string;
  accountEmail: string | null;
  reconnectRequiredAt: string | null;
  reconnectReason: string | null;
  ownerName: string | null;
  houseStopped: boolean;
}

interface Target {
  id: string;
  providerCalendarId: string;
  summary: string;
  timeZone: string | null;
  createdAt: string | null;
}

function toTarget(row: Record<string, unknown>): Target {
  return {
    id: String(row.id),
    providerCalendarId: String(row.provider_calendar_id),
    summary: String(row.provider_calendar_summary),
    timeZone: (row.time_zone as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  };
}

/**
 * ADR 0111's "(restaurant, entry, provider account)", and also the id Google
 * stores the event under.
 *
 * Hex, because a Google event id must be base32hex (`0-9a-v`, RFC 4648 s.7) and
 * lowercase hex is a strict subset of that alphabet. 64 characters, inside the
 * 5-1024 bound.
 */
export function idempotencyKey(
  restaurantId: string,
  calendarEventId: string,
  connectionId: string,
): string {
  return createHash("sha256")
    .update(`${restaurantId}|${calendarEventId}|${connectionId}`)
    .digest("hex");
}

function padTime(value: string): string {
  const parts = value.split(":");
  const h = (parts[0] ?? "00").padStart(2, "0");
  const m = (parts[1] ?? "00").padStart(2, "0");
  const s = (parts[2] ?? "00").padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function plusMinutes(value: string, minutes: number): string {
  const [h, m] = padTime(value).split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildDescription(entry: Record<string, unknown>): string {
  const lines = [String(entry.description ?? "").trim()].filter(Boolean);
  lines.push(
    `Kind: ${String(entry.event_type ?? "entry")} · Status: ${String(entry.status ?? "pending")}`,
  );
  lines.push(
    "Written by Mudavym. Edit this in Mudavym — changes made here are not read back, and deleting this copy puts it back on the next push.",
  );
  return lines.join("\n\n");
}

/**
 * The sentence. Written as a free function so the spec can assert every branch
 * without a database, and so the one forbidden output — "in sync" over an empty
 * mapping table — is impossible to reach by construction.
 */
export function pushSentence(input: {
  armed: boolean;
  houseStopped: boolean;
  reconnectRequired: boolean;
  hasCalendar: boolean;
  entries: number;
  pushed: number;
  summary: string | null;
}): string {
  const where = input.summary ? ` into "${input.summary}"` : "";
  const count = `${input.pushed} of ${input.entries} entr${input.entries === 1 ? "y" : "ies"} pushed`;

  if (input.houseStopped) {
    return `${count}${where}. This house has stopped using the grant, so nothing more is being written and the copies already in Google stay where they are.`;
  }
  if (input.reconnectRequired) {
    return `${count}${where}. The grant needs reconnecting before anything else can be written.`;
  }
  if (!input.armed) {
    return `${count}${where}. Pushing is switched off on this deployment, so no entry changed since it was switched off has been copied.`;
  }
  if (!input.hasCalendar) {
    return `${count}. A Google account is connected and no calendar has been made in it yet, so nothing has been written.`;
  }
  if (input.entries === 0) {
    return `This house has no entries, so there is nothing to push${where}.`;
  }
  if (input.pushed === 0) {
    return `${count}${where}. Nothing has reached Google — read the last outcome below for why, and do not read this as being in sync.`;
  }
  if (input.pushed < input.entries) {
    return `${count}${where}. The rest are owed a copy and the hourly sweep retries them.`;
  }
  return `${count}${where}. Every entry this house holds has a copy.`;
}
