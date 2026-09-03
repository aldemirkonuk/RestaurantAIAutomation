import * as fs from "fs";
import * as path from "path";
import {
  computeMatch,
  isClaimable,
  isDiscrepancy,
  MatchInput,
  toBottleOperands,
} from "./invoice-match";

/**
 * Backtest: every synthetic-document scenario, run through the real engine.
 *
 * `invoice-match.spec.ts` next door tests the rules by hand, case by case. This
 * file tests something different and complementary: that the expectations baked
 * into the synthetic document generator — the ones that decide whether a
 * generated invoice is labelled a discrepancy or a clean match — actually agree
 * with what this engine does. Those two things living in different languages is
 * exactly how they drift.
 *
 * The fixture is GENERATED from `scripts/docgen/errors.py`:
 *
 *     python3 -m scripts.docgen backtest            # regenerate
 *     python3 -m scripts.docgen backtest --check    # CI: fail if stale
 *
 * Do not hand-edit it. The `--check` command owns hash verification (it can
 * reproduce Python's exact canonical serialisation; re-implementing that here
 * would be fragile for no benefit), so CI must run BOTH that command and this
 * suite. This file verifies the engine; that command verifies the fixture.
 *
 * KNOWN FAILURES ARE ASSERTED, NOT SKIPPED. Where the engine currently
 * disagrees with a scenario's intent, the fixture carries both values and the
 * test below asserts the engine returns the *known-failing* one. So fixing the
 * bug turns this suite red on purpose — which forces someone to regenerate the
 * fixture and consciously re-affirm the intended verdict. A skipped test would
 * let the fix land silently and the next regression go unseen.
 */

interface FixtureRow {
  scenario: string;
  label: string;
  story: string;
  profile: { ordered: number; price: number };
  input: MatchInput;
  expect: { verdict: string; creditDue: boolean; lineMatch: string };
  knownFailing: { verdict: string; note: string } | null;
}

interface Fixture {
  fixture_version: string;
  content_hash: string;
  verdicts_covered: string[];
  row_count: number;
  known_failing_count: number;
  rows: FixtureRow[];
}

// rootDir is `src`, so the fixture lives outside the Jest root and is read from
// disk rather than imported.
const FIXTURE_PATH = path.join(
  __dirname,
  "../../../../scripts/docgen/fixtures/scenario-expectations.json",
);

const ALL_VERDICTS = [
  "matched",
  "overbilled_vs_ship",
  "price_variance",
  "qty_over",
  "qty_short",
  "short_shipped",
  "rejected",
  "partial",
  "unmatched",
] as const;

describe("invoice-match backtest — synthetic scenario expectations", () => {
  let fixture: Fixture;

  beforeAll(() => {
    if (!fs.existsSync(FIXTURE_PATH)) {
      throw new Error(
        `Scenario fixture missing at ${FIXTURE_PATH}. ` +
          `Generate it with: python3 -m scripts.docgen backtest`,
      );
    }
    fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  });

  describe("fixture integrity", () => {
    it("declares the version this spec understands", () => {
      expect(fixture.fixture_version).toBe("1.0.0");
    });

    it("row_count matches the rows actually present", () => {
      expect(fixture.rows).toHaveLength(fixture.row_count);
      expect(fixture.rows.length).toBeGreaterThan(0);
    });

    it("known_failing_count matches the rows actually flagged", () => {
      const flagged = fixture.rows.filter((r) => r.knownFailing !== null);
      expect(flagged).toHaveLength(fixture.known_failing_count);
    });

    it("exercises all nine verdicts — an unexercised verdict is untested code", () => {
      const covered = new Set(fixture.rows.map((r) => r.expect.verdict));
      const missing = ALL_VERDICTS.filter((v) => !covered.has(v));
      expect(missing).toEqual([]);
    });
  });

  describe("verdicts", () => {
    it("every row returns the verdict its scenario intends", () => {
      const surprises: string[] = [];
      const knownFailures: string[] = [];

      for (const row of fixture.rows) {
        const result = computeMatch(row.input);
        const tag = `${row.scenario}(ordered=${row.profile.ordered})`;

        if (row.knownFailing) {
          // Asserted, not skipped — see the file header.
          if (result.verdict === row.knownFailing.verdict) {
            knownFailures.push(tag);
          } else if (result.verdict === row.expect.verdict) {
            surprises.push(
              `${tag} now returns the INTENDED verdict "${row.expect.verdict}". ` +
                `The known failure is fixed — regenerate the fixture ` +
                `(python3 -m scripts.docgen backtest) and drop the ` +
                `known_failing_verdict from scripts/docgen/errors.py.`,
            );
          } else {
            surprises.push(
              `${tag} returned "${result.verdict}", which is neither the intended ` +
                `"${row.expect.verdict}" nor the documented failure ` +
                `"${row.knownFailing.verdict}".`,
            );
          }
          continue;
        }

        if (result.verdict !== row.expect.verdict) {
          surprises.push(
            `${tag} expected "${row.expect.verdict}", got "${result.verdict}" — ${row.story}`,
          );
        }
      }

      // Reported together so one run shows every divergence rather than
      // stopping at the first.
      expect(surprises).toEqual([]);
      expect(knownFailures).toHaveLength(fixture.known_failing_count);
    });

    it("creditDue matches for every row whose verdict is as intended", () => {
      const wrong: string[] = [];
      for (const row of fixture.rows) {
        if (row.knownFailing) continue; // creditDue is not meaningful mid-bug
        const result = computeMatch(row.input);
        if (result.creditDue !== row.expect.creditDue) {
          wrong.push(
            `${row.scenario}(ordered=${row.profile.ordered}) creditDue ` +
              `expected ${row.expect.creditDue}, got ${result.creditDue}`,
          );
        }
      }
      expect(wrong).toEqual([]);
    });

    it("a claimable verdict is always also a discrepancy", () => {
      // Guards a classification hole: something worth money that the manager
      // queue would never surface, because the queue filters on isDiscrepancy.
      for (const v of ALL_VERDICTS) {
        if (isClaimable(v)) {
          expect(isDiscrepancy(v)).toBe(true);
        }
      }
    });
  });

  describe("false alarms — the cases that must stay silent", () => {
    /**
     * These matter more than the real discrepancies. An engine that reports a
     * problem on a split case or an agreed bonus trains the manager to ignore
     * it, and alert acceptance drops roughly 30% per repeated reminder. A false
     * alarm here is not a cosmetic bug; it is the failure mode that kills the
     * product.
     */
    it("split cases never alarm", () => {
      const rows = fixture.rows.filter((r) => r.scenario === "split_case");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const result = computeMatch(row.input);
        expect(result.verdict).toBe("matched");
        expect(isDiscrepancy(result.verdict)).toBe(false);
      }
    });

    it("an agreed free-goods deal with no packing slip never alarms", () => {
      const rows = fixture.rows.filter(
        (r) => r.scenario === "free_goods_no_slip",
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const result = computeMatch(row.input);
        expect(result.verdict).toBe("matched");
        expect(result.creditDue).toBe(false);
      }
    });

    it("free goods lower the effective unit cost rather than inflating quantity", () => {
      // 11 bottles for the price of 10 at $22 is $20/bottle on the books, not
      // $22. `landedCost` exists elsewhere in the codebase with no callers;
      // effectiveUnitCost is the one that actually runs.
      const result = computeMatch({
        orderedQty: 10,
        poUnitPrice: 22,
        invoiceQty: 10,
        invoiceUnitPrice: 22,
        acceptedQty: 11,
        rejectedQty: 0,
        freeGoodsQty: 1,
        stockedQty: 11,
      });
      expect(result.verdict).toBe("matched");
      expect(result.effectiveUnitCost).toBeCloseTo(20.0, 2);
    });

    it("allocated freight lands in cost, not in a price variance", () => {
      const rows = fixture.rows.filter(
        (r) => r.scenario === "freight_allocated",
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const result = computeMatch(row.input);
        expect(result.verdict).toBe("matched");
        // Freight raises landed cost above the billed price without ever being
        // reported as the vendor overcharging.
        expect(result.effectiveUnitCost).toBeGreaterThan(
          row.input.invoiceUnitPrice as number,
        );
      }
    });
  });

  describe("absence is never agreement", () => {
    it("no invoice reads unmatched, and never price_verified", () => {
      const rows = fixture.rows.filter((r) => r.scenario === "no_invoice_yet");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const result = computeMatch(row.input);
        expect(result.verdict).toBe("unmatched");
        // The defect this guards: an unstated invoice inferred from the PO, then
        // written to the database as a price the customer will cite in a dispute.
        expect(result.priceVerified).toBe(false);
        expect(result.creditDue).toBe(false);
      }
    });

    it("a missing packing slip leaves its checks unevaluable, not passing", () => {
      const rows = fixture.rows.filter((r) => r.input.shippedQty == null);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const result = computeMatch(row.input);
        for (const id of ["bill_vs_ship", "physical_vs_ship"]) {
          const check = result.checks.find((c) => c.id === id);
          expect(check).toBeDefined();
          // null (could not evaluate) must be distinguishable from false.
          expect(check!.ok).toBeNull();
        }
      }
    });

    it("overbilled_vs_ship is the only self-evidenced verdict", () => {
      for (const row of fixture.rows) {
        const result = computeMatch(row.input);
        expect(result.selfEvidenced).toBe(
          result.verdict === "overbilled_vs_ship",
        );
      }
    });
  });

  describe("quantity invariants hold for every row", () => {
    it("backorder is never negative and never exceeds what was ordered", () => {
      for (const row of fixture.rows) {
        const result = computeMatch(row.input);
        expect(result.backorderQty).toBeGreaterThanOrEqual(0);
        // Compared against the NORMALISED ordered quantity, not the raw fixture
        // field: `backorderQty` is in bottles, and the fixture states its
        // quantities in whatever unit the scenario used. Comparing a bottle
        // count against a possibly-case count is the very defect this engine
        // now refuses to commit.
        expect(result.backorderQty).toBeLessThanOrEqual(
          toBottleOperands(row.input).orderedQty,
        );
      }
    });

    it("a credit amount only ever accompanies creditDue", () => {
      for (const row of fixture.rows) {
        const result = computeMatch(row.input);
        if (result.creditAmount != null && result.creditAmount > 0) {
          expect(result.creditDue).toBe(true);
        }
      }
    });
  });
});
