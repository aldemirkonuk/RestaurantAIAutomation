import { MenusService } from "./menus.service";

/**
 * GET /onboarding/progress is asked on every page's cold load. Once the
 * progress row is in, the active-menu read and the restaurant-threshold read
 * need only its restaurant_id, so they start together (two waits, not three).
 */
type Row = Record<string, unknown> | null;
function build(opts: {
  progress: Row;
  menu?: Row;
  restaurant?: Row;
  menuReadFails?: boolean;
}) {
  const log: string[] = [];
  const pending: Array<() => void> = [];
  const gated = (name: string, result: unknown) =>
    new Promise((resolve) => {
      log.push(`start:${name}`);
      pending.push(() => {
        log.push(`end:${name}`);
        resolve(result);
      });
    });
  const updates: unknown[] = [];
  const supabase = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        update: (patch: unknown) => {
          updates.push(patch);
          return chain;
        },
        maybeSingle: () => {
          if (table === "user_onboarding_progress")
            return Promise.resolve({ data: opts.progress, error: null });
          if (table === "restaurant_menus")
            return gated(
              "menu",
              opts.menuReadFails
                ? { data: null, error: { message: "boom" } }
                : { data: opts.menu ?? null, error: null },
            );
          return gated("threshold", { data: opts.restaurant ?? null, error: null });
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
      };
      return chain;
    },
  };
  const svc = new MenusService({ supabase } as any, {} as any, {} as any, {} as any);
  return { svc, log, pending, updates };
}

const ROW = { id: "p1", restaurant_id: "r1", menu_uploaded: false, vendor_added: false, team_member_invited: false };

async function settle(p: Promise<unknown>, pending: Array<() => void>) {
  // let the progress row resolve, then release whatever reads have started
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const started = [...pending];
  started.forEach((f) => f());
  return { value: await p, startedBeforeRelease: started.length };
}

describe("getOnboardingProgress", () => {
  it("starts the menu read and the threshold read together", async () => {
    const { svc, log, pending } = build({ progress: ROW, menu: { id: "m1" }, restaurant: { threshold_configured: true } });
    const { startedBeforeRelease } = await settle(svc.getOnboardingProgress("u1"), pending);
    expect(startedBeforeRelease).toBe(2);
    expect(log.slice(0, 2).sort()).toEqual(["start:menu", "start:threshold"]);
  });

  it("answers the same when the menu exists (and heals the row once)", async () => {
    const { svc, pending, updates } = build({ progress: ROW, menu: { id: "m1" }, restaurant: { threshold_configured: true } });
    const { value } = await settle(svc.getOnboardingProgress("u1"), pending);
    expect(value).toMatchObject({ menu_uploaded: true, threshold_configured: true, activated: true });
    expect(updates).toEqual([{ menu_uploaded: true }]);
  });

  it("answers the same when there is no menu", async () => {
    const { svc, pending, updates } = build({ progress: ROW, menu: null, restaurant: { threshold_configured: true } });
    const { value } = await settle(svc.getOnboardingProgress("u1"), pending);
    expect(value).toMatchObject({ menu_uploaded: false, threshold_configured: true, activated: false });
    expect(updates).toEqual([]);
  });

  it("answers the same when the threshold read gives nothing", async () => {
    const { svc, pending } = build({ progress: ROW, menu: { id: "m1" }, restaurant: null });
    const { value } = await settle(svc.getOnboardingProgress("u1"), pending);
    expect(value).toMatchObject({ menu_uploaded: true, threshold_configured: false, activated: false });
  });

  it("a failed menu read is not a healed menu and writes nothing", async () => {
    const { svc, pending, updates } = build({ progress: ROW, menuReadFails: true, restaurant: { threshold_configured: true } });
    const { value } = await settle(svc.getOnboardingProgress("u1"), pending);
    expect(value).toMatchObject({ menu_uploaded: false });
    expect(updates).toEqual([]);
  });

  it("reads no menu when the row already says a menu was uploaded", async () => {
    const { svc, log, pending } = build({ progress: { ...ROW, menu_uploaded: true }, restaurant: { threshold_configured: false } });
    const { value, startedBeforeRelease } = await settle(svc.getOnboardingProgress("u1"), pending);
    expect(startedBeforeRelease).toBe(1);
    expect(log).not.toContain("start:menu");
    expect(value).toMatchObject({ menu_uploaded: true, activated: false });
  });
});
