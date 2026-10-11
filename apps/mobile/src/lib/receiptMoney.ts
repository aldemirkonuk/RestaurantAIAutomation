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

const PRICE_FIELDS = [
  "invoiceUnitPrice",
  "invoiceCurrency",
  "priceOverrideReason",
  "allocatedCharges",
] as const;

/**
 * The gateway's role gate counts what the invoice BILLED as money too
 * (`receipt-money-gate.ts` `receiptMoneyFields`, F-1180): a staff receipt
 * carrying it is refused whole, so a role refusal takes it out with the price.
 */
const BILLED_FIELDS = [
  "invoiceQuantityInInvoiceUom",
  "invoiceQuantity",
] as const;

/**
 * A verify-receipt body with its money taken out, or null when there is
 * nothing to take out (another path, or a body that carries no money). The
 * count, the rejection and the note are kept as they were. After a role
 * refusal (`billedIsMoney`, the default) the billed quantity goes too; after a
 * manager's price was refused (F-949) only the price goes, and the billed
 * quantity is kept.
 */
export function withoutReceiptMoney(
  path: string,
  body: unknown,
  { billedIsMoney = true }: { billedIsMoney?: boolean } = {},
): Record<string, unknown> | null {
  if (!/\/verify-receipt$/.test(path)) return null;
  if (!body || typeof body !== "object") return null;
  const source = body as Record<string, unknown>;
  const fields = billedIsMoney
    ? [...PRICE_FIELDS, ...BILLED_FIELDS]
    : PRICE_FIELDS;
  const carriesMoney =
    source.invoiceUnitPrice != null ||
    String(source.priceOverrideReason ?? "").trim() !== "" ||
    Number(source.allocatedCharges ?? 0) > 0 ||
    (billedIsMoney && BILLED_FIELDS.some((key) => source[key] != null));
  if (!carriesMoney) return null;
  const out: Record<string, unknown> = { ...source };
  for (const key of fields) delete out[key];
  return out;
}
