/**
 * F-546: when the line insert failed at intake, the document row stayed as the
 * parse left it — `received`, no lines, and no note — so /receipts later showed
 * a clean paper with nothing on it. The paper is still kept, but it is flagged
 * `needs_review` with a note saying the lines were lost; if even that flag
 * cannot be written, the row is taken away and the ingest fails.
 */
import { DocumentIntakeService } from "./document-intake.service";

type Op = { table: string; op: string; payload?: unknown };

function fakeDb(markError: { message: string } | null) {
  const ops: Op[] = [];
  const from = (table: string) => {
    let current: Op = { table, op: "select" };
    const b: Record<string, unknown> = {};
    for (const m of ["insert", "update", "delete"]) {
      b[m] = (payload?: unknown) => {
        current = { table, op: m, payload };
        ops.push(current);
        return b;
      };
    }
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.single = () => Promise.resolve({ data: { id: "doc-1" }, error: null });
    b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve({
        data: null,
        error: current.op === "update" ? markError : null,
      }).then(resolve, reject);
    return b;
  };
  return { db: { getClient: () => ({ from }) }, ops };
}

const parsed = {
  docType: "invoice",
  docNumber: "INV-9",
  docDate: "2026-10-08",
  referencesDocNumber: null,
  currency: "USD",
  subtotal: 100,
  freight: null,
  fuelSurcharge: null,
  splitCaseFee: null,
  deliveryFee: null,
  depositTotal: null,
  tax: null,
  otherCharges: null,
  discountTotal: null,
  total: 100,
  lines: [{ description: "Barolo" }, { description: "Chianti" }],
  computedLinesTotal: 100,
  tieOutDelta: 0,
  tiesOut: true,
  confidence: 0.9,
  warnings: [],
};

function persist(db: unknown) {
  const svc = new DocumentIntakeService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const anySvc = svc as any;
  jest
    .spyOn(anySvc, "insertDocumentLines")
    .mockResolvedValue({ message: "line insert refused" });
  jest.spyOn(anySvc, "linkAndMatch").mockResolvedValue(undefined);
  return anySvc.persist(
    { restaurantId: "r-1", source: "upload" },
    "sha",
    Buffer.from("x"),
    parsed,
  ) as Promise<string | null>;
}

describe("intake keeps a paper whose lines failed, but never as clean (F-546)", () => {
  it("first writes the parse's own status — the clean row the defect left behind", async () => {
    const { db, ops } = fakeDb(null);
    await persist(db);
    const insert = ops.find(
      (o) => o.table === "procurement_documents" && o.op === "insert",
    );
    expect((insert?.payload as { status: string }).status).toBe("received");
  });

  it("flags the paper for review and says the lines were lost", async () => {
    const { db, ops } = fakeDb(null);

    await expect(persist(db)).resolves.toBe("doc-1");
    const mark = ops.find(
      (o) => o.table === "procurement_documents" && o.op === "update",
    );
    expect(mark).toBeDefined();
    const payload = mark!.payload as { status: string; notes: string };
    expect(payload.status).toBe("needs_review");
    expect(payload.notes).toContain(
      "The 2 lines read from this paper could not be saved",
    );
  });

  it("takes the row away and fails when the flag cannot be written either", async () => {
    const { db, ops } = fakeDb({ message: "update refused" });

    await expect(persist(db)).rejects.toThrow(
      /could not be flagged for review/,
    );
    expect(
      ops.some((o) => o.table === "procurement_documents" && o.op === "delete"),
    ).toBe(true);
  });
});
