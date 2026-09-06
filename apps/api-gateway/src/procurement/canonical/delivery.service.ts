import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { ReadResult } from "./canonical-document.service";
import { matchLines, MatchableLine } from "../documents/line-matcher";

/**
 * DeliveryService — the delivery's own doors (ADR 0103 D1/D3/D5/D6/D7, A2, A4, A6).
 *
 * WHAT THIS OPENS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Slice 1 built `deliveries`, `document_deliveries` and `delivery_proposals` as
 * schema with no writer. This writes them: a delivery is created from a door
 * count or from an order, documents attach to it with the role they play, every
 * contradiction becomes a proposal row, and two human gates — AGREED and
 * VERIFIED — are separate and stay separate.
 *
 * NO STOCK PATH IS TOUCHED, AND THAT IS MEASURED, NOT ASSUMED. ADR 0103 A1 says
 * on-hand moves at DELIVERED with the lot marked `cost_state = provisional` and
 * cost posts at VERIFIED. `inventory_lots.cost_state` and
 * `inventory_transactions.delivery_id` were added as columns in slice 1 and, read
 * across `apps/api-gateway/src` and `services/` on this tree, still have ZERO
 * writers. So `verify()` does NOT set `cost_state = final`: it would be the only
 * writer of that column, marking lots final that nothing ever marked provisional
 * — a cost state asserted about a booking this code never made. Consolidating
 * `recordDoorReceipt` and `markDelivered` onto the delivery (A5) is its own stop
 * and is named here rather than half-done.
 *
 * THE TWO GATES, AND WHY THEY ARE TWO (D1, D6).
 *   AGREED    is about the DOCUMENT: both sides' positions are on the record.
 *   VERIFIED  is about the GOODS and the BOOKS: a person asserts receipt.
 * Collapsing them is what lets "verified" mean "somebody pressed a button on an
 * invoice". `agree()` records WHICH of D3's two rules fired, because "we agreed"
 * with no rule named cannot be audited six months later.
 */

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export const DELIVERY_ROLES = [
  "purchase_order",
  "despatch_advice",
  "door_count",
  "invoice",
  "credit_memo",
  "statement",
  "other",
] as const;
export type DeliveryRole = (typeof DELIVERY_ROLES)[number];

export const REASON_CLASSES = [
  "SHORT_SHIP",
  "OVER_SHIP",
  "SUBSTITUTION",
  "VINTAGE_CHANGE",
  "PRICE_VARIANCE",
  "DAMAGED",
  "WRONG_VENUE",
  "DUPLICATE_DOCUMENT",
  "FREE_GOODS",
  "DEPOSIT_OR_FEE",
] as const;
export type ReasonClass = (typeof REASON_CLASSES)[number];

/** States a delivery has finished from. Nothing moves it out of these. */
const SETTLED = ["VERIFIED", "CANCELLED", "REJECTED"];

/**
 * One line a comparison found something on (ADR 0103 A11).
 *
 * Keyed by the DOCUMENT and its line number, never by "the delivery's line n":
 * A2 puts N documents on a delivery, so line 3 of the invoice and line 3 of the
 * door count are different lines that can disagree with each other.
 */
export interface DifferenceLine {
  documentId: string;
  lineNo: number;
  /** What the line calls itself, so a refusal names something a person knows. */
  label: string;
  /** The shape of the disagreement, in words. */
  why?: string;
}

/**
 * What a comparison answered. THREE answers, never two — see `scanDifferences`.
 */
export type DifferenceScan =
  | {
      status: "compared";
      basis: "order" | "vendor_document";
      differing: DifferenceLine[];
      unmatched: DifferenceLine[];
    }
  | { status: "not_comparable"; reason: string }
  | { status: "unreadable"; reason: string };

interface DeliveryRow {
  id: string;
  restaurant_id: string;
  provider_id: string | null;
  order_id: string | null;
  state: string;
  provenance: string;
  jurisdiction: string | null;
  delivered_at: string | null;
  agreed_at: string | null;
  agreed_rule: string | null;
  verified_at: string | null;
  verified_by: string | null;
  lapsed_at: string | null;
  lapse_deemed: string | null;
  amended_at: string | null;
  owner_user_id: string | null;
  deputy_user_id: string | null;
}

const DELIVERY_COLUMNS =
  "id, restaurant_id, provider_id, order_id, state, provenance, jurisdiction, " +
  "delivered_at, agreed_at, agreed_rule, verified_at, verified_by, " +
  "lapsed_at, lapse_deemed, amended_at, owner_user_id, deputy_user_id";

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly clocks: DeliveryClockService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async byId(
    restaurantId: string,
    deliveryId: string,
  ): Promise<ReadResult<DeliveryRow | null>> {
    const read = await this.db
      .getClient()
      .from("deliveries")
      .select(DELIVERY_COLUMNS)
      .eq("id", deliveryId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (read.error)
      return {
        ok: false,
        error: `deliveries read failed for ${deliveryId}: ${read.error.message}`,
      };
    return { ok: true, value: (read.data as unknown as DeliveryRow) ?? null };
  }

  /** Every proposal on a delivery, oldest first — the thread, in order. */
  async proposalsFor(
    restaurantId: string,
    deliveryId: string,
  ): Promise<ReadResult<Record<string, unknown>[]>> {
    const owns = await this.byId(restaurantId, deliveryId);
    if (!owns.ok) return owns;
    if (!owns.value)
      return {
        ok: false,
        error: `delivery ${deliveryId} not found for restaurant ${restaurantId}`,
      };

    const read = await this.db
      .getClient()
      .from("delivery_proposals")
      .select(
        "id, delivery_id, document_id, line_no, side, reason, qty_proposed, " +
          "unit_price_proposed, money_at_risk, evidence, note, status, " +
          "counters_proposal_id, proposed_by, proposed_at, responded_at, responded_by",
      )
      .eq("delivery_id", deliveryId)
      .order("proposed_at", { ascending: true });

    // A FAILED READ IS NEVER AN EMPTY THREAD (ADR 0067). "Nobody has disputed
    // anything" is the sentence an agreement gets argued from.
    if (read.error)
      return {
        ok: false,
        error: `delivery_proposals read failed for ${deliveryId}: ${read.error.message}`,
      };
    return {
      ok: true,
      value: (read.data ?? []) as unknown as Record<string, unknown>[],
    };
  }

  /** The open deliveries at a restaurant, newest first. */
  async list(
    restaurantId: string,
    opts: { state?: string; limit?: number } = {},
  ): Promise<ReadResult<DeliveryRow[]>> {
    let q = this.db
      .getClient()
      .from("deliveries")
      .select(DELIVERY_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(Math.min(opts.limit ?? 50, 200));
    if (opts.state) q = q.eq("state", opts.state);
    const read = await q;
    if (read.error)
      return {
        ok: false,
        error: `deliveries list failed for restaurant ${restaurantId}: ${read.error.message}`,
      };
    return { ok: true, value: (read.data ?? []) as unknown as DeliveryRow[] };
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Create a delivery — the commercial event (ADR 0103 D1, D5; ADR 0104 D7).
   *
   * `provenance` is derived ONCE, here, from whether an order preceded the
   * goods, and is then permanent (D5). It is not `order_id is null` computed at
   * read time: a PO attached later must not retroactively turn an unordered
   * delivery into an ordered one, because "what share of our spend was never
   * ordered" is a question reporting has to be able to answer.
   */
  async create(
    restaurantId: string,
    userId: string | null,
    input: {
      orderId?: string | null;
      providerId?: string | null;
      jurisdiction?: string | null;
      deliveredAt?: string | null;
      ownerUserId?: string | null;
      deputyUserId?: string | null;
      documents?: { documentId: string; role: DeliveryRole }[];
    },
  ): Promise<
    WriteResult<{ delivery: DeliveryRow; differsOnLines: number | null }>
  > {
    const docs = input.documents ?? [];
    for (const d of docs)
      if (!DELIVERY_ROLES.includes(d.role))
        return {
          ok: false,
          status: 400,
          error: `\`${d.role}\` is not a role a document can play on a delivery. Roles: ${DELIVERY_ROLES.join(", ")}.`,
        };

    // Every document must belong to THIS restaurant. The gateway holds the
    // service role, so this check IS the tenant isolation on the join.
    const owned = await this.documentsOwnedBy(
      restaurantId,
      docs.map((d) => d.documentId),
    );
    if (!owned.ok) return { ok: false, status: 500, error: owned.error };
    if (owned.value.missing.length)
      return {
        ok: false,
        status: 404,
        error: `document(s) not found for this restaurant: ${owned.value.missing.join(", ")}`,
      };

    const hasArrived = docs.some(
      (d) =>
        d.role === "door_count" ||
        d.role === "despatch_advice" ||
        d.role === "invoice",
    );
    const providerId =
      input.providerId ??
      owned.value.rows.find((r) => r.provider_id)?.provider_id ??
      null;

    const now = new Date().toISOString();
    const insert = await this.db
      .getClient()
      .from("deliveries")
      .insert({
        restaurant_id: restaurantId,
        provider_id: providerId,
        order_id: input.orderId ?? null,
        // ORDERED before anything arrives; DELIVERED the moment a document says
        // goods are here. ACKNOWLEDGED and IN_TRANSIT may be skipped (D1).
        state: hasArrived ? "DELIVERED" : "ORDERED",
        provenance: input.orderId ? "ORDERED" : "UNORDERED",
        jurisdiction: input.jurisdiction ?? null,
        delivered_at: hasArrived ? (input.deliveredAt ?? now) : null,
        owner_user_id: input.ownerUserId ?? userId,
        deputy_user_id: input.deputyUserId ?? null,
      })
      .select(DELIVERY_COLUMNS)
      .single();

    if (insert.error)
      return {
        ok: false,
        status: 500,
        error: `deliveries insert failed: ${insert.error.message}`,
      };
    if (!insert.data)
      return {
        ok: false,
        status: 500,
        error:
          "the delivery insert returned no row and no error, so it cannot be reported as created",
      };

    const delivery = insert.data as unknown as DeliveryRow;

    if (docs.length) {
      const join = await this.db
        .getClient()
        .from("document_deliveries")
        .insert(
          docs.map((d) => ({
            document_id: d.documentId,
            delivery_id: delivery.id,
            role: d.role,
          })),
        );
      if (join.error)
        return {
          ok: false,
          status: 500,
          // The delivery EXISTS. Saying "creation failed" would leave a caller
          // believing nothing was written and creating a second one.
          error: `delivery ${delivery.id} was created but its documents were not attached: ${join.error.message}`,
        };
    }

    await this.scheduleClocksFor(delivery, docs);
    const differs = await this.notifyIfItDiffers(delivery);

    return { ok: true, value: { delivery, differsOnLines: differs } };
  }

  /**
   * Attach a document to a delivery with the role it plays there (A2, S5).
   *
   * A LATE DOCUMENT AMENDS A LAPSE, IT DOES NOT ERASE IT (A4). Linking anything
   * to a `LAPSED` delivery moves it to `LAPSED_AMENDED` and stamps `amended_at`
   * — and leaves `lapse_deemed` exactly as it was, because what the law deemed
   * on the lapse date remains true whatever arrives afterwards.
   */
  async linkDocument(
    restaurantId: string,
    deliveryId: string,
    documentId: string,
    role: DeliveryRole,
  ): Promise<WriteResult<{ delivery: DeliveryRow; alreadyLinked: boolean }>> {
    if (!DELIVERY_ROLES.includes(role))
      return {
        ok: false,
        status: 400,
        error: `\`${role}\` is not a role a document can play on a delivery. Roles: ${DELIVERY_ROLES.join(", ")}.`,
      };

    const found = await this.byId(restaurantId, deliveryId);
    if (!found.ok) return { ok: false, status: 500, error: found.error };
    if (!found.value)
      return { ok: false, status: 404, error: "Delivery not found" };

    const owned = await this.documentsOwnedBy(restaurantId, [documentId]);
    if (!owned.ok) return { ok: false, status: 500, error: owned.error };
    if (owned.value.missing.length)
      return { ok: false, status: 404, error: "Document not found" };

    const insert = await this.db
      .getClient()
      .from("document_deliveries")
      .insert({ document_id: documentId, delivery_id: deliveryId, role });

    let alreadyLinked = false;
    if (insert.error) {
      const dup =
        insert.error.message.includes("duplicate key") ||
        (insert.error as { code?: string }).code === "23505";
      if (!dup)
        return {
          ok: false,
          status: 500,
          error: `document_deliveries insert failed: ${insert.error.message}`,
        };
      alreadyLinked = true;
    }

    let delivery = found.value;
    const patch: Record<string, unknown> = {};
    const now = new Date().toISOString();

    if (delivery.state === "LAPSED" && !alreadyLinked) {
      patch.state = "LAPSED_AMENDED";
      patch.amended_at = now;
    } else if (
      !alreadyLinked &&
      (delivery.state === "ORDERED" ||
        delivery.state === "ACKNOWLEDGED" ||
        delivery.state === "IN_TRANSIT") &&
      (role === "door_count" ||
        role === "despatch_advice" ||
        role === "invoice")
    ) {
      patch.state = "DELIVERED";
      patch.delivered_at = delivery.delivered_at ?? now;
    }

    if (Object.keys(patch).length) {
      patch.updated_at = now;
      const upd = await this.db
        .getClient()
        .from("deliveries")
        .update(patch)
        .eq("id", deliveryId)
        .select(DELIVERY_COLUMNS)
        .single();
      if (upd.error)
        return {
          ok: false,
          status: 500,
          error: `the document was attached but the delivery state could not be moved: ${upd.error.message}`,
        };
      delivery = upd.data as unknown as DeliveryRow;
    }

    if (!alreadyLinked) {
      await this.scheduleClocksFor(delivery, [{ documentId, role }]);
      // The scan reads the join itself, so a document attached LATE is compared
      // against everything already on the delivery — and the same scan is what
      // the AGREED gate will read (A11).
      await this.notifyIfItDiffers(delivery);
    }
    return { ok: true, value: { delivery, alreadyLinked } };
  }

  // -------------------------------------------------------------------------
  // The proposal thread (D7, A5)
  // -------------------------------------------------------------------------

  /**
   * Record one side's position on a line (D7).
   *
   * `WRONG_VENUE` NEVER ENTERS RECONCILING — D7 says so in as many words: it is
   * a rejection. A truck delivered to the wrong restaurant is not a discrepancy
   * to negotiate, and treating it as one would put another venue's goods into
   * this venue's reconciliation.
   */
  async propose(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
    input: {
      side: "restaurant" | "vendor";
      reason: ReasonClass;
      documentId?: string | null;
      lineNo?: number | null;
      /** IN BOTTLE-EQUIVALENTS — the unit every comparison here uses. */
      qtyProposedBottles?: number | null;
      unitPriceProposed?: number | null;
      moneyAtRisk?: number | null;
      evidence?: unknown[];
      note?: string | null;
      countersProposalId?: string | null;
    },
  ): Promise<WriteResult<{ proposalId: string; delivery: DeliveryRow }>> {
    if (input.side !== "restaurant" && input.side !== "vendor")
      return {
        ok: false,
        status: 400,
        error:
          "`side` is `restaurant` or `vendor` — a proposal is somebody's position, and an unattributed one cannot make an agreement.",
      };
    if (!REASON_CLASSES.includes(input.reason))
      return {
        ok: false,
        status: 400,
        error: `\`${input.reason}\` is not a reason class. ADR 0103 D7: ${REASON_CLASSES.join(", ")}.`,
      };

    const found = await this.byId(restaurantId, deliveryId);
    if (!found.ok) return { ok: false, status: 500, error: found.error };
    if (!found.value)
      return { ok: false, status: 404, error: "Delivery not found" };
    if (SETTLED.includes(found.value.state))
      return {
        ok: false,
        status: 409,
        error: `This delivery is ${found.value.state}. A position recorded after it closed would change a record somebody has already acted on — reopen it deliberately or raise a credit against the invoice instead.`,
      };

    if (input.documentId) {
      const owned = await this.documentsOwnedBy(restaurantId, [
        input.documentId,
      ]);
      if (!owned.ok) return { ok: false, status: 500, error: owned.error };
      if (owned.value.missing.length)
        return { ok: false, status: 404, error: "Document not found" };
    }

    const insert = await this.db
      .getClient()
      .from("delivery_proposals")
      .insert({
        delivery_id: deliveryId,
        document_id: input.documentId ?? null,
        line_no: input.lineNo ?? null,
        side: input.side,
        reason: input.reason,
        qty_proposed: input.qtyProposedBottles ?? null,
        unit_price_proposed: input.unitPriceProposed ?? null,
        money_at_risk: input.moneyAtRisk ?? null,
        // REFERENCES, never bytes: storage paths, signature ids, note ids.
        evidence: input.evidence ?? [],
        note: input.note ?? null,
        counters_proposal_id: input.countersProposalId ?? null,
        status: "open",
        proposed_by: userId,
      })
      .select("id")
      .single();

    if (insert.error)
      return {
        ok: false,
        status: 500,
        error: `delivery_proposals insert failed: ${insert.error.message}`,
      };
    if (!insert.data)
      return {
        ok: false,
        status: 500,
        error:
          "the proposal insert returned no row and no error, so it cannot be reported as recorded",
      };

    const proposalId = (insert.data as { id: string }).id;
    const now = new Date().toISOString();

    // WRONG_VENUE is a rejection (D7); everything else opens reconciliation.
    const nextState =
      input.reason === "WRONG_VENUE"
        ? "REJECTED"
        : found.value.state === "DELIVERED" ||
            found.value.state === "ORDERED" ||
            found.value.state === "ACKNOWLEDGED" ||
            found.value.state === "IN_TRANSIT"
          ? "RECONCILING"
          : null;

    let delivery = found.value;
    if (nextState) {
      const upd = await this.db
        .getClient()
        .from("deliveries")
        .update({ state: nextState, updated_at: now })
        .eq("id", deliveryId)
        .select(DELIVERY_COLUMNS)
        .single();
      if (upd.error)
        return {
          ok: false,
          status: 500,
          error: `the proposal was recorded but the delivery could not be moved to ${nextState}: ${upd.error.message}`,
        };
      delivery = upd.data as unknown as DeliveryRow;
      if (nextState === "REJECTED") await this.clocks.cancelFor(deliveryId);
    }

    // D8 — "the vendor proposed …". Only for the vendor's side: the restaurant
    // does not need telling what it just typed.
    if (input.side === "vendor")
      await this.notifications.persistForRestaurant(
        restaurantId,
        {
          type: "delivery_proposal",
          title: `The vendor proposed a change: ${input.reason.replace(/_/g, " ").toLowerCase()}`,
          message:
            `${input.note ?? "The vendor put a position on the record for this delivery."}` +
            (input.moneyAtRisk != null
              ? ` Money at risk: ${input.moneyAtRisk}.`
              : ""),
          priority: "high",
          actionUrl: `/deliveries/${deliveryId}`,
          actionLabel: "Open the delivery",
          groupKey: `delivery-proposal:${proposalId}`,
          metadata: { deliveryId, proposalId, reason: input.reason },
        },
        { dedupeWithinMinutes: 60 },
      );

    return { ok: true, value: { proposalId, delivery } };
  }

  /** Answer one proposal with another (D7). The thread keeps both. */
  async counter(
    restaurantId: string,
    proposalId: string,
    userId: string | null,
    input: Omit<
      Parameters<DeliveryService["propose"]>[3],
      "countersProposalId"
    >,
  ): Promise<WriteResult<{ proposalId: string; delivery: DeliveryRow }>> {
    const original = await this.proposalById(restaurantId, proposalId);
    if (!original.ok) return original;

    const created = await this.propose(
      restaurantId,
      original.value.delivery_id,
      userId,
      { ...input, countersProposalId: proposalId },
    );
    if (!created.ok) return created;

    const now = new Date().toISOString();
    const upd = await this.db
      .getClient()
      .from("delivery_proposals")
      .update({ status: "countered", responded_at: now, responded_by: userId })
      .eq("id", proposalId);
    if (upd.error)
      return {
        ok: false,
        status: 500,
        error: `the counter was recorded as ${created.value.proposalId} but the proposal it answers could not be marked countered: ${upd.error.message}`,
      };
    return created;
  }

  /**
   * Accept one proposal (D6 — a human, always).
   *
   * Accepting a substitution, a vintage change or a price move above the
   * vendor's threshold is a HUMAN GATE in D6. Every accept here carries the
   * acting user, and a call with no user is refused rather than attributed to
   * the system.
   */
  async accept(
    restaurantId: string,
    proposalId: string,
    userId: string | null,
  ): Promise<WriteResult<{ proposalId: string; status: string }>> {
    if (!userId)
      return {
        ok: false,
        status: 403,
        error:
          "Accepting a proposal is a human gate (ADR 0103 D6). This call carries no user, so there is nobody to record as having accepted it.",
      };
    const original = await this.proposalById(restaurantId, proposalId);
    if (!original.ok) return original;

    if (original.value.status === "accepted")
      // Idempotent: saying "already accepted" is the truth, and a second write
      // would move `responded_at` to a moment nobody decided anything.
      return { ok: true, value: { proposalId, status: "accepted" } };

    const upd = await this.db
      .getClient()
      .from("delivery_proposals")
      .update({
        status: "accepted",
        responded_at: new Date().toISOString(),
        responded_by: userId,
      })
      .eq("id", proposalId)
      .select("status")
      .single();
    if (upd.error)
      return {
        ok: false,
        status: 500,
        error: `delivery_proposals accept failed for ${proposalId}: ${upd.error.message}`,
      };
    return {
      ok: true,
      value: { proposalId, status: (upd.data as { status: string }).status },
    };
  }

  // -------------------------------------------------------------------------
  // The gates
  // -------------------------------------------------------------------------

  /**
   * AGREED — both sides on the record, or a signed ticket that is final (D3).
   *
   * RULE A `both_sides_recorded`. The restaurant's position is a door count or a
   * proposal it filed; the vendor's position is a document the VENDOR issued
   * (an invoice, a delivery note, a credit memo) or a proposal recorded against
   * their side. Both, and nothing still open. Vendor silence is recorded as no
   * response and NEVER becomes agreement in our data, even where the law deems
   * it so — the clock chip says "silence accepts on day 7"; the state does not
   * lie about who said what.
   *
   * RULE B `signed_ticket_is_final`. The per-vendor US alcohol norm: the vendor's
   * `vendor_terms.signed_ticket_is_final` is true AND a door-count document on
   * this delivery carries a signature. It defaults to false everywhere,
   * including the platform rows, because asserting it turns every signature into
   * an agreement the restaurant never gave.
   *
   * WHICH RULE FIRED IS WRITTEN DOWN. A refusal says what is missing, by name,
   * so the answer is never "you cannot" without "because".
   */
  async agree(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
  ): Promise<
    WriteResult<{ delivery: DeliveryRow; rule: string; alreadyAgreed: boolean }>
  > {
    const found = await this.byId(restaurantId, deliveryId);
    if (!found.ok) return { ok: false, status: 500, error: found.error };
    if (!found.value)
      return { ok: false, status: 404, error: "Delivery not found" };
    const delivery = found.value;

    if (delivery.agreed_at)
      return {
        ok: true,
        value: {
          delivery,
          rule: delivery.agreed_rule ?? "unknown",
          alreadyAgreed: true,
        },
      };
    if (SETTLED.includes(delivery.state))
      return {
        ok: false,
        status: 409,
        error: `This delivery is ${delivery.state}; it cannot be agreed now.`,
      };

    /**
     * A11 — A RECORDED DIFFERENCE MUST BE ANSWERED, AND IT IS CHECKED FIRST.
     *
     * Before either rule is even considered. The founder, 2026-09-06: "AGREED
     * is refused while any recorded difference (door count vs paperwork, or
     * invoice vs PO) has no accepted proposal or an explicit 'accept as billed'
     * from the restaurant. Rule A stays for deliveries with no difference."
     *
     * IT GATES BOTH RULES, NOT ONLY RULE A. The sentence names AGREED, not one
     * of its routes, and rule B is the route most in need of it: a signed
     * delivery ticket that contradicts the count is exactly the moment somebody
     * has to say, in one tap, that the difference is accepted anyway. The
     * alternative reading — gate rule A only — is recorded in A11 as rejected,
     * because it leaves the gate escapable by a per-vendor setting.
     */
    const answered = await this.unansweredDifferences(delivery);
    if (!answered.ok) return { ok: false, status: 500, error: answered.error };
    if (answered.value.length) {
      const named = answered.value
        .map(
          (l) =>
            `line ${l.lineNo} of document ${l.documentId} (${l.label}${l.why ? `: ${l.why}` : ""})`,
        )
        .join("; ");
      return {
        ok: false,
        status: 409,
        error:
          `This delivery cannot be agreed yet: ${answered.value.length} recorded difference(s) have no answer — ${named}. ` +
          "Answer each one by accepting a proposal that covers it, or by accepting it as billed with a reason (ADR 0103 A11).",
      };
    }

    const evidence = await this.agreementEvidence(restaurantId, delivery);
    if (!evidence.ok) return { ok: false, status: 500, error: evidence.error };
    const e = evidence.value;

    let rule: string | null = null;
    if (e.restaurantSide && e.vendorSide && e.openProposals === 0)
      rule = "both_sides_recorded";
    else if (e.signedTicketIsFinal && e.signedDoorDocument)
      rule = "signed_ticket_is_final";

    if (!rule) {
      const missing: string[] = [];
      if (!e.restaurantSide)
        missing.push(
          "the restaurant's position is not on the record — count at the door or file a proposal",
        );
      if (!e.vendorSide)
        missing.push(
          "the vendor's position is not on the record — attach the document they issued, or record their reply as a proposal. Silence is not agreement here, whatever the law deems",
        );
      if (e.openProposals > 0)
        missing.push(
          `${e.openProposals} proposal(s) are still open — accept or counter them first`,
        );
      if (!e.signedTicketIsFinal)
        missing.push(
          "this vendor's signed delivery ticket is not set as final, so a signature alone cannot agree it",
        );
      else if (!e.signedDoorDocument)
        missing.push(
          "no signed door document is attached, and this vendor's terms say the signed ticket is what agrees a delivery",
        );
      return {
        ok: false,
        status: 409,
        error: `This delivery cannot be agreed yet: ${missing.join("; ")}.`,
      };
    }

    const now = new Date().toISOString();
    const upd = await this.db
      .getClient()
      .from("deliveries")
      .update({
        state: "AGREED",
        agreed_at: now,
        agreed_by: userId,
        agreed_rule: rule,
        updated_at: now,
      })
      .eq("id", deliveryId)
      .select(DELIVERY_COLUMNS)
      .single();
    if (upd.error)
      return {
        ok: false,
        status: 500,
        error: `deliveries agree failed for ${deliveryId}: ${upd.error.message}`,
      };

    await this.clocks.cancelFor(deliveryId);
    return {
      ok: true,
      value: {
        delivery: upd.data as unknown as DeliveryRow,
        rule,
        alreadyAgreed: false,
      },
    };
  }

  /**
   * VERIFIED — a person asserts they received the goods (D6).
   *
   * A HUMAN, ALWAYS. `userId` is what `verified_by` records, and a call without
   * one is refused rather than attributed to the system: "verified" has to mean
   * a named person stood behind it, or the word is worth nothing.
   *
   * IDEMPOTENT. A second verify returns the first one's stamp unchanged. Writing
   * again would move `verified_at` to a moment at which nobody decided anything.
   *
   * NO STOCK, NO COST — MEASURED. See the class header: `cost_state` and
   * `inventory_transactions.delivery_id` have zero writers on this tree, so
   * setting `cost_state = final` here would be this code asserting a cost state
   * about a booking it never made. Filed as the next stop, not half-done.
   */
  async verify(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
  ): Promise<
    WriteResult<{
      delivery: DeliveryRow;
      alreadyVerified: boolean;
      stockUntouched: string;
    }>
  > {
    if (!userId)
      return {
        ok: false,
        status: 403,
        error:
          "Verifying a delivery is a human gate (ADR 0103 D6). This call carries no user, so there is nobody to record as having verified it.",
      };

    const found = await this.byId(restaurantId, deliveryId);
    if (!found.ok) return { ok: false, status: 500, error: found.error };
    if (!found.value)
      return { ok: false, status: 404, error: "Delivery not found" };
    const delivery = found.value;

    const stockUntouched =
      "Nothing was posted to inventory or cost. On this build the door path is " +
      "still the only writer of stock, and `inventory_lots.cost_state` has no " +
      "writer at all — so verification records the human assertion and nothing " +
      "else (ADR 0103 A1/A5, consolidation is a later stop).";

    if (delivery.verified_at)
      return {
        ok: true,
        value: { delivery, alreadyVerified: true, stockUntouched },
      };

    if (delivery.state !== "AGREED")
      return {
        ok: false,
        status: 409,
        error:
          delivery.state === "RECONCILING"
            ? "This delivery is still being reconciled. AGREED and VERIFIED are never collapsed (ADR 0103 D1): agree the document with the vendor first, then verify the goods."
            : `This delivery is ${delivery.state}. Only an AGREED delivery can be verified — agreement is about the document, verification is about the goods and the books.`,
      };

    const now = new Date().toISOString();
    const upd = await this.db
      .getClient()
      .from("deliveries")
      .update({
        state: "VERIFIED",
        verified_at: now,
        verified_by: userId,
        updated_at: now,
      })
      .eq("id", deliveryId)
      .select(DELIVERY_COLUMNS)
      .single();
    if (upd.error)
      return {
        ok: false,
        status: 500,
        error: `deliveries verify failed for ${deliveryId}: ${upd.error.message}`,
      };

    await this.clocks.cancelFor(deliveryId);
    return {
      ok: true,
      value: {
        delivery: upd.data as unknown as DeliveryRow,
        alreadyVerified: false,
        stockUntouched,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * ACCEPT ONE DIFFERENCE AS BILLED (ADR 0103 A11) — the second of the two
   * answers a difference will take.
   *
   * WHY IT IS NOT A PROPOSAL. A proposal is a POSITION one side asks the other
   * to accept. "We counted 10, they billed 12, and we are not disputing it" is
   * the decision NOT to raise one; filing it as an accepted `SHORT_SHIP` from
   * the restaurant would put a claim on the record that the restaurant
   * deliberately did not make. Its own row says the true thing.
   *
   * A HUMAN, WITH A REASON. D6: a call with no user is refused rather than
   * attributed to the platform, and an acceptance with no sentence behind it is
   * indistinguishable from a click.
   *
   * IDEMPOTENT. A second acceptance of the same line returns the first one — the
   * fact recorded is that a named person decided, on a date, not to dispute this
   * line; rewriting it would move that moment to one at which nobody decided
   * anything.
   */
  async acceptAsBilled(
    restaurantId: string,
    deliveryId: string,
    userId: string | null,
    input: { documentId: string; lineNo: number; reason: string },
  ): Promise<
    WriteResult<{
      acceptanceId: string;
      acceptedAt: string;
      acceptedBy: string;
      alreadyAccepted: boolean;
    }>
  > {
    if (!userId)
      return {
        ok: false,
        status: 403,
        error:
          "Accepting a difference as billed is a human gate (ADR 0103 D6/A11). This call carries no user, so there is nobody to record as having accepted it.",
      };
    const reason = (input.reason ?? "").trim();
    if (!reason)
      return {
        ok: false,
        status: 400,
        error:
          "An acceptance needs a reason in your own words. Six months from now the row has to read as a decision somebody made, not as a click.",
      };
    if (!Number.isInteger(input.lineNo))
      return {
        ok: false,
        status: 400,
        error: "`lineNo` is the line number of the document, as an integer.",
      };

    const found = await this.byId(restaurantId, deliveryId);
    if (!found.ok) return { ok: false, status: 500, error: found.error };
    if (!found.value)
      return { ok: false, status: 404, error: "Delivery not found" };
    if (SETTLED.includes(found.value.state))
      return {
        ok: false,
        status: 409,
        error: `This delivery is ${found.value.state}; a difference accepted now would change a record somebody has already acted on.`,
      };

    // The document must be this restaurant's AND on this delivery. Without the
    // second check an acceptance could be filed against a line of a document
    // that has nothing to do with the difference it claims to answer.
    const owned = await this.documentsOwnedBy(restaurantId, [input.documentId]);
    if (!owned.ok) return { ok: false, status: 500, error: owned.error };
    if (owned.value.missing.length)
      return { ok: false, status: 404, error: "Document not found" };

    const joins = await this.db
      .getClient()
      .from("document_deliveries")
      .select("document_id")
      .eq("delivery_id", deliveryId);
    if (joins.error)
      return {
        ok: false,
        status: 500,
        error: `document_deliveries read failed for ${deliveryId}: ${joins.error.message}`,
      };
    const onDelivery = (
      (joins.data ?? []) as unknown as { document_id: string }[]
    ).some((j) => j.document_id === input.documentId);
    if (!onDelivery)
      return {
        ok: false,
        status: 409,
        error: `Document ${input.documentId} is not attached to delivery ${deliveryId}, so a line of it cannot answer a difference on this delivery.`,
      };

    const existing = await this.db
      .getClient()
      .from("delivery_line_acceptances")
      .select("id, accepted_at, accepted_by")
      .eq("delivery_id", deliveryId)
      .eq("document_id", input.documentId)
      .eq("line_no", input.lineNo)
      .maybeSingle();
    if (existing.error)
      return {
        ok: false,
        status: 500,
        error: `delivery_line_acceptances read failed: ${existing.error.message}`,
      };
    if (existing.data) {
      const row = existing.data as unknown as {
        id: string;
        accepted_at: string;
        accepted_by: string;
      };
      return {
        ok: true,
        value: {
          acceptanceId: row.id,
          acceptedAt: row.accepted_at,
          acceptedBy: row.accepted_by,
          alreadyAccepted: true,
        },
      };
    }

    const insert = await this.db
      .getClient()
      .from("delivery_line_acceptances")
      .insert({
        delivery_id: deliveryId,
        document_id: input.documentId,
        line_no: input.lineNo,
        reason,
        accepted_by: userId,
      })
      .select("id, accepted_at, accepted_by")
      .single();
    if (insert.error)
      return {
        ok: false,
        status: 500,
        error: `delivery_line_acceptances insert failed: ${insert.error.message}`,
      };
    if (!insert.data)
      return {
        ok: false,
        status: 500,
        error:
          "the acceptance insert returned no row and no error, so it cannot be reported as recorded",
      };
    const row = insert.data as unknown as {
      id: string;
      accepted_at: string;
      accepted_by: string;
    };
    return {
      ok: true,
      value: {
        acceptanceId: row.id,
        acceptedAt: row.accepted_at,
        acceptedBy: row.accepted_by,
        alreadyAccepted: false,
      },
    };
  }

  /**
   * Which recorded differences have NO answer (ADR 0103 A11).
   *
   * An answer is an ACCEPTED PROPOSAL covering the line, or an ACCEPT-AS-BILLED
   * on it. A proposal covers a line when it names the same document and line; a
   * proposal that names the document but no line covers every line of it, and
   * one that names neither is about the delivery as a whole and covers all of
   * it — the model's own reading of a NULL `document_id` (migration
   * 20260903160000: "NULL when the proposal is about the delivery as a whole").
   *
   * UNMATCHED LINES COUNT AS UNANSWERED. The notification is right to call an
   * unmatched line "a question, not a difference", but a billed line that pairs
   * with nothing counted is the most expensive question at the door, and it is
   * answerable by the same two doors. The refusal names the two groups
   * separately so the sentence stays true.
   *
   * A SCAN THAT COULD NOT BE READ IS NOT AN EMPTY ONE (ADR 0067). `unreadable`
   * fails the caller; `not_comparable` — nothing to compare — legitimately
   * leaves nothing to answer, and rule A stands exactly as it did.
   */
  private async unansweredDifferences(
    delivery: DeliveryRow,
  ): Promise<ReadResult<DifferenceLine[]>> {
    const scan = await this.scanDifferences(delivery);
    if (scan.status === "unreadable")
      return {
        ok: false,
        error: `This delivery cannot be agreed because the difference check could not run: ${scan.reason}. A comparison that failed is not a comparison that passed.`,
      };
    if (scan.status === "not_comparable") return { ok: true, value: [] };

    const recorded = [...scan.differing, ...scan.unmatched];
    if (!recorded.length) return { ok: true, value: [] };

    const proposals = await this.db
      .getClient()
      .from("delivery_proposals")
      .select("document_id, line_no, status")
      .eq("delivery_id", delivery.id);
    if (proposals.error)
      return {
        ok: false,
        error: `delivery_proposals read failed for ${delivery.id}: ${proposals.error.message}`,
      };
    const accepted = (
      (proposals.data ?? []) as unknown as {
        document_id: string | null;
        line_no: number | null;
        status: string;
      }[]
    ).filter((p) => p.status === "accepted");

    const acceptances = await this.db
      .getClient()
      .from("delivery_line_acceptances")
      .select("document_id, line_no")
      .eq("delivery_id", delivery.id);
    if (acceptances.error)
      return {
        ok: false,
        error: `delivery_line_acceptances read failed for ${delivery.id}: ${acceptances.error.message}`,
      };
    const asBilled = new Set(
      (
        (acceptances.data ?? []) as unknown as {
          document_id: string;
          line_no: number;
        }[]
      ).map((a) => `${a.document_id}#${a.line_no}`),
    );

    return {
      ok: true,
      value: recorded.filter((line) => {
        if (asBilled.has(`${line.documentId}#${line.lineNo}`)) return false;
        return !accepted.some(
          (p) =>
            (p.document_id == null && p.line_no == null) ||
            (p.document_id === line.documentId &&
              (p.line_no == null || p.line_no === line.lineNo)),
        );
      }),
    };
  }

  private async proposalById(
    restaurantId: string,
    proposalId: string,
  ): Promise<
    | { ok: true; value: { delivery_id: string; status: string; side: string } }
    | { ok: false; status: number; error: string }
  > {
    const read = await this.db
      .getClient()
      .from("delivery_proposals")
      .select("id, delivery_id, status, side")
      .eq("id", proposalId)
      .maybeSingle();
    if (read.error)
      return {
        ok: false,
        status: 500,
        error: `delivery_proposals read failed for ${proposalId}: ${read.error.message}`,
      };
    if (!read.data)
      return { ok: false, status: 404, error: "Proposal not found" };
    const row = read.data as {
      delivery_id: string;
      status: string;
      side: string;
    };
    // The proposal carries no restaurant_id — it hangs off the delivery, so the
    // tenant check is that read, and it is what stops one tenant answering
    // another's thread by id.
    const owns = await this.byId(restaurantId, row.delivery_id);
    if (!owns.ok) return { ok: false, status: 500, error: owns.error };
    if (!owns.value)
      return { ok: false, status: 404, error: "Proposal not found" };
    return { ok: true, value: row };
  }

  private async documentsOwnedBy(
    restaurantId: string,
    ids: string[],
  ): Promise<
    ReadResult<{
      rows: {
        id: string;
        provider_id: string | null;
        doc_type: string;
        direction: string | null;
        extracted: unknown;
      }[];
      missing: string[];
    }>
  > {
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (!unique.length) return { ok: true, value: { rows: [], missing: [] } };
    const read = await this.db
      .getClient()
      .from("procurement_documents")
      .select("id, provider_id, doc_type, direction, extracted")
      .eq("restaurant_id", restaurantId)
      .in("id", unique);
    if (read.error)
      return {
        ok: false,
        error: `procurement_documents read failed: ${read.error.message}`,
      };
    const rows = (read.data ?? []) as unknown as {
      id: string;
      provider_id: string | null;
      doc_type: string;
      direction: string | null;
      extracted: unknown;
    }[];
    const found = new Set(rows.map((r) => r.id));
    return {
      ok: true,
      value: { rows, missing: unique.filter((id) => !found.has(id)) },
    };
  }

  /** What each of D3's two rules needs, read once. */
  private async agreementEvidence(
    restaurantId: string,
    delivery: DeliveryRow,
  ): Promise<
    ReadResult<{
      restaurantSide: boolean;
      vendorSide: boolean;
      openProposals: number;
      signedTicketIsFinal: boolean;
      signedDoorDocument: boolean;
    }>
  > {
    const joins = await this.db
      .getClient()
      .from("document_deliveries")
      .select("document_id, role")
      .eq("delivery_id", delivery.id);
    if (joins.error)
      return {
        ok: false,
        error: `document_deliveries read failed for ${delivery.id}: ${joins.error.message}`,
      };
    const links = (joins.data ?? []) as unknown as {
      document_id: string;
      role: string;
    }[];

    const docs = await this.documentsOwnedBy(
      restaurantId,
      links.map((l) => l.document_id),
    );
    if (!docs.ok) return docs;

    const proposals = await this.db
      .getClient()
      .from("delivery_proposals")
      .select("side, status")
      .eq("delivery_id", delivery.id);
    if (proposals.error)
      return {
        ok: false,
        error: `delivery_proposals read failed for ${delivery.id}: ${proposals.error.message}`,
      };
    const rows = (proposals.data ?? []) as unknown as {
      side: string;
      status: string;
    }[];

    const byId = new Map(docs.value.rows.map((r) => [r.id, r]));
    const doorCounts = links
      .filter((l) => l.role === "door_count")
      .map((l) => byId.get(l.document_id))
      .filter(Boolean);

    const vendorDocuments = links.filter((l) => {
      const d = byId.get(l.document_id);
      if (!d) return false;
      // A document the VENDOR issued is their position (S6: direction is the
      // field that tells our own `iade faturası` from their credit memo).
      return (
        d.direction !== "issued_by_us" &&
        (l.role === "invoice" ||
          l.role === "despatch_advice" ||
          l.role === "credit_memo")
      );
    });

    const signedDoorDocument = doorCounts.some((d) => {
      const snap = (d?.extracted ?? null) as {
        signature?: { signedBy?: string | null } | null;
      } | null;
      return !!snap?.signature?.signedBy;
    });

    const final = await this.clocks.signedTicketIsFinal({
      restaurantId,
      providerId: delivery.provider_id,
      jurisdiction: delivery.jurisdiction,
    });
    if (!final.ok) return final;

    return {
      ok: true,
      value: {
        restaurantSide:
          doorCounts.length > 0 || rows.some((r) => r.side === "restaurant"),
        vendorSide:
          vendorDocuments.length > 0 || rows.some((r) => r.side === "vendor"),
        openProposals: rows.filter((r) => r.status === "open").length,
        signedTicketIsFinal: final.value,
        signedDoorDocument,
      },
    };
  }

  private async scheduleClocksFor(
    delivery: DeliveryRow,
    docs: { documentId: string; role: DeliveryRole }[],
  ): Promise<void> {
    const basis = {
      dispatch: delivery.delivered_at,
      delivery: delivery.delivered_at,
      issue: delivery.delivered_at,
    };

    if (delivery.delivered_at) {
      const r = await this.clocks.schedule({
        restaurantId: delivery.restaurant_id,
        deliveryId: delivery.id,
        clock: "door_correction",
        documentType: "delivery_note",
        providerId: delivery.provider_id,
        jurisdiction: delivery.jurisdiction,
        basisAt: basis,
      });
      if (!r.ok) this.logger.warn(r.error);
    }

    for (const d of docs) {
      const clock =
        d.role === "invoice"
          ? "objection_window"
          : d.role === "despatch_advice"
            ? "response_window"
            : null;
      if (!clock) continue;
      const r = await this.clocks.schedule({
        restaurantId: delivery.restaurant_id,
        deliveryId: delivery.id,
        documentId: d.documentId,
        clock,
        documentType: d.role === "invoice" ? "invoice" : "delivery_note",
        providerId: delivery.provider_id,
        jurisdiction: delivery.jurisdiction,
        basisAt: basis,
      });
      if (!r.ok) this.logger.warn(r.error);

      if (d.role === "invoice") {
        const p = await this.clocks.schedule({
          restaurantId: delivery.restaurant_id,
          deliveryId: delivery.id,
          documentId: d.documentId,
          clock: "payment",
          documentType: "invoice",
          providerId: delivery.provider_id,
          jurisdiction: delivery.jurisdiction,
          beverageClass: "alcohol",
          basisAt: basis,
        });
        if (!p.ok) this.logger.warn(p.error);
      }
    }
  }

  /**
   * D8's first notification — "this delivery differs from your order on N
   * lines", at the door, which is the only moment it is cheap.
   *
   * IT DOES NOT COMPUTE THE DIFFERENCE. `scanDifferences` does, and `agree()`
   * calls the SAME method (ADR 0103 A11). A second copy of the comparison here
   * is the failure mode the amendment exists to prevent: the notification would
   * say a line differs while the gate, reading its own copy, let the delivery
   * agree — one system telling a person two things.
   *
   * WHAT IT SAYS WHEN IT CANNOT TELL. `null` comes back when no comparison ran,
   * and the caller reports `differsOnLines: null` rather than 0. A zero would
   * say "we compared and everything matched", which is the sentence this
   * repository's standing fault is made of. Lines the matcher could not pair are
   * counted and named separately from lines that genuinely disagree.
   */
  private async notifyIfItDiffers(delivery: DeliveryRow): Promise<number | null> {
    const scan = await this.scanDifferences(delivery);
    if (scan.status !== "compared") {
      if (scan.status === "unreadable")
        this.logger.warn(`delivery ${delivery.id}: ${scan.reason}`);
      return null;
    }

    const differing = scan.differing.length;
    const unmatched = scan.unmatched.length;
    if (!differing && !unmatched) return 0;

    const againstTheOrder = scan.basis === "order";
    await this.notifications.persistForRestaurant(
      delivery.restaurant_id,
      {
        type: "delivery_differs",
        title:
          differing > 0
            ? againstTheOrder
              ? `This delivery differs from your order on ${differing} line(s)`
              : `This delivery differs from the vendor's paperwork on ${differing} line(s)`
            : againstTheOrder
              ? `This delivery has ${unmatched} line(s) that are not on your order`
              : `${unmatched} counted line(s) are on no vendor document`,
        message:
          (againstTheOrder
            ? `${differing} line(s) disagree with what you ordered`
            : `Nobody ordered this delivery, so there is no order to check it against — ` +
              `what we counted at the door is compared with what the vendor's own document says. ` +
              `${differing} line(s) disagree`) +
          (unmatched
            ? `, and ${unmatched} line(s) could not be matched at all — which is a question, not a difference.`
            : ".") +
          " The door is the cheapest moment to say so.",
        priority: "high",
        actionUrl: `/deliveries/${delivery.id}`,
        actionLabel: "Open the delivery",
        groupKey: `delivery-differs:${delivery.id}`,
        metadata: {
          deliveryId: delivery.id,
          orderId: delivery.order_id,
          basis:
            scan.basis === "order"
              ? "document_vs_order"
              : "door_count_vs_vendor_document",
          differingLines: differing,
          unmatchedLines: unmatched,
        },
      },
      { dedupeWithinMinutes: 60 * 6 },
    );
    return differing;
  }

  /**
   * THE ONE COMPARISON (ADR 0103 D8, A11).
   *
   * Every reader of "does this delivery differ" comes through here: the
   * notification at the door, and the AGREED gate. Which basis it used is part
   * of the answer, because "differs from your order" and "differs from the
   * vendor's paperwork" are different sentences to a receiver.
   *
   * THREE ANSWERS, NEVER TWO.
   *   `compared`       a comparison ran; `differing` may legitimately be empty.
   *   `not_comparable` there was nothing to compare — no lines on either side.
   *   `unreadable`     a read FAILED. This is not "no differences": ADR 0067.
   * Collapsing `unreadable` into `not_comparable` would let a statement timeout
   * open the gate, which is the exact shape of this repository's standing fault.
   */
  private async scanDifferences(
    delivery: DeliveryRow,
  ): Promise<DifferenceScan> {
    const joins = await this.db
      .getClient()
      .from("document_deliveries")
      .select("document_id, role")
      .eq("delivery_id", delivery.id);
    if (joins.error)
      return {
        status: "unreadable",
        reason: `the comparison could not run — document_deliveries read failed: ${joins.error.message}`,
      };
    const links = (joins.data ?? []) as unknown as {
      document_id: string;
      role: string;
    }[];

    /**
     * WITH NO ORDER THERE IS STILL SOMETHING TO DIFFER FROM.
     *
     * D8's sentence is "this delivery differs from your order on N lines", and
     * the first draft simply gave up when there was no order. That silences the
     * comparison on exactly the case ADR 0103 D5 exists for — an UNORDERED
     * delivery, where the door count against the vendor's own paperwork is the
     * ONLY comparison available. Measured on the sim tenant on 2026-09-05: zero
     * purchase orders, so the founder's asked-for notification could not fire on
     * any delivery there.
     */
    return delivery.order_id
      ? this.scanAgainstTheOrder(delivery, links)
      : this.scanAgainstThePaperwork(delivery, links);
  }

  /** The ORDERED basis: what a vendor document says against what we ordered. */
  private async scanAgainstTheOrder(
    delivery: DeliveryRow,
    links: { document_id: string; role: string }[],
  ): Promise<DifferenceScan> {
    const comparable = links
      .filter((l) => l.role === "door_count" || l.role === "invoice")
      .map((l) => l.document_id);
    if (!comparable.length)
      return {
        status: "not_comparable",
        reason: "no door count and no invoice is attached to this delivery",
      };

    const [orderRead, docLines] = await Promise.all([
      this.db
        .getClient()
        .from("procurement_order_items")
        /**
         * THE COLUMN NAMES ARE THE TABLE'S, NOT THE ONES THAT READ NATURALLY.
         * Measured against the schema on 2026-09-05: this table has no
         * `product_name` and no `unit_price` — it has `wine_name`,
         * `quoted_unit_price` / `final_unit_price`, and a generated
         * `total_bottles`. PostgREST answers 42703 for the WHOLE select when one
         * name is wrong, so the comparison would have failed entirely and this
         * method would have reported "the comparison could not run" for ever.
         */
        .select(
          "id, wine_name, vendor_sku, vintage, quantity, bottles_per_unit, " +
            "total_bottles, quoted_unit_price, final_unit_price, inventory_id",
        )
        .eq("order_id", delivery.order_id),
      this.linesFor(comparable),
    ]);

    if (orderRead.error)
      return {
        status: "unreadable",
        reason: `the order comparison could not run — procurement_order_items read failed: ${orderRead.error.message}`,
      };
    if (!docLines.ok)
      return { status: "unreadable", reason: docLines.error };

    const orderLines: MatchableLine[] = (
      (orderRead.data ?? []) as unknown as {
        id: string;
        wine_name: string | null;
        vendor_sku: string | null;
        vintage: number | null;
        quantity: number | null;
        bottles_per_unit: number | null;
        total_bottles: number | null;
        quoted_unit_price: number | null;
        final_unit_price: number | null;
      }[]
    ).map((o) => ({
      id: o.id,
      vendorSku: o.vendor_sku,
      description: o.wine_name,
      vintage: o.vintage,
      // `total_bottles` is generated as quantity x bottles_per_unit; the fallback
      // is the same arithmetic for a row written before that column existed.
      qtyBottles: Number(
        o.total_bottles ??
          Number(o.quantity ?? 0) * Number(o.bottles_per_unit ?? 1),
      ),
      // What we agreed to pay, then what we were quoted. NEVER 0 for "we did not
      // record a price" — a zero would read as free goods to the matcher.
      unitPrice:
        o.final_unit_price != null
          ? Number(o.final_unit_price)
          : o.quoted_unit_price != null
            ? Number(o.quoted_unit_price)
            : null,
    }));

    if (!orderLines.length || !docLines.value.lines.length)
      return {
        status: "not_comparable",
        reason: "one side of the comparison has no lines",
      };

    return this.gradePairing(
      "order",
      docLines.value.lines,
      orderLines,
      docLines.value.identify,
    );
  }

  /**
   * The UNORDERED basis: our door count against the vendor's own document.
   *
   * The DIFFERENCE is attributed to the COUNT'S lines, not the vendor's: the
   * count is the document this restaurant authored, and an "accept as billed"
   * is a decision about our own line.
   */
  private async scanAgainstThePaperwork(
    delivery: DeliveryRow,
    links: { document_id: string; role: string }[],
  ): Promise<DifferenceScan> {
    const countIds = links
      .filter((l) => l.role === "door_count")
      .map((l) => l.document_id);
    const paperIds = links
      .filter((l) => l.role === "invoice" || l.role === "despatch_advice")
      .map((l) => l.document_id);
    if (!countIds.length || !paperIds.length)
      return {
        status: "not_comparable",
        reason:
          "this delivery has no order, and it does not carry both a door count and a vendor document to compare",
      };

    const [countLines, paperLines] = await Promise.all([
      this.linesFor(countIds),
      this.linesFor(paperIds),
    ]);
    if (!countLines.ok)
      return { status: "unreadable", reason: countLines.error };
    if (!paperLines.ok)
      return { status: "unreadable", reason: paperLines.error };
    if (!countLines.value.lines.length || !paperLines.value.lines.length)
      return {
        status: "not_comparable",
        reason: "one side of the comparison has no lines",
      };

    return this.gradePairing(
      "vendor_document",
      countLines.value.lines,
      paperLines.value.lines,
      countLines.value.identify,
    );
  }

  /**
   * One pairing, graded once. `left` is the side the differences are attributed
   * to — the side a person can answer, line by line.
   */
  private gradePairing(
    basis: "order" | "vendor_document",
    left: MatchableLine[],
    right: MatchableLine[],
    identify: (id: string) => DifferenceLine | null,
  ): DifferenceScan {
    const matched = matchLines(left, right);
    const rightById = new Map(right.map((r) => [r.id, r]));
    const leftById = new Map(left.map((l) => [l.id, l]));

    const differing: DifferenceLine[] = [];
    for (const m of [...matched.applied, ...matched.suggested]) {
      const r = rightById.get(m.orderLineId);
      const l = leftById.get(m.documentLineId);
      if (!r || !l) continue;
      if (m.substitution || Math.abs(r.qtyBottles - l.qtyBottles) > 0.001) {
        const line = identify(m.documentLineId);
        if (line)
          differing.push({
            ...line,
            why: m.substitution
              ? "a different item arrived"
              : `${l.qtyBottles} against ${r.qtyBottles}`,
          });
      }
    }

    const unmatched: DifferenceLine[] = [];
    for (const id of matched.unmatchedDocumentLineIds) {
      const line = identify(id);
      if (line)
        unmatched.push({
          ...line,
          why: "it pairs with nothing on the other document",
        });
    }

    return { status: "compared", basis, differing, unmatched };
  }

  /**
   * Document lines as the matcher wants them, plus the identity a person can
   * answer: which document, which line number, what it says it is.
   */
  private async linesFor(documentIds: string[]): Promise<
    ReadResult<{
      lines: MatchableLine[];
      identify: (id: string) => DifferenceLine | null;
    }>
  > {
    const read = await this.db
      .getClient()
      .from("procurement_document_lines")
      .select(
        "id, document_id, line_no, vendor_sku, description, vintage, format_ml, qty_bottles, unit_price",
      )
      .in("document_id", documentIds);
    if (read.error)
      return {
        ok: false,
        error: `procurement_document_lines read failed: ${read.error.message}`,
      };
    const rows = (read.data ?? []) as unknown as {
      id: string;
      document_id: string;
      line_no: number | null;
      vendor_sku: string | null;
      description: string | null;
      vintage: number | null;
      format_ml: number | null;
      qty_bottles: number | null;
      unit_price: number | null;
    }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      ok: true,
      value: {
        lines: rows.map((l) => ({
          id: l.id,
          vendorSku: l.vendor_sku,
          description: l.description,
          vintage: l.vintage,
          formatMl: l.format_ml,
          qtyBottles: Number(l.qty_bottles ?? 0),
          unitPrice: l.unit_price == null ? null : Number(l.unit_price),
        })),
        identify: (id: string) => {
          const r = byId.get(id);
          // A line whose number the row does not carry cannot be answered by
          // (document, line) — and an unanswerable line must not silently
          // become an unblocking one, so it is dropped from the scan rather
          // than counted as a difference nobody can clear.
          if (!r || r.line_no == null) return null;
          return {
            documentId: r.document_id,
            lineNo: r.line_no,
            label: r.description ?? r.vendor_sku ?? `line ${r.line_no}`,
          };
        },
      },
    };
  }
}
