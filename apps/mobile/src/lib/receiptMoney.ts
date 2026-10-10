/**
 * Who may put money on a delivery's receipt, phone edition (F-806).
 *
 * The gateway refuses a `verify-receipt` carrying an invoice price, a price
 * override or allocated charges unless the house role holds the house's money
 * (F-802, `assertHoldsHouseMoney`, the `money` row of ROLE_POLICY): owner and
 * manager, with `admin` reading the owner row. Staff, an unknown role and no
 * role do not. Mirrored here so the phone never offers staff a field the
 * server will refuse, and so a refused entry keeps its count.
 */
const MONEY_ROLES = new Set(["owner", "manager", "admin"]);

export function holdsHouseMoney(role: string | null | undefined): boolean {
  return MONEY_ROLES.has(
    String(role ?? "")
      .trim()
      .toLowerCase(),
  );
}

const MONEY_FIELDS = [
  "invoiceUnitPrice",
  "invoiceCurrency",
  "priceOverrideReason",
  "allocatedCharges",
] as const;

/**
 * A verify-receipt body with its money taken out, or null when there is
 * nothing to take out (another path, or a body that carries no money). The
 * count, the rejection, the billed quantity and the note are kept as they were.
 */
export function withoutReceiptMoney(
  path: string,
  body: unknown,
): Record<string, unknown> | null {
  if (!/\/verify-receipt$/.test(path)) return null;
  if (!body || typeof body !== "object") return null;
  const source = body as Record<string, unknown>;
  const carriesMoney =
    source.invoiceUnitPrice != null ||
    String(source.priceOverrideReason ?? "").trim() !== "" ||
    Number(source.allocatedCharges ?? 0) > 0;
  if (!carriesMoney) return null;
  const out: Record<string, unknown> = { ...source };
  for (const key of MONEY_FIELDS) delete out[key];
  return out;
}

/** What the queue says when a count went through without the price. */
export const COUNT_WITHOUT_PRICE_WORDS =
  "The count was recorded without the invoice price. A manager or an owner checks the price.";
