/**
 * The two schedules that keep the retention rule honest (ADR 0118, retention).
 *
 * TWO CRONS AND NOT ONE. Deriving the figure and obeying it are different acts
 * at different cadences, and folding them together would make the sweep's
 * behaviour depend on when the derivation last succeeded without saying so.
 *
 *   DERIVE, quarterly. The founder's cadence. A dispute span barely moves week
 *   to week, and re-deriving daily would let one long-running claim lengthen
 *   every house's window on a Tuesday and shorten it again on the Thursday it
 *   settled — a retention rule that moves under a person's mail every day is
 *   not a rule they can be told about on a consent screen.
 *
 *   SWEEP, daily, half an hour after the derivation. A quarterly sweep would
 *   mean a person's mail could sit up to three months past its own window,
 *   which is the window not meaning anything.
 *
 * WHAT `lastRun()` IS FOR. It is NULL until the first tick, never a fabricated
 * "nothing to do" — the same shape `HouseInboxCron` uses, and for the same
 * reason: a surface that cannot tell "has not run" from "ran and found
 * nothing" reports absence as health.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  RETENTION_DERIVE_CRON,
  RETENTION_SWEEP_CRON,
  RawMailRetentionService,
  type DerivedWindow,
  type SweepRun,
} from "./raw-mail-retention.service";

export interface DeriveTick {
  at: string;
  houses: number;
  derived: DerivedWindow[];
  errors: Array<{ restaurantId: string; message: string }>;
  error: string | null;
}

export interface SweepTick {
  at: string;
  houses: number;
  deleted: number;
  runs: SweepRun[];
  error: string | null;
}

@Injectable()
export class RawMailRetentionCron {
  private readonly logger = new Logger(RawMailRetentionCron.name);
  private lastDerive: DeriveTick | null = null;
  private lastSweep: SweepTick | null = null;

  constructor(private readonly retention: RawMailRetentionService) {}

  lastDeriveRun(): DeriveTick | null {
    return this.lastDerive;
  }

  lastSweepRun(): SweepTick | null {
    return this.lastSweep;
  }

  @Cron(RETENTION_DERIVE_CRON, { name: "raw-mail-retention-derive" })
  async derive(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const result = await this.retention.deriveAll();
      this.lastDerive = { at, ...result, error: null };
      this.logger.log(
        `retention: window re-derived for ${result.derived.length} of ${result.houses} house${result.houses === 1 ? "" : "s"}${result.errors.length ? `, ${result.errors.length} failed` : ""}.`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.lastDerive = { at, houses: 0, derived: [], errors: [], error };
      this.logger.error(`retention: derivation failed — ${error}`);
    }
  }

  @Cron(RETENTION_SWEEP_CRON, { name: "raw-mail-retention-sweep" })
  async sweep(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const runs = await this.retention.sweepExpired();
      const deleted = runs.reduce((sum, r) => sum + r.deleted, 0);
      this.lastSweep = { at, houses: runs.length, deleted, runs, error: null };
      // Logged even at zero. A sweep that says nothing on the days it deletes
      // nothing leaves a log in which the sweep only ever deletes.
      this.logger.log(
        `retention: swept ${runs.length} house${runs.length === 1 ? "" : "s"}, ${deleted} repl${deleted === 1 ? "y" : "ies"} had their raw mail deleted.`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.lastSweep = { at, houses: 0, deleted: 0, runs: [], error };
      this.logger.error(`retention: sweep failed — ${error}`);
    }
  }
}
