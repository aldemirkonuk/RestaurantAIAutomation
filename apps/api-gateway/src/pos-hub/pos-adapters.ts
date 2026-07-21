import { CanonicalCheck, CanonicalItem } from "./pos-types";

/**
 * POS adapters — one function per provider: raw payload → CanonicalCheck.
 *
 * Money convention: Square/Clover speak minor units (cents/kuruş) → divide by
 * 100; Toast speaks major units. Adapters never touch the database — the hub
 * service owns validation, wine mapping, and the pos_checks upsert.
 */

export interface PosAdapter {
  key: string;
  /** Normalize one raw payload into zero-or-more canonical checks. */
  normalize(payload: any): CanonicalCheck[];
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n / 100;
};

// ---------------------------------------------------------------------------
// Generic — the canonical shape itself (webhook + import path)
// ---------------------------------------------------------------------------

export const genericAdapter: PosAdapter = {
  key: "generic_webhook",
  normalize(payload: any): CanonicalCheck[] {
    const rows: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.checks)
        ? payload.checks
        : [payload];
    return rows
      .filter((r) => r && (r.externalCheckId || r.external_check_id))
      .map((r) => ({
        externalCheckId: String(r.externalCheckId ?? r.external_check_id),
        openedAt: String(r.openedAt ?? r.opened_at ?? new Date().toISOString()),
        closedAt: r.closedAt ?? r.closed_at ?? null,
        tableRef: r.tableRef ?? r.table_ref ?? r.table ?? null,
        serverExternalId: r.serverExternalId ?? r.server_external_id ?? null,
        serverName: r.serverName ?? r.server_name ?? r.server ?? null,
        covers: num(r.covers),
        subtotal: num(r.subtotal),
        total: num(r.total),
        tip: num(r.tip),
        items: (Array.isArray(r.items) ? r.items : []).map(
          (it: any): CanonicalItem => ({
            name: String(it.name ?? "unknown"),
            externalItemId: it.externalItemId ?? it.external_item_id ?? null,
            category: it.category ?? null,
            qty: num(it.qty ?? it.quantity) ?? 1,
            price: num(it.price) ?? 0,
            is_wine: typeof it.is_wine === "boolean" ? it.is_wine : undefined,
            master_wine_id: it.master_wine_id ?? null,
          }),
        ),
        raw: r,
      }));
  },
};

// ---------------------------------------------------------------------------
// Square — Orders API (order object or webhook envelope)
// ---------------------------------------------------------------------------

export const squareAdapter: PosAdapter = {
  key: "square",
  normalize(payload: any): CanonicalCheck[] {
    const orders: any[] = Array.isArray(payload?.orders)
      ? payload.orders
      : payload?.data?.object?.order
        ? [payload.data.object.order] // webhook envelope
        : payload?.order
          ? [payload.order]
          : payload?.id
            ? [payload]
            : [];
    return orders
      .filter((o) => o?.id)
      .map((o) => ({
        externalCheckId: String(o.id),
        openedAt: o.created_at ?? new Date().toISOString(),
        closedAt:
          o.state === "COMPLETED"
            ? (o.closed_at ?? o.updated_at ?? null)
            : null,
        tableRef: o.ticket_name ?? null,
        serverExternalId: o.employee_id ?? null,
        serverName: null,
        covers: null,
        subtotal: cents(o.net_amounts?.total_money?.amount),
        total: cents(o.total_money?.amount),
        tip: cents(o.total_tip_money?.amount),
        items: (o.line_items ?? []).map(
          (li: any): CanonicalItem => ({
            name: String(li.name ?? "unknown"),
            externalItemId: li.catalog_object_id ?? null,
            category: null,
            qty: num(li.quantity) ?? 1,
            price: cents(li.base_price_money?.amount) ?? 0,
          }),
        ),
        raw: o,
      }));
  },
};

// ---------------------------------------------------------------------------
// Clover — Orders v3 (expanded lineItems + employee)
// ---------------------------------------------------------------------------

export const cloverAdapter: PosAdapter = {
  key: "clover",
  normalize(payload: any): CanonicalCheck[] {
    const orders: any[] = Array.isArray(payload?.elements)
      ? payload.elements
      : payload?.id
        ? [payload]
        : [];
    return orders
      .filter((o) => o?.id)
      .map((o) => ({
        externalCheckId: String(o.id),
        openedAt: o.createdTime
          ? new Date(o.createdTime).toISOString()
          : new Date().toISOString(),
        closedAt:
          o.state === "locked" || o.state === "paid"
            ? o.modifiedTime
              ? new Date(o.modifiedTime).toISOString()
              : null
            : null,
        tableRef: o.orderType?.label ?? null,
        serverExternalId: o.employee?.id ?? null,
        serverName: o.employee?.name ?? null,
        covers: num(o.customers?.elements?.length),
        subtotal: null,
        total: cents(o.total),
        tip: cents(o.tipAmount),
        items: (o.lineItems?.elements ?? []).map(
          (li: any): CanonicalItem => ({
            name: String(li.name ?? "unknown"),
            externalItemId: li.item?.id ?? null,
            category: null,
            qty: num(li.unitQty) ?? 1,
            price: cents(li.price) ?? 0,
          }),
        ),
        raw: o,
      }));
  },
};

// ---------------------------------------------------------------------------
// Toast — check object (orders API) — bridges the existing ToastModule
// ---------------------------------------------------------------------------

export const toastAdapter: PosAdapter = {
  key: "toast",
  normalize(payload: any): CanonicalCheck[] {
    const checks: any[] = Array.isArray(payload?.checks)
      ? payload.checks
      : Array.isArray(payload)
        ? payload
        : payload?.guid
          ? [payload]
          : [];
    return checks
      .filter((c) => c?.guid)
      .map((c) => ({
        externalCheckId: String(c.guid),
        openedAt: c.openedDate ?? new Date().toISOString(),
        closedAt: c.closedDate ?? null,
        tableRef: c.table?.guid ?? c.table?.name ?? null,
        serverExternalId: c.server?.guid ?? null,
        serverName: c.server
          ? [c.server.firstName, c.server.lastName].filter(Boolean).join(" ") ||
            null
          : null,
        covers: num(c.numberOfGuests),
        subtotal: num(c.amount),
        total: num(c.totalAmount ?? c.amount),
        tip: num(c.tipAmount),
        items: (c.selections ?? []).map(
          (s: any): CanonicalItem => ({
            name: String(s.displayName ?? s.itemName ?? "unknown"),
            externalItemId: s.item?.guid ?? null,
            category: s.salesCategory?.name ?? null,
            qty: num(s.quantity) ?? 1,
            price: num(s.price) ?? 0,
          }),
        ),
        raw: c,
      }));
  },
};

export const ADAPTERS: Record<string, PosAdapter> = {
  generic_webhook: genericAdapter,
  csv_import: { ...genericAdapter, key: "csv_import" },
  square: squareAdapter,
  clover: cloverAdapter,
  toast: toastAdapter,
};
