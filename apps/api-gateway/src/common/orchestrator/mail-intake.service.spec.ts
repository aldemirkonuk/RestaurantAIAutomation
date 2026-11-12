/**
 * Gap G2 (mail software, 2026-11-11): the intake record. A repeat of a
 * settled letter is not published again; a failed publish still counts as
 * recorded (the re-drive publishes it); a delivery with no key is refused.
 */
import { MailIntakeService } from "./mail-intake.service";

type Row = Record<string, any>;

describe("MailIntakeService", () => {
  function svc(existing: Row | null, publish: () => Promise<void>) {
    const db: any = {
      supabase: {
        from: () => {
          const qb: any = {
            upsert: () => qb,
            select: () => qb,
            eq: () => qb,
            maybeSingle: async () => ({ data: existing, error: null }),
            then: (res: any) =>
              Promise.resolve({
                data: existing ? [] : [{ id: "new-1", status: "received" }],
                error: null,
              }).then(res),
          };
          return qb;
        },
      },
    };
    return new MailIntakeService(db, { publishEvent: publish } as any);
  }

  it("a repeat of a settled letter is not published again", async () => {
    const publish = jest.fn(async () => undefined);
    const r = await svc({ id: "old", status: "filed" }, publish).recordAndPublish({
      door: "shared_mailbox",
      providerKey: "g1",
      restaurantId: null,
      event: {},
    });
    expect(r).toMatchObject({ fresh: false, published: false });
    expect(publish).not.toHaveBeenCalled();
  });

  it("a failed publish still counts as recorded: the re-drive publishes it", async () => {
    const r = await svc(null, async () => {
      throw new Error("no channel");
    }).recordAndPublish({ door: "shared_mailbox", providerKey: "g2", restaurantId: null, event: {} });
    expect(r).toMatchObject({ id: "new-1", fresh: true, published: false });
  });

  it("a delivery with no key is refused, never recorded under an empty key", async () => {
    await expect(
      svc(null, async () => undefined).record({
        door: "inbound_address",
        providerKey: " ",
        restaurantId: null,
        payload: {},
      }),
    ).rejects.toThrow(/provider key/);
  });
});

describe("MailIntakeService.houseHealth", () => {
  const DAY = 86_400_000;
  type R = { status: string; created_at: string };

  /** A fake PostgREST: answers head counts exactly, row reads capped at 1000. */
  function fake(rows: R[], failCountFor?: string) {
    const db: any = {
      supabase: {
        from: () => {
          const f: { eq: Record<string, string>; in?: string[]; gte?: string; head?: boolean; limit?: number; asc?: boolean } = { eq: {} };
          const qb: any = {
            select: (_c: string, o?: { head?: boolean }) => ((f.head = Boolean(o?.head)), qb),
            eq: (k: string, v: string) => ((f.eq[k] = v), qb),
            in: (_k: string, v: string[]) => ((f.in = v), qb),
            gte: (_k: string, v: string) => ((f.gte = v), qb),
            order: (_k: string, o: { ascending: boolean }) => ((f.asc = o.ascending), qb),
            limit: (n: number) => ((f.limit = n), qb),
            then: (res: any, rej: any) => {
              let m = rows.filter(
                (r) =>
                  (!f.eq.status || r.status === f.eq.status) &&
                  (!f.in || f.in.includes(r.status)) &&
                  (!f.gte || r.created_at >= f.gte),
              );
              if (f.head) {
                if (failCountFor && f.eq.status === failCountFor) {
                  return Promise.resolve({ count: null, error: { message: "boom" } }).then(res, rej);
                }
                return Promise.resolve({ count: m.length, error: null }).then(res, rej);
              }
              m = [...m].sort((a, b) => a.created_at.localeCompare(b.created_at));
              if (f.asc === false) m.reverse();
              return Promise.resolve({ data: m.slice(0, Math.min(f.limit ?? 1000, 1000)), error: null }).then(res, rej);
            },
          };
          return qb;
        },
      },
    };
    return new MailIntakeService(db, { publishEvent: async () => undefined } as any);
  }
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

  it("reports counts above 1000 whole", async () => {
    const rows: R[] = Array.from({ length: 1500 }, () => ({ status: "filed", created_at: ago(1) }));
    const h = await fake(rows).houseHealth("r1");
    expect(h.unknown).toBe(false);
    expect(h.byStatus.filed).toBe(1500);
    expect(h.waiting).toBe(0);
    expect(h.oldestWaitingAt).toBeNull();
  });

  it("counts a letter that gave up 8 days ago as waiting, and names it the oldest", async () => {
    const old = ago(8);
    const rows: R[] = [
      { status: "gave_up", created_at: old },
      { status: "failed", created_at: ago(1) },
      { status: "filed", created_at: ago(8) },
    ];
    const h = await fake(rows).houseHealth("r1");
    expect(h.waiting).toBe(2);
    expect(h.oldestWaitingAt).toBe(old);
    expect(h.byStatus.gave_up).toBe(1);
    // A settled letter older than 7 days is outside the window.
    expect(h.byStatus.filed).toBe(0);
  });

  it("an error on any one count makes the whole answer unknown, never zero", async () => {
    const h = await fake([{ status: "filed", created_at: ago(1) }], "held").houseHealth("r1");
    expect(h).toEqual({ byStatus: {}, waiting: 0, oldestWaitingAt: null, unknown: true });
  });
});
