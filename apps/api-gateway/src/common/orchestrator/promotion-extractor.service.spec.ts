import { PromotionExtractorService } from "./promotion-extractor.service";

/**
 * F-656: a read that failed is not "no offers". The daily digest used to read
 * only `{ data }`, so an outage looked exactly like a quiet day, and the
 * duplicate check read a failure as "no duplicate".
 */

function makeService(readError: string) {
  const writes: string[] = [];
  const builder = (): any => {
    const b: any = {
      select: () => b,
      eq: () => b,
      gte: () => b,
      contains: () => b,
      limit: () => b,
      insert: () => (writes.push("insert"), b),
      single: () => b,
      // The house's zone (F-322) is read first; unread, the server's clock
      // dates the offer (integ stub).
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      in: () => b,
      or: () => b,
      ilike: () => b,
      then: (res: any, rej: any) =>
        Promise.resolve({ data: null, error: { message: readError } }).then(
          res,
          rej,
        ),
    };
    return b;
  };
  const gateway = { emitRoleNotification: jest.fn() };
  const responder = { persistManagerNotification: jest.fn() };
  const svc = new PromotionExtractorService(
    { supabase: { from: () => builder() } } as any,
    gateway as any,
    responder as any,
  );
  const logger = (svc as any).logger;
  logger.error = jest.fn();
  logger.warn = jest.fn();
  logger.log = jest.fn();
  return { svc, gateway, responder, logger, writes };
}

describe("PromotionExtractorService reads that fail", () => {
  it("says the digest read failed and sends nothing", async () => {
    const t = makeService("connection reset");
    await t.svc.sendDailyDigests();
    expect(t.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection reset"),
    );
    expect(t.gateway.emitRoleNotification).not.toHaveBeenCalled();
    expect(t.responder.persistManagerNotification).not.toHaveBeenCalled();
  });

  it("does not store a promo when the duplicate check could not run", async () => {
    const t = makeService("statement timeout");
    const out = await t.svc.extractAndStore({
      conversationId: "c1",
      restaurantId: "r1",
      providerId: "p1",
      subject: "20% off all Barolo this week only",
      body: "Spring sale: take 20% off every case of Barolo until Friday. Use code SPRING20.",
      transport: { bulk: true, listMail: true, esp: null } as any,
    });
    expect(out).toEqual({ stored: false, reason: "duplicate check failed" });
    expect(t.writes).toEqual([]);
  });
});
