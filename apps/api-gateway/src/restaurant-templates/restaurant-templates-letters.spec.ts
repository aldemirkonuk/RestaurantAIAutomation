import { ForbiddenException } from "@nestjs/common";
import { RestaurantTemplatesService } from "./restaurant-templates.service";

/**
 * F-1358: the house's vendor letter templates (`type = 'letter'`) share
 * `communication_templates` with the sign-off name, and this route had no
 * role check, so staff could rewrite or delete a letter F-1301 kept for
 * those who may send. Letter rows now take the send standing; the sign-off
 * name stays editable by every member, as before.
 */

type Row = Record<string, any>;

function fakeDb(rows: Row[]) {
  const writes: { op: string; payload?: Row }[] = [];
  const from = () => {
    const filters: Record<string, unknown> = {};
    let op = "select";
    let payload: Row | undefined;
    const matching = () =>
      rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const q: any = {
      select: () => q,
      insert: (p: Row) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      eq: (k: string, v: unknown) => ((filters[k] = v), q),
      order: () => q,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      single: async () => {
        writes.push({ op, payload });
        return {
          data: {
            ...(matching()[0] ?? {}),
            ...payload,
            id: matching()[0]?.id ?? "new",
          },
          error: null,
        };
      },
      then: (res: any, rej: any) => {
        if (op !== "select") writes.push({ op, payload });
        return Promise.resolve({
          data: op === "select" ? matching() : null,
          error: null,
        }).then(res, rej);
      },
    };
    return q;
  };
  return { db: { supabase: { from } } as any, writes };
}

const ROWS: Row[] = [
  {
    id: "L1",
    restaurant_id: "R",
    type: "letter",
    name: "Price query",
    subject: "Prices",
    body: "Dear vendor, our price is 12",
    is_active: true,
  },
  {
    id: "S1",
    restaurant_id: "R",
    type: "sender_identity",
    name: "Sender identity",
    body: "Ayse",
    is_active: true,
  },
];

const authority = (maySend: boolean) =>
  ({ readout: jest.fn(async () => ({ readable: true, maySend })) }) as any;

describe("restaurant templates route and the house's letter templates (F-1358)", () => {
  it("refuses staff without send standing a PATCH on a letter row, and writes nothing", async () => {
    const { db, writes } = fakeDb(ROWS);
    const svc = new RestaurantTemplatesService(db, authority(false));
    await expect(
      svc.updateTemplate("R", "L1", { body: "changed" }, "staff-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });

  it("refuses staff a DELETE of a letter row", async () => {
    const { db, writes } = fakeDb(ROWS);
    const svc = new RestaurantTemplatesService(db, authority(false));
    await expect(
      svc.deleteTemplate("R", "L1", "staff-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });

  it("refuses staff a POST of a letter row, or turning another row into one", async () => {
    const { db } = fakeDb(ROWS);
    const svc = new RestaurantTemplatesService(db, authority(false));
    await expect(
      svc.createTemplate(
        "R",
        { name: "x", body: "y", type: "letter" },
        "staff-1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.updateTemplate("R", "S1", { type: "letter" }, "staff-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps the sign-off name editable by staff", async () => {
    const { db, writes } = fakeDb(ROWS);
    const svc = new RestaurantTemplatesService(db, authority(false));
    await svc.updateTemplate("R", "S1", { body: "Mehmet" }, "staff-1");
    expect(writes).toEqual([{ op: "update", payload: { body: "Mehmet" } }]);
  });

  it("lets someone who may send edit and delete a letter row", async () => {
    const { db, writes } = fakeDb(ROWS);
    const svc = new RestaurantTemplatesService(db, authority(true));
    await svc.updateTemplate("R", "L1", { body: "changed" }, "manager-1");
    await svc.deleteTemplate("R", "L1", "manager-1");
    expect(writes.map((w) => w.op)).toEqual(["update", "update"]);
  });

  it("lists a letter row to staff without its words, and says they were left out", async () => {
    const { db } = fakeDb(ROWS);
    const rows = await new RestaurantTemplatesService(
      db,
      authority(false),
    ).listTemplates("R", "staff-1");
    const letter = rows.find((r) => r.id === "L1")!;
    expect(letter.body).toBe("");
    expect(letter.subject).toBeUndefined();
    expect(letter.bodyWithheld).toBe(true);
    expect(rows.find((r) => r.id === "S1")!.body).toBe("Ayse");
  });

  it("lists the letter's words to someone who may send", async () => {
    const { db } = fakeDb(ROWS);
    const rows = await new RestaurantTemplatesService(
      db,
      authority(true),
    ).listTemplates("R", "owner-1");
    expect(rows.find((r) => r.id === "L1")!.body).toBe(
      "Dear vendor, our price is 12",
    );
  });
});
