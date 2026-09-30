/**
 * A price change on an approved order re-runs the approval rules for the
 * person making it — ADR 0244 D3, the founder's four calls of 2026-09-30:
 *
 *   F1 "Pending price change (Recommended)": an approved (or later,
 *      pre-delivery) order keeps its state; a change the person's rules do
 *      not cover is held as a PENDING change and applies only when someone
 *      whose rules cover it approves it through a sealed act.
 *   F2 "Yes, gate it (Recommended)": confirm-deal runs the same rules for the
 *      confirming person — owners and managers included (superseding that
 *      part of ADR 0175).
 *   F4 "Any price change": EVERY change, up or down, re-runs EVERY rule,
 *      `new_vendor` and `price_jump` included — and the POST orders merge,
 *      which rewrites an open order's prices, is a price change too.
 *   (F3, the autonomy, is `inbound-responder.service.spec.ts`.)
 *
 * The service runs over an in-memory store (`FakeDb`) with the REAL
 * `ApprovalThresholdsService`, `OrganizationsService`, `SealChallengeService`,
 * `VendorSendAuthorityService` and `VendorSendRequestsService`: the rules,
 * the roles, the seals and the send authority are the production code, and
 * only the mailbox and the bell are recorders.
 *
 * [REVERT-FAILS] marks a case that fails on e9c6ffe89 (the head of #538,
 * where D3 was ruled and not built).
 */
import { ForbiddenException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";
import { VendorSendRequestsService } from "../organizations/vendor-send-requests.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { ApprovalThresholdsService } from "../settings/approval-thresholds.service";
import { installGrantLedger } from "../organizations/testing/grant-ledger-fake";
import {
  FakeDb,
  fakeNotifications,
  recorder,
} from "../notifications/producers/testing/fake-db";
import { ProcurementOrderStatus as S } from "./dto/procurement.dto";

const HOUSE = "house-1";
const ORDER = "order-1";
const OWNER = "a0000000-0000-4000-8000-000000000001";
const MANAGER = "a0000000-0000-4000-8000-000000000002";
const STAFF = "a0000000-0000-4000-8000-000000000003";
const VENDOR = "vendor@kavaklidere.example";

type Row = Record<string, any>;

function rule(
  name: "manager_ceiling" | "new_vendor" | "price_jump",
  opts: {
    amount?: number | null;
    percent?: number | null;
    role?: "owner" | "manager";
  } = {},
): Row {
  return {
    restaurant_id: HOUSE,
    rule: name,
    enabled: true,
    amount_limit: opts.amount ?? null,
    percent_limit: opts.percent ?? null,
    required_role: opts.role ?? "owner",
    set_by: null,
    updated_at: "2026-09-01T00:00:00Z",
  };
}

/** A 5,000 ceiling above which an OWNER must sign — the house in every case unless it says otherwise. */
const CEILING_5000 = rule("manager_ceiling", { amount: 5000, role: "owner" });

function build(
  opts: { status?: S; order?: Row; rules?: Row[]; otherOrders?: Row[] } = {},
) {
  const db = new FakeDb();
  db.tables.users = [
    {
      user_id: OWNER,
      name: "Olcay Owner",
      restaurant_id: HOUSE,
      role: "owner",
    },
    {
      user_id: MANAGER,
      name: "Mert Manager",
      restaurant_id: HOUSE,
      role: "manager",
    },
    { user_id: STAFF, name: "Ayse Staff", restaurant_id: HOUSE, role: "staff" },
  ];
  db.tables.user_restaurant_access = [
    { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
    {
      user_id: MANAGER,
      restaurant_id: HOUSE,
      role: "manager",
      is_active: true,
    },
    { user_id: STAFF, restaurant_id: HOUSE, role: "staff", is_active: true },
  ];
  db.tables.procurement_orders = [
    {
      id: ORDER,
      restaurant_id: HOUSE,
      order_number: "PO-2026-0042",
      provider_id: "prov-1",
      inventory_id: null,
      status: opts.status ?? S.APPROVED,
      quantity: 6,
      bottles_total: 6,
      quoted_price: 700,
      negotiated_price: 700,
      final_price: null,
      total_cost: 4200,
      price_verified: false,
      manager_notes: null,
      currency: "TRY",
      requested_at: "2026-09-10T00:00:00Z",
      providers: {
        name: "Kavaklidere",
        contact_email: VENDOR,
        contact_first_name: "Hasan",
        primary_contact: {},
        restaurant_id: HOUSE,
      },
      restaurant_inventory: { wine_name: "Yakut" },
      inventory: { wine_name: "Yakut" },
      ...(opts.order ?? {}),
    },
    ...(opts.otherOrders ?? []),
  ];
  db.tables.restaurant_approval_thresholds = opts.rules ?? [CEILING_5000];
  db.tables.procurement_order_price_changes = [];
  db.tables.system_audit_log = [];
  db.tables.procurement_conversations = [];
  db.tables.mcp_seal_challenges = [];
  db.tables.vendor_send_requests = [];
  installGrantLedger(db);
  const database = { supabase: db, getClient: () => db, client: db } as any;
  const gmail = {
    sendEmail: recorder(async (o: any) => ({
      success: true,
      messageId: "gmail-1",
      threadId: "thread-1",
      rfc822MessageId: o.messageIdHeader,
    })),
  };
  const bell = fakeNotifications([OWNER, MANAGER, STAFF]);
  const seal = new SealChallengeService(database);
  const authority = new VendorSendAuthorityService(database);
  const service = new ProcurementService(
    database,
    { createEvent: async () => undefined } as any,
    { recordTransaction: async () => undefined } as any,
    undefined,
    gmail as any,
    undefined,
    undefined,
    undefined,
    bell as any,
    new ApprovalThresholdsService(database, {} as any),
    new OrganizationsService(database),
    seal,
    authority,
    new VendorSendRequestsService(database, authority),
  );
  for (const level of ["log", "warn", "error", "debug"] as const) {
    (service as any).logger[level] = () => undefined;
    (seal as any).logger[level] = () => undefined;
  }
  const order = () => db.tables.procurement_orders.find((o) => o.id === ORDER)!;
  const changes = () => db.tables.procurement_order_price_changes;
  const waiting = () => changes().filter((c) => c.state === "waiting");
  const audits = (action: string) =>
    db.tables.system_audit_log.filter((a) => a.action === action);
  return { db, service, gmail, bell, order, changes, waiting, audits };
}

const edit = (t: ReturnType<typeof build>, as: string, dto: Row) =>
  t.service.updateOrder(HOUSE, ORDER, dto as any, { actorUserId: as });

// ===========================================================================
// F1 — a change the person's rules do not cover waits; the order keeps its state
// ===========================================================================

describe("F1: a price change over the editor's rules waits as a pending change", () => {
  it.each([S.APPROVED, S.CONFIRMED, S.IN_TRANSIT])(
    "[REVERT-FAILS] on an order %s, a manager's total over the owner's ceiling is held, not written",
    async (status) => {
      const t = build({ status });
      const out = await edit(t, MANAGER, { totalCost: 6000 });
      // The order keeps its figures and its state (F1: no state change).
      expect(t.order()).toMatchObject({ total_cost: 4200, status });
      expect(out.totalCost).toBe(4200);
      // The change is held, whole: from, to, who, why, who may sign.
      expect(t.waiting()).toEqual([
        expect.objectContaining({
          order_id: ORDER,
          source: "order_edit",
          raised_by: MANAGER,
          raised_by_role: "manager",
          figures_from: { total_cost: 4200 },
          figures_to: { total_cost: 6000 },
          required_role: "owner",
          fired_by: ["manager_ceiling"],
        }),
      ]);
      expect(out.pendingPriceChange).toMatchObject({
        source: "order_edit",
        requiredRole: "owner",
        to: { total_cost: 6000 },
      });
      expect(out.pendingPriceChange!.sentence).toMatch(/waits for an owner/);
      expect(out.pendingPriceChange!.sentence).toMatch(/price was not changed/);
      // On paper, and the owner is told — nobody else, never the proposer.
      expect(t.audits("order_price_change_waiting")).toHaveLength(1);
      expect(t.audits("order_price_changed")).toHaveLength(0);
      const told = t.bell.persistForRestaurant.calls;
      expect(told).toHaveLength(1);
      expect(told[0][2].onlyUserIds).toEqual([OWNER]);
    },
  );

  // Not a D3 case, and not marked: on e9c6ffe89 its paper assertion fails only
  // because that `readOrderMoneyBefore` returned the row object itself, which
  // this in-memory store aliases to the row the UPDATE then mutates (PostgREST
  // returns a fresh object). This pass returns a copy.
  it("an owner's same change applies at once, and leaves the usual paper", async () => {
    const t = build();
    const out = await edit(t, OWNER, { totalCost: 6000 });
    expect(t.order().total_cost).toBe(6000);
    expect(out.pendingPriceChange).toBeUndefined();
    expect(t.changes()).toHaveLength(0);
    expect(t.audits("order_price_changed")).toHaveLength(1);
  });

  it("a manager's change inside the ceiling applies at once", async () => {
    const t = build();
    await edit(t, MANAGER, { totalCost: 4800 });
    expect(t.order().total_cost).toBe(4800);
    expect(t.changes()).toHaveLength(0);
  });

  it("before approval the approve act tests the figures, so a PENDING order's price edit applies", async () => {
    const t = build({ status: S.PENDING });
    await edit(t, MANAGER, { totalCost: 6000 });
    expect(t.order().total_cost).toBe(6000);
    expect(t.changes()).toHaveLength(0);
  });

  it("[REVERT-FAILS] the notes beside a held price still apply; the price does not", async () => {
    const t = build();
    await edit(t, MANAGER, {
      totalCost: 6000,
      managerNotes: "vendor raised the price",
    });
    expect(t.order()).toMatchObject({
      total_cost: 4200,
      manager_notes: "vendor raised the price",
    });
    expect(t.waiting()).toHaveLength(1);
  });

  it("`price_verified` is a verdict, not a figure: flipping it alone holds nothing", async () => {
    const t = build();
    await edit(t, MANAGER, { priceVerified: true });
    expect(t.order().price_verified).toBe(true);
    expect(t.changes()).toHaveLength(0);
  });

  it("[REVERT-FAILS] an unreadable policy refuses the edit and writes nothing", async () => {
    const t = build();
    t.db.failures.restaurant_approval_thresholds = "relation unavailable";
    await expect(edit(t, MANAGER, { totalCost: 4300 })).rejects.toThrow(
      /could not be read/,
    );
    expect(t.order().total_cost).toBe(4200);
    expect(t.changes()).toHaveLength(0);
  });

  it("[REVERT-FAILS] a newer proposal supersedes the waiting one; one waits per order", async () => {
    const t = build();
    await edit(t, MANAGER, { totalCost: 6000 });
    await edit(t, MANAGER, { totalCost: 6500 });
    expect(t.waiting()).toHaveLength(1);
    expect(t.waiting()[0].figures_to).toEqual({ total_cost: 6500 });
    expect(t.changes().filter((c) => c.state === "superseded")).toHaveLength(1);
  });

  it("[REVERT-FAILS] a change that applies directly supersedes the one waiting", async () => {
    const t = build();
    await edit(t, MANAGER, { totalCost: 6000 });
    await edit(t, OWNER, { totalCost: 5500 });
    expect(t.order().total_cost).toBe(5500);
    expect(t.waiting()).toHaveLength(0);
    expect(t.changes()[0]).toMatchObject({ state: "superseded" });
  });

  it("[REVERT-FAILS] the PATCH answers 202 Accepted when the change is held", async () => {
    const t = build();
    const controller = new ProcurementController(t.service);
    const res = { status: jest.fn() };
    const out = await controller.updateOrder(
      ORDER,
      { totalCost: 6000 } as any,
      { userId: MANAGER, restaurantId: HOUSE },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(out.pendingPriceChange).toBeDefined();
    const res2 = { status: jest.fn() };
    await controller.updateOrder(
      ORDER,
      { managerNotes: "n" } as any,
      { userId: MANAGER, restaurantId: HOUSE },
      res2,
    );
    expect(res2.status).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// F4 — ANY price change re-runs EVERY rule, down as well as up
// ===========================================================================

describe("F4: any price change re-runs every rule", () => {
  it("[REVERT-FAILS] a DECREASE that still sits over the ceiling waits for the owner", async () => {
    // An owner approved it at 8,000; a manager lowers it to 7,000 — still
    // over the manager's 5,000, so still the owner's to sign.
    const t = build({ order: { total_cost: 8000 } });
    await edit(t, MANAGER, { totalCost: 7000 });
    expect(t.order().total_cost).toBe(8000);
    expect(t.waiting()[0]).toMatchObject({
      figures_from: { total_cost: 8000 },
      figures_to: { total_cost: 7000 },
    });
  });

  it("[REVERT-FAILS] new_vendor fires on any change to a first order with that vendor, a decrease included", async () => {
    const t = build({ rules: [rule("new_vendor", { role: "owner" })] });
    await edit(t, MANAGER, { totalCost: 4000 });
    expect(t.order().total_cost).toBe(4200);
    expect(t.waiting()[0]).toMatchObject({
      fired_by: ["new_vendor"],
      required_role: "owner",
    });
  });

  it("new_vendor does not fire once the house has another order with that vendor", async () => {
    const t = build({
      rules: [rule("new_vendor", { role: "owner" })],
      otherOrders: [
        {
          id: "order-0",
          restaurant_id: HOUSE,
          provider_id: "prov-1",
          status: S.COMPLETED,
        },
      ],
    });
    await edit(t, MANAGER, { totalCost: 4000 });
    expect(t.order().total_cost).toBe(4000);
    expect(t.changes()).toHaveLength(0);
  });

  it("[REVERT-FAILS] price_jump fires on the unit price the order now carries against the last price paid", async () => {
    const t = build({
      rules: [rule("price_jump", { percent: 10, role: "owner" })],
      order: { inventory_id: "inv-1" },
      otherOrders: [
        {
          id: "order-0",
          restaurant_id: HOUSE,
          provider_id: "prov-2",
          inventory_id: "inv-1",
          final_price: 700,
          requested_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    // 700 -> 800 is 14.3% over the last 700 paid, over the house's 10%.
    await edit(t, MANAGER, { negotiatedPrice: 800 });
    expect(t.order().negotiated_price).toBe(700);
    expect(t.waiting()[0]).toMatchObject({ fired_by: ["price_jump"] });
  });

  it("[REVERT-FAILS] a unit-price change whose price x quantity crosses the ceiling waits, the total untouched", async () => {
    // 900 x 6 = 5,400 > 5,000 though total_cost still says 4,200 (the
    // effective total, ADR 0244 D3 builder's reading).
    const t = build();
    await edit(t, MANAGER, { negotiatedPrice: 900 });
    expect(t.order().negotiated_price).toBe(700);
    expect(t.waiting()).toHaveLength(1);
  });

  it("the same unit-price change inside the ceiling applies", async () => {
    const t = build();
    await edit(t, MANAGER, { negotiatedPrice: 800 }); // 4,800
    expect(t.order().negotiated_price).toBe(800);
    expect(t.changes()).toHaveLength(0);
  });
});

// ===========================================================================
// The sealed act that approves a held change
// ===========================================================================

describe("approving a held change is a sealed act by someone whose rules cover it", () => {
  async function held() {
    const t = build();
    await edit(t, MANAGER, { totalCost: 6000 });
    return t;
  }

  it("[REVERT-FAILS] the owner's sealed approval applies the change, keeps the state, and names both people", async () => {
    const t = await held();
    const { challenge, act } = await t.service.issuePriceChangeSeal(
      HOUSE,
      ORDER,
      OWNER,
    );
    expect(act).toBe("approve_price_change");
    const out = await t.service.approvePriceChange(
      HOUSE,
      ORDER,
      OWNER,
      challenge,
    );
    expect(out).toMatchObject({ approved: true, source: "order_edit" });
    expect(t.order()).toMatchObject({ total_cost: 6000, status: S.APPROVED });
    expect(t.changes()[0]).toMatchObject({
      state: "approved",
      decided_by: OWNER,
    });
    expect(t.changes()[0].decided_at).toBeTruthy();
    const paper = t.audits("order_price_changed");
    expect(paper).toHaveLength(1);
    expect(paper[0]).toMatchObject({ actor_id: OWNER });
    expect(paper[0].changes.fields.total_cost).toEqual({
      from: 4200,
      to: 6000,
    });
    expect(t.audits("order_price_change_approved")).toHaveLength(1);
  });

  it("[REVERT-FAILS] without a seal nothing applies and the change still waits", async () => {
    const t = await held();
    await expect(
      t.service.approvePriceChange(HOUSE, ORDER, OWNER, undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(t.order().total_cost).toBe(4200);
    expect(t.waiting()).toHaveLength(1);
  });

  it("[REVERT-FAILS] a manager is refused before any seal is minted, in words", async () => {
    const t = await held();
    await expect(
      t.service.issuePriceChangeSeal(HOUSE, ORDER, MANAGER),
    ).rejects.toThrow(/only an owner may approve it/);
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(0);
    await expect(
      t.service.approvePriceChange(HOUSE, ORDER, MANAGER, "x"),
    ).rejects.toThrow(/only an owner/);
    expect(t.order().total_cost).toBe(4200);
  });

  it("[REVERT-FAILS] a seal held over one proposal cannot approve the proposal that superseded it", async () => {
    const t = await held();
    const { challenge } = await t.service.issuePriceChangeSeal(
      HOUSE,
      ORDER,
      OWNER,
    );
    await edit(t, MANAGER, { totalCost: 9000 });
    await expect(
      t.service.approvePriceChange(HOUSE, ORDER, OWNER, challenge),
    ).rejects.toThrow(ForbiddenException);
    expect(t.order().total_cost).toBe(4200);
    expect(t.waiting()[0].figures_to).toEqual({ total_cost: 9000 });
  });

  it("[REVERT-FAILS] the seal names the proposal: a re-proposal of the SAME figures needs a new hold", async () => {
    const t = await held();
    const { challenge } = await t.service.issuePriceChangeSeal(
      HOUSE,
      ORDER,
      OWNER,
    );
    await edit(t, MANAGER, { totalCost: 6000 }); // same figures, a new proposal
    expect(t.waiting()).toHaveLength(1);
    await expect(
      t.service.approvePriceChange(HOUSE, ORDER, OWNER, challenge),
    ).rejects.toThrow(ForbiddenException);
    expect(t.order().total_cost).toBe(4200);
  });

  it("[REVERT-FAILS] a seal minted to approve the ORDER cannot approve a change to its price", async () => {
    const t = await held();
    const approveSeal = await t.service.issueOrderSealChallenge(
      HOUSE,
      ORDER,
      OWNER,
    );
    await expect(
      t.service.approvePriceChange(HOUSE, ORDER, OWNER, approveSeal.challenge),
    ).rejects.toThrow(/different act/);
    expect(t.order().total_cost).toBe(4200);
  });

  it("[REVERT-FAILS] a change whose figures moved since is stale: refused, closed, nothing applied", async () => {
    const t = await held();
    t.order().total_cost = 4300; // moved underneath it
    await expect(
      t.service.issuePriceChangeSeal(HOUSE, ORDER, OWNER),
    ).rejects.toThrow(/changed after this change was proposed/);
    expect(t.changes()[0]).toMatchObject({ state: "stale" });
    expect(t.order().total_cost).toBe(4300);
  });

  it("[REVERT-FAILS] a change on an order delivered since is stale", async () => {
    const t = await held();
    t.order().status = S.DELIVERED;
    await expect(
      t.service.issuePriceChangeSeal(HOUSE, ORDER, OWNER),
    ).rejects.toThrow(/can no longer be approved/);
    expect(t.changes()[0]).toMatchObject({ state: "stale" });
  });

  it("[REVERT-FAILS] the readout shows the change, and says who may approve it", async () => {
    const t = await held();
    const asOwner = await t.service.priceChangeReadout(HOUSE, ORDER, OWNER);
    expect(asOwner).toMatchObject({ mayApprove: true, sentence: null });
    expect(asOwner.change).toMatchObject({
      from: { total_cost: 4200 },
      to: { total_cost: 6000 },
      stale: null,
    });
    const asManager = await t.service.priceChangeReadout(HOUSE, ORDER, MANAGER);
    expect(asManager.mayApprove).toBe(false);
    expect(asManager.sentence).toMatch(/only an owner may approve it/);
    expect(
      await build().service.priceChangeReadout(HOUSE, ORDER, OWNER),
    ).toEqual({
      change: null,
      mayApprove: false,
      sentence: null,
    });
  });

  it("[REVERT-FAILS] a failure after the claim puts the change back to waiting, never recorded as approved", async () => {
    const t = await held();
    const { challenge } = await t.service.issuePriceChangeSeal(
      HOUSE,
      ORDER,
      OWNER,
    );
    const realFrom = t.db.from.bind(t.db);
    let orderUpdates = 0;
    (t.db as any).from = (table: string) => {
      const q = realFrom(table);
      if (table !== "procurement_orders") return q;
      const realUpdate = q.update.bind(q);
      (q as any).update = (patch: Row) => {
        orderUpdates += 1;
        (t.db as any).failures.procurement_orders = "statement timeout";
        return realUpdate(patch);
      };
      return q;
    };
    await expect(
      t.service.approvePriceChange(HOUSE, ORDER, OWNER, challenge),
    ).rejects.toThrow();
    delete (t.db as any).failures.procurement_orders;
    expect(orderUpdates).toBe(1);
    expect(t.changes()[0]).toMatchObject({
      state: "waiting",
      decided_at: null,
    });
  });
});

// ===========================================================================
// F2 — confirm-deal runs the same rules for the confirming person
// ===========================================================================

describe("F2: confirming a deal runs the approval rules for the confirming person", () => {
  // The vendor offers 190 x 6 = 1,140 on an order still in negotiation; the
  // house's ceiling for a manager is 1,000.
  const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };
  const dealHouse = () =>
    build({
      status: S.NEGOTIATING,
      order: { quoted_price: 150, negotiated_price: null, total_cost: 900 },
      rules: [rule("manager_ceiling", { amount: 1000, role: "owner" })],
    });

  it("[REVERT-FAILS] a manager's deal over the ceiling commits nothing, mails nothing, and waits with its exact terms", async () => {
    const t = dealHouse();
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
    );
    const out = await t.service.confirmDeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
      challenge,
    );
    expect(out).toMatchObject({ confirmed: false, sentConfirmation: false });
    expect(out.pendingPriceChange).toMatchObject({
      source: "confirm_deal",
      requiredRole: "owner",
    });
    expect(t.order()).toMatchObject({
      status: S.NEGOTIATING,
      negotiated_price: null,
    });
    expect(t.order().approved_by).toBeUndefined();
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    expect(t.waiting()).toEqual([
      expect.objectContaining({
        source: "confirm_deal",
        terms: { finalPrice: 190, quantity: 6, sendConfirmation: true },
        figures_from: {
          negotiated_price: null,
          final_price: null,
          quantity: 6,
        },
        figures_to: { negotiated_price: 190, final_price: 190, quantity: 6 },
      }),
    ]);
    // The hold was real: its seal is spent.
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(1);
    expect(t.db.tables.mcp_seal_challenges[0].redeemed_at).toBeTruthy();
  });

  it("an owner confirms the same deal: covered, committed in their name", async () => {
    const t = dealHouse();
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      OWNER,
      terms,
    );
    const out = await t.service.confirmDeal(
      HOUSE,
      ORDER,
      OWNER,
      terms,
      challenge,
    );
    expect(out.confirmed).toBe(true);
    expect(t.order()).toMatchObject({
      status: S.APPROVED,
      approved_by: OWNER,
      negotiated_price: 190,
    });
  });

  it("a manager's deal inside the ceiling commits as before", async () => {
    const t = dealHouse();
    const small = { ...terms, finalPrice: 150 }; // 900
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      small,
    );
    const out = await t.service.confirmDeal(
      HOUSE,
      ORDER,
      MANAGER,
      small,
      challenge,
    );
    expect(out.confirmed).toBe(true);
    expect(t.order()).toMatchObject({
      status: S.APPROVED,
      approved_by: MANAGER,
    });
  });

  it("[REVERT-FAILS] the owner's sealed approval of the held deal confirms it on the held terms, as the owner", async () => {
    const t = dealHouse();
    const first = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
    );
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, first.challenge);
    const { challenge } = await t.service.issuePriceChangeSeal(
      HOUSE,
      ORDER,
      OWNER,
    );
    const out = await t.service.approvePriceChange(
      HOUSE,
      ORDER,
      OWNER,
      challenge,
    );
    expect(out).toMatchObject({
      approved: true,
      source: "confirm_deal",
      confirmed: true,
    });
    expect(t.order()).toMatchObject({
      status: S.APPROVED,
      approved_by: OWNER,
      negotiated_price: 190,
      quantity: 6,
    });
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    const letter = t.db.tables.procurement_conversations.find(
      (r: Row) => r.outbound_email_type === "ORDER_CONFIRMATION",
    );
    expect(letter).toMatchObject({ sent_by_user_id: OWNER });
    expect(t.changes()[0]).toMatchObject({ state: "approved" });
  });

  it("[REVERT-FAILS] dismissing the deal closes the confirmation held for a signature", async () => {
    const t = dealHouse();
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
    );
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    await t.service.dismissDeal(HOUSE, ORDER);
    expect(t.waiting()).toHaveLength(0);
    expect(t.changes()[0]).toMatchObject({ state: "superseded" });
    await expect(
      t.service.issuePriceChangeSeal(HOUSE, ORDER, OWNER),
    ).rejects.toThrow(/No price change is waiting/);
  });

  it("[REVERT-FAILS] the ruling reaches an approved order too: a manager re-confirming it higher waits", async () => {
    const t = build({
      status: S.APPROVED,
      order: { quoted_price: 150, negotiated_price: 150, total_cost: 900 },
      rules: [rule("manager_ceiling", { amount: 1000, role: "owner" })],
    });
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
    );
    const out = await t.service.confirmDeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
      challenge,
    );
    expect(out.confirmed).toBe(false);
    expect(t.order()).toMatchObject({
      status: S.APPROVED,
      negotiated_price: 150,
    });
  });
});

// ===========================================================================
// F4 — the POST orders merge is a price change too
// ===========================================================================

describe("F4: a re-quote merged into an approved order is a price change", () => {
  // The merge path needs the wine and the vendor on file.
  function mergeHouse(status: S) {
    const t = build({
      status,
      order: { inventory_id: "inv-1", unit_type: "bottle" },
    });
    t.db.tables.restaurant_inventory = [
      {
        id: "inv-1",
        restaurant_id: HOUSE,
        wine_name: "Yakut",
        master_wine_id: null,
        bottle_size_ml: 750,
      },
    ];
    t.db.tables.providers = [
      {
        id: "prov-1",
        restaurant_id: HOUSE,
        name: "Kavaklidere",
        is_active: true,
      },
    ];
    t.db.tables.procurement_order_items = [];
    return t;
  }
  const requote = {
    inventoryId: "inv-1",
    providerId: "prov-1",
    quantity: 10,
    finalPrice: 700,
  } as any; // 7,000

  it("[REVERT-FAILS] a manager's re-quote over the ceiling does not rewrite the approved order, and makes no new one", async () => {
    const t = mergeHouse(S.APPROVED);
    const out = await t.service.createOrder(HOUSE, MANAGER, requote, {
      source: "manual",
    });
    expect(out.id).toBe(ORDER);
    expect(out.pendingPriceChange).toMatchObject({
      source: "order_merge",
      requiredRole: "owner",
    });
    expect(t.db.tables.procurement_orders).toHaveLength(1);
    expect(t.order()).toMatchObject({
      quantity: 6,
      total_cost: 4200,
      status: S.APPROVED,
    });
    expect(t.waiting()[0]).toMatchObject({
      source: "order_merge",
      terms: { request: requote, source: "manual" },
    });
    expect(t.waiting()[0].figures_to).toMatchObject({
      quantity: 10,
      total_cost: 7000,
    });
  });

  it("[REVERT-FAILS] the owner's sealed approval folds the held request into THAT order", async () => {
    const t = mergeHouse(S.APPROVED);
    await t.service.createOrder(HOUSE, MANAGER, requote, { source: "manual" });
    const { challenge } = await t.service.issuePriceChangeSeal(
      HOUSE,
      ORDER,
      OWNER,
    );
    const out = await t.service.approvePriceChange(
      HOUSE,
      ORDER,
      OWNER,
      challenge,
    );
    expect(out).toMatchObject({ approved: true, source: "order_merge" });
    expect(t.db.tables.procurement_orders).toHaveLength(1);
    expect(t.order()).toMatchObject({
      quantity: 10,
      total_cost: 7000,
      status: S.APPROVED,
    });
    expect(t.changes()[0]).toMatchObject({ state: "approved" });
  });

  it("[REVERT-FAILS] a held merge whose order was placed with the vendor since is stale, and merges nowhere", async () => {
    const t = mergeHouse(S.APPROVED);
    await t.service.createOrder(HOUSE, MANAGER, requote, { source: "manual" });
    t.order().status = S.CONFIRMED;
    await expect(
      t.service.issuePriceChangeSeal(HOUSE, ORDER, OWNER),
    ).rejects.toThrow(/can no longer be approved/);
    expect(t.changes()[0]).toMatchObject({ state: "stale" });
    expect(t.db.tables.procurement_orders).toHaveLength(1);
    expect(t.order()).toMatchObject({ quantity: 6, total_cost: 4200 });
  });

  // Guards the ORDER of the two gates on the fold: D2's role gate (#538)
  // first, then D3's re-check. The other way round, staff over the rules
  // would get a held change instead of D2's refusal.
  it("staff are refused by D2's role gate before the re-check: nothing is held", async () => {
    const t = mergeHouse(S.APPROVED);
    await expect(
      t.service.createOrder(HOUSE, STAFF, requote, { source: "manual" }),
    ).rejects.toThrow(ForbiddenException);
    expect(t.changes()).toHaveLength(0);
    expect(t.order()).toMatchObject({ quantity: 6, total_cost: 4200 });
  });

  it("the merge into an order not yet approved is unchanged: it applies", async () => {
    const t = mergeHouse(S.NEGOTIATING);
    const out = await t.service.createOrder(HOUSE, MANAGER, requote, {
      source: "manual",
    });
    expect(out.pendingPriceChange).toBeUndefined();
    expect(t.order()).toMatchObject({ quantity: 10, total_cost: 7000 });
    expect(t.changes()).toHaveLength(0);
  });
});
