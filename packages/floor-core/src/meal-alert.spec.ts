/**
 * @wineops/floor-core — the Food-up brief and its text cleaning.
 *
 * Every spec here imports the real code. The checker's own scripts copied the
 * logic into the test file (`scripts/test-attribution.mjs:8`), so they could
 * pass while the app drifted; that is not repeated.
 */
import {
  buildMealBrief,
  MEAL_BODY_MAX,
  MEAL_LABEL_MAX,
  MEAL_NOTE_MAX,
  MEAL_TITLE_MAX,
  sanitizeMealNote,
  type MealBriefInput,
} from "./index";
import { MIN, WARN, LATE } from "./test-fixtures";

/** No lone surrogate: encodeURIComponent throws URIError on one. */
function wellFormed(text: string): boolean {
  try {
    encodeURIComponent(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Parity with the checker's scripts
// ---------------------------------------------------------------------------

describe("parity: buildMealBrief (test-meal-brief.mjs)", () => {
  const NOW = Date.parse("2026-08-24T20:00:00.000Z");
  const minsAgo = (m: number) => new Date(NOW - m * MIN).toISOString();
  const base = (over: Partial<MealBriefInput> = {}): MealBriefInput => ({
    tableLabel: "12",
    course: "mains",
    seats: 4,
    partySize: 3,
    seatedAt: minsAgo(38),
    lastCheckInAt: minsAgo(4),
    checkInCount: 2,
    warnAfterMin: WARN,
    lateAfterMin: LATE,
    now: NOW,
    ...over,
  });

  it("titles by table and names the course", () => {
    const b = buildMealBrief(base());
    expect(b.title).toBe("Food up · Table 12");
    expect(b.headline).toBe("Mains ready for Table 12");
  });

  it("leads with cover count, then dwell, then coverage", () => {
    const b = buildMealBrief(base());
    expect(b.insights).toEqual([
      "Party of 3 · 4-top",
      "Seated 38m ago",
      "Last visit 4m ago · on time",
      "2 check-ins this party",
    ]);
    expect(b.status).toBe("fresh");
    expect(b.priority).toBe("normal");
  });

  it("flags an overdue table as high priority", () => {
    const b = buildMealBrief(base({ lastCheckInAt: minsAgo(22) }));
    expect(b.status).toBe("late");
    expect(b.priority).toBe("high");
    expect(b.insights[b.insights.length - 2] ?? "").toMatch(/Last visit 22m ago · overdue/);
    expect(b.cue).toMatch(/log the visit/);
  });

  it("marks due-soon tables without escalating them", () => {
    const b = buildMealBrief(base({ lastCheckInAt: minsAgo(12) }));
    expect(b.status).toBe("warn");
    expect(b.priority).toBe("normal");
    expect(b.insights.join(" | ")).toMatch(/due soon/);
  });

  it("says so when the party has no visit yet", () => {
    const b = buildMealBrief(base({ lastCheckInAt: null, checkInCount: 0 }));
    // Departs from the checker (`scripts/test-meal-brief.mjs:174-178`, which
    // pinned "idle"): the port's floor schema stores no last_check_in_at column and no seated
    // visit row, so an unvisited party is measured from its seat time. Seated
    // 38 minutes ago with late at 15 is overdue. ADR 0346 D4 (b): silence is
    // a gap, not health.
    expect(b.status).toBe("late");
    expect(b.priority).toBe("high");
    expect(b.insights).toContain("No visit logged yet this party");
    expect(b.insights.some((i) => i.includes("check-in"))).toBe(false);
  });

  it("names the merge group on both title and insights", () => {
    const b = buildMealBrief(base({ groupLabel: "12+13" }));
    expect(b.title).toBe("Food up · Table 12+13");
    expect(b.insights.some((i) => i === "Merged party — 12+13 share one ticket")).toBe(true);
  });

  it("does not call a table merged with itself", () => {
    const b = buildMealBrief(base({ groupLabel: "12" }));
    expect(b.insights.some((i) => i.startsWith("Merged party"))).toBe(false);
  });

  it("quotes the pass note first in the one-line body", () => {
    const b = buildMealBrief(base({ note: "Nut allergy — seat 3" }));
    expect(b.note).toBe("Nut allergy — seat 3");
    expect(b.body.startsWith("“Nut allergy — seat 3” · Party of 3")).toBe(true);
  });

  it("keeps the body inside MEAL_BODY_MAX", () => {
    const b = buildMealBrief(base({ note: "x".repeat(MEAL_NOTE_MAX) }));
    expect(b.body.length).toBeLessThanOrEqual(MEAL_BODY_MAX);
    expect(b.body.endsWith("…")).toBe(true);
  });

  it("singularises a lone check-in", () => {
    const b = buildMealBrief(base({ checkInCount: 1 }));
    expect(b.insights).toContain("1 check-in this party");
  });

  it("drops the party line when size is unknown but keeps the top size", () => {
    const b = buildMealBrief(base({ partySize: null }));
    expect(b.insights[0]).toBe("4-top");
  });
});

describe("parity: sanitizeMealNote (test-meal-brief.mjs)", () => {
  it("collapses newlines and tabs into single spaces", () => {
    expect(sanitizeMealNote("  two\n\nlines\there ")).toBe("two lines here");
  });

  it("returns empty for blank input", () => {
    expect(sanitizeMealNote(null)).toBe("");
    expect(sanitizeMealNote("   ")).toBe("");
  });

  it("caps long notes with an ellipsis", () => {
    const out = sanitizeMealNote("a".repeat(200));
    expect(out.length).toBe(MEAL_NOTE_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Review fixes (PR2a review, 2026-10-31)
// ---------------------------------------------------------------------------

describe("the Food-up brief measures an unvisited party from its seat time", () => {
  const NOW = Date.parse("2026-08-24T20:00:00.000Z");
  const minsAgo = (m: number) => new Date(NOW - m * MIN).toISOString();
  const base = (over: Partial<MealBriefInput> = {}): MealBriefInput => ({
    tableLabel: "12",
    course: "mains",
    seats: 4,
    partySize: 3,
    seatedAt: minsAgo(4),
    lastCheckInAt: null,
    checkInCount: 0,
    warnAfterMin: WARN,
    lateAfterMin: LATE,
    now: NOW,
    ...over,
  });

  it("is on time when seated inside the warn minutes, and idle only with no seating", () => {
    expect(buildMealBrief(base()).status).toBe("fresh");
    expect(buildMealBrief(base({ seatedAt: minsAgo(12) })).status).toBe("warn");
    expect(buildMealBrief(base({ seatedAt: null })).status).toBe("idle");
  });

  it("an unreadable visit time falls back to the seat time and never prints NaN", () => {
    const b = buildMealBrief(base({ seatedAt: minsAgo(38), lastCheckInAt: "not a time" }));
    expect(b.status).toBe("late");
    expect(b.minsSinceCheckIn).toBeNull();
    expect(b.body).not.toMatch(/NaN/);
  });

  it("says a visit's time is unknown, not that there was no visit", () => {
    const b = buildMealBrief(base({ seatedAt: minsAgo(38), lastCheckInAt: "not a time", checkInCount: 3 }));
    expect(b.insights).toEqual(["Party of 3 · 4-top", "Seated 38m ago", "Last visit time unknown", "3 check-ins this party"]);
    const counted = buildMealBrief(base({ seatedAt: minsAgo(38), lastCheckInAt: null, checkInCount: 3 }));
    expect(counted.insights).toContain("Last visit time unknown");
    expect(counted.insights).not.toContain("No visit logged yet this party");
  });
});

describe("Food-up text is cut on code points and cleaned", () => {
  const NOW = Date.parse("2026-08-24T20:00:00.000Z");
  const minsAgo = (m: number) => new Date(NOW - m * MIN).toISOString();
  const base = (over: Partial<MealBriefInput> = {}): MealBriefInput => ({
    tableLabel: "12",
    course: "mains",
    seats: 4,
    partySize: 3,
    seatedAt: minsAgo(38),
    lastCheckInAt: minsAgo(4),
    checkInCount: 2,
    warnAfterMin: WARN,
    lateAfterMin: LATE,
    now: NOW,
    ...over,
  });

  it("a note cut at an emoji drops it whole", () => {
    const out = sanitizeMealNote(`${"a".repeat(MEAL_NOTE_MAX - 2)}😀😀`);
    expect(wellFormed(out)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(MEAL_NOTE_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("the body cut at an emoji drops it whole", () => {
    const b = buildMealBrief(base({ note: "x".repeat(107), groupLabel: "😀".repeat(16) }));
    expect(wellFormed(b.body)).toBe(true);
    expect(b.body.length).toBeLessThanOrEqual(MEAL_BODY_MAX);
  });

  it("drops bidi and zero-width characters from notes", () => {
    expect(sanitizeMealNote("Nut\u202Eallergy\u200B seat\u2066 3\u2069")).toBe("Nutallergy seat 3");
  });

  it("turns C1 controls into spaces", () => {
    expect(sanitizeMealNote("Nut\u0085allergy\u009B3")).toBe("Nut allergy 3");
  });

  it("drops every format character and default ignorable, tag characters included", () => {
    expect(sanitizeMealNote("a\u{E0041}\u{E0042}b\uFFF9c\u0600d\u034Fe\u3164f\u00ADg\uFE00h")).toBe("abcdefgh");
  });

  it("keeps ZWJ and the emoji presentation selector", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u2764\uFE0F";
    expect(sanitizeMealNote(family)).toBe(family);
  });

  it("replaces a lone surrogate with U+FFFD", () => {
    expect(sanitizeMealNote("a\uD800b\uDC00c")).toBe("a\uFFFDb\uFFFDc");
  });

  it("keeps a whole pair and replaces halves in a run of surrogates", () => {
    // Low-then-high is two lone halves; a high-low pair stays a pair.
    expect(sanitizeMealNote("\uDC00\uD800\uD83D\uDE00\uD800")).toBe("\uFFFD\uFFFD\uD83D\uDE00\uFFFD");
    // Two low halves are not a pair either.
    expect(sanitizeMealNote("\uDC00\uDC01")).toBe("\uFFFD\uFFFD");
  });

  it("prints no seat, party or check-in line for a count that is not a positive whole number", () => {
    const b = buildMealBrief(base({ seats: Infinity, partySize: 1.5, checkInCount: 2.5, lastCheckInAt: null }));
    expect(b.insights.some((l) => /top|Party of|check-in/.test(l))).toBe(false);
    expect(b.insights).toContain("No visit logged yet this party");
  });

  it("cleans and caps the labels in the title, headline and insights", () => {
    const b = buildMealBrief(base({ tableLabel: "12\u202E\n", groupLabel: `${"G".repeat(60)}\u200B` }));
    expect(b.title).toBe(`Food up · Table ${"G".repeat(MEAL_LABEL_MAX - 1)}…`);
    // The title is never cut: the longest label keeps it inside the budget.
    expect(b.title.length).toBeLessThanOrEqual(MEAL_TITLE_MAX);
    const wide = buildMealBrief(base({ tableLabel: "😀".repeat(40) }));
    expect(wellFormed(wide.title)).toBe(true);
    expect(wide.title.length).toBeLessThanOrEqual(MEAL_TITLE_MAX);
    expect(b.headline).not.toMatch(/[\u200B\u202E\n]/);
    expect(buildMealBrief(base({ tableLabel: "12\u202E\n" })).title).toBe("Food up · Table 12");
  });
});

describe("text with nothing visible left", () => {
  it("a note of joiners and blanks is no note, and such a label prints a dash", () => {
    expect(sanitizeMealNote("\u200d\u200c\u2800 \ufe0f")).toBe("");
    const NOW = Date.parse("2026-08-24T20:00:00.000Z");
    const b = buildMealBrief({
      tableLabel: "\u200d\u200d", course: "mains", note: "\u200d\u200d\u200d", seats: null, partySize: null,
      seatedAt: null, lastCheckInAt: null, checkInCount: 0, warnAfterMin: WARN, lateAfterMin: LATE, now: NOW,
    });
    expect(b.note).toBeNull();
    expect(b.title).toBe("Food up · Table —");
  });
});

describe("a label that cleans to nothing", () => {
  it("prints a dash, never an empty table name", () => {
    const brief = buildMealBrief({
      tableLabel: "\u200b\u202e",
      groupLabel: null,
      course: "mains",
      seats: null,
      partySize: null,
      seatedAt: null,
      lastCheckInAt: null,
      checkInCount: 0,
      warnAfterMin: WARN,
      lateAfterMin: LATE,
      now: 0,
    });
    expect(brief.title).toBe("Food up · Table —");
    expect(brief.headline).toBe("Mains ready for Table —");
  });
});
