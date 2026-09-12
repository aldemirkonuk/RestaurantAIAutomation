/**
 * Parity for the book of goal scenarios.
 *
 * A picker entry that names a metric the gateway does not serve is worse than
 * no entry: the manager chooses it, fills in a target, presses the button and
 * gets a 400 saying "Unsupported metric" — a fake control discovered at the
 * moment of commitment. Every cross-reference in `goal-scenarios.ts` is
 * therefore pinned here against the file that actually owns it, so a rename in
 * the goals module or the cutting catalogue breaks a test rather than a page.
 *
 * The second half of these cases is about the honesty of the table itself: no
 * row may carry a target, every published range must carry a URL and a date,
 * and every row that names no metric must say which measure it would need.
 */

import {
  GOAL_SCENARIOS,
  SCENARIO_IDS,
  SCENARIO_PERIODS,
  THE_CAVEAT,
  goalScenarioBook,
  producerFor,
  scenarioById,
} from "./goal-scenarios";
import { GoalsService } from "./goals.service";
import { CUTTING_CATALOGUE } from "./report-cuttings";
import {
  CITED_URLS,
  OPERATOR_SOURCES,
} from "./__fixtures__/operator-sources";

describe("goal scenarios — every cross-reference resolves", () => {
  it("names at least one scenario per served metric, and no unserved metric", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.metricKey === null) continue;
      expect(GoalsService.SUPPORTED_METRICS[s.metricKey]).toBeDefined();
    }
  });

  it("covers every metric the goals module serves", () => {
    // The other direction, and the one that catches a metric being ADDED with
    // no scenario to reach it — a measure nobody can find in the picker.
    const covered = new Set(
      GOAL_SCENARIOS.map((s) => s.metricKey).filter(
        (k): k is string => k !== null,
      ),
    );
    for (const key of Object.keys(GoalsService.SUPPORTED_METRICS)) {
      expect(covered.has(key)).toBe(true);
    }
  });

  it("names only cuttings the reports sheet carries", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.cuttingId === null) continue;
      expect(
        Object.prototype.hasOwnProperty.call(CUTTING_CATALOGUE, s.cuttingId),
      ).toBe(true);
    }
  });

  it("names only rules the recommendation engine evaluates", () => {
    for (const s of GOAL_SCENARIOS) {
      for (const key of s.ruleKeys) {
        expect(GoalsService.isRecommendationRuleKey(key)).toBe(true);
      }
    }
  });

  it("uses only periods the picker offers", () => {
    for (const s of GOAL_SCENARIOS) {
      expect(SCENARIO_PERIODS).toContain(s.period);
    }
  });

  it("has unique ids, and scenarioById finds each one", () => {
    expect(new Set(SCENARIO_IDS).size).toBe(SCENARIO_IDS.length);
    for (const id of SCENARIO_IDS) expect(scenarioById(id)?.id).toBe(id);
    expect(scenarioById("not-a-scenario")).toBeUndefined();
  });
});

describe("goal scenarios — the honesty rules of the table", () => {
  it("carries no target on any row", () => {
    // The whole point: a scenario says what to measure, never what number to
    // hit. This asserts on the KEYS rather than the values, so a `targetValue`
    // added later fails here even if it is left undefined.
    for (const s of GOAL_SCENARIOS) {
      const keys = Object.keys(s);
      for (const forbidden of ["target", "targetValue", "target_value", "suggestedTarget"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("gives every published range a source, a URL and a date", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.range.kind !== "published") continue;
      expect(s.range.words.trim().length).toBeGreaterThan(0);
      expect(s.range.source.trim().length).toBeGreaterThan(0);
      expect(s.range.url).toMatch(/^https:\/\//);
      // `"undated"` is a real value: three cited pages state no date at all,
      // and writing a plausible year for them is the fabrication the fixture
      // test below pins in both directions.
      expect(s.range.published).toMatch(/^(\d{4}(-\d{2}-\d{2})?|undated)$/);
      expect(s.range.caveat.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every absent range a reason", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.range.kind !== "none") continue;
      expect(s.range.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("says which measure it would need, exactly when it names no metric", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.metricKey === null) {
        expect(typeof s.needsMetric).toBe("string");
        expect((s.needsMetric ?? "").trim().length).toBeGreaterThan(0);
      } else {
        expect(s.needsMetric).toBeNull();
      }
    }
  });

  it("always says why a cutting was chosen, or why none was", () => {
    for (const s of GOAL_SCENARIOS) {
      expect(s.cuttingWhy.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the standing caveat on the payload, not on the rows", () => {
    // A caveat repeated per row can be edited away one row at a time. One
    // constant cannot.
    expect(THE_CAVEAT).toMatch(/not about yours/);
    expect(goalScenarioBook().caveat).toBe(THE_CAVEAT);
  });
});

describe("producerFor — derived from direction, never stored", () => {
  it("sends a floor to goal-reached and a ceiling to ceiling-held", () => {
    // Mirrors the two producers' own filters: GoalReachedProducer skips
    // `at_most` (goal-reached.producer.ts:121) and CeilingHeldProducer selects
    // `.eq("direction", "at_most")` (ceiling-held.producer.ts:95).
    for (const s of GOAL_SCENARIOS) {
      if (s.metricKey === null) {
        expect(producerFor(s)).toBeNull();
        continue;
      }
      expect(producerFor(s)).toBe(
        s.direction === "at_most" ? "ceiling-held" : "goal-reached",
      );
    }
  });

  it("announces nothing for a scenario that cannot be set", () => {
    const unservable = GOAL_SCENARIOS.filter((s) => s.metricKey === null);
    expect(unservable.length).toBeGreaterThan(0);
    for (const s of unservable) expect(producerFor(s)).toBeNull();
  });
});

describe("goalScenarioBook — the served payload", () => {
  const book = goalScenarioBook();

  it("reads no tenant data", () => {
    // The strongest form of this assertion available in a unit test: the
    // function takes no argument, so there is no id it could have read.
    expect(goalScenarioBook.length).toBe(0);
  });

  it("counts servable and unservable, and the two add up", () => {
    expect(book.counts.total).toBe(GOAL_SCENARIOS.length);
    expect(book.counts.servable + book.counts.needsAMetric).toBe(
      book.counts.total,
    );
    expect(book.counts.servable).toBeGreaterThan(0);
    expect(book.counts.needsAMetric).toBeGreaterThan(0);
  });

  it("labels each servable scenario from the goals module, not from itself", () => {
    for (const s of book.scenarios) {
      if (!s.servable) {
        expect(s.metricLabel).toBeNull();
        continue;
      }
      expect(s.metricLabel).toBe(
        GoalsService.SUPPORTED_METRICS[s.metricKey as string].label,
      );
    }
  });

  it("echoes what each named cutting answers, from the cutting catalogue", () => {
    for (const s of book.scenarios) {
      if (s.cuttingId === null) {
        expect(s.cuttingAnswers).toBeNull();
        continue;
      }
      expect(s.cuttingAnswers).toBe(CUTTING_CATALOGUE[s.cuttingId].answers);
    }
  });

  it("hands the picker the same metric list the goals desk uses", () => {
    expect(book.metrics.map((m) => m.key).sort()).toEqual(
      Object.keys(GoalsService.SUPPORTED_METRICS).sort(),
    );
  });
});

/**
 * Every quoted figure is checked against the page it is attributed to.
 *
 * THE DEFECT THIS EXISTS FOR, MEASURED
 * ------------------------------------
 * `labour-cost-ratio` quoted *"fullservice operators who reported a pre-tax
 * profit … a median of 34.2% of sales"* and cited the NRA's LABOUR-COSTS page.
 * That page carries 36.5% and 31.7% verbatim and contains neither "34.2" nor
 * "pre-tax": the clause is on the abstract's PROFITABILITY page. The number was
 * real, the citation beside it was not, and nothing in the build could tell —
 * which is the whole problem, because "each range carries a source you can
 * check" is the only reason showing operator ranges is defensible at all.
 *
 * Re-reading every citation on 2026-09-04 found four more of the same class
 * (two DCL quotes that are not on the DCL page, two dates copied from the wrong
 * NRA page, three bare years on pages that state no date, and a RevPASH row
 * quoting figures against a URL that 403s). All are recorded in
 * `__fixtures__/operator-sources.ts`.
 *
 * WHAT IS ACTUALLY ASSERTED
 * -------------------------
 * Not string equality — a `words` field is allowed to be a readable sentence
 * rather than a transcription. What is pinned is the part that can be WRONG:
 * **every numeric token a scenario quotes must appear in the recorded text of a
 * page that scenario names.** That is precisely the check "34.2 against the
 * labour-costs page" fails, and precisely the check a paraphrase passes.
 *
 * URLs are stripped before tokens are extracted, or a date inside a path
 * (`/2026/05/30/`) would satisfy itself.
 */
describe("every quoted figure is in the source it is attributed to", () => {
  /** Numbers a reader would read as a claim. URLs are not claims. */
  function figuresIn(text: string): string[] {
    const withoutUrls = text.replace(/https?:\/\/\S+/g, " ");
    return Array.from(withoutUrls.matchAll(/\d+(?:\.\d+)?/g)).map((m) => m[0]);
  }

  /** En/em dashes and NBSP are typography; a comparison must not see them. */
  function normalise(text: string): string {
    // Escapes, not literals: an NBSP in source is invisible and eslint's
    // no-irregular-whitespace rejects it.
    return text.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\u00a0/g, " ");
  }

  /** Every https URL a scenario names, wherever in the row it appears. */
  function urlsOf(s: (typeof GOAL_SCENARIOS)[number]): string[] {
    const text = [
      s.range.kind === "published" ? s.range.url : "",
      s.range.kind === "published" ? s.range.words : s.range.why,
      s.range.kind === "published" ? s.range.caveat : "",
    ].join(" ");
    return Array.from(text.matchAll(/https?:\/\/[^\s,)]+/g)).map((m) => m[0]);
  }

  it("has recorded evidence for every URL any scenario names", () => {
    for (const s of GOAL_SCENARIOS) {
      for (const url of urlsOf(s)) {
        expect(
          Object.prototype.hasOwnProperty.call(OPERATOR_SOURCES, url),
        ).toBe(true);
      }
    }
  });

  it("names no source it has not tried to read", () => {
    for (const url of CITED_URLS) {
      const fx = OPERATOR_SOURCES[url];
      expect(fx.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // An unreadable source must SAY it is unreadable, not be an empty string
      // that reads as "we fetched it and it said nothing".
      if (fx.excerpt === null) expect(fx.unreadable).toBeTruthy();
      else expect(fx.excerpt.trim().length).toBeGreaterThan(0);
    }
  });

  it("quotes no figure that is absent from the page it names", () => {
    const misses: string[] = [];
    for (const s of GOAL_SCENARIOS) {
      const urls = urlsOf(s);
      if (urls.length === 0) continue; // an unsourced row is covered below
      const evidence = normalise(
        urls.map((u) => OPERATOR_SOURCES[u]?.excerpt ?? "").join("\n"),
      );
      const quoted =
        s.range.kind === "published"
          ? `${s.range.words} ${s.range.caveat}`
          : s.range.why;
      for (const figure of figuresIn(normalise(quoted))) {
        if (!evidence.includes(figure))
          misses.push(`${s.id}: "${figure}" is not in ${urls.join(", ")}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("quotes no figure at all against a source that could not be read", () => {
    // Naming an unreadable source for a definition is fine. Quoting a number
    // from one is not: nothing could ever check it.
    for (const s of GOAL_SCENARIOS) {
      const unreadable = urlsOf(s).filter(
        (u) => OPERATOR_SOURCES[u]?.excerpt === null,
      );
      if (unreadable.length === 0) continue;
      const readable = urlsOf(s).filter(
        (u) => OPERATOR_SOURCES[u]?.excerpt !== null,
      );
      if (readable.length > 0) continue; // the figures may belong to the others
      const quoted =
        s.range.kind === "published"
          ? `${s.range.words} ${s.range.caveat}`
          : s.range.why;
      expect({ id: s.id, figures: figuresIn(normalise(quoted)) }).toEqual({
        id: s.id,
        figures: [],
      });
    }
  });

  it("agrees with each page about whether that page carries a date", () => {
    for (const s of GOAL_SCENARIOS) {
      if (s.range.kind !== "published") continue;
      const fx = OPERATOR_SOURCES[s.range.url];
      expect(fx).toBeDefined();
      if (fx.pageDate === null) {
        // The page states no date. Writing a plausible year here is the small
        // fabrication this whole file exists to refuse.
        expect(s.range.published).toBe("undated");
      } else {
        expect(s.range.published).toBe(fx.pageDate);
      }
    }
  });

  it("keeps the counter-example on file: 34.2 is NOT on the labour-costs page", () => {
    // A guard that has never been shown to fire is not evidence. This pins the
    // exact fact the shipped catalogue got wrong.
    const labourCosts =
      OPERATOR_SOURCES[
        "https://www.restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/restaurant-labor-costs-are-well-above-historical-averages/"
      ];
    expect(labourCosts.excerpt).toContain("36.5%");
    expect(labourCosts.excerpt).not.toContain("34.2");
    expect(labourCosts.excerpt).not.toContain("pre-tax");

    const profitability =
      OPERATOR_SOURCES[
        "https://restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/elevated-labor-costs-had-a-significant-impact-on-restaurant-profitability-in-2024/"
      ];
    expect(profitability.excerpt).toContain("34.2%");
    // And the row now cites the page that carries it.
    const labour = scenarioById("labour-cost-ratio");
    expect(labour?.range.kind).toBe("published");
    if (labour?.range.kind === "published")
      expect(labour.range.url).toContain("profitability-in-2024");
  });
});

/**
 * The first gap the founder funded (ADR 0120, 2026-09-04).
 *
 * `days-of-inventory` shipped as `metricKey: null` with a `needsMetric` saying
 * the figure was already computed and only a `SUPPORTED_METRICS` entry was
 * missing. It was chosen first for exactly that reason. These cases pin the
 * BEFORE and AFTER so the change cannot silently regress into either a metric
 * with no scenario or a scenario with no metric.
 */
describe("days_of_inventory — the gap that got closed", () => {
  const dio = scenarioById("days-of-inventory");

  it("is now held on a real metric, and names no missing measure", () => {
    expect(dio?.metricKey).toBe("days_of_inventory");
    expect(dio?.needsMetric).toBeNull();
    expect(GoalsService.SUPPORTED_METRICS.days_of_inventory).toBeDefined();
  });

  it("is a ceiling, announced by the ceiling producer", () => {
    // Holding FEWER days of stock is the goal, so it counts down — which puts
    // it on `ceiling-held`, not on the crossing producer.
    expect(dio?.direction).toBe("at_most");
    expect(producerFor(dio!)).toBe("ceiling-held");
  });

  it("is measured in days, a unit the other six did not need", () => {
    expect(GoalsService.SUPPORTED_METRICS.days_of_inventory.unit).toBe("days");
  });

  it("reads the levers that actually move a cellar, not sales", () => {
    expect(
      GoalsService.SUPPORTED_METRICS.days_of_inventory.insightCategories,
    ).toEqual(["purchasing", "risk"]);
  });

  it("moves the servable count from nine to ten", () => {
    const book = goalScenarioBook();
    expect(book.counts.servable).toBe(10);
    expect(book.counts.needsAMetric).toBe(11);
    expect(book.counts.total).toBe(21);
  });

  it("draws on the register the figure is computed inside", () => {
    expect(dio?.cuttingId).toBe("ledger");
  });
});

/**
 * The file's own prose is pinned to the table it describes.
 *
 * `goal-scenarios.ts`'s header states how many servable rows carry no range,
 * and that sentence is the argument for the whole design — "published ranges
 * exist for RATIOS, almost never for LEVELS". A sentence that quietly stops
 * being true is the documentation equivalent of the citation defect this file
 * spent a day fixing.
 */
describe("the header's counts are the table's counts", () => {
  it("five of the ten servable rows carry no published range", () => {
    const servable = GOAL_SCENARIOS.filter((s) => s.metricKey !== null);
    expect(servable).toHaveLength(10);
    expect(servable.filter((s) => s.range.kind === "none")).toHaveLength(5);
  });
});
