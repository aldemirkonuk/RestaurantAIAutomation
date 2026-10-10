/**
 * POST /procurement/credits/:id/transition → credited checks the memo (F-672).
 *
 * One $40 memo must not settle two claims at $400 each: the memo has to be the
 * house's own credit memo, from the claim's vendor, and the total credited
 * against it never passes the memo's total. The controller is exercised with a
 * stubbed query builder per table; guards are proven elsewhere
 * (receiving-credits-roles.spec.ts).
 */
import { HttpException } from "@nestjs/common";
import { CreditsController } from "./credits.controller";
import { memoRefusal } from "./credit-ledger";

type Row = Record<string, unknown>;

const user = { userId: "u1", restaurantId: "r1" };

function harness(opts: {
  claim?: Row;
  memo?: Row | null;
  creditedOnMemo?: Row[];
  house?: Row | null;
  memoReadFails?: boolean;
  creditedReadFails?: boolean;
}) {
  const claim: Row = {
    id: "c1",
    restaurant_id: "r1",
    provider_id: "v1",
    state: "requested",
    claimed_amount: "400.00",
    credited_amount: null,
    credit_document_id: null,
    opened_at: "2026-09-01T00:00:00.000Z",
    self_evidenced: false,
    notes: null,
    ...opts.claim,
  };
  const updates: Row[] = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Row | null = null;
    let head = false;
    const b: Record<string, unknown> = {
      // The house check counts the memo (`head: true`) before this guard reads it.
      select: (_c?: string, o?: { head?: boolean }) => {
        head = !!o?.head;
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      maybeSingle: async () => {
        if (table === "procurement_credits")
          return { data: claim, error: null };
        if (table === "restaurants")
          return { data: opts.house ?? null, error: null };
        if (table === "procurement_documents" && opts.memoReadFails)
          return { data: null, error: { message: "relation timeout 57014" } };
        if (table === "procurement_documents")
          return {
            data:
              opts.memo && filters.restaurant_id === "r1" ? opts.memo : null,
            error: null,
          };
        return { data: null, error: null };
      },
      single: async () => {
        updates.push(patch as Row);
        return { data: { ...claim, ...(patch as Row) }, error: null };
      },
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve(
          head
            ? {
                count:
                  table === "procurement_documents" &&
                  opts.memo &&
                  filters.restaurant_id === "r1"
                    ? 1
                    : 0,
                error: null,
              }
            : opts.creditedReadFails
              ? { data: null, error: { message: "relation timeout 57014" } }
              : { data: opts.creditedOnMemo ?? [], error: null },
        ).then(res),
    };
    return b;
  };
  const db = { getClient: () => ({ from }) };
  return { c: new CreditsController(db as never, {} as never), updates };
}

const memo = (o: Row = {}): Row => ({
  id: "m1",
  doc_type: "credit_memo",
  provider_id: "v1",
  total: "40.00",
  ...o,
});

async function refusalOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return String(e.getResponse());
    throw e;
  }
  return "";
}

const credit = (amount: number) => ({
  to: "credited" as const,
  creditedAmount: amount,
  creditDocumentId: "m1",
});

describe("crediting a claim against a memo (F-672)", () => {
  it("refuses a second claim that would pass the memo's total", async () => {
    const { c, updates } = harness({
      memo: memo(),
      creditedOnMemo: [{ id: "c0", credited_amount: "40.00" }],
    });
    const msg = await refusalOf(c.transition("c1", credit(400), user));
    expect(msg).toMatch(/all of it is already credited/);
    expect(updates).toHaveLength(0);
  });

  it("refuses more than the memo's total on the first claim, naming what is left", async () => {
    const { c, updates } = harness({ memo: memo({ total: "40.00" }) });
    const msg = await refusalOf(c.transition("c1", credit(400), user));
    expect(msg).toMatch(/only 40\.00 of it is left/);
    expect(updates).toHaveLength(0);
  });

  it("allows two claims to share one memo up to its total", async () => {
    const { c, updates } = harness({
      memo: memo({ total: "100.00" }),
      creditedOnMemo: [{ id: "c0", credited_amount: "60.00" }],
    });
    await c.transition("c1", credit(40), user);
    expect(updates).toHaveLength(1);
    expect(updates[0].state).toBe("credited");
  });

  it("refuses a memo that is not this house's", async () => {
    const { c, updates } = harness({ memo: null });
    const msg = await refusalOf(c.transition("c1", credit(10), user));
    // The house check answers first, with the same 404 for another house's
    // memo as for none at all (tenant-followup).
    expect(msg).toMatch(/Credit memo not found/);
    expect(updates).toHaveLength(0);
  });

  it("refuses a paper that is not a credit memo", async () => {
    const { c } = harness({ memo: memo({ doc_type: "invoice" }) });
    expect(await refusalOf(c.transition("c1", credit(10), user))).toMatch(
      /not a credit memo/,
    );
  });

  it("refuses a memo from another vendor", async () => {
    const { c } = harness({ memo: memo({ provider_id: "v2" }) });
    expect(await refusalOf(c.transition("c1", credit(10), user))).toMatch(
      /different vendor/,
    );
  });
});

describe("the memo refusal speaks the house's money (F-877)", () => {
  it("says the cap in the memo's currency and the house's formats", async () => {
    const { c, updates } = harness({
      claim: { currency: "TRY" },
      memo: memo({ total: "1250.00", currency: "TRY" }),
      creditedOnMemo: [{ id: "c0", credited_amount: "850.00" }],
      house: { timezone: "Europe/Istanbul", country: "TR" },
    });
    const msg = await refusalOf(c.transition("c1", credit(1250), user));
    expect(msg).toContain("₺1.250,00");
    expect(msg).toContain("₺400,00");
    expect(msg).not.toMatch(/1250\.00|400\.00/);
    expect(updates).toHaveLength(0);
  });

  it("refuses a memo in another money than the claim, rather than comparing the numbers", async () => {
    const { c, updates } = harness({
      claim: { currency: "TRY" },
      memo: memo({ total: "40.00", currency: "EUR" }),
    });
    const msg = await refusalOf(c.transition("c1", credit(10), user));
    expect(msg).toMatch(/in EUR and this claim is in TRY/);
    expect(updates).toHaveLength(0);
  });

  it.each([
    ["the memo", { memoReadFails: true }],
    ["what is already credited on it", { creditedReadFails: true }],
  ])(
    "answers a failed read of %s with a 503 sentence, not the database's words",
    async (_w, o) => {
      const { c, updates } = harness({ memo: memo(), ...o });
      let status = 0;
      let msg = "";
      try {
        await c.transition("c1", credit(10), user);
      } catch (e) {
        if (!(e instanceof HttpException)) throw e;
        status = e.getStatus();
        msg = String(e.getResponse());
      }
      expect(status).toBe(503);
      expect(msg).toMatch(/the claim was not changed/);
      expect(msg).not.toMatch(/57014/);
      expect(updates).toHaveLength(0);
    },
  );
});

describe("memoRefusal", () => {
  const m = { docType: "credit_memo", providerId: "v1", total: 40 };
  it("allows the exact remainder", () => {
    expect(memoRefusal(m, "v1", 15, 25)).toBeNull();
  });
  it("cannot check a memo whose total was never read, so does not refuse on it", () => {
    expect(memoRefusal({ ...m, total: null }, "v1", 999, 0)).toBeNull();
  });
  it("does not refuse when either side has no vendor on record", () => {
    expect(memoRefusal({ ...m, providerId: null }, "v1", 10, 0)).toBeNull();
    expect(memoRefusal(m, null, 10, 0)).toBeNull();
  });
});
