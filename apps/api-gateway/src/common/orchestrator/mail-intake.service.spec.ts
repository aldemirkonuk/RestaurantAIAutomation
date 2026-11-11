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
