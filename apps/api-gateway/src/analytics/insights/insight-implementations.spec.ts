/**
 * The anti-drift guard for the "computable now" meter.
 * ====================================================
 *
 * `insight-implementations.ts` declares which catalogue types have a generator.
 * A declared list rots, so nothing here trusts it: every assertion below
 * re-derives the truth from `insight-generator.service.ts` itself and compares.
 *
 * The extractor is deliberately brittle in one direction only — it THROWS when
 * it meets a `this.record(...)` key or a `timeSeriesInsights` call site it
 * cannot resolve. A refactor that outruns it turns the suite red instead of
 * quietly shrinking the count, which is the failure mode that produced the
 * original defect (ADR 0020 — a mislabelled number is a fabrication).
 */

import * as fs from "fs";
import * as path from "path";
import {
  DataRequirement,
  INSIGHT_CANDIDATES,
  availableCandidates,
} from "./insight-catalog";
import {
  IMPLEMENTED_INSIGHT_TYPES,
  annotatedCandidates,
  catalogCoverage,
  isImplemented,
} from "./insight-implementations";

const GENERATOR_PATH = path.join(__dirname, "insight-generator.service.ts");
const SRC = fs.readFileSync(GENERATOR_PATH, "utf8");

const ALL_REQUIREMENTS: DataRequirement[] = [
  "consumption",
  "orders",
  "inventory",
  "checks",
  "tables",
  "venue",
  "goals",
];

// ---------------------------------------------------------------------------
// Source derivation — the generator is the source of truth, not the list
// ---------------------------------------------------------------------------

/** Index of the delimiter closing the group that opens at `from`. */
function balanced(src: string, from: number, open: string, close: string) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced ${open}${close} from index ${from}`);
}

/** Body span of a method, given the text that starts its declaration. */
function methodBody(declaration: string): { start: number; end: number } {
  const sigIdx = SRC.indexOf(declaration);
  if (sigIdx < 0) throw new Error(`method not found: ${declaration}`);
  const parenOpen = SRC.indexOf("(", sigIdx);
  const parenClose = balanced(SRC, parenOpen, "(", ")");
  const start = SRC.indexOf("{", parenClose);
  return { start, end: balanced(SRC, start, "{", "}") };
}

const helper = methodBody("private timeSeriesInsights(");

/** `const window = params.periodWindow ?? 7` — read, never assumed. */
const HELPER_DEFAULT_WINDOW = (() => {
  const m = /periodWindow\s*\?\?\s*(\d+)/.exec(
    SRC.slice(helper.start, helper.end),
  );
  if (!m) throw new Error("cannot read the timeSeriesInsights window default");
  return Number(m[1]);
})();

/** The five `computeXFamily` methods and the data each guards on. */
function familyGuards() {
  const out: Array<{
    name: string;
    start: number;
    end: number;
    requires: Set<DataRequirement>;
  }> = [];
  const decl = /private (compute\w+Family)\(/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(SRC))) {
    const span = methodBody(m[0]);
    const body = SRC.slice(span.start, span.end);
    const requires = new Set<DataRequirement>();
    const has = /availability\.has\("(\w+)"\)/g;
    let g: RegExpExecArray | null;
    while ((g = has.exec(body))) requires.add(g[1] as DataRequirement);
    if (requires.size === 0)
      throw new Error(
        `${m[1]} has no availability guard the extractor can see`,
      );
    out.push({ name: m[1], ...span, requires });
  }
  if (out.length === 0) throw new Error("no compute*Family methods found");
  return out;
}

const FAMILIES = familyGuards();

function familyAt(index: number) {
  const f = FAMILIES.find((x) => index > x.start && index < x.end);
  if (!f)
    throw new Error(
      `code at index ${index} emits an insight outside every compute*Family guard`,
    );
  return f;
}

interface CallSite {
  dimension: string;
  measure: string;
  window: number;
  /** The call's literal `category:`, or null when it has none. */
  category: string | null;
  index: number;
}

/** Every `timeSeriesInsights({...})` call, its literals read from the object. */
function timeSeriesCallSites(): CallSite[] {
  const calls: CallSite[] = [];
  const site = /this\.timeSeriesInsights\(\s*\{/g;
  let c: RegExpExecArray | null;
  while ((c = site.exec(SRC))) {
    const objOpen = SRC.indexOf("{", c.index);
    const obj = SRC.slice(objOpen, balanced(SRC, objOpen, "{", "}") + 1);
    const dimension = /\bdimension:\s*"([^"]+)"/.exec(obj);
    const measure = /\bmeasure:\s*"([^"]+)"/.exec(obj);
    const window = /\bperiodWindow:\s*(\d+)/.exec(obj);
    const category = /\bcategory:\s*"([^"]+)"/.exec(obj);
    if (!dimension || !measure)
      throw new Error(
        `timeSeriesInsights call at index ${c.index} has a non-literal dimension/measure`,
      );
    calls.push({
      dimension: dimension[1],
      measure: measure[1],
      window: window ? Number(window[1]) : HELPER_DEFAULT_WINDOW,
      category: category ? category[1] : null,
      index: c.index,
    });
  }
  if (calls.length === 0) throw new Error("no timeSeriesInsights call sites");
  return calls;
}

const CALL_SITES = timeSeriesCallSites();

/** A templated `record()` key, expanded for one call site. */
function expandKey(pattern: string, call: CallSite): string {
  return pattern.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    if (name === "dimension") return call.dimension;
    if (name === "measure") return call.measure;
    if (name === "window") return String(call.window);
    throw new Error(`unresolvable \${${name}} in template ${pattern}`);
  });
}

/**
 * Every type key the generator can emit, with the data its family guards on.
 * Literal `record("a.b.c")` keys are taken as-is; the templated keys inside
 * `timeSeriesInsights` are expanded across that helper's call sites.
 */
function deriveImplemented(): Map<string, Set<DataRequirement>> {
  const literals: Array<{ key: string; index: number }> = [];
  const patterns: string[] = [];

  const rec = /this\.record\(\s*(?:"([^"]*)"|`([^`]*)`|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = rec.exec(SRC))) {
    const literal = m[1] ?? m[3];
    const template = m[2];
    const insideHelper = m.index > helper.start && m.index < helper.end;
    if (literal !== undefined) {
      literals.push({ key: literal, index: m.index });
      continue;
    }
    if (template === undefined)
      throw new Error(`unreadable record() key at index ${m.index}`);
    if (!insideHelper)
      throw new Error(
        `templated record() key outside timeSeriesInsights at index ${m.index}: ${template}`,
      );
    patterns.push(template);
  }
  if (patterns.length === 0)
    throw new Error("timeSeriesInsights emitted no recognisable record() keys");

  const calls = CALL_SITES;

  const found = new Map<string, Set<DataRequirement>>();
  const add = (key: string, requires: Set<DataRequirement>) => {
    const existing = found.get(key);
    if (existing) for (const r of requires) existing.add(r);
    else found.set(key, new Set(requires));
  };

  for (const l of literals) add(l.key, familyAt(l.index).requires);
  for (const call of calls) {
    const requires = familyAt(call.index).requires;
    for (const pattern of patterns) add(expandKey(pattern, call), requires);
  }
  return found;
}

const DERIVED = deriveImplemented();

/**
 * The category every `record()` files its type under (ADR 0291).
 *
 * The second argument is read, never assumed: a string literal is taken as
 * it stands; inside `timeSeriesInsights` it must be the helper's own
 * `category` parameter, which is resolved through each call site's literal
 * `category:`. Anything else — a ternary, a variable, a computed value —
 * throws, so a refactor that outruns this reader turns the suite red rather
 * than quietly checking fewer calls. The count check closes the other gap:
 * a `this.record(` whose key is not a literal would not be matched at all.
 */
function deriveRecordedCategories(): Array<{ key: string; category: string }> {
  const out: Array<{ key: string; category: string }> = [];
  const rec =
    /this\.record\(\s*(?:"([^"]*)"|`([^`]*)`|'([^']*)')\s*,\s*(?:"([^"]*)"\s*,|'([^']*)'\s*,|([A-Za-z_$][\w$]*)\s*,)/g;
  let seen = 0;
  let m: RegExpExecArray | null;
  while ((m = rec.exec(SRC))) {
    seen++;
    const key = m[1] ?? m[2] ?? m[3];
    const literal = m[4] ?? m[5];
    const ident = m[6];
    const insideHelper = m.index > helper.start && m.index < helper.end;
    if (m[2] === undefined) {
      // A literal key: its category must be a literal too.
      if (literal === undefined)
        throw new Error(
          `record("${key}") at index ${m.index} passes a non-literal category`,
        );
      out.push({ key, category: literal });
      continue;
    }
    if (!insideHelper)
      throw new Error(
        `templated record() key outside timeSeriesInsights: ${key}`,
      );
    for (const call of CALL_SITES) {
      let category: string;
      if (literal !== undefined) category = literal;
      else if (ident === "category") {
        if (call.category === null)
          throw new Error(
            `timeSeriesInsights call at index ${call.index} has no literal category:`,
          );
        category = call.category;
      } else
        throw new Error(
          `templated record() at index ${m.index} passes an unreadable category`,
        );
      out.push({ key: expandKey(key, call), category });
    }
  }
  const total = (SRC.match(/this\.record\(/g) ?? []).length;
  if (seen !== total)
    throw new Error(
      `read the category of ${seen} record() calls, but the generator has ${total}`,
    );
  return out;
}

const RECORDED = deriveRecordedCategories();

// ---------------------------------------------------------------------------

describe("implemented insight types", () => {
  it("the extractor resolves every record() call site in the generator", () => {
    // deriveImplemented() throws on anything it cannot resolve; reaching here
    // means the whole generator was read, not just the parts we recognised.
    expect(DERIVED.size).toBeGreaterThan(0);
    expect(FAMILIES.map((f) => f.name).sort()).toEqual([
      "computeChecksFamily",
      "computeConsumptionFamily",
      "computeGoalsFamily",
      "computeInventoryFamily",
      "computeOrdersFamily",
    ]);
  });

  it("the declared list matches the generator exactly", () => {
    const derived = Array.from(DERIVED.keys()).sort();
    expect(derived).toEqual([...IMPLEMENTED_INSIGHT_TYPES].sort());
  });

  it("every implemented type exists in the catalogue", () => {
    const catalogued = new Set(INSIGHT_CANDIDATES.map((c) => c.key));
    const orphans = Array.from(DERIVED.keys()).filter(
      (k) => !catalogued.has(k),
    );
    expect(orphans).toEqual([]);
  });

  it("every record() files its type under the catalogue's category (ADR 0291)", () => {
    // The catalogue's narrowed read asks with the catalogue's category, and
    // the generator filters by category before key — so a type recorded
    // under any other category reads "Nothing live" while it fires. Found
    // live on 2026-10-03: vendor.purchase_spend.concentration under `risk`.
    const byKey = new Map(INSIGHT_CANDIDATES.map((c) => [c.key, c.category]));
    const disagree = RECORDED.filter(
      (r) => byKey.get(r.key) !== r.category,
    ).map(
      (r) => `${r.key}: generator ${r.category}, catalogue ${byKey.get(r.key)}`,
    );
    expect(disagree).toEqual([]);
    // Every emitted type was checked, not a subset the reader recognised.
    expect(new Set(RECORDED.map((r) => r.key))).toEqual(
      new Set(DERIVED.keys()),
    );
    expect(
      RECORDED.find((r) => r.key === "vendor.purchase_spend.concentration")
        ?.category,
    ).toBe("purchasing");
  });

  it("catalogue requirements cover what each generator family guards on", () => {
    // A type whose catalogue `requires` is thinner than its family guard would
    // be counted computable for a restaurant whose generator cannot run.
    const byKey = new Map(INSIGHT_CANDIDATES.map((c) => [c.key, c]));
    const understated: string[] = [];
    for (const [key, guard] of DERIVED) {
      const declared = new Set(byKey.get(key)?.requires ?? []);
      for (const r of guard)
        if (!declared.has(r))
          understated.push(`${key} needs ${r}, catalogue does not list it`);
    }
    expect(understated).toEqual([]);
  });
});

describe("coverage meter", () => {
  const everything = new Set(ALL_REQUIREMENTS);

  it("counts only implemented types as computable, never the whole catalogue", () => {
    const coverage = catalogCoverage(everything);
    // Even with every data source connected, computable is bounded by what is
    // built — this is the assertion the shipped availability-only meter failed.
    expect(coverage.computable).toBe(IMPLEMENTED_INSIGHT_TYPES.length);
    expect(coverage.catalogued).toBe(INSIGHT_CANDIDATES.length);
    expect(coverage.computable).toBeLessThan(coverage.catalogued / 10);
  });

  it("is not the old data-availability-only number", () => {
    // The pre-fix meter: filter the catalogue on data alone. With everything
    // connected that is the entire catalogue — a 20x overstatement.
    const availabilityOnly = availableCandidates(everything).length;
    const coverage = catalogCoverage(everything);
    expect(availabilityOnly).toBe(INSIGHT_CANDIDATES.length);
    expect(coverage.computable).not.toBe(availabilityOnly);
    expect(availabilityOnly / (coverage.computable as number)).toBeGreaterThan(
      10,
    );
  });

  it("splits the catalogue exactly, with nothing double-counted", () => {
    const coverage = catalogCoverage(everything);
    expect(
      (coverage.computable as number) +
        (coverage.blockedOnData as number) +
        coverage.notBuilt,
    ).toBe(coverage.catalogued);
  });

  it("reports unknown rather than guessing when availability is unknown", () => {
    const coverage = catalogCoverage(null);
    expect(coverage.computable).toBeNull();
    expect(coverage.blockedOnData).toBeNull();
    // What is built is knowable without a restaurant, so it is still reported.
    expect(coverage.implemented).toBe(IMPLEMENTED_INSIGHT_TYPES.length);
    expect(coverage.notBuilt).toBe(
      INSIGHT_CANDIDATES.length - IMPLEMENTED_INSIGHT_TYPES.length,
    );
  });

  it("drops implemented types whose data this restaurant lacks", () => {
    const noPos = new Set<DataRequirement>([
      "consumption",
      "orders",
      "inventory",
    ]);
    const coverage = catalogCoverage(noPos);
    expect(coverage.computable).toBeLessThan(IMPLEMENTED_INSIGHT_TYPES.length);
    expect(coverage.blockedOnData).toBe(
      IMPLEMENTED_INSIGHT_TYPES.length - (coverage.computable as number),
    );
    // Nothing POS-derived may be called computable without a check feed.
    expect(isImplemented("overall.revenue.vs_same_weekday")).toBe(true);
    const posType = INSIGHT_CANDIDATES.find(
      (c) => c.key === "overall.revenue.vs_same_weekday",
    );
    expect(posType?.requires).toContain("checks");
  });

  it("marks the catalogue so a client cannot mistake roadmap for capability", () => {
    const annotated = annotatedCandidates();
    expect(annotated).toHaveLength(INSIGHT_CANDIDATES.length);
    expect(annotated.filter((c) => c.implemented)).toHaveLength(
      IMPLEMENTED_INSIGHT_TYPES.length,
    );
    expect(annotated.every((c) => typeof c.implemented === "boolean")).toBe(
      true,
    );
  });
});
