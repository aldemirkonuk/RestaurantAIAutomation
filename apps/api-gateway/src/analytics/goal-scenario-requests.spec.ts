/**
 * A house may request a scenario; only Mudavym may read the requests.
 *
 *   *"Not yet; request a scenario instead."*
 *                             — the founder, 2026-09-05 (ADR 0120 Q4)
 *
 * Three things have to hold, and each fails in a different place:
 *
 *  1. **The write names the actor.** "Who asked" is half of what the founder
 *     reads. An anonymous row would render as a request nobody made, so the
 *     service refuses rather than storing one — the NOT NULL column is the
 *     backstop, this is the refusal a person can read.
 *  2. **A failed read is a failure.** `supabase-js` resolves `{ data, error }`,
 *     so `const { data }` over a broken read yields `[]`, and on THIS surface
 *     an empty list reads as "no house has asked for anything", i.e. as
 *     evidence the catalogue already covers the field. That is the repo's
 *     standing fault, and the test that would have caught it is here.
 *  3. **The founder's read is the founder's.** It is cross-tenant by
 *     construction, so it is gated by the platform-admin service key (ADR
 *     0099), never by a JWT — which every logged-in house holds — and the
 *     `@Public()` that lets the key decide must not have landed on any other
 *     handler of this controller.
 *
 * The catalogue seam is asserted too: `goalScenarioBook()` must not grow rows
 * from this table, because the whole reason a house may not author a scenario
 * is that every row in the book carries a source a reader can check.
 */

import { GoalScenarioRequestsService } from "./goal-scenario-requests.service";
import { AnalyticsController } from "./analytics.controller";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { goalScenarioBook } from "./goal-scenarios";

/* ── a supabase-js stand-in: it RESOLVES, exactly as the real client does ── */

type Answer = { data: unknown; error: { message: string } | null };

function client(answers: {
  insert?: Answer;
  select?: Answer;
  names?: Answer;
}): { db: any; seen: { inserted?: Record<string, unknown>; tables: string[] } } {
  const seen: { inserted?: Record<string, unknown>; tables: string[] } = {
    tables: [],
  };
  const supabase = {
    from(table: string) {
      seen.tables.push(table);
      if (table === "goal_scenario_request") {
        return {
          insert(row: Record<string, unknown>) {
            seen.inserted = row;
            return {
              select: () => ({
                single: async () =>
                  answers.insert ?? { data: null, error: null },
              }),
            };
          },
          select: () => ({
            order: () => ({
              limit: async () => answers.select ?? { data: [], error: null },
            }),
          }),
        };
      }
      // restaurants / users name lookups
      return {
        select: () => ({
          in: async () => answers.names ?? { data: [], error: null },
        }),
      };
    },
  };
  return { db: { supabase } as any, seen };
}

const ROW = {
  id: "req-1",
  restaurant_id: "r-1",
  requested_by: "u-1",
  words: "we want to hold our pour cost",
  requested_at: "2026-09-05T10:00:00.000Z",
};

describe("GoalScenarioRequestsService.record — the write", () => {
  it("stores the words, the house, the person and the time", async () => {
    const { db, seen } = client({ insert: { data: ROW, error: null } });
    const out = await new GoalScenarioRequestsService(db).record({
      restaurantId: "r-1",
      words: "  we want to hold our pour cost  ",
      requestedBy: "u-1",
    });
    expect(seen.inserted).toEqual({
      restaurant_id: "r-1",
      requested_by: "u-1",
      // Trimmed, so a stray newline cannot become the whole request.
      words: "we want to hold our pour cost",
    });
    expect(out.recorded).toBe(true);
    expect(out.request.requestedAt).toBe("2026-09-05T10:00:00.000Z");
    // The house is told what did NOT happen, in the same breath as what did.
    expect(out.note).toContain("catalogue is ours");
  });

  it("refuses an anonymous request rather than storing one", async () => {
    const { db, seen } = client({ insert: { data: ROW, error: null } });
    const svc = new GoalScenarioRequestsService(db);
    for (const nobody of [null, "", "   "]) {
      await expect(
        svc.record({ restaurantId: "r-1", words: "a thing", requestedBy: nobody }),
      ).rejects.toThrow(/who asked/i);
    }
    expect(seen.inserted).toBeUndefined();
  });

  it("refuses an empty request and one longer than the column allows", async () => {
    const { db } = client({ insert: { data: ROW, error: null } });
    const svc = new GoalScenarioRequestsService(db);
    await expect(
      svc.record({ restaurantId: "r-1", words: "   ", requestedBy: "u-1" }),
    ).rejects.toThrow(/hold your house to/i);
    await expect(
      svc.record({
        restaurantId: "r-1",
        words: "x".repeat(2001),
        requestedBy: "u-1",
      }),
    ).rejects.toThrow(/2000 characters/);
  });

  it("reports a failed write as a failure, never as a stored request", async () => {
    // ADR 0020: a page may not claim a write it never made. The client resolves
    // with an error rather than throwing, so a `const { data }` here would have
    // returned `recorded: true` over nothing at all.
    const { db } = client({
      insert: { data: null, error: { message: "permission denied" } },
    });
    await expect(
      new GoalScenarioRequestsService(db).record({
        restaurantId: "r-1",
        words: "a thing",
        requestedBy: "u-1",
      }),
    ).rejects.toThrow(/not stored: permission denied/);
  });

  it("reports a write that returned no row as a failure too", async () => {
    const { db } = client({ insert: { data: null, error: null } });
    await expect(
      new GoalScenarioRequestsService(db).record({
        restaurantId: "r-1",
        words: "a thing",
        requestedBy: "u-1",
      }),
    ).rejects.toThrow(/no row/);
  });
});

describe("GoalScenarioRequestsService.listAll — the founder's read", () => {
  it("returns the requests newest-first with the names beside them", async () => {
    const { db } = client({
      select: { data: [ROW], error: null },
      names: { data: [{ id: "r-1", name: "Sim Meyhouse" }], error: null },
    });
    const out = await new GoalScenarioRequestsService(db).listAll();
    expect(out.count).toBe(1);
    expect(out.requests[0].words).toBe("we want to hold our pour cost");
    expect(out.requests[0].house).toBe("Sim Meyhouse");
    expect(out.truncated).toBe(false);
    expect(out.namesUnread).toBeNull();
  });

  it("THROWS on a failed read — an empty list here would read as 'nobody asked'", async () => {
    const { db } = client({
      select: { data: null, error: { message: "relation does not exist" } },
    });
    await expect(
      new GoalScenarioRequestsService(db).listAll(),
    ).rejects.toThrow(/could not be read: relation does not exist/);
  });

  it("says the names are UNREAD rather than leaving them silently blank", async () => {
    const { db } = client({
      select: { data: [ROW], error: null },
      names: { data: null, error: { message: "timeout" } },
    });
    const out = await new GoalScenarioRequestsService(db).listAll();
    expect(out.requests[0].house).toBeNull();
    expect(out.namesUnread).toMatch(/could not be read \(timeout\)/);
    // The request itself still arrives: a name lookup failing must not lose
    // the words, which are the thing the founder is reading.
    expect(out.requests[0].words).toBe("we want to hold our pour cost");
  });

  it("bounds the page and says when there is more", async () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ ...ROW, id: `req-${i}` }));
    const { db } = client({ select: { data: many, error: null } });
    const out = await new GoalScenarioRequestsService(db).listAll(3);
    expect(out.limit).toBe(3);
    expect(out.count).toBe(3);
    expect(out.truncated).toBe(true);
  });

  it("clamps a silly limit rather than accepting it", async () => {
    const { db } = client({ select: { data: [], error: null } });
    const svc = new GoalScenarioRequestsService(db);
    expect((await svc.listAll(0)).limit).toBe(1);
    expect((await svc.listAll(99999)).limit).toBe(500);
    expect((await svc.listAll(Number.NaN)).limit).toBe(100);
  });
});

/* ── the gate, which no service test can see ─────────────────────────────── */

function handler(name: string): (...args: unknown[]) => unknown {
  const fn = (AnalyticsController.prototype as unknown as Record<string, unknown>)[
    name
  ];
  if (typeof fn !== "function")
    throw new Error(
      `AnalyticsController has no handler "${name}" — this test is stale, which is the one way it could pass by looking at nothing`,
    );
  return fn as (...args: unknown[]) => unknown;
}

const guardsOn = (name: string): unknown[] =>
  (Reflect.getMetadata("__guards__", handler(name)) as unknown[]) ?? [];
const isPublic = (name: string): boolean =>
  Reflect.getMetadata(IS_PUBLIC_KEY, handler(name)) === true;

describe("who may read the requests", () => {
  it("gates the founder's read with the service key, not a JWT", () => {
    expect(isPublic("listGoalScenarioRequests")).toBe(true);
    expect(guardsOn("listGoalScenarioRequests")).toContain(ServiceKeyGuard);
  });

  it("leaves the house's write on the JWT, with no admin key", () => {
    expect(isPublic("requestGoalScenario")).toBe(false);
    expect(guardsOn("requestGoalScenario")).not.toContain(ServiceKeyGuard);
  });

  it("makes NO other handler on this controller public", () => {
    // The `@Public()` that lets the key decide is one decorator away from
    // opening a tenant route to the internet with every test still passing.
    const publics = Object.getOwnPropertyNames(AnalyticsController.prototype)
      .filter(
        (n) =>
          n !== "constructor" &&
          typeof (
            AnalyticsController.prototype as unknown as Record<string, unknown>
          )[n] === "function",
      )
      .filter(isPublic);
    expect(publics).toEqual(["listGoalScenarioRequests"]);
  });
});

describe("the catalogue stays one truth", () => {
  it("serves a book that no request can grow", () => {
    // `goalScenarioBook()` takes no argument and reads no database, so a
    // tenant-authored row cannot reach it. The count is the catalogue's own.
    expect(goalScenarioBook.length).toBe(0);
    const book = goalScenarioBook();
    expect(book.counts.total).toBe(book.scenarios.length);
    expect(book.scenarios.every((s) => typeof s.id === "string")).toBe(true);
  });
});
