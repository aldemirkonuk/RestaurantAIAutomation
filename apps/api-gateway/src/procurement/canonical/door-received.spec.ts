import { receivedAtTheDoor } from "./door-received";

/** r24: a paper reads back what the door counted of it, by its own line numbers. */
const REST = "rest-1";
const PAPER = "paper-1";

/** Answers keyed by `table` or `table:role` (the door-count join filters on role). */
function client(answers: Record<string, { data: unknown; error: { message: string } | null }>) {
  return {
    from(table: string) {
      let key = table;
      const chain: Record<string, unknown> = {};
      for (const v of ["select", "in", "order"]) chain[v] = () => chain;
      chain.eq = (col: string, val: string) => {
        if (col === "role") key = `${table}:${val}`;
        return chain;
      };
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(answers[key] ?? { data: [], error: null }).then(resolve);
      return chain;
    },
  };
}

const base = () => ({
  document_deliveries: { data: [{ delivery_id: "del-1" }], error: null },
  "document_deliveries:door_count": { data: [{ document_id: "door-a" }, { document_id: "door-b" }, { document_id: "door-other" }], error: null },
  procurement_documents: {
    data: [
      { id: "door-b", extracted: { countedFor: PAPER, countedAt: "2026-11-13T10:05:00Z" }, created_at: null },
      { id: "door-a", extracted: { countedFor: PAPER, countedAt: "2026-11-13T09:00:00Z" }, created_at: null },
      { id: "door-other", extracted: { countedFor: "another-paper", countedAt: "2026-11-13T11:00:00Z" }, created_at: null },
    ],
    error: null,
  },
  procurement_document_lines: {
    data: [
      { document_id: "door-a", line_no: 3, qty_bottles: "4" },
      { document_id: "door-a", line_no: 4, qty_bottles: "12" },
      { document_id: "door-b", line_no: 3, qty_bottles: "5" },
      { document_id: "door-other", line_no: 4, qty_bottles: "99" },
    ],
    error: null,
  },
});

describe("receivedAtTheDoor (r24)", () => {
  it("per paper line, the latest count made for this paper; another paper's count is not read", async () => {
    const r = await receivedAtTheDoor(client(base()), REST, PAPER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 09:00 counted 4 of line 3 and 12 of line 4; the 10:05 re-count says 5 of line 3.
    expect([...r.value.entries()].sort()).toEqual([[3, 5], [4, 12]]);
  });

  it("a paper on no delivery, or with no count for it, has nothing received", async () => {
    const none = await receivedAtTheDoor(client({ ...base(), document_deliveries: { data: [], error: null } }), REST, PAPER);
    expect(none.ok && none.value.size).toBe(0);
    const others = await receivedAtTheDoor(
      client({ ...base(), procurement_documents: { data: [{ id: "door-other", extracted: { countedFor: "x" }, created_at: null }], error: null } }),
      REST,
      PAPER,
    );
    expect(others.ok && others.value.size).toBe(0);
  });

  it.each(["document_deliveries", "document_deliveries:door_count", "procurement_documents", "procurement_document_lines"])(
    "a failed read of %s is said, never an empty answer",
    async (table) => {
      const r = await receivedAtTheDoor(client({ ...base(), [table]: { data: null, error: { message: "boom" } } }), REST, PAPER);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toContain("(boom)");
    },
  );
});
