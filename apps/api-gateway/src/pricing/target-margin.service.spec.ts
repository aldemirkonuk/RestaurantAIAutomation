import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { TargetMarginService } from "./target-margin.service";
import { PricingController } from "./pricing.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * ADR 0193 -- the house's target margin: typed by an owner or manager, never
 * defaulted, audited. The service runs for real against a fake client that
 * records every update; the audit double records what it was asked to file.
 */

type Row = Record<string, any>;

function fake(house: Row | null, opts: { readError?: string; writeError?: string } = {}) {
  const updates: Row[] = [];
  const client = {
    from: (table: string) => {
      let patch: Row | null = null;
      const api: any = {
        select: () => api,
        update: (p: Row) => {
          patch = p;
          return api;
        },
        eq: () => api,
        maybeSingle: async () => {
          if (table === "users") return { data: { name: "Manager A" }, error: null };
          if (opts.readError) return { data: null, error: { message: opts.readError } };
          return { data: house, error: null };
        },
        then: (resolve: any) => {
          if (patch) {
            if (opts.writeError) return resolve({ data: null, error: { message: opts.writeError } });
            updates.push(patch);
            house = { ...(house ?? {}), ...patch };
          }
          resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
  const audits: Row[] = [];
  const audit = {
    record: async (change: Row) => {
      audits.push(change);
      return { recorded: true, reason: null };
    },
  };
  const svc = new TargetMarginService({ client } as any, audit as any);
  return { svc, updates, audits };
}

const UNSET = {
  target_margin_bottle_pct: null,
  target_margin_glass_pct: null,
  target_margin_band_pct: null,
  target_margin_set_by: null,
  target_margin_set_at: null,
};

describe("TargetMarginService.read", () => {
  it("an unset house reads as null targets -- no default", async () => {
    const { svc } = fake(UNSET);
    const r = await svc.read("rest-1");
    expect(r).toMatchObject({ bottlePct: null, glassPct: null, bandPct: null, readable: true, statedBy: null });
  });

  it("a failed read is readable:false with the reason -- never 'not set'", async () => {
    const { svc } = fake(UNSET, { readError: "permission denied" });
    const r = await svc.read("rest-1");
    expect(r.readable).toBe(false);
    expect(r.reason).toBe("permission denied");
  });

  it("NUMERIC strings from PostgREST become numbers", async () => {
    const { svc } = fake({
      ...UNSET,
      target_margin_bottle_pct: "65.00",
      target_margin_band_pct: "2.00",
      target_margin_set_by: "user-1",
      target_margin_set_at: "2026-09-21T09:00:00Z",
    });
    const r = await svc.read("rest-1");
    expect(r).toMatchObject({ bottlePct: 65, glassPct: null, bandPct: 2, statedBy: { userId: "user-1", name: "Manager A" } });
  });
});

describe("TargetMarginService.write", () => {
  it("writes the targets, the band, the person and the moment in ONE update, and files the change", async () => {
    const { svc, updates, audits } = fake(UNSET);
    const r = await svc.write("rest-1", { bottlePct: 65, glassPct: 75, bandPct: 2 }, "user-1");

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      target_margin_bottle_pct: 65,
      target_margin_glass_pct: 75,
      target_margin_band_pct: 2,
      target_margin_set_by: "user-1",
    });
    expect(typeof updates[0].target_margin_set_at).toBe("string");
    expect(audits[0]).toMatchObject({
      action: "target_margin_changed",
      register: "target-margin",
      actorUserId: "user-1",
      fields: {
        target_margin_bottle_pct: { from: null, to: 65 },
        target_margin_glass_pct: { from: null, to: 75 },
        target_margin_band_pct: { from: null, to: 2 },
      },
    });
    expect(r.audited).toBe(true);
  });

  it.each([
    [{ bottlePct: 0.65, bandPct: 2 }, /PERCENT/],
    [{ bottlePct: 96, bandPct: 2 }, /above 95/],
    [{ glassPct: 4.99, bandPct: 2 }, /below 5/],
    [{ bottlePct: 65 }, /close enough/],
    [{ bottlePct: 65, bandPct: 21 }, /between 0 and 20/],
    [{ bottlePct: 65, bandPct: -1 }, /between 0 and 20/],
    [{ bottlePct: null, glassPct: null, bandPct: 2 }, /Name a target/],
    [{ bandPct: 2 }, /Name a target/],
  ])("refuses %j, and writes nothing", async (body, message) => {
    const { svc, updates } = fake(UNSET);
    await expect(svc.write("rest-1", body as any, "user-1")).rejects.toThrow(message);
    await expect(svc.write("rest-1", body as any, "user-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it("the band is a PERCENT of the advised price: the refusal says so", async () => {
    const { svc } = fake(UNSET);
    await expect(svc.write("rest-1", { bottlePct: 65 } as any, "user-1")).rejects.toThrow(
      /percent of the advised price/,
    );
  });

  it("refuses to write over a value it could not read", async () => {
    const { svc, updates } = fake(UNSET, { readError: "timeout" });
    await expect(svc.write("rest-1", { bottlePct: 65, bandPct: 2 }, "user-1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(updates).toHaveLength(0);
  });

  it("a failed write is an error, not a readout", async () => {
    const { svc } = fake(UNSET, { writeError: "check violation" });
    await expect(svc.write("rest-1", { bottlePct: 65, bandPct: 2 }, "user-1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("TargetMarginService.confirmPour — once, by an owner or manager, audited", () => {
  it("an unconfirmed house reports no pour at all, not the column's 150 ml default", async () => {
    const { svc } = fake({ ...UNSET, default_pour_ml: 150, pour_size_confirmed_by: null, pour_size_confirmed_at: null });
    const r = await svc.read("rest-1");
    expect(r.pour).toEqual({ confirmed: false, ml: null, confirmedAt: null, confirmedBy: null });
  });

  it("writes the pour, the person and the moment in ONE update, files it, and reads back confirmed", async () => {
    const { svc, updates, audits } = fake({ ...UNSET, default_pour_ml: 150 });
    const r = await svc.confirmPour("rest-1", { pourMl: 125 }, "user-1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ default_pour_ml: 125, pour_size_confirmed_by: "user-1" });
    expect(typeof updates[0].pour_size_confirmed_at).toBe("string");
    expect(audits[0]).toMatchObject({
      action: "pour_size_confirmed",
      register: "target-margin",
      fields: { default_pour_ml: { from: null, to: 125 } },
    });
    expect(r.pour).toMatchObject({ confirmed: true, ml: 125, confirmedBy: { userId: "user-1", name: "Manager A" } });
    expect(r.audited).toBe(true);
  });

  it.each([[{}], [{ pourMl: "125" }], [{ pourMl: 9 }], [{ pourMl: 501 }]])(
    "refuses %j and writes nothing",
    async (body) => {
      const { svc, updates } = fake(UNSET);
      await expect(svc.confirmPour("rest-1", body as any, "user-1")).rejects.toBeInstanceOf(BadRequestException);
      expect(updates).toHaveLength(0);
    },
  );
});

/**
 * Who may state the target, and who may accept a price change: an owner or a
 * manager ("advise the manager or owner", founder 2026-09-21). The real
 * OrganizationsService runs; only its access-row read is stubbed.
 */
describe("PricingController — owner or manager only for the two writes", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const write = jest.fn(async () => ({ readable: true }));
    const confirmPour = jest.fn(async () => ({ readable: true }));
    const accept = jest.fn(async () => ({ outcome: "changed" }));
    const c = new PricingController(
      { write, confirmPour, read: jest.fn() } as any,
      { accept, adviseHouse: jest.fn() } as any,
      organizations,
    );
    return { c, write, accept, confirmPour };
  }
  const DTO = { bottlePct: 65, bandPct: 2 } as any;
  const ACCEPT = { kind: "bottle", advisedPrice: 57.14 } as any;
  const INV = "00000000-0000-4000-8000-000000000001";

  it.each(["owner", "manager"])("a %s may state the target, confirm the pour and accept advice", async (role) => {
    const { c, write, accept, confirmPour } = controller(role);
    await c.setTargetMargin("rest-1", "user-1", DTO);
    await c.confirmPourSize("rest-1", "user-1", { pourMl: 125 } as any);
    await c.acceptAdvice("rest-1", "user-1", INV, ACCEPT);
    expect(write).toHaveBeenCalledWith("rest-1", DTO, "user-1");
    expect(confirmPour).toHaveBeenCalledWith("rest-1", { pourMl: 125 }, "user-1");
    expect(accept).toHaveBeenCalledWith("rest-1", INV, "bottle", 57.14, "user-1");
  });

  it.each(["staff", null])("%s is refused, and nothing is written", async (role) => {
    const { c, write, accept, confirmPour } = controller(role as string | null);
    await expect(c.setTargetMargin("rest-1", "user-1", DTO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.confirmPourSize("rest-1", "user-1", { pourMl: 125 } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(c.acceptAdvice("rest-1", "user-1", INV, ACCEPT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(write).not.toHaveBeenCalled();
    expect(confirmPour).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it("a session with no house is refused before anything is read", async () => {
    const { c, write } = controller("owner");
    await expect(c.setTargetMargin(undefined as any, "user-1", DTO)).rejects.toMatchObject({ status: 400 });
    expect(write).not.toHaveBeenCalled();
  });
});
