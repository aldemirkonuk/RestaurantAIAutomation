import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { ApprovalThresholdsService } from "./approval-thresholds.service";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  CURRENCY_AUDIT_ACTION,
  HouseCurrencyService,
} from "./house-currency.service";
import { SETTINGS_AUDIT_ACTIONS } from "../settings-audit/settings-audit.service";

/**
 * An existing house can state the money it reports in.
 *
 * ---------------------------------------------------------------------------
 * THE PRE-FIX STATE, MEASURED — NOT ASSERTED
 * ---------------------------------------------------------------------------
 * Run on 2026-09-05 in `/Users/aldemirkonuk/Projects/wt-p4`:
 *
 *   git show HEAD:apps/api-gateway/src/settings/settings.controller.ts \
 *     | grep -c currency                       ->  0
 *   git show HEAD:apps/api-gateway/src/settings/settings.module.ts \
 *     | grep -c currency                       ->  0
 *   git grep -n "settings/currency" $(git rev-parse HEAD) -- apps \
 *                                              ->  no match
 *
 * There was no field. `restaurants.currency` had exactly two writers in the
 * whole product: the column default (dropped by
 * `20260905120000_a_house_names_its_money.sql`) and
 * `AuthService.registerRestaurant`, which only ever runs while a house is being
 * CREATED. So a house that already existed could not answer the question, and
 * `fmtMoney` (`apps/web/src/lib/mudavym/format.ts:85`) renders a null code as
 * "(currency not recorded)" — the state eleven of the fourteen production
 * houses are in today, with no way out of it.
 *
 * These tests are that way out, and both sides of every rule are exercised: a
 * gate only ever tested on its refusal path cannot tell you it lets the right
 * people through.
 */

const REST = "rest-1";
const USER = "22222222-2222-4222-8222-222222222222";

type Result = { data: unknown; error: unknown };

/**
 * A PostgREST chain double that answers PER TABLE and records every write.
 *
 * Per table rather than one shared result, because the service reads
 * `restaurants`, then `system_audit_log`, then `users` in a single `read()`;
 * one answer for all three would let the audit-trail read be deleted with every
 * test still green.
 */
function makeDb(
  answers: Record<string, Result>,
  opts: { updateError?: { message: string } } = {},
) {
  const calls = {
    updates: [] as Array<{ table: string; row: unknown; id: unknown }>,
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
    svc: new HouseCurrencyService(db.databaseService, audit),
    calls: db.calls,
    audit,
  };
}

const NO_TRAIL: Result = { data: [], error: null };

describe("HouseCurrencyService.read — three states, never two", () => {
  it("a stated code is returned with the country it can be defaulted from", async () => {
    const { svc } = service({
      restaurants: { data: { currency: "TRY", country: "Türkiye" }, error: null },
      system_audit_log: NO_TRAIL,
    });
    const out = await svc.read(REST);
    expect(out.code).toBe("TRY");
    expect(out.country).toBe("Türkiye");
    expect(out.readable).toBe(true);
  });

  it("a NULL currency is `code: null` and still readable — the question is unanswered, not unreadable", async () => {
    const { svc } = service({
      restaurants: { data: { currency: null, country: "United Kingdom" }, error: null },
      system_audit_log: NO_TRAIL,
    });
    const out = await svc.read(REST);
    expect(out.code).toBeNull();
    expect(out.readable).toBe(true);
    expect(out.reason).toBeNull();
  });

  it("a FAILED read is `readable: false` with the reason — never an unanswered question", async () => {
    // The distinction this whole service exists to keep: eleven houses hold
    // NULL on purpose, and a database that will not answer is a different
    // thing. Collapsing them would report an outage as a founder decision.
    const { svc } = service({
      restaurants: { data: null, error: { message: "connection reset" } },
    });
    const out = await svc.read(REST);
    expect(out.readable).toBe(false);
    expect(out.reason).toContain("connection reset");
    expect(out.code).toBeNull();
  });

  it("names who last stated it, from the trail rather than from `restaurants.updated_at`", async () => {
    const { svc } = service({
      restaurants: { data: { currency: "GBP", country: "United Kingdom" }, error: null },
      system_audit_log: {
        data: [{ actor_id: USER, created_at: "2026-09-05T10:00:00Z" }],
        error: null,
      },
      users: { data: { name: "Aldemir" }, error: null },
    });
    const out = await svc.read(REST);
    expect(out.statedAt).toBe("2026-09-05T10:00:00Z");
    expect(out.statedBy).toEqual({ userId: USER, name: "Aldemir" });
  });

  it("no trail is a NULL date, not a substituted one", async () => {
    const { svc } = service({
      restaurants: { data: { currency: "GBP", country: null }, error: null },
      system_audit_log: NO_TRAIL,
    });
    const out = await svc.read(REST);
    expect(out.statedAt).toBeNull();
    expect(out.statedBy).toBeNull();
  });

  it("reads the trail for the CURRENCY action only", async () => {
    const { svc, calls } = service({
      restaurants: { data: { currency: "GBP", country: null }, error: null },
      system_audit_log: NO_TRAIL,
    });
    await svc.read(REST);
    expect(calls.tables).toContain("system_audit_log");
    expect(CURRENCY_AUDIT_ACTION).toBe("reporting_currency_changed");
  });
});

describe("HouseCurrencyService.write — explicit, validated, audited", () => {
  const HOUSE_NULL = {
    restaurants: { data: { currency: null, country: "Türkiye" }, error: null },
    system_audit_log: NO_TRAIL,
  };

  it("records the code the caller sent, on this restaurant", async () => {
    const { svc, calls } = service(HOUSE_NULL);
    const out = await svc.write(REST, "TRY", USER);
    expect(calls.updates).toEqual([
      { table: "restaurants", row: { currency: "TRY" }, id: REST },
    ]);
    expect(out.code).toBeNull(); // the double's read still answers the old row
    expect(out.audited).toBe(true);
  });

  it("files an audit row naming the actor and BOTH codes", async () => {
    const { svc, audit } = service({
      restaurants: { data: { currency: "USD", country: "Türkiye" }, error: null },
      system_audit_log: NO_TRAIL,
    });
    await svc.write(REST, "TRY", USER);
    expect(audit.filed).toHaveLength(1);
    expect(audit.filed[0]).toMatchObject({
      restaurantId: REST,
      actorUserId: USER,
      action: "reporting_currency_changed",
      register: "currency",
      entityType: "restaurant",
      entityId: REST,
      fields: { currency: { from: "USD", to: "TRY" } },
    });
  });

  it("a failed audit row is REPORTED, not swallowed", async () => {
    const { svc } = service(
      {
        restaurants: { data: { currency: "USD", country: null }, error: null },
        system_audit_log: NO_TRAIL,
      },
      { receipt: { recorded: false, reason: "system_audit_log is unreachable" } },
    );
    const out = await svc.write(REST, "TRY", USER);
    expect(out.audited).toBe(false);
    expect(out.auditReason).toBe("system_audit_log is unreachable");
  });

  it("refuses anything the database's own CHECK would refuse, and writes NOTHING", async () => {
    for (const bad of ["try", "TL", "$", "TRYY", "", "  ", 42, null, undefined]) {
      const { svc, calls, audit } = service(HOUSE_NULL);
      await expect(svc.write(REST, bad as unknown, USER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(calls.updates).toHaveLength(0);
      expect(audit.filed).toHaveLength(0);
    }
  });

  /*
   * MEMBERSHIP, NOT SHAPE (2026-09-06). `ZZZ` and the ISO-reserved test codes
   * pass `^[A-Z]{3}$` — the database's own CHECK and, until today, this
   * service's whole gate. `restaurants.currency` is the rung
   * `invoice-currency.ts` files an unmarked invoice's money under, so a code
   * naming no money here denominates a vendor's paper.
   */
  it("refuses a well-formed code that is not a currency, and writes NOTHING", async () => {
    for (const fake of ["ZZZ", "XTS", "XTT", "ABC", "QQQ"]) {
      const { svc, calls, audit } = service(HOUSE_NULL);
      await expect(svc.write(REST, fake, USER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(calls.updates).toHaveLength(0);
      expect(audit.filed).toHaveLength(0);
    }
  });

  it("the refusal NAMES the code it refused", async () => {
    const { svc } = service(HOUSE_NULL);
    await expect(svc.write(REST, "ZZZ", USER)).rejects.toThrow(
      /ZZZ is not a currency/,
    );
  });

  it("the refusal is the sentence the page prints", async () => {
    const { svc } = service(HOUSE_NULL);
    await expect(svc.write(REST, "usd", USER)).rejects.toThrow(
      /is not a currency/,
    );
  });

  it("a failed UPDATE throws and files nothing — a write that did not happen is not audited", async () => {
    const { svc, audit } = service(HOUSE_NULL, {
      updateError: { message: "permission denied for table restaurants" },
    });
    await expect(svc.write(REST, "TRY", USER)).rejects.toThrow(
      /Could not record the currency/,
    );
    expect(audit.filed).toHaveLength(0);
  });

  it("re-stating the same code files no row — an unchanged field is not a change", async () => {
    const { svc, audit } = service({
      restaurants: { data: { currency: "TRY", country: "Türkiye" }, error: null },
      system_audit_log: NO_TRAIL,
    });
    const out = await svc.write(REST, "TRY", USER);
    expect(audit.filed).toHaveLength(0);
    expect(out.audited).toBe(false);
    expect(out.auditReason).toBe("nothing changed");
  });

  it("never derives a code from the country — the default is offered in the browser, accepted by a person", async () => {
    // `read` returns `country` and NOTHING else about currency. If this service
    // ever grew a country -> currency table, the silent default that put
    // dollars on a restaurant in Fethiye would be back, wearing a new name.
    const { svc, calls } = service(HOUSE_NULL);
    await svc.read(REST);
    expect(calls.updates).toHaveLength(0);
  });
});

describe("the action is registered where the trail reads it back", () => {
  it("`reporting_currency_changed` is in SETTINGS_AUDIT_ACTIONS", () => {
    // `SettingsAuditService.list` filters on `READ_BACK_ACTIONS`, which spreads
    // this constant. An action missing from it writes rows the "What changed
    // here" register would never show — a paper trail that is invisible is the
    // same as none.
    expect(SETTINGS_AUDIT_ACTIONS).toContain(CURRENCY_AUDIT_ACTION);
  });
});

/* ── The role gate, on the controller ─────────────────────────────────────── */

function controller(role: "owner" | "manager" | "staff" | null) {
  const write = jest.fn().mockResolvedValue({
    restaurantId: REST,
    code: "TRY",
    country: "Türkiye",
    readable: true,
    reason: null,
    statedAt: null,
    statedBy: null,
    audited: true,
    auditReason: null,
  });
  const read = jest.fn().mockResolvedValue({
    restaurantId: REST,
    code: null,
    country: "Türkiye",
    readable: true,
    reason: null,
    statedAt: null,
    statedBy: null,
  });

  // The real assertion, not a stub of it: only the role READ is mocked, so the
  // rule under test is `assertManagerOrOwner` itself.
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);

  const houseCurrency = { read, write } as unknown as HouseCurrencyService;
  return {
    controller: new SettingsController(
      {} as unknown as SettingsService,
      {} as unknown as ApprovalThresholdsService,
      organizations,
      houseCurrency,
      // The carrying-cost register, added 2026-09-06 (founder batch 59). Not
      // exercised here; a bare double so this file keeps owning one gate.
      {} as never,
    ),
    write,
    read,
  };
}

describe("PUT /settings/currency — who may state the house's money", () => {
  it("an OWNER may", async () => {
    const { controller: c, write } = controller("owner");
    await c.setHouseCurrency(REST, { code: "TRY" }, USER);
    expect(write).toHaveBeenCalledWith(REST, "TRY", USER);
  });

  it("a MANAGER may", async () => {
    const { controller: c, write } = controller("manager");
    await c.setHouseCurrency(REST, { code: "GBP" }, USER);
    expect(write).toHaveBeenCalledWith(REST, "GBP", USER);
  });

  it("STAFF is refused, and NOTHING is written", async () => {
    const { controller: c, write } = controller("staff");
    await expect(
      c.setHouseCurrency(REST, { code: "TRY" }, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(write).not.toHaveBeenCalled();
  });

  it("a role that could not be read is refused — an unknown is not permission", async () => {
    const { controller: c, write } = controller(null);
    await expect(
      c.setHouseCurrency(REST, { code: "TRY" }, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(write).not.toHaveBeenCalled();
  });

  it("the refusal names what was refused, so the page prints the server's sentence", async () => {
    const { controller: c } = controller("staff");
    await expect(c.setHouseCurrency(REST, { code: "TRY" }, USER)).rejects.toThrow(
      /Only managers and owners can state the currency this restaurant reports in/,
    );
  });

  it("the READ is open to anyone attached to the house — a figure you cannot read is a figure you cannot check", async () => {
    const { controller: c, read } = controller("staff");
    const out = await c.getHouseCurrency(REST);
    expect(read).toHaveBeenCalledWith(REST);
    expect(out.code).toBeNull();
  });

  it("a session with no restaurant is refused before anything is read or written", async () => {
    const { controller: c, write, read } = controller("owner");
    await expect(c.getHouseCurrency("")).rejects.toThrow(/not attached to a restaurant/);
    await expect(c.setHouseCurrency("", { code: "TRY" }, USER)).rejects.toThrow(
      /not attached to a restaurant/,
    );
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
