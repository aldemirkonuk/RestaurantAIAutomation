/**
 * The house's own inbox reaches the book — proved at the seams that matter
 * (ADR 0118, receive half).
 *
 * Nine things, each of which would be a silent falsehood if it broke:
 *
 *   1. THE QUERY IS BOUNDED BY THE BOOK. Every request carries `from:(...)`
 *      built from THIS house's vendor addresses, chunked, with the cursor as
 *      `after:`. There is no code path that asks Gmail for anything else.
 *   2. GMAIL'S OWN FUZZY MATCHING IS NOT TRUSTED. `from:` matches display names
 *      and partial tokens, so a message from outside the book can come back
 *      from a query that named only book addresses. It is DISCARDED, and its
 *      body never reaches the event, the log or the cursor.
 *   3. THE MIRROR IS THE SHARED FUNCTION. The reader publishes the same
 *      `email.inbound.received` event the shared mailbox publishes and NEVER
 *      writes `procurement_conversations` itself, so
 *      `RabbitMqBridgeService.handleInboundEmail` does the writing, the dedupe
 *      and the handoff to triage for both mailboxes.
 *   4. THE FIRST TICK READS NOTHING. It seeds the cursor at `now`, so switching
 *      the reader on never reaches backwards into somebody's mail.
 *   5. THE SWITCH IS NOT THE CONSENT. A grant with `enable_house_inbox_read`
 *      off is not read, and the outcome says which of the two is missing.
 *   6. AN EMPTY BOOK IS NOT AN UNBOUNDED READ. No book, no request.
 *   7. ADR 0114's REVOKE STOPS IT ON THE NEXT TICK, because the token comes
 *      from the one door that enforces it.
 *   8. A FAILED PUBLISH DOES NOT ADVANCE THE CURSOR. A message that did not
 *      reach the book is read again rather than lost with the run reporting
 *      success.
 *   9. THE ROW IS NOT THE ANSWER; THE STORED SCOPE IS. A row filed under
 *      `gmail_read` whose scopes do not include the read scope is refused.
 *
 * `fetch` is stubbed throughout, so the request shape is proved without a
 * network and without a real mailbox. No test here creates a grant, and none
 * touches a live Google account.
 */

import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { OrchestratorService } from "../../common/orchestrator/orchestrator.service";
import { HouseLettersService } from "../letters/house-letters.service";
import { HouseSenderService } from "../letters/house-sender.service";
import { HouseInboxService, GMAIL_READ_SCOPE } from "./house-inbox.service";
import { HouseInboxCron } from "./house-inbox.cron";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

const VENDOR = "fikri@fikritarim.com";
const ACCOUNTANT = "muhasebe@fikritarim.com";
const STRANGER = "doctor@clinic.example";

interface Recorded {
  tables: string[];
  inserts: Array<{ table: string; body: Record<string, unknown> }>;
  updates: Array<{ table: string; body: Record<string, unknown> }>;
}

/** The same supabase-shaped stub the letters spec uses, addressed by table. */
function build(
  rows: Record<
    string,
    Record<string, unknown>[] | { error: { message: string } }
  >,
) {
  const rec: Recorded = { tables: [], inserts: [], updates: [] };

  const chain = (
    table: string,
    payload: Record<string, unknown>[] | { error: { message: string } },
  ) => {
    const failed = !Array.isArray(payload);
    const data = Array.isArray(payload) ? payload : null;
    const error = failed
      ? (payload as { error: { message: string } }).error
      : null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.in = pass;
    self.is = pass;
    self.or = pass;
    self.lte = pass;
    self.gte = pass;
    self.order = pass;
    self.limit = pass;
    self.insert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.update = (body: Record<string, unknown>) => {
      rec.updates.push({ table, body });
      return self;
    };
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.maybeSingle = () =>
      Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve);
    return self;
  };

  const db = {
    client: {
      from: (table: string) => {
        rec.tables.push(table);
        return chain(table, rows[table] ?? []);
      },
    },
  } as unknown as DatabaseService;

  return { rec, db };
}

const BOOK_ROWS = {
  providers: [
    {
      id: PROVIDER,
      name: "Fikri Tarım Gıda",
      contact_email: VENDOR,
      primary_contact: { name: "Fikri", email: VENDOR },
    },
  ],
  provider_contacts: [
    { provider_id: PROVIDER, name: "Muhasebe", email: ACCOUNTANT },
  ],
};

const READ_GRANT = {
  id: GRANT,
  user_id: PERSON,
  restaurant_id: HOUSE,
  integration_id: "gmail_read",
  provider: "google",
  scopes: [GMAIL_READ_SCOPE],
  revoked_at: null,
};

const FLAG_ON = {
  restaurant_feature_flags: [{ enable_house_inbox_read: true }],
};

function base64url(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64url");
}

/** A Gmail `messages.get` payload with one text/plain part. */
function message(params: {
  id: string;
  from: string;
  subject: string;
  body: string;
  internalDate: number;
}) {
  return {
    id: params.id,
    threadId: `thread-${params.id}`,
    internalDate: String(params.internalDate),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: params.from },
        { name: "Subject", value: params.subject },
        { name: "Message-ID", value: `<${params.id}@mail.example>` },
      ],
      body: { data: base64url(params.body) },
    },
  };
}

/** Routes stubbed Gmail responses by URL, and records every URL asked for. */
function gmail(responses: {
  list?: unknown;
  messages?: Record<string, unknown>;
}) {
  const urls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/messages?")) {
      return {
        ok: true,
        status: 200,
        json: async () => responses.list ?? { messages: [] },
      };
    }
    const id = /\/messages\/([^?/]+)/.exec(url)?.[1] ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => (responses.messages ?? {})[id] ?? null,
    };
  }) as unknown as typeof fetch;
  return { urls, impl };
}

function serviceOver(
  db: DatabaseService,
  opts: {
    publish?: jest.Mock;
    token?: () => Promise<string>;
  } = {},
) {
  const publish = opts.publish ?? jest.fn().mockResolvedValue(undefined);
  const orchestrator = { publishEvent: publish } as unknown as OrchestratorService;
  const oauth = {
    getAccessToken: jest
      .fn()
      .mockImplementation(opts.token ?? (async () => "ya29.token")),
  } as unknown as IntegrationsOauthService;
  const sender = new HouseSenderService(db, {
    get: () => undefined,
  } as never);
  const letters = new HouseLettersService(db, sender, oauth);
  const service = new HouseInboxService(db, orchestrator, oauth, letters);
  return { service, publish, oauth };
}

describe("the query is bounded by this house's vendor book", () => {
  it("names only book addresses, and carries the cursor as after:", () => {
    const { db } = build({});
    const { service } = serviceOver(db);
    const queries = service.buildQuery([VENDOR, ACCOUNTANT], 1_700_000_000_000);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toBe(
      `from:(${VENDOR} OR ${ACCOUNTANT}) after:1700000000`,
    );
    // Nothing in the query reaches beyond the book.
    expect(queries[0]).not.toContain(STRANGER);
  });

  it("chunks a large book rather than growing one unbounded query", () => {
    const { db } = build({});
    const { service } = serviceOver(db);
    const many = Array.from({ length: 60 }, (_, i) => `v${i}@example.com`);
    const queries = service.buildQuery(many, 0);
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.split(" OR ").length).toBeLessThanOrEqual(25);
      expect(q.startsWith("from:(")).toBe(true);
    }
    // Every address is asked for exactly once; none is quietly dropped.
    const asked = queries.join(" ").match(/v\d+@example\.com/g) ?? [];
    expect(new Set(asked).size).toBe(60);
  });
});

describe("the first tick", () => {
  it("seeds the cursor at now and reads nothing at all", async () => {
    const { rec, db } = build({
      integration_oauth_connections: [READ_GRANT],
      ...FLAG_ON,
      ...BOOK_ROWS,
      house_inbox_cursors: [],
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue(1_700_000_000_000);

    expect(run.outcomes[0].outcome).toBe("seeded");
    expect(run.outcomes[0].says).toContain("nothing older was read");
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    const seeded = rec.inserts.find((i) => i.table === "house_inbox_cursors");
    expect(seeded?.body.last_internal_date).toBe(1_700_000_000_000);
    expect(seeded?.body.started_at).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
  });
});

describe("the switch and the consent are two facts", () => {
  it("reads nothing when the house has not switched the reader on", async () => {
    const { db } = build({
      integration_oauth_connections: [READ_GRANT],
      restaurant_feature_flags: [{ enable_house_inbox_read: false }],
      ...BOOK_ROWS,
      house_inbox_cursors: [{ last_internal_date: 1 }],
    });
    const { service, publish, oauth } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.outcomes[0].outcome).toBe("flag_off");
    expect(run.outcomes[0].says).toContain("enable_house_inbox_read");
    expect(run.outcomes[0].says).toContain("both are required");
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    expect(oauth.getAccessToken).not.toHaveBeenCalled();
  });

  it("fails closed when the switch cannot be read", async () => {
    const { db } = build({
      integration_oauth_connections: [READ_GRANT],
      restaurant_feature_flags: { error: { message: "column does not exist" } },
      ...BOOK_ROWS,
      house_inbox_cursors: [{ last_internal_date: 1 }],
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    // A read that should not have happened cannot be taken back; a read that
    // was skipped happens five minutes later.
    expect(run.outcomes[0].outcome).toBe("flag_off");
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("an empty book is not an unbounded read", () => {
  it("makes no request when this house has no vendor address", async () => {
    const { db } = build({
      integration_oauth_connections: [READ_GRANT],
      ...FLAG_ON,
      providers: [],
      provider_contacts: [],
      house_inbox_cursors: [{ last_internal_date: 1 }],
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.outcomes[0].outcome).toBe("empty_book");
    expect(run.outcomes[0].says).toContain(
      "An unbounded read is not the fallback",
    );
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses rather than reading when the book itself cannot be read", async () => {
    const { db } = build({
      integration_oauth_connections: [READ_GRANT],
      ...FLAG_ON,
      providers: { error: { message: "permission denied" } },
      house_inbox_cursors: [{ last_internal_date: 1 }],
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.outcomes[0].outcome).toBe("error");
    expect(run.outcomes[0].says).toContain("no query was bounded");
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("a reply from the book reaches the book, and nothing else does", () => {
  const CURSOR = 1_700_000_000_000;
  const rows = () => ({
    integration_oauth_connections: [READ_GRANT],
    ...FLAG_ON,
    ...BOOK_ROWS,
    house_inbox_cursors: [{ last_internal_date: CURSOR }],
  });

  const listed = {
    messages: [{ id: "m-stranger" }, { id: "m-vendor" }],
  };
  const messages = {
    "m-vendor": message({
      id: "m-vendor",
      from: '"Fikri Tarım" <fikri@fikritarim.com>',
      subject: "Re: domates fiyatı",
      body: "Kilo 42 TL, 20 kasa hazır.",
      internalDate: CURSOR + 60_000,
    }),
    // Gmail's `from:` matches display names and partial tokens, so a query that
    // named only book addresses can still return this. It must not survive.
    "m-stranger": message({
      id: "m-stranger",
      from: "Fikri at the clinic <doctor@clinic.example>",
      subject: "Your test results",
      body: "PLEASE DO NOT LET THIS REACH A SHARED LEDGER.",
      internalDate: CURSOR + 30_000,
    }),
  };

  it("publishes the shared inbound event and never writes the conversation row itself", async () => {
    const { rec, db } = build(rows());
    const { service, publish } = serviceOver(db);
    const { impl } = gmail({ list: listed, messages });
    service.fetchImpl = impl;

    const run = await service.readDue(CURSOR + 300_000);

    // The run must SAY it mirrored. A publish with a run reporting zero is the
    // absence-as-health shape this suite exists to catch.
    expect(run.mirrored).toBe(1);
    expect(run.outcomes[0].mirrored).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, event] = publish.mock.calls[0];
    expect(exchange).toBe("email.events");
    expect(routingKey).toBe("email.inbound.received");
    expect(event.restaurant_id).toBe(HOUSE);
    expect(event.gmail_message_id).toBe("m-vendor");
    expect(event.body).toContain("Kilo 42 TL");
    expect(event.source).toBe("house-inbox");

    // THE MIRROR IS handleInboundEmail, not a second insert. If this ever
    // starts writing its own row, a house-mailbox reply stops being the same
    // kind of thing as a shared-mailbox one and nothing else would say so.
    expect(rec.tables).not.toContain("procurement_conversations");
    expect(
      rec.inserts.filter((i) => i.table === "procurement_conversations"),
    ).toHaveLength(0);
  });

  it("discards a message Gmail returned that the book does not hold", async () => {
    const { db } = build(rows());
    const { service, publish } = serviceOver(db);
    const { impl } = gmail({ list: listed, messages });
    service.fetchImpl = impl;

    const run = await service.readDue(CURSOR + 300_000);

    expect(run.outcomes[0].discarded).toBe(1);
    expect(run.outcomes[0].admitted).toBe(1);
    expect(run.discarded).toBe(1);

    // The stranger's body appears in NOTHING that leaves this process.
    const published = JSON.stringify(publish.mock.calls);
    expect(published).not.toContain("PLEASE DO NOT LET THIS REACH");
    expect(published).not.toContain(STRANGER);
    expect(published).not.toContain("Your test results");
  });

  it("advances the cursor only past what actually reached the book", async () => {
    const { rec, db } = build(rows());
    const { service } = serviceOver(db);
    const { impl } = gmail({ list: listed, messages });
    service.fetchImpl = impl;

    const run = await service.readDue(CURSOR + 300_000);

    // The stranger arrived EARLIER than the vendor and was discarded; the
    // cursor is the vendor's date, so the discard leaves no trace at all.
    expect(run.outcomes[0].cursorAdvancedTo).toBe(CURSOR + 60_000);
    const saved = rec.updates.find((u) => u.table === "house_inbox_cursors");
    expect(saved?.body.last_internal_date).toBe(CURSOR + 60_000);
    expect(saved?.body.last_discarded).toBe(1);
    expect(saved?.body.last_error).toBeNull();
  });

  it("leaves the cursor where it was when the mirror could not be published", async () => {
    const { rec, db } = build(rows());
    const publish = jest
      .fn()
      .mockRejectedValue(new Error("RabbitMQ channel unavailable"));
    const { service } = serviceOver(db, { publish });
    const { impl } = gmail({ list: listed, messages });
    service.fetchImpl = impl;

    const run = await service.readDue(CURSOR + 300_000);

    expect(run.outcomes[0].outcome).toBe("error");
    expect(run.outcomes[0].mirrored).toBe(0);
    // Not advanced. The message is read again next tick rather than lost with
    // the run reporting a clean pass.
    expect(run.outcomes[0].cursorAdvancedTo).toBe(CURSOR);
    const saved = rec.updates.find((u) => u.table === "house_inbox_cursors");
    expect(saved?.body.last_internal_date).toBe(CURSOR);
    expect(String(saved?.body.last_error)).toContain("RabbitMQ");
  });
});

describe("revocation stops the read on the next tick", () => {
  it("reads nothing when the house has stopped using the grant (ADR 0114)", async () => {
    const { db } = build({
      integration_oauth_connections: [READ_GRANT],
      ...FLAG_ON,
      ...BOOK_ROWS,
      house_inbox_cursors: [{ last_internal_date: 1 }],
    });
    const { service, publish } = serviceOver(db, {
      token: async () => {
        throw new ForbiddenException(
          "This house has stopped using that Gmail — reading vendor replies only grant. The grant itself is untouched and still belongs to the person who made it.",
        );
      },
    });
    const { urls, impl } = gmail({ list: { messages: [{ id: "m-1" }] } });
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.outcomes[0].outcome).toBe("house_revoked");
    expect(run.outcomes[0].says).toContain("stopped using");
    // The token is the gate, so no Gmail request is made at all.
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("never sees a grant a person disconnected", async () => {
    // `disconnect()` sets `revoked_at`; the enumeration filters on it, so the
    // row is gone from this loop entirely rather than skipped inside it.
    const { db } = build({
      integration_oauth_connections: [],
      ...FLAG_ON,
      ...BOOK_ROWS,
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.grants).toBe(0);
    expect(run.outcomes).toHaveLength(0);
    expect(run.error).toBeNull();
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("the stored scope decides, not the row's name", () => {
  it("refuses a row filed under gmail_read that does not carry the read scope", async () => {
    const { db } = build({
      integration_oauth_connections: [
        { ...READ_GRANT, scopes: ["https://www.googleapis.com/auth/gmail.send"] },
      ],
      ...FLAG_ON,
      ...BOOK_ROWS,
      house_inbox_cursors: [{ last_internal_date: 1 }],
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.outcomes[0].outcome).toBe("error");
    expect(run.outcomes[0].says).toContain("stored scopes do not include");
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not read for a grant that carries no house", async () => {
    const { db } = build({
      integration_oauth_connections: [{ ...READ_GRANT, restaurant_id: null }],
      ...FLAG_ON,
      ...BOOK_ROWS,
    });
    const { service, publish } = serviceOver(db);
    const { urls, impl } = gmail({});
    service.fetchImpl = impl;

    const run = await service.readDue();

    expect(run.outcomes[0].outcome).toBe("no_house");
    expect(run.outcomes[0].says).toContain("no vendor book to bound it by");
    expect(urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("a failed enumeration is not an absence of grants", () => {
  it("says the list could not be read rather than reporting zero", async () => {
    const { db } = build({
      integration_oauth_connections: { error: { message: "timeout" } },
    });
    const { service } = serviceOver(db);

    const run = await service.readDue();

    expect(run.grants).toBe(0);
    expect(run.error).toContain("could not be read");
    expect(run.error).toContain("not an absence of grants");
  });
});

describe("the cron reports its own runs", () => {
  it("is null before the first tick, never a fabricated nothing-to-do", async () => {
    const inbox = { readDue: jest.fn() } as unknown as HouseInboxService;
    const cron = new HouseInboxCron(inbox);
    expect(cron.lastRun()).toBeNull();
  });

  it("records a thrown run as an error rather than a clean pass", async () => {
    const inbox = {
      readDue: jest.fn().mockRejectedValue(new Error("boom")),
    } as unknown as HouseInboxService;
    const cron = new HouseInboxCron(inbox);
    await cron.run();
    expect(cron.lastRun()?.error).toBe("boom");
    expect(cron.lastRun()?.mirrored).toBe(0);
  });
});
