import { ModelClientService } from "./model-client.service";

/**
 * /ask's per-role share of the house's daily allowance (ADR 0145, 2026-09-21
 * amendment, founder's option "Rules in code, label rows"). The ledger double
 * below FILTERS: it keeps only NF rows whose context matches the `context->>`
 * predicate and whose occurred_at is today, so a test passes only when the read
 * really narrows to the role's rows -- a read that summed the whole house would
 * see the owner's spend too and answer differently.
 */
type Row = { id: string; cost_usd: number; occurred_at: string; context: Record<string, string> };

function serviceWith(rows: Row[], opts: { limit?: string; tier?: string; fail?: boolean } = {}) {
  const config = { get: (k: string) => (k === "MODEL_DAILY_SPEND_CEILING_USD" ? opts.limit : undefined) } as any;
  const reads: string[][] = [];
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = [];
    const names: string[] = [];
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => {
        names.push(`${k}=${v}`);
        if (k.startsWith("context->>")) {
          const key = k.slice("context->>".length);
          filters.push(r => r.context?.[key] === v);
        } else if (k === "id" && table === "restaurants") {
          // tier lookup
        } else if (k !== "subject_type" && k !== "restaurant_id") filters.push(r => r[k] === v);
        return q;
      },
      gte: (k: string, v: any) => { names.push(`${k}>=${v}`); filters.push(r => r[k] >= v); return q; },
      is: () => q,
      gt: (k: string, v: any) => { filters.push(r => r[k] > v); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: { subscription_tier: opts.tier ?? "plus" }, error: null }),
      then: (resolve: any) => {
        reads.push(names);
        if (opts.fail) return resolve({ data: null, error: { message: "ledger down" } });
        return resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null });
      },
    };
    return q;
  };
  return { svc: new ModelClientService(config, { supabase: { from } } as any), reads };
}

const today = new Date().toISOString();
const yesterday = new Date(Date.now() - 2 * 86400_000).toISOString();

describe("ModelClientService.dailyShareOfAllowance", () => {
  const ledger: Row[] = [
    { id: "1", cost_usd: 2.0, occurred_at: today, context: { ask_policy_role: "staff" } },
    { id: "2", cost_usd: 2.9, occurred_at: today, context: { ask_policy_role: "owner" } },
    { id: "3", cost_usd: 9.0, occurred_at: yesterday, context: { ask_policy_role: "staff" } },
  ];

  it("sums only today's rows carrying the role, against the house's daily number", async () => {
    const { svc, reads } = serviceWith(ledger); // plus = $5/day
    expect(await svc.dailyShareOfAllowance("h", 0.5, "ask_policy_role", "staff")).toBe("allowed"); // 2.0 < 2.5
    expect(await svc.dailyShareOfAllowance("h", 0.4, "ask_policy_role", "staff")).toBe("used"); // 2.0 >= 2.0
    expect(reads.some(r => r.includes("context->>ask_policy_role=staff"))).toBe(true);
  });

  it("the owner's spend and yesterday's spend never count against the staff share", async () => {
    const { svc } = serviceWith(ledger);
    // All rows would be 13.9; today's house total 4.9; staff today 2.0.
    expect(await svc.dailyShareOfAllowance("h", 0.41, "ask_policy_role", "staff")).toBe("allowed");
  });

  it("FAILS CLOSED: an unreadable ledger is 'unreadable', never 'allowed'", async () => {
    const { svc } = serviceWith(ledger, { fail: true });
    expect(await svc.dailyShareOfAllowance("h", 0.5, "ask_policy_role", "staff")).toBe("unreadable");
  });

  it("a share of 0 admits nothing, without reading", async () => {
    const { svc, reads } = serviceWith(ledger);
    expect(await svc.dailyShareOfAllowance("h", 0, "ask_policy_role", "staff")).toBe("used");
    expect(reads).toHaveLength(0);
  });

  it("the incident override sets the number it takes a share of; a disabled gate (0) has no ceiling to share", async () => {
    expect(await serviceWith(ledger, { limit: "20" }).svc.dailyShareOfAllowance("h", 0.2, "ask_policy_role", "staff")).toBe("allowed"); // 2.0 < 4.0
    expect(await serviceWith(ledger, { limit: "0" }).svc.dailyShareOfAllowance("h", 0.01, "ask_policy_role", "staff")).toBe("allowed");
  });

  it("refuses a context key that is not a plain identifier", async () => {
    const { svc } = serviceWith(ledger);
    await expect(svc.dailyShareOfAllowance("h", 0.5, "x); drop", "staff")).rejects.toThrow("invalid context key");
  });
});
