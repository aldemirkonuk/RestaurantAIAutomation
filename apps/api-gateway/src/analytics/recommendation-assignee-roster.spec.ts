import {
  ActRefused,
  RecommendationActionsService,
} from "./recommendation-actions.service";
import { AnalyticsController } from "./analytics.controller";

/**
 * OPS-03, the gateway half: an assignee is a row of THIS house's roster whose
 * status is `active`. Before, `assignedTo` was written as sent, so another
 * house's person, someone taken off the team or any string landed on a card.
 * Every case drives the real `setActionAs` (all its gates) over a table stub,
 * and the controller test drives the real route handler over the real
 * service, so the status the page receives is the one checked.
 */

const RID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RULE = "vendor_concentration#*#fire:month:2026-10";
const OWNER = { userId: "u-owner", role: "owner", leadsAreas: [] };

const ON_TEAM = "11111111-1111-4111-8111-111111111111";
const TRIAL = "22222222-2222-4222-8222-222222222222";
const INACTIVE = "33333333-3333-4333-8333-333333333333";
const ELSEWHERE = "44444444-4444-4444-8444-444444444444";
const NOBODY = "55555555-5555-4555-8555-555555555555";

const NOT_ON_TEAM =
  "That person is not on this house's active team, so the entry was not assigned to them.";
const ROSTER_UNREAD =
  "Could not read this house's team, so nobody was assigned. Try again.";

type Row = Record<string, any>;

function tables(opts: { rosterFails?: boolean } = {}) {
  const store: Record<string, Row[]> = {
    recommendation_actions: [],
    recommendation_action_history: [],
    recommendation_personal_snoozes: [],
    system_audit_log: [],
    team_members: [
      { id: ON_TEAM, restaurant_id: RID, status: "active" },
      { id: TRIAL, restaurant_id: RID, status: "trial" },
      { id: INACTIVE, restaurant_id: RID, status: "inactive" },
      { id: ELSEWHERE, restaurant_id: OTHER_HOUSE, status: "active" },
    ],
  };
  const writes: Array<{ table: string; op: string; payload: Row }> = [];
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> =
    [];
  const client = {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let single = false;
      let payload: Row | null = null;
      const hits = () =>
        (store[table] ?? []).filter((r) =>
          filters.every(([c, v]) => r[c] === v),
        );
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => {
        filters.push([c, v]);
        return b;
      };
      b.in = (c: string, vs: unknown[]) => {
        filters.push([c, vs]);
        return b;
      };
      b.upsert = (p: Row) => {
        payload = p;
        writes.push({ table, op: "upsert", payload: p });
        store[table] = [...(store[table] ?? []), { ...p }];
        return b;
      };
      b.maybeSingle = async () => {
        single = true;
        reads.push({ table, filters: [...filters] });
        if (table === "team_members" && opts.rosterFails)
          return { data: null, error: { message: "connection reset" } };
        // Postgres refuses a non-uuid compared with a uuid column, as an
        // error, not as "no row".
        const id = filters.find(([c]) => c === "id")?.[1];
        if (table === "team_members" && !/^[0-9a-f-]{36}$/i.test(String(id)))
          return {
            data: null,
            error: { message: `invalid input syntax for type uuid: "${id}"` },
          };
        return { data: hits()[0] ?? null, error: null };
      };
      b.single = async () => {
        single = true;
        return {
          data: { ...payload, updated_at: "2026-10-07T12:00:00.000Z" },
          error: null,
        };
      };
      b.insert = async (p: Row) => {
        writes.push({ table, op: "insert", payload: p });
        return { error: null };
      };
      b.then = (resolve: any, reject: any) => {
        if (single)
          return Promise.resolve({ data: null, error: null }).then(
            resolve,
            reject,
          );
        return Promise.resolve({ data: hits(), error: null }).then(
          resolve,
          reject,
        );
      };
      return b;
    },
  };
  return { db: { getClient: () => client } as any, writes, reads };
}

const houseWrites = <W extends { table: string; op: string }>(w: W[]) =>
  w.filter((x) => x.table === "recommendation_actions" && x.op === "upsert");

async function refusalOf(p: Promise<unknown>): Promise<ActRefused> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActRefused) return e;
    throw e;
  }
  throw new Error("the write was not refused");
}

function assign(t: ReturnType<typeof tables>, assignedTo: string | null) {
  return new RecommendationActionsService(t.db).setActionAs(
    RID,
    RULE,
    { assignedTo, assignedName: assignedTo ? "Someone" : null },
    undefined,
    OWNER,
  );
}

describe("an assignee must be on this house's active team (OPS-03)", () => {
  it("an active member of this house is assigned, after a read scoped to this house and that id", async () => {
    const t = tables();
    await assign(t, ON_TEAM);
    expect(houseWrites(t.writes)).toHaveLength(1);
    expect(houseWrites(t.writes)[0].payload).toMatchObject({
      assigned_to: ON_TEAM,
      restaurant_id: RID,
    });
    const roster = t.reads.filter((r) => r.table === "team_members");
    expect(roster).toHaveLength(1);
    expect(roster[0].filters).toEqual(
      expect.arrayContaining([
        ["restaurant_id", RID],
        ["id", ON_TEAM],
      ]),
    );
  });

  it.each([
    ["another house's member", ELSEWHERE],
    ["a trial row", TRIAL],
    ["an inactive row", INACTIVE],
    ["an id on no roster", NOBODY],
    ["a string that is not a roster id", "u-x"],
  ])("%s is refused as a 400, in words, with nothing written", async (_, id) => {
    const t = tables();
    const e = await refusalOf(assign(t, id));
    expect(e.forbidden).toBe(false);
    expect(e.message).toBe(NOT_ON_TEAM);
    expect(t.writes).toEqual([]);
  });

  it("a roster that could not be read refuses the write; it is not taken as a pass", async () => {
    const t = tables({ rosterFails: true });
    await expect(assign(t, ON_TEAM)).rejects.toThrow(ROSTER_UNREAD);
    expect(t.writes).toEqual([]);
  });

  it("clearing the assignee reads no roster", async () => {
    const t = tables();
    await assign(t, null);
    expect(t.reads.filter((r) => r.table === "team_members")).toEqual([]);
    expect(houseWrites(t.writes)[0].payload).toMatchObject({
      assigned_to: null,
    });
  });
});

describe("the route says so to the page", () => {
  const proto = AnalyticsController.prototype as unknown as Record<string, any>;
  async function thrown(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (e) {
      return e;
    }
    return null;
  }

  it("another house's member is a 400 carrying the sentence", async () => {
    const t = tables();
    const self = { recommendationActions: new RecommendationActionsService(t.db) };
    const e = await thrown(
      proto.setRecommendationAction.call(
        self,
        RID,
        { ruleKey: RULE, assignedTo: ELSEWHERE, assignedName: "B" },
        { userId: "u-owner", role: "owner" },
      ),
    );
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toBe(NOT_ON_TEAM);
    expect(t.writes).toEqual([]);
  });
});
