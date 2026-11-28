/**
 * "A letter that has waited too long brings the manager to it" (r110 mail-gap g4).
 *
 * WHAT "WAITING" IS: THE LIST'S OWN RULE, NOT A SECOND ONE
 * --------------------------------------------------------
 * Who is waiting comes from `list_mail_people(p_waiting_only)`, the call
 * Mail's list makes (`mail.service.ts` listPeople). How long each of their
 * threads has waited comes from `mail_thread_states`, the function that list
 * is built from (`list_mail_vendors` aggregates it). "No reply needed" marks
 * and "Not now" (DD-r109-13, which lands in `mail_thread_states`) are
 * therefore inherited, and nothing here decides what waiting means. Read as
 * an owner or a manager reads Mail (`p_withhold_house_letters` false).
 *
 * WHEN: a thread whose letter has waited at least 24 hours (a stated default,
 * `MAIL_WAITING_AFTER_MS`), at most once per thread per house day: the dedupe
 * key carries the house date. Between 23:00 and 07:00 house time nothing goes
 * out; everyone is handed to the ledger as deferred, so a later sweep says it.
 * A house with no time zone has no quiet hours and dates its day in UTC, and
 * its metadata says so.
 *
 * WHO: owners and managers only. If who they are cannot be read, nobody is
 * told: staff are never told by a fallback.
 *
 * WHAT: the person's name and the wait. No letter text.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { houseToday, readHouseZone } from "../../common/house-day";
import { wallMinutesIn } from "../../calendar/reminder-window";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";

const PRODUCER = "mail_waiting";
const AUDIENCE_ROLES = ["owner", "manager"];
/** A stated default, not derived: one working day. */
export const MAIL_WAITING_AFTER_MS = 24 * 3_600_000;
/** 23:00 to 07:00 on the house's clock, as minutes of the day. */
export const MAIL_QUIET_FROM = 23 * 60;
export const MAIL_QUIET_UNTIL = 7 * 60;
/** The waiting people one sweep reads; more marks the run truncated. */
export const MAIL_WAITING_PEOPLE_CAP = 50;

export const NO_ZONE_NOTE =
  "This house has no time zone, so it has no quiet hours and its day is counted in UTC.";

export interface WaitingThread {
  personKey: string;
  name: string | null;
  threadKey: string;
  waitingSince: string;
}

/** Whether `now` is inside 23:00–07:00 on the house's clock. No zone, no quiet hours. */
export function inHouseQuiet(now: Date, zone: string | null): boolean {
  if (!zone) return false;
  const m = wallMinutesIn(now, zone);
  return m >= MAIL_QUIET_FROM || m < MAIL_QUIET_UNTIL;
}

/** "26 hours", then "3 days" from two days on. */
export function waitWords(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

@Injectable()
export class MailWaitingProducer {
  private readonly logger = new Logger(MailWaitingProducer.name);

  static readonly PRODUCER = PRODUCER;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    _timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const client = this.databaseService.getClient();

    let zone: string | null;
    let waiting: WaitingThread[];
    try {
      zone = (await readHouseZone(client, restaurantId)).zone;
      waiting = await this.waitingThreads(restaurantId, now, tally);
    } catch (err) {
      tally.failed += 1;
      this.logger.error(
        `MAIL_WAITING_UNREADABLE restaurant=${restaurantId} — ${err instanceof Error ? err.message : String(err)}`,
      );
      return tally;
    }

    if (waiting.length === 0) {
      tally.withheldReason = "No letter has waited 24 hours for an answer from this house.";
      return tally;
    }

    const managers = await this.managerAudience(restaurantId, audience);
    if (managers === null) {
      tally.failed += 1;
      return tally;
    }
    if (managers.ready.length === 0 && managers.deferred.length === 0) {
      tally.withheldReason = "No owner or manager is a member of this house, so nobody is told.";
      return tally;
    }

    // Quiet hours are the house's: everyone waits for 07:00, through the ledger.
    const heard = inHouseQuiet(now, zone)
      ? { ready: [], deferred: [...managers.ready, ...managers.deferred] }
      : managers;
    const day = zone ? houseToday(zone, now) : now.toISOString().slice(0, 10);

    for (const w of waiting) {
      const waitedMs = now.getTime() - Date.parse(w.waitingSince);
      const who = w.name?.trim() || "A vendor";
      const wait = waitWords(waitedMs);
      const url =
        `/communications?tab=mail&with=${encodeURIComponent(w.personKey)}` +
        `&thread=${encodeURIComponent(w.threadKey)}`;
      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience: heard, tally, now },
        {
          dedupeKey: `mail-waiting:${restaurantId}:${w.threadKey}:${day}`,
          occurredAt: new Date(w.waitingSince),
          payload: {
            type: "mail_waiting",
            title: `${who} has waited ${wait} for an answer`,
            message: `${who}'s letter has waited ${wait} for an answer from the house.`,
            priority: "medium",
            actionUrl: url,
            actionLabel: "Open the letter",
            metadata: {
              restaurantId,
              personKey: w.personKey,
              threadKey: w.threadKey,
              waitingSince: w.waitingSince,
              waitedHours: Math.floor(waitedMs / 3_600_000),
              houseDate: day,
              houseZone: zone,
              quietHours: zone ? "23:00-07:00" : null,
              ...(zone ? {} : { noZone: NO_ZONE_NOTE }),
            },
          },
        },
      );
    }
    return tally;
  }

  /** The threads waiting at least 24 h, by the list's own rule. A read error throws. */
  async waitingThreads(restaurantId: string, now: Date, tally: ProducerTally): Promise<WaitingThread[]> {
    const client = this.databaseService.getClient();
    const cutoff = now.getTime() - MAIL_WAITING_AFTER_MS;
    const people = await client.rpc("list_mail_people", {
      p_restaurant_id: restaurantId,
      p_withhold_house_letters: false,
      p_waiting_only: true,
      p_limit: MAIL_WAITING_PEOPLE_CAP + 1,
    });
    if (people.error) throw new Error(`the waiting people could not be read (${people.error.message})`);
    const rows = (people.data ?? []) as Record<string, any>[];
    if (rows.length > MAIL_WAITING_PEOPLE_CAP) tally.truncated = true;

    const out: WaitingThread[] = [];
    for (const p of rows.slice(0, MAIL_WAITING_PEOPLE_CAP)) {
      const since = p.waiting_since ? Date.parse(p.waiting_since) : NaN;
      if (p.waiting !== true || !p.provider_id || !(since <= cutoff)) continue;
      const states = await client.rpc("mail_thread_states", {
        p_restaurant_id: restaurantId,
        p_withhold_house_letters: false,
        p_provider_id: p.provider_id,
      });
      if (states.error) throw new Error(`the threads of ${p.key} could not be read (${states.error.message})`);
      for (const t of (states.data ?? []) as Record<string, any>[]) {
        const at = t.waiting_since ? Date.parse(t.waiting_since) : NaN;
        if (t.waiting !== true || !t.thread_key || t.provider_id !== p.provider_id || !(at <= cutoff)) continue;
        out.push({ personKey: String(p.key), name: p.name ?? null, threadKey: String(t.thread_key), waitingSince: t.waiting_since });
      }
    }
    return out;
  }

  /** Owners and managers of this house, from the audience it was handed. null when unreadable. */
  private async managerAudience(restaurantId: string, audience: ProducerAudience): Promise<ProducerAudience | null> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", AUDIENCE_ROLES);
    if (error) {
      this.logger.error(
        `MAIL_WAITING_AUDIENCE_UNREADABLE restaurant=${restaurantId} — ${error.message}. Nobody is told rather than everybody.`,
      );
      return null;
    }
    const ids = new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
    return { ready: audience.ready.filter((id) => ids.has(id)), deferred: audience.deferred.filter((id) => ids.has(id)) };
  }
}
