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
    const differs = await this.notifyIfItDiffersFromTheOrder(delivery, docs);

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
      await this.notifyIfItDiffersFromTheOrder(delivery, [
        { documentId, role },
      ]);
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
   * D8's first notification — "this delivery differs from your order on N lines",
   * at the door, which is the only moment it is cheap.
   *
   * WHAT IT SAYS WHEN IT CANNOT TELL. With no order there is nothing to differ
   * FROM, and the notification is not sent — `null` comes back, and the caller
   * reports `differsOnLines: null` rather than 0. A zero would say "we compared
   * and everything matched", which is the sentence this repository's standing
   * fault is made of. Lines the matcher could not pair are counted and named
   * separately from lines that genuinely disagree.
   */
  private async notifyIfItDiffersFromTheOrder(
    delivery: DeliveryRow,
    docs: { documentId: string; role: DeliveryRole }[],
  ): Promise<number | null> {
    const comparable = docs.filter(
      (d) => d.role === "door_count" || d.role === "invoice",
    );
    if (!comparable.length) return null;

    /**
     * WITH NO ORDER THERE IS STILL SOMETHING TO DIFFER FROM.
     *
     * D8's sentence is "this delivery differs from your order on N lines", and
     * the first draft of this method simply returned `null` when there was no
     * order. That silences the notification on exactly the case ADR 0103 D5
     * exists for — an UNORDERED delivery, where nobody has any prior number at
     * all and the door count against the vendor's own paperwork is the ONLY
     * comparison available. Measured on the sim tenant on 2026-09-05: zero
     * purchase orders, so the founder's asked-for notification could not fire
     * on any delivery there.
     *
     * So the basis is chosen, and the sentence says which one it used: the
     * ORDER when one preceded the goods, otherwise the VENDOR'S DOCUMENT
     * against our own count. Both are `matchLines` over the same shapes; what
     * changes is what the reader is being told they disagree with.
     */
    if (!delivery.order_id)
      return this.notifyIfTheCountDiffersFromThePaperwork(delivery);

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
      this.db
        .getClient()
        .from("procurement_document_lines")
        .select(
          "id, vendor_sku, description, vintage, format_ml, qty_bottles, unit_price",
        )
        .in(
          "document_id",
          comparable.map((d) => d.documentId),
        ),
    ]);

    if (orderRead.error || docLines.error) {
      // Cannot compare is NOT "no differences". Nothing is sent, and the caller
      // gets null so the screen can say the comparison did not run.
      this.logger.warn(
        `delivery ${delivery.id}: the order comparison could not run — ${orderRead.error?.message ?? docLines.error?.message}`,
      );
      return null;
    }

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

    const documentLines: MatchableLine[] = (
      (docLines.data ?? []) as unknown as {
        id: string;
        vendor_sku: string | null;
        description: string | null;
        vintage: number | null;
        format_ml: number | null;
        qty_bottles: number | null;
        unit_price: number | null;
      }[]
    ).map((l) => ({
      id: l.id,
      vendorSku: l.vendor_sku,
      description: l.description,
      vintage: l.vintage,
      formatMl: l.format_ml,
      qtyBottles: Number(l.qty_bottles ?? 0),
      unitPrice: l.unit_price == null ? null : Number(l.unit_price),
    }));

    if (!orderLines.length || !documentLines.length) return null;

    const matched = matchLines(documentLines, orderLines);
    const orderById = new Map(orderLines.map((o) => [o.id, o]));
    const docById = new Map(documentLines.map((d) => [d.id, d]));

    let differing = 0;
    for (const m of [...matched.applied, ...matched.suggested]) {
      const o = orderById.get(m.orderLineId);
      const d = docById.get(m.documentLineId);
      if (!o || !d) continue;
      if (m.substitution || Math.abs(o.qtyBottles - d.qtyBottles) > 0.001)
        differing += 1;
    }
    const unmatched = matched.unmatchedDocumentLineIds.length;

    if (!differing && !unmatched) return 0;

    await this.notifications.persistForRestaurant(
      delivery.restaurant_id,
      {
        type: "delivery_differs",
        title:
          differing > 0
            ? `This delivery differs from your order on ${differing} line(s)`
            : `This delivery has ${unmatched} line(s) that are not on your order`,
        message:
          `${differing} line(s) disagree with what you ordered` +
          (unmatched
            ? `, and ${unmatched} line(s) could not be matched to the order at all — which is a question, not a difference.`
            : ".") +
          " The door is the cheapest moment to say so.",
        priority: "high",
        actionUrl: `/deliveries/${delivery.id}`,
        actionLabel: "Open the delivery",
        groupKey: `delivery-differs:${delivery.id}`,
        metadata: {
          deliveryId: delivery.id,
          orderId: delivery.order_id,
          differingLines: differing,
          unmatchedLines: unmatched,
        },
      },
      { dedupeWithinMinutes: 60 * 6 },
    );
    return differing;
  }

  /**
   * The UNORDERED basis: our door count against the vendor's own document.
   *
   * Returns `null` when there is nothing to compare — no door count, no vendor
   * document, or a read that failed — and a NUMBER when a comparison actually
   * ran. `0` therefore means "compared, and nothing differed", which is a
   * different sentence from "we could not compare" and must never wear its
   * clothes.
   */
  private async notifyIfTheCountDiffersFromThePaperwork(
    delivery: DeliveryRow,
  ): Promise<number | null> {
    const joins = await this.db
      .getClient()
      .from("document_deliveries")
      .select("document_id, role")
      .eq("delivery_id", delivery.id);
    if (joins.error) {
      this.logger.warn(
        `delivery ${delivery.id}: the paperwork comparison could not run — ${joins.error.message}`,
      );
      return null;
    }
    const links = (joins.data ?? []) as unknown as {
      document_id: string;
      role: string;
    }[];
    const countIds = links
      .filter((l) => l.role === "door_count")
      .map((l) => l.document_id);
    const paperIds = links
      .filter((l) => l.role === "invoice" || l.role === "despatch_advice")
      .map((l) => l.document_id);
    if (!countIds.length || !paperIds.length) return null;

    const [countLines, paperLines] = await Promise.all([
      this.linesFor(countIds),
      this.linesFor(paperIds),
    ]);
    if (!countLines.ok || !paperLines.ok) {
      this.logger.warn(
        `delivery ${delivery.id}: the paperwork comparison could not run — ${(!countLines.ok && countLines.error) || (!paperLines.ok && paperLines.error)}`,
      );
      return null;
    }
    if (!countLines.value.length || !paperLines.value.length) return null;

    const matched = matchLines(countLines.value, paperLines.value);
    const paperById = new Map(paperLines.value.map((l) => [l.id, l]));
    const countById = new Map(countLines.value.map((l) => [l.id, l]));

    let differing = 0;
    for (const m of [...matched.applied, ...matched.suggested]) {
      const paper = paperById.get(m.orderLineId);
      const count = countById.get(m.documentLineId);
      if (!paper || !count) continue;
      if (
        m.substitution ||
        Math.abs(paper.qtyBottles - count.qtyBottles) > 0.001
      )
        differing += 1;
    }
    const unmatched = matched.unmatchedDocumentLineIds.length;
    if (!differing && !unmatched) return 0;

    await this.notifications.persistForRestaurant(
      delivery.restaurant_id,
      {
        type: "delivery_differs",
        title:
          differing > 0
            ? `This delivery differs from the vendor's paperwork on ${differing} line(s)`
            : `${unmatched} counted line(s) are on no vendor document`,
        message:
          `Nobody ordered this delivery, so there is no order to check it against — ` +
          `what we counted at the door is compared with what the vendor's own document says. ` +
          `${differing} line(s) disagree` +
          (unmatched
            ? `, and ${unmatched} counted line(s) appear on no vendor document at all — which is a question, not a difference.`
            : ".") +
          " The door is the cheapest moment to say so.",
        priority: "high",
        actionUrl: `/deliveries/${delivery.id}`,
        actionLabel: "Open the delivery",
        groupKey: `delivery-differs:${delivery.id}`,
        metadata: {
          deliveryId: delivery.id,
          basis: "door_count_vs_vendor_document",
          differingLines: differing,
          unmatchedLines: unmatched,
        },
      },
      { dedupeWithinMinutes: 60 * 6 },
    );
    return differing;
  }

  /** Document lines as the matcher wants them, for a set of documents. */
  private async linesFor(
    documentIds: string[],
  ): Promise<ReadResult<MatchableLine[]>> {
    const read = await this.db
      .getClient()
      .from("procurement_document_lines")
      .select(
        "id, vendor_sku, description, vintage, format_ml, qty_bottles, unit_price",
      )
      .in("document_id", documentIds);
    if (read.error)
      return {
        ok: false,
        error: `procurement_document_lines read failed: ${read.error.message}`,
      };
    return {
      ok: true,
      value: (
        (read.data ?? []) as unknown as {
          id: string;
          vendor_sku: string | null;
          description: string | null;
          vintage: number | null;
          format_ml: number | null;
          qty_bottles: number | null;
          unit_price: number | null;
        }[]
      ).map((l) => ({
        id: l.id,
        vendorSku: l.vendor_sku,
        description: l.description,
        vintage: l.vintage,
        formatMl: l.format_ml,
        qtyBottles: Number(l.qty_bottles ?? 0),
        unitPrice: l.unit_price == null ? null : Number(l.unit_price),
      })),
    };
  }
}
