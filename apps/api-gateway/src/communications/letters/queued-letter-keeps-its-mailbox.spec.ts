/**
 * A queued letter leaves from the mailbox it was queued under, or not at all
 * (QA round 26, #973 defect 1).
 *
 * `queue()` names the mailbox to the writer and pins its grant on the letter.
 * The two-minute undo window is long enough for an owner to choose another
 * mailbox for the house, and the cron used to re-resolve at send time, so a
 * letter approved as leaving from A could leave from B. Now the cron sends
 * through the pinned grant, and refuses visibly if that grant can no longer
 * send — never switching to another mailbox in silence.
 *
 * The fake database really filters (fake-db.testing.ts), so a read that drops
 * the pin's id or the house filter answers with the wrong grant and fails here.
 */

import { HouseLettersService, LETTER_STATUS } from "./house-letters.service";
import { HouseSenderService } from "./house-sender.service";
import { CHEF, G_CHEF, G_MINE, G_OTHER, G_REVOKED, HOUSE, ME, TableSpec, fakeDb, grants } from "../mail-setup/fake-db.testing";

const NOW = Date.parse("2026-11-07T10:00:00Z");

function letter(headers: Record<string, unknown>) {
  return {
    id: "letter-1",
    restaurant_id: HOUSE,
    provider_id: "p-1",
    status: LETTER_STATUS.QUEUED,
    scheduled_send_at: "2026-11-07T09:58:00.000Z",
    message_text: "Merhaba",
    email_headers: { to: "vendor@vendor.test", subject: "Order", written_by: ME, ...headers },
  };
}

function build(row: Record<string, unknown>, tables: Record<string, TableSpec> = {}) {
  const db = fakeDb({
    integration_oauth_connections: { rows: grants() },
    users: { rows: [] },
    // The owner chose the chef's mailbox AFTER this letter was queued.
    house_mail_sender_choice: { rows: [{ restaurant_id: HOUSE, connection_id: G_CHEF, chosen_by: CHEF }] },
    procurement_conversations: { rows: [row] },
    ...tables,
  });
  const sender = new HouseSenderService(db as any, { get: () => undefined } as any);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") };
  const svc = new HouseLettersService(db as any, sender, oauth as any);
  const sent: string[] = [];
  (globalThis as any).fetch = jest.fn(async (_url: string, init: RequestInit) => {
    sent.push(Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString("utf8"));
    return { ok: true, status: 200, json: async () => ({ id: "g-1" }), text: async () => "" };
  });
  return { db, svc, oauth, sent };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

const failureOf = (db: ReturnType<typeof fakeDb>) =>
  db.writes.find((w) => w.payload?.status === LETTER_STATUS.FAILED)?.payload?.constraint_flags?.house_letter_failure as
    | string
    | undefined;

describe("a queued letter keeps the mailbox it was queued under", () => {
  it("leaves from the pinned mailbox even after the house chose another", async () => {
    const { svc, oauth, sent } = build(letter({ sender_connection_id: G_MINE, sender_address: "me@house.test" }));
    const out = await svc.dispatchDue(NOW);
    expect(out).toMatchObject({ sent: 1, failed: 0 });
    // The token is asked for on the pinned grant's person, not the chef's.
    expect(oauth.getAccessToken).toHaveBeenCalledWith(ME, HOUSE, "gmail_send");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("From: me@house.test");
    expect(sent[0]).not.toContain("office@house.test");
  });

  it("a pinned mailbox that was disconnected is refused in words, and nothing leaves from another", async () => {
    const { db, svc, oauth, sent } = build(letter({ sender_connection_id: G_REVOKED, sender_address: "old@house.test" }));
    const out = await svc.dispatchDue(NOW);
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toEqual([]);
    expect(oauth.getAccessToken).not.toHaveBeenCalled();
    const said = failureOf(db);
    expect(said).toContain("old@house.test");
    expect(said).toContain("not from another mailbox either");
  });

  it("a pin naming another house's mailbox is refused, never sent", async () => {
    const { db, svc, sent } = build(letter({ sender_connection_id: G_OTHER }));
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toEqual([]);
    expect(failureOf(db)).toContain("not from another mailbox either");
  });

  it("a pin that could not be read is refused, never guessed", async () => {
    const { db, svc, sent } = build(letter({ sender_connection_id: G_MINE }), {
      integration_oauth_connections: { error: { message: "timeout" } },
    });
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toEqual([]);
    expect(failureOf(db)).toContain("could not be read");
  });

  it("a letter queued before pins existed still follows the house's rule", async () => {
    const { svc, sent } = build(letter({}));
    expect(await svc.dispatchDue(NOW)).toMatchObject({ sent: 1 });
    expect(sent[0]).toContain("From: office@house.test");
  });
});
