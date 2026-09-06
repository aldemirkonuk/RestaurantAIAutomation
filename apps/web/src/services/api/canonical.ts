/**
 * The canonical document API (ADR 0104 D12 slices 2 and 3).
 *
 * Two writes live here, and only two: the correction door and the per-field
 * `verified_by` tick of ADR 0104 D5. Neither edits anything — both APPEND a
 * revision and an audit row the database refuses to update or delete. The claim
 * workflow and the mapping memory are still later slices.
 *
 * The shapes mirror `apps/api-gateway/src/procurement/canonical/canonical-types.ts`
 * and `delivery-spine.service.ts`. Two nullabilities carry meaning and must not
 * be collapsed on the way in:
 *
 *   `deliveries: null`  a read FAILED, and `failedRead` says which. It is NOT
 *                       "this document is on no delivery" — that is `[]`.
 *   `confidence`        never rendered as a number (ADR 0104 D4). It is typed
 *                       here because the object carries it; the page routes on
 *                       it and prints named exceptions instead.
 */

import { apiClient } from "./client";

export type Source =
  | "extracted"
  | "embedded_xml"
  | "edi"
  | "portal"
  | "learned_from_vendor"
  | "carried_from_po"
  | "human_entered"
  | "human_corrected"
  | "computed";

export interface FieldEnvelope<T> {
  value: T | null;
  unit?: string | null;
  currency?: string | null;
  source: Source;
  confidence: number | null;
  page?: number | null;
  bbox?: [number, number, number, number] | null;
  verified_by?: string | null;
  verified_at?: string | null;
  /** The literal glyphs the paper printed. `null` = we did not keep it. */
  as_printed?: string | null;
  revision: number;
}

export interface AllowanceCharge {
  isCharge: FieldEnvelope<boolean>;
  amount: FieldEnvelope<number>;
  baseAmount?: FieldEnvelope<number>;
  percentage?: FieldEnvelope<number>;
  reasonCode: FieldEnvelope<string>;
  reason: FieldEnvelope<string>;
  vatCategory?: FieldEnvelope<string>;
  vatRate?: FieldEnvelope<number>;
}

export interface ExtractedLine {
  lineId: FieldEnvelope<string>;
  description: FieldEnvelope<string>;
  sellerItemId: FieldEnvelope<string>;
  quantity: FieldEnvelope<number>;
  unit: FieldEnvelope<string>;
  netPrice: FieldEnvelope<number>;
  /** BT-149 — the quantity the price is stated FOR. */
  priceBaseQuantity: FieldEnvelope<number>;
  /** BT-150 — that quantity's unit. */
  priceBaseUnit: FieldEnvelope<string>;
  netAmount: FieldEnvelope<number>;
  /**
   * What the line IS: `goods`, `deposit` or `fee`.
   *
   * OPTIONAL here and required on the gateway, deliberately: a stored revision
   * written before this field existed carries no `lineKind`, and typing it as
   * required would make the client claim every such line is goods.
   */
  lineKind?: FieldEnvelope<string>;
  allowancesCharges: AllowanceCharge[];
  vatCategory: FieldEnvelope<string>;
  vatRate: FieldEnvelope<number>;
  vintage: FieldEnvelope<number>;
  lot: FieldEnvelope<string>;
  formatMl: FieldEnvelope<number>;
  freeGoodsQty: FieldEnvelope<number>;
}

export interface ExtractedParty {
  name: FieldEnvelope<string>;
  vatIdentifier: FieldEnvelope<string>;
  identifier: FieldEnvelope<string>;
  address: FieldEnvelope<string>;
  electronicAddress: FieldEnvelope<string>;
}

export interface VatBreakdownEntry {
  category: FieldEnvelope<string>;
  rate: FieldEnvelope<number>;
  taxableAmount: FieldEnvelope<number>;
  taxAmount: FieldEnvelope<number>;
  exemptionReason?: FieldEnvelope<string>;
}

export interface ExtractedTotals {
  linesNetTotal: FieldEnvelope<number>;
  allowancesTotal: FieldEnvelope<number>;
  chargesTotal: FieldEnvelope<number>;
  taxExclusiveAmount: FieldEnvelope<number>;
  taxAmount: FieldEnvelope<number>;
  taxInclusiveAmount: FieldEnvelope<number>;
  paidAmount: FieldEnvelope<number>;
  roundingAmount: FieldEnvelope<number>;
  amountDue: FieldEnvelope<number>;
}

export interface Extracted {
  documentNumber: FieldEnvelope<string>;
  issueDate: FieldEnvelope<string>;
  typeCode: FieldEnvelope<string>;
  currency: FieldEnvelope<string>;
  paymentDueDate: FieldEnvelope<string>;
  paymentTerms: FieldEnvelope<string>;
  seller: ExtractedParty;
  buyer: ExtractedParty;
  purchaseOrderReference: FieldEnvelope<string>;
  despatchAdviceReference: FieldEnvelope<string>;
  precedingInvoiceReference: FieldEnvelope<string>;
  actualDeliveryDate: FieldEnvelope<string>;
  deliveryLocation: FieldEnvelope<string>;
  lines: ExtractedLine[];
  allowancesCharges: AllowanceCharge[];
  totals: ExtractedTotals;
  vatBreakdown: VatBreakdownEntry[];
}

export interface ResolvedLine {
  lineIndex: number;
  inventoryId: string | null;
  masterWineId: string | null;
  canonicalUom: string | null;
  packSize: number | null;
  qtyBottles: number | null;
  matchMethod: string | null;
  matchConfidence: number | null;
  vintage: number | null;
  lot: string | null;
}

/**
 * ADR 0103 A6 — `"not_counted"` is a REAL value and renders as the words
 * "not counted". It is never 0 and never silently equal to shipped or billed.
 */
export type ReceivedQuantity = number | "not_counted";

export interface AdjudicatedLine {
  lineIndex: number;
  ordered: number | null;
  shipped: number | null;
  received: ReceivedQuantity;
  billed: number | null;
  verdict: string;
  reason: string | null;
  moneyAtRisk: number | null;
}

export interface InvariantResult {
  id: string;
  rule: string | null;
  path: string | null;
  /** `null` = the invariant RAN and had nothing to test. Never a pass. */
  holds: boolean | null;
  expected: unknown;
  found: unknown;
  explanation: string;
}

export interface Adjudicated {
  lines: AdjudicatedLine[];
  tiesOut: boolean | null;
  tieOutDeltaCents: number | null;
  verdicts: InvariantResult[];
}

export interface CanonicalDocument {
  documentId: string;
  restaurantId: string;
  docType: string;
  direction: "issued_by_vendor" | "issued_by_us";
  jurisdiction: "TR" | "US-CA" | "unknown" | null;
  revision: number;
  layer1: Extracted;
  layer2: { providerId: string | null; lines: ResolvedLine[] };
  layer3: Adjudicated;
}

export interface SpineDocument {
  documentId: string;
  role: string;
  docType: string | null;
  docNumber: string | null;
  docDate: string | null;
  status: string | null;
  total: number | null;
  currency: string | null;
  createdAt: string | null;
  isSelected: boolean;
}

export interface DeliverySpine {
  deliveryId: string;
  state: string;
  provenance: string;
  deliveredAt: string | null;
  agreedAt: string | null;
  verifiedAt: string | null;
  jurisdiction: string | null;
  providerId: string | null;
  selectedRole: string;
  documents: SpineDocument[];
}

/**
 * One entry in the append-only correction log (ADR 0104 D5).
 *
 * `before` is what the field said BEFORE — the half a vendor dispute is argued
 * from, and the reason a correction is a new row rather than an edit.
 */
export interface CorrectionLogEntry {
  revision: number;
  /** `correction` changed the value; `verification` is the per-field tick. */
  kind: "correction" | "verification";
  path: string;
  /** The field in words — "Unit price, line 4". */
  label: string;
  before: FieldEnvelope<unknown> | null;
  after: FieldEnvelope<unknown> | null;
  reason: string | null;
  correctedBy: string | null;
  /** The person's name, or null when we hold no row for them. */
  correctedByName: string | null;
  correctedAt: string;
}

export interface CorrectionOutcome {
  revision: number;
  entry: CorrectionLogEntry;
  document: CanonicalDocument;
}

export interface CanonicalDocumentResponse {
  canonical: CanonicalDocument;
  /** `null` = a read failed (see `failedRead`); `[]` = on no delivery. */
  deliveries: DeliverySpine[] | null;
  siblings: SpineDocument[] | null;
  original: {
    imageUrl: string | null;
    /** Why there is no link, when there is none. */
    reason: string | null;
    contentType: string | null;
    filename: string | null;
    /** Not derivable from any column we hold — stated as unknown. */
    pages: number | null;
  };
  intake: {
    status: string | null;
    verdict: string | null;
    reason: string | null;
    sourceChannel: string | null;
    extractionModel: string | null;
    sha256: string | null;
    createdAt: string | null;
  };
  /**
   * `null` = the log could not be read and `failedRead` says so; `[]` = nobody
   * has corrected or verified a field on this document. Collapsing the two
   * would render a broken query as "this document has never been touched".
   */
  corrections: CorrectionLogEntry[] | null;
  /** True of the READ, not of the document (e.g. a schema lag). */
  notes?: string[];
  failedRead?: string[];
}

export const canonicalApi = {
  async document(id: string): Promise<CanonicalDocumentResponse> {
    const { data } = await apiClient.get(
      `/procurement/documents/${id}/canonical`,
    );
    return data;
  },

  async delivery(id: string): Promise<{ delivery: DeliverySpine }> {
    const { data } = await apiClient.get(`/procurement/deliveries/${id}`);
    return data;
  },

  /**
   * Correct one layer-1 field (ADR 0104 D5).
   *
   * `value: null` is a real correction and means "the document states nothing
   * here" — the answer when an extraction invented a figure the paper never
   * printed. The gateway refuses any path outside its closed list with a 400
   * that names the field, so nothing here needs to guess.
   */
  async correctField(
    documentId: string,
    body: { path: string; value: unknown; reason?: string },
  ): Promise<CorrectionOutcome> {
    const { data } = await apiClient.post(
      `/procurement/documents/${documentId}/corrections`,
      body,
    );
    return data;
  },

  /** The per-field `verified_by` tick. The value and its source are unchanged. */
  async verifyField(
    documentId: string,
    path: string,
  ): Promise<CorrectionOutcome> {
    const { data } = await apiClient.post(
      `/procurement/documents/${documentId}/fields/verify`,
      { path },
    );
    return data;
  },
};
