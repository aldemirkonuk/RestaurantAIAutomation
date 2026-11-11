import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { OrchestratorService } from "./orchestrator.service";

/**
 * A letter is recorded before its door says yes (mail software, gap G2).
 *
 * The rule every inbound door follows:
 *   1. `record` the letter in `mail_intake` (one row per door and delivery);
 *   2. only when that write succeeded may the door move its cursor or answer
 *      its webhook with 2xx;
 *   3. publish the event (with `intake_id`) to wake the bridge. A failed
 *      publish is not a lost letter any more: the row stays `received` and the
 *      re-drive tick publishes it again.
 * The bridge then `settle`s the row with what became of the letter, or marks
 * it `failed`. Migration 20270705100000 records the table and its reasons.
 *
 * The session's call (2026-11-11, under the founder's 2026-11-07 /goal):
 * the durable record lives in Postgres, not in RabbitMQ. Rejected:
 *  - nack-and-requeue in the bridge only: a DB outage would loop the message
 *    until its 5-minute TTL dropped it, and the doors would still have said
 *    yes before anything was stored;
 *  - a dead-letter exchange: changing a durable queue's `x-` arguments fails
 *    `assertQueue` on every running broker (PRECONDITION_FAILED closes the
 *    channel), and a dead-letter queue is still invisible to the house.
 */
export type MailDoor = "shared_mailbox" | "house_mailbox" | "inbound_address";

/** What became of a letter the bridge read. */
export type IntakeOutcome =
  | "filed"
  | "held"
  | "prospect"
  | "duplicate"
  | "not_kept";

export interface RecordResult {
  id: string;
  /** False when an earlier delivery of the same letter is already recorded. */
  fresh: boolean;
  /** The row's status after recording. */
  status: string;
}

export interface HouseIntakeHealth {
  /** Letters recorded for this house in the last 7 days, by status. */
  byStatus: Record<string, number>;
  /** Letters still waiting for a home (received, failed or gave up). */
  waiting: number;
  /** The oldest of those, or null. */
  oldestWaitingAt: string | null;
  /** True when the read itself failed: the counts above are then unknown. */
  unknown: boolean;
}

const SETTLED = new Set([
  "filed",
  "held",
  "prospect",
  "duplicate",
  "not_kept",
]);

/** A stable key for a delivery the door has no id for. */
export function contentKey(parts: Array<string | null | undefined>): string {
  return (
    "sha256:" +
    createHash("sha256")
      .update(parts.map((p) => p ?? "").join("\u0000"))
      .digest("hex")
  );
}

@Injectable()
export class MailIntakeService {
  private readonly logger = new Logger(MailIntakeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /**
   * Record one delivery. Throws when the write fails: the caller must then
   * NOT say yes (no cursor move, no 2xx), so the letter is offered again.
   */
  async record(input: {
    door: MailDoor;
    providerKey: string;
    restaurantId: string | null;
    payload: Record<string, unknown>;
  }): Promise<RecordResult> {
    const key = String(input.providerKey || "").trim();
    if (!key) throw new Error("mail intake: a delivery needs a provider key");
    const db = this.database.supabase;
    const { data: inserted, error } = await db
      .from("mail_intake")
      .upsert(
        {
          door: input.door,
          provider_key: key,
          restaurant_id: input.restaurantId,
          payload: input.payload,
        },
        { onConflict: "door,provider_key", ignoreDuplicates: true },
      )
      .select("id, status");
    if (error) {
      throw new Error(`mail intake: could not record a letter (${error.message})`);
    }
    if (inserted && inserted.length) {
      return { id: inserted[0].id, fresh: true, status: inserted[0].status };
    }
    const { data: existing, error: readError } = await db
      .from("mail_intake")
      .select("id, status")
      .eq("door", input.door)
      .eq("provider_key", key)
      .maybeSingle();
    if (readError || !existing) {
      throw new Error(
        `mail intake: a repeat delivery could not be read back (${readError?.message ?? "no row"})`,
      );
    }
    return { id: existing.id, fresh: false, status: existing.status };
  }

  /**
   * Record, then publish. Returns once the letter is recorded; a failed
   * publish is logged and left to the re-drive tick. A repeat delivery of a
   * letter that already settled is not published again.
   */
  async recordAndPublish(input: {
    door: MailDoor;
    providerKey: string;
    restaurantId: string | null;
    event: Record<string, unknown>;
  }): Promise<RecordResult & { published: boolean }> {
    const recorded = await this.record({
      door: input.door,
      providerKey: input.providerKey,
      restaurantId: input.restaurantId,
      payload: input.event,
    });
    if (!recorded.fresh && SETTLED.has(recorded.status)) {
      return { ...recorded, published: false };
    }
    const published = await this.publish(recorded.id, 1, input.event);
    return { ...recorded, published };
  }

  /** What became of the letter. Clears the payload: the mail is kept once. */
  async settle(id: string, outcome: IntakeOutcome): Promise<void> {
    const { error } = await this.database.supabase
      .from("mail_intake")
      .update({
        status: outcome,
        payload: null,
        last_error: null,
        settled_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      // The letter itself is stored; only its intake row did not hear so.
      // The re-drive will publish it again and the bridge's duplicate check
      // settles it then.
      this.logger.warn(`mail intake ${id}: could not settle (${error.message})`);
    }
  }

  /** The bridge could not store the letter; the re-drive tries again. */
  async fail(id: string, reason: string): Promise<void> {
    const { error } = await this.database.supabase
      .from("mail_intake")
      .update({ status: "failed", last_error: reason.slice(0, 500) })
      .eq("id", id);
    if (error) {
      this.logger.error(
        `mail intake ${id}: could not record the failure (${error.message}); it stays 'received' and is tried again`,
      );
    }
  }

  /**
   * Publish every row that never settled. Every two minutes; a row is
   * claimed only after ten quiet minutes, so a slow bridge is not raced.
   */
  @Cron("*/2 * * * *", { name: "mail-intake-redrive" })
  async redrive(): Promise<{ claimed: number; published: number } | null> {
    const { data, error } = await this.database.supabase.rpc(
      "claim_mail_intake",
      { p_limit: 50, p_stale_seconds: 600, p_max_attempts: 6 },
    );
    if (error) {
      this.logger.error(`mail intake re-drive: could not claim rows (${error.message})`);
      return null;
    }
    const rows: Array<{ id: string; attempts: number; payload: any }> =
      Array.isArray(data) ? data : [];
    let published = 0;
    for (const row of rows) {
      if (!row.payload) continue;
      if (await this.publish(row.id, row.attempts, row.payload)) published++;
    }
    if (rows.length) {
      this.logger.log(
        `mail intake re-drive: ${published} of ${rows.length} unsettled letter${rows.length === 1 ? "" : "s"} published again`,
      );
    }
    return { claimed: rows.length, published };
  }

  /**
   * "Read again" for one house: its failed and given-up letters go back in
   * the queue now. Scoped to the house; nothing of another house moves.
   */
  async readAgain(restaurantId: string): Promise<number> {
    const { data, error } = await this.database.supabase
      .from("mail_intake")
      .update({
        status: "received",
        attempts: 0,
        last_error: null,
        settled_at: null,
        // Old enough that the next re-drive claims it at once.
        last_attempt_at: new Date(0).toISOString(),
      })
      .eq("restaurant_id", restaurantId)
      .in("status", ["failed", "gave_up"])
      .not("payload", "is", null)
      .select("id");
    if (error) {
      throw new Error(`mail intake: could not queue the house's letters again (${error.message})`);
    }
    return Array.isArray(data) ? data.length : 0;
  }

  /** The house's last 7 days at its doors. Unknown is said, never zero. */
  async houseHealth(restaurantId: string): Promise<HouseIntakeHealth> {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await this.database.supabase
      .from("mail_intake")
      .select("status, created_at")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(0, 4999);
    if (error || !Array.isArray(data)) {
      return { byStatus: {}, waiting: 0, oldestWaitingAt: null, unknown: true };
    }
    const byStatus: Record<string, number> = {};
    let waiting = 0;
    let oldestWaitingAt: string | null = null;
    for (const row of data) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (!SETTLED.has(row.status)) {
        waiting++;
        oldestWaitingAt = oldestWaitingAt ?? row.created_at;
      }
    }
    return { byStatus, waiting, oldestWaitingAt, unknown: false };
  }

  /**
   * A door's own record: when it last read, last stored a letter, and its
   * last error. Null when it has never read; `unknown` when the read failed.
   */
  async doorStatus(door: MailDoor): Promise<
    | {
        lastReadAt: string | null;
        lastStoredAt: string | null;
        lastError: string | null;
      }
    | { unknown: true }
    | null
  > {
    const { data, error } = await this.database.supabase
      .from("mail_door_cursors")
      .select("last_read_at, last_stored_at, last_error")
      .eq("door", door)
      .maybeSingle();
    if (error) return { unknown: true };
    if (!data) return null;
    return {
      lastReadAt: data.last_read_at ?? null,
      lastStoredAt: data.last_stored_at ?? null,
      lastError: data.last_error ?? null,
    };
  }

  private async publish(
    id: string,
    attempt: number,
    event: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.orchestrator.publishEvent(
        "email.events",
        "email.inbound.received",
        { ...event, intake_id: id, intake_attempt: attempt },
      );
      return true;
    } catch (err: any) {
      this.logger.warn(
        `mail intake ${id}: publish failed (${err?.message ?? err}); recorded, and the re-drive publishes it again`,
      );
      return false;
    }
  }
}
