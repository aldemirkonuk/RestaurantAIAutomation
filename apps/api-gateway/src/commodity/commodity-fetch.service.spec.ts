/**
 * THE ORDER OF THE TWO GATES, ASSERTED RATHER THAN READ.
 *
 * `readWithToken` checks the self-imposed daily budget BEFORE it asks for a
 * token (`commodity-fetch.service.ts`, the BUDGET/TOKEN/READ comment). The audit
 * of c22a20a2 (finding 3) found the ordering real in the code and untested at the
 * service level: `tuik-token.spec.ts` proves `spend()` in isolation, and nothing
 * proved that the composed path does not mint a token first and discover the
 * budget afterwards. That is exactly the mistake the ordering exists to prevent —
 * a misconfigured environment spending the day's allowance on finding out it is
 * misconfigured — so it gets a test that fails if the two lines are swapped.
 *
 * Nothing here goes outbound: the token fetcher is a stub, and `fetch` is
 * replaced for the duration of the one test that gets far enough to call it.
 */

import { CommodityFetchService } from "./commodity-fetch.service";
import type { DatabaseService } from "../database/database.service";
import { SERIES, type SeriesEntry } from "./commodity.registry";
import type { TuikTokenHolder } from "./tuik-token";

/** The real registry row, so this is a test about the source we actually armed. */
const TT01: SeriesEntry = SERIES["tuik.tufe_tt01.food_and_non_alcoholic_beverages"];

/** Reach the private reader without loosening its visibility in production code. */
type ReadableService = { readWithToken(entry: SeriesEntry): Promise<string> };

interface HolderStub {
  spendCalls: number[];
  tokenCalls: number;
}

function serviceWith(budgetAllows: boolean): {
  service: CommodityFetchService;
  stub: HolderStub;
} {
  const stub: HolderStub = { spendCalls: [], tokenCalls: 0 };
  const service = new CommodityFetchService({} as DatabaseService);
  const holder = {
    spend(budgetPerDay: number): boolean {
      stub.spendCalls.push(budgetPerDay);
      return budgetAllows;
    },
    spentSoFar(): { day: string; spent: number } {
      return { day: "2026-09-06", spent: 24 };
    },
    async get(): Promise<{ token: string | null; refusal: null; detail: null }> {
      stub.tokenCalls += 1;
      return { token: "a-stub-token-never-a-real-one", refusal: null, detail: null };
    },
  };
  (service as unknown as { tuik: TuikTokenHolder }).tuik = holder as unknown as TuikTokenHolder;
  return { service, stub };
}

describe("the budget is checked before a token is asked for", () => {
  it("spends nothing on the token endpoint when the day's budget is gone", async () => {
    const { service, stub } = serviceWith(false);
    await expect((service as unknown as ReadableService).readWithToken(TT01)).rejects.toThrow(
      /self-imposed budget/,
    );
    // THE ASSERTION THIS SPEC EXISTS FOR: the token fetcher was never reached.
    expect(stub.tokenCalls).toBe(0);
    expect(stub.spendCalls).toEqual([TT01.requestBudgetPerDay]);
  });

  it("the refusal names the budget, the issuer and what was already spent", async () => {
    const { service } = serviceWith(false);
    let message = "";
    try {
      await (service as unknown as ReadableService).readWithToken(TT01);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(String(TT01.requestBudgetPerDay));
    expect(message).toContain(TT01.issuer);
    expect(message).toContain("2026-09-06");
    expect(message).toContain("nothing was read");
    // And it says whose ceiling it is, because TUIK states none.
    expect(message).toContain("this ceiling is ours");
  });

  it("asks for a token exactly once when the budget allows the read", async () => {
    const { service, stub } = serviceWith(true);
    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = (async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, text: async () => "csv,payload\n" } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      const body = await (service as unknown as ReadableService).readWithToken(TT01);
      expect(body).toBe("csv,payload\n");
    } finally {
      global.fetch = realFetch;
    }
    expect(stub.spendCalls).toEqual([TT01.requestBudgetPerDay]);
    expect(stub.tokenCalls).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
