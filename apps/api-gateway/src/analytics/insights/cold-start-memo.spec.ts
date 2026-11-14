import { AnalyticsController } from "../analytics.controller";
import {
  COLD_EMPTY_TTL_MS,
  ColdStartMemo,
  isCleanEmpty,
} from "./cold-start-memo";

/**
 * r36 reports audit, gap 8: a house whose insight compute finds nothing
 * stores nothing, so every /reports load and every ⌘K feed recomputed the
 * whole bundle. A clean empty answer is now held for ten minutes.
 */

const EMPTY = { insights: [], sourcesUnread: [], persisted: true };

function controller(answers: Array<Record<string, unknown>>) {
  const generate = jest.fn(async () => answers.shift() ?? EMPTY);
  const generator = {
    readStored: jest.fn(async () => ({
      read: 0,
      rows: [],
      withheld: { dismissed: 0 },
      suppressionsReadable: true,
    })),
    generate,
  };
  const actions = {
    viewFor: jest.fn(async (_r: string, _u: unknown, list: unknown[]) => ({
      kept: list,
      hiddenForYou: 0,
      personalSnoozesReadable: true,
    })),
  };
  const c = new AnalyticsController(
    {} as any,
    {} as any,
    {} as any,
    actions as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    generator as any,
    {} as any,
    {} as any,
  );
  const read = (refresh?: string, categories?: string) =>
    c.getInsights("r1", refresh, categories, undefined, undefined, {
      userId: "u1",
    });
  return { read, generate };
}

describe("a house with nothing to say is not recomputed on every load (r36 gap 8)", () => {
  it("[REVERT-FAILS] a second cold read inside the window computes nothing", async () => {
    const { read, generate } = controller([{ ...EMPTY }]);
    await read();
    const second: any = await read();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.insights).toEqual([]);
  });

  it("refresh=true computes again, and clears what was held", async () => {
    const { read, generate } = controller([{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }]);
    await read();
    await read("true");
    expect(generate).toHaveBeenCalledTimes(2);
    await read();
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("a compute whose read failed is not held: the next load tries again", async () => {
    const { read, generate } = controller([
      { insights: [], sourcesUnread: ["the consumption log"], persisted: true },
      { ...EMPTY },
    ]);
    await read();
    await read();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("each category set is held apart", async () => {
    const { read, generate } = controller([]);
    await read(undefined, "sales");
    await read(undefined, "inventory");
    await read(undefined, "sales");
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe("ColdStartMemo", () => {
  it("holds a clean empty answer for the window, then computes again", async () => {
    let t = 1_000;
    const memo = new ColdStartMemo<typeof EMPTY>(() => t);
    const compute = jest.fn(async () => ({ ...EMPTY }));
    await memo.run("k", compute);
    t += COLD_EMPTY_TTL_MS - 1;
    await memo.run("k", compute);
    expect(compute).toHaveBeenCalledTimes(1);
    t += 1;
    await memo.run("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("never holds an answer with something to say", async () => {
    const memo = new ColdStartMemo<any>(() => 0);
    const compute = jest.fn(async () => ({ ...EMPTY, insights: [{ id: 1 }] }));
    await memo.run("k", compute);
    await memo.run("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("two reads that land together share one compute, held or not", async () => {
    const memo = new ColdStartMemo<any>(() => 0);
    let release!: (v: unknown) => void;
    const compute = jest.fn(
      () => new Promise((ok) => (release = ok)) as Promise<any>,
    );
    const a = memo.run("k", compute);
    const b = memo.run("k", compute);
    release({ ...EMPTY, insights: [{ id: 1 }] });
    expect(await a).toBe(await b);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("a failed compute is not held and does not block the next", async () => {
    const memo = new ColdStartMemo<any>(() => 0);
    const compute = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ...EMPTY });
    await expect(memo.run("k", compute)).rejects.toThrow("boom");
    await memo.run("k", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("stays bounded, dropping the oldest house first", async () => {
    const memo = new ColdStartMemo<any>(() => 0, COLD_EMPTY_TTL_MS, 2);
    const compute = jest.fn(async () => ({ ...EMPTY }));
    await memo.run("a", compute);
    await memo.run("b", compute);
    await memo.run("c", compute);
    expect(compute).toHaveBeenCalledTimes(3);
    await memo.run("b", compute);
    await memo.run("c", compute);
    expect(compute).toHaveBeenCalledTimes(3);
    await memo.run("a", compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it("keys a house by its sorted categories, and clear forgets only that house", async () => {
    expect(ColdStartMemo.keyOf("r1", ["sales", "inventory"])).toBe(
      ColdStartMemo.keyOf("r1", ["inventory", "sales"]),
    );
    expect(ColdStartMemo.keyOf("r1")).toBe("r1|*");
    const memo = new ColdStartMemo<any>(() => 0);
    const compute = jest.fn(async () => ({ ...EMPTY }));
    await memo.run("r1|*", compute);
    await memo.run("r10|*", compute);
    memo.clear("r1");
    await memo.run("r10|*", compute);
    expect(compute).toHaveBeenCalledTimes(2);
    await memo.run("r1|*", compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("is clean only when empty, every read answered and the persist landed", () => {
    expect(isCleanEmpty(EMPTY)).toBe(true);
    expect(isCleanEmpty({ ...EMPTY, persisted: false })).toBe(false);
    expect(isCleanEmpty({ ...EMPTY, persisted: null })).toBe(false);
    expect(isCleanEmpty({ ...EMPTY, sourcesUnread: ["x"] })).toBe(false);
    expect(isCleanEmpty({ ...EMPTY, sourcesUnread: undefined })).toBe(false);
    expect(isCleanEmpty({ ...EMPTY, insights: [1] })).toBe(false);
    expect(isCleanEmpty({ ...EMPTY, insights: undefined })).toBe(false);
  });
});
