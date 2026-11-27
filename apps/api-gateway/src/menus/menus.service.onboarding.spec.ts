import { InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { MenusService } from "./menus.service";

/**
 * GET /onboarding/progress is asked on every page's cold load. The house's
 * setup is read from the house's own tables (#770/#1089), and those reads need
 * only the session's restaurant_id, so they all start together: one wait, not
 * one per table (the intent of the earlier "menu read and threshold read
 * together" change, now that the setup is the house's and not the person's row).
 *
 * Every read here is gated: it logs its start, and answers only when released.
 * If a read were awaited before the next began, it would never start before the
 * first was released, and the count of reads in flight would stay at one.
 */
type Reply = { data: unknown; error: { message: string } | null };

function build(opts: { failTable?: string } = {}) {
  const started: string[] = [];
  const release: Array<() => void> = [];
  const writes: unknown[] = [];
  const answer = (table: string): Reply =>
    table === opts.failTable
      ? { data: null, error: { message: "boom" } }
      : { data: table === "restaurants" ? { threshold_configured: true } : [], error: null };
  const gated = (table: string) =>
    new Promise<Reply>((resolve) => {
      started.push(table);
      release.push(() => resolve(answer(table)));
    });
  const supabase = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        is: () => chain,
        in: () => chain,
        not: () => chain,
        or: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (v: unknown) => (writes.push(v), chain),
        update: (v: unknown) => (writes.push(v), chain),
        upsert: (v: unknown) => (writes.push(v), chain),
        delete: () => (writes.push("delete"), chain),
        maybeSingle: () => gated(table),
        single: () => gated(table),
        then: (res: (v: Reply) => unknown, rej?: (e: unknown) => unknown) =>
          gated(table).then(res, rej),
      };
      return chain;
    },
  };
  const svc = new MenusService({ supabase } as any, {} as any, {} as any, {} as any);
  return { svc, started, release, writes };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("getOnboardingProgress (the house's setup)", () => {
  it("starts every house read together before any one has answered", async () => {
    const { svc, started, release } = build();
    const read = svc.getOnboardingProgress("u1", "r1");
    await flush();
    // the person's row, the two menu reads, supplier, invite, settings and the
    // next-steps reads are all in flight; nothing has been released yet
    expect(started.length).toBeGreaterThanOrEqual(6);
    expect(started).toEqual(
      expect.arrayContaining([
        "user_onboarding_progress",
        "menu_items",
        "providers",
        "organization_invites",
        "restaurants",
      ]),
    );
    release.forEach((f) => f());
    await read;
  });

  it("answers without writing anything (a GET heals nothing)", async () => {
    const { svc, release, writes } = build();
    const read = svc.getOnboardingProgress("u1", "r1");
    await flush();
    release.forEach((f) => f());
    const value = await read;
    expect(value).toMatchObject({
      restaurant_id: "r1",
      menu_uploaded: false,
      menu_current: false,
      threshold_configured: true,
      activated: false,
    });
    expect(writes).toEqual([]);
  });

  it("a failed menu read fails the read; it is never taken for 'no menu yet'", async () => {
    const { svc, release } = build({ failTable: "menu_items" });
    const read = svc.getOnboardingProgress("u1", "r1");
    const settled = read.then(
      () => null,
      (e) => e,
    );
    await flush();
    release.forEach((f) => f());
    expect(await settled).toBeInstanceOf(InternalServerErrorException);
  });

  it("a session in no house reads nothing and says so", async () => {
    const { svc, started } = build();
    await expect(svc.getOnboardingProgress("u1", null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(started).toEqual([]);
  });
});
