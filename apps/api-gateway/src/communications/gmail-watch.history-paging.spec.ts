/**
 * The Gmail push door reads EVERY page of history.list before it moves the
 * stored cursor (mail proposal L3 test (a), finding F8 / G2).
 *
 * Before this, fetchNewMessages read page one only and then jumped the cursor
 * to the response's historyId, so a letter on page two was never read. A
 * message deleted between the push and the fetch (404 on messages.get) threw
 * the whole batch away. These specs pin: every page read with its pageToken,
 * ids de-duplicated across pages, the cursor set from the last page only after
 * all pages were read, a 404 on one message skipped without losing the rest,
 * and the cursor left alone when the page bound is hit.
 */

jest.mock("googleapis", () => ({ google: {} }));

import { Logger } from "@nestjs/common";
import { GmailWatchService } from "./gmail-watch.service";

type Page = {
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
  nextPageToken?: string;
  historyId?: string;
};

const PAGE_1: Page = {
  history: [{ messagesAdded: [{ message: { id: "a" } }] }],
  nextPageToken: "p2",
  historyId: "10",
};
const PAGE_2: Page = {
  history: [
    { messagesAdded: [{ message: { id: "b" } }, { message: { id: "a" } }] },
  ],
  historyId: "12",
};

function build(opts: {
  pages: (params: any) => Page;
  get?: (id: string) => Promise<any>;
}) {
  const cache = { set: jest.fn(async () => undefined), get: jest.fn() };
  const svc = new GmailWatchService(
    { get: () => undefined } as any,
    cache as any,
  );
  const list = jest.fn(async (params: any) => ({ data: opts.pages(params) }));
  const get = jest.fn(async ({ id }: { id: string }) =>
    opts.get ? opts.get(id) : { data: { id } },
  );
  (svc as any).isConfigured = true;
  (svc as any).gmail = { users: { history: { list }, messages: { get } } };
  return { svc, cache, list, get };
}

const twoPages = (params: any) => (params.pageToken === "p2" ? PAGE_2 : PAGE_1);

describe("GmailWatchService.fetchNewMessages reads every history page", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("(a) follows nextPageToken and returns each id once", async () => {
    const { svc, list } = build({ pages: twoPages });

    const out = await svc.fetchNewMessages("5");

    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0].pageToken).toBeUndefined();
    expect(list.mock.calls[1][0]).toEqual(
      expect.objectContaining({ startHistoryId: "5", pageToken: "p2" }),
    );
  });

  it("(b) advances the cursor to the last page's historyId, once", async () => {
    const { svc, cache } = build({ pages: twoPages });

    await svc.fetchNewMessages("5");

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      "gmail:watch:historyId",
      "12",
      604800,
    );
    expect(cache.set).not.toHaveBeenCalledWith(
      "gmail:watch:historyId",
      "10",
      expect.anything(),
    );
  });

  it("(c) skips a message that 404s and still reads the rest and moves the cursor", async () => {
    const { svc, cache } = build({
      pages: twoPages,
      get: async (id) => {
        if (id === "a")
          throw Object.assign(new Error("Not Found"), { code: 404 });
        return { data: { id } };
      },
    });

    const out = await svc.fetchNewMessages("5");

    expect(out.map((m) => m.id)).toEqual(["b"]);
    expect(cache.set).toHaveBeenCalledWith(
      "gmail:watch:historyId",
      "12",
      604800,
    );
    expect(warn).toHaveBeenCalledWith(
      "Gmail message a no longer exists (404) — skipped",
    );
  });

  it("(c') any other messages.get failure keeps today's behaviour: nothing returned, cursor kept", async () => {
    const { svc, cache } = build({
      pages: twoPages,
      get: async (id) => {
        if (id === "b")
          throw Object.assign(new Error("Backend Error"), { code: 500 });
        return { data: { id } };
      },
    });

    const out = await svc.fetchNewMessages("5");

    expect(out).toEqual([]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("(d) stops at the page bound without moving the cursor", async () => {
    let n = 0;
    const { svc, cache, list } = build({
      pages: () => {
        n++;
        return {
          history: [{ messagesAdded: [{ message: { id: `m${n}` } }] }],
          nextPageToken: `p${n + 1}`,
          historyId: String(100 + n),
        };
      },
    });

    const out = await svc.fetchNewMessages("5");

    expect(list).toHaveBeenCalledTimes(GmailWatchService.HISTORY_PAGE_LIMIT);
    expect(out).toHaveLength(GmailWatchService.HISTORY_PAGE_LIMIT);
    expect(cache.set).not.toHaveBeenCalled();
  });
});
