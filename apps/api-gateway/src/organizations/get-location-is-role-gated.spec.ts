/**
 * `GET /organizations/locations/:id` — the read is gated, and it returns the plan.
 *
 * Two things this file pins, both of which were false before 2026-09-03:
 *
 *  1. The READ posture matches the WRITE posture. `updateLocation` has always
 *     called `assertManagerOrOwner`; `getLocation` checked organisation
 *     membership and stopped, so a staff member calling the endpoint directly
 *     could read the restaurant's billing email and phone while the UI pretended
 *     the server was hiding it. `/profile` had to describe that gap in prose.
 *  2. `subscription_tier` reaches the caller. It exists on `restaurants` and no
 *     browser-reachable endpoint returned it, which is why `/profile` rendered
 *     the plan as an em dash. It is returned RAW — an absent value stays absent
 *     rather than becoming a flattering default.
 *
 * The role lookup is exercised through both of its paths (the
 * `user_restaurant_access` row and the legacy `users.role` fallback), because a
 * guard that only works when the URA row exists would be off for exactly the
 * legacy accounts `assertManagerOrOwner` was written to cover.
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import { DatabaseService } from "../database/database.service";

interface Rows {
  orgMembers?: { organization_id: string }[];
  restaurant?: Record<string, unknown> | null;
  access?: { role: string } | null;
  user?: { role: string; restaurant_id: string } | null;
}

/** Records what was asked for, so the select list itself can be asserted. */
interface Probe {
  selects: { table: string; columns: string }[];
}

function makeService(rows: Rows): { service: OrganizationsService; probe: Probe } {
  const probe: Probe = { selects: [] };

  const query = (table: string) => {
    let columns = "";
    const builder: Record<string, unknown> = {
      select(cols: string) {
        columns = cols;
        probe.selects.push({ table, columns: cols });
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      upsert: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => {
        if (table === "restaurants") {
          return Promise.resolve({ data: rows.restaurant ?? null, error: null });
        }
        if (table === "user_restaurant_access") {
          return Promise.resolve({ data: rows.access ?? null, error: null });
        }
        if (table === "users") {
          return Promise.resolve({ data: rows.user ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // `getUserOrgIds` awaits the builder itself rather than calling a
      // terminator, so the builder has to be thenable.
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: rows.orgMembers ?? [], error: null }),
    };
    void columns;
    return builder;
  };

  const db = { supabase: { from: (table: string) => query(table) } };
  return {
    service: new OrganizationsService(db as unknown as DatabaseService),
    probe,
  };
}

const RESTAURANT = {
  id: "r1",
  name: "Ada Lokantası",
  city: "İzmir",
  email: "billing@ada.example",
  phone: "+90 555 000 0000",
  subscription_tier: "pilot",
};

describe("OrganizationsService.getLocation", () => {
  it("refuses a staff member — the read posture now matches the write posture", async () => {
    const { service } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: RESTAURANT,
      access: { role: "staff" },
    });

    await expect(service.getLocation("u-staff", "r1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("names the refused action, so the message is not the write's message", async () => {
    const { service } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: RESTAURANT,
      access: { role: "staff" },
    });

    await expect(service.getLocation("u-staff", "r1")).rejects.toThrow(
      "Only managers and owners can read the restaurant record",
    );
  });

  it("refuses a legacy account with no user_restaurant_access row", async () => {
    const { service } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: RESTAURANT,
      access: null,
      user: { role: "staff", restaurant_id: "r1" },
    });

    await expect(service.getLocation("u-legacy", "r1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows a manager, and returns the plan the browser could not previously read", async () => {
    const { service, probe } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: RESTAURANT,
      access: { role: "manager" },
    });

    const location = await service.getLocation("u-mgr", "r1");

    expect(location.subscriptionTier).toBe("pilot");
    expect(location.email).toBe("billing@ada.example");
    const restaurantSelect = probe.selects.find((s) => s.table === "restaurants");
    expect(restaurantSelect?.columns).toContain("subscription_tier");
  });

  it("allows a legacy owner resolved through users.role", async () => {
    const { service } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: RESTAURANT,
      access: null,
      user: { role: "owner", restaurant_id: "r1" },
    });

    await expect(service.getLocation("u-legacy-owner", "r1")).resolves.toMatchObject({
      id: "r1",
      subscriptionTier: "pilot",
    });
  });

  it("returns the plan as null rather than a default when the column is empty", async () => {
    const { service } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: { ...RESTAURANT, subscription_tier: null },
      access: { role: "owner" },
    });

    await expect(service.getLocation("u-owner", "r1")).resolves.toMatchObject({
      subscriptionTier: null,
    });
  });

  it("still 404s a restaurant outside the organisation, so the role check cannot leak existence", async () => {
    const { service } = makeService({
      orgMembers: [{ organization_id: "o1" }],
      restaurant: null,
      access: { role: "owner" },
    });

    await expect(service.getLocation("u-owner", "other")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
