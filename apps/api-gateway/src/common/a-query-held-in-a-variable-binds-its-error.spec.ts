import {
  ServiceUnavailableException,
  InternalServerErrorException,
} from "@nestjs/common";
import { GoalsService } from "../analytics/goals.service";
import { ProspectsService } from "./orchestrator/prospects.service";
import { DistributorDiscoveryService } from "../distributor-discovery/distributor-discovery.service";
import { ProcurementService } from "../procurement/procurement.service";
import { TeamService } from "../team/team.service";
import { WholeReadError } from "./read-whole-window";

/**
 * A QUERY HELD IN A VARIABLE BINDS ITS ERROR (ADR 0067, 2026-10-08).
 *
 * `scripts/check_read_errors_not_swallowed.py` looked for the supabase chain
 * only inside the destructuring statement, so a read built into a variable
 * first and awaited later (`let q = c.from(…); … const { data } = await q`)
 * was invisible to it. Taught to follow the variable, it found seven such
 * reads at origin/main be9a16c, none in the baseline. The inbound mail
 * handler's provider lookup has its own spec
 * (`orchestrator/a-failed-sender-lookup-is-not-a-stranger.spec.ts`); these
 * are the other six, each pinned on the failure it used to hide and on the
 * success path it must not change.
 *
 * One fake client serves them all: a chain records its table, and awaiting
 * it (or `.single()` / `.maybeSingle()`, or an `.rpc()`) answers from
 * `answers[table]`; an insert is recorded and answered as written.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const ORDER = "44444444-4444-4444-8444-444444444444";
const READ_ERROR = { message: "canceling statement due to statement timeout" };
const failed = { data: null, error: READ_ERROR };

function fakeClient(
  answers: Record<string, { data: unknown; error: unknown }>,
) {
  const inserts: Record<string, any[]> = {};
  const chain = (table: string) => {
    let inserted = false;
    const b: any = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "gt",
      "gte",
      "lt",
      "lte",
      "ilike",
      "order",
      "limit",
      "range",
      "update",
    ]) {
      b[m] = () => b;
    }
    b.insert = (row: any) => {
      (inserts[table] ??= []).push(row);
      inserted = true;
      return b;
    };
    const result = () => {
      if (inserted) return { data: null, error: null };
      const a = answers[table];
      if (!a) throw new Error(`unexpected read of ${table}`);
      return a;
    };
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: any, rej: any) =>
      Promise.resolve().then(result).then(res, rej);
    return b;
  };
  const client = { from: chain, rpc: (name: string) => chain(`rpc:${name}`) };
  return { client, inserts };
}

const quietLogger = () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

// ---------------------------------------------------------------------------
describe("goals purchase_spend — a failed procurement_orders read refuses", () => {
  const goalsOver = (client: any) => {
    const goals = new GoalsService(
      { getClient: () => client } as any,
      { getStored: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      { getFinancialSummary: async () => ({}) } as any,
    );
    (goals as any).logger = quietLogger();
    return goals;
  };

  it("throws WholeReadError instead of reporting that the house bought nothing", async () => {
    const { client } = fakeClient({ procurement_orders: failed });
    await expect(
      (goalsOver(client) as any).computeMetricWithSeries(
        HOUSE,
        "purchase_spend",
        "2026-09-01",
      ),
    ).rejects.toThrow(WholeReadError);
  });

  it("still sums the orders it read", async () => {
    const { client } = fakeClient({
      procurement_orders: {
        data: [
          {
            total_cost: 120,
            delivered_at: "2026-09-03T10:00:00Z",
            status: "DELIVERED",
          },
          {
            final_price: 80,
            delivered_at: "2026-09-04T10:00:00Z",
            status: "DELIVERED",
          },
        ],
        error: null,
      },
    });
    const out = await (goalsOver(client) as any).computeMetricWithSeries(
      HOUSE,
      "purchase_spend",
      "2026-09-01",
    );
    expect(out.current).toBe(200);
    expect(out.rowCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("prospects capture — a failed dedup read writes and announces nothing", () => {
  const prospectsOver = (client: any) => {
    const svc = new ProspectsService(
      { supabase: client } as any,
      { get: () => undefined } as any,
    );
    (svc as any).logger = quietLogger();
    return svc;
  };
  const params = {
    senderEmail: "anna@vendor.example",
    subject: "Our catalogue",
    body: "Please find our catalogue.",
    restaurantId: HOUSE,
  };

  it("returns captured: false and inserts no prospect", async () => {
    const { client, inserts } = fakeClient({ email_prospects: failed });
    const out = await prospectsOver(client).captureFromColdEmail(params);
    expect(out.captured).toBe(false);
    expect(out.isNew).toBeUndefined();
    expect(inserts["email_prospects"]).toBeUndefined();
  });

  it("still captures a new prospect when the read worked and found none", async () => {
    const { client, inserts } = fakeClient({
      email_prospects: { data: null, error: null },
    });
    const out = await prospectsOver(client).captureFromColdEmail(params);
    expect(out.captured).toBe(true);
    expect(out.isNew).toBe(true);
    expect(inserts["email_prospects"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("distributor search — a failed read of the house's own row says so", () => {
  const searchOver = (client: any) => {
    const svc = new DistributorDiscoveryService({
      getClient: () => client,
    } as any);
    (svc as any).logger = quietLogger();
    return svc.search(HOUSE, {} as any);
  };
  const rpc = { "rpc:search_distributors": { data: [], error: null } };

  it("reports originUnreadable, not an ungeocoded house", async () => {
    const { client } = fakeClient({ ...rpc, restaurants: failed });
    const out = await searchOver(client);
    expect(out.origin).toBeNull();
    expect(out.originUnreadable).toBe(true);
  });

  it("returns the origin and originUnreadable: false when the row reads", async () => {
    const { client } = fakeClient({
      ...rpc,
      restaurants: {
        data: { name: "Meyhouse", latitude: 37.44, longitude: -122.16 },
        error: null,
      },
    });
    const out = await searchOver(client);
    expect(out.origin).toEqual({ lat: 37.44, lng: -122.16, label: "Meyhouse" });
    expect(out.originUnreadable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("procurement newerReplyStillAnalyzing — the send gate stays shut on a failed read", () => {
  const gateOver = (client: any) => {
    const svc: any = Object.create(ProcurementService.prototype);
    svc.databaseService = { supabase: client };
    svc.logger = quietLogger();
    return (draftCreatedAt: string | null) =>
      svc.newerReplyStillAnalyzing(
        HOUSE,
        ORDER,
        draftCreatedAt,
      ) as Promise<boolean>;
  };

  it("refuses with 503 instead of answering 'no newer reply'", async () => {
    const { client } = fakeClient({ procurement_conversations: failed });
    await expect(gateOver(client)("2026-10-08T09:00:00Z")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("answers false with no newer reply and true with one", async () => {
    const none = fakeClient({
      procurement_conversations: { data: [], error: null },
    });
    await expect(gateOver(none.client)(null)).resolves.toBe(false);
    const one = fakeClient({
      procurement_conversations: { data: [{ id: "c1" }], error: null },
    });
    await expect(gateOver(one.client)(null)).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("team lists — a failed read is not an empty list", () => {
  const teamOver = (client: any, role: "manager" | "staff") => {
    const team: any = new TeamService({ supabase: client } as any);
    team.logger = quietLogger();
    team.assertAccess = async () => ({ role });
    team.ownMemberId = async () => "member-1";
    team.rosterMemberIds = async () => new Set(["member-1"]);
    return team as TeamService;
  };

  it("listCertifications throws rather than listing no certificates", async () => {
    const { client } = fakeClient({ team_certifications: failed });
    await expect(
      teamOver(client, "manager").listCertifications("u1", HOUSE),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it("listTimeOff throws rather than showing a manager an empty review queue", async () => {
    const { client } = fakeClient({ time_off_requests: failed });
    await expect(
      teamOver(client, "manager").listTimeOff("u1", HOUSE),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it("both still list what they read", async () => {
    const { client } = fakeClient({
      team_certifications: {
        data: [
          { id: "cert-1", member_id: "member-1", expires_at: "2099-01-01" },
        ],
        error: null,
      },
      time_off_requests: {
        data: [{ id: "to-1", member_id: "member-1" }],
        error: null,
      },
    });
    const certs = await teamOver(client, "staff").listCertifications(
      "u1",
      HOUSE,
    );
    expect(certs.map((c: any) => c.id)).toEqual(["cert-1"]);
    const leave = await teamOver(client, "staff").listTimeOff("u1", HOUSE);
    expect(leave.map((r: any) => r.id)).toEqual(["to-1"]);
  });
});
