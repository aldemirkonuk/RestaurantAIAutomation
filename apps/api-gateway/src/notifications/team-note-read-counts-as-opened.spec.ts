import { NotificationsService } from "./notifications.service";

/**
 * F-1657: a crew note reached its people as an inbox line, and reading that
 * line in the bell or on the phone only ruled it off. Only the web /team
 * "Mark as read" button recorded the open, so the owner's strip said
 * "nobody has opened it yet" about a note the whole crew had read. The line
 * now names its note (`metadata.teamNoteId`), and reading it records the
 * reader's first open.
 */

type Row = Record<string, any>;

function fakeDb(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let update: Row | null = null;
    const run = () => {
      const hit = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (update) for (const r of hit) Object.assign(r, update);
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b: any = {
      select: () => b,
      update: (u: Row) => ((update = u), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (
        filters.push((r) => vs.includes(r[k])),
        b
      ),
      order: () => b,
      range: () => b,
      maybeSingle: () =>
        Promise.resolve({ data: run().data[0] ?? null, error: null }),
      then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } };
}

function seed() {
  return {
    notifications: [
      {
        id: "n-note",
        user_id: "u-sam",
        restaurant_id: "house-a",
        type: "system",
        title: "A note about the week of Mon 12 Oct",
        metadata: { teamNoteId: "note-1" },
        status: "unread",
      },
      {
        id: "n-other",
        user_id: "u-sam",
        restaurant_id: "house-a",
        type: "system",
        title: "Something else",
        metadata: {},
        status: "unread",
      },
    ],
    team_members: [
      { id: "m-sam", restaurant_id: "house-a", user_id: "u-sam" },
      { id: "m-ana", restaurant_id: "house-a", user_id: "u-ana" },
    ],
    team_note_recipients: [
      { note_id: "note-1", member_id: "m-sam", opened_at: null },
      { note_id: "note-1", member_id: "m-ana", opened_at: null },
    ],
  } as Record<string, Row[]>;
}

const serviceOver = (tables: Record<string, Row[]>) =>
  new NotificationsService(
    {} as never,
    { get: () => undefined } as never,
    fakeDb(tables) as never,
  );

describe("reading a crew note's line records it as opened (F-1657)", () => {
  it("[PRE-FIX-FAILS] ruling off the line in the bell or on the phone opens the note", async () => {
    const t = seed();
    await serviceOver(t).markAsRead("n-note", "u-sam");
    const sam = t.team_note_recipients.find((r) => r.member_id === "m-sam");
    const ana = t.team_note_recipients.find((r) => r.member_id === "m-ana");
    expect(sam?.opened_at).toEqual(expect.any(String));
    // Only the reader's own row.
    expect(ana?.opened_at).toBeNull();
  });

  it("[PRE-FIX-FAILS] lines ruled off by their ids are not read: no open (F-1663)", async () => {
    const t = seed();
    await serviceOver(t).markBulkAsRead(["n-note", "n-other"], "u-sam");
    expect(t.notifications[0].status).toBe("read");
    expect(t.team_note_recipients[0].opened_at).toBeNull();
  });

  it("[PRE-FIX-FAILS] the bell's rule-off of the lines on screen records no open (F-1663)", async () => {
    const t = seed();
    const n = await serviceOver(t).markFoldAsRead({
      id: "n-note",
      userId: "u-sam",
      restaurantId: "house-a",
    });
    expect(n).toBe(1);
    expect(t.notifications[0].status).toBe("read");
    expect(t.team_note_recipients[0].opened_at).toBeNull();
  });

  it("a tap that opens the bell line records the open, for the reader alone", async () => {
    const t = seed();
    await serviceOver(t).markFoldAsRead({
      id: "n-note",
      userId: "u-sam",
      restaurantId: "house-a",
      opened: true,
    });
    const sam = t.team_note_recipients.find((r) => r.member_id === "m-sam");
    const ana = t.team_note_recipients.find((r) => r.member_id === "m-ana");
    expect(sam?.opened_at).toEqual(expect.any(String));
    expect(ana?.opened_at).toBeNull();
  });

  it("[PRE-FIX-FAILS] two notes about the same week never fold: opening one leaves the other unread and unopened (F-1663)", async () => {
    const t = seed();
    t.notifications.push({
      id: "n-note-2",
      user_id: "u-sam",
      restaurant_id: "house-a",
      type: "system",
      title: "A note about the week of Mon 12 Oct",
      metadata: { teamNoteId: "note-2" },
      status: "unread",
    });
    t.team_note_recipients.push({
      note_id: "note-2",
      member_id: "m-sam",
      opened_at: null,
    });
    const n = await serviceOver(t).markFoldAsRead({
      id: "n-note-2",
      userId: "u-sam",
      restaurantId: "house-a",
      opened: true,
    });
    expect(n).toBe(1);
    expect(t.notifications.find((r) => r.id === "n-note")?.status).toBe(
      "unread",
    );
    const opened = (id: string) =>
      t.team_note_recipients.find(
        (r) => r.note_id === id && r.member_id === "m-sam",
      )?.opened_at;
    expect(opened("note-2")).toEqual(expect.any(String));
    expect(opened("note-1")).toBeNull();
  });

  it("keeps the first open: a second read does not move it", async () => {
    const t = seed();
    t.team_note_recipients[0].opened_at = "2026-10-12T08:00:00.000Z";
    await serviceOver(t).markAsRead("n-note", "u-sam");
    expect(t.team_note_recipients[0].opened_at).toBe(
      "2026-10-12T08:00:00.000Z",
    );
  });

  it("ruling every line off at once is not reading the note", async () => {
    const t = seed();
    await serviceOver(t).markAllAsRead({
      userId: "u-sam",
      restaurantId: "house-a",
    });
    expect(t.team_note_recipients[0].opened_at).toBeNull();
  });
});
