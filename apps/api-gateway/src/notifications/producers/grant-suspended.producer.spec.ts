/**
 * The seventh producer: one notification per suspension.
 *
 * The founder's call on 2026-09-04 was "yes, one notification per suspension",
 * and the two halves of that sentence are what these cases measure — ONE (no
 * sweep repeats it) and PER SUSPENSION (a re-consent followed by a fresh change
 * is a new one). The dedupe is proven against the fake's real UNIQUE index on
 * `notification_producer_claims`, not against a stub that says "inserted".
 */

import { GrantSuspendedProducer } from "./grant-suspended.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const MEMBERS = [OWNER, MANAGER, STAFF];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-09-04T18:00:00Z");

function build() {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const producer = new GrantSuspendedProducer(database as any, ledger);
  return { db, notifications, producer };
}

/** Owner, manager and one member of staff, all active in this house. */
function house(db: FakeDb, over: Array<Record<string, any>> = []) {
  db.tables.user_restaurant_access.push(
    { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
    {
      user_id: MANAGER,
      restaurant_id: TENANT,
      role: "manager",
      is_active: true,
    },
    { user_id: STAFF, restaurant_id: TENANT, role: "staff", is_active: true },
    ...over,
  );
}

function connection(db: FakeDb, over: Record<string, any> = {}) {
  db.tables.restaurant_mcp_connections.push({
    id: "conn-1",
    restaurant_id: TENANT,
    name: "Alexandria Cellar Index",
    url: "https://mcp.example.test/cellar",
    probe_tools: [
      {
        name: "search_vintages",
        description: "Search the index",
        annotations: {
          readOnlyHint: false,
          destructiveHint: null,
          idempotentHint: null,
          openWorldHint: null,
        },
      },
    ],
    ...over,
  });
}

function grant(db: FakeDb, over: Record<string, any> = {}) {
  db.tables.mcp_tool_grants.push({
    id: "grant-1",
    connection_id: "conn-1",
    tool_name: "search_vintages",
    writes: true,
    granted_by: MANAGER,
    granted_at: "2026-08-30T12:00:00Z",
    revoked_at: null,
    declared_read: true,
    declared_annotations: { readOnlyHint: true },
    tool_fingerprint: "fp-old",
    tool_list_hash: "list-hash-a",
    classification_source: "declared",
    needs_reconsent_at: "2026-09-04T09:15:00Z",
    needs_reconsent_reason: "the server changed readOnlyHint true to false",
    ...over,
  });
}

describe("GrantSuspendedProducer", () => {
  it("names the server, the tool, what changed, when, and the re-consent", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(tally.emitted).toBe(2);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe(
      "Tool grant suspended — search_vintages on Alexandria Cellar Index",
    );
    expect(call.message).toContain(
      "The server Alexandria Cellar Index changed the tool search_vintages: " +
        "the server changed readOnlyHint true to false.",
    );
    // The house's own clock: 09:15 UTC is 5:15 AM in New York.
    expect(call.message).toContain(
      "The change was seen on Friday, September 4 at 5:15 AM.",
    );
    expect(call.message).toContain(
      "until a manager grants it again on the connections page",
    );
    expect(call.type).toBe("grant_suspended");
    expect(call.actionUrl).toBe("/connections");
    expect(call.priority).toBe("high");
  });

  it("[REVERT-FAILS] carries the provenance a reader can check the sentence against", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const { metadata } = notifications.persistForRestaurant.calls[0][1];

    expect(metadata.connectionId).toBe("conn-1");
    expect(metadata.tool).toBe("search_vintages");
    expect(metadata.previousHash).toBe("list-hash-a");
    // Hashed from the connection's CURRENT probe_tools, so a reader can see the
    // two are different rather than being told they are.
    expect(typeof metadata.currentHash).toBe("string");
    expect(metadata.currentHash).not.toBe(metadata.previousHash);
    expect(metadata.changedAt).toBe("2026-09-04T09:15:00.000Z");
    expect(metadata.changedAtSource).toContain(
      "mcp_tool_grants.needs_reconsent_at",
    );
    expect(metadata.reason).toBe(
      "the server changed readOnlyHint true to false",
    );
  });

  it("[REVERT-FAILS] writes once, and a second sweep writes nothing", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.alreadyClaimed).toBe(1);
    expect(second.emitted).toBe(0);
  });

  it("[REVERT-FAILS] writes again after a re-consent and a new change", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);

    // The re-consent, exactly as `McpConnectionsService.grantTool` performs it:
    // revoke-then-insert, so the cleared grant is a NEW row against the list as
    // it stands now.
    db.tables.mcp_tool_grants[0].revoked_at = "2026-09-04T10:00:00Z";
    db.tables.mcp_tool_grants[0].needs_reconsent_at = null;
    db.tables.mcp_tool_grants[0].needs_reconsent_reason = null;
    grant(db, {
      id: "grant-2",
      tool_list_hash: "list-hash-b",
      needs_reconsent_at: null,
      needs_reconsent_reason: null,
    });

    const quiet = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(quiet.withheldReason).toMatch(/No tool grant .* is suspended/);

    // And the server moves again.
    db.tables.mcp_tool_grants[1].needs_reconsent_at = "2026-09-04T16:40:00Z";
    db.tables.mcp_tool_grants[1].needs_reconsent_reason =
      "the server changed destructiveHint false to true";

    const third = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(third.emitted).toBe(2);
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(notifications.persistForRestaurant.calls[1][1].message).toContain(
      "destructiveHint false to true",
    );
  });

  it("[REVERT-FAILS] writes to owners and managers only", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const opts = notifications.persistForRestaurant.calls[0][2];
    expect([...opts.onlyUserIds].sort()).toEqual([MANAGER, OWNER].sort());
    expect(opts.onlyUserIds).not.toContain(STAFF);
  });

  it("[REVERT-FAILS] never reaches a manager of another house", async () => {
    const { db, notifications, producer } = build();
    house(db, [
      {
        user_id: "user-outsider",
        restaurant_id: OTHER,
        role: "manager",
        is_active: true,
      },
    ]);
    connection(db);
    grant(db);

    await producer.sweepTenant(
      TENANT,
      ZONE,
      { ready: [...MEMBERS, "user-outsider"], deferred: [] },
      NOW,
    );
    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds).not.toContain("user-outsider");
  });

  it("[REVERT-FAILS] does not write to a manager whose access is inactive", async () => {
    const { db, notifications, producer } = build();
    db.tables.user_restaurant_access.push(
      { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
      {
        user_id: MANAGER,
        restaurant_id: TENANT,
        role: "manager",
        is_active: false,
      },
    );
    connection(db);
    grant(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds).toEqual([OWNER]);
  });

  it("[REVERT-FAILS] a house with no owner or manager writes nothing and says so", async () => {
    const { db, notifications, producer } = build();
    db.tables.user_restaurant_access.push({
      user_id: STAFF,
      restaurant_id: TENANT,
      role: "staff",
      is_active: true,
    });
    connection(db);
    grant(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
    expect(tally.withheldReason).toMatch(/no active owner or manager/);
  });

  it("[REVERT-FAILS] never reads another restaurant's servers", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db, { id: "conn-theirs", restaurant_id: OTHER });
    grant(db, { connection_id: "conn-theirs" });

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/no model-context server on record/);
  });

  it("reports a withdrawn tool as a revocation, not as a suspension", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db, {
      revoked_at: "2026-09-04T09:15:00Z",
      needs_reconsent_reason:
        'The server no longer lists "search_vintages", so the grant was revoked. ' +
        "Granting it again is only possible if the server offers it again.",
    });

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe(
      "Tool grant revoked — search_vintages on Alexandria Cellar Index",
    );
    expect(call.message).toContain(
      "The grant was revoked because the server no longer lists search_vintages.",
    );
    expect(call.metadata.revoked).toBe(true);
  });

  it("a grant that is not suspended is never reported", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db, { needs_reconsent_at: null, needs_reconsent_reason: null });

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(
      /still matches the declaration its manager consented to/,
    );
  });

  it("[REVERT-FAILS] a quiet-hours manager is deferred, then served on a later sweep", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    const asleep = { ready: [OWNER, STAFF], deferred: [MANAGER] };
    const first = await producer.sweepTenant(TENANT, ZONE, asleep, NOW);
    expect(first.emitted).toBe(1);
    expect(first.deferredQuietHours).toBe(1);
    expect(notifications.persistForRestaurant.calls[0][2].onlyUserIds).toEqual([
      OWNER,
    ]);

    const later = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(later.emitted).toBe(1);
    expect(notifications.persistForRestaurant.calls[1][2].onlyUserIds).toEqual([
      MANAGER,
    ]);
  });

  it("[REVERT-FAILS] throws rather than guessing when the roles cannot be read", async () => {
    const { db, producer } = build();
    house(db);
    connection(db);
    grant(db);
    db.failures.user_restaurant_access = "statement timeout";

    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/user_restaurant_access/);
  });

  it("throws when the grant register cannot be read", async () => {
    const { db, producer } = build();
    house(db);
    connection(db);
    db.failures.mcp_tool_grants = "statement timeout";

    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/mcp_tool_grants/);
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, producer } = build();
    house(db);
    connection(db);
    grant(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });

  describe("suspendedGrantCount", () => {
    it("counts what is standing", async () => {
      const { db, producer } = build();
      connection(db);
      grant(db);
      await expect(producer.suspendedGrantCount(TENANT)).resolves.toBe(1);
    });

    it("[REVERT-FAILS] returns null, never zero, when the register cannot be read", async () => {
      const { db, producer } = build();
      connection(db);
      grant(db);
      db.failures.mcp_tool_grants = "statement timeout";
      await expect(producer.suspendedGrantCount(TENANT)).resolves.toBeNull();
    });

    it("a house with no server measures zero", async () => {
      const { producer } = build();
      await expect(producer.suspendedGrantCount(TENANT)).resolves.toBe(0);
    });
  });
});
