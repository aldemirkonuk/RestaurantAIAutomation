/**
 * Gap G2 (mail software, 2026-11-11): the bridge tells a letter's
 * `mail_intake` row what became of it, and a letter it could not store is
 * kept for another try instead of only logged. On the stack head this was
 * built on (4be3b63e6) the bridge returned void, only logged a refused
 * insert, and swallowed a hold that failed.
 */
import { bridge, inbound, Row } from "./testing/mail-store";

const VENDOR = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist",
  contact_email: "sales@bigdist.com",
};
const house = (): Record<string, Row[]> => ({
  providers: [VENDOR],
  procurement_orders: [],
  procurement_conversations: [],
});

function intakeSpy() {
  const calls: Array<[string, string, string?]> = [];
  return {
    calls,
    intake: {
      settle: async (id: string, outcome: string) => void calls.push(["settle", id, outcome]),
      fail: async (id: string, why: string) => void calls.push(["fail", id, why]),
    },
  };
}

describe("the bridge tells the intake row what became of a letter", () => {
  it("a filed letter settles as filed", async () => {
    const { svc, inserts } = bridge(house());
    const { calls, intake } = intakeSpy();
    svc.mailIntake = intake;
    await svc.fileInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: "sales@bigdist.com",
        gmail_message_id: "g1",
        intake_id: "in-1",
      }),
    );
    expect(inserts.filter((i) => i.table === "procurement_conversations")).toHaveLength(1);
    expect(inserts[0].row.email_headers.intake_id).toBe("in-1");
    expect(calls).toEqual([["settle", "in-1", "filed"]]);
  });

  it("a refused insert marks the row failed, so it is tried again", async () => {
    const { svc } = bridge(house(), [], ["procurement_conversations"]);
    const { calls, intake } = intakeSpy();
    svc.mailIntake = intake;
    await svc.fileInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: "sales@bigdist.com",
        gmail_message_id: "g2",
        intake_id: "in-2",
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("fail");
    expect(calls[0][2]).toMatch(/insert/);
  });

  it("a re-driven letter that was already stored is a duplicate, not a second row", async () => {
    const tables = house();
    tables.procurement_conversations.push({
      id: "pc-1",
      restaurant_id: "house-A",
      email_headers: { intake_id: "in-3" },
    });
    const { svc, inserts } = bridge(tables);
    const { calls, intake } = intakeSpy();
    svc.mailIntake = intake;
    await svc.fileInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: "sales@bigdist.com",
        intake_id: "in-3",
        intake_attempt: 2,
      }),
    );
    expect(inserts).toEqual([]);
    expect(calls).toEqual([["settle", "in-3", "duplicate"]]);
  });

  it("a letter a house reads again (attempt 1 again) that was already stored is a duplicate", async () => {
    // readAgain resets attempts to 0, claim_mail_intake makes it 1: the
    // stored-row check must not depend on the attempt number.
    const tables = house();
    tables.procurement_conversations.push({
      id: "pc-6",
      restaurant_id: "house-A",
      email_headers: { intake_id: "in-6" },
    });
    const { svc, inserts } = bridge(tables);
    const { calls, intake } = intakeSpy();
    svc.mailIntake = intake;
    await svc.fileInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: "sales@bigdist.com",
        intake_id: "in-6",
        intake_attempt: 1,
      }),
    );
    expect(inserts).toEqual([]);
    expect(calls).toEqual([["settle", "in-6", "duplicate"]]);
  });

  it("a letter that could not be held is offered again", async () => {
    const { svc } = bridge(house());
    svc.prospects.holdLetter = async () => ({ captured: false });
    const { calls, intake } = intakeSpy();
    svc.mailIntake = intake;
    await svc.fileInboundEmail(
      inbound({ restaurant_id: "house-A", from: "a, b", intake_id: "in-4" }),
    );
    expect(calls[0][0]).toBe("fail");
  });

  it("a sender outside the book, not outreach, settles as not kept", async () => {
    const { svc } = bridge(house());
    const { calls, intake } = intakeSpy();
    svc.mailIntake = intake;
    await svc.fileInboundEmail(
      inbound({ restaurant_id: "house-A", from: "someone@else.example", intake_id: "in-5" }),
    );
    expect(calls).toEqual([["settle", "in-5", "not_kept"]]);
  });
});

