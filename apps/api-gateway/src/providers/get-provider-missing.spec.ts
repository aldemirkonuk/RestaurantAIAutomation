import { HttpStatus } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

/**
 * `GET /providers/:id` for an id that is not a provider (slice 4 live re-drive,
 * defect 2). `.single()` on no row is a PostgREST ERROR (PGRST116, "Cannot
 * coerce the result to a single JSON object"), and the controller mapped every
 * error to 500 — so "this is not a provider" and "the database is down" were
 * the same answer to the caller.
 *
 * A missing row is a 404 with a sentence. A read that actually failed stays a
 * 500 carrying the reason — the two must never collapse into one another.
 */

/**
 * Anything this suite does not exercise THROWS rather than returning undefined:
 * a silent stub would let a future call pass unnoticed, which is the shape
 * these read-path tests exist to close.
 */
const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `get-provider-missing.spec: ${name}.${String(prop)} was called; ` +
            `this suite covers getProvider only.`,
        );
      },
    },
  ) as never;

describe("GET /providers/:id — a missing provider is 404, a broken read is 500", () => {
  let controller: ProvidersController;
  let answer: { data: unknown; error: unknown };

  const user = { id: "user-1", restaurantId: "rest-1" };
  const ID = "11111111-1111-4111-8111-111111111111";

  const supabase = {
    from: jest.fn(() => {
      const q: Record<string, unknown> = {};
      for (const verb of ["select", "eq", "order", "limit"])
        q[verb] = jest.fn(() => q);
      q.maybeSingle = jest.fn(() => Promise.resolve(answer));
      q.single = jest.fn(() => Promise.resolve(answer));
      return q;
    }),
  };

  beforeEach(() => {
    answer = { data: null, error: null };
    controller = new ProvidersController(
      new ProvidersService(
        { supabase } as never,
        { track: async () => undefined } as never,
        forbidden("ProcurementService"),
      ),
    );
  });

  it("answers 404 with a sentence when no row is there (PostgREST PGRST116)", async () => {
    answer = {
      data: null,
      error: {
        code: "PGRST116",
        message: "Cannot coerce the result to a single JSON object",
      },
    };

    const err = await controller
      .getProvider(ID, user)
      .then(
        () => null,
        (e) => e,
      );

    expect(err).not.toBeNull();
    expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const msg = String(err.message ?? err.getResponse?.());
    expect(msg).not.toContain("coerce");
    expect(msg.length).toBeGreaterThan(20);
  });

  it("answers 404 when the row is simply absent with no error at all", async () => {
    answer = { data: null, error: null };

    const err = await controller
      .getProvider(ID, user)
      .then(
        () => null,
        (e) => e,
      );

    expect(err).not.toBeNull();
    expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("still answers 500, WITH the reason, when the read genuinely failed", async () => {
    answer = {
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
    };

    const err = await controller
      .getProvider(ID, user)
      .then(
        () => null,
        (e) => e,
      );

    expect(err).not.toBeNull();
    expect(err.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(String(err.message)).toContain("timeout");
  });

  it("returns the provider when the row is there", async () => {
    answer = {
      data: {
        id: ID,
        name: "SYNTHETIC Vendor",
        restaurant_id: "rest-1",
      },
      error: null,
    };

    const got = await controller.getProvider(ID, user);
    expect(got.id).toBe(ID);
  });
});
