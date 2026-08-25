import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { NfEventRef } from "./model-client.service";

/**
 * A task-level doneability verdict (OD-59).
 *
 * `outcome: null` is a real and useful answer — it means the grader RAN and
 * found the case untestable, which is different from never having graded it
 * (no row at all). Both must stay distinguishable or verdict coverage becomes
 * unreadable.
 */
export interface NfVerdict {
  outcome: "success" | "failure" | "partial" | null;
  /** What the grader saw, so a disputed verdict is re-checkable without a re-run. */
  evidence?: Record<string, unknown>;
}

/**
 * NfVerdictService — writes task-level verdicts over neural_footprint_event.
 *
 * Why this is separate from the emitter: the emitter knows how the CALL went
 * (`call_level_v0` — HTTP 200, not truncated) at the moment the call returns.
 * Whether the agent did the JOB is only knowable after the output has been
 * parsed and checked, which is downstream of emission and sometimes downstream
 * of the request entirely. So a verdict is a second, later claim about an
 * existing row, never an edit to it.
 *
 * FAILURE POSTURE — identical to the emitter's, and for the same reason: the
 * instrument must never break the thing it measures. A verdict that cannot be
 * written is a warn and a drop counter, never an exception on the user path.
 * A missing verdict shows up honestly as uncovered in
 * `nf_a.doneability_verdict_coverage`; a thrown one would break an extraction.
 */
@Injectable()
export class NfVerdictService {
  private readonly logger = new Logger(NfVerdictService.name);

  /** Verdicts this process failed to write. Silent gaps must be countable. */
  private dropCount = 0;

  constructor(private readonly databaseService: DatabaseService) {}

  /** Verdict writes dropped since boot — exposed for health/debug surfaces. */
  get droppedVerdicts(): number {
    return this.dropCount;
  }

  /**
   * Grade an event once its id is known. Returns immediately; the write rides
   * the ref's promise, so a caller never waits on either the emit or the grade.
   *
   * `basis` names the grader IN THE ROW. That is what stops a narrow verdict
   * from quietly becoming the definition of "done" — the same job the
   * `call_level_v0` string does for the call-level reading.
   */
  record(ref: NfEventRef, basis: string, verdict: NfVerdict): void {
    void this.persist(ref, basis, verdict).catch((err: any) => {
      this.dropCount++;
      this.logger.warn(
        `nf_verdict write failed (${this.dropCount} dropped since boot): ${err?.message ?? err}`,
      );
    });
  }

  private async persist(
    ref: NfEventRef,
    basis: string,
    verdict: NfVerdict,
  ): Promise<void> {
    const eventId = await ref.id;
    // The emit was dropped, so there is no row to grade. Writing an orphan
    // verdict would inflate coverage with rows that grade nothing.
    if (!eventId) return;

    const { error } = await this.databaseService.supabase
      .from("nf_verdict")
      .upsert(
        {
          event_id: eventId,
          basis,
          outcome: verdict.outcome,
          evidence: verdict.evidence ?? {},
        },
        // Re-running the SAME grader must be idempotent. A genuinely different
        // grader takes a new basis string and lands as a second row instead,
        // so disagreement is preserved rather than overwritten.
        { onConflict: "event_id,basis" },
      );
    if (error) throw new Error(error.message);
  }
}
