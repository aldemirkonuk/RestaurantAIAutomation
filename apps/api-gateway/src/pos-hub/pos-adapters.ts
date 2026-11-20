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

/**
 * Voids and returns (QA round 5, POS-1). The hub knows one reversal: a check
 * with `voided: true` returns every line's stock under a key derived from the
 * sale's (`pos-hub.service.ts`, ADR 0093 D5) and is left out of every sales
 * read. Until 2026-11-07 only the generic adapter set it, so a Toast, Square
 * or Clover void kept its stock off the shelf and its money in sales. Each
 * provider now maps onto that one shape, three ways:
 *
 *  1. A whole check voided, cancelled or deleted is the same check id with
 *     `voided: true` and its lines as rung, so the void's keys are the sale's
 *     plus `:void` and a re-sent void moves nothing twice.
 *  2. A line voided before the sale was booked (a Toast selection voided on
 *     the check) stays at its index with quantity 0: it never sold, so it
 *     takes no stock and no sales, and the lines after it keep their keys.
 *  3. A line returned or refunded after the sale (a Square return order's
 *     return lines, a Clover line marked refunded) is its own voided check,
 *     `<order>:return:<event>` or `<order>:refund:<line>`, holding only what
 *     came back. Its stock returns once per POS event id, and its row is
 *     voided, so it never reads as a sale.
 */
const returnCheckId = (orderId: string, kind: string, eventId: string) =>
  `${orderId}:${kind}:${eventId}`;

/** An instant in ms, or null when the value does not read as one. */
const instantMs = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
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
      .flatMap((o): CanonicalCheck[] => {
        const closedAt =
          o.state === "COMPLETED"
            ? (o.closed_at ?? o.updated_at ?? null)
            : null;
        const sale: CanonicalCheck = {
          externalCheckId: String(o.id),
          openedAt: o.created_at ?? new Date().toISOString(),
          closedAt,
          // A CANCELED order is a void (way 1). Square never moves a COMPLETED
          // order to CANCELED, so a cancelled order never closed, never took
          // stock, and moves none now: it only leaves sales.
          voided: o.state === "CANCELED",
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
        };
        // Way 3. Square puts an itemized return on a NEW order whose
        // `returns[]` name the source order and the lines that came back
        // (developer.squareup.com/docs/orders-api/order-returns-exchanges);
        // the sale order is not edited. The return order's own money is
        // already net of the return (its `net_amounts` go negative), so this
        // order's own check above drops sales, and each return here carries
        // only stock: no money, voided, keyed by the return's uid.
        const returns: any[] = Array.isArray(o.returns) ? o.returns : [];
        const returned = returns
          .map((r, i): CanonicalCheck | null => {
            const lines: any[] = Array.isArray(r?.return_line_items)
              ? r.return_line_items
              : [];
            if (lines.length === 0) return null;
            const eventId = String(r?.uid ?? r?.source_order_id ?? i);
            return {
              externalCheckId: returnCheckId(String(o.id), "return", eventId),
              openedAt: o.created_at ?? new Date().toISOString(),
              closedAt,
              voided: true,
              tableRef: null,
              serverExternalId: o.employee_id ?? null,
              serverName: null,
              covers: null,
              subtotal: null,
              total: null,
              tip: null,
              items: lines.map(
                (li: any): CanonicalItem => ({
                  name: String(li.name ?? "unknown"),
                  externalItemId: li.catalog_object_id ?? null,
                  category: null,
                  qty: num(li.quantity) ?? 1,
                  price: cents(li.base_price_money?.amount) ?? 0,
                }),
              ),
              raw: r,
            };
          })
          .filter((c): c is CanonicalCheck => c !== null);
        return [sale, ...returned];
      });
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
      .flatMap((o): CanonicalCheck[] => {
        const openedAt = o.createdTime
          ? new Date(o.createdTime).toISOString()
          : new Date().toISOString();
        const closedAt =
          o.state === "locked" || o.state === "paid"
            ? o.modifiedTime
              ? new Date(o.modifiedTime).toISOString()
              : null
            : null;
        // Way 1. Clover's order has no void state; a deleted order carries
        // `deletedTimestamp` (Order schema, docs.clover.com ordergetorder,
        // read 2026-11-07). It is the same check, voided.
        const voided = instantMs(o.deletedTimestamp) !== null;
        const lineItems: any[] = o.lineItems?.elements ?? [];
        const sale: CanonicalCheck = {
          externalCheckId: String(o.id),
          openedAt,
          closedAt,
          voided,
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
          // A refunded line comes back on its own refund check below, every
          // time, so on a deleted order it stays in place at quantity 0: the
          // void returns only what the refund did not.
          items: lineItems.map((li) =>
            voided && isCloverRefund(li)
              ? { ...cloverLine(li), qty: 0 }
              : cloverLine(li),
          ),
          raw: o,
        };
        // Way 3. A refunded line keeps its place and quantity on the sale
        // (it sold, and its stock was taken), and is also returned on its own
        // voided check keyed by the line id: Clover marks a line `refunded`
        // once (LineItem schema, same page). The refund check is emitted on
        // every send, deleted or not, so its key is the one key a refunded
        // line ever comes back under: a refund seen first and a deletion seen
        // later return it once, not twice (the deleted sale holds it at 0).
        //
        // It closes only when its sale closed: an order still open took no
        // stock, so a refund on it has nothing to give back. The refund's own
        // time dates it when Clover gives one.
        const refundAt = (li: any): string | null => {
          if (closedAt === null) return null;
          const ms = instantMs(li.refund?.createdTime);
          return ms !== null ? new Date(ms).toISOString() : closedAt;
        };
        const refunded = lineItems.filter(isCloverRefund).map(
          (li): CanonicalCheck => ({
            externalCheckId: returnCheckId(
              String(o.id),
              "refund",
              String(li.id),
            ),
            openedAt,
            closedAt: refundAt(li),
            voided: true,
            tableRef: null,
            channel: null,
            serverExternalId: o.employee?.id ?? null,
            serverName: o.employee?.name ?? null,
            covers: null,
            subtotal: null,
            total: null,
            tip: null,
            items: [cloverLine(li)],
            raw: li,
          }),
        );
        return [sale, ...refunded];
      });
  },
};

/** A Clover line marked refunded, with the id its refund check is keyed by. */
const isCloverRefund = (li: any): boolean =>
  li?.refunded === true && Boolean(li?.id);

function cloverLine(li: any): CanonicalItem {
  return {
    name: String(li.name ?? "unknown"),
    externalItemId: li.item?.id ?? null,
    category: null,
    qty: cloverQty(li.unitQty),
    // `price` is one unit's, before modifiers and discounts.
    price: cents(li.price) ?? 0,
  };
}

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
      .map((c) => {
        // Way 1. Toast's Check carries `voided` and `deleted` (a check split
        // or merged away is deleted, and its lines ring again on the check
        // they moved to).
        const voided = c.voided === true || c.deleted === true;
        const closedMs = instantMs(c.closedDate);
        return {
          externalCheckId: String(c.guid),
          openedAt: c.openedDate ?? new Date().toISOString(),
          closedAt: c.closedDate ?? null,
          voided,
          tableRef: c.table?.guid ?? c.table?.name ?? null,
          serverExternalId: c.server?.guid ?? null,
          serverName: c.server
            ? [c.server.firstName, c.server.lastName]
                .filter(Boolean)
                .join(" ") || null
            : null,
          covers: num(c.numberOfGuests),
          subtotal: num(c.amount),
          total: num(c.totalAmount ?? c.amount),
          tip: num(c.tipAmount),
          items: (c.selections ?? []).map((s: any): CanonicalItem => {
            const rung = num(s.quantity) ?? 1;
            // Way 2. A selection Toast marks `voided` (Selection schema) stays
            // on the check. On a check that stands, it never sold: quantity 0.
            // On a voided check it rides the check's void, so it keeps its
            // quantity and comes back with the rest, unless it was voided
            // before the check closed, when it never took stock to return.
            const voidedBeforeClose =
              s.voided === true &&
              (!voided ||
                (closedMs !== null &&
                  instantMs(s.voidDate) !== null &&
                  (instantMs(s.voidDate) as number) < closedMs));
            const qty = voidedBeforeClose ? 0 : rung;
            return {
              name: String(s.displayName ?? s.itemName ?? "unknown"),
              externalItemId: s.item?.guid ?? null,
              category: s.salesCategory?.name ?? null,
              qty,
              price: toastUnitPrice(s, rung),
            };
          }),
          raw: c,
        };
      });
  },
};

export const ADAPTERS: Record<string, PosAdapter> = {
  generic_webhook: genericAdapter,
  csv_import: { ...genericAdapter, key: "csv_import" },
  square: squareAdapter,
  clover: cloverAdapter,
  toast: toastAdapter,
};
