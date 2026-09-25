/**
 * "This house depends on reading its own mailbox, and nothing is backing that."
 *
 * THE FOUNDER'S WORDS THIS ANSWERS (0160 §111, quoted in full there)
 * --------------------------------------------------------------------
 * *"it's a good idea to alert the user so that in order to get the mails, this
 * configuration needs to be done ... if the access just revoked or anything
 * else that we cannot access anymore, we're gonna pop up a notification for
 * mobile. For web ... maybe not."* Carried into the `/help` build (ADR 0160
 * row 111, "owed"): *"a standing alert when the house's mail grant is absent
 * or revoked, pushed on mobile."*
 *
 * WHAT "THE HOUSE'S MAIL GRANT" IS, MEASURED
 * -------------------------------------------
 * `enable_house_inbox_read` (`settings/dto/feature-flags.dto.ts`) is the
 * house's own declaration that a scheduled job should read its mailbox
 * through a member's `gmail_read` grant (ADR 0118, receive half). Whether a
 * live grant actually backs that declaration is exactly
 * `HouseInboxService.statusFor` (`communications/inbox/house-inbox.service.ts:805`)
 * — the same read `GET /communications/letters/sender` serves as `reader`,
 * so this producer and the page it feeds can never disagree about the same
 * fact. `granted: false` covers BOTH cases the founder named, by construction:
 * the query filters `.is("revoked_at", null)`, so a never-connected house and
 * a house whose member revoked the grant read identically — there is no
 * "absent" the founder would want treated differently from "revoked" here,
 * only "backed" and "not backed".
 *
 * WHY THIS ONLY FIRES WHEN THE FLAG IS ON
 * -----------------------------------------
 * A house that has never turned `enable_house_inbox_read` on has not asked
 * for this feature, so `granted: false` there is not a fault — it is the
 * ordinary state of a switch nobody flipped. Alerting every such house would
 * make the standing alert noise, not signal. `statusFor.enabled` is exactly
 * that switch, read from the same place `GET /settings/feature-flags` does.
 *
 * WHY NO WEEKLY CAP (unlike `GrantSuspendedProducer`)
 * ------------------------------------------------------
 * The tool-grant producer bounds its repeats because a suspended MCP grant is
 * a transient permission fight the founder asked to stop escalating after a
 * few weeks. A house that has declared it depends on its own mailbox and has
 * no grant backing that declaration is sitting in a state with no natural
 * ceiling — every day it stays this way, "nothing has been read" is still
 * true. So this producer keeps firing, once per calendar week, for as long
 * as the condition holds; the moment `statusFor` reports `granted: true` the
 * dedupe key's week number stops mattering because nothing is emitted at all.
 * "Standing" is the word the founder used, and a cap would make it
 * intermittent instead.
 *
 * WHO HEARS IT
 * ------------
 * Owners and managers only — `enable_house_inbox_read` is itself gated
 * "Owner or manager only" to SET (`feature-flags.dto.ts`), and reconnecting a
 * grant from `/connections` needs the same standing (`assertCanManageRestaurant`,
 * `integrations-oauth.controller.ts:120`). A staff member cannot act on this,
 * so is not woken by it.
 *
 * WEB BEHAVIOUR TODAY, AND WHY IT IS NOT A DECISION (ADR 0160 §111 OPEN ITEM 5)
 * -------------------------------------------------------------------------
 * **[corrected 2026-09-19 — pg-help lane; the previous heading here was
 * "WEB PRESENTATION IS DEFERRED" and read as though whether this reaches
 * the web bell were still unsettled. Mechanically it is not: this producer
 * has no code path that treats web differently from mobile, so it already
 * answers the founder's open question by omission. That is what this
 * section now says, plainly, instead of implying a deferral that the code
 * does not actually make.]**
 *
 * The founder, quoted above: *"pop up a notification for mobile. For web ...
 * maybe not, maybe not. Maybe not. I'm not sure."* ADR 0160 §111 records this
 * as its own OPEN ITEM 5, the founder's call, not decided there or here.
 *
 * What this producer actually does, verified against `persistForRestaurant`
 * (`notifications.service.ts:614-747`): it calls that one funnel with
 * `priority: "high"`, and the funnel is not platform-aware — it (1) inserts
 * one `notifications` row per addressed member, `channels: ["in_app"]`, with
 * no field that gates it to mobile (:667-692); (2) emits it live over the
 * restaurant's websocket room, which any open web tab is already joined to
 * (:711-731); and (3) additionally pushes to Expo/mobile because priority is
 * not `"low"` (:736-747). Steps (1) and (2) are exactly what backs the web
 * bell — `useNotifications(userId, { status: 'unread' })`
 * (`Header.tsx:42`) reads the same `notifications` table with no type
 * filter, and the live emit updates it before the next page load even asks.
 * So THIS ALERT ALREADY REACHES THE WEB BELL TODAY, unconditionally, the
 * same moment mobile gets its push — there is no code path anywhere in this
 * funnel that could deliver one without the other.
 *
 * That is a fact about what ships, not an answer to open item 5. Nobody
 * decided "web: yes" — the shared funnel simply has no "web: no" to opt
 * into, so the open question reads answered by default unless this header
 * says otherwise. `/help` reads the house's own state directly from
 * `GET /communications/letters/sender` (Register I) as well, not from this
 * producer's output, so the alert and the page's own reading stay two views
 * of the same fact, not two facts — but that does not change what the bell
 * itself already shows. Fixing this — giving `persistForRestaurant` a way to
 * write mobile-only, or deciding that today's web behaviour is in fact fine
 * — is the founder's call (ADR 0160 §111 open item 5), not something this
 * file resolves by picking one silently.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { HouseInboxService } from "../../communications/inbox/house-inbox.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";

const PRODUCER = "mail_grant_absent";

/** Owners and managers only — see the header. Mirrors GrantSuspendedProducer's REPEAT_ROLES. */
const AUDIENCE_ROLES = ["owner", "manager"] as const;

function line(text: string): string {
  return text;
}

/** A stable, monotonically increasing weekly bucket. Not calendar-aligned to
 * any timezone on purpose — this is a dedupe key, not a date shown to anyone;
 * the message itself carries the real, human clock via `changedAt`-free prose
 * (there is no "changed at" here, only "still true right now"). */
function epochWeek(now: Date): number {
  return Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
}

@Injectable()
export class MailGrantAbsentProducer {
  private readonly logger = new Logger(MailGrantAbsentProducer.name);

  static readonly PRODUCER = PRODUCER;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly inbox: HouseInboxService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    _timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();

    let status: Awaited<ReturnType<HouseInboxService["statusFor"]>>;
    try {
      status = await this.inbox.statusFor(restaurantId);
    } catch (err) {
      tally.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `MAIL_GRANT_ABSENT_STATUS_THREW restaurant=${restaurantId} — ${message}`,
      );
      return tally;
    }

    if (!status.enabled) {
      tally.withheldReason =
        "enable_house_inbox_read is off for this house — nothing depends on the grant, so nothing is reported.";
      return tally;
    }

    if (status.granted === "unknown") {
      // The grants table itself could not be read. Reported as a failure, not
      // as "absent" — we genuinely do not know, and ADR 0067 forbids treating
      // an unread state as a negative answer.
      tally.failed += 1;
      this.logger.warn(
        `MAIL_GRANT_STATUS_UNREADABLE restaurant=${restaurantId} — ${status.lastError ?? "no detail"}`,
      );
      return tally;
    }

    if (status.granted === true) {
      tally.withheldReason =
        "the house's Gmail read grant is live — nothing to report.";
      return tally;
    }

    // status.granted === false, and the house depends on it: the standing case.
    const managers = await this.managerAudience(restaurantId, audience);
    if (managers.ready.length === 0 && managers.deferred.length === 0) {
      tally.withheldReason =
        "no owner or manager is a member of this restaurant, so there is nobody who could act on this.";
      return tally;
    }

    const week = epochWeek(now);
    const detail = status.lastError
      ? line(`The last read attempt failed: ${status.lastError}`)
      : line(
          "No live Gmail read grant is recorded for this house — either none was ever connected, or the one that was has been revoked.",
        );

    await this.ledger.emit(
      { restaurantId, producer: PRODUCER, audience: managers, tally, now },
      {
        dedupeKey: `mail-grant-absent:${restaurantId}:week${week}`,
        occurredAt: now,
        payload: {
          type: "mail_grant_absent",
          title: "The house's mail reading is on, and nothing is backing it",
          message: `This house has vendor-mail reading turned on in Settings. ${detail} Reconnect it, or the house will keep missing whatever arrives in reply.`,
          priority: "high",
          actionUrl: "/connections",
          actionLabel: "Reconnect",
          metadata: {
            restaurantId,
            enabled: status.enabled,
            granted: status.granted,
            lastError: status.lastError,
            week,
          },
        },
      },
    );

    return tally;
  }

  /**
   * `null | boolean`, for `GET /notifications/producers/status` — the same
   * three-state shape `GrantSuspendedProducer.suspendedGrantCount` uses, read
   * through the identical `statusFor` this sweep uses, so the status page and
   * the next sweep can never predict differently.
   */
  async wouldFire(restaurantId: string): Promise<boolean | null> {
    try {
      const status = await this.inbox.statusFor(restaurantId);
      if (!status.enabled) return false;
      if (status.granted === "unknown") return null;
      return status.granted === false;
    } catch (err) {
      this.logger.warn(
        `MAIL_GRANT_ABSENT_STATUS_UNREADABLE restaurant=${restaurantId} — ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Narrows the audience it is handed to owners and managers — the same
   * shape `GrantSuspendedProducer.repeatAudience` uses, and for the same
   * reason: nobody else can act on this.
   */
  private async managerAudience(
    restaurantId: string,
    audience: ProducerAudience,
  ): Promise<ProducerAudience> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", AUDIENCE_ROLES as unknown as string[]);

    if (error) {
      this.logger.error(
        `MAIL_GRANT_ABSENT_AUDIENCE_UNREADABLE restaurant=${restaurantId} — ${error.message}. ` +
          "Falling back to the full ready/deferred split rather than silently telling nobody.",
      );
      return audience;
    }

    const managerIds = new Set(
      ((data ?? []) as { user_id: string }[]).map((r) => r.user_id),
    );
    return {
      ready: audience.ready.filter((id) => managerIds.has(id)),
      deferred: audience.deferred.filter((id) => managerIds.has(id)),
    };
  }
}
