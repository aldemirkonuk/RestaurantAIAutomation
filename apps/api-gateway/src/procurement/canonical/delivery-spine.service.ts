import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { ReadResult } from "./canonical-document.service";

/**
 * DeliverySpineService — the delivery (the commercial event) and every document
 * on it, for one document or one delivery.
 *
 * WHY THIS IS THE PAGE'S SPINE AND NOT A SIDEBAR (ADR 0104 D13, D7). The unit
 * of record is the delivery, not the invoice: a PO, an e-İrsaliye, a door count,
 * an invoice and a credit memo are five documents about ONE truck, and only the
 * event can state a line that appears on none of them. `document_deliveries` is
 * a join in both directions (ADR 0103 A2) — a consolidated weekly invoice sits
 * on several deliveries and a split shipment carries several invoices — so this
 * reads N deliveries for a document and N documents for each of those.
 *
 * A FAILED READ IS NEVER AN EMPTY SPINE (ADR 0067). supabase-js resolves with
 * `{ data, error }`, so `(data ?? [])` would turn a broken query into "this
 * document belongs to no delivery" — which the page is specified to render as a
 * collapsed spine, i.e. as a normal, complete answer. Every read here inspects
 * `error` and returns `{ ok: false }`; the caller surfaces that as `failedRead`.
 */

/** One document as it appears ON a delivery. */
export interface SpineDocument {
  documentId: string;
  /** Its role IN THIS delivery — not the same question as its `doc_type`. */
  role: string;
  docType: string | null;
  docNumber: string | null;
  docDate: string | null;
  status: string | null;
  total: number | null;
  currency: string | null;
  createdAt: string | null;
  /** True for the document the page is currently showing. */
  isSelected: boolean;
}

export interface DeliverySpine {
  deliveryId: string;
  state: string;
  /** `UNORDERED` is a permanent mark, not a workflow step (ADR 0103 D5). */
  provenance: string;
  deliveredAt: string | null;
  agreedAt: string | null;
  verifiedAt: string | null;
  jurisdiction: string | null;
  providerId: string | null;
  /** The role the SELECTED document plays on this delivery. */
  selectedRole: string;
  /** Every document on this delivery, oldest first. */
  documents: SpineDocument[];
}

const DELIVERY_COLUMNS =
  "id, state, provenance, delivered_at, agreed_at, verified_at, " +
  "jurisdiction, provider_id, restaurant_id";

const SIBLING_COLUMNS =
  "id, doc_type, doc_number, doc_date, status, total, currency, created_at";

const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "number" ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Oldest first: the spine is a timeline, so its order is the event's order. */
function byTime(a: SpineDocument, b: SpineDocument): number {
  const key = (d: SpineDocument) => d.docDate ?? d.createdAt ?? "";
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}

@Injectable()
export class DeliverySpineService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Every delivery this document sits on, each with the other documents on it.
   *
   * An EMPTY array is a real answer and means the document has been linked to no
   * delivery — the page collapses to the sheet. It is only ever returned when
   * the reads SUCCEEDED and found nothing.
   */
  async forDocument(
    restaurantId: string,
    documentId: string,
  ): Promise<ReadResult<DeliverySpine[]>> {
    const joins = await this.db
      .getClient()
      .from("document_deliveries")
      .select("delivery_id, role")
      .eq("document_id", documentId);

    if (joins.error)
      return {
        ok: false,
        error: `document_deliveries read failed for ${documentId}: ${joins.error.message}`,
      };

    const rows = (joins.data ?? []) as unknown as {
      delivery_id: string;
      role: string;
    }[];
    if (!rows.length) return { ok: true, value: [] };

    const roleByDelivery = new Map(rows.map((r) => [r.delivery_id, r.role]));
    return this.expand(
      restaurantId,
      Array.from(roleByDelivery.keys()),
      documentId,
      roleByDelivery,
    );
  }

  /** One delivery and its documents — the spine's own endpoint. */
  async byId(
    restaurantId: string,
    deliveryId: string,
  ): Promise<ReadResult<DeliverySpine | null>> {
    const expanded = await this.expand(
      restaurantId,
      [deliveryId],
      null,
      new Map(),
    );
    if (!expanded.ok) return expanded;
    // `null` here means "no such delivery for this restaurant" — the caller
    // turns it into a 404. It is reached only after a SUCCESSFUL read.
    return { ok: true, value: expanded.value[0] ?? null };
  }

  private async expand(
    restaurantId: string,
    deliveryIds: string[],
    selectedDocumentId: string | null,
    roleByDelivery: Map<string, string>,
  ): Promise<ReadResult<DeliverySpine[]>> {
    const deliveries = await this.db
      .getClient()
      .from("deliveries")
      .select(DELIVERY_COLUMNS)
      .in("id", deliveryIds)
      // Tenant isolation on a service-role read is this filter and nothing else.
      .eq("restaurant_id", restaurantId);

    if (deliveries.error)
      return {
        ok: false,
        error: `deliveries read failed for ${deliveryIds.join(", ")}: ${deliveries.error.message}`,
      };

    const deliveryRows = (deliveries.data ?? []) as unknown as {
      id: string;
      state: string;
      provenance: string;
      delivered_at: string | null;
      agreed_at: string | null;
      verified_at: string | null;
      jurisdiction: string | null;
      provider_id: string | null;
    }[];
    if (!deliveryRows.length) return { ok: true, value: [] };

    const visibleIds = deliveryRows.map((d) => d.id);

    const members = await this.db
      .getClient()
      .from("document_deliveries")
      .select("document_id, delivery_id, role")
      .in("delivery_id", visibleIds);

    if (members.error)
      return {
        ok: false,
        error: `document_deliveries membership read failed: ${members.error.message}`,
      };

    const memberRows = (members.data ?? []) as unknown as {
      document_id: string;
      delivery_id: string;
      role: string;
    }[];

    const documentIds = Array.from(
      new Set(memberRows.map((m) => m.document_id)),
    );

    const docs = documentIds.length
      ? await this.db
          .getClient()
          .from("procurement_documents")
          .select(SIBLING_COLUMNS)
          .in("id", documentIds)
          .eq("restaurant_id", restaurantId)
      : { data: [], error: null };

    if (docs.error)
      return {
        ok: false,
        error: `procurement_documents read failed for the spine: ${docs.error.message}`,
      };

    const byId = new Map(
      ((docs.data ?? []) as unknown as Record<string, unknown>[]).map((d) => [
        d.id as string,
        d,
      ]),
    );

    return {
      ok: true,
      value: deliveryRows.map((d): DeliverySpine => {
        const documents = memberRows
          .filter((m) => m.delivery_id === d.id)
          .map((m): SpineDocument => {
            const row = byId.get(m.document_id);
            // A membership row whose document did not come back is NOT dropped:
            // silently shortening the spine would under-report the event. Its
            // fields are null and its id is still on screen.
            return {
              documentId: m.document_id,
              role: m.role,
              docType: (row?.doc_type as string) ?? null,
              docNumber: (row?.doc_number as string) ?? null,
              docDate: (row?.doc_date as string) ?? null,
              status: (row?.status as string) ?? null,
              total: n(row?.total as number | string | null),
              currency: (row?.currency as string) ?? null,
              createdAt: (row?.created_at as string) ?? null,
              isSelected: m.document_id === selectedDocumentId,
            };
          })
          .sort(byTime);

        return {
          deliveryId: d.id,
          state: d.state,
          provenance: d.provenance,
          deliveredAt: d.delivered_at,
          agreedAt: d.agreed_at,
          verifiedAt: d.verified_at,
          jurisdiction: d.jurisdiction,
          providerId: d.provider_id,
          selectedRole: roleByDelivery.get(d.id) ?? "other",
          documents,
        };
      }),
    };
  }
}
