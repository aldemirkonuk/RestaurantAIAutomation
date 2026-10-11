/**
 * F-1233: the calendar's own type-name check ("already on this calendar", a
 * 409) saw only the exact spelling, because the table's UNIQUE (restaurant_id,
 * name) is byte-exact. "İzmir tasting" and "izmir tasting" both went in, while
 * the web's EventSheet (F-1179) already folds İ/ı and case the same way. The
 * gateway now folds with the same rule before it writes.
 */
import {
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import { CalendarService } from "./calendar.service";

const HOUSE = "r-1";

function service(
  existing: Array<{ id: string; name: string }>,
  readFails = false,
) {
  const inserted: any[] = [];
  const updated: any[] = [];
  const supabase = {
    from: jest.fn(() => {
      let mode: "read" | "insert" | "update" = "read";
      let payload: any = null;
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        insert: (p: any) => {
          mode = "insert";
          payload = p;
          inserted.push(p);
          return q;
        },
        update: (p: any) => {
          mode = "update";
          payload = p;
          updated.push(p);
          return q;
        },
        single: () =>
          Promise.resolve({
            data: { id: "t-new", color: "#000", icon: null, ...payload },
            error: null,
          }),
        then: (res: any, rej: any) =>
          Promise.resolve(
            mode === "read" && readFails
              ? { data: null, error: { message: "boom" } }
              : { data: existing, error: null },
          ).then(res, rej),
      };
      return q;
    }),
  };
  const svc = new CalendarService({ supabase } as any, {} as any);
  return { svc, inserted, updated };
}

describe("F-1233: an event-type name is unique the way the page folds it", () => {
  it.each([
    ["İzmir tasting", "izmir tasting"],
    ["Rakı night", "RAKI NIGHT"],
    ["Kavaklıdere dinner", "kavaklidere dinner"],
    ["Wine dinner", "  wine DINNER "],
  ])("refuses %s when %s is already there", async (taken, asked) => {
    const { svc, inserted } = service([{ id: "t-1", name: taken }]);

    await expect(
      svc.createEventType({
        restaurantId: HOUSE,
        name: asked,
        color: "#111",
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a built-in type's name in another case", async () => {
    const { svc, inserted } = service([]);
    await expect(
      svc.createEventType({
        restaurantId: HOUSE,
        name: "HOLİDAY",
        color: "#111",
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserted).toHaveLength(0);
  });

  it("saves a name that is new after folding", async () => {
    const { svc, inserted } = service([{ id: "t-1", name: "İzmir tasting" }]);
    await svc.createEventType({
      restaurantId: HOUSE,
      name: "Ankara tasting",
      color: "#111",
    } as any);
    expect(inserted).toHaveLength(1);
  });

  it("refuses a rename onto another type's folded name, not onto its own", async () => {
    const existing = [
      { id: "t-1", name: "İzmir tasting" },
      { id: "t-2", name: "Ankara tasting" },
    ];
    const a = service(existing);
    await expect(
      a.svc.updateEventType("t-2", HOUSE, { name: "izmir TASTING" } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(a.updated).toHaveLength(0);

    const b = service(existing);
    await b.svc.updateEventType("t-1", HOUSE, { name: "IZMIR tasting" } as any);
    expect(b.updated).toHaveLength(1);
  });

  it("refuses to save when the names could not be read", async () => {
    const { svc, inserted } = service([], true);
    await expect(
      svc.createEventType({
        restaurantId: HOUSE,
        name: "Wine dinner",
        color: "#111",
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(inserted).toHaveLength(0);
  });
});
