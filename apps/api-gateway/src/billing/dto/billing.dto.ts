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

/** What a reconciliation actually did — including when it did nothing. */
export interface SyncResponse {
  syncedAt: string;
  kept: number;
  removed: number;
  /** Words whenever the numbers alone would be ambiguous. */
  note: string | null;
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
