import { CanonicalCheck, CanonicalItem, checkChannelOf } from "./pos-types";

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
/**
 * A till's voided flag, read strictly. `Boolean("false")` is `true`, which
 * voided real checks (sim F-397): revenue dropped out and stock went up.
 * Absent reads as not voided; a value that is neither yes nor no is returned
 * as `unread` so ingest() can refuse the check and say why.
 */
export const readVoided = (v: unknown): { voided: boolean; unread?: unknown } => {
  if (v === null || v === undefined || v === "") return { voided: false };
  if (typeof v === "boolean") return { voided: v };
  if (typeof v === "number") {
    if (v === 1) return { voided: true };
    if (v === 0) return { voided: false };
    return { voided: false, unread: v };
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y", "t"].includes(s)) return { voided: true };
    if (["false", "0", "no", "n", "f"].includes(s)) return { voided: false };
  }
  return { voided: false, unread: v };
};
/**
 * A money field from a till that may write it the Turkish way. `Number()`
 * read "1.250,00" as nothing and "1.350" as 1.35 (sim F-396): a 1,250 lira
 * check stored as empty or a thousand times too small, with no error.
 *
 * Read: a number as is; a string with both separators takes the last one as
 * the decimal mark ("1.250,00" and "1,250.00" are both 1250); a lone comma
 * with one or two digits after it is a decimal comma ("100,00"). A lone
 * separator followed by exactly three digits ("1.250", "1,250") is a
 * thousands mark in one locale and a decimal in the other, so it is not
 * guessed: it comes back as `unread`, and so does anything else that is not
 * a number. Currency signs and spaces are dropped first.
 */
export const readMoney = (v: unknown): { value: number | null; unread?: unknown } => {
  if (v === null || v === undefined || v === "") return { value: null };
  if (typeof v === "number") return Number.isFinite(v) ? { value: v } : { value: null, unread: v };
  if (typeof v !== "string") return { value: null, unread: v };
  const s = v.replace(/[\s\u00a0₺$€£]|TL|TRY/gi, "");
  if (s === "") return { value: null };
  if (!/^-?[\d.,]+$/.test(s)) return { value: null, unread: v };
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let plain: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    // Every group after the first is three digits, and the decimal mark
    // comes once, after the groups: "1,25.50" and "1.2,5" are not amounts.
    const [whole, frac, ...extra] = s.split(decimal);
    const groups = whole.split(group);
    if (extra.length > 0 || frac.includes(group) || groups.slice(1).some((g) => g.length !== 3)) {
      return { value: null, unread: v };
    }
    plain = `${groups.join("")}.${frac}`;
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep === null) plain = s;
    else {
      const parts = s.split(sep);
      const tail = parts[parts.length - 1];
      if (parts.length > 2) {
        // "1.250.000": only a thousands mark repeats.
        if (parts.slice(1).every((p) => p.length === 3)) plain = parts.join("");
        else return { value: null, unread: v };
      } else if (tail.length === 3) return { value: null, unread: v };
      else plain = parts.join(".");
    }
  }
  const n = Number(plain);
  return Number.isFinite(n) ? { value: n } : { value: null, unread: v };
};

/** The check's money fields, read with readMoney; the first unread one is named. */
const moneyOf = (r: any) => {
  const out: {
    subtotal: number | null;
    total: number | null;
    tip: number | null;
    moneyUnread?: { field: string; value: unknown };
  } = { subtotal: null, total: null, tip: null };
  for (const field of ["subtotal", "total", "tip"] as const) {
    const m = readMoney(r[field]);
    out[field] = m.value;
    if ("unread" in m && !out.moneyUnread) out.moneyUnread = { field, value: m.unread };
  }
  (Array.isArray(r.items) ? r.items : []).forEach((it: any, i: number) => {
    const m = readMoney(it?.price);
    if ("unread" in m && !out.moneyUnread) {
      out.moneyUnread = { field: `items[${i}].price`, value: m.unread };
    }
  });
  return out;
};

const voidedOf = (v: unknown): { voided: boolean; voidedUnread?: unknown } => {
  const r = readVoided(v);
  return "unread" in r ? { voided: false, voidedUnread: r.unread } : { voided: r.voided };
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
        ...voidedOf(r.voided ?? r.is_voided),
        externalCheckId: String(r.externalCheckId ?? r.external_check_id),
        openedAt: String(r.openedAt ?? r.opened_at ?? new Date().toISOString()),
        closedAt: r.closedAt ?? r.closed_at ?? null,
        tableRef: r.tableRef ?? r.table_ref ?? r.table ?? null,
        // ADR 0302: read exactly, never guessed from the table ref.
        channel: checkChannelOf(r.channel),
        serverExternalId: r.serverExternalId ?? r.server_external_id ?? null,
        serverName: r.serverName ?? r.server_name ?? r.server ?? null,
        covers: num(r.covers),
        ...moneyOf(r),
        items: (Array.isArray(r.items) ? r.items : []).map(
          (it: any): CanonicalItem => ({
            name: String(it.name ?? "unknown"),
            externalItemId: it.externalItemId ?? it.external_item_id ?? null,
            category: it.category ?? null,
            qty: num(it.qty ?? it.quantity) ?? 1,
            price: readMoney(it.price).value ?? 0,
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
