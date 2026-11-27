import { NotFoundException } from "@nestjs/common";
import { MenusService } from "./menus.service";
import { DatabaseService } from "../database/database.service";

// OB-1 (onboarding walk, 2026-11-07 /goal): a person's setup is read from the
// house their session is in, a GET writes nothing, a client cannot PATCH a
// house fact true, and "activated" means a CURRENT menu with a live line.

type Row = Record<string, any>;

/**
 * A PostgREST-shaped fake: `eq`/`neq`/`is` filter, `order` sorts by one
 * column, `limit` caps, `maybeSingle` errors on more than one row, a
 * `menu_items` read can filter on its `restaurant_menus.<col>` embed (inner).
 * Every write is recorded in `writes`; `readFails[table]` fails that table's
 * reads.
 */
function fakeDb(
  tables: Record<string, Row[]>,
  readFails: Record<string, string> = {},
  insertFails: Record<string, { code: string; message: string }> = {},
) {
  const writes: Array<{ table: string; kind: string; value: Row }> = [];
  function from(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let sortBy: string | null = null;
    let cap = Infinity;
    let write: { kind: string; value: Row } | null = null;
    const col = (r: Row, c: string) => {
      if (!c.includes(".")) return r[c];
      const [, field] = c.split(".");
      const version = (tables.restaurant_menus || []).find((m) => m.id === r.menu_id);
      return version ? version[field] : undefined;
    };
    const rows = () => {
      let out = (tables[table] || []).filter((r) => preds.every((p) => p(r)));
      if (sortBy) {
        const k = sortBy;
        out = [...out].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      }
      return out.slice(0, cap);
    };
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => (preds.push((r) => col(r, c) === v), api),
      neq: (c: string, v: any) => (preds.push((r) => col(r, c) !== undefined && col(r, c) !== v), api),
      is: (c: string, v: null) => (preds.push((r) => (r[c] ?? null) === v), api),
      // PostgREST `or`: "col.not.is.null" and "col.gt.<value>" terms.
      or: (expr: string) => {
        const terms = expr.split(",").map((t) => {
          const [c, ...rest] = t.split(".");
          const op = rest.join(".");
          if (op === "not.is.null") return (r: Row) => (r[c] ?? null) !== null;
          if (op.startsWith("gt.")) return (r: Row) => r[c] != null && String(r[c]) > op.slice(3);
          throw new Error(`fake or(): unsupported term ${t}`);
        });
        preds.push((r) => terms.some((f) => f(r)));
        return api;
      },
      order: (c: string) => ((sortBy = c), api),
      limit: (n: number) => ((cap = n), api),
      update: (value: Row) => ((write = { kind: "update", value }), api),
      insert: (value: Row) => ((write = { kind: "insert", value }), api),
      maybeSingle: async () => {
        if (readFails[table]) return { data: null, error: { message: readFails[table] } };
        const found = rows();
        if (found.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
        return { data: found[0] ?? null, error: null };
      },
      then(resolve: any) {
        if (write) {
          writes.push({ table, ...write });
          if (write.kind === "update") {
            const hit = rows();
            for (const r of hit) Object.assign(r, write.value);
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          if (insertFails[table]) {
            const fail = insertFails[table];
            delete insertFails[table];
            return resolve({ data: null, error: fail });
          }
          (tables[table] = tables[table] || []).push({ id: `new-${writes.length}`, ...write.value });
          return resolve({ data: null, error: null });
        }
        if (readFails[table]) return resolve({ data: null, error: { message: readFails[table] } });
        resolve({ data: rows(), error: null });
      },
    };
    return api;
  }
  return { db: { from } as any, writes };
}

function serviceOn(
  tables: Record<string, Row[]>,
  readFails: Record<string, string> = {},
  insertFails: Record<string, { code: string; message: string }> = {},
) {
  const { db, writes } = fakeDb(tables, readFails, insertFails);
  const service = new MenusService(
    { supabase: db } as unknown as DatabaseService,
    undefined as any,
    undefined as any,
    undefined as any,
  );
  return { service, writes, tables };
}

const houseA = "rest-A";
const houseB = "rest-B";

function twoHouses(): Record<string, Row[]> {
  return {
    // The person's one row names house A (user_id is UNIQUE).
    user_onboarding_progress: [
      { id: "uop-1", user_id: "u-1", restaurant_id: houseA, menu_uploaded: true, vendor_added: true, team_member_invited: true, checklist_dismissed: false, completed_at: "2026-01-01T00:00:00+00:00" },
    ],
    restaurant_menus: [
      { id: "m-A", restaurant_id: houseA, status: "active" },
      { id: "m-B", restaurant_id: houseB, status: "draft" },
    ],
    menu_items: [
      { id: "i-A", menu_id: "m-A", restaurant_id: houseA, status: "approved", created_at: "2026-01-01T00:00:00+00:00" },
      { id: "i-B", menu_id: "m-B", restaurant_id: houseB, status: "approved", created_at: "2026-02-01T00:00:00+00:00" },
    ],
    providers: [{ id: "p-A", restaurant_id: houseA, deleted_at: null, created_at: "2026-01-02T00:00:00+00:00" }],
    // Open until 2999: it can still be used.
    organization_invites: [{ id: "inv-A", restaurant_id: houseA, created_at: "2026-01-03T00:00:00+00:00", expires_at: "2999-01-01T00:00:00+00:00", used_at: null }],
    restaurants: [
      { id: houseA, threshold_configured: true },
      { id: houseB, threshold_configured: false },
    ],
  };
}

describe("onboarding progress is read from the session's house (OB-1)", () => {
  it("(t1) a person whose row names house A, in a session in house B, reads B's facts", async () => {
    const { service } = serviceOn(twoHouses());
    const b = await service.getOnboardingProgress("u-1", houseB);
    expect(b.restaurant_id).toBe(houseB);
    expect(b.menu_uploaded).toBe(true); // B has a draft with a line
    expect(b.menu_current).toBe(false);
    expect(b.activated).toBe(false);
    expect(b.vendor_added).toBe(false);
    expect(b.team_member_invited).toBe(false);
    expect(b.completed_at).toBeNull();
    const a = await service.getOnboardingProgress("u-1", houseA);
    expect(a.activated).toBe(true);
    expect(a.vendor_added).toBe(true);
    expect(a.team_member_invited).toBe(true);
  });

  it("(t2) a GET makes zero writes", async () => {
    const { service, writes } = serviceOn(twoHouses());
    await service.getOnboardingProgress("u-1", houseA);
    await service.getOnboardingProgress("u-1", houseB);
    expect(writes).toEqual([]);
  });

  it("(t3) a current menu with a line is activated even with no threshold set", async () => {
    const tables = twoHouses();
    tables.restaurants[0].threshold_configured = false;
    const { service } = serviceOn(tables);
    const a = await service.getOnboardingProgress("u-1", houseA);
    expect(a.threshold_configured).toBe(false);
    expect(a.activated).toBe(true);
  });

  it("a current menu whose every line was discarded is not activated", async () => {
    const tables = twoHouses();
    tables.menu_items[0].status = "discarded";
    const { service } = serviceOn(tables);
    const a = await service.getOnboardingProgress("u-1", houseA);
    expect(a.menu_uploaded).toBe(false);
    expect(a.activated).toBe(false);
  });

  it("(t4) PATCH {menu_uploaded:true} on a house with no menu leaves the read false and writes nothing", async () => {
    const { service, writes } = serviceOn({
      user_onboarding_progress: [{ id: "uop-1", user_id: "u-1", restaurant_id: houseB, checklist_dismissed: false }],
      restaurants: [{ id: houseB, threshold_configured: false }],
    });
    const answer = await service.updateOnboardingProgress("u-1", houseB, {
      menu_uploaded: true,
      vendor_added: true,
      team_member_invited: true,
    });
    expect(answer.menu_uploaded).toBe(false);
    expect(answer.vendor_added).toBe(false);
    expect(answer.team_member_invited).toBe(false);
    expect(writes).toEqual([]);
  });

  it("(t6) an invitee with no row of their own reads their house, not a 404", async () => {
    const tables = twoHouses();
    tables.user_onboarding_progress = [];
    const { service } = serviceOn(tables);
    const a = await service.getOnboardingProgress("invitee-9", houseA);
    expect(a.id).toBeNull();
    expect(a.activated).toBe(true);
    expect(a.checklist_dismissed).toBe(false);
  });

  it("a session in no house is a 404 said in words", async () => {
    const { service } = serviceOn(twoHouses());
    await expect(service.getOnboardingProgress("u-1", undefined)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("completed_at is when the last of menu, supplier and invite first held", async () => {
    const { service } = serviceOn(twoHouses());
    const a = await service.getOnboardingProgress("u-1", houseA);
    expect(a.completed_at).toBe("2026-01-03T00:00:00+00:00");
  });

  it("a deleted supplier is not a supplier", async () => {
    const tables = twoHouses();
    tables.providers[0].deleted_at = "2026-03-01T00:00:00+00:00";
    const { service } = serviceOn(tables);
    const a = await service.getOnboardingProgress("u-1", houseA);
    expect(a.vendor_added).toBe(false);
    expect(a.completed_at).toBeNull();
  });

  it.each(["providers", "organization_invites", "restaurants", "user_onboarding_progress", "menu_items"])(
    "a failed read of %s is said, never read as 'not yet'",
    async (table) => {
      const { service } = serviceOn(twoHouses(), { [table]: "connection reset" });
      await expect(service.getOnboardingProgress("u-1", houseA)).rejects.toThrow(/connection reset/);
    },
  );

  it("putting the checklist away updates the person's own row only, and keeps the house it names", async () => {
    const tables = twoHouses();
    const { service, writes } = serviceOn(tables);
    const answer = await service.updateOnboardingProgress("u-1", houseB, { checklist_dismissed: true });
    expect(answer.checklist_dismissed).toBe(true);
    expect(writes).toEqual([
      { table: "user_onboarding_progress", kind: "update", value: { checklist_dismissed: true } },
    ]);
    expect(tables.user_onboarding_progress).toHaveLength(1);
    expect(tables.user_onboarding_progress[0].restaurant_id).toBe(houseA);
  });

  it("two first-time dismissals at once: the one that loses the insert updates the winner's row, no 500", async () => {
    const tables = twoHouses();
    tables.user_onboarding_progress = [];
    const { service, writes } = serviceOn(tables, {}, {
      user_onboarding_progress: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    // The winner's row lands between this request's update (0 rows) and its insert.
    const winner = { id: "uop-w", user_id: "invitee-9", restaurant_id: houseA, checklist_dismissed: false };
    const realUpdate = writes.push.bind(writes);
    let seen = 0;
    (writes as any).push = (w: any) => {
      seen += 1;
      if (seen === 2) tables.user_onboarding_progress.push(winner);
      return realUpdate(w);
    };
    const answer = await service.updateOnboardingProgress("invitee-9", houseA, { checklist_dismissed: true });
    expect(answer.checklist_dismissed).toBe(true);
    expect(writes.map((w) => w.kind)).toEqual(["update", "insert", "update"]);
    expect(tables.user_onboarding_progress).toEqual([{ ...winner, checklist_dismissed: true }]);
  });

  it("an insert that fails for another reason is said, never a quiet success", async () => {
    const tables = twoHouses();
    tables.user_onboarding_progress = [];
    const { service } = serviceOn(tables, {}, {
      user_onboarding_progress: { code: "42501", message: "permission denied" },
    });
    await expect(
      service.updateOnboardingProgress("invitee-9", houseA, { checklist_dismissed: true }),
    ).rejects.toThrow(/not put away: permission denied/);
  });

  it("an expired invite nobody used is not an invite; a used one still is", async () => {
    const tables = twoHouses();
    tables.organization_invites[0].expires_at = "2020-01-01T00:00:00+00:00";
    const expired = await serviceOn(tables).service.getOnboardingProgress("u-1", houseA);
    expect(expired.team_member_invited).toBe(false);
    expect(expired.completed_at).toBeNull();
    tables.organization_invites[0].used_at = "2020-01-02T00:00:00+00:00";
    const used = await serviceOn(tables).service.getOnboardingProgress("u-1", houseA);
    expect(used.team_member_invited).toBe(true);
  });

  it("a menu that was read but not made current leaves setup unfinished: completed_at waits for the current menu", async () => {
    const tables = twoHouses();
    tables.restaurant_menus[0].status = "draft";
    const { service } = serviceOn(tables);
    const a = await service.getOnboardingProgress("u-1", houseA);
    expect(a.menu_uploaded).toBe(true);
    expect(a.menu_current).toBe(false);
    expect(a.activated).toBe(false);
    expect(a.vendor_added).toBe(true);
    expect(a.team_member_invited).toBe(true);
    expect(a.completed_at).toBeNull();
  });

  it("putting the checklist away with no row writes one row in the session's house", async () => {
    const tables = twoHouses();
    tables.user_onboarding_progress = [];
    const { service, writes } = serviceOn(tables);
    const answer = await service.updateOnboardingProgress("invitee-9", houseA, { checklist_dismissed: true });
    expect(answer.checklist_dismissed).toBe(true);
    expect(writes).toEqual([
      { table: "user_onboarding_progress", kind: "update", value: { checklist_dismissed: true } },
      {
        table: "user_onboarding_progress",
        kind: "insert",
        value: { user_id: "invitee-9", restaurant_id: houseA, checklist_dismissed: true },
      },
    ]);
  });
});
