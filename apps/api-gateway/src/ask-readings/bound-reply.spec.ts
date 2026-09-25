import {
  answerKindNotPermittedReply,
  bindKnowledgeReply,
  bindReadingReply,
  classRefusalLine,
  couldNotReadLine,
  couldNotReadReply,
  findingReply,
  isBoundReply,
  isRefusalLine,
  modelFailureReply,
  notPermittedReply,
  READING_BOOK,
  unbuiltNotPermittedReply,
} from "./bound-reply";
import { READING_CATALOGUE } from "./reading-catalogue";
import { CLASS_LABEL, DATA_CLASSES } from "./reading-data-classes";
import { Finding } from "./reading.types";

// KL audit J7: zero specs named this file before this file. bindReadingReply
// and isBoundReply are the two functions standing between a model's raw JSON
// and a cell binding the page renders as house fact, so an id that was never
// minted by the runner must never bind.

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: "finding",
    readingId: "orders.open",
    readingVersion: 1,
    args: {},
    outcome: "read",
    reason: null,
    asOf: "2026-09-17T00:00:00.000Z",
    sourcesQueried: ["procurement_orders"],
    failedSources: [],
    rowsScanned: 2,
    trace: [],
    rows: [
      { key: "orders", cells: [
        { id: "cell-1", key: "count", label: "Open orders", value: 2, unit: null, source: "house", provenance: "stated", sourceRelations: ["procurement_orders"] },
        { id: "cell-2", key: "total", label: "Total value", value: 140, unit: "USD", source: "house", provenance: "stated", sourceRelations: ["procurement_orders"] },
      ] },
    ],
    fingerprint: "fp-1",
    ...overrides,
  };
}

describe("bindReadingReply: a composer may SELECT minted cells, never write a claim", () => {
  it("binds one or more cell ids that the Finding actually minted", () => {
    const reply = bindReadingReply({ kind: "reading", focus: ["cell-1", "cell-2"] }, finding());
    expect(reply).toEqual({ kind: "reading", finding: finding(), focus: [{ cellId: "cell-1" }, { cellId: "cell-2" }] });
  });

  it("refuses a cell id the Finding never minted", () => {
    expect(() => bindReadingReply({ kind: "reading", focus: ["cell-1", "invented-cell"] }, finding())).toThrow("invalid_cell_binding");
  });

  it("refuses a duplicate cell id", () => {
    expect(() => bindReadingReply({ kind: "reading", focus: ["cell-1", "cell-1"] }, finding())).toThrow("invalid_cell_binding");
  });

  it("refuses zero cells and refuses more than eight", () => {
    expect(() => bindReadingReply({ kind: "reading", focus: [] }, finding())).toThrow("invalid_bound_reply");
    const nine = Array.from({ length: 9 }, (_, i) => `cell-${i}`);
    const manyCells = finding({ rows: [{ key: "r", cells: nine.map(id => ({ id, key: id, label: id, value: 1, unit: null, source: "house" as const, provenance: "stated" as const, sourceRelations: [] })) }] });
    expect(() => bindReadingReply({ kind: "reading", focus: nine }, manyCells)).toThrow("invalid_bound_reply");
  });

  it("refuses an unknown key on the shape, and a wrong kind", () => {
    expect(() => bindReadingReply({ kind: "reading", focus: ["cell-1"], extra: true }, finding())).toThrow("invalid_bound_reply");
    expect(() => bindReadingReply({ kind: "model_knowledge", focus: ["cell-1"] }, finding())).toThrow("invalid_bound_reply");
  });
});

describe("bindKnowledgeReply: the source marker is minted here, never by the model", () => {
  it("accepts trimmed text under the shape it defines", () => {
    const reply = bindKnowledgeReply({ kind: "model_knowledge", text: "  general answer  " });
    expect(reply).toEqual({ kind: "model_knowledge", source: "model_knowledge", sourceLabel: "Not from the house's books", text: "general answer" });
  });

  it("refuses empty text, oversized text, and an unknown key", () => {
    expect(() => bindKnowledgeReply({ kind: "model_knowledge", text: "" })).toThrow("invalid_knowledge_reply");
    expect(() => bindKnowledgeReply({ kind: "model_knowledge", text: "x".repeat(6001) })).toThrow("invalid_knowledge_reply");
    expect(() => bindKnowledgeReply({ kind: "model_knowledge", text: "ok", sourceLabel: "forged" })).toThrow("invalid_knowledge_reply");
  });
});

describe("findingReply: a Finding that did not read renders as its own outcome", () => {
  it("carries the Finding's own reason", () => {
    const f = finding({ outcome: "not_in_your_books", reason: "empty_register" });
    expect(findingReply(f)).toEqual({ kind: "not_in_your_books", reason: "empty_register", finding: f });
  });

  it("refuses a Finding that actually read -- that one must go through a composer, not this path", () => {
    expect(() => findingReply(finding({ outcome: "read", reason: null }))).toThrow("reading_requires_binding");
  });
});

describe("modelFailureReply: the model side never shares a shape with a book fact (KL audit J5)", () => {
  it("carries the classified reason, and the Finding when the books were already read", () => {
    const f = finding();
    expect(modelFailureReply("spend_ceiling")).toEqual({ kind: "could_not_answer", reason: "spend_ceiling" });
    expect(modelFailureReply("invalid_model_reply", f)).toEqual({ kind: "could_not_answer", reason: "invalid_model_reply", finding: f });
  });
});

// Founder, batch 4, 2026-09-19: a reading a role is not permitted to read
// never shares a shape with a books fact or a model failure -- it is its own
// kind, decided before the runner exists, and it never carries a Finding.
describe("notPermittedReply: a role refusal never claims the books were read", () => {
  // [REBUILT 2026-09-21: the gate is a policy table now, so a refusal names
  // WHY -- the data classes the role's row does not see, or the answer kind
  // it is not given -- instead of the one fixed reason owner_manager_only.]
  it("carries the refused reading's id and the classes withheld, with no finding key at all", () => {
    expect(notPermittedReply("vendors.active", ["suppliers"])).toEqual({ kind: "not_permitted", reason: "class_not_visible", readingId: "vendors.active", classes: ["suppliers"],
      line: "Refused for your role: this answer shows the house's supplier orders and vendors." });
  });

  // Founder, 2026-09-21, round 6, the meaning he approved, verbatim: "Money,
  // supplier prices and people data are refused with a one-line reason."
  it("every refusal carries one line naming each class it withholds -- never a bare not_permitted", () => {
    expect(classRefusalLine(["money"])).toBe("Refused for your role: this answer shows money (prices, supplier prices, costs, values, margins).");
    expect(classRefusalLine(["people"])).toBe("Refused for your role: this answer shows people data (the calendar, and anything about a person).");
    expect(classRefusalLine(["suppliers", "receiving", "money"])).toBe(
      "Refused for your role: this answer shows the house's supplier orders and vendors, receiving and money (prices, supplier prices, costs, values, margins).");
    for (const cls of DATA_CLASSES) {
      const { line } = notPermittedReply("orders.open", [cls]) as { line: string };
      expect(isRefusalLine(line)).toBe(true);
      expect(line).toContain(CLASS_LABEL[cls]);
    }
    for (const kind of ["reading", "model_knowledge"] as const) expect(isRefusalLine((answerKindNotPermittedReply(kind) as { line: string }).line)).toBe(true);
  });

  it("a class refusal must name at least one class", () => {
    expect(() => notPermittedReply("vendors.active", [])).toThrow();
  });

  it("an answer-kind refusal names the kind, and names a reading only when one was resolved", () => {
    expect(answerKindNotPermittedReply("model_knowledge")).toEqual({ kind: "not_permitted", reason: "answer_kind_not_permitted", answerKind: "model_knowledge",
      line: "Refused for your role: it is not given general-knowledge answers." });
    expect(answerKindNotPermittedReply("reading", "orders.open")).toEqual({ kind: "not_permitted", reason: "answer_kind_not_permitted", answerKind: "reading", readingId: "orders.open",
      line: "Refused for your role: it is not given answers from the house's books." });
  });
});

describe("isBoundReply: a wire boundary that must never call a tampered shape complete", () => {
  it("accepts a real reading reply, and re-derives the same binding rather than trusting focus verbatim", () => {
    const f = finding();
    expect(isBoundReply({ kind: "reading", finding: f, focus: [{ cellId: "cell-1" }] })).toBe(true);
  });

  it("refuses a reading reply whose focus no longer matches its own attached Finding", () => {
    const f = finding();
    expect(isBoundReply({ kind: "reading", finding: f, focus: [{ cellId: "cell-does-not-exist" }] })).toBe(false);
  });

  it("accepts a model_knowledge reply only with the exact minted source marker", () => {
    expect(isBoundReply(bindKnowledgeReply({ kind: "model_knowledge", text: "ok" }))).toBe(true);
    expect(isBoundReply({ kind: "model_knowledge", source: "model_knowledge", sourceLabel: "forged label", text: "ok" })).toBe(false);
  });

  it("accepts could_not_answer only with a known model-failure reason", () => {
    expect(isBoundReply({ kind: "could_not_answer", reason: "spend_ceiling" })).toBe(true);
    expect(isBoundReply({ kind: "could_not_answer", reason: "not_a_real_reason" })).toBe(false);
  });

  it("accepts a non-reading outcome kind with a string reason, and refuses an attached finding that is not shaped like one", () => {
    expect(isBoundReply({ kind: "not_in_your_books", reason: "empty_register" })).toBe(true);
    expect(isBoundReply({ kind: "not_in_your_books", reason: "empty_register", finding: { not: "a finding" } })).toBe(false);
  });

  it("refuses an unrecognised kind outright", () => {
    expect(isBoundReply({ kind: "made_up_kind", reason: "whatever" })).toBe(false);
    expect(isBoundReply(null)).toBe(false);
    expect(isBoundReply("a string")).toBe(false);
  });

  it("accepts not_permitted only for a real reading id, a named reason, real classes and no attached finding", () => {
    expect(isBoundReply(notPermittedReply("orders.open", ["suppliers"]))).toBe(true);
    expect(isBoundReply(answerKindNotPermittedReply("model_knowledge"))).toBe(true);
    expect(isBoundReply(answerKindNotPermittedReply("reading", "orders.open"))).toBe(true);
    // Each refused shape below carries a valid line, so it is refused for the
    // fault it names and not merely for lacking one.
    const line = "Refused for your role: this answer shows money.";
    expect(isBoundReply({ kind: "not_permitted", reason: "class_not_visible", readingId: "orders.open", classes: ["suppliers"], line })).toBe(true);
    expect(isBoundReply({ kind: "not_permitted", reason: "not_a_real_reason", readingId: "orders.open", line })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "owner_manager_only", readingId: "orders.open", line })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "class_not_visible", readingId: "not.a.real.reading", classes: ["money"], line })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "class_not_visible", readingId: "orders.open", classes: [], line })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "class_not_visible", readingId: "orders.open", classes: ["gossip"], line })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "class_not_visible", readingId: "orders.open", classes: ["suppliers"], finding: finding(), line })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "answer_kind_not_permitted", answerKind: "poetry", line })).toBe(false);
  });

  it("refuses a saved refusal with no one-line reason, an empty one, or one that runs over a line (round 6)", () => {
    const refusal = { kind: "not_permitted", reason: "class_not_visible", readingId: "orders.open", classes: ["suppliers"] };
    expect(isBoundReply(refusal)).toBe(false);
    expect(isBoundReply({ ...refusal, line: "   " })).toBe(false);
    expect(isBoundReply({ ...refusal, line: "Refused.\nAnd more." })).toBe(false);
    expect(isBoundReply({ kind: "not_permitted", reason: "answer_kind_not_permitted", answerKind: "reading" })).toBe(false);
  });
});

// Founder, 2026-09-21, round 6r: "J4 wins, hide size (Recommended)" and
// "Classify now, forecast=sales (Recommended)".
describe("round 6r replies: a withheld reason travels with its one line, never alone", () => {
  it("every Reading names its book and its empty line, each one short line", () => {
    for (const r of READING_CATALOGUE) {
      expect(isRefusalLine(couldNotReadLine(r.id))).toBe(true);
      expect(isRefusalLine(READING_BOOK[r.id].empty)).toBe(true);
    }
    expect(couldNotReadLine("orders.due_today")).toBe("Couldn't read the order book right now.");
    expect(READING_BOOK["orders.due_today"].empty).toBe("No orders recorded yet.");
  });

  it("staff: a failed read replies with the line and no reason; full detail keeps the reason", () => {
    const failed = finding({ outcome: "could_not_read", reason: "source_limit", rows: [] });
    const staff = findingReply(failed, "source_only");
    expect(staff).toMatchObject({ kind: "could_not_read", reason: "withheld_for_your_role", line: "Couldn't read the order book right now." });
    expect(JSON.stringify(staff)).not.toContain("source_limit");
    expect(isBoundReply(staff)).toBe(true);
    expect(findingReply(failed, "full")).toEqual({ kind: "could_not_read", reason: "source_limit", finding: failed });
  });

  it("staff: an empty register replies with its line and no zero cell", () => {
    const empty = finding({ outcome: "not_in_your_books", reason: "empty_register" });
    const staff = findingReply(empty, "source_only");
    expect(staff).toMatchObject({ kind: "not_in_your_books", reason: "empty_register", line: READING_BOOK["orders.open"].empty });
    expect((staff as { finding: Finding }).finding.rows).toEqual([]);
    expect(isBoundReply(staff)).toBe(true);
  });

  it("a runner that threw: staff get the line, owners and managers get query_failed", () => {
    expect(couldNotReadReply("full", "orders.lines")).toEqual({ kind: "could_not_read", reason: "query_failed" });
    const staff = couldNotReadReply("source_only", "orders.lines");
    expect(staff).toEqual({ kind: "could_not_read", reason: "withheld_for_your_role", line: "Couldn't read the order book right now." });
    expect(isBoundReply(staff)).toBe(true);
    expect(couldNotReadReply("source_only")).toMatchObject({ line: "Couldn't read the house's records right now." });
  });

  it("refuses a saved withheld reason without its line, on another kind, or with a line over one line", () => {
    expect(isBoundReply({ kind: "could_not_read", reason: "withheld_for_your_role" })).toBe(false);
    expect(isBoundReply({ kind: "not_in_your_books", reason: "withheld_for_your_role", line: "No orders recorded yet." })).toBe(false);
    expect(isBoundReply({ kind: "could_not_read", reason: "withheld_for_your_role", line: "Couldn't.\nread" })).toBe(false);
    expect(isBoundReply({ kind: "could_not_read", reason: "query_failed", line: "" })).toBe(false);
  });

  it("an unbuilt question refused for its class: a real classified question, never a Reading id too", () => {
    const refusal = unbuiltNotPermittedReply("landed_cost", ["money"]);
    expect(refusal).toEqual({ kind: "not_permitted", reason: "class_not_visible", questionClass: "landed_cost", classes: ["money"],
      line: classRefusalLine(["money"]) });
    expect(isBoundReply(refusal)).toBe(true);
    expect(isBoundReply({ ...refusal, questionClass: "lot_expiry" })).toBe(false);
    expect(isBoundReply({ ...refusal, questionClass: "unrecognized" })).toBe(false);
    expect(isBoundReply({ ...refusal, readingId: "orders.open" })).toBe(false);
    expect(() => unbuiltNotPermittedReply("forecast", [])).toThrow();
  });
});
