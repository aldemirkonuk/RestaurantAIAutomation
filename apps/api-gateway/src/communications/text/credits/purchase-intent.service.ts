/**
 * The intent row: what a house MEANT to buy, written before the provider is
 * asked (ADR 0121 addendum; founder, 2026-09-05: *"Close it now with the intent
 * row"*).
 *
 * WHAT IT REPLACES
 * ----------------
 * The purchase route used to charge and then write the credit, with nothing on
 * disk in between. A crash there meant money had moved and no row in this
 * database knew it, and the route said so — `charged: true, recorded: false` —
 * which is a report of a hole rather than a mechanism for closing one.
 *
 * THE ORDER, AND WHY EACH STEP IS WHERE IT IS
 * -------------------------------------------
 *   `open()`          writes `intended`. Nothing has been sent. A crash here
 *                     leaves a row that a reconcile can prove innocent.
 *   `markAttempting()` moves it to `charge_may_exist` BEFORE the provider call.
 *                     After the call would be useless: the state has to be able
 *                     to describe a crash DURING the call, and a write that
 *                     happens after the crash never happens.
 *   `settle()`        records the PaymentIntent and the credit entry together.
 *   `void()`          only from proof, never from a timeout.
 *
 * FOUR OUTCOMES ON EVERY READ. `null` is never used for two different facts:
 * a row that is absent and a row that could not be read are different, and the
 * second one must not be answered with "no purchase was intended".
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";

/** Columns read here, as module-level literals for check_read_columns_exist.py. */
const INTENT_COLUMNS =
  "id, restaurant_id, seal_id, amount_minor, currency, state, intended_by, " +
  "intended_at, charge_attempted_at, payment_ref, credit_entry_id, settled_at, " +
  "voided_at, void_reason, reconciled_at, reconcile_detail";

export type PurchaseIntentState =
  | "intended"
  | "charge_may_exist"
  | "settled"
  | "voided";

export interface PurchaseIntentRow {
  id: string;
  restaurantId: string;
  sealId: string;
  amountMinor: number;
  currency: string;
  state: PurchaseIntentState;
  intendedBy: string | null;
  intendedAt: string;
  chargeAttemptedAt: string | null;
  paymentRef: string | null;
  creditEntryId: string | null;
  settledAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reconciledAt: string | null;
  reconcileDetail: string | null;
}

@Injectable()
export class PurchaseIntentService {
  private readonly logger = new Logger(PurchaseIntentService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb() {
    return this.db.client;
  }

  private shape(row: Record<string, unknown>): PurchaseIntentRow {
    return {
      id: String(row.id),
      restaurantId: String(row.restaurant_id),
      sealId: String(row.seal_id),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      state: row.state as PurchaseIntentState,
      intendedBy: (row.intended_by as string | null) ?? null,
      intendedAt: String(row.intended_at),
      chargeAttemptedAt: (row.charge_attempted_at as string | null) ?? null,
      paymentRef: (row.payment_ref as string | null) ?? null,
      creditEntryId: (row.credit_entry_id as string | null) ?? null,
      settledAt: (row.settled_at as string | null) ?? null,
      voidedAt: (row.voided_at as string | null) ?? null,
      voidReason: (row.void_reason as string | null) ?? null,
      reconciledAt: (row.reconciled_at as string | null) ?? null,
      reconcileDetail: (row.reconcile_detail as string | null) ?? null,
    };
  }

  /**
   * Write the intent. THE FIRST THING THAT HAPPENS after the seal is redeemed.
   *
   * `existing` rather than an error when the seal already has one: the seal is
   * single-use so this is only reachable from a reconcile or a replay, and both
   * want the row rather than an exception.
   */
  async open(params: {
    restaurantId: string;
    sealId: string;
    amountMinor: number;
    currency: string;
    intendedBy: string;
  }): Promise<
    | { state: "opened" | "existing"; intent: PurchaseIntentRow }
    | { state: "failed"; intent: null; reason: string }
  > {
    const already = await this.forSeal(params.restaurantId, params.sealId);
    if (!already.readable) {
      return {
        state: "failed",
        intent: null,
        reason: `the purchase intents could not be read (${already.reason}), so nothing was attempted`,
      };
    }
    if (already.intent) {
      return { state: "existing", intent: already.intent };
    }

    const { data, error } = await this.sb
      .from("house_message_purchase_intents")
      .insert({
        restaurant_id: params.restaurantId,
        seal_id: params.sealId,
        amount_minor: params.amountMinor,
        currency: params.currency,
        // Explicit, never a default: the migration asserts the column has none.
        state: "intended",
        intended_by: params.intendedBy,
        charge_attempted_at: null,
        payment_ref: null,
        credit_entry_id: null,
        settled_at: null,
        voided_at: null,
        void_reason: null,
        reconciled_at: null,
        reconcile_detail: null,
      })
      .select(INTENT_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`purchase intent insert failed: ${error?.message}`);
      return {
        state: "failed",
        intent: null,
        reason: error?.message ?? "no row came back",
      };
    }
    return {
      state: "opened",
      intent: this.shape(data as unknown as Record<string, unknown>),
    };
  }

  /**
   * Say, on disk, that a charge may now exist — BEFORE asking the provider.
   *
   * If this write fails the caller must NOT charge. That is the whole contract:
   * the only way to reach the provider is through a row that already admits the
   * provider may have been reached.
   */
  async markAttempting(
    intentId: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    const { data, error } = await this.sb
      .from("house_message_purchase_intents")
      .update({
        state: "charge_may_exist",
        charge_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", intentId)
      .in("state", ["intended", "charge_may_exist"])
      .select("id")
      .maybeSingle();

    if (error) {
      this.logger.error(
        `purchase intent markAttempting failed: ${error.message}`,
      );
      return { ok: false, reason: error.message };
    }
    if (!data) {
      // Already settled or voided. Unambiguous on purpose: the filter carries
      // both conditions, so no match means the row has moved past the point
      // where a charge would be sane.
      return {
        ok: false,
        reason:
          "this purchase has already been settled or voided, so it will not be charged again",
      };
    }
    return { ok: true, reason: null };
  }

  /** The charge landed. Record the payment and the credit it produced, together. */
  async settle(params: {
    intentId: string;
    paymentRef: string;
    creditEntryId: string;
    detail: string;
  }): Promise<{ ok: boolean; reason: string | null }> {
    const now = new Date().toISOString();
    const { data, error } = await this.sb
      .from("house_message_purchase_intents")
      .update({
        state: "settled",
        payment_ref: params.paymentRef,
        credit_entry_id: params.creditEntryId,
        settled_at: now,
        reconciled_at: now,
        reconcile_detail: params.detail,
        updated_at: now,
      })
      .eq("id", params.intentId)
      .neq("state", "voided")
      .select("id")
      .maybeSingle();

    if (error) {
      this.logger.error(`purchase intent settle failed: ${error.message}`);
      return { ok: false, reason: error.message };
    }
    if (!data) {
      return {
        ok: false,
        reason: "this purchase was voided, so it cannot be settled",
      };
    }
    return { ok: true, reason: null };
  }

  /**
   * No charge will land. ONLY FROM PROOF.
   *
   * `reason` is required and the database refuses one shorter than ten
   * characters, because voiding is the operation that throws away the claim
   * that money might have moved. A timeout is not a proof and must never reach
   * here — see `PurchaseIntentReconciler`, which refuses to void a row younger
   * than the provider's own search lag.
   */
  async void(params: {
    intentId: string;
    reason: string;
  }): Promise<{ ok: boolean; reason: string | null }> {
    const now = new Date().toISOString();
    const { data, error } = await this.sb
      .from("house_message_purchase_intents")
      .update({
        state: "voided",
        voided_at: now,
        void_reason: params.reason,
        reconciled_at: now,
        reconcile_detail: params.reason,
        updated_at: now,
      })
      .eq("id", params.intentId)
      .neq("state", "settled")
      .select("id")
      .maybeSingle();

    if (error) {
      this.logger.error(`purchase intent void failed: ${error.message}`);
      return { ok: false, reason: error.message };
    }
    if (!data) {
      return {
        ok: false,
        reason: "this purchase was already settled, so it cannot be voided",
      };
    }
    return { ok: true, reason: null };
  }

  /**
   * A reconcile ran and changed nothing. RECORDED ANYWAY.
   *
   * A reconcile that leaves no trace when it finds nothing to do is
   * indistinguishable from one that never ran, and the difference matters
   * exactly when somebody is asking why a charge is still unresolved.
   */
  async noteReconciled(
    intentId: string,
    detail: string,
  ): Promise<{ ok: boolean }> {
    const now = new Date().toISOString();
    const { error } = await this.sb
      .from("house_message_purchase_intents")
      .update({
        reconciled_at: now,
        reconcile_detail: detail,
        updated_at: now,
      })
      .eq("id", intentId);
    if (error) {
      this.logger.error(
        `purchase intent noteReconciled failed: ${error.message}`,
      );
      return { ok: false };
    }
    return { ok: true };
  }

  /** This seal's intent, or the reason it could not be read. */
  async forSeal(
    restaurantId: string,
    sealId: string,
  ): Promise<{
    readable: boolean;
    intent: PurchaseIntentRow | null;
    reason: string | null;
  }> {
    const { data, error } = await this.sb
      .from("house_message_purchase_intents")
      .select(INTENT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("seal_id", sealId)
      .maybeSingle();

    if (error) {
      this.logger.error(`purchase intent read failed: ${error.message}`);
      return { readable: false, intent: null, reason: error.message };
    }
    const row = (data as Record<string, unknown> | null) ?? null;
    return {
      readable: true,
      intent: row ? this.shape(row) : null,
      reason: null,
    };
  }

  /**
   * Every intent that has not resolved, oldest first.
   *
   * `null` means the READ FAILED. An empty array means there is nothing open,
   * and a reconcile must be able to tell those apart before it reports "all
   * clear".
   */
  async open_intents(
    restaurantId?: string,
    limit = 200,
  ): Promise<{ rows: PurchaseIntentRow[] | null; reason: string | null }> {
    let query = this.sb
      .from("house_message_purchase_intents")
      .select(INTENT_COLUMNS)
      .in("state", ["intended", "charge_may_exist"])
      .order("intended_at", { ascending: true })
      .limit(limit);

    if (restaurantId) query = query.eq("restaurant_id", restaurantId);

    const { data, error } = await query;
    if (error) {
      this.logger.error(`open purchase intents read failed: ${error.message}`);
      return { rows: null, reason: error.message };
    }
    return {
      rows: (data ?? []).map((r) =>
        this.shape(r as unknown as Record<string, unknown>),
      ),
      reason: null,
    };
  }
}
