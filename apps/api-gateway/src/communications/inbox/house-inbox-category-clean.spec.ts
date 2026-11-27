/**
 * The stored-row cleanup behind the wide query's category bound (r104 mail-2,
 * DD-r102-2): a guest row filed before the bound existed carries no category,
 * so it is found by `gmail_message_id` against what Gmail lists under
 * Promotions, Social, Updates and Forums.
 *
 *   1. A GUEST ROW LISTED UNDER A NEWSLETTER TAB IS DELETED.
 *   2. A VENDOR ROW IN PROMOTIONS IS STILL THERE, and so is a team row.
 *   3. A LISTING THAT FAILS DELETES NOTHING and says so.
 */

import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { OrchestratorService } from "../../common/orchestrator/orchestrator.service";
import { HouseLettersService } from "../letters/house-letters.service";
import { HouseSenderService } from "../letters/house-sender.service";
import {
  HouseInboxService,
  GMAIL_READ_SCOPE,
  NEWSLETTER_CATEGORIES,
} from "./house-inbox.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const WIDE_GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeee1";
const AT = "2026-11-10T10:00:00.000Z";

type Row = Record<string, unknown>;

/** A tiny in-memory `procurement_conversations` that honours eq / in / not-null filters. */
function build(conv: Row[], opts: { deleteError?: string } = {}) {
  const table = { rows: conv };
  const grants = [
    { id: WIDE_GRANT, user_id: PERSON, restaurant_id: HOUSE, integration_id: "gmail_read_all", scopes: [GMAIL_READ_SCOPE], revoked_at: null },
  ];
  const deleteCalls: Array<{ ids: unknown; kind: unknown }> = [];
  const from = (name: string) => {
    if (name === "integration_oauth_connections") {
      const s: Row = {};
      for (const m of ["select", "eq", "is", "in"]) s[m] = () => s;
      s.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: grants, error: null }).then(r);
      return s;
    }
    if (name === "restaurant_feature_flags") {
      const s: Row = {};
      for (const m of ["select", "eq"]) s[m] = () => s;
      s.maybeSingle = () => Promise.resolve({ data: { enable_house_inbox_read: true }, error: null });
      s.single = s.maybeSingle;
      return s;
    }
    const eq: Array<[string, unknown]> = [];
    let inIds: unknown[] | null = null;
    let notNull: string | null = null;
    let deleting = false;
    let bounds: [number, number] | null = null;
    const s: Row = {};
    s.select = () => s;
    s.delete = () => ((deleting = true), s);
    s.eq = (k: string, v: unknown) => (eq.push([k, v]), s);
    s.in = (_k: string, v: unknown[]) => ((inIds = v), s);
    s.not = (k: string) => ((notNull = k), s);
    s.order = () => s;
    s.range = (a: number, b: number) => ((bounds = [a, b]), s);
    s.then = (resolve: (v: unknown) => unknown) => {
      let hit = table.rows.filter((r) => eq.every(([k, v]) => r[k] === v));
      if (inIds) hit = hit.filter((r) => inIds!.includes(r.id));
      if (notNull) hit = hit.filter((r) => r[notNull!] != null);
      // Like PostgREST with max_rows = 1000: a read returns at most that many, however much is asked.
      hit = [...hit].sort((x, y) => String(x.id).localeCompare(String(y.id)));
      if (!deleting) hit = bounds ? hit.slice(bounds[0], Math.min(bounds[1] + 1, bounds[0] + 1000)) : hit.slice(0, 1000);
      if (deleting) {
        deleteCalls.push({ ids: inIds, kind: eq.find(([k]) => k === "kind")?.[1] });
        if (opts.deleteError) return Promise.resolve({ data: null, error: { message: opts.deleteError } }).then(resolve);
        table.rows = table.rows.filter((r) => !hit.includes(r));
      }
      return Promise.resolve({ data: hit, error: null }).then(resolve);
    };
    return s;
  };
  return { db: { client: { from } } as unknown as DatabaseService, table, deleteCalls };
}

function service(db: DatabaseService) {
  const getAccessToken = jest.fn().mockResolvedValue("ya29.token");
  const oauth = { getAccessToken } as unknown as IntegrationsOauthService;
  const orchestrator = { publishEvent: jest.fn() } as unknown as OrchestratorService;
  const sender = new HouseSenderService(db, { get: () => undefined } as never);
  const letters = new HouseLettersService(db, sender, oauth);
  return new HouseInboxService(db, orchestrator, oauth, letters);
}

/** Answers each `category:X` listing with its own ids; records the queries. */
function gmailByCategory(byCategory: Record<string, string[]>, failOn?: string) {
  const queries: string[] = [];
  const impl = (async (input: unknown) => {
    const q = new URL(String(input)).searchParams.get("q") ?? "";
    queries.push(q);
    const cat = /category:(\w+)/.exec(q)?.[1] ?? "";
    if (failOn && cat === failOn) return { ok: false, status: 500, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: (byCategory[cat] ?? []).map((id) => ({ id })) }),
    };
  }) as unknown as typeof fetch;
  return { queries, impl };
}

const row = (id: string, kind: string, gmail: string): Row => ({
  id,
  restaurant_id: HOUSE,
  mirrored_by_grant_id: WIDE_GRANT,
  kind,
  gmail_message_id: gmail,
  received_at: AT,
});

describe("the stored rows the newsletter tabs left behind (r104 mail-2)", () => {
  it("deletes a guest row listed under a newsletter tab, and keeps a vendor and a team row listed there too", async () => {
    const { db, table, deleteCalls } = build([
      row("c-guest-promo", "guest", "g-promo"),
      row("c-guest-social", "guest", "g-social"),
      row("c-guest-person", "guest", "g-person"),
      row("c-vendor-promo", "vendor", "v-promo"),
      row("c-team-promo", "team", "t-promo"),
    ]);
    const svc = service(db);
    const { queries, impl } = gmailByCategory({
      promotions: ["g-promo", "v-promo", "t-promo"],
      social: ["g-social"],
    });
    svc.fetchImpl = impl;

    const run = await svc.cleanCategoryGuestRows();

    expect(run.error).toBeNull();
    expect(run.outcomes).toHaveLength(1);
    expect(run.outcomes[0]).toMatchObject({ considered: 3, deleted: 2, error: null });
    expect(table.rows.map((r) => r.id).sort()).toEqual(["c-guest-person", "c-team-promo", "c-vendor-promo"]);
    expect(deleteCalls).toEqual([{ ids: ["c-guest-promo", "c-guest-social"], kind: "guest" }]);
    for (const c of NEWSLETTER_CATEGORIES) expect(queries.some((q) => q.includes(`category:${c} `))).toBe(true);
  });

  it("reads every stored guest row past 1000, deletes in chunks of 200, and bounds each listing to one window", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1001; i += 1) rows.push(row(`c-${String(i).padStart(4, "0")}`, "guest", `g-${i}`));
    // The newest row sorts last by id: it is the one a 1000-row read never reaches.
    const { db, table, deleteCalls } = build(rows);
    const svc = service(db);
    const { queries, impl } = gmailByCategory({ promotions: rows.map((r) => String(r.gmail_message_id)) });
    svc.fetchImpl = impl;

    const run = await svc.cleanCategoryGuestRows();

    expect(run.outcomes[0]).toMatchObject({ considered: 1001, deleted: 1001, error: null });
    expect(run.outcomes[0].says).toMatch(/Checked 1001 stored guest messages/);
    expect(table.rows).toHaveLength(0);
    expect(deleteCalls.map((c) => (c.ids as unknown[]).length)).toEqual([200, 200, 200, 200, 200, 1]);
    // One window of one month: each category asked once, with both bounds.
    expect(queries).toHaveLength(NEWSLETTER_CATEGORIES.length);
    for (const q of queries) expect(q).toMatch(/after:\d+ before:\d+/);
  });

  it("says a failed category listing and deletes nothing for that grant", async () => {
    const { db, table } = build([row("c-guest-promo", "guest", "g-promo")]);
    const svc = service(db);
    svc.fetchImpl = gmailByCategory({ promotions: ["g-promo"] }, "forums").impl;

    const run = await svc.cleanCategoryGuestRows();

    expect(run.outcomes[0].error).toMatch(/could not be read whole/);
    expect(run.outcomes[0].deleted).toBe(0);
    expect(table.rows).toHaveLength(1);
  });

  it("says a failed delete rather than counting it", async () => {
    const { db, table } = build([row("c-guest-promo", "guest", "g-promo")], { deleteError: "boom" });
    const svc = service(db);
    svc.fetchImpl = gmailByCategory({ promotions: ["g-promo"] }).impl;

    const run = await svc.cleanCategoryGuestRows();

    expect(run.outcomes[0]).toMatchObject({ deleted: 0 });
    expect(run.outcomes[0].error).toMatch(/could not be deleted \(boom\)/);
    expect(table.rows).toHaveLength(1);
  });

  it("asks Gmail for nothing when no guest row is stored", async () => {
    const { db } = build([row("c-vendor", "vendor", "v-1")]);
    const svc = service(db);
    const { queries, impl } = gmailByCategory({});
    svc.fetchImpl = impl;
    const run = await svc.cleanCategoryGuestRows();
    expect(run.outcomes[0]).toMatchObject({ considered: 0, deleted: 0, error: null });
    expect(queries).toHaveLength(0);
  });
});
