/**
 * QA round 24 (2026-11-07): a letter held for a person, filed under no vendor,
 * is its own email_prospects row (held_reason set), shown in the house's "Who
 * is writing" list, never folded into a domain's prospect row and never added
 * as a vendor. The bridge's two holders build on this.
 */
import { ProspectsService } from "../common/orchestrator/prospects.service";
import { memoryDb, Row } from "./testing/mail-store";

const VENDOR = "sales@bigdist.com";

describe("ProspectsService: a held letter is its own row, and never a vendor", () => {
  const svc = (tables: Record<string, Row[]>) => {
    const db = memoryDb(tables);
    return {
      p: new ProspectsService({ supabase: db.supabase } as any, { get: () => undefined } as any),
      tables,
      inserts: db.inserts,
    };
  };

  it("two held letters from one domain are two rows, not one overwritten", async () => {
    const { p, inserts } = svc({ email_prospects: [] });
    for (const id of ["m-1", "m-2"]) {
      const r = await p.holdLetter({
        restaurantId: "house-A",
        heldReason: "sender_unconfirmed",
        senderEmail: VENDOR,
        subject: id,
        gmailMessageId: id,
      });
      expect(r).toMatchObject({ captured: true, isNew: true });
    }
    const rows = inserts.filter((i) => i.table === "email_prospects").map((i) => i.row);
    expect(rows.map((r) => [r.subject, r.held_reason, r.domain])).toEqual([
      ["m-1", "sender_unconfirmed", "bigdist.com"],
      ["m-2", "sender_unconfirmed", "bigdist.com"],
    ]);
  });

  it("is idempotent on the Gmail message id", async () => {
    const { p, inserts } = svc({ email_prospects: [] });
    const letter = {
      restaurantId: null,
      heldReason: "sender_unreadable" as const,
      senderEmail: null,
      gmailMessageId: "m-1",
    };
    await p.holdLetter(letter);
    expect(await p.holdLetter(letter)).toMatchObject({ captured: false, duplicate: true });
    expect(inserts.filter((i) => i.table === "email_prospects")).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({ domain: "", sender_email: null, restaurant_id: null });
  });

  it("a stranger's letter does not fold into a held letter of the same domain", async () => {
    const HELD = {
      id: "held-1",
      restaurant_id: "house-A",
      domain: "bigdist.com",
      held_reason: "sender_unconfirmed",
      message_count: 1,
      status: "new",
    };
    const { p, inserts } = svc({ email_prospects: [HELD] });
    const r = await p.captureFromColdEmail({
      senderEmail: "new@bigdist.com",
      subject: "Our catalogue",
      restaurantId: "house-A",
    });
    expect(r).toMatchObject({ captured: true, isNew: true });
    const row = inserts.find((i) => i.table === "email_prospects")?.row;
    expect(row).toMatchObject({ domain: "bigdist.com", subject: "Our catalogue" });
    expect(row?.held_reason).toBeUndefined();
  });

  it("a held letter is never promoted to a vendor", async () => {
    const { p, inserts } = svc({
      email_prospects: [
        {
          id: "held-1",
          restaurant_id: "house-A",
          domain: "bigdist.com",
          sender_email: VENDOR,
          status: "new",
          held_reason: "sender_unconfirmed",
        },
      ],
      providers: [],
    });
    expect(await p.promote("house-A", "held-1")).toMatchObject({ promoted: false });
    expect(inserts.filter((i) => i.table === "providers")).toEqual([]);
  });

  it("the list says why a letter is held", async () => {
    const { p } = svc({
      email_prospects: [
        {
          id: "held-1",
          restaurant_id: "house-A",
          domain: "",
          sender_email: null,
          status: "new",
          held_reason: "sender_unreadable",
          attachments: [],
        },
      ],
    });
    const list = await p.list("house-A");
    expect(list[0]).toMatchObject({ held_reason: "sender_unreadable" });
  });
});
