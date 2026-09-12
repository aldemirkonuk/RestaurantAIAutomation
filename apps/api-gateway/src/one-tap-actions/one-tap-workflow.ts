import { OneTapActionType } from "./dto/one-tap-action.dto";

/**
 * WHICH one-tap acts the house can actually carry out, and what the other ones
 * say instead.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS (founder, 2026-09-05)
 * ===========================================================================
 * > "extend the seal to it when the first real action lands, but RUN the
 * >  ecosystem to run the first real action."
 *
 * `triggerWorkflow` was three `// TODO` branches and a default log, called
 * AFTER the row had already been stamped `completed`. So every execute
 * reported success for a workflow that had not run — the exact shape ADR 0083
 * forbids (a control may not claim a write it never makes), sitting behind a
 * seal, which is worse than sitting behind a plain button.
 *
 * The census that chose the first real one is in `.planning/06-pages/
 * dashboard.md` §9. In short:
 *
 *   * `delivery_confirm` — `ProcurementService.markDelivered` exists, is
 *     tenant-scoped, books the stock through the ledger RPC, and is ALREADY
 *     called for a client-derived delivery card by the shipping page
 *     (`components/notifications/OneTapActionCenter.tsx:679`). The identical
 *     card, when it comes from the server, degraded into a record. That
 *     asymmetry is the thing to close, so this is the first real act.
 *   * `low_stock` — refused, and not for lack of a route. `CreateOrderDto`
 *     REQUIRES `providerId` (`procurement.dto.ts:42`), and `createOrder` with a
 *     provider fires `triggerDraftHttp` (`procurement.service.ts:860`), which
 *     the orchestrator may AUTO_SEND to the vendor without a second human step
 *     (`provider_communication_agent.py:669-714`). An action whose "done"
 *     spends money and posts a letter is not the one to make real first.
 *   * `price_change` — no route writes a purchase price at all. Nothing to run.
 *   * the rest — no branch was ever written for them.
 *
 * ===========================================================================
 * THE THREE DISPOSITIONS, AND WHY "RECORD" IS NOT A CONSOLATION PRIZE
 * ===========================================================================
 * A hand-written standing action ("call Bodega Alvaro about the Rioja") has no
 * workflow and never will: marking it done IS the whole act, and recording the
 * decision against a name is a true and useful thing to do. So `record` is a
 * first-class outcome here, not a euphemism for a stub.
 *
 * `unbuilt` is the euphemism-free one. Its sentence is shown on the control and
 * returned by the refusal, and the row is NOT completed — because an action
 * marked done for a workflow that never ran is a lie that survives in the
 * database long after the toast has gone.
 *
 * Nothing here touches Nest or a database, so every rule above is testable
 * without either.
 */

export type OneTapDisposition =
  /** A real write the house carries out. Sealed: proven, then done. */
  | { kind: "workflow"; act: "deliver" }
  /** Marking it done IS the act. Recorded against the actor, nothing else. */
  | { kind: "record" }
  /** No workflow exists. Refused in words; nothing is written. */
  | { kind: "unbuilt"; sentence: string };

/**
 * The census, as code. Exhaustive over `OneTapActionType` on purpose: a tenth
 * type added without a decision about what its "done" does will fail to
 * compile rather than fall into a default that quietly records.
 */
export const ONE_TAP_DISPOSITIONS: Record<OneTapActionType, OneTapDisposition> =
  {
    [OneTapActionType.DELIVERY_CONFIRM]: { kind: "workflow", act: "deliver" },
    [OneTapActionType.CUSTOM]: { kind: "record" },
    [OneTapActionType.LOW_STOCK]: {
      kind: "unbuilt",
      sentence:
        "Reordering from here is not built. Placing the order needs a vendor and an agreed price this card does not carry, and it would open a priced negotiation with the vendor — so it is done in Orders, by a person, behind the order seal. Nothing was changed.",
    },
    [OneTapActionType.PRICE_CHANGE]: {
      kind: "unbuilt",
      sentence:
        "Accepting a price from here is not built: no route in this house writes a purchase price yet, so there is nothing for this to call. Nothing was changed.",
    },
    [OneTapActionType.STOCK_RECEIPT]: {
      kind: "unbuilt",
      sentence:
        "Moving shadow stock to live stock is a receiving step — it belongs against an invoice in Receiving, not on a card. Nothing was changed.",
    },
    [OneTapActionType.INEQUALITY]: {
      kind: "unbuilt",
      sentence:
        "Reconciling a discrepancy from here is not built. Nothing was changed.",
    },
    [OneTapActionType.VINTAGE_SUB]: {
      kind: "unbuilt",
      sentence:
        "Substituting a vintage from here is not built. Nothing was changed.",
    },
    [OneTapActionType.GMAIL_SEND]: {
      kind: "unbuilt",
      sentence:
        "Sending mail from here is not built, and a card is the wrong place to arm one: a letter cannot be recalled. Nothing was sent.",
    },
    [OneTapActionType.GMAIL_CONTEXTUAL]: {
      kind: "unbuilt",
      sentence:
        "Sending mail from here is not built, and a card is the wrong place to arm one: a letter cannot be recalled. Nothing was sent.",
    },
  };

/**
 * An unknown `action_type` — a row written before a type was retired, or by a
 * hand at the database. Treated as unbuilt, never as a record: guessing that an
 * unrecognised act is harmless is how a stub becomes a silent success.
 */
export function dispositionOf(actionType: string): OneTapDisposition {
  const known = (ONE_TAP_DISPOSITIONS as Record<string, OneTapDisposition>)[
    actionType
  ];
  return (
    known ?? {
      kind: "unbuilt",
      sentence: `This house does not recognise the act "${actionType}", so nothing was done and nothing was recorded.`,
    }
  );
}

/** The one act a delivery seal approves. Not "write" — delivering is its own act. */
export const ONE_TAP_DELIVER_ACT = "deliver";

/**
 * A quantity, as one string, so issue and redemption cannot disagree about
 * format. `quantity` and `bottles_total` are `integer` columns, but PostgREST
 * has returned numeric-looking columns as strings before, and a seal that
 * hashed 12 at issue and "12" at redemption would refuse every honest
 * confirmation.
 */
export function normaliseSealCount(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "unknown";
  return String(Math.trunc(n));
}

/**
 * What a seal on a one-tap DELIVERY is a seal over.
 *
 * The subject is the ORDER (`subject_kind: "procurement_order"`), not the card:
 * the card is a piece of paper pointing at the order, and two cards pointing at
 * one order must not be two independent permissions to book its stock. The act
 * is `deliver`, which is why an order seal minted for `approve` cannot be spent
 * here — `SealChallengeService` compares the act and refuses with "That seal was
 * issued for a different act on this order."
 *
 * The arguments are the stock this is about to move and the order's own state:
 *
 *   * `actionId` — so a seal held on one card cannot be spent by another card
 *     pointing at the same order.
 *   * `quantity` / `bottlesTotal` — the amount that will be booked. If somebody
 *     edits the order between the hold and the write, what was confirmed and
 *     what is being booked are not the same thing, and the refusal says so.
 *   * `status` — an order already DELIVERED hashes differently from a PENDING
 *     one, so a seal cannot be spent a second time even if the row survives.
 *
 * Deliberately NOT hashed: price and vendor. They are what an APPROVAL is
 * about; a delivery confirmation is about how much wine came through the door,
 * and refusing it because a note changed teaches people to mash the control.
 */
export function deliverySealArgs(input: {
  actionId: string;
  orderId: string;
  quantity: unknown;
  bottlesTotal: unknown;
  status: unknown;
}): Record<string, unknown> {
  return {
    actionId: input.actionId,
    orderId: input.orderId,
    quantity: normaliseSealCount(input.quantity),
    bottlesTotal: normaliseSealCount(input.bottlesTotal),
    status: String(input.status ?? "unknown")
      .trim()
      .toUpperCase(),
  };
}

/**
 * The sentence a card gets when its act is real but the row does not name the
 * thing to act on. Not a 500: the row is legible, it just cannot be carried out.
 */
export const DELIVERY_WITHOUT_ORDER =
  "This delivery card names no order, so there is nothing to book into stock. Nothing was changed.";
