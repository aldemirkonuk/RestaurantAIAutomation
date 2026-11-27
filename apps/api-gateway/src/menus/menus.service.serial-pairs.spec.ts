import { ConflictException } from "@nestjs/common";
import { MenusService } from "./menus.service";

/**
 * Perf p8-s8. makeCurrent read the menu's lines and then its version row, and
 * PATCH /onboarding/progress read the restaurants threshold it threw away.
 */
function makeCurrentService(
  lines: () => Promise<unknown>,
  version: () => Promise<unknown>,
) {
  const rpc = jest.fn();
  const svc = new MenusService({ supabase: { rpc } } as any, {} as any, {} as any, {} as any);
  (svc as any).readLines = jest.fn(lines);
  (svc as any).readVersionRow = jest.fn(version);
  (svc as any).computePlan = jest.fn().mockResolvedValue({ fingerprint: "fp" });
  return { svc, rpc };
}

describe("makeCurrent — the lines and the version row are asked together", () => {
  it("starts the version read before the lines read answers", async () => {
    let releaseLines: (v: unknown) => void = () => undefined;
    const { svc } = makeCurrentService(
      () => new Promise((r) => (releaseLines = r)),
      async () => ({ status: "draft" }),
    );
    const pending = svc.makeCurrent("r1", "m1", "u1", "other");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect((svc as any).readVersionRow).toHaveBeenCalledTimes(1);
    releaseLines([]);
    await expect(pending).rejects.toBeInstanceOf(ConflictException);
  });

  it("a failed lines read throws before the switch", async () => {
    const { svc, rpc } = makeCurrentService(
      async () => {
        throw new Error("Failed to load menu items: down");
      },
      async () => ({ status: "draft" }),
    );
    await expect(svc.makeCurrent("r1", "m1", "u1", "fp")).rejects.toThrow(
      "Failed to load menu items: down",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("when both reads fail, the lines' failure is the one said", async () => {
    const { svc, rpc } = makeCurrentService(
      async () => {
        throw new Error("lines down");
      },
      async () => {
        throw new Error("version down");
      },
    );
    await expect(svc.makeCurrent("r1", "m1", "u1", "fp")).rejects.toThrow("lines down");
    expect(rpc).not.toHaveBeenCalled();
  });
});

function progressService(row: Record<string, unknown>, activeMenu: boolean) {
  const reads: string[] = [];
  const patches: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      reads.push(table);
      let mode = "read";
      const c: any = {
        select: () => c,
        eq: () => c,
        update: (p: Record<string, unknown>) => {
          mode = "update";
          patches.push(p);
          return c;
        },
        maybeSingle: async () => {
          if (table === "user_onboarding_progress") return { data: row, error: null };
          if (table === "restaurant_menus")
            return { data: activeMenu ? { id: "m1" } : null, error: null };
          return { data: { threshold_configured: true }, error: null };
        },
        single: async () => ({ data: { ...row, ...patches[patches.length - 1] }, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
      };
      void mode;
      return c;
    },
  };
  const svc = new MenusService({ supabase } as any, {} as any, {} as any, {} as any);
  return { svc, reads, patches };
}

const ROW = {
  id: "p1",
  restaurant_id: "r1",
  menu_uploaded: false,
  vendor_added: true,
  team_member_invited: true,
  completed_at: null,
};

describe("updateOnboardingProgress — reads the row and the menu heal, not the threshold", () => {
  it("never reads restaurants", async () => {
    const { svc, reads } = progressService(ROW, false);
    await svc.updateOnboardingProgress("u1", { checklist_dismissed: true } as any);
    expect(reads).not.toContain("restaurants");
  });

  it("completes when the healed menu makes all three true (rule unchanged)", async () => {
    const { svc, patches } = progressService(ROW, true);
    await svc.updateOnboardingProgress("u1", { checklist_dismissed: true } as any);
    expect(patches[0]).toEqual({ menu_uploaded: true });
    expect(patches[1]).toMatchObject({ checklist_dismissed: true });
    expect(typeof (patches[1] as any).completed_at).toBe("string");
  });

  it("does not complete while a task is still open", async () => {
    const { svc, patches } = progressService(ROW, false);
    await svc.updateOnboardingProgress("u1", { checklist_dismissed: true } as any);
    expect(patches).toEqual([{ checklist_dismissed: true }]);
  });
});
