/**
 * The eighth producer: an ADDED tool is an information line, not a suspension.
 *
 * The two cases the founder named by hand are the last two here — a tool is
 * said once and never again, and a removed-then-re-added tool is said again.
 * Both rest on the sighting ledger, so both are run against a fake that
 * enforces its partial unique index rather than a stub.
 */

import { AddedToolProducer } from "./added-tool.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import {
  FakeDb,
  fakeDatabase,
  fakeNotifications,
  fixedClock,
} from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const COOK = "user-cook";
const MEMBERS = [OWNER, MANAGER, COOK];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-09-04T15:00:00Z");

function build(startAt: Date = NOW) {
  const db = new FakeDb();
  db.tables.notification_mcp_tool_sightings = [];
  db.tables.restaurant_mcp_connections = [];
  db.tables.user_restaurant_access = [
    { restaurant_id: TENANT, user_id: OWNER, role: "owner", is_active: true },
    { restaurant_id: TENANT, user_id: MANAGER, role: "manager", is_active: true },
    { restaurant_id: TENANT, user_id: COOK, role: "staff", is_active: true },
  ];
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const clock = fixedClock(startAt);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
    clock,
  );
  const producer = new AddedToolProducer(database as any, ledger);
  const sweepAt = (at: Date) => {
    clock.advanceTo(at);
    return producer.sweepTenant(TENANT, ZONE, AUDIENCE, at);
  };
  return { db, notifications, producer, clock, sweepAt };
}

function tool(name: string, readOnly: boolean | null = null) {
  return {
    name,
    title: name,
    description: `does ${name}`,
    annotations:
      readOnly === null
        ? null
        : {
            readOnlyHint: readOnly,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
  };
}

function server(db: FakeDb, tools: any[], over: Record<string, any> = {}) {
  const row = {
    id: "conn-1",
    restaurant_id: TENANT,
    name: "Cellar MCP",
    revoked_at: null,
    probe_status: "ok",
    probe_tools: tools,
    last_probe_at: "2026-09-04T14:30:00Z",
    ...over,
  };
  const existing = db.tables.restaurant_mcp_connections.find(
    (r: any) => r.id === row.id,
  );
  if (existing) Object.assign(existing, row);
  else db.tables.restaurant_mcp_connections.push(row);
  return row;
}

describe("AddedToolProducer", () => {
  it("[REVERT-FAILS] the first sweep of a server SEEDS a baseline and announces nothing", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("list_wines", true), tool("place_order")]);

    const tally = await sweepAt(NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/first sight of their server/);
    // …but the sightings exist, so the NEXT addition is detectable.
    expect(db.tables.notification_mcp_tool_sightings).toHaveLength(2);
  });

  it("announces a tool that appears after the baseline, as information", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("list_wines", true)]);
    await sweepAt(NOW);

    server(db, [tool("list_wines", true), tool("place_order")]);
    const tally = await sweepAt(new Date(NOW.getTime() + 3_600_000));

    expect(tally.emitted).toBeGreaterThan(0);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.type).toBe("mcp_tool_added");
    expect(call.title).toBe("Cellar MCP is offering a new tool: place_order");
    expect(call.priority).toBe("low");
    // An information line touches no permission, and says so.
    expect(call.metadata.grantTouched).toBe(false);
    expect(call.metadata.grantNote).toMatch(/No grant was created, changed or suspended/);
  });

  it("[REVERT-FAILS] an undeclared tool is a write, never read-only", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("list_wines", true)]);
    await sweepAt(NOW);
    server(db, [tool("list_wines", true), tool("mystery")]);
    await sweepAt(new Date(NOW.getTime() + 3_600_000));

    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.classification).toBe("write");
    expect(call.metadata.declaredReadOnly).toBe(false);
    expect(call.metadata.unknownIsWrite).toBe(true);
    expect(call.message).toMatch(/classifies it as a write/);
  });

  it("carries a declared read-only tool as read_only", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a", true)]);
    await sweepAt(NOW);
    server(db, [tool("a", true), tool("b", true)]);
    await sweepAt(new Date(NOW.getTime() + 3_600_000));
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.classification).toBe("read_only");
    expect(call.message).toMatch(/declares it read-only/);
  });

  it("[REVERT-FAILS] addresses owners and managers only, never the whole house", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a", true)]);
    await sweepAt(NOW);
    server(db, [tool("a", true), tool("b")]);
    await sweepAt(new Date(NOW.getTime() + 3_600_000));

    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds.sort()).toEqual([MANAGER, OWNER].sort());
    expect(opts.onlyUserIds).not.toContain(COOK);
  });

  it("[REVERT-FAILS] an added tool is written ONCE and never again for the same first sighting", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a", true)]);
    await sweepAt(NOW);
    server(db, [tool("a", true), tool("b")]);
    await sweepAt(new Date(NOW.getTime() + 3_600_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);

    // Three more sweeps, days apart, with the tool still on offer.
    for (const d of [1, 2, 9]) {
      await sweepAt(new Date(NOW.getTime() + d * 86_400_000));
    }
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
  });

  it("[REVERT-FAILS] a removed-then-re-added tool is a new event and is written again", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a", true)]);
    await sweepAt(NOW);

    server(db, [tool("a", true), tool("b")]);
    await sweepAt(new Date(NOW.getTime() + 3_600_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);

    // The server drops it. A removal is a revocation and is NOT announced here.
    server(db, [tool("a", true)]);
    await sweepAt(new Date(NOW.getTime() + 2 * 86_400_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    const closed = db.tables.notification_mcp_tool_sightings.filter(
      (r: any) => r.gone_at !== null,
    );
    expect(closed).toHaveLength(1);

    // It comes back: a new run, a new first_seen_at, a new key, a new line.
    server(db, [tool("a", true), tool("b")]);
    await sweepAt(new Date(NOW.getTime() + 3 * 86_400_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);

    const keys = db.tables.notification_producer_claims.map(
      (r: any) => r.dedupe_key,
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length / 2); // one key, two recipients each
    expect([...unique].every((k: any) => k.startsWith("server:conn-1:tool:b:"))).toBe(
      true,
    );
  });

  it("[REVERT-FAILS] a server that has not answered a probe says unknown, not empty", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a")], { probe_status: "unreachable", probe_tools: null });
    const tally = await sweepAt(NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/none of which has answered a probe/);
    expect(tally.withheldReason).toMatch(/unknown — not empty/);
  });

  it("[REVERT-FAILS] a failed probe never closes a run, so nothing is re-announced later", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a", true), tool("b")]);
    await sweepAt(NOW); // baseline

    // The server goes down: probe_tools is stale/absent and status is not ok.
    server(db, [], { probe_status: "unreachable", probe_tools: null });
    await sweepAt(new Date(NOW.getTime() + 86_400_000));
    expect(
      db.tables.notification_mcp_tool_sightings.filter((r: any) => r.gone_at),
    ).toHaveLength(0);

    // It comes back offering exactly what it did before: nothing to say.
    server(db, [tool("a", true), tool("b")], { probe_status: "ok" });
    await sweepAt(new Date(NOW.getTime() + 2 * 86_400_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("[REVERT-FAILS] never reads another restaurant's servers", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a")], { id: "conn-x", restaurant_id: OTHER });
    const tally = await sweepAt(NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/declared no model-context server/);
  });

  it("ignores a revoked connection", async () => {
    const { db, sweepAt } = build();
    server(db, [tool("a")], { revoked_at: "2026-09-01T00:00:00Z" });
    const tally = await sweepAt(NOW);
    expect(tally.withheldReason).toMatch(/declared no model-context server/);
  });

  it("throws when the sighting ledger cannot be read — never 'everything is new'", async () => {
    const { db, sweepAt } = build();
    server(db, [tool("a")]);
    db.failures.notification_mcp_tool_sightings = "statement timeout";
    await expect(sweepAt(NOW)).rejects.toThrow(
      /notification_mcp_tool_sightings/,
    );
  });

  it("throws when the roles cannot be read — neither fallback is honest", async () => {
    const { db, sweepAt } = build();
    server(db, [tool("a", true)]);
    await sweepAt(NOW);
    server(db, [tool("a", true), tool("b")]);
    db.failures.user_restaurant_access = "permission denied";
    await expect(sweepAt(new Date(NOW.getTime() + 3_600_000))).rejects.toThrow(
      /user_restaurant_access/,
    );
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, sweepAt } = build();
    server(db, [tool("a", true)]);
    await sweepAt(NOW);
    server(db, [tool("a", true), tool("b")]);
    await sweepAt(new Date(NOW.getTime() + 3_600_000));
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});
