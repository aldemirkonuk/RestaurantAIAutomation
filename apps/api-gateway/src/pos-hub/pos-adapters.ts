import { CanonicalCheck, CanonicalItem, checkChannelOf } from "./pos-types";

/**
 * POS adapters — one function per provider: raw payload → CanonicalCheck.
 *
 * Money convention: Square/Clover speak minor units (cents/kuruş) → divide by
 * 100; Toast speaks major units. Adapters never touch the database — the hub
 * service owns validation, wine mapping, and the pos_checks upsert.
 *
 * Line convention: `price` is the price of ONE unit and `qty` the units rung,
 * so price × qty is the line's sale (CanonicalItem, pos-types.ts; ADR 0298's
 * sales, decisions 2 and 8, sum exactly that). Which amount a unit's price
 * counts is each provider's, as on main: Square and Clover give list price,
 * before modifiers and discounts, and Toast its net amount. Which one every
 * line should carry is OD-244. Each field is named at its adapter.
 */

export interface PosAdapter {
  key: string;
  /** Normalize one raw payload into zero-or-more canonical checks. */
  normalize(payload: any): CanonicalCheck[];
}

/**
 * A number, or null when the provider did not give one.
 *
 * The null/undefined/"" guard is the whole point and was missing until
 * 2026-09-05: `Number(null)` is `0`, and `0` is finite, so an explicit
 * `covers: null` — the honest answer from a POS that structurally cannot
 * report covers, Square being the case that measured it — was stored as a
 * table that seated nobody. 42 of 42 canonical checks on the Square day sent
 * `covers: null` and read back `0`. Omitted keys happened to survive
 * (`Number(undefined)` is NaN), which is why the SimPOS lens saw 44 nulls on
 * the same column: the two runs landed on opposite sides of one coercion.
 *
 * A real zero still reads as zero — a comped check took no money, and that is
 * a fact, not an absence. ADR 0105 D5, ADR 0020.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n / 100;
};

/**
 * Clover's `unitQty` is set only on a line priced per unit (by weight or
 * measure), as a fixed-point integer scaled by 1000: 2500 is 2.5 units, and
 * the line's total is price × unitQty / 1000. A fixed-price line has none,
 * since Clover rings each unit as its own line. Read raw, 1.5 kg was 1500.
 * This trusts the sender to follow Clover's scale: a `unitQty` of 1 meant as
 * one unit reads as 0.001, and nothing here can tell the two apart.
 */
const cloverQty = (v: unknown): number => {
  const n = num(v);
  return n === null ? 1 : n / 1000;
};

/**
 * One unit's price on a Toast selection: its `price` over its quantity.
 * Toast's Selection schema
 * (doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection)
 * gives `price` as the "Net price for this selection", after its discounts
 * and the check's, with its quantity and modifiers in it, so read raw as a
 * unit price a two-glass line counted four glasses. It is the only amount on
 * a selection with the modifiers in: `receiptLinePrice` leaves them out (a
 * glass priced by its pour reads 0), and `preDiscountPrice` is documented as
 * receiptLinePrice × quantity. This keeps main's net basis for every Toast
 * line and changes only the arithmetic; the basis is OD-244's, an assumption
 * stated in tech-debt.d (fix-pos-lines-carry-unit-price), not an answer.
 */
const toastUnitPrice = (s: any, qty: number): number => {
  const total = num(s.price);
  return total === null || qty === 0 ? 0 : total / qty;
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
        voided: Boolean(r.voided ?? r.is_voided ?? false),
        tableRef: r.tableRef ?? r.table_ref ?? r.table ?? null,
        // ADR 0302: read exactly, never guessed from the table ref.
        channel: checkChannelOf(r.channel),
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
            // base_price_money is "the base price for a single unit of the
            // line item" (Square, OrderLineItem).
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
        // An order type ("Dine In", "To Go", a house's own "Street Fair") is
        // not a table. Clover's order object has no table field (its field
        // list at docs.clover.com/dev/reference/ordercreateorder, read
        // 2026-10-04); `title` and `note` are free text, and reading either
        // as a table would be a guess. Which order types are booth or event
        // checks is the owner's to map once a Clover house connects (ADR
        // 0302, fork AW24-b: "Wait, then owner maps"), so the channel stays
        // null and the order type stays in `raw`.
        tableRef: null,
        channel: null,
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
            qty: cloverQty(li.unitQty),
            // `price` is one unit's, before modifiers and discounts.
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
        items: (c.selections ?? []).map((s: any): CanonicalItem => {
          const qty = num(s.quantity) ?? 1;
          return {
            name: String(s.displayName ?? s.itemName ?? "unknown"),
            externalItemId: s.item?.guid ?? null,
            category: s.salesCategory?.name ?? null,
            qty,
            price: toastUnitPrice(s, qty),
          };
        }),
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
