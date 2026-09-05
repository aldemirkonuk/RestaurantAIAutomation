/**
 * The nightly re-judge of `is_outlier` — the half that touches the database.
 *
 * All the judgement is in `outlier-rejudge.ts` and is tested without a
 * database. This class does three things the pure module cannot: read the
 * window, write each group's verdicts INDEPENDENTLY so one product's failure
 * never stops another's, and remember what the last run did so the status
 * route can say why the register is quiet.
 *
 * OFF BY DEFAULT, on purpose. `PRICE_OUTLIER_REJUDGE_ENABLED` is unset in
 * every environment until someone sets it. This job is the only thing in the
 * gateway that rewrites a verdict already stored on rows the notifications
 * market box reads, and it does so unattended at night. A switch that must be
 * thrown deliberately is the difference between "we turned this on" and "it
 * has apparently been running since the deploy" — and the second is exactly
 * the shape of failure this register keeps meeting. The disarmed state is
 * REPORTED, never silent: `status()` says the flag is unset and the run
 * summary is null, so nobody can read the absence of flips as agreement.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import {
  GroupSilenceReason,
  REJUDGE_CRON,
  REJUDGE_ENABLED_FLAG,
  REJUDGE_JOB_NAME,
  REJUDGE_WINDOW_DAYS,
  RejudgeRow,
  RejudgeRunSummary,
  emptySilenceCounts,
  isRejudgeArmed,
  planRejudge,
} from "./outlier-rejudge";

/** The columns the plan needs, and nothing else. */
const REJUDGE_SELECT =
  "id, restaurant_id, master_wine_id, signature_hash, source_type, observed_at, " +
  "raw_price, currency, pack_size, unit_volume_ml, yield_factor, is_outlier, outlier_basis";

/**
 * How many rows one run will read.
 *
 * Matched to `belowTrailingAverage`'s own `.limit(2000)` so the pass cannot
 * judge over a set the reader would never see. When a run comes back holding
 * exactly this many rows the window is larger than the pass can see, and that
 * is SAID in the summary rather than left to be inferred from a round number.
 */
const REJUDGE_ROW_LIMIT = 2000;

@Injectable()
export class OutlierRejudgeService {
  private readonly logger = new Logger(OutlierRejudgeService.name);

  /** Null until a run happens in this process. A restart clears it. */
  private lastRun: RejudgeRunSummary | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  armed(): boolean {
    return isRejudgeArmed(this.config.get<string>(REJUDGE_ENABLED_FLAG));
  }

  @Cron(REJUDGE_CRON, { name: REJUDGE_JOB_NAME })
  async scheduled(): Promise<void> {
    if (!this.armed()) {
      // Debug, not warn: disarmed is the intended state, and a nightly warning
      // trains people to ignore warnings.
      this.logger.debug(
        `${REJUDGE_JOB_NAME} skipped: ${REJUDGE_ENABLED_FLAG} is not set.`,
      );
      return;
    }
    try {
      await this.rejudge({});
    } catch (err: any) {
      this.logger.error(
        `${REJUDGE_JOB_NAME} failed: ${err?.message ?? "unknown"}`,
      );
    }
  }

  /**
   * Run the pass.
   *
   * `dryRun` plans and counts without writing — the same summary, with
   * `dryRun: true` on it, so a reader can never mistake a rehearsal for a run.
   */
  async rejudge(opts: {
    windowDays?: number;
    dryRun?: boolean;
  }): Promise<RejudgeRunSummary> {
    const startedAt = new Date().toISOString();
    const windowDays = opts.windowDays ?? REJUDGE_WINDOW_DAYS;
    const dryRun = opts.dryRun ?? false;
    const now = new Date();
    const from = new Date(
      now.getTime() - windowDays * 86_400_000,
    ).toISOString();

    const { data, error } = await this.databaseService.supabase
      .from("vendor_price_observations")
      .select(REJUDGE_SELECT)
      .gte("observed_at", from)
      .order("observed_at", { ascending: true })
      .limit(REJUDGE_ROW_LIMIT);

    if (error) {
      // A window we could not read is not a window with nothing wrong in it.
      // Throwing leaves every stored verdict exactly as it was.
      throw new Error(`Could not read the price register: ${error.message}`);
    }

    // `as unknown as` because the generated PostgREST types cannot narrow a
    // string-built select list; the shape is asserted by REJUDGE_SELECT above.
    const rows = (data ?? []) as unknown as RejudgeRow[];
    const plan = planRejudge(rows, now, { windowDays });

    const groupsSilent = emptySilenceCounts();
    for (const g of plan.groups) {
      if (g.silence) groupsSilent[g.silence.reason as GroupSilenceReason] += 1;
    }

    let rowsJudged = 0;
    let flippedToOutlier = 0;
    let flippedToClean = 0;
    let groupsFailed = 0;
    const failures: Array<{ key: string; message: string }> = [];

    for (const group of plan.groups) {
      if (!group.judged || !group.updates.length) continue;
      try {
        if (!dryRun) {
          for (const u of group.updates) {
            const { error: upErr } = await this.databaseService.supabase
              .from("vendor_price_observations")
              .update({
                is_outlier: u.isOutlier,
                outlier_reason: u.reason,
                outlier_basis: u.basis,
                outlier_judged_at: u.judgedAt,
              })
              .eq("id", u.id);
            if (upErr) throw new Error(upErr.message);
          }
        }
        rowsJudged += group.updates.length;
        for (const u of group.updates) {
          if (!u.flipped) continue;
          if (u.isOutlier) flippedToOutlier += 1;
          else flippedToClean += 1;
        }
      } catch (err: any) {
        // Per group, deliberately. One product whose write fails must not stop
        // the other products from being judged tonight.
        groupsFailed += 1;
        failures.push({
          key: group.key,
          message: err?.message ?? "unknown error",
        });
        this.logger.warn(
          `${REJUDGE_JOB_NAME}: group ${group.key} was not written (${err?.message}). Every other group continues; those rows keep the verdict they already had.`,
        );
      }
    }

    const summary: RejudgeRunSummary = {
      startedAt,
      finishedAt: new Date().toISOString(),
      windowDays,
      windowFrom: plan.windowFrom,
      rowsRead: rows.length,
      groupsSeen: plan.groups.length,
      groupsJudged: plan.groups.filter((g) => g.judged).length,
      rowsJudged,
      flippedToOutlier,
      flippedToClean,
      groupsSilent,
      noProductKey: plan.noProductKey,
      groupsFailed,
      failures,
      dryRun,
    };
    this.lastRun = summary;

    this.logger.log(
      `${REJUDGE_JOB_NAME}${dryRun ? " (dry run)" : ""}: read ${summary.rowsRead} rows in the last ${windowDays} days, judged ${summary.groupsJudged} of ${summary.groupsSeen} groups, ${summary.rowsJudged} rows re-judged, ${summary.flippedToOutlier} newly flagged, ${summary.flippedToClean} cleared, ${summary.groupsFailed} groups failed.`,
    );
    return summary;
  }

  /**
   * What the pass has done, and why it has been quiet if it has.
   *
   * `armed` and `lastRun` are reported separately because they are different
   * silences: a disarmed job has not decided anything, and an armed job that
   * has not run yet in this process has not either. Neither is "the register
   * is clean".
   */
  status(): {
    armed: boolean;
    flag: string;
    cron: string;
    windowDays: number;
    rowLimit: number;
    lastRun: RejudgeRunSummary | null;
    inMemoryOnly: true;
    sentence: string;
  } {
    const armed = this.armed();
    const sentence = !armed
      ? `The nightly re-judge is switched off (${REJUDGE_ENABLED_FLAG} is not set). No stored outlier verdict has been revisited, so every flag on the register is the one its writer set when the row landed.`
      : this.lastRun === null
        ? `The nightly re-judge is on and has not run yet in this process (it runs on "${REJUDGE_CRON}", and a restart clears this record). Nothing is claimed about the register either way.`
        : this.lastRun.dryRun
          ? `The last pass was a DRY RUN at ${this.lastRun.finishedAt}: it planned ${this.lastRun.rowsJudged} verdicts and wrote none.`
          : `Last pass finished ${this.lastRun.finishedAt}: ${this.lastRun.rowsJudged} rows re-judged over the last ${this.lastRun.windowDays} days, ${this.lastRun.flippedToOutlier} newly flagged, ${this.lastRun.flippedToClean} cleared, ${this.lastRun.groupsFailed} groups not written.`;

    return {
      armed,
      flag: REJUDGE_ENABLED_FLAG,
      cron: REJUDGE_CRON,
      windowDays: REJUDGE_WINDOW_DAYS,
      rowLimit: REJUDGE_ROW_LIMIT,
      lastRun: this.lastRun,
      inMemoryOnly: true,
      sentence,
    };
  }
}
