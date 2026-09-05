/**
 * The ceremony: who may admit a hand-carried price book, and what a
 * confirmation is worth.
 *
 * The cases that matter are the ones where the honest answer is uncomfortable:
 *
 *   * the uploader admitting their own book when the jurisdiction has nobody
 *     else — allowed, because ten of fifteen houses on this estate have one
 *     owner-or-manager or none, but recorded as `same_person` with a stated
 *     reason and never as a second pair of eyes;
 *   * the same act when somebody else COULD have looked — refused until the
 *     escalation has fired, so the wait is bounded by a clock rather than by a
 *     colleague's inbox;
 *   * the pool being UNREADABLE — refused, because "we could not tell whether
 *     anybody else exists" must not be spent as "nobody else exists";
 *   * the escalation sweep — which tells people and admits nothing.
 */

import { createHash } from "crypto";
import { ForbiddenException } from "@nestjs/common";
import {
  ADMIT_ACTION,
  ESCALATION_HOURS,
  REOPEN_ACTION,
  PriceIndexReviewService,
  type ReviewRow,
} from "./price-index-review.service";

const SHA = "a".repeat(64);
const UPLOADER = "user-uploader";
const OTHER = "user-other";
const HOUSE = "house-1";

function heldReview(over: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "review-1",
    sourceKey: "michigan-lcc-price-book",
    state: "US-MI",
    fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
    fileSha256: SHA,
    editionDate: "2025-08-03",
    rowsWritten: 18,
    uploadedBy: UPLOADER,
    uploadedByRestaurantId: HOUSE,
    uploadedAt: "2026-09-05T00:00:00.000Z",
    tier: "second_pair_of_eyes",
    tierReasons: ["first_book"],
    tierNote: "This is the first edition of this book the register has ever held.",
    status: "pending",
    confirmedBy: null,
    confirmedAt: null,
    confirmationEvidence: null,
    confirmationReason: null,
    refusedBy: null,
    refusedAt: null,
    refusalReason: null,
    escalatedAt: null,
    reopenedAt: null,
    reopenedBy: null,
    reopenReason: null,
    decisionHistory: null,
    ...over,
  };
}

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

/**
 * A PostgREST builder mock that records what was asked and answers through one
 * handler. Every method the review service chains is here; anything it starts
 * chaining later fails loudly rather than silently returning nothing, which is
 * the whole point of a mock in a file about absences.
 */
function makeDb(
  answer: (call: Call) => { data?: unknown; error?: unknown; count?: number },
) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const b: Record<string, unknown> = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) call.op = `${call.op}:count`;
          return b;
        },
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return b;
        },
        update(payload: unknown) {
          call.op = "update";
          call.payload = payload;
          return b;
        },
        eq(c: string, v: unknown) {
          call.filters.push(["eq", c, v]);
          return b;
        },
        in(c: string, v: unknown) {
          call.filters.push(["in", c, v]);
          return b;
        },
        not(c: string, _o: string, v: unknown) {
          call.filters.push(["not", c, v]);
          return b;
        },
        is(c: string, v: unknown) {
          call.filters.push(["is", c, v]);
          return b;
        },
        lt(c: string, v: unknown) {
          call.filters.push(["lt", c, v]);
          return b;
        },
        order() {
          return b;
        },
        limit() {
          return b;
        },
        maybeSingle() {
          const r = answer(call);
          return Promise.resolve({
            data: r.data ?? null,
            error: r.error ?? null,
          });
        },
        single() {
          const r = answer(call);
          return Promise.resolve({
            data: r.data ?? null,
            error: r.error ?? null,
          });
        },
        then(resolve: (v: unknown) => unknown) {
          const r = answer(call);
          return Promise.resolve({
            data: r.data ?? null,
            error: r.error ?? null,
            count: r.count ?? null,
          }).then(resolve);
        },
      };
      return b;
    },
  };
  return { db: { client } as never, calls };
}

/** The estate as the census measured it: houses in a state, people in them. */
function estate(opts: {
  people: Array<{ user_id: string; restaurant_id: string; role: string }>;
  accessFails?: boolean;
  reviewAfterUpdate?: ReviewRow;
  updateReturnsNothing?: boolean;
  postingsUpdated?: number;
}) {
  return (call: Call) => {
    if (call.table === "restaurants") {
      return {
        data: [
          { id: HOUSE, name: "ADMIN ROOM", state_province: "Michigan", country: "United States" },
        ],
      };
    }
    if (call.table === "user_restaurant_access") {
      if (opts.accessFails) return { error: { message: "connection reset" } };
      return {
        data: opts.people.map((p) => ({ ...p, is_active: true })),
      };
    }
    if (call.table === "price_index_upload_reviews" && call.op === "update") {
      if (opts.updateReturnsNothing) return { data: [] };
      const r = opts.reviewAfterUpdate;
      return {
        data: [
          {
            id: r?.id ?? "review-1",
            source_key: "michigan-lcc-price-book",
            state: "US-MI",
            file_name: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
            file_sha256: SHA,
            edition_date: "2025-08-03",
            rows_written: 18,
            uploaded_by: UPLOADER,
            uploaded_by_restaurant_id: HOUSE,
            uploaded_at: "2026-09-05T00:00:00.000Z",
            tier: "second_pair_of_eyes",
            tier_reasons: ["first_book"],
            tier_note: "first book",
            status: "confirmed",
            ...(call.payload as Record<string, unknown>),
          },
        ],
      };
    }
    if (call.table === "price_index_postings") {
      return {
        data: Array.from({ length: opts.postingsUpdated ?? 18 }, (_, i) => ({
          id: `p-${i}`,
        })),
      };
    }
    return { data: [] };
  };
}

function seals(over: Partial<Record<string, unknown>> = {}) {
  return {
    issue: jest.fn().mockResolvedValue({
      challenge: "tok",
      expiresAt: "2026-09-05T00:03:00.000Z",
      action: ADMIT_ACTION,
    }),
    redeem: jest.fn().mockResolvedValue({ sealId: "seal-1" }),
    ...over,
  } as never;
}

function notifications() {
  return {
    persistForRestaurant: jest.fn().mockResolvedValue({ inserted: 1, ids: ["n"] }),
  };
}

describe("who may admit a book", () => {
  it("lets a DIFFERENT owner or manager admit it, and stamps the rows", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const notes = notifications();
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notes as never, seal);

    const out = await svc.confirm(
      heldReview(),
      { userId: OTHER, restaurantId: HOUSE },
      { challenge: "tok" },
    );

    expect(out.review.status).toBe("confirmed");
    expect(out.review.confirmationEvidence).toBe("attested");
    expect(out.postingsAdmitted).toBe(18);
    expect(out.sentence).toContain("Admitted by a second owner or manager.");
    expect((seal as never as { redeem: jest.Mock }).redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "price_index_upload",
        subjectId: "review-1",
        action: ADMIT_ACTION,
        challenge: "tok",
      }),
    );
  });

  it("records byte_match ONLY when the confirmer's own bytes agree", async () => {
    const bytes = Buffer.from("the commission's workbook").toString("base64");
    const sha = createHash("sha256")
      .update(Buffer.from(bytes, "base64"))
      .digest("hex");
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());

    const out = await svc.confirm(
      heldReview({ fileSha256: sha }),
      { userId: OTHER, restaurantId: HOUSE },
      { challenge: "tok", fileBase64: bytes },
    );
    expect(out.review.confirmationEvidence).toBe("byte_match");
    expect(out.sentence).toContain("fetched independently and match");
  });

  it("refuses when the confirmer's bytes are NOT the uploaded bytes", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notifications() as never, seal);

    await expect(
      svc.confirm(
        heldReview(),
        { userId: OTHER, restaurantId: HOUSE },
        { challenge: "tok", fileBase64: Buffer.from("something else").toString("base64") },
      ),
    ).rejects.toThrow(/not the file that was uploaded/);
    // The seal is NOT spent on a refusal: a seal a person is then told meant
    // nothing teaches them the seal is decoration.
    expect((seal as never as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
  });

  it("refuses the UPLOADER while somebody else could still look", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "manager" }] }),
    );
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.confirm(
        heldReview(),
        { userId: UPLOADER, restaurantId: HOUSE },
        { challenge: "tok", reason: "I checked it" },
      ),
    ).rejects.toThrow(
      new RegExp(`a second pair of eyes has to be a different pair.*${ESCALATION_HOURS} hours`),
    );
  });

  it("lets the uploader admit their own book where the jurisdiction has NOBODY else", async () => {
    const { db } = makeDb(estate({ people: [] }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const out = await svc.confirm(
      heldReview(),
      { userId: UPLOADER, restaurantId: HOUSE },
      { challenge: "tok", reason: "I am the only manager in Michigan and I re-downloaded it." },
    );
    expect(out.review.confirmationEvidence).toBe("same_person");
    expect(out.sentence).toContain("not a second pair of eyes");
    expect(out.sentence).toContain("no second owner or manager");
  });

  it("asks the lone person for a REASON rather than taking the click", async () => {
    const { db } = makeDb(estate({ people: [] }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.confirm(
        heldReview(),
        { userId: UPLOADER, restaurantId: HOUSE },
        { challenge: "tok" },
      ),
    ).rejects.toThrow(/say why, in a sentence/);
  });

  it("opens the override to the uploader once the escalation has fired", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const out = await svc.confirm(
      heldReview({ escalatedAt: "2026-09-06T00:00:00.000Z" }),
      { userId: UPLOADER, restaurantId: HOUSE },
      { challenge: "tok", reason: "Nobody acted for a day and the quarter has turned." },
    );
    expect(out.review.confirmationEvidence).toBe("same_person");
    expect(out.sentence).toContain("after the escalation");
  });

  it("refuses everything when the POOL cannot be read — unknown is not nobody", async () => {
    const { db } = makeDb(estate({ people: [], accessFails: true }));
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notifications() as never, seal);
    await expect(
      svc.confirm(
        heldReview(),
        { userId: UPLOADER, restaurantId: HOUSE },
        { challenge: "tok", reason: "go on" },
      ),
    ).rejects.toThrow(/This is unknown, not nobody/);
    expect((seal as never as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
  });

  it("refuses a person whose houses are not in the jurisdiction", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.confirm(
        heldReview(),
        { userId: "user-stranger", restaurantId: "house-elsewhere" },
        { challenge: "tok" },
      ),
    ).rejects.toThrow(/Your houses are not in it/);
  });

  it("refuses a book two requests decided at once", async () => {
    const { db } = makeDb(
      estate({
        people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }],
        updateReturnsNothing: true,
      }),
    );
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.confirm(
        heldReview(),
        { userId: OTHER, restaurantId: HOUSE },
        { challenge: "tok" },
      ),
    ).rejects.toThrow(/Exactly one decision runs per book/);
  });

  it("will not decide a book that is already decided", async () => {
    const { db } = makeDb(estate({ people: [] }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.confirm(
        heldReview({ status: "stood", tier: "routine" }),
        { userId: OTHER, restaurantId: HOUSE },
        { challenge: "tok" },
      ),
    ).rejects.toThrow(/it was routine, and nobody was asked to confirm it/);
  });
});

describe("refusing a book", () => {
  it("will not refuse without a reason the uploader can act on", async () => {
    const { db } = makeDb(estate({ people: [] }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.refuse(heldReview(), { userId: UPLOADER, restaurantId: HOUSE }, "   "),
    ).rejects.toThrow(/A refusal names its reason/);
  });

  it("records the person and the reason", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const notes = notifications();
    const svc = new PriceIndexReviewService(db, notes as never, seals());
    const out = await svc.refuse(
      heldReview(),
      { userId: OTHER, restaurantId: HOUSE },
      "This is the 2024 book renamed.",
    );
    expect(out.refusedBy).toBe(OTHER);
    expect(out.refusalReason).toBe("This is the 2024 book renamed.");
    expect(notes.persistForRestaurant).toHaveBeenCalled();
  });
});

describe("the escalation sweep", () => {
  const NOW = new Date("2026-09-07T00:00:00.000Z");

  function pendingRow() {
    return {
      id: "review-1",
      source_key: "michigan-lcc-price-book",
      state: "US-MI",
      file_name: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
      file_sha256: SHA,
      edition_date: "2025-08-03",
      rows_written: 18,
      uploaded_by: UPLOADER,
      uploaded_by_restaurant_id: HOUSE,
      uploaded_at: "2026-09-05T00:00:00.000Z",
      tier: "second_pair_of_eyes",
      tier_reasons: ["first_book"],
      tier_note: "first book",
      status: "pending",
    };
  }

  it("tells people again and stamps the book, and admits NOTHING", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const { db } = makeDb((call) => {
      if (call.table === "price_index_upload_reviews" && call.op === "select") {
        return { data: [pendingRow()] };
      }
      if (call.table === "price_index_upload_reviews" && call.op === "update") {
        writes.push(call.payload as Record<string, unknown>);
        return { data: [] };
      }
      if (call.table === "restaurants") {
        return {
          data: [
            { id: HOUSE, name: "ADMIN ROOM", state_province: "MI", country: "United States" },
          ],
        };
      }
      if (call.table === "user_restaurant_access") {
        return { data: [{ user_id: OTHER, restaurant_id: HOUSE, role: "owner", is_active: true }] };
      }
      return { data: [] };
    });
    const notes = notifications();
    const svc = new PriceIndexReviewService(db, notes as never, seals());

    const out = await svc.escalationSweep(NOW);

    expect(out.escalated).toBe(1);
    expect(out.withheldReason).toBeNull();
    expect(writes).toHaveLength(1);
    // The ONLY column an escalation writes. A status here would be a clock
    // approving a book, which is silence read as consent.
    expect(Object.keys(writes[0])).toEqual(["escalated_at"]);
    const message = String(
      (notes.persistForRestaurant.mock.calls[0][1] as { message: string }).message,
    );
    expect(message).toContain("Waiting does not admit it");
  });

  it("says why it is quiet rather than reporting a silent zero", async () => {
    const { db } = makeDb(() => ({ data: [] }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const out = await svc.escalationSweep(NOW);
    expect(out.escalated).toBe(0);
    expect(out.withheldReason).toContain(`${ESCALATION_HOURS} hours`);
  });

  it("never reports a failed read as an empty one", async () => {
    const { db } = makeDb(() => ({ error: { message: "connection reset" } }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const out = await svc.escalationSweep(NOW);
    expect(out.escalated).toBe(0);
    expect(out.withheldReason).toContain("This is unknown, not empty.");
  });
});

describe("the baseline the next edition is weighed against", () => {
  it("is UNREADABLE rather than absent when the read fails", async () => {
    const { db } = makeDb(() => ({ error: { message: "connection reset" } }));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const out = await svc.baselineFor("michigan-lcc-price-book");
    expect(out.readFailed).toBe(true);
    expect(out.baseline).toBeNull();
  });

  it("never takes a REFUSED book as the baseline", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const { db } = makeDb((call) => {
      filters.push(...call.filters);
      return { data: [] };
    });
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await svc.baselineFor("michigan-lcc-price-book");
    expect(filters).toContainEqual(["in", "status", ["stood", "confirmed"]]);
  });
});

describe("the pool is the JURISDICTION, not the house", () => {
  it("counts owners and managers of every house in the state, once each", async () => {
    const { db } = makeDb((call) => {
      if (call.table === "restaurants") {
        return {
          data: [
            { id: "h1", name: "ADMIN ROOM", state_province: "Michigan", country: "United States" },
            { id: "h2", name: "ALDEMIR", state_province: "MI", country: "United States" },
            { id: "h3", name: "YAREN", state_province: "IL", country: "United States" },
          ],
        };
      }
      if (call.table === "user_restaurant_access") {
        return {
          data: [
            { user_id: "u1", restaurant_id: "h1", role: "owner", is_active: true },
            { user_id: "u1", restaurant_id: "h2", role: "manager", is_active: true },
            { user_id: "u2", restaurant_id: "h2", role: "manager", is_active: true },
          ],
        };
      }
      return { data: [] };
    });
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const pool = await svc.admittersFor("US-MI");
    expect(pool.housesInJurisdiction).toBe(2);
    expect(pool.people.map((p) => p.userId)).toEqual(["u1", "u2"]);
    expect(pool.readFailed).toBe(false);
  });

  it("leaves the uploader out of their own pool", async () => {
    const { db } = makeDb(
      estate({ people: [{ user_id: UPLOADER, restaurant_id: HOUSE, role: "owner" }] }),
    );
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const pool = await svc.admittersFor("US-MI", UPLOADER);
    expect(pool.people).toEqual([]);
    expect(pool.readFailed).toBe(false);
  });
});

/**
 * Reopening a refusal (ADR 0128 Q3; the founder: *"Owner reopens with a stated
 * reason"*).
 *
 * Four rules, and every one of them is a refusal in the ordinary case:
 * only an OWNER, never the refuser, once per set of bytes, and never without a
 * reason. The fifth is what happens to the row — the refusal MOVES into the
 * history rather than being deleted, because the CHECK that makes a refusal
 * complete forces the three columns to be cleared.
 */
function refusedReview(over: Partial<ReviewRow> = {}): ReviewRow {
  return heldReview({
    status: "refused",
    refusedBy: OTHER,
    refusedAt: "2026-09-05T06:00:00.000Z",
    refusalReason: "I think this is the 2024 book renamed.",
    ...over,
  });
}

/** The estate with named roles, so owner-only can actually be tested. */
function estateWithRoles(people: Array<[string, string]>) {
  return (call: Call) => {
    if (call.table === "restaurants") {
      return {
        data: [
          {
            id: HOUSE,
            name: "ADMIN ROOM",
            state_province: "Michigan",
            country: "United States",
          },
        ],
      };
    }
    if (call.table === "user_restaurant_access") {
      return {
        data: people.map(([user_id, role]) => ({
          user_id,
          restaurant_id: HOUSE,
          role,
          is_active: true,
        })),
      };
    }
    if (call.table === "price_index_upload_reviews" && call.op === "update") {
      return {
        data: [
          {
            id: "review-1",
            source_key: "michigan-lcc-price-book",
            state: "US-MI",
            file_name: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
            file_sha256: SHA,
            edition_date: "2025-08-03",
            rows_written: 18,
            uploaded_by: UPLOADER,
            uploaded_by_restaurant_id: HOUSE,
            uploaded_at: "2026-09-05T00:00:00.000Z",
            tier: "second_pair_of_eyes",
            tier_reasons: ["first_book"],
            tier_note: "first book",
            ...(call.payload as Record<string, unknown>),
          },
        ],
      };
    }
    return { data: [] };
  };
}

describe("reopening a refused book", () => {
  const OWNER = "user-owner";

  it("lets an OWNER who did not refuse it put it back, under the tier it was in", async () => {
    const { db, calls } = makeDb(
      estateWithRoles([
        [OWNER, "owner"],
        [OTHER, "manager"],
      ]),
    );
    const notes = notifications();
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notes as never, seal);

    const out = await svc.reopen(
      refusedReview(),
      { userId: OWNER, restaurantId: HOUSE },
      { reason: "The Commission republished the same edition; the refusal was mine to undo.", challenge: "tok" },
    );

    expect(out.review.status).toBe("pending");
    // Nothing is re-judged.
    expect(out.review.tier).toBe("second_pair_of_eyes");
    expect(out.review.tierReasons).toEqual(["first_book"]);
    expect(out.sentence).toContain(`${ESCALATION_HOURS}-hour hold starts from now`);

    const update = calls.find(
      (c) => c.table === "price_index_upload_reviews" && c.op === "update",
    );
    const payload = update?.payload as Record<string, unknown>;
    // The refusal is CLEARED on the row and KEPT in the history.
    expect(payload.refused_by).toBeNull();
    expect(payload.refusal_reason).toBeNull();
    // The clock restarts: a book already past its hold must not come back
    // instantly self-admittable.
    expect(payload.escalated_at).toBeNull();
    const history = payload.decision_history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      decision: "refused",
      by: OTHER,
      reason: "I think this is the 2024 book renamed.",
      supersededBy: OWNER,
    });
    // Its OWN act, not a second `admit`.
    expect((seal as never as { redeem: jest.Mock }).redeem).toHaveBeenCalledWith(
      expect.objectContaining({ action: REOPEN_ACTION, subjectKind: "price_index_upload" }),
    );
    expect(ADMIT_ACTION).not.toBe(REOPEN_ACTION);
  });

  it("refuses the person who refused it", async () => {
    const { db } = makeDb(estateWithRoles([[OTHER, "owner"]]));
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notifications() as never, seal);
    await expect(
      svc.reopen(
        refusedReview({ refusedBy: OTHER }),
        { userId: OTHER, restaurantId: HOUSE },
        { reason: "on reflection", challenge: "tok" },
      ),
    ).rejects.toThrow(/you cannot be the one who overrides that refusal/);
    expect((seal as never as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
  });

  it("refuses a MANAGER, however senior their house", async () => {
    const { db } = makeDb(estateWithRoles([["user-mgr", "manager"]]));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.reopen(
        refusedReview(),
        { userId: "user-mgr", restaurantId: HOUSE },
        { reason: "I disagree", challenge: "tok" },
      ),
    ).rejects.toThrow(/overridden by an OWNER.*You are a manager there/s);
  });

  it("remembers a person as an OWNER when they are a manager elsewhere", async () => {
    // The dedupe used to keep whichever row came back first, so an owner of one
    // Michigan house who manages another could be refused their own privilege
    // on a coin flip.
    const { db } = makeDb((call: Call) => {
      if (call.table === "restaurants") {
        return {
          data: [
            { id: "h1", name: "A", state_province: "MI", country: "United States" },
            { id: "h2", name: "B", state_province: "Michigan", country: "United States" },
          ],
        };
      }
      if (call.table === "user_restaurant_access") {
        return {
          data: [
            { user_id: OWNER, restaurant_id: "h1", role: "manager", is_active: true },
            { user_id: OWNER, restaurant_id: "h2", role: "owner", is_active: true },
          ],
        };
      }
      return { data: [] };
    });
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    const pool = await svc.admittersFor("US-MI");
    expect(pool.people).toHaveLength(1);
    expect(pool.people[0].role).toBe("owner");
  });

  it("refuses a second reopen on the same bytes, and says the door has been used", async () => {
    const { db } = makeDb(estateWithRoles([[OWNER, "owner"]]));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.reopen(
        refusedReview({ reopenedAt: "2026-09-05T08:00:00.000Z", reopenedBy: OWNER }),
        { userId: OWNER, restaurantId: HOUSE },
        { reason: "once more", challenge: "tok" },
      ),
    ).rejects.toThrow(/already been reopened once, on 2026-09-05.*Bring in a corrected file/s);
  });

  it("refuses a reopen with no reason", async () => {
    const { db } = makeDb(estateWithRoles([[OWNER, "owner"]]));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.reopen(
        refusedReview(),
        { userId: OWNER, restaurantId: HOUSE },
        { reason: "   ", challenge: "tok" },
      ),
    ).rejects.toThrow(/Reopening a refusal names its reason/);
  });

  it("refuses a book that was never refused", async () => {
    const { db } = makeDb(estateWithRoles([[OWNER, "owner"]]));
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.reopen(
        heldReview(),
        { userId: OWNER, restaurantId: HOUSE },
        { reason: "go", challenge: "tok" },
      ),
    ).rejects.toThrow(/already waiting for a decision, so there is nothing to reopen/);
  });

  it("refuses when the pool cannot be read — unknown is not permitted", async () => {
    const { db } = makeDb(estate({ people: [], accessFails: true }));
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notifications() as never, seal);
    await expect(
      svc.reopen(
        refusedReview(),
        { userId: OWNER, restaurantId: HOUSE },
        { reason: "go", challenge: "tok" },
      ),
    ).rejects.toThrow(/This is unknown, not permitted/);
    expect((seal as never as { redeem: jest.Mock }).redeem).not.toHaveBeenCalled();
  });

  it("refuses a refusal two owners reopened at once", async () => {
    const { db } = makeDb((call: Call) => {
      const base = estateWithRoles([[OWNER, "owner"]])(call);
      if (call.table === "price_index_upload_reviews" && call.op === "update") {
        return { data: [] };
      }
      return base;
    });
    const svc = new PriceIndexReviewService(db, notifications() as never, seals());
    await expect(
      svc.reopen(
        refusedReview(),
        { userId: OWNER, restaurantId: HOUSE },
        { reason: "go", challenge: "tok" },
      ),
    ).rejects.toThrow(/A book reopens once/);
  });

  it("mints a seal bound to the refusal it is undoing", async () => {
    const { db } = makeDb(estateWithRoles([[OWNER, "owner"]]));
    const seal = seals();
    const svc = new PriceIndexReviewService(db, notifications() as never, seal);
    const review = refusedReview();
    await svc.challengeReopen(review, { userId: OWNER, restaurantId: HOUSE });
    expect((seal as never as { issue: jest.Mock }).issue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: REOPEN_ACTION,
        args: {
          sha256: SHA,
          refusedAt: "2026-09-05T06:00:00.000Z",
          refusedBy: OTHER,
        },
      }),
    );
  });
});
