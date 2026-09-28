import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BoundAskService, ModelPhaseFailure, parseReadingPick } from "./bound-ask.service";
import { ModelSpendCeilingError } from "../common/model-client/model-client.service";
import { ReadingFolio } from "../ask-readings/reading-folio.store";
import { BoundAskDto } from "./dto/bound-ask.dto";

// KL audit J5 (the regression) and J7 (zero specs on this layer): a model
// failure must never render as `could_not_read` / `query_failed`, the shape
// this repository already uses for a SOURCE that did not answer. Each cause
// -- an outage, the spend ceiling, an answer that failed validation -- is a
// different `could_not_answer` reason, and the pick step never lets the model
// invent a row or a date.

const HOUSE = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
// Every test above this file's role-gate `describe` block is about DISPOSITION
// routing or the launch/validation gates, none of which a role can affect --
// they all submit as OWNER so the new required parameter changes nothing
// about what they were already proving.
const OWNER = "owner";

function pendingFolio(overrides: Partial<ReadingFolio> = {}): ReadingFolio {
  return {
    id: "folio-1", restaurant_id: HOUSE, user_id: USER, request_id: "req-1",
    correlation_id: "folio-1", origin: "page", utterance: "how many bottles are open",
    status: "pending", reading_id: null, reading_version: null, reading_args: {},
    finding: null, reply_kind: null, answer: null, failure_reason: null,
    proposal_id: null, previous_folio_id: null, created_at: "2026-09-17T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

function modelTextReply(json: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

function harness(configValues: Record<string, string> = { ASK_LAUNCHED: "true" }) {
  const call = jest.fn();
  const modelClient = { call } as any;
  const nfVerdicts = { record: jest.fn() } as any;
  const begin = jest.fn();
  const finish = jest.fn(async (folio: ReadingFolio, answer: any, finding?: any, failureReason?: string) => ({
    ...folio, status: failureReason ? "failed" : "complete", answer, finding: finding ?? null, failure_reason: failureReason ?? null,
  }));
  const folios = { begin, finish } as any;
  // Spied, not a bare arrow: the role-gate tests below prove a REFUSED
  // reading never reaches the runner by asserting this was never called --
  // the same "never touched" property the not_built / no_reading_matched /
  // model_knowledge paths already had, extended to the new gate.
  const getClient = jest.fn(() => ({}));
  const db = { getClient } as any;
  // Every test below exercises submit()'s real behaviour, so the harness
  // defaults the launch gate ON; the gate itself is proven OFF-by-default
  // separately, below, with no override.
  const config = new ConfigService(configValues);
  const service = new BoundAskService(db, config, modelClient, nfVerdicts, folios);
  return { service, call, begin, finish, getClient };
}

function dto(overrides: Partial<BoundAskDto> = {}): BoundAskDto {
  return { requestId: "req-1", utterance: "how many bottles are open", origin: "page", ...overrides } as BoundAskDto;
}

// The page and palette entry that would call this route do not exist yet
// (ADR 0145 row 33 defers /ask itself; this lane was told not to build it).
// A route a product surface cannot yet reach is still reachable by anyone
// holding a valid JWT, and every hit is a paid model call, so the route must
// refuse before it spends anything -- not merely be unlinked.
describe("BoundAskService.submit: refuses cleanly while /ask has no caller", () => {
  it("refuses with no ASK_LAUNCHED set at all -- production carries none today", async () => {
    const { service, begin, call } = harness({});
    await expect(service.submit(HOUSE, USER, OWNER, dto())).rejects.toMatchObject({ status: 503 });
    expect(begin).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses on any value short of the exact string \"true\"", async () => {
    for (const value of ["false", "TRUE", "1", "yes"]) {
      const { service, begin, call } = harness({ ASK_LAUNCHED: value });
      await expect(service.submit(HOUSE, USER, OWNER, dto())).rejects.toMatchObject({ status: 503 });
      expect(begin).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("a request that would otherwise be malformed is still refused as unlaunched first, never as a 400", async () => {
    const { service, begin } = harness({});
    await expect(service.submit(HOUSE, USER, OWNER, dto({ utterance: "   " }))).rejects.toMatchObject({ status: 503 });
    expect(begin).not.toHaveBeenCalled();
  });

  it("submits normally once ASK_LAUNCHED=true, proving the gate is the only thing refusing it above", async () => {
    const { service, begin } = harness({ ASK_LAUNCHED: "true" });
    begin.mockResolvedValue({ created: false, folio: pendingFolio({ status: "complete" }) });
    const result = await service.submit(HOUSE, USER, OWNER, dto());
    expect(result.status).toBe("complete");
  });
});

describe("BoundAskService.submit: request validation and idempotent replay", () => {
  it("refuses a blank utterance before touching the folio store", async () => {
    const { service, begin } = harness();
    await expect(service.submit(HOUSE, USER, OWNER, dto({ utterance: "   " }))).rejects.toBeInstanceOf(BadRequestException);
    expect(begin).not.toHaveBeenCalled();
  });

  it("refuses a readingId that is not in the catalogue", async () => {
    const { service } = harness();
    await expect(service.submit(HOUSE, USER, OWNER, dto({ readingId: "not.a.real.reading" }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a replayed request id never calls the model or finishes the folio again", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: false, folio: pendingFolio({ status: "complete" }) });
    const result = await service.submit(HOUSE, USER, OWNER, dto());
    expect(result.status).toBe("complete");
    expect(call).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("BoundAskService.submit: disposition routing", () => {
  it("an unbuilt question class is answered not_built with no compose call", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "forecast" }));
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(call).toHaveBeenCalledTimes(1); // the pick call only
    expect(finish.mock.calls[0][1]).toEqual({ kind: "not_built", reason: "unimplemented_question" });
  });

  it("an unrecognised utterance is answered no_reading_matched", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "unrecognized" }));
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(finish.mock.calls[0][1]).toEqual({ kind: "no_reading_matched", reason: "no_matching_question" });
  });

  it("general_knowledge routes to the knowledge composer and carries the immutable source marker", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "general_knowledge" }));
    call.mockResolvedValueOnce(modelTextReply({ kind: "model_knowledge", text: "General wine knowledge." }));
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(call).toHaveBeenCalledTimes(2);
    expect(finish.mock.calls[0][1]).toEqual({
      kind: "model_knowledge", source: "model_knowledge", sourceLabel: "Not from the house's books", text: "General wine knowledge.",
    });
  });

  it("every model call passes the first-attempt spend gate and disables transport retry, whichever disposition runs (ADR 0146 / KL audit J6)", async () => {
    const { service, begin, call } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "general_knowledge" }));
    call.mockResolvedValueOnce(modelTextReply({ kind: "model_knowledge", text: "ok" }));
    await service.submit(HOUSE, USER, OWNER, dto());
    for (const [options] of call.mock.calls) {
      expect(options.gateFirstAttempt).toBe(true);
      expect(options.retry).toBe(false);
    }
  });
});

describe("BoundAskService.submit: model-side failures are never a books claim (KL audit J5)", () => {
  it("a spend-ceiling refusal on the PICK call is could_not_answer/spend_ceiling, not could_not_read/query_failed", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockRejectedValueOnce(new ModelSpendCeilingError("over the daily allowance"));
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(finish.mock.calls[0][1]).toEqual({ kind: "could_not_answer", reason: "spend_ceiling" });
    expect(finish.mock.calls[0][3]).toBe("spend_ceiling"); // failureReason persisted too
  });

  it("a transport failure or timeout on the model call is model_unavailable, not query_failed", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(finish.mock.calls[0][1]).toEqual({ kind: "could_not_answer", reason: "model_unavailable" });
  });

  it("a reply that fails shape validation is invalid_model_reply, not a silent 200", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "general_knowledge" }));
    call.mockResolvedValueOnce(modelTextReply({ kind: "model_knowledge", text: "" })); // fails bindKnowledgeReply
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(finish.mock.calls[0][1]).toEqual({ kind: "could_not_answer", reason: "invalid_model_reply" });
  });

  it("an invalid PICK reply is also invalid_model_reply, and the utterance is never sent to a second call", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "not-a-real-class" }));
    await service.submit(HOUSE, USER, OWNER, dto());
    expect(call).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0][1]).toEqual({ kind: "could_not_answer", reason: "invalid_model_reply" });
  });
});

// Founder, batch 4, 2026-09-19, his words: "do not give money or sensitive
// incentives like sales etc to the staff, maybe we should exclude staff from
// this equation" -> price, vendor, open-order and sales readings are owner
// and manager only, ENFORCED ON THE SERVER PER READING. Proven here at the
// dispatch boundary (BoundAskService.submit); the exhaustive per-reading,
// per-role matrix is proven in reading-catalogue.spec.ts.
//
// FAILING BEFORE THIS CHANGE: `submit` took no role parameter at all -- every
// caller holding a valid JWT reached every one of the fifteen readings,
// staff included. Restoring `submit(restaurantId, userId, input)` (drop the
// `role` argument) and removing the `isReadingAllowedForRole` branch
// reproduces that: a staff caller asking about "orders.open" reaches
// `ReadingRunner` exactly like an owner does.
describe("BoundAskService.submit: the role gate on price/vendor/open-order/sales readings (founder, batch 4, 2026-09-19)", () => {
  it("staff asking a restricted reading (orders.open) is refused not_permitted, and the runner never touches the DB", async () => {
    const { service, begin, call, finish, getClient } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "orders.open" }));
    await service.submit(HOUSE, USER, "staff", dto());
    expect(finish.mock.calls[0][1]).toEqual({ kind: "not_permitted", reason: "owner_manager_only", readingId: "orders.open" });
    expect(getClient).not.toHaveBeenCalled(); // zero DB cost for a refused reading
    expect(call).toHaveBeenCalledTimes(1); // the pick call only -- no compose call either
  });

  it("owner asking the same restricted reading is NOT refused -- the gate lets it reach the runner", async () => {
    const { service, begin, call, getClient } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "orders.open" }));
    await service.submit(HOUSE, USER, "owner", dto());
    expect(getClient).toHaveBeenCalled(); // reached ReadingRunner construction
  });

  it("manager asking the same restricted reading is also NOT refused", async () => {
    const { service, begin, call, getClient } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "orders.open" }));
    await service.submit(HOUSE, USER, "manager", dto());
    expect(getClient).toHaveBeenCalled();
  });

  it("a null role (no membership row resolved) is refused a restricted reading -- fails closed, not open", async () => {
    const { service, begin, call, finish, getClient } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "vendors.active" }));
    await service.submit(HOUSE, USER, null, dto());
    expect(finish.mock.calls[0][1]).toEqual({ kind: "not_permitted", reason: "owner_manager_only", readingId: "vendors.active" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("staff asking an OPEN reading (inventory.position) is unaffected -- the gate never widened to readings nobody asked to restrict", async () => {
    const { service, begin, call, getClient } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "inventory.position" }));
    await service.submit(HOUSE, USER, "staff", dto());
    expect(getClient).toHaveBeenCalled(); // reached the runner, exactly like before this change
  });

  it("the gate applies identically when the page names the reading directly (readingId on the request), skipping the pick call entirely", async () => {
    const { service, begin, call, finish, getClient } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio({ reading_id: "sales.check_activity" }) });
    await service.submit(HOUSE, USER, "staff", dto({ readingId: "sales.check_activity" }));
    expect(call).not.toHaveBeenCalled(); // no pick call at all for a page-chosen reading
    expect(finish.mock.calls[0][1]).toEqual({ kind: "not_permitted", reason: "owner_manager_only", readingId: "sales.check_activity" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("a role refusal is folio-recorded as complete, not failed -- the system worked correctly, it did not error", async () => {
    const { service, begin, call, finish } = harness();
    begin.mockResolvedValue({ created: true, folio: pendingFolio() });
    call.mockResolvedValueOnce(modelTextReply({ questionClass: "receipts.verified_line" }));
    await service.submit(HOUSE, USER, "staff", dto());
    expect(finish.mock.calls[0][3]).toBeUndefined(); // failureReason
  });
});

describe("ModelPhaseFailure", () => {
  it("carries the reason as both its message and its typed field", () => {
    const err = new ModelPhaseFailure("spend_ceiling");
    expect(err.reason).toBe("spend_ceiling");
    expect(err.message).toBe("spend_ceiling");
    expect(err.name).toBe("ModelPhaseFailure");
  });
});

describe("parseReadingPick: the model chooses a CLASS, never a row or a date", () => {
  const utterance = "how many bottles of Barolo were open between 2026-09-01 and 2026-09-10";

  it("accepts a known class with spans copied verbatim from the utterance", () => {
    const pick = parseReadingPick({ questionClass: "inventory.position", subjectText: "Barolo", from: "2026-09-01", to: "2026-09-10" }, utterance);
    expect(pick).toEqual({ questionClass: "inventory.position", args: { subjectText: "Barolo", from: "2026-09-01", to: "2026-09-10" } });
  });

  it("omits an unspecified date rather than inventing one", () => {
    const pick = parseReadingPick({ questionClass: "orders.open" }, utterance);
    expect(pick.args).toEqual({});
  });

  it("refuses an unknown question class", () => {
    expect(() => parseReadingPick({ questionClass: "made_up_class" }, utterance)).toThrow("invalid_reading_pick");
  });

  it("refuses an unknown key on the pick shape", () => {
    expect(() => parseReadingPick({ questionClass: "orders.open", extraKey: true }, utterance)).toThrow("invalid_reading_pick");
  });

  it("refuses a subject or date the model invented -- not a literal span of the utterance", () => {
    expect(() => parseReadingPick({ questionClass: "inventory.position", subjectText: "Chardonnay" }, utterance)).toThrow("invented_reading_argument");
    expect(() => parseReadingPick({ questionClass: "orders.late_deliveries", from: "2026-01-01" }, utterance)).toThrow("invented_reading_argument");
  });

  it("refuses a date span over 10 characters even if it appears in the utterance", () => {
    const longDate = "2026-09-01T00:00:00Z";
    expect(() => parseReadingPick({ questionClass: "orders.late_deliveries", from: longDate }, `window starting ${longDate}`)).toThrow("invented_reading_argument");
  });
});
