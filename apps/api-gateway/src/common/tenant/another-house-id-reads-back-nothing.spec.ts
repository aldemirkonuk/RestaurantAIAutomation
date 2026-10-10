import { NotFoundException } from "@nestjs/common";
import { CanonicalDocumentService } from "../../procurement/canonical/canonical-document.service";
import { DeliveryService } from "../../procurement/canonical/delivery.service";
import { DocumentsController } from "../../procurement/documents/documents.controller";
import { CreditsController } from "../../procurement/documents/credits.controller";
import { VendorIntelController } from "../../vendor-intel/vendor-intel.controller";

/**
 * F-309, the rest: an id that belongs to house B, held by a member of house A,
 * names nothing of B's on A's screens and is not stored on A's rows.
 *
 *   - the canonical sheet does not print B's vendor name or tax id;
 *   - the document list does not print B's vendor name;
 *   - a delivery's difference scan does not read B's order lines;
 *   - a credit claim refuses B's document as its credit memo;
 *   - a vendor-page sighting refuses B's vendor.
 *
 * The fake client applies every `.eq` it is given, including the embedded
 * `procurement_orders.restaurant_id`, so a missing house filter shows up as
 * B's data coming back. All ids are SYNTHETIC.
 */

const A = "house-a";
const B = "house-b";

type Row = Record<string, any>;

function readKey(row: Row, key: string): unknown {
  return key.split(".").reduce<any>((v, k) => (v == null ? v : v[k]), row);
}

function fakeClient(tables: Record<string, Row[]>) {
  const writes: { table: string; patch: Row }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let head = false;
    let patch: Row | null = null;
    const run = () => {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) writes.push({ table, patch });
      return rows;
    };
    const b: any = {
      select: (_c?: string, opts?: { head?: boolean }) => {
        head = !!opts?.head;
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => readKey(r, k) === v);
        return b;
      },
      in: (k: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(readKey(r, k)));
        return b;
      },
      order: () => b,
      range: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        const rows = run();
        return Promise.resolve({
          data: head ? null : rows,
          count: rows.length,
          error: null,
        }).then(ok, bad);
      },
    };
    return b;
  };
  return { client: { from } as any, writes };
}

const dbOf = (client: any) => ({ getClient: () => client }) as any;

const providers = [
  { id: "prov-a", restaurant_id: A, name: "Ada Şarap", company_name: null, tax_id: "A-TAX" },
  { id: "prov-b", restaurant_id: B, name: "Bora Bağ", company_name: "Bora Bağcılık A.Ş.", tax_id: "B-TAX" },
];

describe("an id from another house reads back nothing of that house", () => {
  it("the canonical sheet names no seller for house B's vendor", async () => {
    const { client } = fakeClient({
      providers,
      restaurants: [{ id: A, name: "House A" }],
    });
    const svc = new CanonicalDocumentService(dbOf(client), {} as any, {} as any);
    const resolve = (pid: string) => (svc as any).resolveParties(A, pid);

    const own = await resolve("prov-a");
    expect(own.ok).toBe(true);
    expect(own.value.sellerName).toBe("Ada Şarap");
    expect(own.value.sellerVatId).toBe("A-TAX");

    const foreign = await resolve("prov-b");
    expect(foreign.ok).toBe(true);
    expect(foreign.value.sellerName).toBeNull();
    expect(foreign.value.sellerVatId).toBeNull();
  });

  it("the document list does not print house B's vendor name", async () => {
    const { client } = fakeClient({ providers });
    const ctl = Object.create(DocumentsController.prototype);
    ctl.db = dbOf(client);
    ctl.logger = { warn: () => undefined, error: () => undefined };
    const names: Map<string, string | null> = await ctl.vendorNamesFor(A, [
      { id: "doc-1", provider_id: "prov-a" },
      { id: "doc-2", provider_id: "prov-b" },
    ]);
    expect(names.get("doc-1")).toBe("Ada Şarap");
    expect(names.get("doc-2")).not.toBe("Bora Bağcılık A.Ş.");
    expect(JSON.stringify([...names.values()])).not.toContain("Bora");
  });

  it("a delivery's scan reads no lines from house B's order", async () => {
    const item = (id: string, order: string, house: string, wine: string) => ({
      id,
      order_id: order,
      wine_name: wine,
      vendor_sku: "SKU-1",
      vintage: 2021,
      quantity: 6,
      bottles_per_unit: 1,
      total_bottles: 6,
      quoted_unit_price: 10,
      final_unit_price: null,
      inventory_id: null,
      procurement_orders: { restaurant_id: house },
    });
    const { client } = fakeClient({
      procurement_order_items: [
        item("oi-a", "order-a", A, "Ada Öküzgözü"),
        item("oi-b", "order-b", B, "Bora Kalecik"),
      ],
    });
    const svc = new DeliveryService(dbOf(client), {} as any, {} as any, {} as any);
    jest.spyOn(svc as any, "linesFor").mockResolvedValue({
      ok: true,
      value: {
        lines: [
          { id: "dl-1", vendorSku: "SKU-1", description: "Öküzgözü", vintage: 2021, qtyBottles: 5, unitPrice: 10 },
        ],
        identify: (id: string) => ({ id }) as any,
      },
    });
    const links = [{ document_id: "doc-1", role: "invoice" }];
    const scan = (orderId: string) =>
      (svc as any).scanAgainstTheOrder({ id: "del-1", restaurant_id: A, order_id: orderId }, links);

    expect((await scan("order-a")).status).toBe("compared");
    const foreign = await scan("order-b");
    expect(foreign.status).toBe("not_comparable");
    expect(JSON.stringify(foreign)).not.toContain("Bora");
  });

  it("a credit claim refuses house B's document as its credit memo", async () => {
    const claim = {
      id: "cr-1",
      restaurant_id: A,
      state: "promised",
      claimed_amount: 100,
      credited_amount: null,
      credit_document_id: null,
      opened_at: "2026-10-01T00:00:00Z",
      self_evidenced: false,
      notes: null,
    };
    const tables = {
      procurement_credits: [claim],
      procurement_documents: [
        // Both are credit memos, so only the house tells them apart (F-672
        // also checks the paper's type).
        { id: "doc-a", restaurant_id: A, doc_type: "credit_memo" },
        { id: "doc-b", restaurant_id: B, doc_type: "credit_memo" },
      ],
    };
    const { client, writes } = fakeClient(tables);
    const ctl = new CreditsController(dbOf(client), {} as any);
    const user = { userId: "u-a", restaurantId: A };

    await expect(
      ctl.transition("cr-1", { to: "credited", creditedAmount: 80, creditDocumentId: "doc-b" } as any, user),
    ).rejects.toMatchObject({ status: 404 });
    expect(writes).toHaveLength(0);

    await ctl.transition("cr-1", { to: "credited", creditedAmount: 80, creditDocumentId: "doc-a" } as any, user);
    expect(writes).toHaveLength(1);
    expect(writes[0].patch.credit_document_id).toBe("doc-a");
  });

  it("a vendor-page sighting refuses house B's vendor", async () => {
    const { client } = fakeClient({ providers });
    const extractFromUrl = jest.fn(async () => ({ ok: true }));
    const ctl = new VendorIntelController(
      undefined as any,
      { extractFromUrl } as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      dbOf(client),
    );
    const user = { restaurantId: A };

    await expect(
      ctl.scrape(user, { url: "https://example.com/list", providerId: "prov-b" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(extractFromUrl).not.toHaveBeenCalled();

    await ctl.scrape(user, { url: "https://example.com/list", providerId: "prov-a" });
    expect(extractFromUrl).toHaveBeenCalledTimes(1);
  });
});
