import "reflect-metadata";
import { FloorBoardService } from "./floor-board.service";
import type { FloorHouse } from "./floor-common";

/**
 * floor-core's response time drops a gap whose current actor is "" (it is not
 * replaced by the handoff rule), so the board passes null for every empty id.
 */
const HOUSE: FloorHouse = { name: "Tuzlu", zone: "Europe/Istanbul", warnAfterMin: 6, lateAfterMin: 10 };
const T0 = Date.parse("2026-11-07T17:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const seating = {
  id: "s1",
  table_id: "t1",
  seated_at: at(0),
  seated_by: "",
  caretaker_at_seat_id: "",
  party_size: 2,
  paid_at: null,
  paid_source: null,
  paid_undone_at: null,
  left_at: null,
};

describe("FloorBoardService.figures — empty ids are no one", () => {
  const svc = new FloorBoardService({ supabase: {} } as any);

  it("keeps a real waiter's gap when the next visit carries an empty actor", () => {
    const visits = [
      { seating_id: "s1", table_id: "t1", user_id: "w1", visited_at: at(5) },
      { seating_id: "s1", table_id: "t1", user_id: "", visited_at: at(10) },
    ];
    const { waiters, notClosedUnassigned } = svc.figures([seating], visits, new Set(), HOUSE, T0 + 12 * 60_000);
    // seated → w1 (5 min) and w1 → nobody (5 min) both stay w1's.
    expect(waiters.map((w) => [w.userId, w.gaps])).toEqual([["w1", 2]]);
    // The empty caretaker is nobody's Not closed, not a "" row.
    expect(notClosedUnassigned).toBe(1);
  });
});
