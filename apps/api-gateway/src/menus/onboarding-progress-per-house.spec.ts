import { NotFoundException } from "@nestjs/common";
import { MenusService } from "./menus.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * F-240: onboarding progress is kept per person per house.
 *
 * The table was UNIQUE (user_id) and GET /onboarding/progress read it by user
 * alone, so an owner's second house showed the first house's checklist.
 * 20261231800000_onboarding_progress_is_kept_per_house.sql keys it on
 * (user_id, restaurant_id); the gateway reads and writes the session's house,
 * and Add a location writes the new house's row.
 */

type Filter = { col: string; val: unknown };

/** Rows in the fake table, and every filter and write the code made. */
function progressTable(rows: Record<string, any>[]) {
  const reads: Filter[][] = [];
  const updates: { patch: any; filters: Filter[] }[] = [];
  const inserts: any[] = [];
  const from = (table: string) => {
    const filters: Filter[] = [];
    let patch: any = null;
    const match = () =>
      rows.filter((r) => filters.every((f) => r[f.col] === f.val));
    const c: any = {
      select: () => c,
      eq: (col: string, val: unknown) => {
        filters.push({ col, val });
        return c;
      },
      update: (p: any) => {
        patch = p;
        return c;
      },
      insert: (row: any) => {
        inserts.push({ table, row });
        return c;
      },
      maybeSingle: async () => {
        if (table === "user_onboarding_progress") {
          reads.push([...filters]);
          const hit = match();
          return { data: hit[0] ?? null, error: null };
        }
        // restaurant_menus / restaurants: nothing active, no threshold.
        return { data: null, error: null };
      },
      single: async () => {
        if (patch) {
          updates.push({ patch, filters: [...filters] });
          const hit = match()[0];
          return { data: hit ? { ...hit, ...patch } : null, error: null };
        }
        return { data: null, error: null };
      },
      then: (res: any, rej: any) =>
        Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return c;
  };
  return { client: { from }, reads, updates, inserts };
}

const HOUSE_1 = "house-1";
const HOUSE_2 = "house-2";
const ROWS = [
  {
    id: "row-1",
    user_id: "owner",
    restaurant_id: HOUSE_1,
    menu_uploaded: true,
    vendor_added: true,
    team_member_invited: true,
    checklist_dismissed: false,
    completed_at: "2026-09-01T00:00:00Z",
  },
  {
    id: "row-2",
    user_id: "owner",
    restaurant_id: HOUSE_2,
    menu_uploaded: false,
    vendor_added: false,
    team_member_invited: false,
    checklist_dismissed: false,
    completed_at: null,
  },
];

function menus(rows: Record<string, any>[]) {
  const t = progressTable(rows);
  const svc = new MenusService(
    { supabase: t.client } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, t };
}

describe("GET /onboarding/progress reads the session's house (F-240)", () => {
  it("shows the second house its own empty checklist, not the first house's", async () => {
    const { svc, t } = menus(ROWS);

    const p = await svc.getOnboardingProgress("owner", HOUSE_2);

    expect(p.restaurant_id).toBe(HOUSE_2);
    expect(p.menu_uploaded).toBe(false);
    expect(p.vendor_added).toBe(false);
    expect(t.reads[0]).toEqual(
      expect.arrayContaining([
        { col: "user_id", val: "owner" },
        { col: "restaurant_id", val: HOUSE_2 },
      ]),
    );
  });

  it("answers no checklist for a house this person has no row in, never another house's", async () => {
    const { svc } = menus([ROWS[0]]);
    await expect(svc.getOnboardingProgress("owner", HOUSE_2)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("answers no checklist when the session names no house", async () => {
    const { svc, t } = menus(ROWS);
    await expect(svc.getOnboardingProgress("owner", null)).rejects.toThrow(
      NotFoundException,
    );
    expect(t.reads).toHaveLength(0);
  });
});

describe("PATCH /onboarding/progress writes the session's house (F-240)", () => {
  it("ticks the second house's row and leaves the first house's alone", async () => {
    const { svc, t } = menus(ROWS);

    await svc.updateOnboardingProgress("owner", HOUSE_2, {
      vendor_added: true,
    } as any);

    expect(t.updates).toHaveLength(1);
    expect(t.updates[0].patch).toEqual({ vendor_added: true });
    expect(t.updates[0].filters).toEqual([{ col: "id", val: "row-2" }]);
  });
});

describe("Add a location writes the new house's checklist (F-240)", () => {
  const ORG = "org-1";
  const NEW_HOUSE = "house-new";

  function organizations() {
    const inserts: { table: string; row: any }[] = [];
    const chain = (result: any, table: string): any => {
      const c: any = {
        select: () => c,
        insert: (row: any) => {
          inserts.push({ table, row });
          return c;
        },
        delete: () => c,
        eq: () => c,
        in: () => c,
        maybeSingle: async () => result,
        single: async () => result,
        then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
      };
      return c;
    };
    const supabase = {
      from: (table: string) => {
        if (table === "organization_members")
          return chain(
            { data: [{ organization_id: ORG, role: "owner" }], error: null },
            table,
          );
        if (table === "restaurants")
          return {
            ...chain(
              { data: [{ id: HOUSE_1, organization_id: ORG }], error: null },
              table,
            ),
            insert: (row: any) => {
              inserts.push({ table, row });
              return chain(
                { data: { id: NEW_HOUSE, name: "Second" }, error: null },
                table,
              );
            },
          };
        if (table === "user_restaurant_access")
          return chain(
            { data: [{ restaurant_id: HOUSE_1 }], error: null },
            table,
          );
        return chain({ data: null, error: null }, table);
      },
    };
    return { svc: new OrganizationsService({ supabase } as any), inserts };
  }

  it("inserts the creator's row for the new house, marked as not the first house", async () => {
    const { svc, inserts } = organizations();

    const created = await svc.createLocation("owner", {
      name: "Second",
      address: "1 Test St",
      city: "Istanbul",
    });

    expect(created.id).toBe(NEW_HOUSE);
    const progress = inserts.filter(
      (i) => i.table === "user_onboarding_progress",
    );
    expect(progress).toEqual([
      {
        table: "user_onboarding_progress",
        row: { user_id: "owner", restaurant_id: NEW_HOUSE, first_house: false },
      },
    ]);
  });
});
