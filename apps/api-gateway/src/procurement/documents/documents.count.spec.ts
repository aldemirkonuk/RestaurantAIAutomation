import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";

/**
 * `GET /procurement/documents/count` (r41 inventory audit gap 2). /inventory
 * prints "N invoices wait for a match"; it read up to 100 whole invoices for
 * that number. This route answers the number alone. Ids are SYNTHETIC.
 *
 * The controller is built from its prototype with only `db` set: the route
 * reaches nothing else, and a fixed constructor arity would break whenever
 * another chain adds a service.
 */
describe("DocumentsController.count", () => {
  const user = { userId: "u1", restaurantId: "rest-1" } as never;
  let calls: { method: string; args: unknown[] }[];
  let answer: { count: number | null; error: { message: string } | null };

  const controller = (): DocumentsController => {
    const query: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq"])
      query[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return query;
      };
    (query as { then: unknown }).then = (
      ok: (v: unknown) => unknown,
      no: (e: unknown) => unknown,
    ) => Promise.resolve(answer).then(ok, no);
    const c = Object.create(DocumentsController.prototype) as DocumentsController;
    (c as unknown as { db: unknown }).db = { getClient: () => query };
    return c;
  };

  beforeEach(() => {
    calls = [];
    answer = { count: 7, error: null };
  });

  it("answers the number of this house's documents in the status asked, and nothing else", async () => {
    await expect(controller().count(user, "needs_review")).resolves.toEqual({ count: 7 });
    expect(calls).toEqual([
      { method: "from", args: ["procurement_documents"] },
      { method: "select", args: ["id", { count: "exact", head: true }] },
      { method: "eq", args: ["restaurant_id", "rest-1"] },
      { method: "eq", args: ["status", "needs_review"] },
    ]);
  });

  it("counts every status when none is asked", async () => {
    answer = { count: 0, error: null };
    await expect(controller().count(user)).resolves.toEqual({ count: 0 });
    expect(calls.filter((c) => c.method === "eq")).toEqual([
      { method: "eq", args: ["restaurant_id", "rest-1"] },
    ]);
  });

  it("refuses a status the table cannot hold, in words, before reading", async () => {
    const err = await controller()
      .count(user, "pending")
      .catch((e: HttpException) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(400);
    expect((err as HttpException).message).toBe(
      '"pending" is not a document status. It is one of: received, extracting, needs_review, verified, rejected, superseded.',
    );
    expect(calls).toEqual([]);
  });

  it("says a failed read failed, never 0, and keeps the driver's words out", async () => {
    answer = { count: null, error: { message: 'relation "procurement_documents" does not exist' } };
    const err = await controller()
      .count(user, "needs_review")
      .catch((e: HttpException) => e);
    expect((err as HttpException).getStatus()).toBe(500);
    expect((err as HttpException).message).toBe(
      "The house's documents could not be counted just now.",
    );
  });

  it("reads a missing count as a failure, not as none", async () => {
    answer = { count: null, error: null };
    const err = await controller()
      .count(user, "needs_review")
      .catch((e: HttpException) => e);
    expect((err as HttpException).getStatus()).toBe(500);
  });

  it("is declared before GET :id, so Nest never reads `count` as a document id", () => {
    const order = Object.getOwnPropertyNames(DocumentsController.prototype);
    expect(order.indexOf("count")).toBeGreaterThan(-1);
    expect(order.indexOf("count")).toBeLessThan(order.indexOf("detail"));
    const path = Reflect.getMetadata("path", DocumentsController.prototype.count);
    expect(path).toBe("count");
  });
});
