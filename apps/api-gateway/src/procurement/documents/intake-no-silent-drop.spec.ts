import { DocumentIntakeService } from "./document-intake.service";
import { DocumentsController } from "./documents.controller";
import { houseIdsFor } from "./house-ids";

/**
 * Proposal-receipt §3 rows 1.1 (remainder) and 1.3. All ids are SYNTHETIC.
 *
 *   1.1  No intake path answers `documentId: null` without an `error`. A 23505
 *        on the bytes index whose winner a second read finds is a duplicate;
 *        one whose winner cannot be read, or a 23505 on an index nobody
 *        named, is an error in words.
 *   1.3  A vendor or order id the body names is kept only when it is this
 *        house's; otherwise the paper is filed without it and the reply says so.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE_ORDER = "55555555-5555-4555-8555-555555555555";
const OWN_VENDOR = "22222222-2222-4222-8222-222222222222";
const WINNER = "44444444-4444-4444-8444-444444444444";

const PARSED = {
  docType: "invoice",
  docNumber: "SYN-0100",
  lines: [],
  warnings: [],
  tiesOut: true,
};

const SHA_COLLISION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "uq_pd_restaurant_sha256"',
};

/** `maybeSingle` answers come from the queue in order: pre-check, re-read. */
function client(
  insertAnswer: { data: unknown; error: unknown },
  reads: Array<{ data: unknown; error: unknown }>,
) {
  const chain: Record<string, jest.Mock> = {};
  for (const verb of ["from", "select", "insert", "eq", "neq", "limit"])
    chain[verb] = jest.fn(() => chain);
  const queue = [...reads];
  chain.maybeSingle = jest.fn(
    async () => queue.shift() ?? { data: null, error: null },
  );
  chain.single = jest.fn(async () => insertAnswer);
  return chain;
}

function intake(
  insert: { data: unknown; error: unknown },
  reads: Array<{ data: unknown; error: unknown }>,
) {
  const db = client(insert, reads);
  const vendorResolution = {
    resolveVendor: jest.fn(),
    applyToDocument: jest.fn(),
    findSameNumberPaper: jest.fn(),
  };
  const service = new DocumentIntakeService(
    { getClient: () => db } as never,
    { available: () => false } as never,
    {} as never,
    vendorResolution as never,
  );
  const s = service as unknown as Record<string, jest.Mock>;
  s.persistOriginalBytes = jest.fn(async () => ({ path: "p", failure: null }));
  s.route = jest.fn(async () => PARSED);
  s.insertDocumentLines = jest.fn(async () => null);
  s.linkAndMatch = jest.fn(async () => undefined);
  return { service, vendorResolution };
}

const INPUT = {
  restaurantId: HOUSE,
  source: "upload" as const,
  buffer: Buffer.from("SYNTHETIC invoice bytes"),
  filename: "inv.pdf",
  mimeType: "application/pdf",
};

describe("row 1.1 — a refused insert is a duplicate or an error, never a bare null", () => {
  it("a bytes race whose winner reads back is that row, as a duplicate", async () => {
    const { service, vendorResolution } = intake(
      { data: null, error: SHA_COLLISION },
      [
        { data: null, error: null },
        { data: { id: WINNER }, error: null },
      ],
    );
    const out = await service.ingest(INPUT);
    expect(out.error).toBeUndefined();
    expect(out.documentId).toBe(WINNER);
    expect(out.duplicate).toBe(true);
    expect(vendorResolution.resolveVendor).not.toHaveBeenCalled();
  });

  it("a bytes race whose winner cannot be found is an error", async () => {
    const { service } = intake({ data: null, error: SHA_COLLISION }, [
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const out = await service.ingest(INPUT);
    expect(out.documentId).toBeNull();
    expect(out.error).toMatch(/no earlier copy holds it/);
  });

  it("a bytes race whose re-read fails is an error naming the failure", async () => {
    const { service } = intake({ data: null, error: SHA_COLLISION }, [
      { data: null, error: null },
      { data: null, error: { message: "SYNTHETIC timeout" } },
    ]);
    const out = await service.ingest(INPUT);
    expect(out.documentId).toBeNull();
    expect(out.error).toMatch(/could not be read back: SYNTHETIC timeout/);
  });

  it("a 23505 on an index nobody named is an error, not a duplicate", async () => {
    const { service } = intake(
      {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "uq_other"',
        },
      },
      [{ data: null, error: null }],
    );
    const out = await service.ingest(INPUT);
    expect(out.documentId).toBeNull();
    expect(out.duplicate).toBe(false);
    expect(out.error).toMatch(/could not be filed.*uq_other/);
  });
});

/** A reader whose `count` answers come per table. */
function houseReader(answers: Record<string, { count?: number; error?: unknown }>) {
  const calls: Array<{ table: string; eqs: Array<[string, unknown]> }> = [];
  return {
    calls,
    from(table: string) {
      const call = { table, eqs: [] as Array<[string, unknown]> };
      calls.push(call);
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          call.eqs.push([k, v]);
          return chain;
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({ count: answers[table]?.count ?? 0, error: answers[table]?.error ?? null }),
      };
      return chain;
    },
  };
}

describe("row 1.3 — the vendor and order a paper names are this house's", () => {
  it("keeps the house's own vendor and order, filtered by the house", async () => {
    const r = houseReader({
      providers: { count: 1 },
      procurement_orders: { count: 1 },
    });
    const out = await houseIdsFor(r, HOUSE, {
      providerId: OWN_VENDOR,
      orderId: OTHER_HOUSE_ORDER,
    });
    expect(out).toEqual({
      providerId: OWN_VENDOR,
      orderId: OTHER_HOUSE_ORDER,
      refused: [],
    });
    for (const c of r.calls) expect(c.eqs).toContainEqual(["restaurant_id", HOUSE]);
  });

  it("drops another house's order and says so", async () => {
    const r = houseReader({ procurement_orders: { count: 0 } });
    const out = await houseIdsFor(r, HOUSE, { orderId: OTHER_HOUSE_ORDER });
    expect(out.orderId).toBeNull();
    expect(out.refused).toEqual([
      "The order named with this paper is not one of this house's orders, so the paper was filed without it.",
    ]);
  });

  it("a failed read is not a yes: the vendor is dropped and the reason said", async () => {
    const r = houseReader({ providers: { error: { message: "SYNTHETIC down" } } });
    const out = await houseIdsFor(r, HOUSE, { providerId: OWN_VENDOR });
    expect(out.providerId).toBeNull();
    expect(out.refused[0]).toMatch(/could not be checked \(SYNTHETIC down\)/);
  });

  it("the upload files the paper without a foreign order, and says so", async () => {
    const ingest = jest.fn(async () => ({
      documentId: WINNER,
      duplicate: false,
      parsed: null,
    }));
    const r = houseReader({ procurement_orders: { count: 0 } });
    const unused = {} as never;
    const controller = new DocumentsController(
      { ingest } as never,
      { getClient: () => r } as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
    const res = (await controller.upload(
      {
        contentBase64: Buffer.from("SYNTHETIC bytes").toString("base64"),
        filename: "inv.pdf",
        orderId: OTHER_HOUSE_ORDER,
      } as never,
      { userId: "u", restaurantId: HOUSE, role: "owner" } as never,
    )) as Record<string, unknown>;
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: null, providerId: null }),
    );
    expect(res.documentId).toBe(WINNER);
    expect(res.linkRefused).toEqual([
      "The order named with this paper is not one of this house's orders, so the paper was filed without it.",
    ]);
  });
});
