import "reflect-metadata";
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

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
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
    },
    errors,
  );
}

function harness(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  // Neither a mailbox NOR an SMS sender is handed in, because the controller no
  // longer takes either. That is the strongest available form of "a crew
  // message never sends email or SMS": a future edit cannot reintroduce a send
  // without also reintroducing the dependency, and this line would fail first.
  const notes = { list: jest.fn(), create: jest.fn(), markOpened: jest.fn() } as any;
  const controller = new TeamController(
    team,
    {} as any,
    {} as any,
    notifications,
    push,
    notes,
  );
  return { controller, notifications, push, notes };
}

const req = { user: { userId: MANAGER, role: "manager" } } as any;

describe("TeamController.broadcast — T3: one is never mistaken for all", () => {
  it("refuses a broadcast that names neither a target nor an audience", async () => {
    const db = seed();
    const { controller, notifications, push } = harness(db);

    await expect(
      controller.broadcast(req, RID, { message: "Hello" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nothing left the building on the ambiguous call.
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(push.sendToUsers).not.toHaveBeenCalled();
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
  // The two email-leg tests that used to live here asserted a real behaviour
  // that is GONE as of 2026-09-04: a crew message no longer emails anybody,
  // opted out or not, because the only sender available is the house's shared
  // vendor mailbox, and the SMS pair that briefly replaced them went the same
  // way on the same day for the same reason one layer over. They are rewritten
  // rather than deleted: the rule they pinned — an opt-out is honoured — now
  // rides on PUSH, which is the only outbound channel left. A channel nobody
  // can decline is one they will eventually resent, and
  // `notification_preferences.push_enabled` exists to decline it
  // (baseline `:3929`).

  it("does not push to a member who has turned push off", async () => {
    const db = seed();
    db.tables.notification_preferences.push({
      user_id: RAY,
      restaurant_id: RID,
      email_enabled: true,
      sms_enabled: true,
      push_enabled: false,
    });
    const { controller, push } = harness(db);

    await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    const pushed: string[] = push.sendToUsers.mock.calls[0][0];
    expect(pushed).not.toContain(RAY);
    expect(pushed).toContain(SAM);
  });

  it("reports what the opt-outs suppressed rather than silently shrinking the send", async () => {
    const db = seed();
    db.tables.notification_preferences.push({
      user_id: SAM,
      restaurant_id: RID,
      email_enabled: true,
      sms_enabled: true,
      push_enabled: false,
    });
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    // A send that quietly reaches fewer people than the caller addressed is
    // the same shape as one that reached everybody, unless it says so.
    expect(res.suppressed.push).toBe(1);
    expect(res.recipients.notified).toBe(2);
  });

  it("a member with no preferences row still receives — silence is not an opt-out", async () => {
    const db = seed();
    const { controller, push } = harness(db);

    await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    const pushed: string[] = push.sendToUsers.mock.calls[0][0];
    expect(pushed.sort()).toEqual([MANAGER, RAY, SAM].sort());
  });

  it("pushes to nobody when the preference register could not be read", async () => {
    const db = seed({ "notification_preferences:select": { message: "connection reset" } });
    const { controller, push } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    // The rule the two removed legs used to carry: a failed preference read is
    // not "nobody opted out". It is skipped and said out loud, because pushing
    // to somebody who may have declined is the error that cannot be undone.
    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(res.preferencesUnavailable).toBe(true);
    expect(res.recipients.notified).toBe(0);
  });
});

/**
 * The email leg is gone, for every caller. (Founder, 2026-09-04.)
 *
 * It was not broken — it worked, and that was the problem: a crew message left
 * through `GmailService`, the single configured `GMAIL_SENDER_EMAIL`
 * (`communications/gmail.service.ts:78-80`) that procurement writes to vendors
 * from, so a staff member replying to "Saturday moved to seven" landed in the
 * vendor thread. It returns when a house has a sender of its own.
 *
 * `harness()` hands the controller NO mailbox and no SMS sender, so these are
 * not just assertions about a branch not being taken. But a spec's own harness
 * only proves the spec compiles: Nest resolves constructor parameters from DI
 * metadata, and `CommunicationsModule` still EXPORTS `GmailService`
 * (`communications.module.ts:95-103`), so a future edit could add the parameter
 * back and Nest would inject it without a word. The first test below closes
 * that by reading the controller's own `design:paramtypes` — the same metadata
 * Nest injects from — so the claim is checked where it is actually decided.
 */
describe("TeamController.broadcast — a crew message never emails", () => {
  it("takes no mail or SMS sender in its constructor, as Nest sees it", () => {
    // `design:paramtypes` is exactly what Nest reads to decide what to inject
    // (`emitDecoratorMetadata: true`, apps/api-gateway/tsconfig.json:6), so
    // this is the claim checked at the point it is decided rather than at the
    // point this file happens to call the constructor.
    const params = (Reflect.getMetadata("design:paramtypes", TeamController) ??
      []) as Array<{ name?: string }>;
    expect(params.length).toBeGreaterThan(0);

    const names = params.map((t) => t?.name);
    expect(names).not.toContain("GmailService");
    expect(names).not.toContain("SmsService");
    // Named positively too, so deleting a real dependency cannot make this
    // pass by emptying the list.
    expect(names).toEqual([
      "TeamService",
      "ScheduleService",
      "PerformanceService",
      "NotificationsService",
      "ExpoPushService",
      "NotesService",
    ]);
  });

  it("sends no email even when the caller asks for the channel by name", async () => {
    const db = seed();
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
      channels: ["inbox", "push", "email"],
    } as any);

    expect(res.emailed).toBe(0);
    // A gate a caller can open is not a gate: `email` never survives into the
    // channels the response reports.
    expect(res.channels).not.toContain("email");
  });

  it("counts the addresses it withheld instead of reporting none on file", async () => {
    const db = seed();
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    // Three people have an address. Reporting 0 would make the size of what
    // this change withholds invisible, which is the whole reason it is counted.
    expect(res.withheldByProduct.email).toBe(3);
    expect(res.withheldByProduct.reason).toMatch(/shared mailbox/);
    // NOT folded into the opt-out figure: "the house has no sender" and
    // "nobody wanted an email" are different facts.
    expect(res.suppressed.email).toBe(0);
  });

  it("defaults to inbox and push, which is also the most it can be", async () => {
    const db = seed();
    const { controller, notifications, push } = harness(db);

    // No `channels` at all — exactly what the legacy Manager Shift Desk sends.
    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    expect(notifications.persistForRestaurant).toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalled();
    expect(res.channels).toEqual(["inbox", "push"]);
  });

  it("sends no SMS even when the caller asks for the channel by name", async () => {
    const db = seed();
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
      channels: ["inbox", "push", "sms"],
    } as any);

    expect(res.texted).toBe(0);
    expect(res.channels).not.toContain("sms");
    // Reported, not silently dropped: three people have a phone on file.
    expect(res.withheldByProduct.sms).toBe(3);
    expect(res.withheldByProduct.reason).toMatch(/shared SMS number/);
  });
});

/**
 * T5 — the broadcast's DEFAULT title carries no emoji.
 *
 * A megaphone emoji prefixed the house speaking, written permanently into every
 * member's inbox row. A manager's OWN title is passed through untouched: the
 * rule is about the house's voice, not about editing what a person typed.
 */
describe("TeamController.broadcast — T5: the house's default title is plain", () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  it("falls back to a plain title when the caller names none", async () => {
    const db = seed();
    const { controller, notifications } = harness(db);

    await controller.broadcast(req, RID, {
      message: "Hello",
      audience: "everyone",
    } as any);

    const payload = notifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.title).toBe("Team broadcast");
    expect(payload.title).not.toMatch(EMOJI);
  });

  it("passes a manager's own words through unchanged — the house edits nobody", async () => {
    const db = seed();
    const { controller, notifications } = harness(db);

    await controller.broadcast(req, RID, {
      title: "Party Friday",
      message: "Bring a plate.",
      audience: "everyone",
    } as any);

    expect(notifications.persistForRestaurant.mock.calls[0][1].title).toBe(
      "Party Friday",
    );
  });
});

/**
 * The channel gate — /team's inline crew message (2026-09-04).
 *
 * A crew message on the schedule is a note ON THE WEEK, not correspondence. Its
 * email leg would leave through `GmailService`, the house's single configured
 * mailbox (`GMAIL_SENDER_EMAIL`, `communications/gmail.service.ts:78-80`) —
 * the same address procurement writes to vendors from. The founder's rule for
 * this surface is that nothing leaves that way, so the Mudavym composer names
 * its channels and the two outbound legs are never reached.
 *
 * The default is unchanged on purpose: the legacy desk names no channels, so
 * every assertion above still describes exactly what it sends.
 */
describe("TeamController.broadcast — the channel gate", () => {
  it("sends nothing outbound but the push when the caller names inbox and push", async () => {
    const db = seed();
    const { controller, notifications, push } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Saturday's line-up changed — check the grid.",
      audience: "everyone",
      channels: ["inbox", "push"],
    } as any);

    expect(notifications.persistForRestaurant).toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalled();
    expect(res.emailed).toBe(0);
    expect(res.texted).toBe(0);
    expect(res.channels).toEqual(["inbox", "push"]);
  });

  it("separates what the caller declined from what the recipients declined", async () => {
    const db = seed();
    const { controller } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "Kitchen meeting at four.",
      audience: "everyone",
      channels: ["inbox", "push"],
    } as any);

    // Three people have a phone on file and none of them opted out. Folding
    // this into `suppressed` would let "the manager chose not to text" read as
    // "nobody wanted a text". Email is 0 on both counts because the CALLER did
    // not withhold it — the product does, and that is its own field.
    expect(res.withheldByCaller).toEqual({ email: 0, sms: 0, push: 0 });
    expect(res.suppressed).toEqual({ email: 0, sms: 0, push: 0 });
    expect(res.withheldByProduct).toMatchObject({ email: 3, sms: 3 });
  });

  // "still sends on every channel when the caller names none" used to live
  // here. It asserted the OLD default, and the founder changed it on
  // 2026-09-04: omitting `channels` now means inbox and push, not all four.
  // The replacement is "defaults to inbox and push, so the legacy desk stops
  // texting too" in the block above — same question, current answer.

  it("an inbox-only message reaches no push either", async () => {
    const db = seed();
    const { controller, push, notifications } = harness(db);

    const res: any = await controller.broadcast(req, RID, {
      message: "For the record.",
      audience: "everyone",
      channels: ["inbox"],
    } as any);

    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(notifications.persistForRestaurant).toHaveBeenCalled();
    // `notified` counts pushes, so it must not report three when none was sent.
    expect(res.notified).toBe(0);
    expect(res.inbox).toBe(true);
  });
});
