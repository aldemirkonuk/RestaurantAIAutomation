import type {
  PaymentProviderState,
  StripeMode,
} from "../../payment-methods/dto/payment-method.dto";

/**
 * What `POST /billing/setup-intent` hands the browser.
 *
 * `clientSecret` is a single-use, customer-scoped token that authorises
 * Stripe.js to attach ONE instrument to ONE customer. It is not a secret key:
 * it cannot list, charge or read anything, which is why it is safe to return
 * to a browser and why the collection can happen on Stripe's origin.
 *
 * `mode` and `livemode` are both here on purpose. `mode` is what this
 * DEPLOYMENT thinks it is (from the key prefix); `livemode` is what STRIPE said
 * about this intent. The page prints Stripe's answer, so a mismatch surfaces as
 * a visible disagreement rather than as a confident wrong label.
 */
export interface SetupIntentResponse {
  setupIntentId: string;
  clientSecret: string;
  status: string;
  livemode: boolean;
  mode: StripeMode | null;
  apiVersion: string;
}

/**
 * Which check ran before this reconciliation, said out loud.
 *
 * `sealed-intent` — the caller named the SetupIntent it had just confirmed, the
 * provider was asked which seal that intent was minted against, and the seal was
 * proven redeemed by THIS person for THIS house's register.
 *
 * `reconcile-only` — no intent was named, so nothing was proven about a person.
 * This is the manager's refresh: it writes the provider's own current answer and
 * cannot attach, prefer or invent an instrument. It is in the response because a
 * reconciliation that skipped the seal check and reported the same shape as one
 * that passed it would be [[absence-reported-as-health]] at the money seam.
 */
export type SyncProvenance = "sealed-intent" | "reconcile-only";

/** What a reconciliation actually did — including when it did nothing. */
export interface SyncResponse {
  syncedAt: string;
  kept: number;
  removed: number;
  /** Words whenever the numbers alone would be ambiguous. */
  note: string | null;
  /** Which check ran. Never omitted, never inferred by the reader. */
  provenance: SyncProvenance;
}

export interface WebhookResponse {
  /** False when the signature did not verify — nothing was read or applied. */
  received: boolean;
  /** True only when this delivery CHANGED something here. */
  handled: boolean;
  duplicate?: boolean;
  /** Always present. An ignored event says why it was ignored. */
  reason: string;
  failure?: string;
}

/** `GET /billing/provider` — the same state the register carries, on its own. */
export type BillingProviderResponse = PaymentProviderState;
