/**
 * Recurring-order reminder — the parts that decide *whether* to send and *what*
 * a row actually says, kept pure so they can be tested without NestJS DI, a
 * database, or a mail client.
 *
 * These are split out rather than inlined because this path sends real email to
 * real tenants. The two questions it answers — "is this armed?" and "can this
 * row be described without inventing anything?" — are the two questions whose
 * wrong answer is a mis-aimed email, so they get to be directly testable.
 *
 * See ADR 0061.
 */

/**
 * The single env var that arms the recurring-order reminder.
 *
 * Off by default and deliberately not wired to any other flag: there is no
 * combination of existing settings that turns this on as a side effect.
 */
export const RECURRING_REMINDER_FLAG = "RECURRING_ORDER_REMINDERS_ENABLED";

/**
 * Is the reminder armed?
 *
 * Allow-list shaped on purpose. Only `"true"` and `"1"` — trimmed and
 * lower-cased, so `" TRUE "` also arms it — return true. Everything else reads
 * as OFF: unset, `""`, `"yes"`, `"on"`, `"enabled"`, `"false"`, a typo, or a
 * non-string.
 *
 * The asymmetry is the point. A deny-list ("off unless it says false") turns
 * every typo into a live mailer; an allow-list turns every typo into silence.
 * Silence is the recoverable failure here.
 */
export function recurringRemindersEnabled(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * The subset of a `recurring_orders` row this reminder reads.
 *
 * Every field is optional because the table's shape is mid-migration, and the
 * reminder still refuses every row — but NOT for the reason this comment
 * originally gave, so the reason is restated rather than left to rot.
 *
 * As written, this said `20260901180000_recurring_orders_shape.sql` (PR #220)
 * "is not merged" and that `target_price` was therefore absent. #220 merged at
 * 23:24 on 2026-09-01, roughly twelve hours BEFORE this file did (`e50d912c`
 * is an ancestor of `e3acc79a`), so the claim was already false when it landed.
 * `target_price` exists.
 *
 * What still holds is ADR 0061's precondition **2**, not its precondition 1:
 * #220 deliberately adds no `wine_name` column (it embeds through
 * `inventory_id`) and no `provider_name` (it stores `provider_id`), while this
 * job reads the table flat with `select("*")` and no embed. The current writer
 * — `RecurringOrdersService.createRecurringOrder` — populates `inventory_id`
 * and `provider_id` and never writes the older `wine_id` or
 * `preferred_providers` this function falls back to. So every row it can
 * produce is refused for want of a name and a provider, and zero emails go out
 * even with the flag armed. Fail-closed as designed; the ledger of WHY is what
 * had drifted. See ADR 0061.
 */
export interface RecurringOrderRowLike {
  id?: string | null;
  quantity?: number | null;
  unit_type?: string | null;
  frequency?: string | null;
  next_order_date?: string | null;
  active?: boolean | null;
  wine_name?: string | null;
  wine_id?: string | null;
  provider_name?: string | null;
  preferred_providers?: string[] | null;
  target_price?: number | string | null;
}

export type DescribedRecurringOrder =
  | {
      sendable: true;
      label: string;
      providerName: string;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
      frequency: string;
      scheduledDate: string;
    }
  | { sendable: false; label: string | null; missing: string[] };

function firstNonEmpty(
  ...vals: Array<string | null | undefined>
): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function finiteNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn one `recurring_orders` row into an email, or refuse it and say why.
 *
 * FAIL-CLOSED. A row is describable only when every field the email actually
 * renders is present in the data. There is no `|| "Unknown Provider"` and no
 * `|| 0` here, because the template puts the provider and the wine in the
 * SUBJECT LINE and the price in the body: a missing value does not degrade the
 * email, it sends a confidently wrong one. That is the failure ADR 0020
 * forbids, and ADR 0053 already paid for it once when an unmeasured bottle cost
 * was rendered as `0.6 ×` the menu price.
 *
 * A refused row is not silently dropped — the caller logs it and it still
 * counts toward the in-app digest, which needs only a count and a date.
 */
export function describeRecurringOrder(
  row: RecurringOrderRowLike,
): DescribedRecurringOrder {
  const label = firstNonEmpty(row.wine_name, row.wine_id);
  const providerName = firstNonEmpty(
    row.provider_name,
    Array.isArray(row.preferred_providers) ? row.preferred_providers[0] : null,
  );
  const unitPrice = finiteNumber(row.target_price);
  const quantity = finiteNumber(row.quantity);
  const scheduledDate = firstNonEmpty(row.next_order_date);
  const frequency = firstNonEmpty(row.frequency);

  const missing: string[] = [];
  if (!label) missing.push("wine_name/wine_id");
  if (!providerName) missing.push("provider_name/preferred_providers");
  if (unitPrice === null || unitPrice < 0) missing.push("target_price");
  if (quantity === null || quantity <= 0) missing.push("quantity");
  if (!scheduledDate) missing.push("next_order_date");
  if (!frequency) missing.push("frequency");

  if (missing.length > 0) return { sendable: false, label, missing };

  return {
    sendable: true,
    label: label as string,
    providerName: providerName as string,
    quantity: quantity as number,
    unitPrice: unitPrice as number,
    totalAmount: (quantity as number) * (unitPrice as number),
    frequency: frequency as string,
    scheduledDate: scheduledDate as string,
  };
}
