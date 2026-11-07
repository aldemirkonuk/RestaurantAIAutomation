/**
 * Which member's mailbox a house letter leaves from, when the person asking
 * has no sending grant of their own (proposal G11, fork F7).
 *
 * Before this, `resolve` took the first sending grant in whatever order the
 * database returned them. PostgREST row order is unspecified, so the same
 * letter could leave from different mailboxes on different calls, and the
 * screen's "Sends from ..." line could name a mailbox the send did not use.
 *
 * The rule pinned here: the asker's own grant first; otherwise the house's
 * OLDEST live sending grant by `connected_at`, ties broken by the lower `id`.
 * The rows are fed in a deliberately unhelpful order and then shuffled, so the
 * choice cannot be coming from row order.
 */

import { DatabaseService } from "../../database/database.service";
import { HouseSenderService, GMAIL_SEND_SCOPE } from "./house-sender.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const ASKER = "11111111-0000-4000-8000-111111111111";
const OLDEST = "22222222-0000-4000-8000-222222222222";
const MIDDLE = "33333333-0000-4000-8000-333333333333";
const NEWEST = "44444444-0000-4000-8000-444444444444";

function grant(
  id: string,
  userId: string,
  connectedAt: string,
): Record<string, unknown> {
  return {
    id,
    user_id: userId,
    integration_id: "gmail_send",
    provider: "google",
    account_email: `${id}@example.test`,
    scopes: [GMAIL_SEND_SCOPE],
    restaurant_id: HOUSE,
    revoked_at: null,
    connected_at: connectedAt,
  };
}

const middle = grant("grant-b", MIDDLE, "2026-09-02T09:00:00.000Z");
const newest = grant("grant-c", NEWEST, "2026-10-15T09:00:00.000Z");
const oldest = grant("grant-a", OLDEST, "2026-08-30T09:00:00.000Z");

/** A stub that ignores `.order()` and returns rows exactly as given. */
function build(rows: Record<string, Record<string, unknown>[]>) {
  const chain = (data: Record<string, unknown>[]) => {
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.is = pass;
    self.order = pass;
    self.limit = pass;
    self.maybeSingle = () =>
      Promise.resolve({ data: data[0] ?? null, error: null });
    self.single = () => Promise.resolve({ data: data[0] ?? null, error: null });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return self;
  };
  return {
    client: { from: (table: string) => chain(rows[table] ?? []) },
  } as unknown as DatabaseService;
}

const NO_CONFIG = { get: () => undefined } as never;

function senderOver(grants: Record<string, unknown>[]) {
  return new HouseSenderService(
    build({
      integration_oauth_connections: grants,
      restaurant_feature_flags: [],
      users: [{ name: "A member" }],
    }),
    NO_CONFIG,
  );
}

/** Every ordering of the three rows: the answer must not depend on any. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [
      x,
      ...rest,
    ]),
  );
}

describe("house sender: which member's grant a letter leaves from", () => {
  it("(a) an asker without a grant gets the house's oldest sending grant, in any row order", async () => {
    // [middle, newest, oldest] — the first row is NOT the oldest.
    const first = await senderOver([middle, newest, oldest]).resolve(
      HOUSE,
      ASKER,
    );
    expect(first.kind).toBe("house_mailbox");
    expect(first.grant?.personUserId).toBe(OLDEST);
    expect(first.grant?.connectionId).toBe("grant-a");
    expect(first.address).toBe("grant-a@example.test");
    expect(first.words).toContain("grant-a@example.test");

    // Repeated calls agree.
    const again = await senderOver([middle, newest, oldest]).resolve(
      HOUSE,
      ASKER,
    );
    expect(again.grant?.personUserId).toBe(OLDEST);

    // And so does every other order the database might hand back.
    for (const order of permutations([middle, newest, oldest])) {
      const identity = await senderOver(order).resolve(HOUSE, ASKER);
      expect(identity.grant?.personUserId).toBe(OLDEST);
    }
  });

  it("(b) the asker's own grant still wins over an older one", async () => {
    const mine = grant("grant-z", ASKER, "2026-11-01T09:00:00.000Z");
    for (const order of permutations([oldest, mine, newest])) {
      const identity = await senderOver(order).resolve(HOUSE, ASKER);
      expect(identity.grant?.personUserId).toBe(ASKER);
      expect(identity.grant?.connectionId).toBe("grant-z");
      expect(identity.words).toContain("your own connected mailbox");
    }
  });

  it("(c) a tie on connected_at falls to the lower id", async () => {
    const at = "2026-09-10T12:00:00.000Z";
    const lower = grant("grant-1", MIDDLE, at);
    const higher = grant("grant-2", NEWEST, at);
    for (const order of [
      [higher, lower],
      [lower, higher],
    ]) {
      const identity = await senderOver(order).resolve(HOUSE, ASKER);
      expect(identity.grant?.connectionId).toBe("grant-1");
      expect(identity.grant?.personUserId).toBe(MIDDLE);
    }
  });
});
