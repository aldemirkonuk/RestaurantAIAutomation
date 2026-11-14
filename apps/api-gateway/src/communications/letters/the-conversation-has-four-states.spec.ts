/**
 * Where this house's conversation lives, in four states and never a boolean
 * (founder, 2026-09-04; ADR 0118, receive half).
 *
 * The founder let the sending grant stay send-only ON CONDITION that the house
 * could also receive on its own mailbox and have the whole conversation there.
 * That condition makes "does this house have its own mailbox?" a question a
 * boolean cannot answer: letters leaving and replies arriving are separately
 * granted and separately revocable, and the arrangement the condition exists to
 * end — the house's own address on the envelope, the shared deployment mailbox
 * on the reply — is exactly the one a single "own mailbox: yes" would have
 * described as finished.
 *
 * These tests pin the four sentences, and the fifth answer that is not a state:
 * a failed read is `unknown`, not `shared_mailbox`.
 *
 * They also pin the thing most likely to be quietly wrong later: **a consent is
 * not a switch.** A house where somebody granted reading but
 * `enable_house_inbox_read` is off is NOT being read, and it is placed with the
 * houses that are not.
 */

import { DatabaseService } from "../../database/database.service";
import {
  HouseSenderService,
  GMAIL_SEND_SCOPE,
} from "./house-sender.service";
import { GMAIL_READ_SCOPE } from "../inbox/house-inbox-flag";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";

function build(
  rows: Record<
    string,
    Record<string, unknown>[] | { error: { message: string } }
  >,
) {
  const chain = (
    payload: Record<string, unknown>[] | { error: { message: string } },
  ) => {
    const failed = !Array.isArray(payload);
    const data = Array.isArray(payload) ? payload : null;
    const error = failed
      ? (payload as { error: { message: string } }).error
      : null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.is = pass;
    self.order = pass;
    self.limit = pass;
    self.maybeSingle = () =>
      Promise.resolve({ data: data?.[0] ?? null, error });
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve);
    return self;
  };
  return {
    client: { from: (table: string) => chain(rows[table] ?? []) },
  } as unknown as DatabaseService;
}

const NO_CONFIG = { get: () => undefined } as never;

const sendGrant = {
  id: "grant-send",
  user_id: PERSON,
  integration_id: "gmail_send",
  provider: "google",
  account_email: null,
  scopes: [GMAIL_SEND_SCOPE],
  restaurant_id: HOUSE,
  revoked_at: null,
};

const readGrant = {
  id: "grant-read",
  user_id: PERSON,
  integration_id: "gmail_read",
  provider: "google",
  account_email: null,
  scopes: [GMAIL_READ_SCOPE],
  restaurant_id: HOUSE,
  revoked_at: null,
};

const READER_ON = [{ enable_house_inbox_read: true }];
const READER_OFF = [{ enable_house_inbox_read: false }];

function resolveWith(
  grants: Record<string, unknown>[] | { error: { message: string } },
  flags: Record<string, unknown>[],
  viewer?: { role?: string | null },
) {
  const db = build({
    integration_oauth_connections: grants,
    restaurant_feature_flags: flags,
    users: [{ name: "Aldemir" }],
  });
  return new HouseSenderService(db, NO_CONFIG).resolve(HOUSE, PERSON, viewer);
}

describe("the four states of a house's conversation", () => {
  it("STATE 1 — both grants and the switch on: the house sends and reads its own mail", async () => {
    const identity = await resolveWith([sendGrant, readGrant], READER_ON);
    expect(identity.conversation.where).toBe("whole_conversation_here");
    // r36 gap 3: neither grant recorded an address, so "the same mailbox"
    // is not claimed; the words say it is not recorded.
    expect(identity.conversation.words).not.toContain(
      "The whole conversation is on this house's mailbox",
    );
    expect(identity.conversation.words).toContain("This house sends and reads its own vendor mail.");
    expect(identity.conversation.words).toContain("Whether that is the mailbox letters leave from is not recorded");
    // Order letters still leave from the shared address (#1050), so it is named.
    expect(identity.conversation.words).toContain(
      "Order letters leave from notifications@mudavym.com",
    );
    expect(identity.conversation.sending.granted).toBe(true);
    expect(identity.conversation.receiving.consented).toBe(true);
    expect(identity.conversation.receiving.switchedOn).toBe(true);
  });

  it("STATE 2 — send but no read: letters leave, and with no Mudavym address the answer is not seen", async () => {
    const identity = await resolveWith([sendGrant], READER_OFF);
    expect(identity.conversation.where).toBe("letters_leave_only");
    expect(identity.conversation.words).toContain("Letters written here leave from");
    // r36 gap 1: a house letter's answer goes back to the sending mailbox,
    // not to the shared one, and nothing reads it.
    expect(identity.conversation.words).not.toContain("replies still arrive through");
    expect(identity.conversation.words).toContain(
      "nothing reads it, so the answer will not show in Mail",
    );
    // The reading grant is named by its own label, so the advice is actionable.
    expect(identity.conversation.words).toContain(
      "Gmail — reading vendor replies only",
    );
    expect(identity.conversation.receiving.consented).toBe(false);
    // The sending half is unaffected: a letter may still be queued.
    expect(identity.kind).toBe("house_mailbox");
    expect(identity.sendable).toBe(true);
  });

  it("STATE 3 — read but no send: replies arrive, no letter may leave", async () => {
    const identity = await resolveWith([readGrant], READER_ON);
    expect(identity.conversation.where).toBe("replies_arrive_only");
    expect(identity.conversation.words).toContain(
      "read from its own mailbox and filed in the book",
    );
    expect(identity.conversation.words).toContain("no letter may leave");
    // r21: like STATE 4, order letters still leave, from the shared address.
    expect(identity.conversation.words).toContain(
      "Order letters leave from notifications@mudavym.com",
    );
    expect(identity.conversation.words).toContain("Gmail — sending only");
    // And the sending half stays exactly as honest as it was.
    expect(identity.kind).toBe("none");
    expect(identity.sendable).toBe(false);
  });

  it("STATE 4 — neither: the whole conversation is on the shared mailbox", async () => {
    const identity = await resolveWith([], READER_OFF);
    expect(identity.conversation.where).toBe("shared_mailbox");
    expect(identity.conversation.words).toContain(
      "Nothing runs through a mailbox of this house's own yet",
    );
    // r12 walk: order letters DO leave, from the shared address, so the
    // sentence may not say no letter leaves at all — only the house's own.
    expect(identity.conversation.words).toContain("Order letters leave from");
    expect(identity.conversation.words).toContain(
      "a letter written here to a vendor cannot leave",
    );
    expect(identity.conversation.words).not.toMatch(/no letter may leave at all/i);
    expect(identity.conversation.words).toContain(
      "every restaurant on this deployment shares",
    );
    // Two connections, each asking for one thing — the founder's shape.
    expect(identity.conversation.words).toContain("Gmail — sending only");
    expect(identity.conversation.words).toContain(
      "Gmail — reading vendor replies only",
    );
  });
});

describe("a consent is not a switch", () => {
  it("does not claim replies are arriving when the reader is switched off", async () => {
    const identity = await resolveWith([sendGrant, readGrant], READER_OFF);
    // Placed by what IS happening, not by what could be.
    expect(identity.conversation.where).toBe("letters_leave_only");
    expect(identity.conversation.receiving.consented).toBe(true);
    expect(identity.conversation.receiving.switchedOn).toBe(false);
    // And it says which of the two doors is shut, so nobody is sent to connect
    // a grant they already have.
    expect(identity.conversation.words).toContain(
      "Somebody here has consented to reading",
    );
    expect(identity.conversation.words).toContain("the consent is not the switch");
    // r21: the switch is named as the owner sees it in Settings; the flag
    // key stays a field, never a word on the page.
    expect(identity.conversation.words).toContain(
      `"Read this house's mailbox" switch in Settings is off`,
    );
    expect(identity.conversation.words).not.toContain("enable_house_inbox_read");
    expect(identity.conversation.receiving.switch).toBe(
      "enable_house_inbox_read",
    );
  });

  it("names the reading grant to connect when nobody has consented", async () => {
    const identity = await resolveWith([sendGrant], READER_ON);
    expect(identity.conversation.where).toBe("letters_leave_only");
    expect(identity.conversation.words).not.toContain(
      "Somebody here has consented",
    );
    expect(identity.conversation.words).toContain("Connect");
  });
});

/**
 * r21 walk D3 (2026-11-13): the switch sentence told an OWNER "An owner or a
 * manager can turn it on", about a switch the owner holds. Who may turn it on
 * is now said to the person reading; with no role the plain rule stays.
 */
describe("the switch sentence knows who is reading", () => {
  const offButConsented = () => [[sendGrant, readGrant], READER_OFF] as const;

  it.each(["owner", "manager", " Owner "])(
    "%s: is told the switch is theirs",
    async (role) => {
      const [g, f] = offButConsented();
      const words = (await resolveWith([...g], [...f], { role })).conversation.words;
      expect(words).toContain("the consent is not the switch. You can turn it on there.");
      expect(words).not.toContain("An owner or a manager can turn it on");
    },
  );

  it("staff: is told who can, and to ask", async () => {
    const [g, f] = offButConsented();
    const words = (await resolveWith([...g], [...f], { role: "staff" })).conversation.words;
    expect(words).toContain(
      "Only an owner or a manager can turn it on; ask one of them.",
    );
    expect(words).not.toContain("You can turn it on");
  });

  it("no role given (the dispatcher's read): the plain rule, no 'you'", async () => {
    const [g, f] = offButConsented();
    for (const viewer of [undefined, {}, { role: null }, { role: "  " }]) {
      const words = (await resolveWith([...g], [...f], viewer)).conversation.words;
      expect(words).toContain("the consent is not the switch. An owner or a manager can turn it on.");
      expect(words).not.toContain("You can");
    }
  });

  it("the shared-mailbox arrangement carries the same per-reader clause", async () => {
    const identity = await resolveWith([readGrant], READER_OFF, { role: "owner" });
    expect(identity.conversation.where).toBe("shared_mailbox");
    expect(identity.conversation.words).toContain("You can turn it on there.");
  });
});

/**
 * r21 (2026-11-13): the sentence is shown to an owner on /communications
 * (Mail setup and the intake sheet). It carries no flag key, no route path,
 * and no "Half of it." / "The other half." openers that point at a sentence
 * the owner never saw.
 */
describe("the sentence is in the house's words", () => {
  const arrangements: [string, Record<string, unknown>[], Record<string, unknown>[]][] = [
    ["both", [sendGrant, readGrant], READER_ON],
    ["send, reader off", [sendGrant, readGrant], READER_OFF],
    ["send only", [sendGrant], READER_ON],
    ["read only", [readGrant], READER_ON],
    ["read consented, switch off", [readGrant], READER_OFF],
    ["neither", [], READER_OFF],
  ];
  it.each(arrangements)("%s: no flag key, no path, no half", async (_n, grants, flags) => {
    const identity = await resolveWith(grants, flags);
    const words = identity.conversation.words;
    expect(words).not.toMatch(/enable_[a-z_]+/);
    expect(words).not.toMatch(/(^|\s)\/[a-z]/);
    expect(words).not.toMatch(/\bhalf\b/i);
  });
});

describe("a failed read is not a fifth arrangement", () => {
  it("says unknown rather than placing the house on the shared mailbox", async () => {
    const identity = await resolveWith(
      { error: { message: "connection reset" } },
      READER_OFF,
    );
    expect(identity.kind).toBe("unknown");
    expect(identity.conversation.where).toBe("unknown");
    expect(identity.conversation.words).toContain("could not be read");
    expect(identity.conversation.words).toContain("This is a failed read");
    expect(identity.conversation.sending.granted).toBe("unknown");
    expect(identity.conversation.receiving.consented).toBe("unknown");
  });
});

describe("the shared mailbox is named, never blank", () => {
  it("names the default address when GMAIL_SENDER_EMAIL is set but empty", async () => {
    const db = build({
      integration_oauth_connections: [sendGrant],
      restaurant_feature_flags: READER_OFF,
      users: [{ name: "Aldemir" }],
    });
    const config = { get: () => "  " } as never;
    const identity = await new HouseSenderService(db, config).resolve(
      HOUSE,
      PERSON,
    );
    expect(identity.conversation.words).toContain("notifications@mudavym.com");
    expect(identity.conversation.words).not.toContain("through ,");
  });
});

describe("the read grant never becomes a sending identity", () => {
  it("leaves a read-only house unable to send, whatever the reader says", async () => {
    const identity = await resolveWith([readGrant], READER_ON);
    expect(identity.kind).toBe("none");
    expect(identity.sendable).toBe(false);
    expect(identity.ceremony).toBe("none");
    expect(identity.grant).toBeNull();
    // The scope check is what keeps them apart.
    expect(GMAIL_READ_SCOPE).not.toBe(GMAIL_SEND_SCOPE);
  });
});

/**
 * r36 mail audit, gaps 1 and 3: the words say where a vendor's answer goes
 * and which mailbox is read, from what the send does and what the grants
 * recorded, never from "a send grant and a read grant exist".
 */
describe("the words say where an answer goes and which mailbox is read", () => {
  const DOOR_CONFIG = {
    get: (k: string) => (k === "INBOUND_EMAIL_DOMAIN" ? "in.example.test" : undefined),
  } as never;
  const withDoor = (grants: Record<string, unknown>[], flags: Record<string, unknown>[]) =>
    new HouseSenderService(
      build({ integration_oauth_connections: grants, restaurant_feature_flags: flags, users: [{ name: "Aldemir" }] }),
      DOOR_CONFIG,
    ).resolve(HOUSE, PERSON);
  const named = (g: Record<string, unknown>, email: string) => ({ ...g, account_email: email });

  it("send only, with a Mudavym address: the answer comes back there", async () => {
    const identity = await withDoor([sendGrant], READER_OFF);
    expect(identity.conversation.where).toBe("letters_leave_only");
    expect(identity.conversation.words).toContain("comes back to this house's Mudavym address");
    expect(identity.conversation.words).not.toContain("will not show in Mail");
  });

  it("both, with a Mudavym address: the answer comes back there, never 'the same mailbox'", async () => {
    const identity = await withDoor(
      [named(sendGrant, "office@house.test"), named(readGrant, "office@house.test")],
      READER_ON,
    );
    expect(identity.conversation.words).toContain("comes back to this house's Mudavym address");
    expect(identity.conversation.words).not.toContain("comes back to that same mailbox");
    expect(identity.conversation.words).not.toContain("The whole conversation is on this house's mailbox");
  });

  it("both, no Mudavym address, the same recorded address: the whole conversation is here", async () => {
    const identity = await resolveWith(
      [named(sendGrant, "Office@House.test"), named(readGrant, "office@house.test")],
      READER_ON,
    );
    expect(identity.conversation.words).toContain("The whole conversation is on this house's mailbox.");
    expect(identity.conversation.words).toContain("Mail is read from office@house.test, the same mailbox letters leave from.");
    expect(identity.conversation.words).toContain("comes back to that same mailbox");
  });

  it("both, two different recorded addresses: says so, and does not claim the answer is read", async () => {
    const identity = await resolveWith(
      [named(sendGrant, "owner@house.test"), named(readGrant, "manager@house.test")],
      READER_ON,
    );
    const words = identity.conversation.words;
    expect(words).toContain("Letters leave from owner@house.test; mail is read from manager@house.test, a different mailbox.");
    expect(words).toContain("shows in Mail only when that mailbox is one being read");
    expect(words).not.toContain("The whole conversation is on this house's mailbox");
  });

  it("names every mailbox that is read, once each", async () => {
    const second = { ...named(readGrant, "chef@house.test"), id: "grant-read-2" };
    const identity = await resolveWith(
      [sendGrant, named(readGrant, "office@house.test"), second, { ...named(readGrant, "OFFICE@house.test"), id: "grant-read-3" }],
      READER_ON,
    );
    expect(identity.conversation.words).toContain("mail is read from office@house.test, chef@house.test.");
  });

  it("neither, with a Mudavym address: an order's answer comes back there", async () => {
    const identity = await withDoor([], READER_OFF);
    expect(identity.conversation.where).toBe("shared_mailbox");
    expect(identity.conversation.words).toContain(
      "A vendor's answer to an order comes back to this house's Mudavym address",
    );
  });

  it("neither, with no Mudavym address: an order's answer arrives at the shared address", async () => {
    const identity = await resolveWith([], READER_OFF);
    expect(identity.conversation.words).toContain(
      "A vendor's answer to an order arrives at notifications@mudavym.com",
    );
  });
});
