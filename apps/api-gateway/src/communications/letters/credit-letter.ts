/**
 * The letter a credit claim becomes when the house asks the vendor for it
 * (founder, 2026-09-25, round 5: "'requested' creates a DRAFTED letter to the
 * vendor in /communications; nothing sends without approval"; ADR 0230).
 *
 * This is the pure half: the claim's facts in, a subject and a body out. It
 * reads nothing and writes nothing, so what the vendor would be told can be
 * proved without a database.
 *
 * WHAT IT REFUSES TO DO
 *   - Invent a figure. A fact the claim does not carry (no order, no invoice
 *     number, no bottle count) is left out of the letter, never filled with a
 *     plausible blank. There is no merge token in the output for the same
 *     reason `composerGuardrails` blocks one: a placeholder tells the vendor a
 *     figure exists when none was found.
 *   - Convert money. The amount is written in the claim's own currency code,
 *     the same rule the credits lane keeps (no sum across currencies).
 *   - Commit the house to anything. It asks for a credit memo; it does not
 *     accept, order or promise. `composerGuardrails` runs over it at queue time
 *     like any other letter, and a test pins that it trips nothing.
 */

export interface CreditLetterFacts {
  reason: string | null;
  summary: string | null;
  claimedAmount: number;
  currency: string | null;
  claimedQty: number | null;
  openedAt: string | null;
  vendorName: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
}

/** What the vendor is told happened, in words a rep will recognise. */
export const CREDIT_REASON_SENTENCE: Record<string, string> = {
  overbilled_vs_ship:
    "we were invoiced for more than was delivered",
  qty_short: "the quantity delivered was short of the quantity invoiced",
  short_shipped: "part of the order was not delivered",
  damaged: "part of the delivery arrived damaged",
  price_variance:
    "the price invoiced differs from the price agreed",
  never_ordered: "we were invoiced for goods we did not order",
  other: "there is a discrepancy on this delivery",
};

/** The house letter category a claim files under (LETTER_CATEGORIES). */
export function creditLetterCategory(reason: string | null): string {
  return reason === "damaged" || reason === "short_shipped"
    ? "delivery_dispute"
    : "invoice_mismatch";
}

function money(amount: number, currency: string | null): string {
  const fixed = Number.isFinite(amount) ? amount.toFixed(2) : String(amount);
  return currency ? `${fixed} ${currency}` : fixed;
}

function day(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function composeCreditLetter(f: CreditLetterFacts): {
  subject: string;
  body: string;
  category: string;
} {
  const what =
    CREDIT_REASON_SENTENCE[f.reason ?? ""] ?? CREDIT_REASON_SENTENCE.other;
  const ref = f.invoiceNumber
    ? `invoice ${f.invoiceNumber}`
    : f.orderNumber
      ? `order ${f.orderNumber}`
      : null;

  const subject = ref
    ? `Credit request — ${ref}`
    : "Credit request";

  const lines: string[] = [];
  lines.push(f.vendorName ? `Hello ${f.vendorName} team,` : "Hello,");
  lines.push("");
  lines.push(
    `We are asking for a credit of ${money(f.claimedAmount, f.currency)} because ${what}.`,
  );
  lines.push("");
  const facts: string[] = [];
  if (f.invoiceNumber) facts.push(`Invoice: ${f.invoiceNumber}`);
  if (f.orderNumber) facts.push(`Order: ${f.orderNumber}`);
  if (f.claimedQty != null) facts.push(`Bottles concerned: ${f.claimedQty}`);
  facts.push(`Amount asked: ${money(f.claimedAmount, f.currency)}`);
  const opened = day(f.openedAt);
  if (opened) facts.push(`Noted on: ${opened}`);
  lines.push(...facts.map((x) => `- ${x}`));
  const summary = f.summary?.trim();
  if (summary) {
    lines.push("");
    lines.push(summary);
  }
  lines.push("");
  lines.push(
    "Please send a credit memo for this amount, or tell us if you see it differently.",
  );
  lines.push("");
  lines.push("Thank you.");

  return {
    subject,
    body: lines.join("\n"),
    category: creditLetterCategory(f.reason),
  };
}
