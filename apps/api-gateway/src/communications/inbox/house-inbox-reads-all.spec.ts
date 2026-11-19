/**
 * The wider reading grant (`gmail_read_all`): every conversation, not only the
 * vendors', and only for the person who accepted those words (founder
 * delegation 2026-11-19, forks a-d).
 *
 *   1. THE WIDE GRANT IS NOT BOUNDED BY THE BOOK: its query has no `from:`, it
 *      reads with an EMPTY book, and each message is filed as vendor / team /
 *      guest from the grant's own house.
 *   2. THE OLD GRANT IS NEVER WIDENED: a `gmail_read` grant keeps the `from:`
 *      bound and the discard, in the same run that reads a wide one.
 *   3. THE PUBLISHED EVENT CARRIES kind, from and to, and a team or guest
 *      message never has its attachment bytes fetched.
 *   4. ONE MAILBOX IS READ ONCE: a person holding both grants in a house is read
 *      through the wide one only.
 *   5. THE CURSOR NEVER JUMPS OVER MAIL: with more messages listed than one tick
 *      may take, the OLDEST are taken; a listing that cannot be proven to hold
 *      the oldest is a failed read.
 *   6. A TEAM LIST THAT CANNOT BE READ IS AN ERROR, not an empty team.
 */

import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { OrchestratorService } from "../../common/orchestrator/orchestrator.service";
import { HouseLettersService } from "../letters/house-letters.service";
import { HouseSenderService } from "../letters/house-sender.service";
import {
  HouseInboxService,
  GMAIL_READ_SCOPE,
  MAX_MESSAGES_PER_TICK,
  MAX_PAGES_ALL,
  classifySender,
} from "./house-inbox.service";
import { addressesInHeader } from "../gmail-mime";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const OTHER_PERSON = "dddddddd-0000-4000-8000-ddddddddddd2";
const WIDE_GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeee1";
const NARROW_GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeee2";

const VENDOR = "fikri@fikritarim.com";
const COLLEAGUE = "chef@house.example";
const GUEST = "guest@diner.example";
const CURSOR = 1_700_000_000_000;

type Rows = Record<string, unknown>[] | { error: { message: string } };

function build(rows: Record<string, Rows>) {
  const chain = (payload: Rows) => {
    const failed = !Array.isArray(payload);
    const data = Array.isArray(payload) ? payload : null;
    const error = failed ? (payload as { error: { message: string } }).error : null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    for (const m of ["select", "eq", "in", "is", "or", "lte", "gte", "order", "limit", "insert", "update"]) {
      self[m] = pass;
    }
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.maybeSingle = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve);
    return self;
  };
  return {
    client: { from: (table: string) => chain(rows[table] ?? []) },
  } as unknown as DatabaseService;
}

const BOOK_ROWS = {
  providers: [
    { id: PROVIDER, name: "Fikri", contact_email: VENDOR, primary_contact: { name: "F", email: VENDOR } },
  ],
  provider_contacts: [],
};
const FLAG_ON = { restaurant_feature_flags: [{ enable_house_inbox_read: true }] };
const TEAM_ROWS = {
  user_restaurant_access: [
    { user_id: PERSON, is_active: true, valid_from: null, valid_until: null },
    { user_id: OTHER_PERSON, is_active: true, valid_from: null, valid_until: null },
    { user_id: "expired", is_active: true, valid_from: null, valid_until: "2000-01-01T00:00:00Z" },
  ],
  users: [
    { user_id: PERSON, email: COLLEAGUE },
    { user_id: OTHER_PERSON, email: "Sous@House.example" },
  ],
};

const grant = (id: string, integration: string, user = PERSON) => ({
  id,
  user_id: user,
  restaurant_id: HOUSE,
  integration_id: integration,
  provider: "google",
  scopes: [GMAIL_READ_SCOPE],
  revoked_at: null,
});

function message(p: {
  id: string;
  from: string;
  to?: string;
  cc?: string;
  at: number;
  withAttachment?: boolean;
}) {
  const parts = p.withAttachment
    ? [
        { mimeType: "text/plain", body: { data: Buffer.from("hello").toString("base64url") } },
        { mimeType: "application/pdf", filename: "menu.pdf", body: { attachmentId: "att-1" } },
      ]
    : undefined;
  return {
    id: p.id,
    threadId: `thread-${p.id}`,
    internalDate: String(p.at),
    payload: {
      mimeType: parts ? "multipart/mixed" : "text/plain",
      headers: [
        { name: "From", value: p.from },
        { name: "To", value: p.to ?? "owner@house.example" },
        ...(p.cc ? [{ name: "Cc", value: p.cc }] : []),
        { name: "Subject", value: `subject ${p.id}` },
        { name: "Message-ID", value: `<${p.id}@mail.example>` },
      ],
      ...(parts ? { parts } : { body: { data: Buffer.from(`body ${p.id}`).toString("base64url") } }),
    },
  };
}

/** Pages of ids, then per-id messages; records every URL. */
function gmail(pages: Array<Array<{ id: string }>>, messages: Record<string, unknown>) {
  const urls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/messages?")) {
      const token = new URL(url).searchParams.get("pageToken");
      const idx = token ? Number(token) : 0;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messages: pages[idx] ?? [],
          nextPageToken: idx + 1 < pages.length ? String(idx + 1) : undefined,
        }),
      };
    }
    if (url.includes("/attachments/")) {
      return { ok: true, status: 200, json: async () => ({ data: Buffer.from("PDF").toString("base64url") }) };
    }
    const id = /\/messages\/([^?/]+)/.exec(url)?.[1] ?? "";
    return { ok: true, status: 200, json: async () => messages[id] ?? null };
  }) as unknown as typeof fetch;
  return { urls, impl };
}

function serviceOver(db: DatabaseService) {
  const publish = jest.fn().mockResolvedValue(undefined);
  const orchestrator = { publishEvent: publish } as unknown as OrchestratorService;
  const getAccessToken = jest.fn().mockResolvedValue("ya29.token");
  const oauth = { getAccessToken } as unknown as IntegrationsOauthService;
  const sender = new HouseSenderService(db, { get: () => undefined } as never);
  const letters = new HouseLettersService(db, sender, oauth);
  const service = new HouseInboxService(db, orchestrator, oauth, letters);
  return { service, publish, getAccessToken };
}

const wideRows = (extra: Record<string, Rows> = {}) => ({
  integration_oauth_connections: [grant(WIDE_GRANT, "gmail_read_all")],
  ...FLAG_ON,
  ...BOOK_ROWS,
  ...TEAM_ROWS,
  house_inbox_cursors: [{ last_internal_date: CURSOR }],
  ...extra,
});

describe("classifySender and addressesInHeader", () => {
  const book = new Set([VENDOR]);
  const team = new Set([COLLEAGUE, VENDOR]);
  it("a book address is a vendor even when it is also a member; a member is team; anyone else is a guest", () => {
    expect(classifySender(VENDOR, book, team)).toBe("vendor");
    expect(classifySender(COLLEAGUE, book, team)).toBe("team");
    expect(classifySender(GUEST, book, team)).toBe("guest");
  });
  it("reads bare addresses out of To/Cc, keeping a comma inside a quoted name whole", () => {
    expect(
      addressesInHeader('"Doe, Jane" <Jane@X.com>, bob@y.com; <Bob@Y.com>'),
    ).toEqual(["jane@x.com", "bob@y.com"]);
    expect(addressesInHeader("")).toEqual([]);
  });
});

describe("the wide grant files every conversation, marked by who it is from", () => {
  it("has no from: bound, reads with an empty book, and publishes kind, from and to", async () => {
    const db = build(wideRows({ providers: [], provider_contacts: [] }));
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail(
      [[{ id: "m-vendor" }, { id: "m-team" }, { id: "m-guest" }]],
      {
        "m-vendor": message({ id: "m-vendor", from: VENDOR, at: CURSOR + 3000 }),
        "m-team": message({ id: "m-team", from: `Chef <${COLLEAGUE}>`, at: CURSOR + 2000, to: "a@x.com", cc: "b@y.com" }),
        "m-guest": message({ id: "m-guest", from: GUEST, at: CURSOR + 1000, withAttachment: true }),
      },
    );
    service.fetchImpl = impl;

    const run = await service.readDue(CURSOR + 300_000);

    expect(run.outcomes[0].outcome).toBe("read");
    expect(run.mirrored).toBe(3);
    const q = new URL(urls.find((u) => u.includes("/messages?"))!).searchParams.get("q")!;
    expect(q).toContain("after:");
    expect(q).toContain("-in:sent");
    expect(q).not.toContain("from:");
    // Oldest first, so a failed run leaves a contiguous prefix.
    const events = publish.mock.calls.map((c) => c[2]);
    expect(events.map((e) => e.gmail_message_id)).toEqual(["m-guest", "m-team", "m-vendor"]);
    // The book was emptied in this run, so the vendor is a guest here by the
    // grant's own book: kind is decided from THIS house's data alone.
    expect(events.map((e) => e.house_mail_kind)).toEqual(["guest", "team", "guest"]);
    expect(events[1].from_address).toBe(COLLEAGUE);
    expect(events[1].to_addresses).toEqual(["a@x.com", "b@y.com"]);
    expect(events.every((e) => e.mirrored_by_grant_id === WIDE_GRANT)).toBe(true);
  });

  it("marks a book address a vendor, a member team, anyone else a guest, and never fetches a stranger's attachment", async () => {
    const db = build(wideRows());
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail(
      [[{ id: "m-vendor" }, { id: "m-team" }, { id: "m-guest" }, { id: "m-sous" }]],
      {
        "m-vendor": message({ id: "m-vendor", from: VENDOR, at: CURSOR + 4000, withAttachment: true }),
        "m-team": message({ id: "m-team", from: COLLEAGUE, at: CURSOR + 3000 }),
        "m-guest": message({ id: "m-guest", from: GUEST, at: CURSOR + 2000, withAttachment: true }),
        "m-sous": message({ id: "m-sous", from: "sous@house.example", at: CURSOR + 1000 }),
      },
    );
    service.fetchImpl = impl;

    await service.readDue(CURSOR + 300_000);

    const byId = Object.fromEntries(publish.mock.calls.map((c) => [c[2].gmail_message_id, c[2]]));
    expect(byId["m-vendor"].house_mail_kind).toBe("vendor");
    expect(byId["m-team"].house_mail_kind).toBe("team");
    expect(byId["m-sous"].house_mail_kind).toBe("team");
    expect(byId["m-guest"].house_mail_kind).toBe("guest");
    // Only the vendor's attachment was fetched.
    expect(urls.filter((u) => u.includes("/attachments/"))).toHaveLength(1);
    expect(byId["m-guest"].attachments).toEqual([]);
    expect(byId["m-vendor"].attachments).toHaveLength(1);
  });

  it("refuses to file anything when the people who work here cannot be read", async () => {
    const db = build(wideRows({ user_restaurant_access: { error: { message: "timeout" } } }));
    const { service, publish, getAccessToken } = serviceOver(db);
    const { urls, impl } = gmail([[]], {});
    service.fetchImpl = impl;

    const run = await service.readDue(CURSOR + 300_000);

    expect(run.outcomes[0].outcome).toBe("error");
    expect(run.outcomes[0].says).toMatch(/could not be read/i);
    expect(publish).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(urls).toHaveLength(0);
  });
});
