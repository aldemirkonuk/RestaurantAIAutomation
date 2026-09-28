import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { ApprovalThresholdsService } from "./approval-thresholds.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { HouseCurrencyService } from "./house-currency.service";
import {
  CARRYING_COST_AUDIT_ACTION,
  CARRYING_COST_MAX_PERCENT,
  CARRYING_COST_MIN_PERCENT,
  HouseCarryingCostService,
} from "./house-carrying-cost.service";
import { SETTINGS_AUDIT_ACTIONS } from "../settings-audit/settings-audit.service";

/**
 * A house can state what holding stock costs it.
 *
 * ---------------------------------------------------------------------------
 * THE PRE-FIX STATE, MEASURED — NOT ASSERTED
 * ---------------------------------------------------------------------------
 * Run on 2026-09-06 in `/Users/aldemirkonuk/Projects/wt-p4`:
 *
 *   git grep -c carrying_cost $(git rev-parse HEAD) -- supabase apps  ->  no match
 *
 * There was no column, no route and no field. Nothing in this product had ever
 * asked a house what holding stock costs it, and the commodity alert's whole
 * arithmetic turns on the answer: measured over 440 recorded FAO months, the
 * gain from buying ahead is entirely spent by a carrying cost of about one
 * percent a month, and between 0.5 % and 1 % the recommendation flips from
 * "worth having on six series" to "worth having on one".
 *
 * THE FOUNDER, 2026-09-05, batch 59: *"Twice a year, and the house types its
 * carrying cost."*
 *
 * Both sides of every rule are exercised. A gate only ever tested on its
 * refusal path cannot tell you it lets the right people through.
 */

const REST = "rest-1";
const USER = "22222222-2222-4222-8222-222222222222";

type Result = { data: unknown; error: unknown };

/** A PostgREST chain double that answers PER TABLE and records every write. */
function makeDb(
  answers: Record<string, Result>,
  opts: { updateError?: { message: string } } = {},
) {
  const calls = {
    updates: [] as Array<{ table: string; row: any; id: unknown }>,
    tables: [] as string[],
  };
  const client = {
    from(table: string) {
      calls.tables.push(table);
      const result = answers[table] ?? { data: null, error: null };
      let pendingUpdate: unknown = null;
      let pendingId: unknown = null;
      const chain: Record<string, (...args: any[]) => any> = {};
      chain.select = () => chain;
      chain.order = () => chain;
      chain.limit = async () => result;
      chain.update = (row: unknown) => {
        pendingUpdate = row;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        if (col === "id") pendingId = val;
        if (pendingUpdate !== null) {
          calls.updates.push({ table, row: pendingUpdate, id: pendingId });
          const err = opts.updateError ?? null;
          pendingUpdate = null;
          return Promise.resolve({ data: null, error: err });
        }
        return chain;
      };
      chain.maybeSingle = async () => result;
      return chain;
    },
  };
  return { calls, databaseService: { client } as any };
}

/** An audit double that REMEMBERS, so a deleted audit call fails a test. */
function recordingAudit(receipt = { recorded: true, reason: null as string | null }) {
  const filed: any[] = [];
  return {
    filed,
    record: async (change: any) => {
      filed.push(change);
      return receipt;
    },
  } as any;
}

function service(
  answers: Record<string, Result>,
  opts: {
    updateError?: { message: string };
    receipt?: { recorded: boolean; reason: string | null };
  } = {},
) {
  const db = makeDb(answers, { updateError: opts.updateError });
  const audit = recordingAudit(opts.receipt);
  return {
    svc: new HouseCarryingCostService(db.databaseService, audit),
    calls: db.calls,
    audit,
  };
}

const NOBODY = {
  restaurants: {
    data: {
      carrying_cost_percent_per_month: null,
      carrying_cost_basis: null,
      carrying_cost_set_by: null,
      carrying_cost_set_at: null,
    },
    error: null,
  },
  users: { data: { name: "A Manager" }, error: null },
};

describe("read — three states, never two", () => {
  it("a stated cost comes back as a NUMBER, with its basis and its author", async () => {
    const { svc } = service({
      // PostgREST returns NUMERIC as a STRING. Returned untouched it would make
      // every arithmetic use downstream concatenate rather than add.
      restaurants: {
        data: {
          carrying_cost_percent_per_month: "0.750",
          carrying_cost_basis: "cash at 9 percent plus the walk-in",
          carrying_cost_set_by: USER,
          carrying_cost_set_at: "2026-09-06T09:00:00.000Z",
        },
        error: null,
      },
      users: { data: { name: "A Manager" }, error: null },
    });
    const out = await svc.read(REST);
    expect(out.percentPerMonth).toBe(0.75);
    expect(typeof out.percentPerMonth).toBe("number");
    expect(out.basis).toBe("cash at 9 percent plus the walk-in");
    expect(out.statedBy).toEqual({ userId: USER, name: "A Manager" });
    expect(out.statedAt).toBe("2026-09-06T09:00:00.000Z");
    expect(out.readable).toBe(true);
  });

  it("an untyped cost is null and still readable — unanswered, not unreadable", async () => {
    const { svc } = service(NOBODY);
    const out = await svc.read(REST);
    expect(out.percentPerMonth).toBeNull();
    expect(out.readable).toBe(true);
    expect(out.reason).toBeNull();
    // Nobody typed it, so nobody's name travels with it.
    expect(out.statedBy).toBeNull();
  });

  it("a FAILED read is `readable: false` with the reason — never an unanswered question", async () => {
    const { svc } = service({
      restaurants: { data: null, error: { message: "permission denied" } },
    });
    const out = await svc.read(REST);
    expect(out.readable).toBe(false);
    expect(out.reason).toBe("permission denied");
    expect(out.percentPerMonth).toBeNull();
  });
});

describe("write — the bounds are a UNITS check", () => {
  it("refuses the FRACTION spelling, which would understate the cost by a hundred", async () => {
    const { svc, calls } = service(NOBODY);
    await expect(svc.write(REST, 0.0075, null, USER)).rejects.toThrow(
      BadRequestException,
    );
    // The direction that matters: admitting it would price holding stock as
    // nearly free and make every commodity alert look profitable.
    await expect(svc.write(REST, 0.0075, null, USER)).rejects.toThrow(
      /PERCENT: three quarters of one percent a month is 0\.75/,
    );
    expect(calls.updates).toHaveLength(0);
  });

  it("refuses 75 — a percent a year typed into a percent a month", async () => {
    const { svc, calls } = service(NOBODY);
    await expect(svc.write(REST, 75, null, USER)).rejects.toThrow(
      /percent a MONTH/,
    );
    expect(calls.updates).toHaveLength(0);
  });

  it("refuses anything that is not a number, and writes nothing", async () => {
    const { svc, calls } = service(NOBODY);
    for (const bad of ["0.75", null, undefined, Number.NaN, Infinity, {}]) {
      await expect(svc.write(REST, bad, null, USER)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(calls.updates).toHaveLength(0);
  });

  it("admits both ends of exactly what the database's CHECK admits", async () => {
    for (const value of [CARRYING_COST_MIN_PERCENT, CARRYING_COST_MAX_PERCENT]) {
      const { svc, calls } = service(NOBODY);
      await svc.write(REST, value, null, USER);
      expect(calls.updates[0].row.carrying_cost_percent_per_month).toBe(value);
    }
  });
});

describe("write — the value, the author and the moment are one fact", () => {
  it("writes all three columns in one update, with the author from the token", async () => {
    const { svc, calls } = service(NOBODY);
    await svc.write(REST, 0.75, "cash at 9 percent", USER);
    expect(calls.updates).toHaveLength(1);
    const row = calls.updates[0].row;
    expect(row.carrying_cost_percent_per_month).toBe(0.75);
    expect(row.carrying_cost_set_by).toBe(USER);
    // The moment is the server's, never a client's clock.
    expect(typeof row.carrying_cost_set_at).toBe("string");
    expect(Number.isNaN(Date.parse(row.carrying_cost_set_at))).toBe(false);
    expect(row.carrying_cost_basis).toBe("cash at 9 percent");
    expect(calls.updates[0].id).toBe(REST);
  });

  it("an empty or blank basis is recorded as null, never as an empty sentence", async () => {
    const { svc, calls } = service(NOBODY);
    await svc.write(REST, 0.75, "   ", USER);
    expect(calls.updates[0].row.carrying_cost_basis).toBeNull();
  });

  it("a failed write throws and records nothing in the trail", async () => {
    const { svc, audit } = service(NOBODY, {
      updateError: { message: "permission denied" },
    });
    await expect(svc.write(REST, 0.75, null, USER)).rejects.toThrow(
      /Could not record the carrying cost\. Nothing was changed\./,
    );
    expect(audit.filed).toHaveLength(0);
  });
});

describe("write — audited, or the caller is told it was not", () => {
  it("files one row naming the actor, the register and both numbers", async () => {
    const { svc, audit } = service({
      ...NOBODY,
      restaurants: {
        data: {
          carrying_cost_percent_per_month: "0.500",
          carrying_cost_basis: null,
          carrying_cost_set_by: USER,
          carrying_cost_set_at: "2026-09-06T08:00:00.000Z",
        },
        error: null,
      },
    });
    const out = await svc.write(REST, 0.75, null, USER);
    expect(audit.filed).toHaveLength(1);
    const filed = audit.filed[0];
    expect(filed.action).toBe(CARRYING_COST_AUDIT_ACTION);
    expect(filed.register).toBe("carrying-cost");
    expect(filed.actorUserId).toBe(USER);
    // The PREVIOUS value comes back as a number too, not the "0.500" string.
    expect(filed.fields.carrying_cost_percent_per_month).toEqual({
      from: 0.5,
      to: 0.75,
    });
    expect(out.audited).toBe(true);
  });

  it("a failed audit row is VISIBLE on the readout, never assumed", async () => {
    const { svc } = service(NOBODY, {
      receipt: { recorded: false, reason: "audit insert refused" },
    });
    const out = await svc.write(REST, 0.75, null, USER);
    expect(out.audited).toBe(false);
    expect(out.auditReason).toBe("audit insert refused");
  });

  it("the action is in the closed vocabulary the trail reads back", () => {
    // A row filed under an action the reader does not know is a change that
    // happened and cannot be found — the absence-reported-as-health shape with
    // a paper trail on top.
    expect(SETTINGS_AUDIT_ACTIONS).toContain(CARRYING_COST_AUDIT_ACTION);
  });
});

describe("the route is manager-gated, and lets the right people through", () => {
  function controller(canManage: boolean | Error) {
    const orgs = {
      assertCanManageRestaurant: jest.fn(async () => {
        if (canManage instanceof Error) throw canManage;
        return true;
      }),
    } as unknown as OrganizationsService;
    const db = makeDb(NOBODY);
    const svc = new HouseCarryingCostService(
      db.databaseService,
      recordingAudit(),
    );
    return {
      orgs,
      calls: db.calls,
      ctrl: new SettingsController(
        {} as SettingsService,
        {} as ApprovalThresholdsService,
        orgs,
        {} as HouseCurrencyService,
        svc,
      ),
    };
  }

  it("refuses a caller who may not manage the house, and writes nothing", async () => {
    const { ctrl, calls } = controller(
      new ForbiddenException("not a manager here"),
    );
    await expect(
      ctrl.setHouseCarryingCost(REST, { percentPerMonth: 0.75 }, USER),
    ).rejects.toThrow(ForbiddenException);
    expect(calls.updates).toHaveLength(0);
  });

  it("lets a manager through, and asks the gate in the words of the act", async () => {
    const { ctrl, orgs, calls } = controller(true);
    await ctrl.setHouseCarryingCost(REST, { percentPerMonth: 0.75 }, USER);
    expect(orgs.assertCanManageRestaurant).toHaveBeenCalledWith(
      USER,
      REST,
      "state what holding stock costs this restaurant",
    );
    expect(calls.updates).toHaveLength(1);
  });

  it("refuses a session with no restaurant on either route", async () => {
    const { ctrl } = controller(true);
    await expect(ctrl.getHouseCarryingCost("")).rejects.toThrow(
      /not attached to a restaurant/,
    );
    await expect(
      ctrl.setHouseCarryingCost("", { percentPerMonth: 0.75 }, USER),
    ).rejects.toThrow(/nothing was recorded/i);
  });
});
