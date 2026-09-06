/**
 * The delivery API (ADR 0103 D1/D3/D6/D7, slice 3 stop 2).
 *
 * Every write here APPENDS a position or moves a state through a gate the
 * gateway enforces. Nothing in this file decides whether a delivery may be
 * agreed or verified — the gateway holds D3's two rules and D6's human gate, and
 * a client that re-implemented them would eventually disagree with the server
 * about whether something was agreed. The screen's job is to say what the gate
 * needs and to show the server's answer verbatim when it refuses.
 */

import { apiClient } from "./client";

export type DeliveryRole =
  | "purchase_order"
  | "despatch_advice"
  | "door_count"
  | "invoice"
  | "credit_memo"
  | "statement"
  | "other";

/** ADR 0103 D7. WRONG_VENUE is a rejection, not a discrepancy to negotiate. */
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

export interface DeliveryEvent {
  id: string;
  restaurantId?: string;
  providerId: string | null;
  orderId: string | null;
  state: string;
  /** `UNORDERED` is a permanent mark, not a workflow step (ADR 0103 D5). */
  provenance: string;
  jurisdiction: string | null;
  deliveredAt: string | null;
  agreedAt: string | null;
  /** WHICH of D3's two rules reached AGREED. Null until it is agreed. */
  agreedRule: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  lapsedAt: string | null;
  /** What the LAW deems, in words — never a claim that anyone here agreed. */
  lapseDeemed: string | null;
  amendedAt: string | null;
}

export interface Proposal {
  id: string;
  delivery_id: string;
  document_id: string | null;
  line_no: number | null;
  side: "restaurant" | "vendor";
  reason: ReasonClass;
  qty_proposed: number | null;
  unit_price_proposed: number | null;
  money_at_risk: number | null;
  evidence: unknown[];
  note: string | null;
  status: "open" | "accepted" | "countered" | "withdrawn";
  counters_proposal_id: string | null;
  proposed_by: string | null;
  proposed_at: string;
  responded_at: string | null;
  responded_by: string | null;
}

/** The gateway returns snake_case rows for the event; normalised once, here. */
function toEvent(row: Record<string, unknown>): DeliveryEvent {
  return {
    id: String(row.id),
    providerId: (row.provider_id as string) ?? null,
    orderId: (row.order_id as string) ?? null,
    state: String(row.state),
    provenance: String(row.provenance),
    jurisdiction: (row.jurisdiction as string) ?? null,
    deliveredAt: (row.delivered_at as string) ?? null,
    agreedAt: (row.agreed_at as string) ?? null,
    agreedRule: (row.agreed_rule as string) ?? null,
    verifiedAt: (row.verified_at as string) ?? null,
    verifiedBy: (row.verified_by as string) ?? null,
    lapsedAt: (row.lapsed_at as string) ?? null,
    lapseDeemed: (row.lapse_deemed as string) ?? null,
    amendedAt: (row.amended_at as string) ?? null,
  };
}

export interface DoorCountLine {
  lineNo: number;
  description?: string;
  vendorSku?: string;
  qty: number;
  uom: string;
  packSize?: number;
  vintage?: number;
  formatMl?: number;
}

/** The body both `propose` and `counter` take — declared once, so a counter
 *  cannot quietly grow a field the proposal door does not accept. */
export interface ProposalBody {
  side: "restaurant" | "vendor";
  reason: ReasonClass;
  documentId?: string;
  lineNo?: number;
  qtyProposedBottles?: number;
  unitPriceProposed?: number;
  moneyAtRisk?: number;
  evidence?: unknown[];
  note?: string;
}

export const deliveriesApi = {
  async event(id: string): Promise<DeliveryEvent> {
    const { data } = await apiClient.get(`/procurement/deliveries/${id}`);
    return toEvent(data.event);
  },

  async proposals(id: string): Promise<Proposal[]> {
    const { data } = await apiClient.get(
      `/procurement/deliveries/${id}/proposals`,
    );
    return data.proposals as Proposal[];
  },

  async propose(
    id: string,
    body: ProposalBody,
  ): Promise<{ proposalId: string; delivery: Record<string, unknown> }> {
    const { data } = await apiClient.post(
      `/procurement/deliveries/${id}/proposals`,
      body,
    );
    return data;
  },

  async counter(
    proposalId: string,
    body: ProposalBody,
  ): Promise<{ proposalId: string }> {
    const { data } = await apiClient.post(
      `/procurement/deliveries/proposals/${proposalId}/counter`,
      body,
    );
    return data;
  },

  async accept(proposalId: string): Promise<{ status: string }> {
    const { data } = await apiClient.post(
      `/procurement/deliveries/proposals/${proposalId}/accept`,
      {},
    );
    return data;
  },

  /** D3. The response names WHICH rule fired; a refusal names what is missing. */
  async agree(
    id: string,
  ): Promise<{ rule: string; alreadyAgreed: boolean; delivery: Record<string, unknown> }> {
    const { data } = await apiClient.post(
      `/procurement/deliveries/${id}/agree`,
      {},
    );
    return data;
  },

  /**
   * D6. A human, from AGREED only, and idempotent.
   *
   * Since ADR 0103 A1 this is where COST is settled: the goods went on the
   * shelf at the door, provisionally costed, and verification posts the agreed
   * price onto those lots. It never moves a quantity. `costNote` is the
   * sentence to render — including when nothing could be costed, which is a
   * real answer and not a failure.
   */
  async verify(
    id: string,
  ): Promise<{
    alreadyVerified: boolean;
    costNote: string;
    cost: {
      finalised: {
        inventoryId: string;
        unitCost: number;
        bottlesFinalised: number;
      }[];
      stillProvisional: { inventoryId: string; reason: string }[];
    } | null;
    delivery: Record<string, unknown>;
  }> {
    const { data } = await apiClient.post(
      `/procurement/deliveries/${id}/verify`,
      {},
    );
    return data;
  },

  /**
   * The door count — OUR document (ADR 0104 D11).
   *
   * A line nobody counted is simply not in `lines`; there is no zero and no
   * flag, because "not counted" is what the delivery already says about it.
   */
  async recordDoorCount(body: {
    lines: DoorCountLine[];
    providerId?: string;
    countedAt?: string;
    signedBy?: string;
    note?: string;
    photoBase64?: string;
    photoFilename?: string;
    photoMimeType?: string;
    createDelivery?: boolean;
    deliveryId?: string;
    orderId?: string;
    jurisdiction?: string;
  }): Promise<{
    documentId: string;
    delivery: Record<string, unknown> | null;
    /** NULL = no comparison was possible. 0 = compared, nothing differed. */
    differsOnLines: number | null;
    storageError?: string;
  }> {
    const { data } = await apiClient.post(
      "/procurement/documents/door-count",
      body,
    );
    return data;
  },
};
