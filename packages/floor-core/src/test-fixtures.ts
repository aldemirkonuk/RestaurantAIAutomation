/**
 * Shared fixtures for the floor-core specs: a fixed clock and the house
 * settings the checker's scripts used. Not exported from the
 * package (`index.ts` does not list it) and not a spec (jest runs `*.spec.ts`).
 */
import type { SeatingFacts, VisitEvent } from "./index";

export const MIN = 60_000;
export const T0 = Date.parse("2026-07-22T12:00:00Z");
export const at = (m: number) => new Date(T0 + m * MIN).toISOString();

/** House settings the checker's scripts used: warn 10, late 15. */
export const WARN = 10;
export const LATE = 15;

export function ev(
  type: "seated" | "check_in",
  actorId: string | null,
  minute: number,
  over: Partial<VisitEvent> = {},
): VisitEvent {
  return { seatingId: "s1", tableId: "t1", type, actorId, createdAt: at(minute), ...over };
}

export function facts(over: Partial<SeatingFacts> = {}): SeatingFacts {
  return {
    seatingId: "s1",
    tableId: "t1",
    seatedAt: at(0),
    seatedBy: "W",
    caretakerAtSeatId: "W",
    paidAt: null,
    leftAt: null,
    caretakerLastTapAt: null,
    tableHidden: false,
    ...over,
  };
}
