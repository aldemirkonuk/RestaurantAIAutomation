/**
 * "Your till has gone quiet."
 *
 * F-1651 (sim 54, till-ingest-edges.md finding 4): a till that stops sending
 * checks says nothing to anyone. Connections now reads "Quiet since <date>"
 * once every till has been silent for TILL_QUIET_AFTER_MS (c6a8ff88a), but a
 * page nobody opens is no warning: the house's sales and stock stop being
 * recorded while the owner believes the till is sending. This producer rings
 * the owners and managers once for each quiet stretch.
 *
 * WHAT "QUIET" IS
 * ---------------
 * The newest check any live till of the house has sent is older than
 * TILL_QUIET_AFTER_MS. It is the same reading the Connections row makes (the
 * newest `opened_at` from any till, `pos-hub.service.ts` getStatus), with the
 * same gap, so the bell and the page never disagree:
 *  - a house whose tills have never sent a check is not quiet; it has no till
 *    to go quiet (nothing is said);
 *  - a file import (`csv_import`) is not a till sending; it is left out;
 *  - a till the owner switched off (`pos_connections.enabled = false`) is
 *    silent on purpose, and is left out.
 *
 * ONCE PER QUIET STRETCH
 * ----------------------
 * The dedupe key is the newest check's own time. While the tills stay silent
 * that time does not move, so every later sweep finds the claim already taken
 * and writes nothing. When a check arrives the stretch ends; when they go
 * quiet again the newest check is a different one, so the next stretch rings
 * once more. A member inside their quiet hours is deferred by the ledger, not
 * dropped, and is written on the first sweep after they end.
 *
 * WHO HEARS IT
 * ------------
 * Owners and managers only, as MailGrantAbsentProducer: reconnecting a till
 * from Connections needs that standing.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  OWNER_AND_MANAGER,
  houseMembersInRoles,
} from "../../common/tenant/live-membership";
import { PROVIDER_BY_KEY } from "../../pos-hub/pos-provider.registry";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn } from "./producer-copy";

const PRODUCER = "till_quiet";

/**
 * How long every till may be silent before the house is told. Two days, so a
 * house shut one day a week is not told its till is down on its day off.
 * The Connections row (apps/web ConnectionsNext.tsx TILL_QUIET_AFTER_MS)
 * holds the same gap; till-quiet.producer.spec.ts fails when the two differ.
 */
export const TILL_QUIET_AFTER_MS = 48 * 3_600_000;

/** A file import is not a till sending. */
const FILE_IMPORT_SOURCE = "csv_import";

/** What the sweep read about the house's tills. */
type TillReading =
  | { kind: "unreadable"; message: string }
  | { kind: "never" }
  | { kind: "last"; source: string; at: Date };

@Injectable()
export class TillQuietProducer {
  private readonly logger = new Logger(TillQuietProducer.name);

  static readonly PRODUCER = PRODUCER;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const reading = await this.newestCheck(restaurantId);
    if (reading.kind === "unreadable") {
      // Unknown is not quiet (ADR 0067): nothing is said on a failed read.
      tally.failed += 1;
      this.logger.warn(
        `TILL_QUIET_UNREADABLE restaurant=${restaurantId} — ${reading.message}`,
      );
      return tally;
    }
    if (reading.kind === "never") {
      tally.withheldReason =
        "no till of this house has sent a check, so there is no till to go quiet.";
      return tally;
    }
    if (now.getTime() - reading.at.getTime() <= TILL_QUIET_AFTER_MS) {
      tally.withheldReason =
        "a till of this house sent a check within the last 48 hours.";
      return tally;
    }

    const managers = await this.managerAudience(restaurantId, audience, now);
    if (managers.ready.length === 0 && managers.deferred.length === 0) {
      tally.withheldReason =
        "no owner or manager is a member of this restaurant, so there is nobody who could act on this.";
      return tally;
    }

    const lastAt = reading.at.toISOString();
    const till = PROVIDER_BY_KEY[reading.source]?.name ?? "your till";
    const day = dayIn(reading.at, timeZone);
    const time = clockIn(reading.at, timeZone);
    await this.ledger.emit(
      { restaurantId, producer: PRODUCER, audience: managers, tally, now },
      {
        dedupeKey: `till-quiet:${restaurantId}:${lastAt}`,
        occurredAt: new Date(reading.at.getTime() + TILL_QUIET_AFTER_MS),
        payload: {
          type: "pos_till_quiet",
          title: `No sale has come from your till since ${day}`,
          message:
            `The last check came from ${till} on ${day} at ${time}, and none has come for more than 2 days. ` +
            "If the house has been open, its sales and stock are not being recorded. " +
            "Check that the till is on and still connected.",
          priority: "high",
          actionUrl: "/connections",
          actionLabel: "Open Connections",
          metadata: {
            restaurantId,
            source: reading.source,
            lastCheckAt: lastAt,
          },
        },
      },
    );
    return tally;
  }

  /**
   * For `GET /notifications/producers/status`: true when the tills are quiet
   * now, false when not (or never sent), null when it could not be read —
   * through the same read the sweep uses.
   */
  async wouldFire(restaurantId: string, now: Date): Promise<boolean | null> {
    const reading = await this.newestCheck(restaurantId);
    if (reading.kind === "unreadable") return null;
    if (reading.kind === "never") return false;
    return now.getTime() - reading.at.getTime() > TILL_QUIET_AFTER_MS;
  }

  /**
   * The house's newest check from a live till: any source but a file import
   * and the tills the owner switched off. Read failures are said, never read
   * as "no check".
   */
  private async newestCheck(restaurantId: string): Promise<TillReading> {
    const client = this.databaseService.getClient();
    const off = await client
      .from("pos_connections")
      .select("provider")
      .eq("restaurant_id", restaurantId)
      .eq("enabled", false);
    if (off.error) {
      return {
        kind: "unreadable",
        message: `the switched-off tills could not be read: ${off.error.message}`,
      };
    }
    let q = client
      .from("pos_checks")
      .select("source, opened_at")
      .eq("restaurant_id", restaurantId)
      .neq("source", FILE_IMPORT_SOURCE);
    for (const r of (off.data ?? []) as Array<{ provider: string }>) {
      q = q.neq("source", r.provider);
    }
    const { data, error } = await q
      .order("opened_at", { ascending: false })
      .limit(1);
    if (error) {
      return {
        kind: "unreadable",
        message: `the newest check could not be read: ${error.message}`,
      };
    }
    const row = (
      (data ?? []) as Array<{ source: string; opened_at: string }>
    )[0];
    if (!row) return { kind: "never" };
    const at = new Date(row.opened_at);
    if (!Number.isFinite(at.getTime())) {
      return {
        kind: "unreadable",
        message: `the newest check's time could not be read (${JSON.stringify(row.opened_at)})`,
      };
    }
    return { kind: "last", source: row.source, at };
  }

  /**
   * Owners and managers of the audience it is handed, through the one live
   * role reader (houseMembersInRoles). A failed read keeps the audience it was
   * handed, as MailGrantAbsentProducer does, rather than telling nobody.
   */
  private async managerAudience(
    restaurantId: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerAudience> {
    let members: string[];
    try {
      members = await houseMembersInRoles(
        this.databaseService.getClient(),
        restaurantId,
        OWNER_AND_MANAGER,
        now.getTime(),
      );
    } catch (err) {
      this.logger.error(
        `TILL_QUIET_AUDIENCE_UNREADABLE restaurant=${restaurantId} — ${err instanceof Error ? err.message : String(err)}. ` +
          "Falling back to the full ready/deferred split rather than silently telling nobody.",
      );
      return audience;
    }
    const ids = new Set(members);
    return {
      ready: audience.ready.filter((id) => ids.has(id)),
      deferred: audience.deferred.filter((id) => ids.has(id)),
    };
  }
}
