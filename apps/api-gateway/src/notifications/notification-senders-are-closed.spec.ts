/**
 * Who may notify whom — at the HTTP seam.
 *
 * Founder answer 15 (ADR 0149, 2026-09-16): "Close the five uncalled POST
 * senders (internal only); send-email owner/manager, recipients limited to the
 * house's members and its vendors' contacts". ADR 0147 had named all six as
 * "Named, not fixed": each sent to whatever user id, restaurant id or address
 * its body named, for any signed-in caller of any role.
 *
 * The app below runs the REAL NotificationsController, the REAL
 * HouseEmailService and the REAL HouseLettersService.book (the vendor book the
 * composer and the house inbox already read), behind a global ValidationPipe
 * with the options main.ts installs. Replaced: JwtAuthGuard (by a stub that sets
 * the `request.user` shape JwtStrategy.validate returns), the supabase client
 * (an in-memory table set that honours eq/in/is), and Gmail (a jest.fn — no
 * mail leaves). The server listens on 127.0.0.1 inside this process.
 *
 * [REVERT-FAILS] marks a test that fails against origin/main @ 60ed83a7:
 * the five routes answered 201 and called their senders, send-email took an
 * untyped body and sent to any address for any role, and the preference DTO
 * stored any string.
 *
 * [REVIEW-FAILS] marks a test added by the 2026-09-17 review fixes; each fails
 * against the first build of this lane (the tree the adversarial review read):
 * it trusted `users.restaurant_id` + `users.role` when no access row existed
 * (both written from the public register body), accepted a quoted address
 * carrying CR/LF, ignored `valid_from`, and wrote a refusal row per attempt.
 */
import {
  ExecutionContext,
  INestApplication,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import {
  GmailService,
  headerInjectionField,
} from "../communications/gmail.service";
import { HouseLettersService } from "../communications/letters/house-letters.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { NotificationProducersService } from "./producers/notification-producers.service";
import {
  HouseEmailService,
  REFUSAL_AUDIT_WINDOW_MS,
} from "./house-email.service";

type Row = Record<string, any>;

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "22222222-2222-4222-8222-222222222222";

const OWNER = "a0000000-0000-4000-8000-000000000001";
const MANAGER = "a0000000-0000-4000-8000-000000000002"; // users.role says staff
const STAFF = "a0000000-0000-4000-8000-000000000003"; // users.role says manager
const EX_MEMBER = "a0000000-0000-4000-8000-000000000004";
const EXPIRED = "a0000000-0000-4000-8000-000000000005";
// No access row anywhere; users.restaurant_id = HOUSE and users.role = manager,
// exactly what POST /auth/register writes from a stranger's request body.
const SELF_REGISTERED = "a0000000-0000-4000-8000-000000000006";
const OUTSIDER = "a0000000-0000-4000-8000-000000000007";
const NOT_YET = "a0000000-0000-4000-8000-000000000008"; // grant starts next year

const P_HOUSE = "b0000000-0000-4000-8000-000000000001";
const P_OTHER = "b0000000-0000-4000-8000-000000000002";
const P_DELETED = "b0000000-0000-4000-8000-000000000003";

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

function seed(): Record<string, Row[]> {
  return {
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true, valid_until: null },
      { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true, valid_until: null },
      { user_id: STAFF, restaurant_id: HOUSE, role: "staff", is_active: true, valid_until: null },
      { user_id: EX_MEMBER, restaurant_id: HOUSE, role: "owner", is_active: false, valid_until: null },
      { user_id: EXPIRED, restaurant_id: HOUSE, role: "manager", is_active: true, valid_until: "2020-01-01T00:00:00Z" },
      { user_id: OUTSIDER, restaurant_id: OTHER_HOUSE, role: "owner", is_active: true, valid_until: null },
      { user_id: NOT_YET, restaurant_id: HOUSE, role: "owner", is_active: true, valid_from: FUTURE, valid_until: null },
    ],
    users: [
      { user_id: OWNER, email: "owner@house.test", role: "owner", restaurant_id: HOUSE },
      { user_id: MANAGER, email: "Manager@House.test", role: "staff", restaurant_id: OTHER_HOUSE },
      { user_id: STAFF, email: "staff@house.test", role: "manager", restaurant_id: HOUSE },
      // An ended row does not fall back to this legacy home-house owner role.
      { user_id: EX_MEMBER, email: "gone@house.test", role: "owner", restaurant_id: HOUSE },
      { user_id: EXPIRED, email: "expired@house.test", role: "manager", restaurant_id: OTHER_HOUSE },
      { user_id: SELF_REGISTERED, email: "legacy@house.test", role: "manager", restaurant_id: HOUSE },
      { user_id: OUTSIDER, email: "owner@other.test", role: "owner", restaurant_id: OTHER_HOUSE },
      { user_id: NOT_YET, email: "notyet@house.test", role: "owner", restaurant_id: HOUSE },
    ],
    providers: [
      { id: P_HOUSE, restaurant_id: HOUSE, name: "Vendor", contact_email: "Orders@Vendor.test", primary_contact: { name: "Rep", email: "rep@vendor.test" }, deleted_at: null },
      { id: P_OTHER, restaurant_id: OTHER_HOUSE, name: "Other vendor", contact_email: "sales@othervendor.test", primary_contact: null, deleted_at: null },
      { id: P_DELETED, restaurant_id: HOUSE, name: "Gone vendor", contact_email: "old@gonevendor.test", primary_contact: null, deleted_at: "2026-01-01T00:00:00Z" },
    ],
    provider_contacts: [
      { provider_id: P_HOUSE, name: "Accounts", email: "accounts@vendor.test" },
      { provider_id: P_OTHER, name: "Other", email: "x@othervendor.test" },
    ],
    system_audit_log: [],
  };
}

let tables = seed();
let failing: string[] = [];

/** supabase-js stand-in: eq / in / is filters, maybeSingle, insert. Resolves
 *  with `{ data, error }` and never rejects, as postgrest-js does. */
function client() {
  return {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      const result = () => {
        if (failing.includes(table)) {
          return { data: null, error: { message: `${table} is unreachable` } };
        }
        return {
          data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
          error: null,
        };
      };
      const b: any = {};
      b.select = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.eq = (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      };
      b.is = (col: string, val: unknown) => {
        filters.push((r) => (r[col] ?? null) === val);
        return b;
      };
      b.maybeSingle = async () => {
        const r = result();
        return r.error ? r : { data: r.data![0] ?? null, error: null };
      };
      b.insert = async (row: Row) => {
        if (failing.includes(table)) {
          return { error: { message: `${table} is unwritable` } };
        }
        (tables[table] ??= []).push(row);
        return { error: null };
      };
      b.then = (resolve: any, reject: any) =>
        Promise.resolve(result()).then(resolve, reject);
      return b;
    },
  };
}

const supabase = client();
const db = { supabase, client: supabase, getClient: () => supabase };

const gmail = {
  sendEmail: jest.fn(async (_: any) => ({
    success: true,
    messageId: "gmail-msg-1",
  })),
};

const service = {
  sendOrderApprovalNotification: jest.fn(),
  sendLowStockAlert: jest.fn(),
  sendDeliveryNotification: jest.fn(),
  sendPriceNegotiationNotification: jest.fn(),
  sendSystemAlert: jest.fn(),
  updatePreferences: jest.fn(async (p: any) => ({ saved: p })),
};

let app: INestApplication;
let base: string;
let houseEmail: HouseEmailService;

async function call(
  method: "POST" | "PATCH",
  path: string,
  as: { user?: string | null; house?: string | null; role?: string },
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-user": as.user ?? "",
      "x-test-house": as.house ?? "",
      "x-test-role": as.role ?? "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body: parsed };
}

const message = (body: any): string =>
  Array.isArray(body?.message) ? body.message.join(" | ") : String(body?.message);

beforeAll(async () => {
  const letters = new HouseLettersService(db as any, {} as any, {} as any);
  const moduleRef = await Test.createTestingModule({
    controllers: [NotificationsController],
    providers: [
      { provide: NotificationsService, useValue: service },
      { provide: NotificationProducersService, useValue: {} },
      { provide: LowStockAlertsService, useValue: {} },
      { provide: DatabaseService, useValue: db },
      { provide: HouseLettersService, useValue: letters },
      { provide: GmailService, useValue: gmail },
      HouseEmailService,
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: req.headers["x-test-user"] || null,
          restaurantId: req.headers["x-test-house"] || null,
          role: req.headers["x-test-role"] || undefined,
        };
        return true;
      },
    })
    .compile();
  houseEmail = moduleRef.get(HouseEmailService);
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  tables = seed();
  failing = [];
  // The refusal collapse window is per process; each test starts clean.
  (houseEmail as any).refusalAudits?.clear();
});

const OWNER_AT_HOUSE = { user: OWNER, house: HOUSE, role: "owner" };

// ===========================================================================
// 1. The five uncalled senders are not HTTP routes any more
// ===========================================================================

describe("the five uncalled senders are closed", () => {
  const CLOSED: Array<[string, Row, keyof typeof service]> = [
    ["/notifications/order-approval", { userId: STAFF, orderId: "o", wineName: "w", quantity: 1, providerName: "p" }, "sendOrderApprovalNotification"],
    ["/notifications/low-stock", { restaurantId: OTHER_HOUSE, wineId: "w", wineName: "w", currentStock: 0, threshold: 6 }, "sendLowStockAlert"],
    ["/notifications/delivery", { restaurantId: OTHER_HOUSE, orderId: "o", wineName: "w", quantity: 1, providerName: "p" }, "sendDeliveryNotification"],
    ["/notifications/price-negotiation", { userId: STAFF, orderId: "o", wineName: "w", currentPrice: 1, proposedPrice: 2, providerName: "p" }, "sendPriceNegotiationNotification"],
    ["/notifications/system-alert", { restaurantId: OTHER_HOUSE, title: "t", message: "m", severity: "error" }, "sendSystemAlert"],
  ];

  it.each(CLOSED)(
    "[REVERT-FAILS] POST %s is 404 and sends nothing",
    async (path, body, method) => {
      const res = await call("POST", path, OWNER_AT_HOUSE, body);
      expect(res.status).toBe(404);
      expect(service[method]).not.toHaveBeenCalled();
    },
  );

  it("[REVERT-FAILS] the controller declares none of the five handlers", () => {
    const proto = NotificationsController.prototype as any;
    for (const handler of [
      "notifyOrderApproval",
      "notifyLowStock",
      "notifyDelivery",
      "notifyPriceNegotiation",
      "sendSystemAlert",
    ]) {
      expect(proto[handler]).toBeUndefined();
    }
  });
});

// ===========================================================================
// 2. send-email — owner or manager of the active house
// ===========================================================================

describe("send-email: who may send", () => {
  const TO_VENDOR = {
    to: ["orders@vendor.test"],
    subject: "Next week",
    body_html: "<p>Hello</p>",
  };

  it("[REVERT-FAILS] an owner sends to a vendor contact and a member; one audit row, no address in it", async () => {
    const res = await call("POST", "/notifications/send-email", OWNER_AT_HOUSE, {
      to: [" ORDERS@vendor.test ", "manager@house.test"],
      cc: ["rep@vendor.test", "orders@VENDOR.test"],
      bcc: ["accounts@vendor.test"],
      subject: "Next week's order",
      body_html: "<p>Hello</p>",
      body_text: "Hello",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      message_id: "gmail-msg-1",
      recipients: { to: 2, cc: 1, bcc: 1 },
      audited: true,
    });
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendEmail.mock.calls[0][0]).toMatchObject({
      to: ["ORDERS@vendor.test", "manager@house.test"],
      cc: ["rep@vendor.test"], // the duplicate of a `to` address is dropped
      bcc: ["accounts@vendor.test"],
      subject: "Next week's order",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    const audit = tables.system_audit_log;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: "user",
      actor_id: OWNER,
      action: "house_email_sent",
      entity_type: "house_email",
      restaurant_id: HOUSE,
    });
    expect(audit[0].changes).toMatchObject({
      members: 1,
      vendorContacts: 3,
      providerIds: [P_HOUSE],
      messageId: "gmail-msg-1",
    });
    expect(JSON.stringify(audit[0])).not.toMatch(/@/);
  });

  it("[REVERT-FAILS] a manager IN THIS HOUSE may send even when their account row says staff", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: MANAGER, house: HOUSE, role: "staff" },
      TO_VENDOR,
    );
    expect(res.status).toBe(201);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("[REVERT-FAILS] staff of this house is refused even when the token's role says manager", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: STAFF, house: HOUSE, role: "manager" },
      TO_VENDOR,
    );
    expect(res.status).toBe(403);
    expect(message(res.body)).toMatch(/owner or a manager.*your role here is staff/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tables.system_audit_log).toEqual([
      expect.objectContaining({
        action: "house_email_refused",
        actor_id: STAFF,
        restaurant_id: HOUSE,
      }),
    ]);
  });

  it("[REVERT-FAILS] the owner of ANOTHER house, pointed at this one, is refused", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: OUTSIDER, house: HOUSE, role: "owner" },
      TO_VENDOR,
    );
    expect(res.status).toBe(403);
    expect(message(res.body)).toMatch(/not a current member of this house/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] an ended membership does not fall back to the legacy home-house role", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: EX_MEMBER, house: HOUSE, role: "owner" },
      TO_VENDOR,
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a membership past valid_until is refused", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: EXPIRED, house: HOUSE, role: "manager" },
      TO_VENDOR,
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVIEW-FAILS] an account whose users row claims this house, with no access row, is refused (the register-body chain)", async () => {
    // POST /auth/register writes users.restaurant_id and users.role from the
    // body and signs restaurantId into the token. A stranger who knows the
    // house id can therefore hold exactly this session. The first build of
    // this lane answered 201 here.
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: SELF_REGISTERED, house: HOUSE, role: "owner" },
      TO_VENDOR,
    );
    expect(res.status).toBe(403);
    expect(message(res.body)).toMatch(/not a current member of this house/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVIEW-FAILS] a grant whose valid_from is still in the future cannot send yet", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: NOT_YET, house: HOUSE, role: "owner" },
      TO_VENDOR,
    );
    expect(res.status).toBe(403);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a session with no active house is refused, not sent unchecked", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: OWNER, house: null, role: "owner" },
      TO_VENDOR,
    );
    expect(res.status).toBe(400);
    expect(message(res.body)).toMatch(/No active restaurant/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a session with no user is 401", async () => {
    const res = await call(
      "POST",
      "/notifications/send-email",
      { user: null, house: HOUSE },
      TO_VENDOR,
    );
    expect(res.status).toBe(401);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. send-email — only to the house's own book
// ===========================================================================

describe("send-email: to whom", () => {
  const send = (to: string[], extra: Row = {}) =>
    call("POST", "/notifications/send-email", OWNER_AT_HOUSE, {
      to,
      subject: "Hello",
      body_html: "<p>Hi</p>",
      ...extra,
    });

  it.each([
    ["an address nobody in the house knows", "stranger@example.test"],
    ["another house's vendor", "sales@othervendor.test"],
    ["another house's vendor contact", "x@othervendor.test"],
    ["a deleted vendor", "old@gonevendor.test"],
    ["a member whose access was ended", "gone@house.test"],
    ["a member whose access expired", "expired@house.test"],
    ["the owner of another house", "owner@other.test"],
    ["an account that only claims this house in its users row", "legacy@house.test"],
    ["a member whose grant has not started", "notyet@house.test"],
  ])(
    "[REVERT-FAILS] refuses %s, names it, sends nothing",
    async (_label, address) => {
      const res = await send(["orders@vendor.test", address]);
      expect(res.status).toBe(403);
      expect(message(res.body)).toContain(`Not in the book: ${address}`);
      expect(gmail.sendEmail).not.toHaveBeenCalled();
      expect(tables.system_audit_log).toHaveLength(1);
      expect(tables.system_audit_log[0]).toMatchObject({
        action: "house_email_refused",
      });
      expect(JSON.stringify(tables.system_audit_log[0])).not.toMatch(/@/);
    },
  );

  it("[REVERT-FAILS] a cc or bcc outside the book refuses the whole send", async () => {
    for (const field of ["cc", "bcc"]) {
      jest.clearAllMocks();
      const res = await send(["orders@vendor.test"], {
        [field]: ["stranger@example.test"],
      });
      expect(res.status).toBe(403);
      expect(gmail.sendEmail).not.toHaveBeenCalled();
    }
  });

  it("[REVERT-FAILS] an unreadable membership table is 503, never a pass and never 'not a member'", async () => {
    failing = ["user_restaurant_access"];
    const res = await send(["orders@vendor.test"]);
    expect(res.status).toBe(503);
    expect(message(res.body)).toMatch(/could not be read/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] an unreadable vendor book is 503, never an empty book", async () => {
    failing = ["providers"];
    const res = await send(["orders@vendor.test"]);
    expect(res.status).toBe(503);
    expect(message(res.body)).toMatch(/vendor book could not be read/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a send the mail provider refuses is a 502 carrying its words, not success:true", async () => {
    gmail.sendEmail.mockResolvedValueOnce({
      success: false,
      error: "invalid_grant",
    } as any);
    const res = await send(["orders@vendor.test"]);
    expect(res.status).toBe(502);
    expect(message(res.body)).toContain("invalid_grant");
    expect(tables.system_audit_log[0]).toMatchObject({
      action: "house_email_failed",
    });
  });

  it("[REVERT-FAILS] a sent email whose audit row could not be written says audited:false", async () => {
    failing = ["system_audit_log"];
    const res = await send(["orders@vendor.test"]);
    expect(res.status).toBe(201);
    expect(res.body.audited).toBe(false);
  });
});

// ===========================================================================
// 4. send-email — the body is validated
// ===========================================================================

describe("send-email: the body", () => {
  it("[REVERT-FAILS] the old RecurringOrders body (no recipients, a metadata field) is a readable 400", async () => {
    const res = await call("POST", "/notifications/send-email", OWNER_AT_HOUSE, {
      to: [],
      subject: "Price Confirmation",
      body_text: "Hi",
      body_html: "<p>Hi</p>",
      metadata: { type: "price_inquiry" },
    });
    expect(res.status).toBe(400);
    expect(message(res.body)).toMatch(/Name at least one recipient/);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["a recipient that is not an address", { to: ["orders"] }],
    ["a subject carrying a header line", { subject: "Hi\r\nBcc: x@evil.test" }],
    ["an empty body", { body_html: "" }],
  ])("[REVERT-FAILS] refuses %s", async (_label, patch) => {
    const res = await call("POST", "/notifications/send-email", OWNER_AT_HOUSE, {
      to: ["orders@vendor.test"],
      subject: "Hello",
      body_html: "<p>Hi</p>",
      ...patch,
    });
    expect(res.status).toBe(400);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4b. send-email — an address is one address in one header
// ===========================================================================

describe("send-email: no header can be injected through an address", () => {
  // @IsEmail accepts a quoted local part carrying CR/LF (measured 2026-09-17),
  // and createMimeMessage joins To/Cc/Bcc into the header block. The contact is
  // SEEDED into the house's own vendor book, so the book check alone would let
  // it through — only the address rule and the sender's own refusal stop it.
  const INJECTED = '"a\r\nBcc: x@evil.test"@vendor.test';

  it.each([
    ["a quoted local part carrying CR/LF + a Bcc header", INJECTED],
    ["a quoted local part carrying a bare LF", '"a\nBcc: x@evil.test"@vendor.test'],
    ["a quoted local part with a comma (a second address)", '"a,x@evil.test"@vendor.test'],
    ["a quoted local part with angle brackets", '"<x@evil.test>"@vendor.test'],
  ])(
    "[REVIEW-FAILS] %s, even when it is in the vendor book, is a 400 and nothing is sent or audited",
    async (_label, address) => {
      tables.provider_contacts.push({
        provider_id: P_HOUSE,
        name: "Injected",
        email: address,
      });
      for (const field of ["to", "cc", "bcc"]) {
        jest.clearAllMocks();
        const body: Row = {
          to: ["orders@vendor.test"],
          subject: "Hello",
          body_html: "<p>Hi</p>",
        };
        body[field] = [address];
        const res = await call(
          "POST",
          "/notifications/send-email",
          OWNER_AT_HOUSE,
          body,
        );
        expect(res.status).toBe(400);
        expect(message(res.body)).toMatch(/may not contain/);
        expect(gmail.sendEmail).not.toHaveBeenCalled();
      }
      expect(tables.system_audit_log).toEqual([]);
    },
  );

  it("[REVIEW-FAILS] the mail sender itself refuses a line break in any header, before any transport", async () => {
    // The REAL GmailService.sendEmail, configured as if OAuth were ready, with
    // only the Gmail API call replaced. It must refuse before sending.
    const real = new GmailService({ get: () => undefined } as any);
    const send = jest.fn(async () => ({ data: { id: "m", threadId: "t" } }));
    Object.assign(real as any, {
      isConfigured: true,
      senderEmail: "house@mudavym.test",
      gmail: { users: { messages: { send } } },
    });
    jest.spyOn((real as any).logger, "log").mockImplementation(() => {});
    jest.spyOn((real as any).logger, "error").mockImplementation(() => {});

    for (const patch of [
      { to: [INJECTED] },
      { cc: ["ok@vendor.test", "b\r\nBcc: x@evil.test"] },
      { bcc: ["c\nTo: x@evil.test"] },
      { subject: "Hi\r\nBcc: x@evil.test" },
      { replyTo: "r@vendor.test\r\nBcc: x@evil.test" },
      { references: "<a@b>\r\nBcc: x@evil.test" },
    ]) {
      const result = await real.sendEmail({
        to: ["orders@vendor.test"],
        subject: "Hello",
        html: "<p>Hi</p>",
        ...patch,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/line break/);
    }
    expect(send).not.toHaveBeenCalled();

    // Both states: a folded References (CRLF + space) is a continuation, not a
    // new header — it is unfolded and the message goes out with no Bcc line.
    const ok = await real.sendEmail({
      to: ["orders@vendor.test"],
      subject: "Hello",
      html: "<p>Hi</p>",
      references: "<a@b>\r\n <c@d>",
    });
    expect(ok.success).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const raw = Buffer.from(
      (send.mock.calls[0] as any)[0].requestBody.raw,
      "base64url",
    ).toString("utf8");
    const headerBlock = raw.split("\r\n\r\n")[0];
    expect(headerBlock).toContain("References: <a@b> <c@d>");
    expect(headerBlock).not.toMatch(/^Bcc:/m);
    expect(headerInjectionField({ to: ["a@b.test"], subject: "s", html: "" })).toBeNull();
  });
});

// ===========================================================================
// 4c. send-email — refusal rows are collapsed, never uncounted
// ===========================================================================

describe("send-email: repeated refusals do not flood the house's log", () => {
  const STAFF_AT_HOUSE = { user: STAFF, house: HOUSE, role: "staff" };
  const BODY = { to: ["orders@vendor.test"], subject: "Hi", body_html: "<p>Hi</p>" };
  let clockSpy: jest.SpyInstance | undefined;
  afterEach(() => clockSpy?.mockRestore());

  it("[REVIEW-FAILS] five refusals inside the window write ONE row; the next row after it carries the four repeats", async () => {
    let clock = Date.parse("2026-09-17T10:00:00Z");
    clockSpy = jest
      .spyOn(houseEmail as any, "now")
      .mockImplementation(() => clock);

    for (let i = 0; i < 5; i++) {
      const res = await call("POST", "/notifications/send-email", STAFF_AT_HOUSE, BODY);
      expect(res.status).toBe(403); // every attempt is still refused
    }
    expect(tables.system_audit_log).toHaveLength(1);
    expect(tables.system_audit_log[0].changes).toMatchObject({ refusal: "role" });
    expect(tables.system_audit_log[0].changes.suppressedRepeats).toBeUndefined();

    clock += REFUSAL_AUDIT_WINDOW_MS + 1;
    const res = await call("POST", "/notifications/send-email", STAFF_AT_HOUSE, BODY);
    expect(res.status).toBe(403);
    expect(tables.system_audit_log).toHaveLength(2);
    expect(tables.system_audit_log[1].changes).toMatchObject({
      refusal: "role",
      suppressedRepeats: 4,
    });
  });

  it("collapses per person and per kind of refusal, and never collapses a send (both states)", async () => {
    let clock = Date.parse("2026-09-17T10:00:00Z");
    clockSpy = jest
      .spyOn(houseEmail as any, "now")
      .mockImplementation(() => clock);

    await call("POST", "/notifications/send-email", STAFF_AT_HOUSE, BODY);
    await call("POST", "/notifications/send-email", { user: EXPIRED, house: HOUSE, role: "manager" }, BODY);
    await call("POST", "/notifications/send-email", OWNER_AT_HOUSE, { ...BODY, to: ["stranger@example.test"] });
    await call("POST", "/notifications/send-email", OWNER_AT_HOUSE, BODY);
    await call("POST", "/notifications/send-email", OWNER_AT_HOUSE, BODY);
    clock += 1;

    const actions = tables.system_audit_log.map(
      (r) => `${r.actor_id}:${r.action}:${r.changes.refusal ?? ""}`,
    );
    expect(actions).toEqual([
      `${STAFF}:house_email_refused:role`,
      `${EXPIRED}:house_email_refused:role`,
      `${OWNER}:house_email_refused:recipient_not_in_book`,
      `${OWNER}:house_email_sent:`,
      `${OWNER}:house_email_sent:`,
    ]);
  });
});

// ===========================================================================
// 5. HouseEmailService with no mail provider — never a mock success
// ===========================================================================

describe("no mail provider on the deployment", () => {
  // Not marked [REVERT-FAILS]: this calls the new service directly, so it has
  // no pre-fix counterpart to fail against. What it replaces is
  // NotificationsService.sendEmail's `success: true` with a mock message id.
  it("is a 503 and an audit row, not success:true with a mock message id", async () => {
    const letters = new HouseLettersService(db as any, {} as any, {} as any);
    const bare = new HouseEmailService(db as any, letters, undefined);
    jest.spyOn((bare as any).logger, "log").mockImplementation(() => {});
    jest.spyOn((bare as any).logger, "error").mockImplementation(() => {});
    await expect(
      bare.send(
        { userId: OWNER, restaurantId: HOUSE },
        { to: ["orders@vendor.test"], subject: "Hi", bodyHtml: "<p>Hi</p>" },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tables.system_audit_log).toEqual([
      expect.objectContaining({ action: "house_email_failed" }),
    ]);
  });
});

// ===========================================================================
// 6. Preferences: modes are an allowlist, times are HH:mm (ADR 0147)
// ===========================================================================

describe("PATCH /notifications/preferences refuses values no sender reads", () => {
  const patch = (body: Row) =>
    call("PATCH", "/notifications/preferences", OWNER_AT_HOUSE, body);

  it.each([
    ["ordersMode", { ordersMode: "email" }],
    ["reportsMode", { reportsMode: "BOTH" }],
    ["lowStock.digestFrequency", { lowStock: { digestFrequency: "weekly" } }],
    ["lowStock.digestTime 25:00", { lowStock: { digestTime: "25:00" } }],
    ["lowStock.digestTime 8:00", { lowStock: { digestTime: "8:00" } }],
    ["quietHours.startTime noon", { quietHours: { startTime: "noon" } }],
    ["quietHours.endTime 22:00:00", { quietHours: { endTime: "22:00:00" } }],
    ["quietHours.startTime empty", { quietHours: { startTime: "" } }],
  ])("[REVERT-FAILS] %s is a 400 and nothing is stored", async (_label, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(service.updatePreferences).not.toHaveBeenCalled();
  });

  it("every value the settings pages send is accepted and reaches the service", async () => {
    for (const mode of ["both", "in_app", "off"]) {
      const res = await patch({ ordersMode: mode, reportsMode: mode });
      expect(res.status).toBe(200);
    }
    const res = await patch({
      lowStock: { digestFrequency: "off", digestTime: "08:30" },
      quietHours: { enabled: true, startTime: "22:00", endTime: "07:59" },
    });
    expect(res.status).toBe(200);
    expect(service.updatePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: OWNER,
        lowStock: expect.objectContaining({
          digestFrequency: "off",
          digestTime: "08:30",
        }),
        quietHours: expect.objectContaining({
          startTime: "22:00",
          endTime: "07:59",
        }),
      }),
    );
  });
});
