/**
 * WHO is asking, on the letters routes — proved from the token the gateway
 * really issues, not from a hand-typed user object.
 *
 * The fault this pins (found 2026-09-12): the controller typed its caller as
 * `{ id, restaurantId }` and read `user.id`. `JwtStrategy.validate` builds
 * `request.user` with `userId` and no `id` (auth/strategies/jwt.strategy.ts),
 * so every read of `user.id` was `undefined`, and the type annotation hid it
 * from the compiler. Three consequences, each a silent falsehood:
 *
 *   1. GET /communications/letters/sender never preferred the caller's own
 *      sending grant. `mine` was always false, so a manager with their own
 *      connected mailbox was told the letter leaves from somebody else's.
 *   2. POST /communications/letters wrote `email_headers.written_by: undefined`,
 *      which JSON drops: the row names nobody, and the dispatcher, which
 *      resolves the sender from `written_by`, falls back to the first grant.
 *   3. POST /communications/letters/templates wrote `updated_by: undefined`,
 *      which supabase-js drops from the payload: an insert names nobody, and an
 *      edit silently keeps the PREVIOUS editor's name on the template.
 *
 * And the refusal: a session that names no person, or no house, is refused
 * before anything is read or written, rather than writing a nameless row.
 *
 * The principal is built by calling the real `JwtStrategy.validate`, and it is
 * handed to the controller through the real `@CurrentUser()` factory read off
 * the controller's own route metadata. If either ever changes shape, this spec
 * breaks rather than passing against a shape nothing produces.
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { JwtStrategy } from "../../auth/strategies/jwt.strategy";
import type { JwtPayload } from "../../auth/auth.service";
import type { DatabaseService } from "../../database/database.service";
import type { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { HouseLettersController } from "./house-letters.controller";
import { HouseLettersService } from "./house-letters.service";
import { GMAIL_SEND_SCOPE, HouseSenderService } from "./house-sender.service";

/**
 * The composer's two gates (ADR 0175 D9/D10, 2026-09-21), as stand-ins that
 * admit: this file is about the book, the guardrails, the identity and the
 * actor, not about who may send. house-letters-sealed.spec.ts runs the real
 * gates.
 */
const PASSING_GATES = [
  {
    assertMaySend: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
    readout: async () => ({ readable: true, maySend: true, mode: "send", basis: "manager", grant: null, sentence: null }),
    // A manager sends by role: no grant event is written (the real service returns at once for a null grant).
    witnessGrantUse: async () => undefined,
  },
  { redeem: async () => ({ sealId: "seal-1" }), issue: async () => ({ challenge: "c", expiresAt: "t", action: "queue_house_letter" }) },
] as [any, any];

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const OTHER = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

type Rows = Record<string, unknown>[] | { error: { message: string } };

/** A supabase-shaped stub addressed by table, recording every write. */
function build(rows: Record<string, Rows>) {
  const rec = {
    tables: [] as string[],
    inserts: [] as Array<{ table: string; body: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; body: Record<string, unknown> }>,
  };
  const chain = (table: string, payload: Rows) => {
    const data = Array.isArray(payload) ? payload : null;
    const error = Array.isArray(payload) ? null : payload.error;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    for (const k of ["select", "eq", "in", "is", "or", "lte", "gte", "order", "limit"]) {
      self[k] = pass;
    }
    self.insert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.update = (body: Record<string, unknown>) => {
      rec.updates.push({ table, body });
      return self;
    };
    self.single = () =>
      Promise.resolve({ data: data?.[0] ?? { id: "row-1" }, error });
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

const config = { get: () => undefined } as never;
const oauthOk = {
  getAccessToken: jest.fn().mockResolvedValue("ya29.token"),
} as unknown as IntegrationsOauthService;

/** `request.user` exactly as the gateway builds it for a signed-in manager. */
async function userFromToken(): Promise<Record<string, unknown>> {
  const strategy = new JwtStrategy({
    validateJwtPayload: jest.fn().mockResolvedValue({
      user_id: PERSON,
      email: "manager@house.test",
      name: "The Manager",
      role: "manager",
      restaurant_id: HOUSE,
      email_verified: true,
    }),
  } as never);
  const payload: JwtPayload = {
    sub: PERSON,
    email: "manager@house.test",
    role: "manager",
    restaurantId: HOUSE,
  } as JwtPayload;
  return (await strategy.validate(payload)) as Record<string, unknown>;
}

/**
 * Hand `requestUser` to a handler through the controller's REAL `@CurrentUser()`
 * factory, so the argument is what Nest would pass, not what a test assumes.
 */
function asNestWould(
  handler: keyof HouseLettersController,
  requestUser: Record<string, unknown> | undefined,
): unknown {
  const meta = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    HouseLettersController,
    handler as string,
  ) as Record<string, { index: number; factory?: (...args: unknown[]) => unknown; data?: unknown }>;
  const entry = Object.values(meta).find(
    (m) => typeof m.factory === "function" && m.index === 0,
  );
  if (!entry?.factory) {
    throw new Error(`${String(handler)} takes no @CurrentUser() at index 0`);
  }
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user: requestUser }) }),
  };
  return entry.factory(entry.data, ctx);
}

function controllerOver(rows: Record<string, Rows>) {
  const { rec, db } = build(rows);
  const sender = new HouseSenderService(db, config);
  const letters = new HouseLettersService(db, sender, oauthOk, ...PASSING_GATES);
  const cron = { lastRun: jest.fn(() => null) };
  const inboxCron = { lastRun: jest.fn(() => null) };
  const inbox = { statusFor: jest.fn(async () => ({})) };
  const controller = new HouseLettersController(
    letters,
    sender,
    cron as never,
    inboxCron as never,
    inbox as never,
  );
  return { rec, controller, letters, sender, inbox };
}

const grant = (userId: string, id: string, email: string) => ({
  id,
  user_id: userId,
  integration_id: "gmail_send",
  provider: "google",
  account_email: email,
  scopes: [GMAIL_SEND_SCOPE],
  restaurant_id: HOUSE,
  revoked_at: null,
});

const BOOK_ROWS = {
  providers: [
    {
      id: PROVIDER,
      name: "Fikri Tarım Gıda",
      contact_email: "fikri@fikritarim.com",
      primary_contact: null,
    },
  ],
  provider_contacts: [],
};

const DRAFT = {
  providerId: PROVIDER,
  to: "fikri@fikritarim.com",
  subject: "Standing order",
  body: "Merhaba, geçen haftanın teslimatını konuşabilir miyiz?",
};

// ===========================================================================
// The caller is the person the token names
// ===========================================================================

describe("the letters routes read the caller from the token the gateway issues", () => {
  it("GET /sender prefers the CALLER's own sending grant over another member's", async () => {
    // Another member's grant is listed FIRST, so a missing caller id falls
    // through to it. The caller's own grant is second.
    const { controller } = controllerOver({
      integration_oauth_connections: [
        grant(OTHER, "conn-other", "other@house.test"),
        grant(PERSON, "conn-mine", "mine@house.test"),
      ],
      users: [{ name: "Somebody Else" }],
    });
    const user = asNestWould("senderIdentity", await userFromToken());

    const out = (await controller.senderIdentity(user as never)) as {
      grant: { personUserId: string; connectionId: string } | null;
      words: string;
    };

    expect(out.grant?.personUserId).toBe(PERSON);
    expect(out.grant?.connectionId).toBe("conn-mine");
    expect(out.words).toContain("your own connected mailbox");
  });

  it("POST /letters writes the WRITER onto the row, and it survives serialisation", async () => {
    const { rec, controller } = controllerOver({
      ...BOOK_ROWS,
      integration_oauth_connections: [grant(PERSON, "conn-mine", "mine@house.test")],
      analytics_insights: [],
    });
    const user = asNestWould("queue", await userFromToken());

    await controller.queue(user as never, DRAFT as never);

    const row = rec.inserts.find((i) => i.table === "procurement_conversations");
    expect(row).toBeDefined();
    // supabase-js sends JSON. `undefined` is dropped on the wire, so the claim
    // is checked on what would actually be sent, not on the in-memory object.
    const onTheWire = JSON.parse(JSON.stringify(row!.body)) as {
      email_headers: Record<string, unknown>;
    };
    expect(onTheWire.email_headers.written_by).toBe(PERSON);
  });

  it("POST /letters/templates writes the EDITOR onto the template", async () => {
    const { rec, controller } = controllerOver({});
    const user = asNestWould("upsertTemplate", await userFromToken());

    await controller.upsertTemplate(user as never, {
      name: "Price check",
      body: "Hello {{vendor_name}}",
      category: "price_query",
    } as never);

    const row = rec.inserts.find((i) => i.table === "communication_templates");
    expect(row).toBeDefined();
    const onTheWire = JSON.parse(JSON.stringify(row!.body)) as Record<string, unknown>;
    expect(onTheWire.updated_by).toBe(PERSON);
  });
});

// ===========================================================================
// A session that names nobody is refused, before anything is read or written
// ===========================================================================

describe("a session that names no person or no house is refused, never recorded", () => {
  const handlers: Array<{
    name: keyof HouseLettersController;
    call: (c: HouseLettersController, u: unknown) => Promise<unknown>;
  }> = [
    { name: "senderIdentity", call: (c, u) => c.senderIdentity(u as never) },
    { name: "book", call: (c, u) => c.book(u as never) },
    { name: "queued", call: (c, u) => c.queued(u as never) },
    { name: "templates", call: (c, u) => c.templates(u as never) },
    {
      name: "upsertTemplate",
      call: (c, u) =>
        c.upsertTemplate(u as never, {
          name: "x",
          body: "y",
          category: "price_query",
        } as never),
    },
    { name: "queue", call: (c, u) => c.queue(u as never, DRAFT as never) },
    {
      name: "cancel",
      call: (c, u) => c.cancel(u as never, "11111111-0000-4000-8000-111111111111"),
    },
  ];

  const rows = {
    ...BOOK_ROWS,
    integration_oauth_connections: [grant(OTHER, "conn-other", "other@house.test")],
    analytics_insights: [],
  };

  it.each(handlers.map((h) => [h.name, h] as const))(
    "%s refuses a session with no user id, and touches no table",
    async (_name, h) => {
      const { rec, controller } = controllerOver(rows);
      const principal = { ...(await userFromToken()) };
      delete principal.userId;
      const user = asNestWould(h.name, principal);

      await expect(h.call(controller, user)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(rec.tables).toEqual([]);
      expect(rec.inserts).toEqual([]);
      expect(rec.updates).toEqual([]);
    },
  );

  it.each(handlers.map((h) => [h.name, h] as const))(
    "%s refuses a session with no restaurant, and touches no table",
    async (_name, h) => {
      const { rec, controller } = controllerOver(rows);
      const principal = { ...(await userFromToken()), restaurantId: null };
      const user = asNestWould(h.name, principal);

      await expect(h.call(controller, user)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(rec.tables).toEqual([]);
      expect(rec.inserts).toEqual([]);
    },
  );

  it("refuses a request that reached the handler with no user at all", async () => {
    const { rec, controller } = controllerOver(rows);
    const user = asNestWould("queue", undefined);

    await expect(controller.queue(user as never, DRAFT as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(rec.inserts).toEqual([]);
  });
});

// ===========================================================================
// The writer refuses too, whoever calls it
// ===========================================================================

describe("the letters service will not write a row that names nobody", () => {
  it("queue() refuses a blank writer before reading the book or writing the row", async () => {
    const { rec, letters } = controllerOver({
      ...BOOK_ROWS,
      integration_oauth_connections: [grant(OTHER, "conn-other", "other@house.test")],
      analytics_insights: [],
    });

    for (const userId of ["", "   ", undefined as unknown as string]) {
      await expect(
        letters.queue({ restaurantId: HOUSE, userId, dto: DRAFT as never }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(rec.tables).toEqual([]);
    expect(rec.inserts).toEqual([]);
  });

  it("upsertTemplate() refuses a blank editor before writing", async () => {
    const { rec, letters } = controllerOver({});

    for (const userId of ["", undefined as unknown as string]) {
      await expect(
        letters.upsertTemplate({
          restaurantId: HOUSE,
          userId,
          dto: { name: "x", body: "y", category: "price_query" } as never,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(rec.inserts).toEqual([]);
    expect(rec.updates).toEqual([]);
  });
});
