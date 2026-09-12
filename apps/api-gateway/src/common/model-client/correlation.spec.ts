import {
  correlationMiddleware,
  getCorrelationId,
  runWithCorrelationId,
  runWithNewCorrelationId,
} from "./correlation";

/**
 * These lock the two properties the whole P1 correlation design rests on, both
 * of which fail silently (a null column, not an error) when they break:
 *
 *  1. the id survives every async hop between the entry point and the emitter,
 *     including the fire-and-forget `void promise` shape the NF emitter uses;
 *  2. work with no upstream request still gets an id.
 *
 * Verified against the live table on 2026-08-24: a model call made outside any
 * correlation scope wrote neural_footprint_event row 7adb9aea with
 * correlation_id NULL, while the two made inside an HTTP request carried theirs.
 */
describe("correlation — request scope", () => {
  it("returns null outside any scope, so an unscoped caller is detectable", () => {
    expect(getCorrelationId()).toBeNull();
  });

  it("survives await boundaries — the emitter runs many hops below the entry point", async () => {
    await runWithCorrelationId("cid-await", async () => {
      await new Promise((r) => setTimeout(r, 1));
      await Promise.resolve();
      expect(getCorrelationId()).toBe("cid-await");
    });
    expect(getCorrelationId()).toBeNull();
  });

  it("survives into a fire-and-forget continuation (the NF emitter's shape)", async () => {
    let seen: string | null | undefined;
    const settled = new Promise<void>((resolve) => {
      runWithCorrelationId("cid-void", () => {
        // Exactly what ModelClientService.emit does: start the promise inside
        // the scope, never await it. The store must ride the continuation.
        void Promise.resolve().then(async () => {
          await new Promise((r) => setTimeout(r, 1));
          seen = getCorrelationId();
          resolve();
        });
      });
    });
    await settled;
    expect(seen).toBe("cid-void");
  });

  it("keeps concurrent scopes isolated", async () => {
    const run = (id: string) =>
      runWithCorrelationId(id, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        return getCorrelationId();
      });
    expect(await Promise.all([run("a"), run("b"), run("c")])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("runWithNewCorrelationId — non-HTTP entry points", () => {
  it("mints an id where there is none, so cron-emitted rows are not orphaned", () => {
    const id = runWithNewCorrelationId(() => getCorrelationId());
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("mints a DISTINCT id per unit of work, so one id never spans two documents", () => {
    const ids = [1, 2, 3].map(() =>
      runWithNewCorrelationId(() => getCorrelationId()),
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("propagates through an async unit of work", async () => {
    const id = await runWithNewCorrelationId(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getCorrelationId();
    });
    expect(id).toBeTruthy();
  });
});

describe("correlationMiddleware", () => {
  const call = (headers: Record<string, unknown>) => {
    const res = { setHeader: jest.fn() };
    let seen: string | null = null;
    correlationMiddleware({ headers }, res, () => {
      seen = getCorrelationId();
    });
    return { seen: seen as string | null, res };
  };

  it("honours a caller-supplied x-correlation-id so an upstream join is preserved", () => {
    const { seen, res } = call({ "x-correlation-id": "upstream-123" });
    expect(seen).toBe("upstream-123");
    expect(res.setHeader).toHaveBeenCalledWith(
      "x-correlation-id",
      "upstream-123",
    );
  });

  it("mints one when the caller supplies nothing, and echoes it back", () => {
    const { seen, res } = call({});
    expect(seen).toBeTruthy();
    expect(res.setHeader).toHaveBeenCalledWith("x-correlation-id", seen);
  });

  it("ignores a blank header rather than scoping work to an empty id", () => {
    const { seen } = call({ "x-correlation-id": "   " });
    expect(seen).toBeTruthy();
    expect(seen!.trim()).toBe(seen);
  });

  it("truncates an oversized header to 128 chars (the column is unbounded text)", () => {
    const { seen } = call({ "x-correlation-id": "x".repeat(500) });
    expect(seen).toHaveLength(128);
  });
});
