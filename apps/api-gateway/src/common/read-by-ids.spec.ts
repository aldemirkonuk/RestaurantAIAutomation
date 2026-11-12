import { BY_IDS_CHUNK, readByIds } from "./read-by-ids";
import { WholeReadError } from "./read-whole-window";

/** reports lane r3: the rollup is read for the ids in hand, whole or refused. */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${String(i).padStart(5, "0")}`);

describe("readByIds", () => {
  it("asks for every id once, in batches, and returns every row", async () => {
    const asked: string[][] = [];
    const all = ids(2345);
    const rows = await readByIds<{ inventory_id: string }>(
      "lots",
      [...all, ...all.slice(0, 10), ""],
      async (batch) => {
        asked.push(batch);
        return { data: batch.map((inventory_id) => ({ inventory_id })), error: null };
      },
    );
    expect(rows).toHaveLength(2345);
    expect(new Set(rows.map((r) => r.inventory_id)).size).toBe(2345);
    expect(asked).toHaveLength(Math.ceil(2345 / BY_IDS_CHUNK));
    expect(Math.max(...asked.map((b) => b.length))).toBe(BY_IDS_CHUNK);
  });

  it("makes no request for no ids", async () => {
    const build = jest.fn();
    await expect(readByIds("lots", [], build)).resolves.toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it("refuses when any batch fails, never answering from the others", async () => {
    let n = 0;
    const read = readByIds("The house's lot totals", ids(450), async (batch) =>
      ++n === 3
        ? { data: null, error: { code: "57014", message: "timeout" } }
        : { data: batch.map((inventory_id) => ({ inventory_id })), error: null },
    );
    await expect(read).rejects.toBeInstanceOf(WholeReadError);
    await expect(
      readByIds("The house's lot totals", ids(450), async (batch) =>
        batch.includes("id-00300")
          ? { data: null, error: { code: "57014", message: "timeout" } }
          : { data: [], error: null },
      ),
    ).rejects.toThrow(/The house's lot totals could not be read whole[\s\S]*57014/);
  });

  it("refuses a batch that comes back at the server's cap, since it may have been cut", async () => {
    await expect(
      readByIds("lots", ids(5), async () => ({
        data: Array.from({ length: 1000 }, (_, i) => ({ inventory_id: `x${i}` })),
        error: null,
      })),
    ).rejects.toThrow(/server's cap/);
  });
});
