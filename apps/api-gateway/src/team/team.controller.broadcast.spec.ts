import { BadRequestException } from "@nestjs/common";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * /team broadcast — ADR 0088.
 *
 * T3  `POST …/broadcast` with no `memberIds` targeted every active linked
 *     member. Absence of targeting was read as intent to target everyone, and
 *     the response could not tell one send from the other.
 * T4  the same endpoint mapped roster emails and phones straight to the
 *     senders, ignoring `notification_preferences` entirely. It now reads
 *     `email_enabled` / `sms_enabled` — see `broadcast-preferences.ts` for why
 *     it does NOT mirror the resolver's own rule, which reads two columns that
 *     do not exist and is measurably backwards on both channels.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";
const SAM = "user-sam";
const RAY = "user-ray";

function seed(): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        id: "a1",
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a2",
        user_id: SAM,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      },
      {
        id: "a3",
        user_id: RAY,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      },
    ],
    users: [
      {
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        name: "Moe",
        email: "moe@example.test",
      },
      {
        user_id: SAM,
        restaurant_id: RID,
        role: "staff",
        name: "Sam",
        email: "sam@example.test",
      },
      {
        user_id: RAY,
        restaurant_id: RID,
        role: "staff",
        name: "Ray",
        email: "ray@example.test",
      },
    ],
    team_members: [
      {
        id: "m-moe",
        // `team_members.created_at` is NOT NULL DEFAULT now(); the roster read
        // sorts by it, so a seed without it is not a row this table can hold.
        created_at: "2026-01-01T00:00:00Z",
        restaurant_id: RID,
        user_id: MANAGER,
        display_name: "Moe",
        email: "moe@example.test",
        phone: "+15550000001",
        status: "active",
      },
      {
        id: "m-sam",
        // `team_members.created_at` is NOT NULL DEFAULT now(); the roster read
        // sorts by it, so a seed without it is not a row this table can hold.
        created_at: "2026-01-02T00:00:00Z",
        restaurant_id: RID,
        user_id: SAM,
        display_name: "Sam",
        email: "sam@example.test",
        phone: "+15550000002",
        status: "active",
      },
      {
        id: "m-ray",
        // `team_members.created_at` is NOT NULL DEFAULT now(); the roster read
        // sorts by it, so a seed without it is not a row this table can hold.
        created_at: "2026-01-03T00:00:00Z",
        restaurant_id: RID,
        user_id: RAY,
        display_name: "Ray",
        email: "ray@example.test",
        phone: "+15550000003",
        status: "active",
      },
    ],
    team_settings: [],
    notification_preferences: [],
    notifications: [],
    system_audit_log: [],
  });
}

function harness(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  const gmail = { sendEmail: jest.fn(async () => ({ success: true })) } as any;
  const sms = { sendSms: jest.fn(async () => ({ success: true })) } as any;
  const controller = new TeamController(
    team,
    {} as any,
    {} as any,
    notifications,
    push,
    gmail,
    sms,
  );
  return { controller, gmail, sms, notifications, push };
}

const req = { user: { userId: MANAGER, role: "manager" } } as any;

describe("TeamController.broadcast — T3: one is never mistaken for all", () => {
  it("refuses a broadcast that names neither a target nor an audience", async () => {
    const db = seed();
    const { controller, gmail, sms } = harness(db);

    await expect(
      controller.broadcast(req, RID, { message: "Hello" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing left the building on the ambiguous call.
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it("sends to everyone only when the caller says 'everyone', and reports the reach", async () => {
    const db = seed();
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    expect(res.audience).toBe("everyone");
    expect(res.recipients.targeted).toBe(3);
  });

  it("a targeted send reports one recipient, not a silent three", async () => {
    const db = seed();
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Your food handler card expires on Friday.",
      memberIds: ["m-sam"],
    } as any);

    expect(res.audience).toBe("selected");
    expect(res.recipients.targeted).toBe(1);
  });
});

describe("TeamController.broadcast — T4: an opt-out means the same thing on both paths", () => {
  it("does not email a member who has opted out of email", async () => {
    const db = seed();
    db.tables.notification_preferences.push({
      user_id: SAM,
      restaurant_id: RID,
      email_enabled: false,
      sms_enabled: true,
    });
    const { controller, gmail } = harness(db);

    await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    const to: string[] = gmail.sendEmail.mock.calls[0][0].to;
    expect(to).not.toContain("sam@example.test");
    expect(to).toContain("ray@example.test");
  });

  it("does not text a member who has opted out of SMS", async () => {
    const db = seed();
    db.tables.notification_preferences.push({
      user_id: RAY,
      restaurant_id: RID,
      email_enabled: true,
      sms_enabled: false,
    });
    const { controller, sms } = harness(db);

    await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    const texted = sms.sendSms.mock.calls.map((c: any[]) => c[0].to);
    expect(texted).not.toContain("+15550000003");
    expect(texted).toContain("+15550000002");
  });

  it("reports what the opt-outs suppressed rather than silently shrinking the send", async () => {
    const db = seed();
    db.tables.notification_preferences.push({
      user_id: SAM,
      restaurant_id: RID,
      email_enabled: false,
      sms_enabled: true,
    });
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    // A send that quietly reaches fewer people than the caller addressed is
    // the same shape as one that reached everybody, unless it says so.
    expect(res.suppressed.email).toBe(1);
  });

  it("a member with no preferences row still receives — silence is not an opt-out", async () => {
    const db = seed();
    const { controller, gmail } = harness(db);

    await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    const to: string[] = gmail.sendEmail.mock.calls[0][0].to;
    expect(to.sort()).toEqual([
      "moe@example.test",
      "ray@example.test",
      "sam@example.test",
    ]);
  });
});
