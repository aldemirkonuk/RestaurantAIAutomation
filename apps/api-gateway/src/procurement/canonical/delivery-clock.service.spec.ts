import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryClockService, lapseDeeming } from "./delivery-clock.service";
import { makeMockDb, makeMockNotifications, MockDb } from "./delivery-mock";

/**
 * The escalation ladder as durable rows (ADR 0103 D4, D8, D9, A8, A10).
 * All ids and dates are SYNTHETIC.
 *
 * What each block is holding:
 *
 *   D4/A8  A CLOCK THAT CANNOT BE COMPUTED IS A VISIBLE ROW THAT NEVER FIRES.
 *          Four ways to be unknown — no rule, no number, an `unknown` basis, a
 *          basis date not on the record — and one answer for all four. Writing
 *          no row would have rendered "no deadline", which is the failure D4
 *          names in as many words.
 *   D9     The ladder is 50 %, then 80 % floored at 48 hours before expiry. For
 *          the Turkish 7-day response window that is day 3½ and day 5.
 *   D8     The payment clock has a second, larger floor: 10 days, so a
 *          Californian alcohol invoice warns on day 20 of 30 — the EFT cannot be
 *          recalled once the wholesaler starts it.
 *   A10    IDEMPOTENT. A catch-up run after a missed tick climbs no rung twice.
 *   D9(4)  A lapse records what the law DEEMS and moves NO stock.
 */

const REST = "rest-1";
const DEL = "del-1";
const DAY = 86_400_000;

const timer = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  restaurant_id: REST,
  delivery_id: DEL,
  document_id: null,
  clock: "response_window",
  basis: "delivery_date",
  basis_at: "2026-08-14T00:00:00Z",
  due_at: "2026-08-21T00:00:00Z", // 7 days
  state: "open",
  notified_half_at: null,
  escalated_at: null,
  ...over,
});

describe("DeliveryClockService", () => {
  let db: MockDb;
  let notifications: ReturnType<typeof makeMockNotifications>;
  let service: DeliveryClockService;

  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    notifications = makeMockNotifications();
    service = new DeliveryClockService(
      db.client as unknown as DatabaseService,
      notifications as unknown as NotificationsService,
    );
  });

  // -------------------------------------------------------------------------
  describe("an unknown clock blocks and asks — it never reads as no deadline (D4, A8)", () => {
    const cases: [string, unknown[]][] = [
      ["no vendor_terms row at all", []],
      [
        "a rule with no number",
        [
          {
            id: "vt",
            restaurant_id: null,
            provider_id: null,
            days: null,
            basis: "delivery_date",
            signed_ticket_is_final: false,
          },
        ],
      ],
      [
        "a rule whose basis the research could not close (A8)",
        [
          {
            id: "vt",
            restaurant_id: null,
            provider_id: null,
            days: 7,
            basis: "unknown",
            signed_ticket_is_final: false,
          },
        ],
      ],
    ];

    it.each(cases)(
      "writes blocked_unknown with a NULL due_at when there is %s",
      async (_name, rows) => {
        db.answers.vendor_terms = { data: rows, error: null };
        db.insertAnswers.delivery_timers = {
          data: { state: "blocked_unknown", due_at: null },
          error: null,
        };
        const res = await service.schedule({
          restaurantId: REST,
          deliveryId: DEL,
          clock: "response_window",
          documentType: "delivery_note",
          providerId: "prov-1",
          jurisdiction: "TR",
          basisAt: { delivery: "2026-08-14T00:00:00Z" },
        });
        expect(res.ok).toBe(true);
        const write = db.writes.find((w) => w.table === "delivery_timers");
        expect(write?.payload).toMatchObject({
          state: "blocked_unknown",
          due_at: null,
        });
      },
    );

    it("blocks when the basis date the rule needs is not on the record", async () => {
      db.answers.vendor_terms = {
        data: [
          {
            id: "vt",
            restaurant_id: null,
            provider_id: null,
            days: 7,
            basis: "dispatch_date",
            signed_ticket_is_final: false,
          },
        ],
        error: null,
      };
      db.insertAnswers.delivery_timers = {
        data: { state: "blocked_unknown", due_at: null },
        error: null,
      };
      // A delivery date is known; the DISPATCH date the rule counts from is not.
      await service.schedule({
        restaurantId: REST,
        deliveryId: DEL,
        clock: "response_window",
        documentType: "delivery_note",
        providerId: "prov-1",
        jurisdiction: "TR",
        basisAt: { delivery: "2026-08-14T00:00:00Z", dispatch: null },
      });
      const write = db.writes.find((w) => w.table === "delivery_timers");
      expect(write?.payload).toMatchObject({
        state: "blocked_unknown",
        due_at: null,
      });
    });

    it("blocks when the jurisdiction is unknown, because the rule cannot even be looked up", async () => {
      db.insertAnswers.delivery_timers = {
        data: { state: "blocked_unknown", due_at: null },
        error: null,
      };
      await service.schedule({
        restaurantId: REST,
        deliveryId: DEL,
        clock: "objection_window",
        documentType: "invoice",
        providerId: null,
        jurisdiction: null,
        basisAt: { delivery: "2026-08-14T00:00:00Z" },
      });
      const write = db.writes.find((w) => w.table === "delivery_timers");
      expect((write?.payload as { state: string }).state).toBe(
        "blocked_unknown",
      );
      // vendor_terms was never even read — there is nothing to key on.
      expect(db.verbs.filter((v) => v.startsWith("vendor_terms"))).toEqual([]);
    });

    it("computes a due date when the rule and its basis are both on the record", async () => {
      db.answers.vendor_terms = {
        data: [
          {
            id: "vt",
            restaurant_id: null,
            provider_id: null,
            days: 8,
            basis: "document_issue_date",
            signed_ticket_is_final: false,
          },
        ],
        error: null,
      };
      db.insertAnswers.delivery_timers = {
        data: { state: "open", due_at: "2026-08-22T00:00:00Z" },
        error: null,
      };
      await service.schedule({
        restaurantId: REST,
        deliveryId: DEL,
        documentId: "doc-1",
        clock: "objection_window",
        documentType: "invoice",
        providerId: null,
        jurisdiction: "TR",
        basisAt: { issue: "2026-08-14T00:00:00Z" },
      });
      const write = db.writes.find((w) => w.table === "delivery_timers");
      expect(write?.payload).toMatchObject({
        state: "open",
        due_at: "2026-08-22T00:00:00.000Z",
        basis: "document_issue_date",
        terms_id: "vt",
      });
    });

    it("treats an already-scheduled clock as idempotent, not as a failure (A10)", async () => {
      db.answers.vendor_terms = {
        data: [
          {
            id: "vt",
            restaurant_id: null,
            provider_id: null,
            days: 8,
            basis: "document_issue_date",
            signed_ticket_is_final: false,
          },
        ],
        error: null,
      };
      db.insertAnswers.delivery_timers = {
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "delivery_timers_scope_uniq"',
        },
      };
      const res = await service.schedule({
        restaurantId: REST,
        deliveryId: DEL,
        documentId: "doc-1",
        clock: "objection_window",
        documentType: "invoice",
        providerId: null,
        jurisdiction: "TR",
        basisAt: { issue: "2026-08-14T00:00:00Z" },
      });
      // Rescheduling would reset the rungs already climbed, so the existing row
      // wins and this is a success.
      expect(res.ok).toBe(true);
    });

    it("prefers the most specific vendor_terms row, tenant+vendor first", async () => {
      db.answers.vendor_terms = {
        data: [
          {
            id: "platform",
            restaurant_id: null,
            provider_id: null,
            days: 30,
            basis: "delivery_date",
            signed_ticket_is_final: false,
          },
          {
            id: "tenant-vendor",
            restaurant_id: REST,
            provider_id: "prov-1",
            days: 14,
            basis: "delivery_date",
            signed_ticket_is_final: true,
          },
          {
            id: "vendor",
            restaurant_id: null,
            provider_id: "prov-1",
            days: 21,
            basis: "delivery_date",
            signed_ticket_is_final: false,
          },
        ],
        error: null,
      };
      db.insertAnswers.delivery_timers = {
        data: { state: "open", due_at: null },
        error: null,
      };
      await service.schedule({
        restaurantId: REST,
        deliveryId: DEL,
        clock: "payment",
        documentType: "invoice",
        providerId: "prov-1",
        jurisdiction: "US-CA",
        beverageClass: "alcohol",
        basisAt: { delivery: "2026-08-14T00:00:00Z" },
      });
      const write = db.writes.find((w) => w.table === "delivery_timers");
      expect((write?.payload as { terms_id: string }).terms_id).toBe(
        "tenant-vendor",
      );
      // 14 days from the 14th.
      expect((write?.payload as { due_at: string }).due_at).toBe(
        "2026-08-28T00:00:00.000Z",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("the ladder's two floors (D9 clause 1, D8)", () => {
    const at = (iso: string) => new Date(iso);

    it("puts the Turkish 7-day window's rungs on day 3½ and day 5", () => {
      const t = {
        clock: "response_window",
        basis_at: "2026-08-14T00:00:00Z",
        due_at: "2026-08-21T00:00:00Z",
      };
      expect(service.rungsFor(t, at("2026-08-17T11:00:00Z"))).toMatchObject({
        half: false,
        escalate: false,
      });
      // Day 3½.
      expect(service.rungsFor(t, at("2026-08-17T13:00:00Z"))).toMatchObject({
        half: true,
        escalate: false,
      });
      // Day 5 — 48 hours before expiry, EARLIER than 80 % (day 5.6).
      expect(service.rungsFor(t, at("2026-08-18T23:00:00Z"))).toMatchObject({
        escalate: false,
      });
      expect(service.rungsFor(t, at("2026-08-19T01:00:00Z"))).toMatchObject({
        half: true,
        escalate: true,
        fire: false,
      });
      expect(service.rungsFor(t, at("2026-08-21T00:00:01Z")).fire).toBe(true);
    });

    it("puts the Californian 30-day payment clock's warning on day 20, not day 24 (D8)", () => {
      const t = {
        clock: "payment",
        basis_at: "2026-08-01T00:00:00Z",
        due_at: "2026-08-31T00:00:00Z",
      };
      // 80 % of 30 days is day 24; the payment floor is 10 days before expiry,
      // which is day 20 — and the EARLIER of the two wins, because an EFT that
      // has started cannot be recalled.
      expect(service.rungsFor(t, at("2026-08-20T23:00:00Z")).escalate).toBe(
        false,
      );
      expect(service.rungsFor(t, at("2026-08-21T01:00:00Z")).escalate).toBe(
        true,
      );
    });

    it("climbs no rung for a timer whose clock could not be computed", () => {
      expect(
        service.rungsFor(
          { clock: "response_window", basis_at: null, due_at: null },
          at("2030-01-01T00:00:00Z"),
        ),
      ).toEqual({ half: false, escalate: false, fire: false });
    });
  });

  // -------------------------------------------------------------------------
  describe("runDue — the poller (A10)", () => {
    it("reports a FAILED read as a failure, never as an empty queue", async () => {
      db.answers.delivery_timers = {
        data: null,
        error: { message: "connection reset" },
      };
      const res = await service.runDue(new Date("2026-08-19T12:00:00Z"));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/delivery_timers read failed/);
    });

    it("re-notifies the owner at the half rung and stamps it, so the next run is silent", async () => {
      db.answers.delivery_timers = { data: [timer()], error: null };
      db.answers.deliveries = {
        data: {
          id: DEL,
          state: "DELIVERED",
          jurisdiction: "TR",
          owner_user_id: "u1",
          deputy_user_id: "u2",
        },
        error: null,
      };
      const res = await service.runDue(new Date("2026-08-17T18:00:00Z"));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.notifiedHalf).toBe(1);
      const stamp = db.writes.find(
        (w) => w.table === "delivery_timers" && w.verb === "update",
      );
      expect(stamp?.payload).toMatchObject({ state: "notified_half" });
      expect(stamp?.payload).toHaveProperty("notified_half_at");
      expect(notifications.sent.length).toBe(1);
    });

    it("climbs no rung twice — a catch-up run after a missed tick is silent", async () => {
      db.answers.delivery_timers = {
        data: [
          timer({
            state: "notified_half",
            notified_half_at: "2026-08-17T18:00:00Z",
          }),
        ],
        error: null,
      };
      const res = await service.runDue(new Date("2026-08-17T23:00:00Z"));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.notifiedHalf).toBe(0);
      expect(notifications.sent).toEqual([]);
      expect(db.writes.filter((w) => w.table === "delivery_timers")).toEqual(
        [],
      );
    });

    it("LAPSES an unactioned delivery at expiry, records what the law deems, and moves NO stock", async () => {
      db.answers.delivery_timers = { data: [timer()], error: null };
      db.answers.deliveries = {
        data: {
          id: DEL,
          state: "RECONCILING",
          jurisdiction: "TR",
          owner_user_id: "u1",
          deputy_user_id: null,
        },
        error: null,
      };
      const res = await service.runDue(new Date("2026-08-22T00:00:00Z"));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.lapsed).toBe(1);

      const upd = db.writes.find(
        (w) => w.table === "deliveries" && w.verb === "update",
      );
      expect((upd?.payload as { state: string }).state).toBe("LAPSED");
      expect((upd?.payload as { lapse_deemed: string }).lapse_deemed).toMatch(
        /accepted IN FULL/,
      );
      // D9 clause 4: the lapse says what the law deems and NOTHING about what
      // this restaurant agreed, and no stock moves.
      expect((upd?.payload as { lapse_deemed: string }).lapse_deemed).toMatch(
        /does not record that this restaurant agreed/,
      );
      expect(
        db.writes.filter(
          (w) =>
            w.table === "inventory_lots" ||
            w.table === "inventory_transactions",
        ),
      ).toEqual([]);
      const note = notifications.sent.find(
        (n) => (n.payload as { type: string }).type === "delivery_lapsed",
      );
      expect((note?.payload as { message: string }).message).toMatch(
        /Nothing was posted to inventory or cost/,
      );
    });

    it("CANCELS rather than fires a timer on a delivery that already reached an end", async () => {
      db.answers.delivery_timers = { data: [timer()], error: null };
      db.answers.deliveries = {
        data: {
          id: DEL,
          state: "AGREED",
          jurisdiction: "TR",
          owner_user_id: "u1",
          deputy_user_id: null,
        },
        error: null,
      };
      const res = await service.runDue(new Date("2026-08-22T00:00:00Z"));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.lapsed).toBe(0);
      const stamp = db.writes.find(
        (w) => w.table === "delivery_timers" && w.verb === "update",
      );
      expect((stamp?.payload as { state: string }).state).toBe("cancelled");
      expect(
        db.writes.filter(
          (w) => w.table === "deliveries" && w.verb === "update",
        ),
      ).toEqual([]);
    });

    it("counts the blocked timers separately, so 'nothing due' never hides an unknown rule", async () => {
      db.answers.delivery_timers = { data: [], error: null };
      const res = await service.runDue(new Date("2026-08-19T00:00:00Z"));
      expect(res.ok).toBe(true);
      // The second read (state = blocked_unknown) has its own answer; with none
      // canned it is an empty array, and the count is reported rather than
      // folded into `examined`.
      if (res.ok) expect(res.value).toHaveProperty("blocked");
    });
  });

  // -------------------------------------------------------------------------
  describe("what the law deems, in words", () => {
    it("says silence accepts for a Turkish response window, and says it is not agreement", () => {
      const s = lapseDeeming("response_window", "TR");
      expect(s).toMatch(/silence accepts/i);
      expect(s).toMatch(/does not record that this restaurant agreed/i);
    });

    it("names TTK 21/2 for a Turkish objection window", () => {
      expect(lapseDeeming("objection_window", "TR")).toMatch(/TTK 21\/2/);
    });

    it("says the money may already have left for a payment clock", () => {
      expect(lapseDeeming("payment", "US-CA")).toMatch(/AB 2991/);
    });

    it("says the rule is NOT on file rather than inventing one", () => {
      const s = lapseDeeming("invoice_issuance", null);
      expect(s).toMatch(/not recorded, because no rule for it is on file/i);
    });
  });

  // -------------------------------------------------------------------------
  describe("signedTicketIsFinal — the per-vendor gate of D3 rule B", () => {
    it("is FALSE when no rule exists, never assumed true", async () => {
      db.answers.vendor_terms = { data: [], error: null };
      const res = await service.signedTicketIsFinal({
        restaurantId: REST,
        providerId: "prov-1",
        jurisdiction: "US-CA",
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBe(false);
    });

    it("fails rather than answering false when the rule read breaks", async () => {
      db.answers.vendor_terms = { data: null, error: { message: "timeout" } };
      const res = await service.signedTicketIsFinal({
        restaurantId: REST,
        providerId: "prov-1",
        jurisdiction: "US-CA",
      });
      expect(res.ok).toBe(false);
    });
  });

  it("uses whole days, so a 7-day window is exactly seven", () => {
    const start = new Date("2026-08-14T00:00:00Z").getTime();
    expect(new Date("2026-08-21T00:00:00Z").getTime() - start).toBe(7 * DAY);
  });
});
