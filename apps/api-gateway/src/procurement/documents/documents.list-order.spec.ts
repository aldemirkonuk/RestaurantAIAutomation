import { DocumentsController } from "./documents.controller";

/**
 * GET /procurement/documents?orderId= needs the order only for its id, so that
 * read starts with the links read: links + order, then documents, then lines
 * and vendors (three round trips, not four). The body is unchanged.
 */
type R = { data: unknown; error: { message: string } | null };

function controllerWith(opts: { links: string[]; orderRead?: R }) {
  const log: string[] = [];
  const answers: Record<string, R> = {
    procurement_document_links: { data: opts.links.map((d) => ({ document_id: d })), error: null },
    procurement_documents: {
      data: opts.links.map((id) => ({ id, restaurant_id: "r1", doc_type: "invoice", status: "open", currency: "EUR", extracted: null })),
      error: null,
    },
    procurement_orders:
      opts.orderRead ?? { data: { order_number: "PO-7", currency: "EUR", currency_source: "vendor" }, error: null },
  };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b: any = {};
        for (const m of ["select", "eq", "in", "order", "limit", "range"]) b[m] = () => b;
        const run = () => {
          log.push(`start:${table}`);
          return new Promise((r) => setTimeout(r, 5)).then(() => {
            log.push(`end:${table}`);
            return answers[table] ?? { data: [], error: null };
          });
        };
        b.maybeSingle = run;
        b.then = (res: any, rej: any) => run().then(res, rej);
        return b;
      },
    }),
  };
  const args = Array.from({ length: 11 }, () => ({}) as any);
  args[1] = db;
  const controller = new (DocumentsController as any)(...args) as any;
  controller.tieOutsAsRuledNow = async () => new Map();
  controller.vendorNamesFor = async () => new Map();
  return { controller, log };
}
const USER = { userId: "u", restaurantId: "r1" } as any;

describe("GET /procurement/documents?orderId=", () => {
  it("starts the order read with the links read, before the documents are read", async () => {
    const { controller, log } = controllerWith({ links: ["d1", "d2"] });
    await controller.list(USER, undefined, undefined, "o1");
    expect(log.slice(0, 2).sort()).toEqual(["start:procurement_document_links", "start:procurement_orders"]);
    expect(log.indexOf("start:procurement_documents")).toBeGreaterThan(log.indexOf("end:procurement_document_links"));
  });

  it("answers the same body with links", async () => {
    const { controller } = controllerWith({ links: ["d1"] });
    const body = await controller.list(USER, undefined, undefined, "o1");
    expect(body.items.map((i: any) => i.id)).toEqual(["d1"]);
    expect(body.order).toEqual({ id: "o1", currency: "EUR", currencySource: "vendor", orderNumber: "PO-7", failure: null });
  });

  it("no links stays {items: []}, with no documents read", async () => {
    const { controller, log } = controllerWith({ links: [] });
    const body = await controller.list(USER, undefined, undefined, "o1");
    expect(body).toEqual({ items: [] });
    expect(log).not.toContain("start:procurement_documents");
  });

  it("a failed order read keeps its named failure", async () => {
    const { controller } = controllerWith({ links: ["d1"], orderRead: { data: null, error: { message: "timeout" } } });
    const body = await controller.list(USER, undefined, undefined, "o1");
    expect(body.items).toHaveLength(1);
    expect(body.order.failure).toContain("could not be read (timeout)");
    expect(body.order.currency).toBeNull();
  });

  it("without orderId the order is never read", async () => {
    const { controller, log } = controllerWith({ links: ["d1"] });
    const body = await controller.list(USER);
    expect(body.order).toBeUndefined();
    expect(log).not.toContain("start:procurement_orders");
  });
});
