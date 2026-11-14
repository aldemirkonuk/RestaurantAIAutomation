/**
 * ADR 0357 step 2: the block catalogue and the one validator every design
 * write goes through.
 */

import { BLOCK_SPECS, BLOCK_TYPES, blockCatalogue, blockProblems } from "./letter-design-blocks";

describe("block validator", () => {
  it("accepts every type's own defaults", () => {
    const blocks = BLOCK_TYPES.map((t, i) => ({ id: `b${i}`, t, p: { ...BLOCK_SPECS[t].make } }));
    expect(blockProblems(blocks)).toEqual([]);
  });

  it("refuses an event block, an unknown prop, a free URL, markup and a stranger's merge field", () => {
    expect(blockProblems([{ id: "a", t: "event", p: {} }])[0]).toMatch(/not a block type/);
    expect(blockProblems([{ id: "a", t: "divider", p: { color: "red" } }])[0]).toMatch(/no "color" prop/);
    expect(blockProblems([{ id: "a", t: "text", p: { text: "see https://evil.test" } }])[0]).toMatch(/markup or an address/);
    expect(blockProblems([{ id: "a", t: "text", p: { text: "<b>hi</b>" } }])[0]).toMatch(/markup or an address/);
    expect(blockProblems([{ id: "a", t: "text", p: { text: "Hi {{invite_code}}" } }])[0]).toMatch(/not a merge field/);
    expect(blockProblems([{ id: "a", t: "button", p: { act: "https://x.test" } }])[0]).toMatch(/must be one of/);
  });

  it("refuses duplicate ids, extra keys and a non-list", () => {
    expect(blockProblems("x")[0]).toMatch(/must be a list/);
    const dup = [
      { id: "a", t: "divider", p: {} },
      { id: "a", t: "divider", p: {} },
    ];
    expect(blockProblems(dup).join(" ")).toMatch(/repeats the id/);
    expect(blockProblems([{ id: "a", t: "divider", p: {}, x: 1 }])[0]).toMatch(/unknown keys/);
  });

  it("publishes no invitation merge field and no event block in the catalogue", () => {
    const c = blockCatalogue();
    expect(c.mergeFields).not.toContain("invite_code");
    expect(c.blocks.map((b) => b.type)).not.toContain("event");
  });
});
