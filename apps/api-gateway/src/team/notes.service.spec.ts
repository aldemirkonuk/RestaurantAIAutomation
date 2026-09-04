import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { NotesService } from "./notes.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * A crew note is a record. (Founder, 2026-09-04; team.md §13.7.)
 *
 * Before this, `/team`'s week strip could say what THAT PAGE had just sent and
 * nothing else: `broadcast` writes a notification row per recipient and no
 * route reads them back, so a note was gone on reload and the strip had to
 * print "an empty strip means not from here, this session". Every assertion
 * below is about a fact the strip can now stand behind after a reload.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";
const SAM = "user-sam";
const RAY = "user-ray";
const WEEK = "2026-08-31";

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      user_restaurant_access: [
        { id: "a1", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true },
        { id: "a2", user_id: SAM, restaurant_id: RID, role: "staff", is_active: true },
        { id: "a3", user_id: RAY, restaurant_id: RID, role: "staff", is_active: true },
      ],
      users: [
        { user_id: MANAGER, restaurant_id: RID, role: "manager", name: "Moe", email: "moe@example.test" },
        { user_id: SAM, restaurant_id: RID, role: "staff", name: "Sam", email: "sam@example.test" },
        { user_id: RAY, restaurant_id: RID, role: "staff", name: "Ray", email: "ray@example.test" },
      ],
      team_members: [
        { id: "m-moe", created_at: "2026-01-01T00:00:00Z", restaurant_id: RID, user_id: MANAGER, display_name: "Moe", status: "active" },
        { id: "m-sam", created_at: "2026-01-02T00:00:00Z", restaurant_id: RID, user_id: SAM, display_name: "Sam", status: "active" },
        { id: "m-ray", created_at: "2026-01-03T00:00:00Z", restaurant_id: RID, user_id: RAY, display_name: "Ray", status: "active" },
      ],
      team_settings: [],
      team_notes: [],
      team_note_recipients: [],
      notifications: [],
    },
    errors,
  );
}

function svc(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const notifications = { persistForRestaurant: jest.fn(async () => ({ inserted: 0 })) } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return {
    notes: new NotesService(asDatabaseService(db), team, notifications, push),
    notifications,
    push,
  };
}

const write = (db: StubDb, memberIds: string[] = ["m-sam", "m-ray"]) =>
  svc(db).notes.create(MANAGER, RID, {
    weekStart: WEEK,
    body: "Saturday moves to seven.",
    memberIds,
  } as any);

describe("NotesService — a note survives the page that wrote it", () => {
  it("records the note, its author and the audience it named", async () => {
    const db = seed();
    const res: any = await write(db);

    expect(res.addressed).toBe(2);
    const note = db.tables.team_notes[0];
    expect(note.body).toBe("Saturday moves to seven.");
    expect(note.week_start).toBe(WEEK);
    // `public.users.user_id`, never an auth.users id — the two are disjoint.
    expect(note.author_user_id).toBe(MANAGER);
    expect(db.tables.team_note_recipients.map((r: any) => r.member_id).sort()).toEqual([
      "m-ray",
      "m-sam",
    ]);
  });

  it("delivers to the inbox and the phone, and to nothing else", async () => {
    const db = seed();
    const { notes, notifications, push } = svc(db);
    const res: any = await notes.create(MANAGER, RID, {
      weekStart: WEEK,
      body: "Kitchen meeting at four.",
      memberIds: ["m-sam"],
    } as any);

    expect(notifications.persistForRestaurant).toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalled();
    expect(res.channels).toEqual(["inbox", "push"]);
    // The service takes no mailbox and no SMS sender at all, so "it does not
    // email" is a property of the constructor, not of a branch.
    expect(res.delivered).toMatchObject({ inbox: true, push: 1 });
  });

  it("refuses a note that names nobody on this roster, and writes nothing", async () => {
    const db = seed();
    await expect(write(db, ["m-somebody-else"])).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.team_notes).toHaveLength(0);
    expect(db.tables.team_note_recipients).toHaveLength(0);
  });

  it("reads back after the send, with the audience by name", async () => {
    const db = seed();
    await write(db);
    const res: any = await svc(db).notes.list(MANAGER, RID, WEEK);

    expect(res.readable).toBe(true);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].body).toBe("Saturday moves to seven.");
    expect(res.notes[0].recipients.map((r: any) => r.name).sort()).toEqual(["Ray", "Sam"]);
  });

  it("says the register could not be read rather than reporting a quiet week", async () => {
    const db = seed({ "team_notes:select": { message: "connection reset" } });
    const res: any = await svc(db).notes.list(MANAGER, RID, WEEK);

    // The whole point. `[]` with `readable: true` would say "nobody said
    // anything about this week", which is a claim nobody measured.
    expect(res.readable).toBe(false);
    expect(res.reason).toMatch(/connection reset/);
    expect(res.notes).toEqual([]);
  });
});

describe("NotesService — unopened is a state, not a silence", () => {
  it("counts nobody as having opened a note nobody has opened", async () => {
    const db = seed();
    await write(db);
    const res: any = await svc(db).notes.list(MANAGER, RID, WEEK);

    expect(res.notes[0].addressedCount).toBe(2);
    expect(res.notes[0].openedCount).toBe(0);
    for (const r of res.notes[0].recipients) expect(r.openedAt).toBeNull();
  });

  it("records the first open, and only for the caller's own row", async () => {
    const db = seed();
    await write(db);
    const noteId = db.tables.team_notes[0].id;

    const res: any = await svc(db).notes.markOpened(SAM, RID, noteId);
    expect(res).toEqual({ recorded: true, alreadyOpen: false });

    const openedBy = (memberId: string) =>
      db.tables.team_note_recipients.find((r: any) => r.member_id === memberId)
        ?.opened_at ?? null;
    expect(openedBy("m-sam")).toBeTruthy();
    // Ray opened nothing, and nothing may say he did.
    expect(openedBy("m-ray")).toBeNull();

    const after: any = await svc(db).notes.list(MANAGER, RID, WEEK);
    expect(after.notes[0].openedCount).toBe(1);
  });

  it("refuses a note that was never addressed to the caller, and says which it is", async () => {
    const db = seed();
    await write(db, ["m-ray"]);
    const noteId = db.tables.team_notes[0].id;

    // NOT the same answer as "already open". The UPDATE alone could not tell
    // them apart — `.is("opened_at", null)` matches nothing in both cases —
    // and reporting one shape for both let a person reading somebody else's
    // note get a quiet success.
    await expect(svc(db).notes.markOpened(SAM, RID, noteId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // And nothing of Ray's moved because Sam asked.
    expect(
      db.tables.team_note_recipients.find((r: any) => r.member_id === "m-ray")
        ?.opened_at ?? null,
    ).toBeNull();
  });

  it("does not move the timestamp when the same person opens it again", async () => {
    const db = seed();
    await write(db);
    const noteId = db.tables.team_notes[0].id;
    await svc(db).notes.markOpened(SAM, RID, noteId);
    const samsOpen = () =>
      db.tables.team_note_recipients.find((r: any) => r.member_id === "m-sam")
        ?.opened_at ?? null;
    const first = samsOpen();
    expect(first).toBeTruthy();

    const second: any = await svc(db).notes.markOpened(SAM, RID, noteId);
    expect(second).toEqual({ recorded: false, alreadyOpen: true });
    // A re-open that refreshed the time would turn a day-old read into a new
    // one every time the page was visited.
    expect(samsOpen()).toBe(first);
  });
});

describe("NotesService — a staff member sees only what was addressed to them", () => {
  it("hides a note the caller was not named on", async () => {
    const db = seed();
    await write(db, ["m-ray"]);

    const asRay: any = await svc(db).notes.list(RAY, RID, WEEK);
    expect(asRay.notes).toHaveLength(1);

    // The table carries a manager's free text about a week. Every member being
    // able to read every note is the shape ADR 0088 closed on time-off reasons.
    const asSam: any = await svc(db).notes.list(SAM, RID, WEEK);
    expect(asSam.notes).toHaveLength(0);
  });
});
