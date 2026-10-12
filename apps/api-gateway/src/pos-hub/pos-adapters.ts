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
export const readVoided = (
  v: unknown,
): { voided: boolean; unread?: unknown } => {
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
export const readMoney = (
  v: unknown,
): { value: number | null; unread?: unknown } => {
  if (v === null || v === undefined || v === "") return { value: null };
  if (typeof v === "number")
    return Number.isFinite(v) ? { value: v } : { value: null, unread: v };
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
    if (
      extra.length > 0 ||
      frac.includes(group) ||
      groups.slice(1).some((g) => g.length !== 3)
    ) {
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
    if ("unread" in m && !out.moneyUnread)
      out.moneyUnread = { field, value: m.unread };
  }
  (Array.isArray(r.items) ? r.items : []).forEach((it: any, i: number) => {
    const m = readMoney(it?.price);
    if ("unread" in m && !out.moneyUnread) {
      out.moneyUnread = { field: `items[${i}].price`, value: m.unread };
    }
  });
  return out;
};

/**
 * F-1193: a line's quantity, read with readMoney's rules. `Number()` read a
 * Turkish till's "0,5" and "2,000" as nothing, and the line became one of
 * whatever it was, with no error. Absent is one, as before; present and not
 * read is one here too, but the check carries `qtyUnread` and ingest()
 * refuses it, as it refuses an unread amount.
 */
const qtyOf = (v: unknown): number => readMoney(v).value ?? 1;
/** The first line whose quantity was present and not read, named for errors[]. */
const qtyUnreadOf = (
  lines: any[],
  qtyField: (li: any) => unknown,
): { qtyUnread?: { field: string; value: unknown } } => {
  for (let i = 0; i < lines.length; i++) {
    const m = readMoney(qtyField(lines[i]));
    if ("unread" in m)
      return { qtyUnread: { field: `items[${i}].qty`, value: m.unread } };
  }
  return {};
};

const voidedOf = (v: unknown): { voided: boolean; voidedUnread?: unknown } => {
  const r = readVoided(v);
  return "unread" in r
    ? { voided: false, voidedUnread: r.unread }
    : { voided: r.voided };
};
const cents = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n / 100;
};
/**
 * F-639: which copy of a check this is, as the till says it. A version is a
 * whole number; a modified-at is an instant (ISO text, or epoch ms from
 * Clover). Anything else is no answer, and the hub then judges the copy only
 * by whether it would un-void or re-open a stored check.
 */
const versionOf = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const instantOf = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** F-641: the POS ids of a line's modifiers, kept in the order rung. */
const modifierIdsOf = (mods: unknown, idOf: (m: any) => unknown): string[] =>
  (Array.isArray(mods) ? mods : [])
    .map((m) => idOf(m))
    .filter(
      (id): id is string | number =>
        typeof id === "string" || typeof id === "number",
    )
    .map(String)
    .filter((id) => id !== "");

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
        // F-1194: a check with no opening time is dated by its closing time,
        // never by when it arrived; only an open check with neither keeps
        // the arrival time.
        openedAt: String(
          r.openedAt ??
            r.opened_at ??
            r.closedAt ??
            r.closed_at ??
            new Date().toISOString(),
        ),
        sourceVersion: versionOf(
          r.sourceVersion ?? r.source_version ?? r.version,
        ),
        sourceModifiedAt: instantOf(
          r.sourceModifiedAt ??
            r.source_modified_at ??
            r.modifiedAt ??
            r.modified_at ??
            r.updatedAt ??
            r.updated_at,
        ),
        closedAt: r.closedAt ?? r.closed_at ?? null,
        tableRef: r.tableRef ?? r.table_ref ?? r.table ?? null,
        // ADR 0302: read exactly, never guessed from the table ref.
        channel: checkChannelOf(r.channel),
        serverExternalId: r.serverExternalId ?? r.server_external_id ?? null,
        serverName: r.serverName ?? r.server_name ?? r.server ?? null,
        covers: num(r.covers),
        ...moneyOf(r),
        ...qtyUnreadOf(
          Array.isArray(r.items) ? r.items : [],
          (it) => it?.qty ?? it?.quantity,
        ),
        items: (Array.isArray(r.items) ? r.items : []).map(
          (it: any): CanonicalItem => ({
            name: String(it.name ?? "unknown"),
            externalItemId: it.externalItemId ?? it.external_item_id ?? null,
            category: it.category ?? null,
            qty: qtyOf(it.qty ?? it.quantity),
            price: readMoney(it.price).value ?? null,
            is_wine: typeof it.is_wine === "boolean" ? it.is_wine : undefined,
            master_wine_id: it.master_wine_id ?? null,
            modifierIds: modifierIdsOf(
              it.modifierIds ?? it.modifier_ids,
              (m) => m,
            ),
          }),
        ),
        raw: r,
      }));
  },
};

/**
 * F-1437: a Square line's unit price as sold. `base_price_money` is the price
 * before discounts, so a comp rung as a 100% discount kept the full price and
 * the comp rule (a till price of 0 is a comp, F-1198) never saw its 0. The
 * line's `total_discount_money` is for the whole line, so it is spread over
 * the quantity. No base price is still no price (null), not 0.
 */
const squareUnitPrice = (li: any): number | null => {
  const base = cents(li?.base_price_money?.amount);
  if (base === null) return null;
  const discount = cents(li?.total_discount_money?.amount) ?? 0;
  const qty = qtyOf(li?.quantity);
  if (discount <= 0 || !(qty > 0)) return base;
  return Math.max(0, base - discount / qty);
};

// ---------------------------------------------------------------------------
// Square — Orders API (order object or webhook envelope)
// ---------------------------------------------------------------------------

/**
 * Square's net sales: what the check took, less tax, tips and service charge.
 *
 * `net_amounts.total_money` is the order total net of returns — tax, tip and
 * service charge are still inside it — so reading it as the subtotal inflated
 * a Square house's net sales by its tax rate plus its tips (F-340; ADR 0287
 * and ADR 0290 named the caveat). `net_amounts` carries each of those parts
 * beside the total, so they come off here. A part Square left out took no
 * money; a missing total is still unknown, never 0.
 */
const squareNetSales = (net: any): number | null => {
  const total = num(net?.total_money?.amount);
  if (total === null) return null;
  const part = (m: any) => num(m?.amount) ?? 0;
  return (
    (total -
      part(net.tax_money) -
      part(net.tip_money) -
      part(net.service_charge_money)) /
    100
  );
};

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
      .map((o) => {
        const closedAt =
          o.state === "COMPLETED"
            ? (o.closed_at ?? o.updated_at ?? null)
            : null;
        return {
          externalCheckId: String(o.id),
          // F-1194: dated by its close when Square sent no created_at.
          openedAt: o.created_at ?? closedAt ?? new Date().toISOString(),
          sourceVersion: versionOf(o.version),
          sourceModifiedAt: instantOf(o.updated_at),
          closedAt,
          // A cancelled order took no money. Without this it landed as
          // `voided: false`, and every revenue reader (the till, the room, the
          // servers, goals, the calendar), all of which filter only on
          // `voided`, counted its total as a sale (F-572).
          voided: o.state === "CANCELED",
          tableRef: o.ticket_name ?? null,
          serverExternalId: o.employee_id ?? null,
          serverName: null,
          covers: null,
          subtotal: squareNetSales(o.net_amounts),
          total: cents(o.total_money?.amount),
          tip: cents(o.total_tip_money?.amount),
          ...qtyUnreadOf(o.line_items ?? [], (li) => li?.quantity),
          items: (o.line_items ?? []).map(
            (li: any): CanonicalItem => ({
              name: String(li.name ?? "unknown"),
              externalItemId: li.catalog_object_id ?? null,
              category: null,
              qty: qtyOf(li.quantity),
              price: squareUnitPrice(li),
              modifierIds: modifierIdsOf(
                li.modifiers,
                (m) => m?.catalog_object_id,
              ),
            }),
          ),
          raw: o,
        };
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
      .map((o) => {
        // F-1199: a paid order is dated by its last change, which a later
        // tip adjust moves; ingest() keeps the first closed_at it stored.
        const closedAt =
          o.state === "locked" || o.state === "paid"
            ? o.modifiedTime
              ? new Date(o.modifiedTime).toISOString()
              : null
            : null;
        return {
          externalCheckId: String(o.id),
          sourceModifiedAt: instantOf(o.modifiedTime),
          // F-1194: dated by its close when Clover sent no createdTime.
          openedAt: o.createdTime
            ? new Date(o.createdTime).toISOString()
            : (closedAt ?? new Date().toISOString()),
          closedAt,
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
          ...qtyUnreadOf(o.lineItems?.elements ?? [], (li) => li?.unitQty),
          items: (o.lineItems?.elements ?? []).map(
            (li: any): CanonicalItem => ({
              name: String(li.name ?? "unknown"),
              externalItemId: li.item?.id ?? null,
              category: null,
              qty: qtyOf(li.unitQty),
              price: cents(li.price) ?? null,
            }),
          ),
          raw: o,
        };
      });
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
        // F-572: a check Toast voided whole is read as voided, strictly.
        ...voidedOf(c.voided),
        externalCheckId: String(c.guid),
        // F-1194: dated by its close when Toast sent no openedDate.
        openedAt: c.openedDate ?? c.closedDate ?? new Date().toISOString(),
        sourceModifiedAt: instantOf(c.modifiedDate),
        closedAt: c.closedDate ?? null,
        // Toast keeps a voided or deleted check on the order with a flag
        // rather than dropping it, so both are read: a check the till took
        // back is not a sale, and every revenue reader filters only on
        // `voided` (F-572).
        voided: c.voided === true || c.deleted === true,
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
        ...qtyUnreadOf(
          (c.selections ?? []).filter(
            (s: any) => readVoided(s?.voided).voided !== true,
          ),
          (s) => s?.quantity,
        ),
        // F-395: a selection Toast voided off the check stays in the list
        // with `voided: true`. Kept, it was sold; dropped, the hub sees the
        // re-sent check without it and gives its stock back. A value
        // readVoided cannot read keeps the line, as before.
        items: (c.selections ?? [])
          .filter((s: any) => readVoided(s?.voided).voided !== true)
          .map(
            (s: any): CanonicalItem => ({
              name: String(s.displayName ?? s.itemName ?? "unknown"),
              externalItemId: s.item?.guid ?? null,
              category: s.salesCategory?.name ?? null,
              qty: qtyOf(s.quantity),
              price: num(s.price) ?? null,
              // F-641: the menu option a modifier names (a size), not the
              // per-check selection guid, so a mapping can name it.
              modifierIds: modifierIdsOf(
                s.modifiers,
                (m) => m?.item?.guid ?? m?.guid,
              ),
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
