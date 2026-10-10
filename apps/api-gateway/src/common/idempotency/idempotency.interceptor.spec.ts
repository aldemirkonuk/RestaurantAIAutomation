import { ConflictException } from "@nestjs/common";
import { Observable, lastValueFrom, of, throwError } from "rxjs";
import {
  IdempotencyInterceptor,
  STILL_RUNNING_MESSAGE,
  STILL_RUNNING_REASON,
} from "./idempotency.interceptor";

/**
 * PR #508 audit (2026-09-29): the web now replays a queued vendor create with
 * the Idempotency-Key its first attempt carried. The case that matters is
 * "committed, reply lost": the first POST ran and stored its response, the
 * client never saw it, and the replay must get that vendor back instead of a
 * second one.
 *
 * F-566 (owner-quarter sim): a re-save sent while the first is STILL RUNNING
 * used to find no stored answer and run the handler again. The stand-in below
 * is one table keyed like the real one (primary key `key`), so a second claim
 * on a key is refused the way Postgres refuses it (23505).
 */
type Row = {
  key: string;
  status_code: number;
  response: unknown;
  created_at: string;
  [col: string]: unknown;
};

function makeTable(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((r) => [r.key, { ...r }]));
  const supabase = {
    from: () => {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" | "delete" = "select";
      let patch: Partial<Row> = {};
      const matching = () =>
        [...rows.values()].filter((r) => filters.every((f) => f(r)));
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => (
          filters.push((r) => r[col] === val),
          q
        ),
        lt: (col: string, val: string) => (
          filters.push((r) => String(r[col]) < val),
          q
        ),
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        insert: async (row: Omit<Row, "created_at">) => {
          const key = row.key as string;
          if (rows.has(key)) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          rows.set(key, {
            ...row,
            key,
            created_at: new Date().toISOString(),
          } as Row);
          return { error: null };
        },
        update: (p: Partial<Row>) => ((op = "update"), (patch = p), q),
        delete: () => ((op = "delete"), q),
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) => {
          for (const r of matching()) {
            if (op === "update") Object.assign(r, patch);
            if (op === "delete") rows.delete(r.key);
          }
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { supabase, rows };
}

function harness(seed: Row[] = []) {
  const { supabase, rows } = makeTable(seed);
  const interceptor = new IdempotencyInterceptor({ supabase } as any);
  const response = { statusCode: 201, status: jest.fn(), setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "POST",
        url: "/providers",
        headers: { "idempotency-key": "provider-create:k1" },
        user: { userId: "u1" },
      }),
      getResponse: () => response,
    }),
  } as any;
  return { interceptor, context, rows, response };
}

const KEY = "u1:provider-create:k1";
const settle = () => new Promise((r) => setImmediate(r));

describe("IdempotencyInterceptor — a replayed create", () => {
  it("returns the stored vendor and never runs the handler again", async () => {
    const { interceptor, context, response } = harness([
      {
        key: KEY,
        status_code: 201,
        response: { id: "vendor-1", name: "Kavaklıdere" },
        created_at: new Date().toISOString(),
      },
    ]);
    const handle = jest.fn(() => of({ id: "vendor-2" }));
    const out = await lastValueFrom(interceptor.intercept(context, { handle }));
    expect(handle).not.toHaveBeenCalled();
    expect(out).toEqual({ id: "vendor-1", name: "Kavaklıdere" });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it("a first attempt runs the handler and stores its answer under the user's key", async () => {
    const { interceptor, context, rows } = harness();
    const handle = jest.fn(() => of({ id: "vendor-1" }));
    const out = await lastValueFrom(interceptor.intercept(context, { handle }));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ id: "vendor-1" });
    await settle();
    expect(rows.get(KEY)).toEqual(
      expect.objectContaining({
        status_code: 201,
        response: { id: "vendor-1" },
      }),
    );
  });
});

describe("IdempotencyInterceptor — a re-send while the first is still running (F-566)", () => {
  it("is refused with 409 and never runs the handler a second time", async () => {
    const { interceptor, context, rows } = harness();
    let finishFirst!: (body: unknown) => void;
    const first = jest.fn(
      () =>
        new Observable((sub) => {
          finishFirst = (body) => {
            sub.next(body);
            sub.complete();
          };
        }),
    );
    const firstOut = lastValueFrom(
      interceptor.intercept(context, { handle: first }),
    );
    await settle();
    expect(first).toHaveBeenCalledTimes(1);

    const second = jest.fn(() => of({ id: "stock-twice" }));
    const err = await lastValueFrom(
      interceptor.intercept(context, { handle: second }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(STILL_RUNNING_MESSAGE);
    // F-950: typed, so a queue waits on it instead of parking it as a no.
    expect(err.getResponse()).toMatchObject({
      statusCode: 409,
      reason: STILL_RUNNING_REASON,
      message: STILL_RUNNING_MESSAGE,
    });
    expect(second).not.toHaveBeenCalled();

    finishFirst({ id: "stock-once" });
    await expect(firstOut).resolves.toEqual({ id: "stock-once" });
    await settle();
    expect(rows.get(KEY)?.status_code).toBe(201);

    // Once the first has answered, the same key replays that answer.
    const third = jest.fn(() => of({ id: "stock-twice" }));
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle: third })),
    ).resolves.toEqual({ id: "stock-once" });
    expect(third).not.toHaveBeenCalled();
  });

  it("a failed first run releases the key, so the retry runs", async () => {
    const { interceptor, context, rows } = harness();
    const failing = jest.fn(() => throwError(() => new Error("db down")));
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle: failing })),
    ).rejects.toThrow("db down");
    await settle();
    expect(rows.has(KEY)).toBe(false);

    const retry = jest.fn(() => of({ id: "vendor-1" }));
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle: retry })),
    ).resolves.toEqual({ id: "vendor-1" });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("a claim left behind by a run that never finished is taken over after it expires", async () => {
    const { interceptor, context } = harness([
      {
        key: KEY,
        status_code: 102,
        response: null,
        created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      },
    ]);
    const handle = jest.fn(() => of({ id: "vendor-1" }));
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle })),
    ).resolves.toEqual({ id: "vendor-1" });
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
