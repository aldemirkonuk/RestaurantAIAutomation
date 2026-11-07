import "reflect-metadata";
import { readHolders } from "./floor-holders";
import { FloorAdminService } from "./floor-admin.service";
import type { FloorActor } from "./floor-common";

jest.mock("./floor-holders", () => ({ readHolders: jest.fn() }));

/**
 * The reassignment proposal is floor-core's (OD-259); the gateway passes an
 * empty section as no section, and applying moves a table once.
 */
const manager: FloorActor = { userId: "m1", restaurantId: "r1", role: "manager" };
const NOW = Date.parse("2026-11-07T19:00:00Z");

function db() {
  const from = (table: string) => {
    const b: any = {};
    for (const f of ["select", "eq", "is", "in"]) b[f] = () => b;
    const answer = () => {
      if (table === "restaurants") return { data: { name: "Tuzlu", timezone: "Europe/Istanbul" }, error: null };
      if (table === "floor_settings") return { data: null, error: null };
      if (table === "restaurant_tables") return { data: [{ id: "t1", label: "1" }, { id: "t2", label: "2" }], error: null };
      if (table === "floor_seatings") return { data: [{ table_id: "t1" }], error: null };
      return { data: [], error: null };
    };
    b.maybeSingle = () => Promise.resolve(answer());
    b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
    return b;
  };
  return { supabase: { from } } as any;
}

describe("FloorAdminService reassignment", () => {
  it("reads an empty section as none: no one else on shift says no_one_on_shift", async () => {
    (readHolders as jest.Mock).mockResolvedValue({
      byTable: new Map([["t1", ["w1"]]]),
      sectionOf: new Map([["t1", ""]]),
      sectionsOf: new Map(),
    });
    const svc = new FloorAdminService(db(), { emitFloorWord: jest.fn() } as any);
    const out = await svc.proposeReassign(manager, "w1", NOW);
    expect(out.proposals).toEqual([{ tableId: "t1", toWaiterId: null, reason: "no_one_on_shift" }]);
  });

  it("gives a sectionless table to anyone listed", async () => {
    (readHolders as jest.Mock).mockResolvedValue({
      byTable: new Map([["t1", ["w1"]], ["t2", ["w2"]]]),
      sectionOf: new Map([["t1", ""], ["t2", "secB"]]),
      sectionsOf: new Map([["w2", ["secB"]]]),
    });
    const svc = new FloorAdminService(db(), { emitFloorWord: jest.fn() } as any);
    const out = await svc.proposeReassign(manager, "w1", NOW);
    expect(out.proposals).toEqual([{ tableId: "t1", toWaiterId: "w2", reason: "lightest_on_shift" }]);
  });

  it("moves a table listed twice once, to its first destination", async () => {
    const svc = new FloorAdminService(db(), { emitFloorWord: jest.fn() } as any);
    const assign = jest.spyOn(svc, "assign").mockResolvedValue({ assignmentId: "a1" } as any);
    const out = await svc.applyReassign(manager, "w1", [
      { tableId: "t1", toUserId: "w2" },
      { tableId: "t1", toUserId: "w3" },
      { tableId: "t2", toUserId: "w1" },
    ], NOW);
    expect(assign.mock.calls.map((c) => [c[1], c[2]])).toEqual([["w2", { tableId: "t1" }]]);
    expect(out.applied).toEqual([{ tableId: "t1", toUserId: "w2", assignmentId: "a1" }]);
  });
});
