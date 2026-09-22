import {
  DISMISS_REASONS,
  isDismissReason,
  isRuleWideDismissOrRestore,
  isRuleWideKey,
  mayActRuleWide,
  resolveItemState,
  stateBookFrom,
  StateRow,
} from "./item-state";

/**
 * The ONE shared per-item state (ADR 0191; founder, 2026-09-21: "Build it
 * right, in order"). Every surface resolves an item through
 * `resolveItemState`, so each boundary here is a boundary on the feed,
 * Reports, the rails, the catalogue and the mobile tab at once.
 */

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const RULE = "insight:overall.revenue.vs_same_weekday";
const wednesday = {
  ruleId: RULE,
  subject: "Wednesday",
  periodKey: "d:2026-09-16",
};

function row(
  ruleKey: string,
  status: string,
  over: Partial<StateRow> = {},
): StateRow {
  return { ruleKey, status, reason: null, snoozeUntil: null, ...over };
}

const book = (rows: StateRow[]) => stateBookFrom(rows, NOW);

describe("the shared per-item state", () => {
  it("is active when nothing was written", () => {
    expect(resolveItemState(wednesday, book([])).state).toBe("active");
  });

  describe("dismissed — with its label", () => {
    it("holds at the exact finding and carries the reason", () => {
      const st = resolveItemState(
        wednesday,
        book([
          row(`${RULE}#wednesday#d:2026-09-16`, "dismissed", {
            reason: "disagree",
          }),
        ]),
      );
      expect(st).toEqual({
        state: "dismissed",
        key: `${RULE}#wednesday#d:2026-09-16`,
        reason: "disagree",
        snoozeUntil: null,
      });
    });

    it("holds at subject and rule scope, reporting the widest key in force", () => {
      const st = resolveItemState(
        wednesday,
        book([
          row(`${RULE}#wednesday#*`, "dismissed", { reason: "not_now" }),
          row(RULE, "dismissed", { reason: "not_relevant" }),
        ]),
      );
      expect(st.state).toBe("dismissed");
      expect(st.key).toBe(RULE);
    });

    it("leaves another subject standing", () => {
      const st = resolveItemState(
        wednesday,
        book([row(`${RULE}#tuesday#*`, "dismissed", { reason: "not_now" })]),
      );
      expect(st.state).toBe("active");
    });
  });

  describe("snoozed — the item returns after", () => {
    it("holds while the instant is ahead", () => {
      const st = resolveItemState(
        wednesday,
        book([
          row(`${RULE}#wednesday#d:2026-09-16`, "snoozed", {
            snoozeUntil: "2026-09-28T12:00:00.000Z",
          }),
        ]),
      );
      expect(st).toMatchObject({
        state: "snoozed",
        snoozeUntil: "2026-09-28T12:00:00.000Z",
        reason: null,
      });
    });

    it("is back once the instant has passed", () => {
      const st = resolveItemState(
        wednesday,
        book([
          row(`${RULE}#wednesday#d:2026-09-16`, "snoozed", {
            snoozeUntil: "2026-09-21T11:59:59.000Z",
          }),
        ]),
      );
      expect(st.state).toBe("active");
    });

    it("a snooze with no instant is not a snooze — the item is back", () => {
      const st = resolveItemState(
        wednesday,
        book([row(RULE, "snoozed", { snoozeUntil: null })]),
      );
      expect(st.state).toBe("active");
    });
  });

  describe("done — completion, no negative signal", () => {
    it("holds at the scope it was written and carries no reason", () => {
      const st = resolveItemState(
        wednesday,
        book([
          row(`${RULE}#wednesday#d:2026-09-16`, "done", {
            reason: "not_relevant",
          }),
        ]),
      );
      expect(st).toEqual({
        state: "done",
        key: `${RULE}#wednesday#d:2026-09-16`,
        reason: null,
        snoozeUntil: null,
      });
    });

    it("next week's finding is a different item, and stands", () => {
      const st = resolveItemState(
        { ...wednesday, periodKey: "d:2026-09-23" },
        book([row(`${RULE}#wednesday#d:2026-09-16`, "done")]),
      );
      expect(st.state).toBe("active");
    });
  });

  it("precedence: a dismissal outranks done, and done outranks a snooze", () => {
    const snoozed = row(`${RULE}#wednesday#d:2026-09-16`, "snoozed", {
      snoozeUntil: "2026-09-28T12:00:00.000Z",
    });
    const done = row(`${RULE}#wednesday#*`, "done");
    const dismissed = row(RULE, "dismissed", { reason: "not_now" });
    expect(resolveItemState(wednesday, book([snoozed, done])).state).toBe(
      "done",
    );
    expect(
      resolveItemState(wednesday, book([snoozed, done, dismissed])).state,
    ).toBe("dismissed");
  });

  it("an active row hides nothing", () => {
    expect(resolveItemState(wednesday, book([row(RULE, "active")])).state).toBe(
      "active",
    );
  });
});

describe("the dismissal label set", () => {
  it("is two labels since round 3 — 'Already handled' is done and 'Not now' the person's own snooze", () => {
    expect([...DISMISS_REASONS]).toEqual(["not_relevant", "disagree"]);
    expect(isDismissReason("already_handled")).toBe(false);
    expect(isDismissReason("not_now")).toBe(false);
  });

  it("refuses free text, an empty string and a missing reason", () => {
    expect(isDismissReason("not_relevant")).toBe(true);
    expect(isDismissReason("until tomorrow")).toBe(false);
    expect(isDismissReason("")).toBe(false);
    expect(isDismissReason(null)).toBe(false);
    expect(isDismissReason(undefined)).toBe(false);
  });
});

describe("what counts as rule-wide (founder, 2026-09-21, answer 1)", () => {
  it("the bare key and rule#*#* are rule-wide", () => {
    expect(isRuleWideKey(RULE)).toBe(true);
    expect(isRuleWideKey(`${RULE}#*#*`)).toBe(true);
    expect(isRuleWideKey("stockout_imminent")).toBe(true);
  });

  it("a finding, a subject, or a period alone are not", () => {
    expect(isRuleWideKey(`${RULE}#wednesday#d:2026-09-16`)).toBe(false);
    expect(isRuleWideKey(`${RULE}#wednesday#*`)).toBe(false);
    expect(isRuleWideKey(`${RULE}#*#p7:2026-09-16`)).toBe(false);
  });

  it("dismissing at a rule-wide key is the gated act", () => {
    expect(isRuleWideDismissOrRestore(RULE, "dismissed", null)).toBe(true);
    expect(isRuleWideDismissOrRestore(RULE, "dismissed", "active")).toBe(true);
  });

  it("any status written over a rule-wide dismissal is a restore", () => {
    expect(isRuleWideDismissOrRestore(RULE, "active", "dismissed")).toBe(true);
    expect(isRuleWideDismissOrRestore(RULE, "snoozed", "dismissed")).toBe(true);
    expect(isRuleWideDismissOrRestore(RULE, "done", "dismissed")).toBe(true);
  });

  it("a snooze, a done or a return of a rule that is NOT dismissed is not", () => {
    expect(isRuleWideDismissOrRestore(RULE, "snoozed", null)).toBe(false);
    expect(isRuleWideDismissOrRestore(RULE, "done", "active")).toBe(false);
    expect(isRuleWideDismissOrRestore(RULE, "active", "snoozed")).toBe(false);
  });

  it("no status (a pin, a rating) is never gated", () => {
    expect(isRuleWideDismissOrRestore(RULE, undefined, "dismissed")).toBe(
      false,
    );
  });

  it("a one-finding dismissal is never gated", () => {
    expect(
      isRuleWideDismissOrRestore(
        `${RULE}#wednesday#d:2026-09-16`,
        "dismissed",
        null,
      ),
    ).toBe(false);
  });

  it("owner, manager and admin may; staff and no role may not", () => {
    expect(mayActRuleWide("owner")).toBe(true);
    expect(mayActRuleWide("Manager")).toBe(true);
    expect(mayActRuleWide("admin")).toBe(true);
    expect(mayActRuleWide("staff")).toBe(false);
    expect(mayActRuleWide(null)).toBe(false);
    expect(mayActRuleWide("")).toBe(false);
  });
});
