/**
 * The overdue-order rule in one place (ADR 0207, round 3 — the founder's
 * delegation of 2026-09-21: "think of a best way to handle this ... You tell
 * me"). Pure; nothing is mocked.
 */

import { deadlineOf, DAY_MS } from "./delivery-deadline";
import {
  INCOMPLETE_AFTER_DAYS,
  NOT_YET,
  confirmingAnswer,
  overdueStanding,
} from "./overdue-order";

const d = deadlineOf("2026-09-10", "Europe/Istanbul")!; // 2026-09-10T21:00:00Z
const at = (iso: string) => Date.parse(iso);
const ans = (expected: string, when: string, answer: string = NOT_YET) => ({
  order_id: "o",
  answer,
  expected_date: expected,
  answered_at: when,
});
const stand = (
  nowIso: string,
  answers = [] as ReturnType<typeof ans>[],
  over = {},
) =>
  overdueStanding({
    status: "CONFIRMED",
    expectedDate: "2026-09-10",
    deadline: d,
    nowMs: at(nowIso),
    answers,
    closedWithCredit: false,
    ...over,
  });

describe("where an order out with the vendor stands", () => {
  it("is not due before the house's midnight, and unconfirmed after it with nobody's answer", () => {
    expect(stand("2026-09-10T20:59:59Z")).toEqual({ kind: "not_due" });
    expect(stand("2026-09-10T21:00:00Z")).toEqual({
      kind: "unconfirmed",
      days: 1,
    });
  });

  it("is confirmed late by a Not yet for THIS expected date, given after the deadline could have passed", () => {
    expect(
      stand("2026-09-13T09:00:00Z", [
        ans("2026-09-10", "2026-09-11T08:00:00Z"),
      ]),
    ).toEqual({
      kind: "confirmed_late",
      days: 3,
      answeredAt: "2026-09-11T08:00:00Z",
    });
    // For an old expected date — the vendor moved it.
    expect(
      stand("2026-09-13T09:00:00Z", [ans("2026-09-08", "2026-09-11T08:00:00Z")])
        ?.kind,
    ).toBe("unconfirmed");
    // Before the deadline.
    expect(
      stand("2026-09-13T09:00:00Z", [ans("2026-09-10", "2026-09-10T08:00:00Z")])
        ?.kind,
    ).toBe("unconfirmed");
    // An answer that is not "not_yet".
    expect(
      stand("2026-09-13T09:00:00Z", [
        ans("2026-09-10", "2026-09-11T08:00:00Z", "yes"),
      ])?.kind,
    ).toBe("unconfirmed");
  });

  it("is incomplete 30 days past the deadline, answered or not", () => {
    const edge = new Date(
      d.latest + INCOMPLETE_AFTER_DAYS * DAY_MS,
    ).toISOString();
    const before = new Date(
      d.latest + INCOMPLETE_AFTER_DAYS * DAY_MS - 1,
    ).toISOString();
    expect(stand(before)?.kind).toBe("unconfirmed");
    expect(stand(edge)).toEqual({
      kind: "incomplete",
      days: 31,
      confirmed: false,
    });
    expect(
      stand(edge, [ans("2026-09-10", "2026-09-11T08:00:00Z")]),
    ).toMatchObject({
      kind: "incomplete",
      confirmed: true,
    });
  });

  it("is no candidate when it is not placed with the vendor, has no date, or was closed with a credit", () => {
    expect(stand("2026-09-13T09:00:00Z", [], { status: "PENDING" })).toBeNull();
    expect(
      stand("2026-09-13T09:00:00Z", [], { status: "DELIVERED" }),
    ).toBeNull();
    expect(stand("2026-09-13T09:00:00Z", [], { deadline: null })).toBeNull();
    expect(
      stand("2026-09-13T09:00:00Z", [], { closedWithCredit: true }),
    ).toBeNull();
  });

  it("takes the latest confirming answer", () => {
    const a = confirmingAnswer("2026-09-10", d, [
      ans("2026-09-10", "2026-09-11T08:00:00Z"),
      ans("2026-09-10", "2026-09-12T08:00:00Z"),
    ]);
    expect(a?.answered_at).toBe("2026-09-12T08:00:00Z");
  });
});
