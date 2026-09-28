import {
  ANY,
  buildSuppressionKey,
  dateOfGrain,
  dayGrain,
  effectiveScope,
  insightRuleId,
  isSuppressed,
  parseSuppressionKey,
  slugSubject,
  suppressingKeysFor,
  suppressionKeys,
  trendGrain,
  windowGrain,
} from "./suppression";

/**
 * The grammar of "never show me this again".
 *
 * Every assertion here is about a scope BOUNDARY: what a dismissal at one
 * scope silences, and — the half that matters more — what it must leave
 * standing. A suppression that is too wide is indistinguishable from a broken
 * feed, and a suppression that is too narrow is the founder's complaint
 * ("if the person says dismiss, then it should be avoided at all costs").
 */
describe("suppression keys", () => {
  const wednesday = {
    ruleId: "sales_below_weekday_baseline",
    subject: "Wednesday",
    periodKey: "d:2026-09-02",
  };

  describe("the three scopes", () => {
    it("insight scope names the rule, the subject AND the period", () => {
      expect(buildSuppressionKey(wednesday, "insight")).toBe(
        "sales_below_weekday_baseline#wednesday#d:2026-09-02",
      );
    });

    it("subject scope drops the period, keeping every Wednesday", () => {
      expect(buildSuppressionKey(wednesday, "subject")).toBe(
        "sales_below_weekday_baseline#wednesday#*",
      );
    });

    it("rule scope collapses to the bare rule key", () => {
      expect(buildSuppressionKey(wednesday, "rule")).toBe(
        "sales_below_weekday_baseline",
      );
    });

    it("offers all three at once without re-deriving them", () => {
      expect(suppressionKeys(wednesday)).toEqual({
        insight: "sales_below_weekday_baseline#wednesday#d:2026-09-02",
        subject: "sales_below_weekday_baseline#wednesday#*",
        rule: "sales_below_weekday_baseline",
      });
    });
  });

  describe("what a key actually silences", () => {
    it("an insight key silences that entry", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "insight")]);
      expect(isSuppressed(wednesday, stored)).toBe(true);
    });

    it("…and NOT the same rule and subject in another period", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "insight")]);
      expect(
        isSuppressed({ ...wednesday, periodKey: "d:2026-09-09" }, stored),
      ).toBe(false);
    });

    it("…and NOT the same rule about another subject", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "insight")]);
      expect(isSuppressed({ ...wednesday, subject: "Friday" }, stored)).toBe(
        false,
      );
    });

    it("a subject key silences every period for that subject", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "subject")]);
      expect(
        isSuppressed({ ...wednesday, periodKey: "d:2026-10-14" }, stored),
      ).toBe(true);
      expect(isSuppressed({ ...wednesday, periodKey: null }, stored)).toBe(
        true,
      );
    });

    it("…and NOT another subject", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "subject")]);
      expect(isSuppressed({ ...wednesday, subject: "Friday" }, stored)).toBe(
        false,
      );
    });

    it("a rule key silences every subject and every period", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "rule")]);
      for (const subject of ["Wednesday", "Friday", null])
        for (const periodKey of ["d:2026-09-02", "d:2027-01-01", null])
          expect(isSuppressed({ ...wednesday, subject, periodKey }, stored)).toBe(
            true,
          );
    });

    it("…and NOTHING belonging to another rule", () => {
      const stored = new Set([buildSuppressionKey(wednesday, "rule")]);
      expect(
        isSuppressed({ ...wednesday, ruleId: "weekly_demand_slide" }, stored),
      ).toBe(false);
    });

    it("an empty store suppresses nothing", () => {
      expect(isSuppressed(wednesday, new Set<string>())).toBe(false);
    });
  });

  describe("rows written before scopes existed", () => {
    /**
     * Every dismissal stored before 2026-09-03 is a bare `rule_key` with no
     * separators. If the matcher stopped recognising those, thousands of
     * standing dismissals would silently come back — the exact failure this
     * whole change exists to close, introduced by the fix for it.
     */
    it("a bare rule key still silences the whole rule", () => {
      const stored = new Set(["sales_below_weekday_baseline"]);
      expect(isSuppressed(wednesday, stored)).toBe(true);
    });

    it("the bare key and rule#*#* are the same instruction", () => {
      expect(
        isSuppressed(wednesday, new Set(["sales_below_weekday_baseline#*#*"])),
      ).toBe(true);
      expect(parseSuppressionKey("sales_below_weekday_baseline").scope).toBe(
        "rule",
      );
      expect(parseSuppressionKey("sales_below_weekday_baseline#*#*").scope).toBe(
        "rule",
      );
    });

    it("lists the bare form among the keys that could suppress a target", () => {
      expect(suppressingKeysFor(wednesday)).toContain(
        "sales_below_weekday_baseline",
      );
    });
  });

  describe("a rule that names nothing", () => {
    const anonymous = { ruleId: "dead_stock_capital" };

    /**
     * The honesty case. Asking for the narrowest scope on a rule with no
     * subject and no period cannot produce a narrow key — so it must not
     * CLAIM one. The page reads `scope` back and tells the manager that
     * dismissing this entry silences the whole rule.
     */
    it("degrades to the whole rule, and says so", () => {
      expect(buildSuppressionKey(anonymous, "insight")).toBe(
        "dead_stock_capital",
      );
      expect(effectiveScope(anonymous, "insight")).toBe("rule");
    });

    it("reports the real scope for a rule that does name a subject", () => {
      expect(effectiveScope(wednesday, "insight")).toBe("insight");
      expect(effectiveScope(wednesday, "subject")).toBe("subject");
      expect(effectiveScope(wednesday, "rule")).toBe("rule");
    });

    it("a subject with no period is a subject-scope key", () => {
      const noPeriod = { ruleId: "staff_spread", subject: "Ada" };
      expect(buildSuppressionKey(noPeriod, "insight")).toBe(
        "staff_spread#ada#*",
      );
      expect(effectiveScope(noPeriod, "insight")).toBe("subject");
    });
  });

  describe("slugging and grains", () => {
    it("folds case and spacing so one subject is one key", () => {
      expect(slugSubject(" Wednesday ")).toBe("wednesday");
      expect(slugSubject("Table 4")).toBe("table-4");
      expect(slugSubject("")).toBe(ANY);
      expect(slugSubject(null)).toBe(ANY);
    });

    it("refuses a grain it cannot parse rather than inventing one", () => {
      expect(dayGrain("2026-09-02")).toBe("d:2026-09-02");
      expect(dayGrain("yesterday")).toBeNull();
      expect(dayGrain(null)).toBeNull();
      expect(windowGrain(7, "2026-09-02")).toBe("p7:2026-09-02");
      expect(trendGrain(28, "2026-09-02")).toBe("t28:2026-09-02");
    });

    it("recovers the date a grain names, for the day-exclusion offer", () => {
      expect(dateOfGrain("d:2026-09-02")).toBe("2026-09-02");
      expect(dateOfGrain("p7:2026-09-02")).toBe("2026-09-02");
      expect(dateOfGrain("*")).toBeNull();
      expect(dateOfGrain(null)).toBeNull();
    });

    it("keeps the insight prefix the Reports panel already writes", () => {
      expect(insightRuleId("overall.revenue.vs_same_weekday")).toBe(
        "insight:overall.revenue.vs_same_weekday",
      );
      expect(
        buildSuppressionKey(
          {
            ruleId: insightRuleId("overall.revenue.vs_same_weekday"),
            subject: "Wednesday",
            periodKey: "d:2026-09-02",
          },
          "insight",
        ),
      ).toBe("insight:overall.revenue.vs_same_weekday#wednesday#d:2026-09-02");
    });

    it("refuses a key with no rule", () => {
      expect(() => buildSuppressionKey({ ruleId: "  " })).toThrow();
    });
  });
});
