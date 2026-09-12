/**
 * Resolve every purchase intent that did not finish, by asking the provider
 * what actually happened (ADR 0121 addendum; founder, 2026-09-05: *"Close it
 * now with the intent row"*).
 *
 * THE ONE QUESTION IT ANSWERS
 * ---------------------------
 * An intent sitting in `charge_may_exist` means: we asked Stripe, and we do not
 * know whether money moved. The only handle on the answer is the seal id, which
 * `chargeCardOnFile` stamps into the PaymentIntent's metadata. So the reconcile
 * searches by that, and does one of three things:
 *
 *   a succeeded intent found   -> settle: write the credit if it is not already
 *                                 there, then mark the row settled.
 *   an intent found, not       -> void, quoting the provider's own status. The
 *   succeeded                     money did not move and will not.
 *   nothing found              -> depends on AGE. See below.
 *
 * WHY AGE DECIDES THE THIRD CASE, AND WHY THAT IS NOT A TIMEOUT
 * -------------------------------------------------------------
 * Stripe's search index is EVENTUALLY CONSISTENT — its own documentation puts
 * it up to a minute behind. So an empty search is not evidence of absence for a
 * charge attempted seconds ago. Voiding on that would destroy the record of a
 * real charge, which is the single worst outcome this mechanism exists to
 * prevent, and it would do it silently.
 *
 * So a row younger than `SEARCH_LAG_FLOOR_MS` is LEFT OPEN and reported as
 * `too_young_to_judge`. That is not a timeout deciding an outcome; it is a
 * refusal to decide on evidence that cannot yet be trusted. The row is marked
 * as reconciled-with-no-change so the attempt is on the record.
 *
 * IDEMPOTENT, BY CONSTRUCTION AND NOT BY CONVENTION
 * -------------------------------------------------
 * Running it twice is the normal case, not an edge one. A settled row is not in
 * the open set. Writing the credit is protected by
 * `uq_house_message_credits_purchase_seal`, so a second write for the same seal
 * is refused by the database; the reconcile reads the existing entry and settles
 * against it rather than treating the refusal as a failure.
 */

import { Injectable, Logger } from "@nestjs/common";
import { BillingService } from "../../../billing/billing.service";
import { TextUsageService } from "../text-usage.service";
import {
  PurchaseIntentService,
  type PurchaseIntentRow,
} from "./purchase-intent.service";

/**
 * How long an intent must have been waiting before an empty provider search is
 * allowed to mean "no charge exists".
 *
 * Five minutes against a documented index lag of about a minute. The margin is
 * deliberate and one-sided: waiting too long costs a delayed reconcile, and
 * waiting too little costs the record of a real charge.
 */
export const SEARCH_LAG_FLOOR_MS = 5 * 60 * 1000;

export type ReconcileOutcome =
  | "settled"
  | "voided"
  | "already_settled"
  | "too_young_to_judge"
  | "read_failed";

export interface ReconcileResult {
  intentId: string;
  sealId: string;
  restaurantId: string;
  outcome: ReconcileOutcome;
  paymentIntentId: string | null;
  words: string;
}

export interface ReconcileRun {
  /** `null` means the OPEN SET could not be read — never "there was nothing". */
  considered: number | null;
  results: ReconcileResult[];
  /** The sentence a person reads when the run could not do its job. */
  reason: string | null;
}

@Injectable()
export class PurchaseIntentReconciler {
  private readonly logger = new Logger(PurchaseIntentReconciler.name);

  constructor(
    private readonly intents: PurchaseIntentService,
    private readonly usage: TextUsageService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Reconcile every open intent, or one house's.
   *
   * `considered: null` is a first-class answer: a run that could not read the
   * open set must not report "0 considered, 0 resolved", which is exactly what
   * a clean run looks like.
   */
  async run(
    params: {
      restaurantId?: string;
      now?: Date;
    } = {},
  ): Promise<ReconcileRun> {
    const open = await this.intents.open_intents(params.restaurantId);
    if (open.rows === null) {
      return {
        considered: null,
        results: [],
        reason: `The open purchase intents could not be read (${open.reason}), so nothing was reconciled. That is not the same as there being none.`,
      };
    }

    const results: ReconcileResult[] = [];
    for (const intent of open.rows) {
      results.push(await this.reconcileOne(intent, params.now ?? new Date()));
    }
    return { considered: open.rows.length, results, reason: null };
  }

  /** One intent, and every way it can end. */
  async reconcileOne(
    intent: PurchaseIntentRow,
    now: Date = new Date(),
  ): Promise<ReconcileResult> {
    const base = {
      intentId: intent.id,
      sealId: intent.sealId,
      restaurantId: intent.restaurantId,
    };

    // Already has a credit for this seal? Then a previous run got as far as the
    // ledger and no further. Settle against what is there rather than charging
    // or searching again.
    const existing = await this.usage.purchaseForSeal(
      intent.restaurantId,
      intent.sealId,
    );
    if (!existing.readable) {
      return {
        ...base,
        outcome: "read_failed",
        paymentIntentId: null,
        words:
          "This house's credit ledger could not be read, so this purchase was left exactly as it was. Nothing was voided and nothing was settled.",
      };
    }

    let found;
    try {
      found = await this.billing.findChargeForSeal(intent.sealId);
    } catch (error) {
      return {
        ...base,
        outcome: "read_failed",
        paymentIntentId: null,
        words: `The provider could not be asked about this purchase (${(error as Error).message}), so it was left exactly as it was. Nothing was voided.`,
      };
    }

    if (!found.readable) {
      return {
        ...base,
        outcome: "read_failed",
        paymentIntentId: null,
        words: `${found.words} This purchase was left exactly as it was: an unanswered provider is not proof that no charge exists.`,
      };
    }

    if (found.succeeded) {
      const entryId =
        existing.entryId ??
        (
          await this.usage.recordPurchase({
            restaurantId: intent.restaurantId,
            sealId: intent.sealId,
            amountMinor: intent.amountMinor,
            currency: intent.currency,
            recordedBy: intent.intendedBy ?? intent.restaurantId,
            paymentRef: found.paymentIntentId as string,
          })
        ).entryId;

      if (!entryId) {
        return {
          ...base,
          outcome: "read_failed",
          paymentIntentId: found.paymentIntentId,
          words: `The provider confirms this purchase was charged (${found.paymentIntentId}) and the credit could not be written, so the intent is still open and will be retried. Nothing was voided.`,
        };
      }

      const settled = await this.intents.settle({
        intentId: intent.id,
        paymentRef: found.paymentIntentId as string,
        creditEntryId: entryId,
        detail: `reconciled against the provider: ${found.paymentIntentId} succeeded`,
      });
      return {
        ...base,
        outcome: existing.entryId ? "already_settled" : "settled",
        paymentIntentId: found.paymentIntentId,
        words: settled.ok
          ? `Settled: the provider confirms ${found.paymentIntentId} succeeded, and this house's credit is on its meter.`
          : `The provider confirms ${found.paymentIntentId} succeeded and the intent could not be closed (${settled.reason}); the credit IS recorded, so no money is unaccounted for.`,
      };
    }

    if (found.paymentIntentId) {
      // A charge exists and did not succeed. Voiding is proof-backed here.
      const reason = `the provider's own status for ${found.paymentIntentId} is "${found.status ?? "unknown"}", so no money moved`;
      const voided = await this.intents.void({ intentId: intent.id, reason });
      return {
        ...base,
        outcome: "voided",
        paymentIntentId: found.paymentIntentId,
        words: voided.ok
          ? `Voided: ${reason}. Nothing was charged and no credit was added.`
          : `Could not close this intent (${voided.reason}), and ${reason}.`,
      };
    }

    // Nothing found. AGE DECIDES, and only in one direction.
    const attemptedAt = Date.parse(
      intent.chargeAttemptedAt ?? intent.intendedAt,
    );
    const age = now.getTime() - attemptedAt;
    if (!Number.isFinite(attemptedAt) || age < SEARCH_LAG_FLOOR_MS) {
      const words =
        "Left open: the provider's search index runs behind, so finding nothing this soon is not evidence that nothing was charged. It will be judged once it is old enough.";
      await this.intents.noteReconciled(intent.id, words);
      return {
        ...base,
        outcome: "too_young_to_judge",
        paymentIntentId: null,
        words,
      };
    }

    const reason = `the provider has no charge carrying this seal, ${Math.round(age / 60000)} minutes after it was asked`;
    const voided = await this.intents.void({ intentId: intent.id, reason });
    return {
      ...base,
      outcome: "voided",
      paymentIntentId: null,
      words: voided.ok
        ? `Voided: ${reason}. Nothing was charged and no credit was added.`
        : `Could not close this intent (${voided.reason}), and ${reason}.`,
    };
  }
}
