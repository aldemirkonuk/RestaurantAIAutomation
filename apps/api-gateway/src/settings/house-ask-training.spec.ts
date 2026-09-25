import { BadRequestException, ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import { OrganizationsService } from "../organizations/organizations.service";
import { SETTINGS_AUDIT_ACTIONS, SettingsAuditService } from "../settings-audit/settings-audit.service";
import { REGISTERS } from "../settings-audit/settings-audit.controller";
import { ASK_TRAINING_AUDIT_ACTION, HouseAskTrainingService } from "./house-ask-training.service";

/**
 * Founder, 2026-09-21, round 6r, his pick verbatim: "Same as the wine pool
 * (Recommended)" -- the option's words: "A notice in our Terms and on /ask,
 * and an owner opt-out per house. Names are removed before any export." The
 * opt-out is stored per house, only the owner may change it, every change is
 * audited, and the default is not opted out (ADR 0145, round-6r amendment).
 *
 * The service runs for real; the database, the role lookup and the audit
 * writer are doubles, and each rule is exercised on both sides.
 */

const HOUSE = "22222222-2222-4222-8222-222222222222";
const OWNER = "11111111-1111-4111-8111-111111111111";

type Result = { data: unknown; error: unknown };
function makeDb(read: Result, opts: { upsertError?: { message: string }; users?: Result } = {}) {
  const upserts: Array<{ table: string; row: any; options: any }> = [];
  const client = {
    from(table: string) {
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => (table === "users" ? opts.users ?? { data: { name: "Burak" }, error: null } : read);
      chain.upsert = async (row: unknown, options: unknown) => {
        upserts.push({ table, row, options });
        return { data: null, error: opts.upsertError ?? null };
      };
      return chain;
    },
  };
  return { db: { client } as any, upserts };
}

function service(read: Result, role: string | null, opts: Parameters<typeof makeDb>[1] = {}) {
  const { db, upserts } = makeDb(read, opts);
  const roleOf = jest.fn(async () => role);
  const record = jest.fn(async () => ({ recorded: true, reason: null }));
  const svc = new HouseAskTrainingService(db, { resolveRestaurantRole: roleOf } as unknown as OrganizationsService,
    { record } as unknown as SettingsAuditService);
  return { svc, upserts, roleOf, record };
}

describe("the house's training choice: default, read, and a failed read", () => {
  it("no row: not opted out -- his default -- and nobody has answered", async () => {
    const { svc } = service({ data: null, error: null }, "owner");
    expect(await svc.read(HOUSE)).toEqual({ restaurantId: HOUSE, optedOut: false, readable: true, reason: null, statedAt: null, statedBy: null });
  });

  it("a row: its answer, when and by whom", async () => {
    const { svc } = service({ data: { opted_out: true, set_by: OWNER, set_at: "2026-09-21T20:00:00.000Z" }, error: null }, "owner");
    expect(await svc.read(HOUSE)).toMatchObject({ optedOut: true, readable: true, statedAt: "2026-09-21T20:00:00.000Z",
      statedBy: { userId: OWNER, name: "Burak" } });
  });

  it("a failed read says it could not read, and is never the default", async () => {
    const { svc } = service({ data: null, error: { message: "timeout" } }, "owner");
    expect(await svc.read(HOUSE)).toMatchObject({ readable: false, reason: "timeout" });
  });
});

describe("only the house's owner may change it", () => {
  it("the owner opts the house out: one row, marked as the owner's, and an audit row with both values", async () => {
    const { svc, upserts, roleOf, record } = service({ data: null, error: null }, "owner");
    const out = await svc.write(HOUSE, true, OWNER);
    expect(roleOf).toHaveBeenCalledWith(OWNER, HOUSE);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ table: "ask_training_opt_outs", options: { onConflict: "restaurant_id" },
      row: { restaurant_id: HOUSE, opted_out: true, set_by: OWNER, set_by_role: "owner" } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: HOUSE, actorUserId: OWNER, action: ASK_TRAINING_AUDIT_ACTION,
      register: "ask-training", fields: { ask_training_opted_out: { from: false, to: true } } }));
    expect(out).toMatchObject({ audited: true, auditReason: null });
  });

  it("the owner opts back in: the audit row says from true to false", async () => {
    const { svc, record } = service({ data: { opted_out: true, set_by: OWNER, set_at: "2026-09-20T00:00:00.000Z" }, error: null }, "owner");
    await svc.write(HOUSE, false, OWNER);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ fields: { ask_training_opted_out: { from: true, to: false } } }));
  });

  it.each(["manager", "staff", "admin", "Owner", null])("%s is refused 403, and nothing is written or audited", async role => {
    const { svc, upserts, record } = service({ data: null, error: null }, role as string | null);
    await expect(svc.write(HOUSE, true, OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(upserts).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it("a value that is not true or false is refused 400 before the role is even read", async () => {
    for (const value of ["true", 1, null, undefined]) {
      const { svc, upserts, roleOf } = service({ data: null, error: null }, "owner");
      await expect(svc.write(HOUSE, value, OWNER)).rejects.toBeInstanceOf(BadRequestException);
      expect(roleOf).not.toHaveBeenCalled();
      expect(upserts).toHaveLength(0);
    }
  });

  it("an unreadable current value refuses the change: the audit row would have no 'from'", async () => {
    const { svc, upserts, record } = service({ data: null, error: { message: "timeout" } }, "owner");
    await expect(svc.write(HOUSE, true, OWNER)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(upserts).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it("a failed write is an error and files no audit row", async () => {
    const { svc, record } = service({ data: null, error: null }, "owner", { upsertError: { message: "denied" } });
    await expect(svc.write(HOUSE, true, OWNER)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(record).not.toHaveBeenCalled();
  });

  it("the action and the register are in the audit trail's closed sets", () => {
    expect(SETTINGS_AUDIT_ACTIONS).toContain(ASK_TRAINING_AUDIT_ACTION);
    expect(REGISTERS).toContain("ask-training");
  });
});
