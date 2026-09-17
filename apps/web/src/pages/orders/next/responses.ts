/**
 * A vendor's ANSWER to one order, and the sentence the house wrote about it.
 *
 * =============================================================================
 * WHERE THE ANSWERS ACTUALLY LIVE (measured 2026-09-05, not assumed)
 * =============================================================================
 * `public.procurement_conversations`, one row per message
 * (`20260805000000_baseline_from_production.sql:4293`). A vendor's answer is a
 * row whose `direction` is `inbound`; the body is `message_text` (the NOT NULL
 * column) with `content` as the newer one beside it. The route that serves them
 * is `GET /procurement/orders/:id/conversations`
 * (`procurement.controller.ts:755` -> `procurement.service.ts getOrderConversations`),
 * which uppercases `direction`, reads `content ?? message_text`, and carries
 * `rollingSummary` per row.
 *
 * THE NEGOTIATION SUMMARY IS `rolling_summary` (baseline `:4326`), and it is
 * WRITTEN BY ONE PLACE ONLY: the inbound responder's understand step
 * (`common/orchestrator/inbound-responder.service.ts:305-316`), which runs on
 * every inbound message and persists the model's own `summary` onto that same
 * inbound row — prefixed with `Heads up: …` when the analysis found special
 * conditions. Its provenance sits beside it in `conversation_context`
 * (`analyzed_at`, `model`), which is why this page can name who wrote the
 * sentence and when instead of implying the house did.
 *
 * =============================================================================
 * WHY THE SENTENCE IS COPIED AND NEVER RE-DERIVED
 * =============================================================================
 * The legacy `OrderApprovalModal` printed `conversationSummary` and, next to
 * it, `${orderData.finalPrice.toFixed(2)}/bottle` — a unit nothing had checked
 * (ADR 0119). A summary is EVIDENCE: it is what a model said about what a
 * vendor said. Recomputing any figure inside it, or assembling a summary out of
 * the numbers on the order, would produce a sentence no engine ever wrote and
 * attribute it to one. So `summary` here is the stored string, unchanged, or
 * `null` — and `null` renders as `NO_SUMMARY_WRITTEN`, never as blank space.
 * Blank space is the absence-reported-as-health shape: a manager reads an empty
 * panel as "nothing to worry about" rather than "nobody wrote this down".
 */

/**
 * The subset of `OrderConversationDto` this module reads.
 *
 * Declared structurally rather than imported so the pure half can be tested
 * against the payload the ROUTE sends — the same discipline `toRow` follows in
 * `useOrdersNextData`, and for the same reason: the defect that hides here is a
 * key name, and a fixture built from an imported interface cannot see one.
 */
export interface ConversationWire {
  id: string;
  direction?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  roundCount?: number | null;
  draftContent?: string | null;
  rollingSummary?: string | null;
  detectedIntent?: string | null;
  detectedSentiment?: string | null;
  specialConditions?: string[] | null;
  senderVerified?: boolean | null;
  providerName?: string | null;
  /** `conversation_context.model` — which engine read this answer. */
  summaryModel?: string | null;
  /** `conversation_context.analyzed_at` — when it read it. */
  summaryAnalyzedAt?: string | null;
}

export interface VendorResponse {
  /** The conversation row's own id — the provenance anchor for everything below. */
  id: string;
  vendorName: string | null;
  /** When the answer reached the house. `sentAt` first, `createdAt` behind it. */
  arrivedAt: string | null;
  /** Which round of the exchange this answer belongs to. Null when unrecorded. */
  round: number | null;
  /** The engine's own sentence, verbatim. Null when none was written. */
  summary: string | null;
  /** What the engine read it with, and when. Null when the row does not say. */
  summaryModel: string | null;
  summaryReadAt: string | null;
  intent: string | null;
  sentiment: string | null;
  specialConditions: string[];
  /**
   * The vendor said no to this order (ADR 0125 Q3).
   *
   * Derived from `intent` rather than stored, so the page marks exactly the rows
   * the gateway acted on. A decline does NOT close the order any more: it
   * returns it to NEGOTIATING, and the sheet has to say so or a manager reads a
   * live order with a refusal in it and no explanation of why it is still open.
   */
  declined: boolean;
  /** DKIM/DMARC verdict on the sender. Null is UNKNOWN, never "unverified". */
  senderVerified: boolean | null;
  /** The vendor's own words. Null when the row carried no body at all. */
  body: string | null;
}

/**
 * What the sheet prints where a summary would have been.
 *
 * Two facts, in this order: nobody wrote one, and the vendor's own words are
 * still here. The second half matters — without it the sentence reads as "there
 * is nothing to see", which is false on every row that has a body.
 */
export const NO_SUMMARY_WRITTEN =
  'No summary was written for this answer. The reading step writes one onto the ' +
  'answer it read, so an empty one means it did not run here — not that the ' +
  "answer said nothing. The vendor's own words are below, unchanged.";

/** Said when the per-order read failed. A failed read is never an empty one. */
export function responsesUnreadable(reason: string): string {
  return (
    `The vendor's answers to this order could not be read (${reason}), so this ` +
    'sheet does not know whether there are any. That is unknown, not empty.'
  );
}

/**
 * Said when the read SUCCEEDED and found nothing inbound.
 *
 * Distinct from the sentence above on purpose: one is a fact about the vendor,
 * the other is a fact about the network, and collapsing them is how a page
 * starts reporting its own silence as the vendor's.
 */
export const NO_ANSWER_YET =
  'No answer from the vendor is recorded against this order. Anything the house ' +
  'has sent is on the draft rail; nothing has come back.';

/** Uppercase, trimmed — the route sends `INBOUND`, the column stores `inbound`. */
function directionOf(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : '';
}

/** A non-empty string, or null. `''` and `'   '` are both "not written". */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function intOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Every inbound row, oldest first, as the sheet reads them.
 *
 * OLDEST FIRST because stepping through a negotiation forwards is reading it in
 * the order it happened; the legacy modal's Next/Previous had no defined order
 * at all (`allProviderResponses` was never populated from anything).
 *
 * The direction test is normalised rather than compared to the literal
 * `'INBOUND'` the route currently sends. If that route ever stopped
 * uppercasing, a strict comparison would return zero answers for every order
 * and the sheet would say "no answer from the vendor" about a full mailbox —
 * absence reported as health, through a string case.
 */
/**
 * The intents that mean the vendor said no — the SAME list the gateway acts on
 * (`inbound-responder.service.ts:125` `DECLINE_INTENTS`), restated here because
 * the web cannot import from the gateway and a second, drifting opinion about
 * what a decline is would mark different rows than the ones that moved the
 * order.
 *
 * THE PAIRING IS HELD BY A CLAIM, AND THAT CLAIM NOW EXISTS.
 * ---------------------------------------------------------
 * This comment used to say `check_decision_claims.sh` kept the two lists
 * honest. Nothing did: there was no row naming them, so the sentence asserted a
 * guard that did not exist — the one-definition problem the trigger's two
 * guards close for the transition table, reintroduced here unguarded and then
 * papered over by prose. Found by the audit of ADR 0125's follow-up.
 *
 * The row is `ADR-0125` in `.planning/decisions/CLAIMS.jsonl`. Its verify
 * command extracts both arrays, sorts them and compares, and fails when they
 * differ OR when either file stops containing the declaration at all — so a
 * rename shouts rather than passing on an empty comparison.
 *
 * `counter_offer` is deliberately absent: haggling is not refusing.
 */
export const DECLINE_INTENTS = ['rejection', 'declined', 'out_of_stock'];

export function isDecline(intent: unknown): boolean {
  return (
    typeof intent === 'string' &&
    DECLINE_INTENTS.includes(intent.trim().toLowerCase())
  );
}

/**
 * What the sheet says over a declined answer. It has to carry the thing a
 * manager will otherwise get wrong: the order is still OPEN.
 */
export const VENDOR_DECLINED_NOTE =
  'This vendor declined. The order was returned to negotiation rather than closed, ' +
  'so it is still open: re-price it, try another vendor, or reject it yourself.';

export function readVendorResponses(
  rows: ConversationWire[] | null | undefined,
): VendorResponse[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => directionOf(r?.direction) === 'INBOUND')
    .map((r) => ({
      id: r.id,
      vendorName: text(r.providerName),
      arrivedAt: text(r.sentAt) ?? text(r.createdAt),
      round: intOrNull(r.roundCount),
      summary: text(r.rollingSummary),
      summaryModel: text(r.summaryModel),
      summaryReadAt: text(r.summaryAnalyzedAt),
      intent: text(r.detectedIntent),
      declined: isDecline(r.detectedIntent),
      sentiment: text(r.detectedSentiment),
      specialConditions: Array.isArray(r.specialConditions)
        ? r.specialConditions.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
        : [],
      senderVerified: typeof r.senderVerified === 'boolean' ? r.senderVerified : null,
      body: text(r.draftContent),
    }))
    .sort((a, b) => {
      const ta = a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0;
      const tb = b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0;
      return ta - tb;
    });
}

/**
 * Who wrote the summary, and when — in one sentence, from the row itself.
 *
 * Returns null when the row says neither, because a provenance line that names
 * nothing ("written by the system") is worse than none: it manufactures the
 * impression of a trail. When only the arrival time is known the sentence says
 * exactly that much and no more.
 */
export function summaryProvenance(r: VendorResponse, fmtDate: (iso: string | null) => string): string | null {
  if (!r.summary) return null;
  const parts: string[] = [];
  if (r.summaryModel) parts.push(`read by ${r.summaryModel}`);
  if (r.summaryReadAt) parts.push(`on ${fmtDate(r.summaryReadAt)}`);
  if (parts.length === 0) {
    return r.arrivedAt
      ? `The house's own sentence about the answer that arrived ${fmtDate(r.arrivedAt)}. This row does not record which engine wrote it.`
      : "The house's own sentence about this answer. This row does not record which engine wrote it, or when.";
  }
  return `The engine's own sentence, ${parts.join(' ')} — printed as written, never re-derived.`;
}

/** "Answer 2 of 3". Kept here so the sheet and its tests cannot word it twice. */
export function stepLabel(index: number, total: number): string {
  return `Answer ${index + 1} of ${total}`;
}

/**
 * The refusal a rejection without words gets, said before anything is sent.
 *
 * `DELETE /procurement/orders/:id` takes `reason` as an OPTIONAL query
 * parameter and writes it to `procurement_orders.rejection_reason`
 * (`procurement.service.ts cancelOrder` -> `updateOrder`). Optional to the
 * gateway is not optional here: a cancelled order whose reason column is null
 * is a decision nobody can audit, and the vendor gets told nothing.
 */
export const REJECT_NEEDS_A_REASON =
  'A rejection needs a reason in words. The gateway will accept one without it, ' +
  'and the order then carries no record of why it was refused — so this sheet ' +
  'will not send one.';

/** True only when the reason is words rather than whitespace or a shrug. */
export function reasonIsGiven(reason: string): boolean {
  return reason.trim().length >= 3;
}

/* ── what was ordered, in the order's own unit ───────────────────────────── */

const ORDER_UOM_PLURAL: Record<string, string> = {
  bottle: 'bottles',
  case: 'cases',
  keg: 'kegs',
  pack: 'packs',
  split_case: 'split cases',
  each: 'each',
  liter: 'litres',
};

/**
 * "5 cases of 12 — 60 bottles". Null when the quantity is unknown.
 *
 * The pack is DIVIDED OUT of `bottlesTotal` rather than defaulted to 1, which
 * is the same rule `toRow` follows: defaulting the pack is the per-bottle
 * assumption ADR 0119 exists to end, and it is wrong by exactly the pack in the
 * direction that looks like a bargain. When the division does not come out
 * whole, the pack is not stated at all rather than rounded — a pack of 12.5 is
 * a fact about the data, not about the case.
 */
export function describeOrderedQuantity(order: {
  quantity: number | null;
  unitType: string | null;
  bottlesTotal: number | null;
}): string | null {
  const { quantity, unitType, bottlesTotal } = order;
  if (quantity === null || !Number.isFinite(quantity)) return null;
  const unit = unitType ? (ORDER_UOM_PLURAL[unitType] ?? `${unitType}s`) : null;
  const head = unit ? `${quantity} ${unit}` : `${quantity}`;
  if (bottlesTotal === null || !Number.isFinite(bottlesTotal) || quantity <= 0) return head;
  const pack = bottlesTotal / quantity;
  if (!Number.isInteger(pack) || pack <= 1) {
    return bottlesTotal === quantity ? head : `${head} — ${bottlesTotal} bottles`;
  }
  return `${head} of ${pack} — ${bottlesTotal} bottles`;
}

/**
 * Said on an answer that carries no delivery estimate.
 *
 * A delivery estimate is not a per-message field: it lives on the deal proposal
 * the understand step builds (`getDealProposal` ->
 * `conversation_context.deal_proposal.deliveryEstimate`), and the gateway
 * returns at most the LATEST UNRESOLVED one per order. So an answer either IS
 * that proposal's answer, or nothing on it states a date — and saying "—"
 * without saying which would read as "the vendor gave no date", which is a
 * claim about the vendor rather than about the record.
 */
export const NO_DELIVERY_ESTIMATE =
  'No delivery estimate is recorded on this answer. The house only holds one for ' +
  'the answer it is currently proposing a deal from.';
