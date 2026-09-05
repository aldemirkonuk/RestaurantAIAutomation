import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paymentDueTemplate } from "./payment-due.template";

/**
 * A term nobody stated does not reach a vendor's inbox.
 *
 * `06-pages/settings.md` §9.12 named `payment-due.template.ts:108` as the place
 * where `providers.payment_terms DEFAULT 'Net 30'` escaped the database and
 * reached a third party. Migration
 * `20260903170000_a_default_is_not_an_answer.sql` removed the fabricated value
 * at source. This spec pins the two facts that make that safe here, because
 * both are the kind of thing a future accounts-payable build (ADR 0077) would
 * undo without noticing.
 */
describe("payment-due — an unstated term prints nothing", () => {
  const base = {
    restaurantName: "Sim Meyhouse",
    invoiceNumber: "INV-1",
    providerName: "Anadolu",
    dueDate: "2026-09-30",
    amount: 1240.5,
    daysUntilDue: 7,
  };

  it("omits the Payment Terms row entirely when no term is known", () => {
    const html = paymentDueTemplate({ ...base });
    expect(html).not.toContain("Payment Terms");
    // The three shapes a defaulted or mishandled unknown would take.
    expect(html).not.toContain("Net 30");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
  });

  it("prints a term the house actually recorded", () => {
    const html = paymentDueTemplate({ ...base, paymentTerms: "2% 10 net 30" });
    expect(html).toContain("Payment Terms");
    expect(html).toContain("2% 10 net 30");
  });

  it("an empty string is an unknown, not a term", () => {
    const html = paymentDueTemplate({ ...base, paymentTerms: "" });
    expect(html).not.toContain("Payment Terms");
  });
});

describe("payment-due — the mailer has no production caller", () => {
  /**
   * MEASURED, not assumed. The cron that would have called
   * `sendPaymentDueReminder` was deleted (the note where it stood is
   * `scheduled-tasks.service.ts:596-619`), so the only invocation anywhere is
   * the e2e spec. This test states that in code: the day somebody wires the
   * mailer up, this fails and they are made to re-read the note above about
   * where `paymentTerms` has to come from.
   */
  it("scheduled-tasks still names the deleted job and still does not call it", () => {
    const code = readFileSync(
      join(__dirname, "..", "scheduled-tasks.service.ts"),
      "utf8",
    );
    expect(code).not.toMatch(/this\.gmailService\??\.sendPaymentDueReminder/);
    // The note that explains WHY there is no payment-due cron.
    expect(code).toContain("There is no payment-due reminder");
  });
});
