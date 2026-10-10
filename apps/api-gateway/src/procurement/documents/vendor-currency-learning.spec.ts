/**
 * VEN-W13 (founder, 2026-10-01) — the intake hook. After an invoice is matched
 * to a vendor, the vendor's usual currency is re-checked from their invoices;
 * a credit memo triggers nothing; and a failure there never fails the intake.
 *
 * `resolveVendorFor` is the one place both doors (ingest and the external
 * extraction) run vendor resolution, so it is driven directly.
 */
import { DocumentIntakeService } from "./document-intake.service";

function client(opts: { explode?: boolean } = {}) {
  const tables: string[] = [];
  const c: any = {
    from(table: string) {
      tables.push(table);
      if (opts.explode) throw new Error("socket hang up");
      const q: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then")
              return (res: any) =>
                res(
                  table === "providers"
                    ? { data: { usual_currency: "EUR", usual_currency_source: "person" }, error: null }
                    : { data: [], error: null },
                );
            return () => q;
          },
        },
      );
      return q;
    },
  };
  return { c, tables };
}

function service(c: any) {
  const resolution = {
    state: "resolved",
    providerId: "vendor-7",
    source: "tax_id",
    identity: null,
    reason: null,
  };
  const svc = new DocumentIntakeService(
    { getClient: () => c } as any,
    {} as any,
    {} as any,
    {
      resolveVendor: jest.fn().mockResolvedValue(resolution),
      applyToDocument: jest.fn().mockResolvedValue(undefined),
    } as any,
  );
  return { svc, resolution };
}

const parsed = (docType: string) =>
  ({ docType, lines: [], warnings: [], currency: "USD" }) as any;

describe("intake re-checks the vendor's usual currency after resolution", () => {
  it("an invoice matched to a vendor reads that vendor's invoices in this house", async () => {
    const { c, tables } = client();
    const { svc, resolution } = service(c);
    const out = await (svc as any).resolveVendorFor(
      "doc-1",
      { restaurantId: "house-1" },
      parsed("invoice"),
    );
    expect(out).toBe(resolution);
    expect(tables).toEqual(["providers", "procurement_documents"]);
  });

  it("a credit memo does not count and triggers nothing", async () => {
    const { c, tables } = client();
    const { svc } = service(c);
    await (svc as any).resolveVendorFor(
      "doc-2",
      { restaurantId: "house-1" },
      parsed("credit_memo"),
    );
    expect(tables).toEqual([]);
  });

  it("a failure while learning never fails the intake or its vendor", async () => {
    const { c } = client({ explode: true });
    const { svc, resolution } = service(c);
    const out = await (svc as any).resolveVendorFor(
      "doc-3",
      { restaurantId: "house-1" },
      parsed("invoice"),
    );
    expect(out).toBe(resolution);
  });
});
