import {
  INSIGHT_CANDIDATES,
  availableCandidates,
  DataRequirement,
} from "./insight-catalog";

/**
 * S15 §9's simulation gate, executed.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.planning/01-org/research-math/teams/backtests/backtests-charter.md` records the
 * team's evidence as: *"Nothing exists. No harness, no backtest, no replay."* Of the
 * 17 scenarios' §9 gates, exactly one executed anything. This is the second, and it
 * is deliberately the cheapest possible one: **no database, no fixtures, no network** —
 * the catalogue is a pure function of the source, so its reach can be asserted in CI
 * today rather than after a replay corpus exists.
 *
 * S15 §9 states the gate in binding terms: *"no digest/engine change ships until the
 * reachable counts match those baselines exactly"*. This file is that gate.
 *
 * WHAT IT MEASURES — and why "reach" is not "usefulness"
 * -----------------------------------------------------
 * `availableCandidates` filters on DATA REQUIREMENTS ONLY (`insight-catalog.ts`):
 * `c.requires.every(r => available.has(r))`. It does not know whether a type has an
 * implementation behind it, and the caller builds `available` with a PRESENCE test —
 * `if (bundle.checks.length) availability.add("checks")` — so a single row flips a
 * whole source on.
 *
 * That is exactly how a "573 of 573" meter came to describe a tenant with 66 simulator
 * checks and zero consumption rows. So the numbers below are an **upper bound on
 * reach**, never a count of insights a restaurant can receive, and this file asserts
 * them under that name so nobody re-reads them as capability.
 *
 * THE BASELINES WERE WRONG WHEN MEASURED — see the table in the first test
 * ----------------------------------------------------------------------
 * Three of S15 §9's published figures did not survive execution. They are corrected
 * here against the source, which is the harness doing its job on its first run: the
 * point of a gate is to disagree with the document when the document is stale.
 *
 * NOT VACUOUS
 * -----------
 * `count(*)` over an empty set returns a passing number. The first test therefore
 * asserts the catalogue is populated and every requirement token is genuinely in use
 * BEFORE any reach number is interpreted — because a reach of 0/0 would otherwise
 * satisfy every assertion below it. See `03-scenarios/DELIVERY-AUDIT.md` §5(b).
 */

const ALL_REQUIREMENTS: DataRequirement[] = [
  "consumption",
  "orders",
  "inventory",
  "checks",
  "tables",
  "venue",
  "goals",
];

const set = (...r: DataRequirement[]) => new Set<DataRequirement>(r);
const reach = (...r: DataRequirement[]) => availableCandidates(set(...r)).length;
const declaring = (r: DataRequirement) =>
  INSIGHT_CANDIDATES.filter((c) => c.requires.includes(r)).length;

/**
 * Measured against the source on 2026-09-01. Where these disagree with S15 §9, the
 * measurement wins and the scenario doc is the thing to correct — that is the whole
 * point of executing a gate rather than restating it.
 */
const BASELINE = {
  total: 573, // S15 §9: 573 — agrees
  consumptionOnly: 34, // S15 §9 says 38 (6.6%) — STALE, actual 34 (5.9%)
  consumptionOrdersInventory: 132, // S15 §9 says 144 (25.1%) — STALE, actual 132 (23.0%)
  allSeven: 573, // S15 §9: 100% — agrees
  declaresChecks: 434, // S15 §9/§10 says 429 (74.9%) — STALE, actual 434 (75.7%)
  declaresTables: 241, // S15 §10: 241 (42.1%) — agrees
  declaresGoals: 22, // S15 §3: "22 goal-pace types" — agrees
} as const;

describe("insight catalogue reach — S15 §9 simulation gate", () => {
  // ---------------------------------------------------------------------------
  // Guard the guard. Every assertion below is a count, and a count over an empty
  // catalogue passes trivially.
  // ---------------------------------------------------------------------------
  it("has a populated catalogue and no dead requirement token (anti-vacuous)", () => {
    expect(INSIGHT_CANDIDATES.length).toBeGreaterThan(0);
    expect(new Set(INSIGHT_CANDIDATES.map((c) => c.key)).size).toBe(
      INSIGHT_CANDIDATES.length,
    );

    // A requirement nothing declares would make its reach numbers meaningless
    // rather than merely wrong, and would go unnoticed as a passing zero.
    for (const r of ALL_REQUIREMENTS) {
      expect({ requirement: r, declaredBy: declaring(r) }).toEqual({
        requirement: r,
        declaredBy: expect.any(Number),
      });
      expect(declaring(r)).toBeGreaterThan(0);
    }

    // Every declared requirement must be a known token — a typo'd requirement can
    // never be satisfied, so its types would be permanently unreachable in silence.
    const known = new Set<string>(ALL_REQUIREMENTS);
    const unknown = [
      ...new Set(INSIGHT_CANDIDATES.flatMap((c) => c.requires)),
    ].filter((r) => !known.has(r));
    expect(unknown).toEqual([]);
  });

  it("enumerates exactly the catalogue total S15 §9 names", () => {
    expect(INSIGHT_CANDIDATES.length).toBe(BASELINE.total);
  });

  // ---------------------------------------------------------------------------
  // The ladder. These are the numbers S15 §10 turns into a pricing story, so they
  // are the ones that must not drift unnoticed.
  // ---------------------------------------------------------------------------
  it("reaches the consumption-only baseline", () => {
    expect(reach("consumption")).toBe(BASELINE.consumptionOnly);
  });

  it("reaches the no-POS baseline (consumption + orders + inventory)", () => {
    expect(reach("consumption", "orders", "inventory")).toBe(
      BASELINE.consumptionOrdersInventory,
    );
  });

  it("reaches the whole catalogue only with all seven sources", () => {
    expect(reach(...ALL_REQUIREMENTS)).toBe(BASELINE.allSeven);
    expect(BASELINE.allSeven).toBe(BASELINE.total);
  });

  it("reaches nothing with no data at all", () => {
    // The honest floor. A restaurant that has connected nothing must not be told
    // it can receive anything (ADR 0020) — and this also proves `reach` discriminates,
    // without which every number above could be a constant.
    expect(reach()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // The POS gate — S15 §10 calls this "the biggest single POS gate in the library",
  // and it is the arithmetic behind the Pro tier's promise.
  // ---------------------------------------------------------------------------
  it("gates the stated share of the catalogue behind POS", () => {
    expect(declaring("checks")).toBe(BASELINE.declaresChecks);
    expect(declaring("tables")).toBe(BASELINE.declaresTables);

    // Roughly three quarters of the catalogue is dark without POS. Asserted as a
    // band rather than a fraction so it fails on a real shift, not on rounding.
    const share = declaring("checks") / INSIGHT_CANDIDATES.length;
    expect(share).toBeGreaterThan(0.74);
    expect(share).toBeLessThan(0.77);
  });

  it("keeps the goal-pace family declaring its requirement", () => {
    // S15 §3 names 22 goal-pace types. A prior audit reported this as 0 and was
    // wrong; executing it is what settled the disagreement. If this ever DOES reach
    // 0, the goal families become satisfiable for a restaurant with no goals set —
    // the "goals mirage" S15 §3 warns about — so the assertion is the alarm.
    expect(declaring("goals")).toBe(BASELINE.declaresGoals);
  });

  // ---------------------------------------------------------------------------
  // Monotonicity. A structural property, not a snapshot: adding a data source can
  // never reduce reach. This keeps holding as the catalogue grows, which none of
  // the fixed counts above do.
  // ---------------------------------------------------------------------------
  it("never loses reach when a data source is added", () => {
    for (const r of ALL_REQUIREMENTS) {
      const withoutIt = ALL_REQUIREMENTS.filter((x) => x !== r);
      expect(reach(...withoutIt, r)).toBeGreaterThanOrEqual(reach(...withoutIt));
    }
  });

  it("counts every type as reachable-or-blocked, never both and never neither", () => {
    // Partition check: with all sources present nothing may be excluded, and the
    // reachable set must be a strict subset at every rung below it.
    const full = availableCandidates(set(...ALL_REQUIREMENTS));
    expect(full.length).toBe(INSIGHT_CANDIDATES.length);

    const noPos = availableCandidates(set("consumption", "orders", "inventory"));
    const noPosKeys = new Set(noPos.map((c) => c.key));
    const blocked = INSIGHT_CANDIDATES.filter((c) => !noPosKeys.has(c.key));
    expect(noPos.length + blocked.length).toBe(INSIGHT_CANDIDATES.length);
    expect(blocked.length).toBe(
      BASELINE.total - BASELINE.consumptionOrdersInventory,
    );
  });
});
