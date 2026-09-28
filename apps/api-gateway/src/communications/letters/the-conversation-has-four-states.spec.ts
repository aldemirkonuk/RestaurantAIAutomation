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
) {
  const db = build({
    integration_oauth_connections: grants,
    restaurant_feature_flags: flags,
    users: [{ name: "Aldemir" }],
  });
  return new HouseSenderService(db, NO_CONFIG).resolve(HOUSE, PERSON);
}

describe("the four states of a house's conversation", () => {
  it("STATE 1 — both grants and the switch on: the whole conversation is here", async () => {
    const identity = await resolveWith([sendGrant, readGrant], READER_ON);
    expect(identity.conversation.where).toBe("whole_conversation_here");
    expect(identity.conversation.words).toContain(
      "The whole conversation is on this house's mailbox",
    );
    // It names what is NOT involved, which is the whole point of the condition.
    expect(identity.conversation.words).toContain("notifications@wineops.ai");
    expect(identity.conversation.sending.granted).toBe(true);
    expect(identity.conversation.receiving.consented).toBe(true);
    expect(identity.conversation.receiving.switchedOn).toBe(true);
  });

  it("STATE 2 — send but no read: letters leave, replies still arrive on the shared mailbox", async () => {
    const identity = await resolveWith([sendGrant], READER_OFF);
    expect(identity.conversation.where).toBe("letters_leave_only");
    expect(identity.conversation.words).toContain("Letters leave from");
    expect(identity.conversation.words).toContain(
      "replies still arrive through notifications@wineops.ai",
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
    expect(identity.conversation.words).toContain("Gmail — sending only");
    // And the sending half stays exactly as honest as it was.
    expect(identity.kind).toBe("none");
    expect(identity.sendable).toBe(false);
  });

  it("STATE 4 — neither: the whole conversation is on the shared mailbox", async () => {
    const identity = await resolveWith([], READER_OFF);
    expect(identity.conversation.where).toBe("shared_mailbox");
    expect(identity.conversation.words).toContain("Neither half");
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
