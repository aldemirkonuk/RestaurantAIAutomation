/**
 * Settling an unasked memo (ADR 0267 item 9, founder W55 2026-10-02, F-159).
 *
 * Two handlers, exercised directly over a recording fake client. Who may call
 * them is proven elsewhere: the class gate in `receiving-credits-roles.spec.ts`
 * and the route census in `route-access.expected.json` (owner, manager).
 *
 *   POST :id/transition, open -> credited: settles with the memo and the amount,
 *     stamps no ask and drafts no letter; refuses a memo that is not this
 *     house's credit memo.
 *   POST mark-memo/:documentId: an unclassed paper becomes a credit memo, with
 *     an audit row; every other type is refused untouched.
 */
import { HttpException } from "@nestjs/common";
import { CreditsController } from "./credits.controller";

type Row = Record<string, unknown>;
interface Op {
  table: string;
  kind: "select" | "update" | "insert";
  eqs: Array<[string, unknown]>;
  payload?: Row;
}

/**
 * A fake PostgREST client. `answers[table]` gives each read of that table its
 * row in turn (`maybeSingle` / `single`); writes are recorded in `ops`.
 */
function fakeDb(answers: Record<string, Array<Row | null | Error>>) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, kind: "select", eqs: [] };
    const settle = () => {
      if (op.kind === "insert") {
        const a = answers[`${table}:insert`]?.shift();
        return Promise.resolve({
          data: null,
          error: a instanceof Error ? { message: a.message } : null,
        });
      }
      const key = op.kind === "update" ? `${table}:update` : table;
      const a = answers[key]?.shift();
      if (a instanceof Error)
        return Promise.resolve({ data: null, error: { message: a.message } });
      return Promise.resolve({ data: a ?? null, error: null });
    };
    const b = {
      select: () => b,
      update: (payload: Row) => {
        op.kind = "update";
        op.payload = payload;
        return b;
      },
      insert: (payload: Row) => {
        op.kind = "insert";
        op.payload = payload;
        ops.push(op);
        return settle();
      },
      eq: (col: string, val: unknown) => {
        op.eqs.push([col, val]);
        return b;
      },
      maybeSingle: () => {
        ops.push(op);
        return settle();
      },
      single: () => {
        ops.push(op);
        return settle();
      },
    };
    return b;
  };
  return { ops, db: { getClient: () => ({ from }) } };
}

const user = { userId: "u-1", restaurantId: "house-1" };
const MEMO = "11111111-1111-4111-8111-111111111111";

const claim = (o: Row = {}): Row => ({
  id: "c-1",
  restaurant_id: "house-1",
  state: "open",
  claimed_amount: "40.00",
  credited_amount: null,
  credit_document_id: null,
  opened_at: "2026-10-01T00:00:00Z",
  self_evidenced: false,
  notes: null,
  ...o,
});

function controller(answers: Record<string, Array<Row | null | Error>>) {
  const { ops, db } = fakeDb(answers);
  const letters = { draftForCredit: jest.fn() };
  const c = new CreditsController(db as never, letters as never);
  return { c, ops, letters };
}

async function refusal(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error("expected a refusal");
}

describe("open -> credited settles an unasked memo (F-159)", () => {
  it("writes the proof, stamps no ask and drafts no letter", async () => {
    const { c, ops, letters } = controller({
      procurement_credits: [claim()],
      procurement_documents: [{ id: MEMO, doc_type: "credit_memo" }],
      "procurement_credits:update": [claim({ state: "credited" })],
    });
    await c.transition(
      "c-1",
      { to: "credited", creditedAmount: 30, creditDocumentId: MEMO },
      user,
    );
    const upd = ops.find(
      (o) => o.table === "procurement_credits" && o.kind === "update",
    );
    expect(upd?.payload).toMatchObject({
      state: "credited",
      credited_amount: 30,
      credit_document_id: MEMO,
      settled_by: "u-1",
    });
    expect(upd?.payload).not.toHaveProperty("requested_at");
    expect(upd?.payload).not.toHaveProperty("requested_by");
    expect(letters.draftForCredit).not.toHaveBeenCalled();
    // The memo was looked up in THIS house.
    const read = ops.find((o) => o.table === "procurement_documents");
    expect(read?.eqs).toEqual(
      expect.arrayContaining([
        ["id", MEMO],
        ["restaurant_id", "house-1"],
      ]),
    );
  });

  it("refuses open -> credited without a memo, and writes nothing", async () => {
    const { c, ops } = controller({ procurement_credits: [claim()] });
    const e = await refusal(
      c.transition("c-1", { to: "credited", creditedAmount: 30 }, user),
    );
    expect(e.getStatus()).toBe(422);
    expect(ops.some((o) => o.kind === "update")).toBe(false);
  });

  it("refuses open -> credited without the amount, and writes nothing", async () => {
    const { c, ops } = controller({ procurement_credits: [claim()] });
    const e = await refusal(
      c.transition("c-1", { to: "credited", creditDocumentId: MEMO }, user),
    );
    expect(e.getStatus()).toBe(422);
    expect(ops.some((o) => o.kind === "update")).toBe(false);
  });

  it("refuses a memo that is not on file at this house", async () => {
    const { c, ops } = controller({
      procurement_credits: [claim()],
      procurement_documents: [null],
    });
    const e = await refusal(
      c.transition(
        "c-1",
        { to: "credited", creditedAmount: 30, creditDocumentId: MEMO },
        user,
      ),
    );
    expect(e.getStatus()).toBe(422);
    expect(String(e.message)).toMatch(/not on file at this house/);
    expect(ops.some((o) => o.kind === "update")).toBe(false);
  });

  it("refuses a paper that is not filed as a credit memo", async () => {
    const { c, ops } = controller({
      procurement_credits: [claim({ state: "requested" })],
      procurement_documents: [{ id: MEMO, doc_type: "invoice" }],
    });
    const e = await refusal(
      c.transition(
        "c-1",
        { to: "credited", creditedAmount: 30, creditDocumentId: MEMO },
        user,
      ),
    );
    expect(e.getStatus()).toBe(422);
    expect(ops.some((o) => o.kind === "update")).toBe(false);
  });

  it("still stamps the ask and drafts the letter when the claim IS asked for", async () => {
    const { c, ops, letters } = controller({
      procurement_credits: [claim()],
      "procurement_credits:update": [claim({ state: "requested" })],
    });
    letters.draftForCredit.mockResolvedValue({ state: "drafted" });
    await c.transition("c-1", { to: "requested" }, user);
    const upd = ops.find((o) => o.kind === "update");
    expect(upd?.payload).toMatchObject({ requested_by: "u-1" });
    expect(letters.draftForCredit).toHaveBeenCalledTimes(1);
  });
});

describe("POST mark-memo/:documentId (F-159)", () => {
  it("marks an unclassed paper, conditional on the type it was read with, and audits who", async () => {
    const { c, ops } = controller({
      procurement_documents: [
        {
          id: MEMO,
          doc_type: "unknown",
          status: "received",
          direction: "issued_by_vendor",
        },
      ],
      "procurement_documents:update": [{ id: MEMO, doc_type: "credit_memo" }],
      "system_audit_log:insert": [],
    });
    const out = await c.markMemo(MEMO, user);
    expect(out).toMatchObject({
      changed: true,
      audited: true,
      docType: "credit_memo",
    });

    const upd = ops.find((o) => o.kind === "update");
    expect(upd?.payload).toEqual({ doc_type: "credit_memo" });
    expect(upd?.eqs).toEqual(
      expect.arrayContaining([
        ["id", MEMO],
        ["restaurant_id", "house-1"],
        ["doc_type", "unknown"],
      ]),
    );
    const audit = ops.find((o) => o.table === "system_audit_log");
    expect(audit?.payload).toMatchObject({
      actor_type: "user",
      actor_id: "u-1",
      action: "document_marked_credit_memo",
      entity_type: "procurement_document",
      entity_id: MEMO,
      restaurant_id: "house-1",
      changes: { fields: { doc_type: { from: "unknown", to: "credit_memo" } } },
    });
  });

  it("refuses an invoice and changes nothing", async () => {
    const { c, ops } = controller({
      procurement_documents: [
        { id: MEMO, doc_type: "invoice", status: "verified" },
      ],
    });
    const e = await refusal(c.markMemo(MEMO, user));
    expect(e.getStatus()).toBe(409);
    expect(ops.some((o) => o.kind !== "select")).toBe(false);
  });

  it("answers 404 for a paper of another house", async () => {
    const { c, ops } = controller({ procurement_documents: [null] });
    const e = await refusal(c.markMemo(MEMO, user));
    expect(e.getStatus()).toBe(404);
    expect(ops[0].eqs).toEqual(
      expect.arrayContaining([["restaurant_id", "house-1"]]),
    );
  });

  it("writes nothing for a paper that is already a credit memo", async () => {
    const { c, ops } = controller({
      procurement_documents: [
        { id: MEMO, doc_type: "credit_memo", status: "verified" },
      ],
    });
    const out = await c.markMemo(MEMO, user);
    expect(out).toMatchObject({ changed: false, audited: false });
    expect(ops.some((o) => o.kind !== "select")).toBe(false);
  });

  it("refuses when the paper was classed in between, and audits nothing", async () => {
    const { c, ops } = controller({
      procurement_documents: [
        { id: MEMO, doc_type: "unknown", status: "received" },
      ],
      "procurement_documents:update": [null],
    });
    const e = await refusal(c.markMemo(MEMO, user));
    expect(e.getStatus()).toBe(409);
    expect(ops.some((o) => o.table === "system_audit_log")).toBe(false);
  });

  it("says when the audit row could not be written", async () => {
    const { c } = controller({
      procurement_documents: [
        { id: MEMO, doc_type: "unknown", status: "received" },
      ],
      "procurement_documents:update": [{ id: MEMO, doc_type: "credit_memo" }],
      "system_audit_log:insert": [new Error("audit down")],
    });
    const out = await c.markMemo(MEMO, user);
    expect(out).toMatchObject({
      changed: true,
      audited: false,
      auditReason: "audit down",
    });
  });
});
