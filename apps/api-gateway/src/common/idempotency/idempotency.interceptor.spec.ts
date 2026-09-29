import { lastValueFrom, of } from "rxjs";
import { IdempotencyInterceptor } from "./idempotency.interceptor";

/**
 * PR #508 audit (2026-09-29): the web now replays a queued vendor create with
 * the Idempotency-Key its first attempt carried. The case that matters is
 * "committed, reply lost": the first POST ran and stored its response, the
 * client never saw it, and the replay must get that vendor back instead of a
 * second one.
 */
function harness(stored: { status_code: number; response: unknown } | null) {
  const inserts: unknown[] = [];
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: stored, error: null }),
        }),
      }),
      insert: async (row: unknown) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  };
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
  return { interceptor, context, inserts, response };
}

describe("IdempotencyInterceptor — a replayed create", () => {
  it("returns the stored vendor and never runs the handler again", async () => {
    const { interceptor, context, response } = harness({
      status_code: 201,
      response: { id: "vendor-1", name: "Kavaklıdere" },
    });
    const handle = jest.fn(() => of({ id: "vendor-2" }));
    const out = await lastValueFrom(interceptor.intercept(context, { handle }));
    expect(handle).not.toHaveBeenCalled();
    expect(out).toEqual({ id: "vendor-1", name: "Kavaklıdere" });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it("a first attempt runs the handler and stores its answer under the user's key", async () => {
    const { interceptor, context, inserts } = harness(null);
    const handle = jest.fn(() => of({ id: "vendor-1" }));
    const out = await lastValueFrom(interceptor.intercept(context, { handle }));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ id: "vendor-1" });
    await new Promise((r) => setImmediate(r));
    expect(inserts).toEqual([
      expect.objectContaining({
        key: "u1:provider-create:k1",
        status_code: 201,
      }),
    ]);
  });
});
