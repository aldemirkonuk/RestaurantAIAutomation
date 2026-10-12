import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MembersService } from "../restaurants/members.service";
import { TeamService } from "../team/team.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * F-750 (S195, coordinator call: industry standard). The last owner of an
 * organisation is refused account deletion (nobody could ever open a new
 * location in it again), and until now nothing could clear that refusal:
 * there was no way to make someone else an organisation owner. The owner now
 * hands the organisation to a member who owns one of its houses; the giver
 * steps down to manager and can then delete the account.
 */

const ORG = "org-1";
const OWNER = "user-owner";
const HEIR = "user-heir";
const STAFF = "user-staff";
const HOUSE = "house-a";

function makeService(
  overrides: {
    errors?: Record<string, { message: string }>;
    access?: any[];
  } = {},
) {
  const db = makeStubDb(
    {
      organizations: [{ id: ORG, name: "Meyhane Group", owner_id: OWNER }],
      organization_members: [
        { organization_id: ORG, user_id: OWNER, role: "owner" },
        { organization_id: ORG, user_id: HEIR, role: "manager" },
        { organization_id: ORG, user_id: STAFF, role: "staff" },
      ],
      restaurants: [{ id: HOUSE, organization_id: ORG }],
      user_restaurant_access: overrides.access ?? [
        {
          user_id: OWNER,
          restaurant_id: HOUSE,
          role: "owner",
          is_active: true,
        },
        { user_id: HEIR, restaurant_id: HOUSE, role: "owner", is_active: true },
        {
          user_id: STAFF,
          restaurant_id: HOUSE,
          role: "staff",
          is_active: true,
        },
      ],
      users: [
        { user_id: OWNER, name: "Aylin", email: "aylin@example.com" },
        { user_id: HEIR, name: "Deniz", email: "deniz@example.com" },
        { user_id: STAFF, name: "Can", email: "can@example.com" },
      ],
      organization_invites: [],
      user_oauth_accounts: [],
      account_delete_blockers: [],
      team_members: [],
      notifications: [],
      system_audit_log: [],
    },
    overrides.errors ?? {},
  );
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  const gateway = { evictFromHouse: jest.fn() };
  (svc as any).websocketGateway = gateway;
  const members = new MembersService(
    asDatabaseService(db),
    gateway as any,
    new TeamService(asDatabaseService(db), gateway as any),
  );
  (svc as any).moduleRef = { get: () => members };
  return { svc, db };
}

const roleOf = (db: any, user: string) =>
  db.tables.organization_members.find((m: any) => m.user_id === user)?.role;

describe("handOverOrganisation (F-750)", () => {
  it("lists who could take the organisation over: members who own one of its houses", async () => {
    const { svc } = makeService();
    await expect(svc.organisationsToHandOver(OWNER)).resolves.toEqual({
      organizations: [
        {
          id: ORG,
          name: "Meyhane Group",
          candidates: [
            { userId: HEIR, name: "Deniz", email: "deniz@example.com" },
          ],
        },
      ],
    });
  });

  it("lists nothing for someone who owns no organisation", async () => {
    const { svc } = makeService();
    await expect(svc.organisationsToHandOver(HEIR)).resolves.toEqual({
      organizations: [],
    });
  });

  it("makes the receiver the owner, steps the giver down, and then the giver can delete the account", async () => {
    const { svc, db } = makeService();
    await expect(svc.deleteAccount(OWNER)).rejects.toThrow(
      /only owner of your organisation.*Hand the organisation over/,
    );

    await expect(svc.handOverOrganisation(OWNER, ORG, HEIR)).resolves.toEqual({
      organizationId: ORG,
      newOwnerUserId: HEIR,
    });
    expect(roleOf(db, HEIR)).toBe("owner");
    expect(roleOf(db, OWNER)).toBe("manager");
    expect(db.tables.organizations[0].owner_id).toBe(HEIR);

    await svc.deleteAccount(OWNER);
    expect(db.opsOn("users", "delete")).toHaveLength(1);
  });

  it("refuses someone who does not own the organisation", async () => {
    const { svc, db } = makeService();
    await expect(svc.handOverOrganisation(HEIR, ORG, STAFF)).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.opsOn("organization_members", "update")).toHaveLength(0);
  });

  it("refuses a receiver who owns none of its restaurants, in plain words", async () => {
    const { svc, db } = makeService();
    const out = svc.handOverOrganisation(OWNER, ORG, STAFF);
    await expect(out).rejects.toThrow(BadRequestException);
    await expect(out).rejects.toThrow(/Make them an owner of a restaurant/);
    expect(roleOf(db, OWNER)).toBe("owner");
    expect(db.opsOn("organization_members", "update")).toHaveLength(0);
  });

  it("refuses handing it to oneself or to someone outside the organisation", async () => {
    const { svc } = makeService();
    await expect(svc.handOverOrganisation(OWNER, ORG, OWNER)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      svc.handOverOrganisation(OWNER, ORG, "user-stranger"),
    ).rejects.toThrow(/not part of this organisation/);
  });

  it("changes nothing when the members cannot be read", async () => {
    const { svc, db } = makeService({
      errors: { "organization_members:select": { message: "down" } },
    });
    await expect(svc.handOverOrganisation(OWNER, ORG, HEIR)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(svc.organisationsToHandOver(OWNER)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(db.opsOn("organization_members", "update")).toHaveLength(0);
  });

  it("leaves two owners, never none, when the giver cannot be stepped down", async () => {
    const { svc, db } = makeService({
      errors: {},
    });
    // The first update (promote) goes through; the step-down is refused.
    const realFrom = db.supabase.from;
    let updates = 0;
    db.supabase.from = (table: string) => {
      const b = realFrom(table);
      if (table !== "organization_members") return b;
      const realUpdate = b.update.bind(b);
      b.update = (payload: any) => {
        updates += 1;
        if (updates === 2)
          db.errors["organization_members:update"] = { message: "down" };
        return realUpdate(payload);
      };
      return b;
    };
    await expect(svc.handOverOrganisation(OWNER, ORG, HEIR)).rejects.toThrow(
      /still an owner too/,
    );
    expect(roleOf(db, HEIR)).toBe("owner");
    expect(roleOf(db, OWNER)).toBe("owner");
  });

  it("names a place every owner can reach, not Profile, when the delete is refused (F-1460)", async () => {
    const { svc } = makeService();
    const out = svc.deleteAccount(OWNER);
    await expect(out).rejects.toThrow(/"Hand over your organisation"/);
    await expect(out).rejects.not.toThrow(/Profile/);
  });
});

/**
 * F-1459 (the F-1395 pattern): the step-up check spends the emailed code, so
 * it runs after the hand-over's own refusals and before the first write. A
 * refused hand-over keeps the code the person typed.
 */
describe("handOverOrganisation step-up order (F-1459)", () => {
  it("refuses without asking for proof, so the typed code is not spent", async () => {
    const { svc, db } = makeService();
    const prove = jest.fn(async () => undefined);
    await expect(
      svc.handOverOrganisation(OWNER, ORG, STAFF, prove),
    ).rejects.toThrow(/Make them an owner of a restaurant/);
    await expect(
      svc.handOverOrganisation(HEIR, ORG, OWNER, prove),
    ).rejects.toThrow(ForbiddenException);
    expect(prove).not.toHaveBeenCalled();
    expect(db.opsOn("organization_members", "update")).toHaveLength(0);
  });

  it("asks for proof before the first write, and a failed proof changes nothing", async () => {
    const { svc, db } = makeService();
    const prove = jest.fn(async () => {
      expect(db.opsOn("organization_members", "update")).toHaveLength(0);
      throw new ForbiddenException("code not right");
    });
    await expect(
      svc.handOverOrganisation(OWNER, ORG, HEIR, prove),
    ).rejects.toThrow(/code not right/);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(roleOf(db, HEIR)).toBe("manager");
    expect(roleOf(db, OWNER)).toBe("owner");
  });

  it("the route hands the proof to the service instead of spending the code first", async () => {
    const ORG_ID = "11111111-1111-4111-8111-111111111111";
    const TO_ID = "22222222-2222-4222-8222-222222222222";
    const assertProvedItIsYou = jest.fn(async () => undefined);
    const refusing = new AuthController({
      assertProvedItIsYou,
      handOverOrganisation: async () => {
        throw new BadRequestException("They own none of its restaurants.");
      },
    } as any);
    const req = { user: { userId: OWNER, authTime: 0 } } as any;
    await expect(
      refusing.handOverOrganisation(req, ORG_ID, TO_ID, "123456"),
    ).rejects.toThrow(BadRequestException);
    expect(assertProvedItIsYou).not.toHaveBeenCalled();

    const passing = new AuthController({
      assertProvedItIsYou,
      handOverOrganisation: async (
        _u: string,
        organizationId: string,
        toUserId: string,
        prove: () => Promise<void>,
      ) => {
        await prove();
        return { organizationId, newOwnerUserId: toUserId };
      },
    } as any);
    await expect(
      passing.handOverOrganisation(req, ORG_ID, TO_ID, "123456"),
    ).resolves.toEqual({ organizationId: ORG_ID, newOwnerUserId: TO_ID });
    expect(assertProvedItIsYou).toHaveBeenCalledWith(
      OWNER,
      0,
      "123456",
      expect.stringMatching(/organisation can be handed over/),
    );
  });
});
