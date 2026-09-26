import {
  DISMISS_REASONS,
  isDismissReason,
  isRuleWideDismissOrRestore,
  isRuleWideKey,
  mayActRuleWide,
  mayTouchNote,
  noteRefusal,
  notesTouchedBy,
  PLATFORM_ADMIN_REFUSAL,
  planAct,
  resolveItemState,
  stateBookFrom,
  StateRow,
  touchesNotes,
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

  it("owner and manager may; the platform admin, staff and no role may not (round 4, answer 7)", () => {
    expect(mayActRuleWide("owner")).toBe(true);
    expect(mayActRuleWide("Manager")).toBe(true);
    expect(mayActRuleWide("admin")).toBe(false);
    expect(mayActRuleWide("staff")).toBe(false);
    expect(mayActRuleWide(null)).toBe(false);
    expect(mayActRuleWide("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round 5, answer 2 (the founder, 2026-09-22, "Gate like acts"): a note
// (pin, rating, assignment) is gated the way an act is.
// ---------------------------------------------------------------------------

const STAFF_A = { userId: "u-staff-a", role: "staff" };
const STAFF_B = { userId: "u-staff-b", role: "staff" };
const OWNER5 = { userId: "u-owner", role: "owner" };
const MANAGER5 = { userId: "u-manager", role: "manager" };
const ADMIN5 = { userId: "u-admin", role: "admin" };

describe("notesTouchedBy / touchesNotes: which fields a patch touches", () => {
  it("names pinned, feedback and assignment independently", () => {
    expect(notesTouchedBy({})).toEqual([]);
    expect(notesTouchedBy({ pinned: true })).toEqual(["pinned"]);
    expect(notesTouchedBy({ feedback: "helpful" })).toEqual(["feedback"]);
    expect(notesTouchedBy({ assignedTo: "u-x" })).toEqual(["assignment"]);
    // assignedName alone is still the assignment note.
    expect(notesTouchedBy({ assignedName: "Ada" })).toEqual(["assignment"]);
    expect(
      notesTouchedBy({ pinned: false, feedback: null, assignedTo: null }),
    ).toEqual(["pinned", "feedback", "assignment"]);
  });

  it("a status-only patch touches no note", () => {
    expect(touchesNotes({ status: "dismissed" })).toBe(false);
    expect(touchesNotes({})).toBe(false);
    expect(touchesNotes({ pinned: true })).toBe(true);
  });
});

describe("mayTouchNote: whose note it is to change or clear", () => {
  it("an UNSET field is anyone's first note — even an owner-unknown row", () => {
    expect(mayTouchNote(STAFF_A, false, null)).toBe(true);
    expect(mayTouchNote(STAFF_A, false, "u-other")).toBe(true); // unset: nothing to protect
  });

  it("a SET field with no recorded owner fails closed: owner/manager only", () => {
    expect(mayTouchNote(STAFF_A, true, null)).toBe(false);
    expect(mayTouchNote(OWNER5, true, null)).toBe(true);
    expect(mayTouchNote(MANAGER5, true, null)).toBe(true);
  });

  it("staff may change or clear their own note; not someone else's", () => {
    expect(mayTouchNote(STAFF_A, true, "u-staff-a")).toBe(true);
    expect(mayTouchNote(STAFF_A, true, "u-staff-b")).toBe(false);
    expect(mayTouchNote(STAFF_B, true, "u-staff-a")).toBe(false);
  });

  it("owners and managers change or clear anyone's — including their own", () => {
    for (const who of [OWNER5, MANAGER5]) {
      expect(mayTouchNote(who, true, "u-staff-a")).toBe(true);
      expect(mayTouchNote(who, true, who.userId)).toBe(true);
    }
  });

  it("a staff actor with no userId touches nothing that is set", () => {
    expect(mayTouchNote({ userId: null, role: "staff" }, true, "u-x")).toBe(
      false,
    );
  });
});

describe("noteRefusal: what a refused note change says", () => {
  it("one field, one sentence", () => {
    expect(noteRefusal(1)).toBe(
      "Only the person who made this note, or an owner or manager, can change or clear it.",
    );
  });
  it("more than one names the count", () => {
    expect(noteRefusal(2)).toMatch(/\(2 in this selection\)/);
  });
});

describe("planAct refuses the platform admin a note too (round 5)", () => {
  it("a pin, a rating or an assignment alone — no status at all — is refused", () => {
    for (const patch of [
      { pinned: true },
      { feedback: "helpful" as const },
      { assignedTo: "u-x", assignedName: "X" },
    ])
      expect(planAct(patch, ADMIN5, [], NOW)).toEqual({
        to: "refused",
        why: PLATFORM_ADMIN_REFUSAL,
        forbidden: true,
      });
  });

  it("a note alongside a status write the admin may not make is still refused", () => {
    expect(
      planAct({ status: "done", pinned: true }, ADMIN5, [], NOW),
    ).toMatchObject({ to: "refused", forbidden: true });
  });

  it("an owner or manager touching only a note is never caught by the admin rule", () => {
    for (const actor of [OWNER5, MANAGER5])
      expect(planAct({ pinned: true }, actor, [], NOW)).toMatchObject({
        to: "house",
        recordedAs: "note",
      });
  });

  it("staff touching only a note routes to the house, unrefused by planAct — the service's ownership gate decides the rest", () => {
    expect(planAct({ pinned: true }, STAFF_A, [], NOW)).toMatchObject({
      to: "house",
      recordedAs: "note",
    });
  });
});
