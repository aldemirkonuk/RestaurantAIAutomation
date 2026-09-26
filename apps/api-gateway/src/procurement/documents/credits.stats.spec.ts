/**
 * GET /procurement/credits/stats — the figures a screen prints, kept apart by
 * currency and honest about the window they were computed behind.
 *
 * The controller is exercised directly with a stubbed query builder: the route's
 * guards are proven in `receiving-credits-roles.spec.ts` (PR #395, ADR 0167), and
 * this file is about what the handler returns, not who may call it.
 */
import { CreditsController } from "./credits.controller";

type Row = Record<string, unknown>;

function controllerOver(
  rows: Row[],
  seen: { select?: string; limit?: number } = {},
) {
  const builder = {
    select(cols: string) {
      seen.select = cols;
      return builder;
    },
    eq() {
      return builder;
    },
    limit(n: number) {
      seen.limit = n;
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const db = { getClient: () => ({ from: () => builder }) };
  return new CreditsController(db as never);
}

const user = { userId: "u1", restaurantId: "r1" };

const row = (o: Row = {}): Row => ({
  state: "open",
  claimed_amount: "10.00",
  credited_amount: null,
  credit_document_id: null,
  opened_at: "2026-09-01T00:00:00.000Z",
  self_evidenced: false,
  currency: "TRY",
  ...o,
});

describe("CreditsController.stats", () => {
  it("reads the claim's currency and returns the figures per currency", async () => {
    const seen: { select?: string } = {};
    const c = controllerOver(
      [
        row({ claimed_amount: "250.00" }),
        row({ claimed_amount: "40.00", currency: "EUR" }),
      ],
      seen,
    );

    const s = await c.stats(user);

    expect(seen.select).toContain("currency");
    expect(Object.keys(s.byCurrency)).toEqual(["EUR", "TRY"]);
    expect(s.byCurrency.TRY.outstanding).toBe(250);
    expect(s.byCurrency.EUR.outstanding).toBe(40);
    // The combined figure is unchanged for its existing readers.
    expect(s.outstanding).toBe(290);
  });

  it("says how many rows it counted, and that it hit the cap when it did", async () => {
    const seen: { limit?: number } = {};
    const under = await controllerOver([row(), row()], seen).stats(user);
    expect(under.rowsCounted).toBe(2);
    expect(under.capped).toBe(false);

    const full = Array.from({ length: seen.limit as number }, () => row());
    const at = await controllerOver(full).stats(user);
    expect(at.rowsCounted).toBe(seen.limit);
    expect(at.capped).toBe(true);
  });

  it("answers an empty ledger with no currency groups", async () => {
    const s = await controllerOver([]).stats(user);
    expect(s.byCurrency).toEqual({});
    expect(s.rowsCounted).toBe(0);
    expect(s.capped).toBe(false);
  });
});
