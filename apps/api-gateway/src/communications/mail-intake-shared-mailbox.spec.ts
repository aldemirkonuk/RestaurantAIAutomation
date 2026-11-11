/**
 * Gap G2 (mail software, 2026-11-11): the shared mailbox moves its Gmail
 * cursor only past letters it has recorded, reads every history page, and
 * resyncs by date when Gmail drops the cursor. On 4be3b63e6 the cursor moved
 * before anything was stored, one page was read, a 404 skipped the gap, and
 * the own-mail skip was a substring test on the From.
 */
import { memoryDb, Row } from "./testing/mail-store";
import { fakeIntake, fakeWatch, reader } from "./testing/shared-mailbox";
import { GmailWatchService } from "./gmail-watch.service";

const VENDOR = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist",
  contact_email: "sales@bigdist.com",
};
const house = (): Record<string, Row[]> => ({
  providers: [VENDOR],
  procurement_orders: [],
  procurement_conversations: [],
});

const MSG = (id: string, from = "BigDist <sales@bigdist.com>") => ({
  id,
  threadId: `t-${id}`,
  payload: {
    headers: [
      { name: "From", value: from },
      { name: "Subject", value: "Re: order" },
    ],
    body: { data: Buffer.from("ok").toString("base64url") },
  },
});

describe("the shared mailbox moves its cursor only past recorded letters", () => {
  it("records every letter, then moves the cursor to the mailbox's present", async () => {
    const published: any[] = [];
    const { watch, advanced } = fakeWatch([MSG("g1"), MSG("g2")]);
    const r = reader(watch, fakeIntake(published).intake, memoryDb(house()));
    const run = await r.read();
    expect(run).toMatchObject({ status: "processed", recorded: 2 });
    expect(advanced).toEqual([["12", true, null]]);
  });

  it("a letter Gmail would not hand over stops the read before it", async () => {
    const published: any[] = [];
    const { watch, advanced } = fakeWatch([MSG("g1"), MSG("g2"), MSG("g3")], {
      failing: ["g2"],
    });
    const run = await reader(watch, fakeIntake(published).intake, memoryDb(house())).read();
    expect(run.status).toBe("stopped");
    // History 10 (g1) is safe; 11 (g2) is read again next time.
    expect(advanced).toEqual([["10", true, expect.stringMatching(/g2/)]]);
  });

  it("a refused record moves nothing", async () => {
    const { watch, advanced } = fakeWatch([MSG("g1")]);
    const run = await reader(watch, fakeIntake([], true).intake, memoryDb(house())).read();
    expect(run.status).toBe("stopped");
    expect(advanced).toEqual([[null, false, expect.stringMatching(/refused/)]]);
  });

  it("an expired cursor reads the inbox by date instead of skipping the gap", async () => {
    const published: any[] = [];
    const { watch, advanced } = fakeWatch([MSG("g1")], { expired: true });
    const run = await reader(watch, fakeIntake(published).intake, memoryDb(house())).read();
    expect(run).toMatchObject({ status: "resynced", recorded: 1 });
    expect(advanced).toEqual([["99", true, null]]);
  });

  it("an expired cursor resyncs from the last finished read, less five minutes", async () => {
    const last = "2026-11-10T12:00:00.000Z";
    const { watch, listedAfter } = fakeWatch([MSG("g1")], {
      expired: true,
      lastReadAt: last,
    });
    await reader(watch, fakeIntake([]).intake, memoryDb(house())).read();
    expect(listedAfter).toEqual([(Date.parse(last) - 5 * 60_000) / 1000]);
  });

  it("a failed resync leaves the cursor and records the error (last_read_at is the RPC's to keep)", async () => {
    const { watch, advanced } = fakeWatch([MSG("g1")], {
      expired: true,
      failing: ["g1"],
    });
    const run = await reader(watch, fakeIntake([]).intake, memoryDb(house())).read();
    expect(run.status).toBe("stopped");
    expect(advanced).toEqual([[null, false, expect.stringMatching(/g1/)]]);
  });

  it("a resync window too large to list stops visibly; it never jumps to the present", async () => {
    const published: any[] = [];
    const { watch, advanced } = fakeWatch([MSG("g1"), MSG("g2")], {
      expired: true,
      truncated: true,
    });
    const run = await reader(watch, fakeIntake(published).intake, memoryDb(house())).read();
    expect(run).toMatchObject({ status: "stopped", recorded: 0 });
    expect(run.error).toMatch(/more than 2 letters/);
    expect(published).toEqual([]);
    expect(advanced).toEqual([[null, false, expect.stringMatching(/did not move/)]]);
  });

  it("a push during a running read is answered busy, and the running read goes round again", async () => {
    const published: any[] = [];
    const answers: any[] = [];
    let r: any;
    let pushedOnce = false;
    const { watch, advanced } = fakeWatch([MSG("g1")], {
      onFetch: async () => {
        if (pushedOnce) return;
        pushedOnce = true;
        answers.push(await r.read("50"));
      },
    });
    r = reader(watch, fakeIntake(published).intake, memoryDb(house()));
    const run = await r.read();
    expect(answers).toEqual([{ status: "busy", messages: 0, recorded: 0 }]);
    // Two passes from the cursor: the one that was running and the one owed.
    expect(advanced).toHaveLength(2);
    expect(run).toMatchObject({ status: "processed", messages: 2 });
  });

  it("a door that never read starts at the pushed id and reads nothing older", async () => {
    const { watch, advanced } = fakeWatch([MSG("g1")], { cursor: null });
    const run = await reader(watch, fakeIntake([]).intake, memoryDb(house())).read("77");
    expect(run.status).toBe("initialized");
    expect(advanced).toEqual([["77", false, null]]);
  });

  it("own mail is the parsed address, not a substring of the From", async () => {
    const published: any[] = [];
    const own = MSG("g1", "house@mudavym.example");
    const spoof = MSG("g2", '"house@mudavym.example" <stranger@evil.example>');
    const { watch } = fakeWatch([own, spoof]);
    await reader(watch, fakeIntake(published).intake, memoryDb(house())).read();
    expect(published.map((p) => p.gmail_message_id)).toEqual(["g2"]);
  });
});

describe("GmailWatchService.inboxIdsSince never cuts a window in silence", () => {
  const svcWith = (pages: any[]) => {
    const svc: any = new GmailWatchService({ get: () => undefined } as any, {} as any);
    svc.isConfigured = true;
    svc.gmail = { users: { messages: { list: async () => ({ data: pages.shift() }) } } };
    return svc;
  };

  it("reads every page and answers oldest first", async () => {
    const svc = svcWith([
      { messages: [{ id: "new" }, { id: "mid" }], nextPageToken: "p2" },
      { messages: [{ id: "old" }] },
    ]);
    await expect(svc.inboxIdsSince(0)).resolves.toEqual({
      ids: ["old", "mid", "new"],
      truncated: false,
    });
  });

  it("says truncated when more pages remain past the ceiling", async () => {
    const svc = svcWith([
      { messages: [{ id: "c" }, { id: "b" }], nextPageToken: "p2" },
      { messages: [{ id: "a" }] },
    ]);
    await expect(svc.inboxIdsSince(0, 2)).resolves.toMatchObject({ truncated: true });
  });
});

describe("GmailWatchService.historySince reads every page", () => {
  it("follows nextPageToken", async () => {
    const svc: any = new GmailWatchService({ get: () => undefined } as any, {} as any);
    svc.isConfigured = true;
    const pages: any[] = [
      { history: [{ id: "5", messagesAdded: [{ message: { id: "a" } }] }], nextPageToken: "p2", historyId: "9" },
      { history: [{ id: "6", messagesAdded: [{ message: { id: "b" } }] }], historyId: "9" },
    ];
    svc.gmail = { users: { history: { list: async () => ({ data: pages.shift() }) } } };
    const since = await svc.historySince("4");
    expect(since.entries.map((e: any) => e.messageIds[0])).toEqual(["a", "b"]);
    expect(since.latest).toBe("9");
  });

  it("says a 404 is an expired cursor, not an empty mailbox", async () => {
    const svc: any = new GmailWatchService({ get: () => undefined } as any, {} as any);
    svc.isConfigured = true;
    svc.gmail = {
      users: { history: { list: async () => Promise.reject(Object.assign(new Error("gone"), { code: 404 })) } },
    };
    await expect(svc.historySince("4")).resolves.toMatchObject({ expired: true });
  });
});

