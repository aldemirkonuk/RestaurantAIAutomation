/**
 * POST /communications/email — two doors, both locked (ADR 0149 #19).
 *
 * Proved at the HTTP seam, over a real socket on 127.0.0.1, with:
 *   - the REAL RelayDoorGuard, the REAL JwtAuthGuard it extends, and the REAL
 *     JwtStrategy (passport verifies a signature made with @nestjs/jwt) — only
 *     AuthService.validateJwtPayload and the token blacklist are stubbed;
 *   - the REAL ServiceKeyGuard reading ADMIN_API_KEY;
 *   - the REAL RelayEmailService, HouseLettersService.book/guardrails and
 *     OrganizationsService.resolveRestaurantRole, running their own queries;
 *   - a global ValidationPipe with main.ts's options.
 *
 * What is stubbed is the edge: the database (an in-memory client that HONOURS
 * `.eq` / `.in` / `.is`, so a query missing its house filter returns the other
 * house's row exactly as PostgREST would) and Gmail's transport. Since the
 * 2026-09-17 review the REAL GmailService.sendEmail runs — it builds the MIME
 * message and base64url-encodes it — and only `users.messages.send` is a stub
 * that keeps the raw message, so a case can parse exactly what would leave.
 * `gmail.sendEmail` is a jest.fn that calls through to it, so "the provider was
 * never called" is still asserted on the one method the relay calls.
 *
 * Every refusal case asserts two things: the status and sentence, AND that the
 * provider was never called.
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { DatabaseService } from "../../database/database.service";
import { AuthService } from "../../auth/auth.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { JwtStrategy } from "../../auth/strategies/jwt.strategy";
import { TokenBlacklistService } from "../../auth/services/token-blacklist.service";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { OrganizationsService } from "../../organizations/organizations.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { GmailService } from "../gmail.service";
import { HouseLettersService } from "../letters/house-letters.service";
import { HouseSenderService, GMAIL_SEND_SCOPE } from "../letters/house-sender.service";
import { RelayEmailController } from "./relay-email.controller";
import {
  HOUSE_MAILBOX_NOT_CONNECTED,
  RelayEmailService,
  RELAY_AUDIT_ACTIONS,
} from "./relay-email.service";
import {
  SEND_EMAIL_BODY_HTML_MAX,
  SEND_EMAIL_BODY_TEXT_MAX,
} from "../dto/communication.dto";
import { RelayDoorGuard } from "./relay-door.guard";
import { RelayEmailCron } from "./relay-email.cron";

const SECRET = "relay-doors-spec-secret-not-the-published-default";
const ADMIN_KEY = "relay-doors-spec-admin-key";

const HOUSE_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const PROVIDER_A = "cccccccc-0000-4000-8000-cccccccccccc";
const PROVIDER_B = "cccccccc-1111-4111-8111-cccccccccccc";
/** A second vendor of HOUSE_A. */
const PROVIDER_A2 = "cccccccc-2222-4222-8222-cccccccccccc";
const CONVO_A = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const CONVO_B = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const ORDER_A = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const ORDER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
/** HOUSE_A's order with PROVIDER_A2, not PROVIDER_A. */
const ORDER_A_OTHER_VENDOR = "bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb";

const OWNER_A = "11111111-0000-4000-8000-111111111111";
const MANAGER_A = "22222222-0000-4000-8000-222222222222";
const STAFF_A = "33333333-0000-4000-8000-333333333333";
/** `users.role` says owner; this house's access row says staff. */
const OWNER_ELSEWHERE_STAFF_HERE = "44444444-0000-4000-8000-444444444444";

/** What the orchestrator sends — the Python test asserts it builds exactly this. */
const ORCHESTRATOR_SEND = JSON.parse(
  readFileSync(join(__dirname, "orchestrator-send.fixture.json"), "utf8"),
);

type Row = Record<string, any>;

function seed(): Record<string, Row[]> {
  return {
    users: [
      { user_id: OWNER_A, email: "owner@house-a.example", role: "owner", restaurant_id: HOUSE_A, email_verified: true, name: "Owner A" },
      { user_id: MANAGER_A, email: "manager@house-a.example", role: "manager", restaurant_id: HOUSE_A, email_verified: true, name: "Manager A" },
      { user_id: STAFF_A, email: "staff@house-a.example", role: "staff", restaurant_id: HOUSE_A, email_verified: true, name: "Staff A" },
      { user_id: OWNER_ELSEWHERE_STAFF_HERE, email: "roamer@house-b.example", role: "owner", restaurant_id: HOUSE_B, email_verified: true, name: "Roamer" },
    ],
    user_restaurant_access: [
      { user_id: OWNER_A, restaurant_id: HOUSE_A, role: "owner", is_active: true },
      { user_id: MANAGER_A, restaurant_id: HOUSE_A, role: "manager", is_active: true },
      { user_id: STAFF_A, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      { user_id: OWNER_ELSEWHERE_STAFF_HERE, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      { user_id: OWNER_ELSEWHERE_STAFF_HERE, restaurant_id: HOUSE_B, role: "owner", is_active: true },
    ],
    providers: [
      { id: PROVIDER_A, name: "Vendor One", restaurant_id: HOUSE_A, deleted_at: null, contact_email: null, primary_contact: { name: "Ana", email: "orders@vendor-one.example" } },
      { id: PROVIDER_B, name: "Vendor Two", restaurant_id: HOUSE_B, deleted_at: null, contact_email: "sales@vendor-two.example", primary_contact: {} },
      { id: PROVIDER_A2, name: "Vendor Three", restaurant_id: HOUSE_A, deleted_at: null, contact_email: "hello@vendor-three.example", primary_contact: {} },
    ],
    provider_contacts: [
      { provider_id: PROVIDER_A, name: "Billing", email: "billing@vendor-one.example" },
    ],
    procurement_conversations: [
      { id: CONVO_A, restaurant_id: HOUSE_A, provider_id: PROVIDER_A, order_id: ORDER_A },
      { id: CONVO_B, restaurant_id: HOUSE_B, provider_id: PROVIDER_B, order_id: ORDER_B },
    ],
    procurement_orders: [
      { id: ORDER_A, restaurant_id: HOUSE_A, provider_id: PROVIDER_A },
      { id: ORDER_B, restaurant_id: HOUSE_B, provider_id: PROVIDER_B },
      { id: ORDER_A_OTHER_VENDOR, restaurant_id: HOUSE_A, provider_id: PROVIDER_A2 },
    ],
    communication_templates: [],
    integration_oauth_connections: [],
    restaurant_feature_flags: [],
    system_audit_log: [],
    relay_email_queue: [],
  };
}

/**
 * Per-test knobs: a table whose reads fail, an insert that fails, and —
 * since `users` is read for two different reasons on the person door (the
 * roster's addresses, and the acting person's own name) — a predicate keyed
 * on the columns selected, so a test can fail one of those two reads without
 * also failing the other.
 */
const knobs: {
  failRead: Record<string, string>;
  failReadIf: ((table: string, columns: string | undefined) => string | null) | null;
  failInsert: ((table: string, row: Row) => string | null) | null;
  failUpdate: ((table: string) => string | null) | null;
} = { failRead: {}, failReadIf: null, failInsert: null, failUpdate: null };

let tables: Record<string, Row[]> = seed();

function client() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let selected: string | undefined;
      let updating = false;
      let updateSelected = false;
      let patch: Row | null = null;
      let mutated: Row[] | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const failure = () => {
        if (knobs.failRead[table]) return { message: knobs.failRead[table] };
        const message = knobs.failReadIf?.(table, selected) ?? null;
        return message ? { message } : null;
      };
      // Applied at most once per built query, the same way a real `.update()`
      // commits once no matter how many terminal methods a caller chains.
      const applyUpdate = () => {
        if (mutated) return mutated;
        mutated = rows();
        for (const r of mutated) Object.assign(r, patch);
        return mutated;
      };
      const resolved = (): { data: Row[] | null; error: { message: string } | null } => {
        if (updating) {
          const message = knobs.failUpdate?.(table) ?? null;
          if (message) return { data: null, error: { message } };
          // The write itself always lands — a real UPDATE commits whether or
          // not the caller reads its result back — so the mutation runs
          // unconditionally. Only the RESPONSE's `data` depends on whether
          // `.select()` was chained: in `@supabase/postgrest-js` 2.103.0,
          // only `select()` appends `Prefer: return=representation`; an
          // unselected update answers `data: null` even though the row
          // changed. A caller that trusts `.length` on that `null` must be
          // caught by this double the same way production would refuse it.
          const patched = applyUpdate();
          return { data: updateSelected ? patched : null, error: null };
        }
        const error = failure();
        return error ? { data: null, error } : { data: rows(), error: null };
      };
      const q: any = {
        select: (cols?: string) => {
          selected = cols;
          if (updating) updateSelected = true;
          return q;
        },
        order: () => q,
        limit: () => q,
        eq: (col: string, v: unknown) => {
          filters.push((r) => r[col] === v);
          return q;
        },
        in: (col: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[col]));
          return q;
        },
        is: (col: string, v: unknown) => {
          filters.push((r) => (r[col] ?? null) === v);
          return q;
        },
        lte: (col: string, v: unknown) => {
          filters.push((r) => new Date(String(r[col])).getTime() <= new Date(String(v)).getTime());
          return q;
        },
        update: (p: Row) => {
          updating = true;
          patch = p;
          return q;
        },
        maybeSingle: async () => {
          const { data, error } = resolved();
          return error ? { data: null, error } : { data: (data ?? [])[0] ?? null, error: null };
        },
        single: async () => {
          const { data, error } = resolved();
          if (error) return { data: null, error };
          const r = (data ?? [])[0];
          return r ? { data: r, error: null } : { data: null, error: { message: "no row" } };
        },
        then: (resolve: any, reject: any) => Promise.resolve(resolved()).then(resolve, reject),
        insert: (row: Row) => {
          const message = knobs.failInsert?.(table, row) ?? null;
          if (!message) (tables[table] ??= []).push(row);
          return Promise.resolve({ data: null, error: message ? { message } : null });
        },
      };
      return q;
    },
  };
}

const db = {
  get client() {
    return client();
  },
  get supabase() {
    return client();
  },
  getClient: () => client(),
};

/**
 * The REAL GmailService, with Gmail's transport as the only stub: the OAuth
 * handshake is marked done and `users.messages.send` keeps the raw message it
 * is handed. Everything between the relay and that call — the MIME build and
 * its encoding — is the code that ships.
 */
const transport: { sent: Array<{ raw: string; threadId?: string }> } = { sent: [] };
const realGmail = new GmailService(new ConfigService({}));
Object.assign(realGmail as any, {
  senderEmail: "letters@mudavym.example",
  isConfigured: true,
  gmail: {
    users: {
      messages: {
        send: async ({ requestBody }: { requestBody: { raw: string; threadId?: string } }) => {
          transport.sent.push(requestBody);
          return { data: { id: "gmail-msg-1", threadId: "gmail-thread-1" } };
        },
      },
    },
  },
});

const gmail = {
  sendEmail: jest.fn(),
  getSenderEmail: () => realGmail.getSenderEmail(),
};

/**
 * The house-grant transport's own network edge. `HouseSenderService` (real,
 * below) and `sendThroughGrant` (real, imported nowhere here — RelayEmailService
 * calls it directly) both stay real; only the OAuth token mint and Gmail's own
 * HTTP endpoint are stubs, matching how `gmail.sendEmail` above stubs only
 * `users.messages.send`.
 */
const oauthMock = {
  getAccessToken: jest.fn(async () => "ya29.grant-token"),
};
const grantSent: Array<{ url: string; init: RequestInit }> = [];
const realFetch = globalThis.fetch;
/**
 * Global `fetch` is also what `post()` below uses to drive the app's own HTTP
 * server, so this cannot replace it wholesale the way `dispatchDue`'s spec
 * does (house-letters.spec.ts) — that spec calls the service directly, with
 * no HTTP layer of its own in the way. Only Gmail's own endpoint is stubbed;
 * everything else (the test's own request to 127.0.0.1) still reaches the
 * real fetch.
 */
function stubGrantFetch(
  respond: (url: string, init: RequestInit) => Promise<unknown>,
) {
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init: RequestInit,
  ) => {
    if (typeof url === "string" && url.includes("gmail.googleapis.com")) {
      grantSent.push({ url, init });
      return respond(url, init);
    }
    return (realFetch as unknown as (u: string, i: RequestInit) => Promise<unknown>)(url, init);
  };
}

/**
 * RFC 2046 §5.1.1, read the way a mail client reads it: the boundary comes
 * from the top-level Content-Type; a line that is `--boundary` (transport
 * padding allowed) opens a part, `--boundary--` closes the multipart, and
 * everything after the close is epilogue that no client renders. A part's body
 * is decoded by its own Content-Transfer-Encoding.
 */
function parseMime(raw: string) {
  const split = raw.indexOf("\r\n\r\n");
  const headerMap = (block: string) => {
    const out: Record<string, string> = {};
    for (const line of block.replace(/\r\n[ \t]/g, " ").split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return out;
  };
  const headers = headerMap(raw.slice(0, split));
  const boundary = /boundary="([^"]+)"/.exec(headers["content-type"] ?? "")?.[1] ?? "";
  const partsLines: string[][] = [];
  let current: string[] | null = null;
  for (const line of raw.slice(split + 4).split("\r\n")) {
    const bare = line.trimEnd();
    if (bare === `--${boundary}--`) {
      if (current) partsLines.push(current);
      current = null;
      break;
    }
    if (bare === `--${boundary}`) {
      if (current) partsLines.push(current);
      current = [];
      continue;
    }
    if (current) current.push(line);
  }
  const parts = partsLines.map((lines) => {
    const blank = lines.indexOf("");
    const h = headerMap(lines.slice(0, blank).join("\r\n"));
    const bodyLines = lines.slice(blank + 1);
    const body = bodyLines.join("\r\n");
    const encoding = (h["content-transfer-encoding"] ?? "").toLowerCase();
    return {
      contentType: h["content-type"],
      encoding,
      bodyLines,
      decoded:
        encoding === "base64" ? Buffer.from(bodyLines.join(""), "base64").toString("utf8") : body,
    };
  });
  return { headers, boundary, parts };
}

const lastMime = () => {
  expect(transport.sent).toHaveLength(1);
  return parseMime(Buffer.from(transport.sent[0].raw, "base64url").toString("utf8"));
};

let app: INestApplication;
let base: string;
/** The REAL RelayEmailService instance the app's own DI graph wires up —
 *  `dispatchQueued` is called directly, the way `RelayEmailCron` calls it,
 *  since this suite proves the HTTP seam and the cron is a one-line wrapper
 *  around this same method (relay-email.cron.ts). */
let relay: RelayEmailService;
const jwt = new JwtService({ secret: SECRET });

function tokenFor(userId: string, restaurantId: string): string {
  const u = tables.users.find((r) => r.user_id === userId)!;
  return jwt.sign({ sub: userId, email: u.email, role: u.role, restaurantId });
}

async function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/communications/email`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* kept as text */
  }
  return { status: res.status, body: parsed };
}

async function cancelQueued(
  id: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/communications/email/${id}/cancel`, {
    method: "POST",
    headers,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* kept as text */
  }
  return { status: res.status, body: parsed };
}

const asService = { "x-admin-key": ADMIN_KEY };
const asPerson = (userId: string, house = HOUSE_A) => ({
  authorization: `Bearer ${tokenFor(userId, house)}`,
});
const audit = () => tables.system_audit_log;
const actions = () => audit().map((r) => r.action);

const ORIGINAL_ENV = {
  JWT_SECRET: process.env.JWT_SECRET,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
};

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  process.env.ADMIN_API_KEY = ADMIN_KEY;

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
    controllers: [RelayEmailController],
    providers: [
      RelayEmailService,
      RelayDoorGuard,
      // Exercised for real by `POST /communications/email/:id/cancel`,
      // which carries no `@Public()` — unlike `sendEmail`, where RelayDoorGuard
      // always stands in front of it (@Public() makes this class-level guard
      // stand aside there). Registered explicitly rather than left to Nest's
      // implicit resolution, same reasoning as RelayDoorGuard just above.
      JwtAuthGuard,
      HouseLettersService,
      OrganizationsService,
      JwtStrategy,
      { provide: DatabaseService, useValue: db },
      { provide: GmailService, useValue: gmail },
      // REAL — since 2026-09-17 the person door resolves the house's own
      // sending identity through it, the same resolver the letters composer
      // uses (ADR 0118). Only the OAuth token mint is a stub (oauthMock,
      // below); `resolve()` itself runs its real query against `db`.
      HouseSenderService,
      { provide: IntegrationsOauthService, useValue: oauthMock },
      {
        provide: AuthService,
        useValue: {
          validateJwtPayload: async (p: { sub: string }) =>
            tables.users.find((u) => u.user_id === p.sub) ?? null,
        },
      },
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
    ],
  }).compile();

  relay = moduleRef.get(RelayEmailService);
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  // main.ts's body limit: without it express's 100 kB default answers 413 long
  // before the DTO's own limits could be seen.
  (app as NestExpressApplication).useBodyParser("json", { limit: "15mb" });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
});

beforeEach(() => {
  tables = seed();
  knobs.failRead = {};
  knobs.failReadIf = null;
  knobs.failInsert = null;
  knobs.failUpdate = null;
  transport.sent = [];
  grantSent.length = 0;
  gmail.sendEmail.mockReset();
  gmail.sendEmail.mockImplementation((options) => realGmail.sendEmail(options));
  oauthMock.getAccessToken.mockReset();
  oauthMock.getAccessToken.mockImplementation(async () => "ya29.grant-token");
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the route's shape", () => {
  it("is decided by RelayDoorGuard: @Public() lets the class JwtAuthGuard stand aside, and the door guard is on the method", () => {
    const handler = (RelayEmailController.prototype as any).sendEmail;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(RelayDoorGuard);
  });
});

describe("no credential", () => {
  it("is 401 with no token and no key, and nothing is sent or filed", async () => {
    const res = await post(ORCHESTRATOR_SEND);
    expect(res.status).toBe(401);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(0);
  });

  it("is 401 for a bearer token not signed by this gateway", async () => {
    const forged = new JwtService({ secret: "someone-else" }).sign({
      sub: OWNER_A,
      email: "owner@house-a.example",
      role: "owner",
      restaurantId: HOUSE_A,
    });
    const res = await post(
      { to: ["orders@vendor-one.example"], subject: "hi", bodyText: "hello" },
      { authorization: `Bearer ${forged}` },
    );
    expect(res.status).toBe(401);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 401 for a wrong service key, and a wrong key never falls through to a valid bearer token", async () => {
    const res = await post(ORCHESTRATOR_SEND, {
      "x-admin-key": "not-the-key",
      ...asPerson(OWNER_A),
    });
    expect(res.status).toBe(401);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 401 on the service door when ADMIN_API_KEY is unset — the key is never optional", async () => {
    delete process.env.ADMIN_API_KEY;
    try {
      const res = await post(ORCHESTRATOR_SEND, { "x-admin-key": "" });
      expect(res.status).toBe(401);
      expect(gmail.sendEmail).not.toHaveBeenCalled();
    } finally {
      process.env.ADMIN_API_KEY = ADMIN_KEY;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the orchestrator's door", () => {
  it("sends the orchestrator's vendor mail end to end, and files an attempt row and a sent row", async () => {
    const res = await post(ORCHESTRATOR_SEND, asService);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      messageId: "gmail-msg-1",
      threadId: "gmail-thread-1",
      channel: "email",
      door: "orchestrator",
      audit: { attemptRecorded: true, outcomeRecorded: true },
    });
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["orders@vendor-one.example"],
        subject: ORCHESTRATOR_SEND.subject,
        html: ORCHESTRATOR_SEND.bodyHtml,
        threadId: "19f365aac4e6",
        inReplyTo: "<wineops-123@wineops.ai>",
        references: "<wineops-123@wineops.ai>",
      }),
    );

    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.ATTEMPTED, RELAY_AUDIT_ACTIONS.SENT]);
    const [attempt, sent] = audit();
    expect(attempt.correlation_id).toBe(res.body.audit.correlationId);
    expect(sent.correlation_id).toBe(attempt.correlation_id);
    for (const row of [attempt, sent]) {
      expect(row).toMatchObject({
        actor_type: "service",
        actor_id: null,
        restaurant_id: HOUSE_A,
        entity_type: "procurement_conversation",
        entity_id: CONVO_A,
      });
      expect(row.changes).toMatchObject({
        door: "orchestrator",
        actor: "orchestrator",
        recipients: { to: ["orders@vendor-one.example"], cc: [], bcc: [] },
        subject: ORCHESTRATOR_SEND.subject,
        providerId: PROVIDER_A,
        conversationId: CONVO_A,
        orderId: ORDER_A,
      });
    }
    expect(sent.changes).toMatchObject({
      outcome: "sent",
      messageId: "gmail-msg-1",
      threadId: "gmail-thread-1",
    });
    expect(sent.changes).not.toHaveProperty("letterId");

    // What left: the real MIME build, two base64 parts, the thread named.
    const mime = lastMime();
    expect(transport.sent[0].threadId).toBe("19f365aac4e6");
    expect(mime.headers["in-reply-to"]).toBe("<wineops-123@wineops.ai>");
    expect(mime.parts.map((p) => [p.contentType, p.encoding])).toEqual([
      ['text/plain; charset="UTF-8"', "base64"],
      ['text/html; charset="UTF-8"', "base64"],
    ]);
    expect(mime.parts[0].decoded).toBe(ORCHESTRATOR_SEND.bodyText);
    expect(mime.parts[1].decoded).toBe(ORCHESTRATOR_SEND.bodyHtml);
  });

  it("forwards a Reply-To naming a member of the house, to GmailService and into the message", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, replyTo: "manager@house-a.example" },
      asService,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "manager@house-a.example" }),
    );
    expect(lastMime().headers["reply-to"]).toBe("manager@house-a.example");
    expect(audit()[0].changes).toMatchObject({ replyTo: "manager@house-a.example" });
  });

  it("cannot be split by a body line that names the MIME boundary: what leaves is exactly the text and HTML the door checked", async () => {
    // Until 2026-09-17 the boundary was `boundary_${Date.now()}` and bodies went
    // out unencoded, so a line `--boundary_<ms>` closed the text part and
    // opened an HTML part of the caller's choosing. The clock is pinned so this
    // case names the boundary the OLD builder would have used, exactly —
    // against that builder it injects, deterministically.
    const pinned = 1758096163456;
    const injected = [
      `--boundary_${pinned}`,
      'Content-Type: text/html; charset="UTF-8"',
      "",
      '<a href="https://attacker.example/login">INJECTED-HTML</a>',
      `--boundary_${pinned}--`,
    ].join("\r\n");
    const bodyText = `Could you quote 12 bottles?\r\n${injected}`;

    const clock = jest.spyOn(Date, "now").mockReturnValue(pinned);
    let res: { status: number; body: any };
    try {
      res = await post({ ...ORCHESTRATOR_SEND, bodyText }, asService);
    } finally {
      clock.mockRestore();
    }

    expect(res.status).toBe(200);
    const mime = lastMime();
    expect(mime.boundary).not.toContain(String(pinned));
    expect(mime.parts).toHaveLength(2);
    expect(mime.parts[0].decoded).toBe(bodyText);
    expect(mime.parts[1].decoded).toBe(ORCHESTRATOR_SEND.bodyHtml);
    expect(mime.parts.some((p) => p.decoded.startsWith("<a href"))).toBe(false);
    // And no body line can ever be a delimiter, whatever the boundary is.
    for (const part of mime.parts) {
      for (const line of part.bodyLines) expect(line).toMatch(/^[A-Za-z0-9+/=]*$/);
    }
  });

  it.each([
    ["bodyText", SEND_EMAIL_BODY_TEXT_MAX],
    ["bodyHtml", SEND_EMAIL_BODY_HTML_MAX],
  ])("is 400 — before any door — for a %s longer than its limit", async (field, max) => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, [field]: "x".repeat(max + 1) },
      asService,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(new RegExp(field));
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(0);
  });

  it("admits any of the vendor's addresses in the house's book, including a provider_contacts row", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, cc: ["billing@vendor-one.example"] },
      asService,
    );
    expect(res.status).toBe(200);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("writes an attempt row and a FAILED row when the provider refuses, and says so", async () => {
    gmail.sendEmail.mockResolvedValue({
      success: false,
      error: "invalid_grant: Token has been expired or revoked.",
    });
    const res = await post(ORCHESTRATOR_SEND, asService);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: false,
      error: "invalid_grant: Token has been expired or revoked.",
      audit: { attemptRecorded: true, outcomeRecorded: true },
    });
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.ATTEMPTED, RELAY_AUDIT_ACTIONS.FAILED]);
    expect(audit()[1]).toMatchObject({
      reason: "invalid_grant: Token has been expired or revoked.",
      changes: expect.objectContaining({ outcome: "failed" }),
    });
  });

  it("records a FAILED row when the provider throws", async () => {
    gmail.sendEmail.mockRejectedValue(new Error("socket hang up"));
    const res = await post(ORCHESTRATOR_SEND, asService);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, error: "socket hang up" });
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.ATTEMPTED, RELAY_AUDIT_ACTIONS.FAILED]);
  });

  // ADR 0172 + ADR 0099, founder 2026-09-21: "a header refusal on the relay
  // path answers a FINAL 422 (not 200 success:false), so both send paths
  // behave alike and the draft closes with the reason shown." A header
  // refusal happens INSIDE dispatch()'s transport attempt (mime-headers.ts,
  // after every door and DTO check already held), so — unlike a door
  // refusal, which throws BEFORE dispatch() and is a 4xx already — it used
  // to fall into the SAME generic catch as any other transport failure and
  // answer 200 with `success: false`, indistinguishable from a genuine
  // provider outage.
  it("is 422 — not 200 — for a header refusal inside dispatch, and still records a FAILED row naming it", async () => {
    gmail.sendEmail.mockResolvedValue({
      success: false,
      error: "Could not fold the Subject header.",
      refusedBeforeSend: true,
    });
    const res = await post(ORCHESTRATOR_SEND, asService);

    expect(res.status).toBe(422);
    expect(String(res.body.message)).toMatch(/Could not fold the Subject header/);
    expect(String(res.body.message)).toMatch(/the provider was never called/);
    // The sentence is stored on the draft and shown to a manager verbatim, so
    // the encoder's own full stop must not double up with ours.
    expect(String(res.body.message)).not.toMatch(/\.\./);
    // The audit trail still tells the whole story — ATTEMPTED then FAILED,
    // with refusedBeforeSend on the record — even though the HTTP answer is
    // now a definite refusal rather than a 200.
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.ATTEMPTED, RELAY_AUDIT_ACTIONS.FAILED]);
    expect(audit()[1]).toMatchObject({
      reason: "Could not fold the Subject header.",
      changes: expect.objectContaining({
        outcome: "failed",
        refusedBeforeSend: true,
      }),
    });
  });

  it("is 200 with refusedBeforeSend unset for an ordinary transport failure — 422 is not the default", async () => {
    gmail.sendEmail.mockResolvedValue({
      success: false,
      error: "invalid_grant: Token has been expired or revoked.",
    });
    const res = await post(ORCHESTRATOR_SEND, asService);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.refusedBeforeSend).toBeUndefined();
    expect(audit()[1].changes).toMatchObject({ refusedBeforeSend: false });
  });

  it("refuses 503 and sends nothing when the attempt row cannot be written", async () => {
    knobs.failInsert = (table, row) =>
      table === "system_audit_log" && row.action === RELAY_AUDIT_ACTIONS.ATTEMPTED
        ? "permission denied for table system_audit_log"
        : null;
    const res = await post(ORCHESTRATOR_SEND, asService);
    expect(res.status).toBe(503);
    expect(String(res.body.message)).toMatch(/Nothing was sent/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("still reports a delivered mail as delivered when only the outcome row fails", async () => {
    knobs.failInsert = (table, row) =>
      table === "system_audit_log" && row.action === RELAY_AUDIT_ACTIONS.SENT
        ? "connection reset"
        : null;
    const res = await post(ORCHESTRATOR_SEND, asService);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      audit: { attemptRecorded: true, outcomeRecorded: false },
    });
  });

  it.each([
    ["the house", { restaurantId: undefined }, /house \(restaurantId\)/],
    ["the vendor", { providerId: undefined }, /vendor \(providerId\)/],
    [
      "the conversation or order",
      { conversationId: undefined, orderId: undefined },
      /conversation or order/,
    ],
  ])("is 403 when the send does not name %s", async (_what, patch, words) => {
    const res = await post({ ...ORCHESTRATOR_SEND, ...patch }, asService);
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(words);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 when the conversation is another house's, and the refusal is filed", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, conversationId: CONVO_B, orderId: undefined },
      asService,
    );
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/not one of this house's conversations/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.REFUSED]);
    expect(audit()[0]).toMatchObject({ restaurant_id: HOUSE_A, actor_type: "service" });
  });

  it("is 403 when the send names another house for this house's conversation, and files it under the house it named", async () => {
    const res = await post({ ...ORCHESTRATOR_SEND, restaurantId: HOUSE_B }, asService);
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/not one of this house's conversations/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({
      action: RELAY_AUDIT_ACTIONS.REFUSED,
      restaurant_id: HOUSE_B,
    });
  });

  it("is 403 when an order-only send names an order of this house with a different vendor, and files it against no one's order", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, conversationId: undefined, orderId: ORDER_A_OTHER_VENDOR },
      asService,
    );
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/with a different vendor from the one this mail names/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.REFUSED]);
  });

  it("is 403 when the order is another house's", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, conversationId: undefined, orderId: ORDER_B },
      asService,
    );
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/not one of this house's orders/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 when the conversation is with a different vendor from the one named", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, providerId: PROVIDER_B },
      asService,
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for a foreign recipient — in to, cc or bcc — naming the address", async () => {
    for (const patch of [
      { to: ["someone@elsewhere.example"] },
      { cc: ["someone@elsewhere.example"] },
      { bcc: ["someone@elsewhere.example"] },
      // another house's vendor is foreign to this house
      { bcc: ["sales@vendor-two.example"] },
    ]) {
      tables = seed();
      const res = await post({ ...ORCHESTRATOR_SEND, ...patch }, asService);
      expect(res.status).toBe(403);
      expect(String(res.body.message)).toMatch(/not among that vendor's addresses/);
      expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.REFUSED]);
    }
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for a Reply-To outside the house", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, replyTo: "collector@elsewhere.example" },
      asService,
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 503, not a refusal of the recipient, when the book cannot be read — and files an outage, not a refusal", async () => {
    knobs.failRead.providers = "canceling statement due to statement timeout";
    const res = await post(ORCHESTRATOR_SEND, asService);
    expect(res.status).toBe(503);
    expect(String(res.body.message)).toMatch(/could not be read/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.UNAVAILABLE]);
    expect(audit()[0].changes).toMatchObject({ outcome: "unavailable", status: 503 });
  });

  it("is 400 — before any door — for a line break in the subject, which would add a header", async () => {
    const res = await post(
      { ...ORCHESTRATOR_SEND, subject: "Order\r\nBcc: someone@elsewhere.example" },
      asService,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/single line/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the person's door", () => {
  const letter = {
    to: ["orders@vendor-one.example"],
    subject: "Delivery window",
    bodyText: "Hello Ana,\nCould Thursday work?\n\n<b>Thanks</b> & regards",
  };

  /** A refusal row carrying nothing the caller typed. */
  const expectStatusOnly = (row: Row, status: number) => {
    expect(row).toMatchObject({ entity_type: "email", entity_id: null });
    expect(Object.keys(row.changes).sort()).toEqual(["actor", "door", "outcome", "status"]);
    expect(row.changes.status).toBe(status);
    expect(JSON.stringify(row)).not.toMatch(/Delivery window|vendor-one|someone@elsewhere/);
  };

  it("refuses an owner's letter to a vendor 409 with a plain reason and a code, AFTER every lock held, when this house has no connected mailbox", async () => {
    const res = await post(letter, asPerson(OWNER_A));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(HOUSE_MAILBOX_NOT_CONNECTED);
    expect(String(res.body.message)).toMatch(/has not connected a mailbox of its own/);
    expect(String(res.body.message)).toMatch(/Nothing was sent\.$/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(transport.sent).toHaveLength(0);
    expect(grantSent).toHaveLength(0);
    expect(oauthMock.getAccessToken).not.toHaveBeenCalled();

    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.REFUSED]);
    expect(audit()[0]).toMatchObject({
      actor_type: "user",
      actor_id: OWNER_A,
      restaurant_id: HOUSE_A,
    });
    expect(String(audit()[0].reason)).toMatch(/has not connected a mailbox of its own/);
    // An owner's refusal keeps what they sent: the row is a manager's paper.
    expect(audit()[0].changes).toMatchObject({
      door: "person",
      actor: OWNER_A,
      outcome: "refused",
      status: 409,
      recipients: { to: ["orders@vendor-one.example"], cc: [], bcc: [] },
      subject: "Delivery window",
    });
  });

  it("refuses a manager's mail to a member of the house with the same 409 and code, when this house has no connected mailbox", async () => {
    const res = await post(
      { to: ["staff@house-a.example"], subject: "Rota", bodyText: "See you at six." },
      asPerson(MANAGER_A),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(HOUSE_MAILBOX_NOT_CONNECTED);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("queues — never sends — an owner's letter to a vendor through the house's own connected mailbox, naming the owner as author (founder, 2026-09-17: it queues like every other send from this mailbox)", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });

    const res = await post(letter, asPerson(OWNER_A));

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      success: true,
      sender: { kind: "house_mailbox", address: "owner@housea.gmail.example", authorName: "Owner A" },
    });
    expect(res.body.messageId).toBeUndefined();
    expect(res.body.queued).toMatchObject({ status: "HOUSE_QUEUED" });
    expect(typeof res.body.queued.id).toBe("string");
    expect(typeof res.body.queued.dispatchAt).toBe("string");
    // The SAME sentence GET /communications/letters/sender already shows for
    // this mailbox — the response never promises a recall that sentence does
    // not, per the review that forced this build.
    expect(res.body.queued.says).toMatch(/2-minute window in which it can still be pulled back/);
    expect(res.body.queued.undoMs).toBeGreaterThan(0);

    // Nothing was sent — only queued. The provider is never touched here.
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(transport.sent).toHaveLength(0);
    expect(grantSent).toHaveLength(0);
    // The token IS fetched at queue time (to fail fast on an ADR 0114
    // cutoff), but nothing is sent with it.
    expect(oauthMock.getAccessToken).toHaveBeenCalledWith(OWNER_A, HOUSE_A, "gmail_send");

    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.QUEUED]);
    expect(audit()[0]).toMatchObject({ actor_id: OWNER_A, restaurant_id: HOUSE_A });
    expect(audit()[0].changes).toMatchObject({
      outcome: "queued",
      sender: { kind: "house_mailbox", address: "owner@housea.gmail.example", authorName: "Owner A" },
    });

    expect(tables.relay_email_queue).toHaveLength(1);
    const row = tables.relay_email_queue[0];
    expect(row).toMatchObject({
      restaurant_id: HOUSE_A,
      actor_user_id: OWNER_A,
      to_addresses: ["orders@vendor-one.example"],
      subject: "Delivery window",
      sender_kind: "house_mailbox",
      sender_address: "owner@housea.gmail.example",
      author_name: "Owner A",
      status: "HOUSE_QUEUED",
    });
    // The already-signed text — what the manager approved is what will leave.
    expect(String(row.body_text)).toContain("Could Thursday work?");
    expect(String(row.body_text)).toContain("— Owner A");
    expect(row.correlation_id).toBe(audit()[0].correlation_id);
    expect(new Date(String(row.scheduled_send_at)).getTime()).toBeGreaterThan(Date.now());
  });

  it("sends the queued mail once its window has closed, through the house's own grant, and cancels the claim to HOUSE_SENDING to SENT", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    stubGrantFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "grant-msg-1" }),
      text: async () => "",
    }));

    const queued = await post(letter, asPerson(OWNER_A));
    expect(queued.status).toBe(202);
    expect(grantSent).toHaveLength(0); // still nothing sent

    // Before the window: a dispatcher tick this instant must not touch it.
    const early = await relay.dispatchQueued(Date.now());
    expect(early).toEqual({ considered: 0, sent: 0, failed: 0, skipped: 0, statusUpdateErrors: 0 });
    expect(grantSent).toHaveLength(0);
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_QUEUED");

    // After the window: the dispatcher sends it, through the SAME house
    // grant transport, never GmailService.
    const dueAt = Date.now() + queued.body.queued.undoMs + 1000;
    const run = await relay.dispatchQueued(dueAt);
    expect(run).toEqual({ considered: 1, sent: 1, failed: 0, skipped: 0, statusUpdateErrors: 0 });

    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(grantSent).toHaveLength(1);
    const decoded = Buffer.from(
      JSON.parse(String(grantSent[0].init.body)).raw as string,
      "base64url",
    ).toString("utf8");
    expect(decoded).toContain("From: owner@housea.gmail.example");
    expect(decoded).toContain("To: orders@vendor-one.example");
    expect(decoded).toContain("Subject: Delivery window");
    // The body is base64 under its UTF-8 charset since ADR 0172 (origin/main,
    // merged 2026-09-21), so the letter is read from the decoded part.
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    const letterText = Buffer.from(
      decoded.split("\r\n\r\n")[1],
      "base64",
    ).toString("utf8");
    expect(letterText).toContain("Could Thursday work?");
    expect(letterText).toContain("— Owner A");

    const row = tables.relay_email_queue[0];
    expect(row.status).toBe("SENT");
    expect(row.gmail_message_id).toBe("grant-msg-1");
    expect(row.scheduled_send_at).toBeNull();

    // The whole lifecycle shares one correlation_id: queued, then attempted,
    // then sent — never three unrelated rows.
    expect(actions()).toEqual([
      RELAY_AUDIT_ACTIONS.QUEUED,
      RELAY_AUDIT_ACTIONS.ATTEMPTED,
      RELAY_AUDIT_ACTIONS.SENT,
    ]);
    const [queuedRow, attemptedRow, sentRow] = audit();
    expect(attemptedRow.correlation_id).toBe(queuedRow.correlation_id);
    expect(sentRow.correlation_id).toBe(queuedRow.correlation_id);
    expect(sentRow.changes).toMatchObject({ outcome: "sent", messageId: "grant-msg-1" });

    // A second tick has nothing left to do.
    const again = await relay.dispatchQueued(dueAt);
    expect(again).toEqual({ considered: 0, sent: 0, failed: 0, skipped: 0, statusUpdateErrors: 0 });
  });

  it("the undo cancels a queued send inside the window, and the dispatcher then leaves it alone", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });

    const queued = await post(letter, asPerson(OWNER_A));
    expect(queued.status).toBe(202);
    const id = queued.body.queued.id as string;

    const cancelled = await cancelQueued(id, asPerson(OWNER_A));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id, status: "HOUSE_CANCELLED" });
    expect(tables.relay_email_queue[0]).toMatchObject({
      status: "HOUSE_CANCELLED",
      scheduled_send_at: null,
    });

    // The dispatcher, run well past the original window, must not send it.
    const dueAt = Date.now() + queued.body.queued.undoMs + 60_000;
    const run = await relay.dispatchQueued(dueAt);
    expect(run).toEqual({ considered: 0, sent: 0, failed: 0, skipped: 0, statusUpdateErrors: 0 });
    expect(grantSent).toHaveLength(0);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_CANCELLED");
  });

  it("refuses to cancel a send whose window has already closed", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    const queued = await post(letter, asPerson(OWNER_A));
    const id = queued.body.queued.id as string;
    tables.relay_email_queue[0].scheduled_send_at = new Date(Date.now() - 1000).toISOString();

    const res = await cancelQueued(id, asPerson(OWNER_A));
    expect(res.status).toBe(409);
    expect(String(res.body.message)).toMatch(/window has closed/);
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_QUEUED");
  });

  it("cancelling someone else's house's queued send is a 404, not a peek at another house's row", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    const queued = await post(letter, asPerson(OWNER_A));
    const id = queued.body.queued.id as string;

    const res = await cancelQueued(id, asPerson(OWNER_ELSEWHERE_STAFF_HERE, HOUSE_B));
    expect(res.status).toBe(404);
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_QUEUED");
  });

  it("is 403, not a state check, when someone other than the author tries to pull it back (founder, 2026-09-18, ADR 0149 row 43: cancel is the author's alone)", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    const queued = await post(letter, asPerson(OWNER_A));
    const id = queued.body.queued.id as string;

    // MANAGER_A is a real member of the SAME house — this is not the 404
    // "another house's row" case, it is the same house's own manager reaching
    // for a colleague's queued send.
    const res = await cancelQueued(id, asPerson(MANAGER_A));
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/Only the person who queued this send/);
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_QUEUED");

    // The author themself still can.
    const ownCancel = await cancelQueued(id, asPerson(OWNER_A));
    expect(ownCancel.status).toBe(200);
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_CANCELLED");
  });

  it("a cancel that reaches the row after the dispatcher's own claim is refused, not answered as pulled back", async () => {
    // The read sees a still-HOUSE_QUEUED row (the state a caller's own
    // request read an instant before), but the guarded update matches
    // nothing because the dispatcher's claim (HOUSE_QUEUED -> HOUSE_SENDING)
    // landed first — exactly the TOCTOU window between cancelQueued's own
    // select and its update. Built directly against a purpose-made db double
    // rather than the shared harness above: that harness's filters are
    // re-evaluated per call, which cannot express "the read and the update
    // disagree" without a real second actor racing it.
    const row = {
      id: "row-1",
      status: "HOUSE_QUEUED",
      scheduled_send_at: new Date(Date.now() + 60_000).toISOString(),
      restaurant_id: HOUSE_A,
      actor_user_id: OWNER_A,
    };
    const raceDb = {
      client: {
        from: () => {
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          chain.eq = () => chain;
          chain.maybeSingle = async () => ({ data: { ...row }, error: null });
          chain.update = () => chain;
          chain.then = (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
          return chain;
        },
      },
    } as unknown as DatabaseService;
    const none = {} as never;
    const raced = new RelayEmailService(raceDb, none, none, none, none, none);

    await expect(
      raced.cancelQueued({ restaurantId: HOUSE_A, userId: OWNER_A, id: "row-1" }),
    ).rejects.toThrow(ConflictException);
    await raced
      .cancelQueued({ restaurantId: HOUSE_A, userId: OWNER_A, id: "row-1" })
      .catch((e) => {
        expect(String(e.message)).toMatch(/claimed by the dispatcher/);
      });
  });

  it("dispatches to HOUSE_FAILED, not stuck HOUSE_SENDING, when the mailbox is revoked between queuing and the window closing", async () => {
    const connection: Row & { revoked_at: string | null } = {
      id: "dddddddd-4444-4444-8444-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    };
    tables.integration_oauth_connections.push(connection);

    const queued = await post(letter, asPerson(OWNER_A));
    expect(queued.status).toBe(202);

    // Revoked inside the window — the exact reason dispatchQueued
    // RE-RESOLVES the identity from actor_user_id rather than trusting what
    // sendAsPerson denormalised at queue time (the migration's own header).
    connection.revoked_at = new Date().toISOString();

    const run = await relay.dispatchQueued(
      Date.now() + queued.body.queued.undoMs + 1000,
    );
    expect(run).toEqual({
      considered: 1,
      sent: 0,
      failed: 1,
      skipped: 0,
      statusUpdateErrors: 0,
    });

    // The provider is never reached: the identity re-resolve refuses before
    // dispatch() ever calls sendThroughHouseGrant.
    expect(grantSent).toHaveLength(0);
    expect(gmail.sendEmail).not.toHaveBeenCalled();

    const row = tables.relay_email_queue[0];
    expect(row.status).toBe("HOUSE_FAILED");
    expect(row.scheduled_send_at).toBeNull();
    expect(String(row.failure_reason)).toMatch(/has not connected a mailbox of its own/);

    expect(actions()).toEqual([
      RELAY_AUDIT_ACTIONS.QUEUED,
      RELAY_AUDIT_ACTIONS.ATTEMPTED,
      RELAY_AUDIT_ACTIONS.FAILED,
    ]);
    const [queuedRow, attemptedRow, failedRow] = audit();
    expect(attemptedRow.correlation_id).toBe(queuedRow.correlation_id);
    expect(failedRow.correlation_id).toBe(queuedRow.correlation_id);
    expect(failedRow.changes).toMatchObject({ outcome: "failed" });
  });

  it("counts a stuck HOUSE_SENDING row, never a clean send, when the SENT write itself fails after the provider already sent it (confirmer B2, wave5)", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-5555-4555-8555-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    stubGrantFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "grant-msg-stuck-sent" }),
      text: async () => "",
    }));

    const queued = await post(letter, asPerson(OWNER_A));
    expect(queued.status).toBe(202);
    const dueAt = Date.now() + queued.body.queued.undoMs + 1000;

    // knobs.failUpdate fails EVERY update on the table, the claim included,
    // so a call counter is used to fail only the SECOND update on this row
    // — the SENT write — never the first, which is dispatchQueued's own
    // claim (HOUSE_QUEUED -> HOUSE_SENDING).
    let relayQueueUpdates = 0;
    knobs.failUpdate = (table) => {
      if (table !== "relay_email_queue") return null;
      relayQueueUpdates += 1;
      return relayQueueUpdates === 2
        ? "simulated: the SENT write lost its connection"
        : null;
    };

    // Driven through the cron itself, once, so `lastRun()` is THIS run's own
    // result rather than a second, separate tick over an already-stuck
    // (nothing left due) queue. `RelayEmailCron.run()` always calls
    // `dispatchQueued()` with no argument (real `Date.now()`), so `Date.now`
    // is stubbed for this one call to reach the same simulated "now" the
    // rest of this suite reaches by passing `dueAt` directly.
    const cron = new RelayEmailCron(relay);
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(dueAt);
    try {
      await cron.run();
    } finally {
      dateSpy.mockRestore();
    }

    expect(cron.lastRun()).toMatchObject({
      error: null,
      considered: 1,
      sent: 0,
      failed: 0,
      skipped: 0,
      statusUpdateErrors: 1,
    });

    // The provider WAS reached — this is not a failed send, it is a send
    // that could not be RECORDED as one, which is why it must never be
    // folded into `sent`.
    expect(grantSent).toHaveLength(1);
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_SENDING");
  });

  it("counts a stuck HOUSE_SENDING row, never a recorded failure, when the HOUSE_FAILED write itself fails (confirmer B2, wave5)", async () => {
    const connection: Row & { revoked_at: string | null } = {
      id: "dddddddd-6666-4666-8666-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    };
    tables.integration_oauth_connections.push(connection);

    const queued = await post(letter, asPerson(OWNER_A));
    expect(queued.status).toBe(202);
    // Revoked inside the window, same as the HOUSE_FAILED test above — the
    // provider is never reached, so this row fails for a reason unrelated
    // to the status write we are about to break.
    connection.revoked_at = new Date().toISOString();
    const dueAt = Date.now() + queued.body.queued.undoMs + 1000;

    let relayQueueUpdates = 0;
    knobs.failUpdate = (table) => {
      if (table !== "relay_email_queue") return null;
      relayQueueUpdates += 1;
      return relayQueueUpdates === 2
        ? "simulated: the HOUSE_FAILED write lost its connection"
        : null;
    };

    const cron = new RelayEmailCron(relay);
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(dueAt);
    try {
      await cron.run();
    } finally {
      dateSpy.mockRestore();
    }

    expect(cron.lastRun()).toMatchObject({
      error: null,
      considered: 1,
      sent: 0,
      failed: 0,
      skipped: 0,
      statusUpdateErrors: 1,
    });
    expect(tables.relay_email_queue[0].status).toBe("HOUSE_SENDING");
  });

  it("is 503, not unsigned, when the author's own name cannot be read — and sends nothing", async () => {
    // The mailbox is connected and would otherwise send fine; only the
    // `users` read for the acting person's OWN name fails (not the roster's
    // `users` read, which this same request also makes for recipient
    // checking — that one is still healthy, so a bare `failRead.users` would
    // prove the wrong thing).
    tables.integration_oauth_connections.push({
      id: "dddddddd-3333-4333-8333-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    knobs.failReadIf = (table, columns) =>
      table === "users" && columns === "name" ? "connection refused" : null;

    const res = await post(letter, asPerson(OWNER_A));

    expect(res.status).toBe(503);
    expect(String(res.body.message)).toMatch(/who this mail is from could not be read/i);
    expect(String(res.body.message)).toMatch(/connection refused/);
    expect(String(res.body.message)).toMatch(/Nothing was sent\.$/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(grantSent).toHaveLength(0);
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.UNAVAILABLE]);
    expect(audit()[0].changes).toMatchObject({ outcome: "unavailable", status: 503 });
  });

  it("still names the author when the mailbox is a different member's grant — queued and then dispatched", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-1111-4111-8111-dddddddddddd",
      user_id: MANAGER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "manager@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    stubGrantFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "grant-msg-2" }),
      text: async () => "",
    }));

    // OWNER_A sends; only MANAGER_A has a sending grant at this house.
    const queued = await post(letter, asPerson(OWNER_A));
    expect(queued.status).toBe(202);
    expect(queued.body.sender).toMatchObject({ authorName: "Owner A" });
    expect(grantSent).toHaveLength(0);

    const run = await relay.dispatchQueued(Date.now() + queued.body.queued.undoMs + 1000);
    expect(run).toEqual({ considered: 1, sent: 1, failed: 0, skipped: 0, statusUpdateErrors: 0 });

    const decoded = Buffer.from(
      JSON.parse(String(grantSent[0].init.body)).raw as string,
      "base64url",
    ).toString("utf8");
    expect(decoded).toContain("From: manager@housea.gmail.example");
    // Base64 body since ADR 0172: the author line is read from the decoded part.
    expect(
      Buffer.from(decoded.split("\r\n\r\n")[1], "base64").toString("utf8"),
    ).toContain("— Owner A");
  });

  it("is 403, not a mailbox refusal, when this house has cut itself off from the grant (ADR 0114)", async () => {
    tables.integration_oauth_connections.push({
      id: "dddddddd-2222-4222-8222-dddddddddddd",
      user_id: OWNER_A,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "owner@housea.gmail.example",
      scopes: [GMAIL_SEND_SCOPE],
      restaurant_id: HOUSE_A,
      revoked_at: null,
    });
    oauthMock.getAccessToken.mockRejectedValueOnce(
      new ForbiddenException(
        "This house has stopped using that Send as this account grant. The grant itself is untouched.",
      ),
    );

    const res = await post(letter, asPerson(OWNER_A));

    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/stopped using that/);
    expect(res.body.code).not.toBe(HOUSE_MAILBOX_NOT_CONNECTED);
    expect(grantSent).toHaveLength(0);
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.REFUSED]);
  });

  // The resolver's words themselves are checked in the 409 case above
  // ("refuses an owner's letter to a vendor 409 …"); this only pins the
  // machine-readable code as a stable literal a caller can switch on.
  it("the refusal code is a stable literal the web can switch on", () => {
    expect(HOUSE_MAILBOX_NOT_CONNECTED).toBe("house_mailbox_not_connected");
  });

  it("is 403 for staff, and the refusal row carries nothing the caller typed", async () => {
    const res = await post(letter, asPerson(STAFF_A));
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/owner or a manager/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.REFUSED]);
    expect(audit()[0]).toMatchObject({ actor_id: STAFF_A, restaurant_id: HOUSE_A });
    expectStatusOnly(audit()[0], 403);
  });

  it("does not let staff write a chosen subject, recipients or entity ids into the house's log", async () => {
    const res = await post(
      {
        ...letter,
        bcc: ["someone@elsewhere.example"],
        conversationId: CONVO_A,
        providerId: PROVIDER_A,
      },
      asPerson(STAFF_A),
    );
    expect(res.status).toBe(403);
    expectStatusOnly(audit()[0], 403);
  });

  it("reads the role for THIS house: an owner elsewhere is staff here, and is refused", async () => {
    const res = await post(letter, asPerson(OWNER_ELSEWHERE_STAFF_HERE, HOUSE_A));
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/signed in as staff/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for a signed session naming a house where the person holds no role", async () => {
    // OWNER_A's token names HOUSE_B. The signature is good; the role read for
    // HOUSE_B finds nothing, and nothing is not a rank.
    const res = await post(
      { ...letter, to: ["sales@vendor-two.example"] },
      asPerson(OWNER_A, HOUSE_B),
    );
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/holds no role at this house/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(audit()[0]).toMatchObject({
      action: RELAY_AUDIT_ACTIONS.REFUSED,
      actor_id: OWNER_A,
      restaurant_id: HOUSE_B,
    });
    expectStatusOnly(audit()[0], 403);
  });

  it("is 503, not 'no role', when the role cannot be read — and files an outage with nothing the caller typed", async () => {
    knobs.failRead.user_restaurant_access = "connection refused";
    const res = await post(letter, asPerson(OWNER_A));
    expect(res.status).toBe(503);
    expect(String(res.body.message)).toMatch(/role at this house could not be read/);
    expect(String(res.body.message)).toMatch(/connection refused/);
    expect(String(res.body.message)).not.toMatch(/owner or a manager/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.UNAVAILABLE]);
    expect(audit()[0].changes).toMatchObject({ outcome: "unavailable", status: 503 });
    expectStatusOnly(audit()[0], 503);
  });

  it("is 403 when the body names another house than the session's", async () => {
    const res = await post({ ...letter, restaurantId: HOUSE_B }, asPerson(OWNER_A));
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for a foreign recipient, before the 409", async () => {
    const res = await post(
      { ...letter, bcc: ["someone@elsewhere.example"] },
      asPerson(OWNER_A),
    );
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/someone@elsewhere\.example is not among this house's members and its vendors' contacts/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for another house's vendor contact", async () => {
    const res = await post(
      { ...letter, to: ["sales@vendor-two.example"] },
      asPerson(OWNER_A),
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for another house's conversation", async () => {
    const res = await post({ ...letter, conversationId: CONVO_B }, asPerson(OWNER_A));
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for raw HTML from a person", async () => {
    const res = await post(
      { ...letter, bodyHtml: "<img src=x onerror=alert(1)>" },
      asPerson(OWNER_A),
    );
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/Raw HTML is accepted only on the service door/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 403 for a letter template that is not this house's", async () => {
    tables.communication_templates.push({
      id: "99999999-0000-4000-8000-999999999999",
      restaurant_id: HOUSE_B,
      type: "letter",
    });
    const res = await post(
      { ...letter, templateId: "99999999-0000-4000-8000-999999999999" },
      asPerson(OWNER_A),
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 422 for commitment language to a vendor, as the house letters are", async () => {
    const res = await post(
      { ...letter, bodyText: "We accept your offer and confirm the order." },
      asPerson(OWNER_A),
    );
    expect(res.status).toBe(422);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("is 503, not 'not a member', when the roster's addresses cannot be read", async () => {
    // The role is read from OWNER_A's access row, which is readable; the
    // roster's `users` read is the one that fails, loudly.
    knobs.failRead.users = "connection refused";
    const res = await post(
      { to: ["staff@house-a.example"], subject: "Rota", bodyText: "Six." },
      asPerson(OWNER_A),
    );
    expect(res.status).toBe(503);
    expect(String(res.body.message)).toMatch(/members' addresses could not be read/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(actions()).toEqual([RELAY_AUDIT_ACTIONS.UNAVAILABLE]);
  });
});
