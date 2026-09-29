/**
 * An edit or delete by id changes only the caller's own row
 * (`.planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md`).
 *
 * The sweep of every @Patch/@Put/@Delete route on origin/main 71ae5449b found
 * four writes keyed by an id alone:
 *   - `PATCH /contacts/:id`, `DELETE /contacts/:id` and
 *     `DELETE /contacts/addresses/:addressId` (ContactsService; the module is
 *     not imported by AppModule today, so these were not reachable — fixed so
 *     that mounting it cannot open them);
 *   - `DELETE /mobile/devices/:token` (ExpoPushService.unregisterDevice), which
 *     deleted any person's device row given its push token.
 * Each case below fails on that code and passes on the fix.
 */

import { NotFoundException } from "@nestjs/common";
import { ContactsService } from "../../contacts/contacts.service";
import { ExpoPushService } from "../../push/expo-push.service";
import {
  asDatabaseService,
  makeStubDb,
} from "../../team/testing/supabase-stub";

const A = "house-a";
const B = "house-b";

describe("contacts: an id from another house changes nothing", () => {
  const world = () =>
    makeStubDb({
      contacts: [
        { id: "c-a", restaurant_id: A, display_name: "Ours", is_active: true },
        { id: "c-b", restaurant_id: B, display_name: "Theirs", is_active: true },
      ],
      contact_addresses: [],
    });

  it("PATCH /contacts/:id with house B's id, as house A, is a 404 and B's row is untouched", async () => {
    const db = world();
    const svc = new ContactsService(asDatabaseService(db));

    await expect(
      svc.update("c-b", A, { display_name: "Renamed" }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.tables.contacts.find((c) => c.id === "c-b")).toMatchObject({
      display_name: "Theirs",
      restaurant_id: B,
    });
  });

  it("PATCH /contacts/:id cannot move a contact into another house", async () => {
    const db = world();
    const svc = new ContactsService(asDatabaseService(db));
    // findOne after the write is not what this case is about.
    (svc as any).findOne = async (id: string) => ({ id });

    await svc.update("c-a", A, { display_name: "Ours, renamed", restaurant_id: B } as any);

    expect(db.tables.contacts.find((c) => c.id === "c-a")).toMatchObject({
      display_name: "Ours, renamed",
      restaurant_id: A,
    });
  });

  it("DELETE /contacts/:id with house B's id, as house A, is a 404 and B's contact stays active", async () => {
    const db = world();
    const svc = new ContactsService(asDatabaseService(db));

    await expect(svc.remove("c-b", A)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tables.contacts.find((c) => c.id === "c-b")?.is_active).toBe(true);

    await svc.remove("c-a", A);
    expect(db.tables.contacts.find((c) => c.id === "c-a")?.is_active).toBe(false);
  });

  it("DELETE /contacts/addresses/:addressId deletes only an address whose contact is this house's", async () => {
    // The address row names no house; its contact does. A small fake for the
    // inner-join read the filter-honouring stub does not model.
    const addresses = [
      { id: "addr-a", contact_id: "c-a" },
      { id: "addr-b", contact_id: "c-b" },
    ];
    const houseOf: Record<string, string> = { "c-a": A, "c-b": B };
    const deleted: string[] = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe("contact_addresses");
        const eqs: Record<string, unknown> = {};
        let mode: "select" | "delete" = "select";
        const q: any = {
          select: () => q,
          delete: () => {
            mode = "delete";
            return q;
          },
          eq: (col: string, v: unknown) => {
            eqs[col] = v;
            if (mode === "delete") {
              const i = addresses.findIndex((a) => a.id === eqs.id);
              if (i >= 0) deleted.push(addresses.splice(i, 1)[0].id);
              return Promise.resolve({ error: null });
            }
            return q;
          },
          maybeSingle: async () => {
            const row = addresses.find((a) => a.id === eqs.id);
            const ok = row && houseOf[row.contact_id] === eqs["contacts.restaurant_id"];
            return { data: ok ? { id: row!.id } : null, error: null };
          },
        };
        return q;
      },
    };
    const svc = new ContactsService({ getClient: () => client } as any);

    await expect(svc.removeAddress("addr-b", A)).rejects.toBeInstanceOf(NotFoundException);
    expect(deleted).toEqual([]);

    await svc.removeAddress("addr-a", A);
    expect(deleted).toEqual(["addr-a"]);
  });
});

// The DELETE is scoped to the caller's own row. It is not a closure on its
// own: registerDevice upserts on the token and hands the row to the caller (a
// shared device moving to the next person), so a token holder can re-register
// then delete. Named in the census's Limits, not changed here.
describe("mobile devices: a push token alone cannot unregister someone else's phone", () => {
  it("DELETE /mobile/devices/:token removes only the caller's own row", async () => {
    const db = makeStubDb({
      mobile_devices: [
        { user_id: "user-1", expo_push_token: "ExponentPushToken[one]" },
        { user_id: "user-2", expo_push_token: "ExponentPushToken[two]" },
      ],
    });
    const svc = new ExpoPushService(asDatabaseService(db));

    await svc.unregisterDevice("user-1", "ExponentPushToken[two]");
    expect(db.tables.mobile_devices.map((d) => d.user_id).sort()).toEqual([
      "user-1",
      "user-2",
    ]);

    await svc.unregisterDevice("user-1", "ExponentPushToken[one]");
    expect(db.tables.mobile_devices.map((d) => d.user_id)).toEqual(["user-2"]);
  });
});
