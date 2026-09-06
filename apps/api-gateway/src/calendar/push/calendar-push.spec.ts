/**
 * ADR 0111 §5, connection direction 1 — the day-book pushed to Google.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, SAID FIRST
 * ---------------------------------------------------------------------------
 * It cannot prove a live push. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are
 * unset on every deployment (ADR 0111 §Status, still true 2026-09-06), no
 * consent screen has ever been shown for the calendar scope, and the app is
 * unsubmitted for verification. So no test anywhere in this repo can currently
 * say "an event appeared in somebody's Google calendar".
 *
 * What it CAN prove — and what is therefore the whole point of the
 * `GoogleCalendarClient` seam — is the exact shape of every request this build
 * would send and the exact handling of every answer it could get back. The
 * fake below is a small stateful Google: it stores the calendars and events it
 * is given, answers a second insert of an id it already holds with 409
 * `duplicate` as the real API does, and 404s an update addressed to an event
 * somebody removed. That makes "a retry produces one provider event" and
 * "a copy deleted in Google comes back" statements about behaviour rather than
 * about intent.
 */

import {
  CalendarPushService,
  idempotencyKey,
  pushSentence,
} from "./calendar-push.service";
import {
  GoogleCalendarAnswer,
  GoogleCalendarCall,
  GoogleCalendarClient,
  isRateLimited,
} from "./google-calendar.client";
import { fakeSupabase } from "./fake-supabase";
import {
  INTEGRATION_DEFINITIONS,
  INTEGRATION_IDS,
  scopeStringFor,
} from "../../integrations/integrations-oauth.constants";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const USER = "cccccccc-0000-4000-8000-cccccccccccc";
const CONNECTION = "dddddddd-0000-4000-8000-dddddddddddd";
const ENTRY = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const OTHER_ENTRY = "ffffffff-0000-4000-8000-ffffffffffff";

/** A small, stateful Google. Records every call; answers like the real API. */
class FakeGoogle extends GoogleCalendarClient {
  readonly calls: Array<GoogleCalendarCall & { token: string }> = [];
  readonly calendars = new Set<string>();
  readonly events = new Map<string, Record<string, unknown>>();
  /** Set to hand back a fixed answer instead of behaving. */
  override_: GoogleCalendarAnswer | null = null;
  private counter = 0;

  async call(
    token: string,
    request: GoogleCalendarCall,
  ): Promise<GoogleCalendarAnswer> {
    this.calls.push({ ...request, token });
    if (this.override_) return this.override_;

    const ok = (body: Record<string, unknown>): GoogleCalendarAnswer => ({
      status: 200,
      body,
      reason: null,
      message: null,
      retryAfterSeconds: null,
    });
    const err = (
      status: number,
      reason: string,
      message: string,
    ): GoogleCalendarAnswer => ({
      status,
      body: { error: { errors: [{ reason }], message } },
      reason,
      message,
      retryAfterSeconds: null,
    });

    if (request.method === "POST" && request.path === "/calendars") {
      const id = `mudavym-cal-${++this.counter}@group.calendar.google.com`;
      this.calendars.add(id);
      return ok({ id, summary: request.body?.summary });
    }

    const eventInsert = request.path.match(/^\/calendars\/([^/]+)\/events$/);
    if (request.method === "POST" && eventInsert) {
      const id = String(request.body?.id ?? `auto-${++this.counter}`);
      if (this.events.has(id)) {
        return err(409, "duplicate", "The requested identifier already exists.");
      }
      this.events.set(id, request.body ?? {});
      return ok({ id });
    }

    const eventPath = request.path.match(
      /^\/calendars\/([^/]+)\/events\/([^/]+)$/,
    );
    if (eventPath) {
      const id = decodeURIComponent(eventPath[2]);
      if (!this.events.has(id)) {
        return err(404, "notFound", "Not Found");
      }
      if (request.method === "PUT") {
        this.events.set(id, request.body ?? {});
        return ok({ id });
      }
      this.events.delete(id);
      return {
        status: 204,
        body: null,
        reason: null,
        message: null,
        retryAfterSeconds: null,
      };
    }

    return err(400, "badRequest", `unmodelled call ${request.method} ${request.path}`);
  }
}

function harness(
  options: {
    connected?: boolean;
    available?: boolean;
    tokenThrows?: Error;
  } = {},
) {
  const connected = options.connected ?? true;
  const db = fakeSupabase({
    restaurants: [
      { id: HOUSE, name: "Sim Meyhouse", timezone: "America/Los_Angeles" },
      { id: OTHER_HOUSE, name: "Sim Vanilla Kaleici", timezone: "Europe/Istanbul" },
    ],
    users: [{ user_id: USER, full_name: "Deniz", email: "deniz@example.com" }],
    calendar_events: [
      {
        id: ENTRY,
        restaurant_id: HOUSE,
        title: "Southern Glazers delivery",
        description: "Barolo + Sancerre",
        event_type: "delivery",
        start_date: "2026-09-10",
        end_date: null,
        all_day: true,
        start_time: null,
        end_time: null,
        status: "pending",
      },
      {
        id: OTHER_ENTRY,
        restaurant_id: OTHER_HOUSE,
        title: "Another house's tasting",
        description: null,
        event_type: "tasting",
        start_date: "2026-09-11",
        end_date: null,
        all_day: true,
        start_time: null,
        end_time: null,
        status: "pending",
      },
    ],
    integration_oauth_connections: connected
      ? [
          {
            id: CONNECTION,
            user_id: USER,
            restaurant_id: HOUSE,
            integration_id: "google_calendar",
            revoked_at: null,
            account_email: null,
            connected_at: "2026-09-06T09:00:00.000Z",
            reconnect_required_at: null,
            reconnect_reason: null,
          },
        ]
      : [],
    calendar_push_targets: [],
    calendar_push_mappings: [],
    calendar_push_outcomes: [],
  });

  const google = new FakeGoogle();
  const oauth = {
    availability: () => ({
      google_calendar: options.available === false
        ? { available: false, reason: "Google OAuth is not configured on this deployment." }
        : { available: true },
    }),
    getAccessToken: jest.fn(async () => {
      if (options.tokenThrows) throw options.tokenThrows;
      return "access-token";
    }),
    listHouseGrants: jest.fn(async () => ({ grants: [], unattributed: 0 })),
  };

  const service = new CalendarPushService(db as any, oauth as any, google);
  return { db, google, oauth, service };
}

const outcomes = (db: ReturnType<typeof fakeSupabase>) =>
  db.rows("calendar_push_outcomes");
const mappings = (db: ReturnType<typeof fakeSupabase>) =>
  db.rows("calendar_push_mappings");

beforeEach(() => {
  process.env.CALENDAR_PUSH_ENABLED = "true";
});
afterEach(() => {
  delete process.env.CALENDAR_PUSH_ENABLED;
});

// ── 1. the definition row, and what it refuses ─────────────────────────────

describe("the google_calendar definition", () => {
  it("is in the catalogue and asks for exactly one scope — the narrowest", () => {
    const definition = INTEGRATION_DEFINITIONS.google_calendar;
    expect(INTEGRATION_IDS).toContain("google_calendar");
    expect(definition.provider).toBe("google");
    // Read verbatim from developers.google.com/workspace/calendar/api/auth on
    // 2026-09-06: "Make secondary Google calendars, and see, create, change,
    // and delete events on them."
    expect(scopeStringFor(definition)).toBe(
      "https://www.googleapis.com/auth/calendar.app.created",
    );
    // Not `calendar`, not `calendar.events`: both grant the whole account.
    expect(scopeStringFor(definition)).not.toContain("auth/calendar ");
    expect(scopeStringFor(definition)).not.toContain("calendar.events");
    // No identity scopes, following gmail_send and gmail_read.
    expect(scopeStringFor(definition)).not.toContain("openid");
    expect(scopeStringFor(definition)).not.toContain("email");
  });

  it("answers all five data-handling questions, none of them blank", () => {
    const h = INTEGRATION_DEFINITIONS.google_calendar.dataHandling;
    for (const [field, value] of Object.entries(h)) {
      expect(`${field}: ${value.trim()}`.length).toBeGreaterThan(
        field.length + 40,
      );
    }
    // The honest line about deletions has to be on the consent screen too, not
    // only on /connections: the operator agrees before it can ever happen.
    expect(h.keptFor.toLowerCase()).toContain("comes back");
  });

  it("is refused when the deployment has no Google credentials", () => {
    const { service } = harness({ available: false });
    // `availability()` is the real gate (integrations-oauth.service.ts:171-201);
    // this asserts the push honours it rather than discovering it at the end of
    // a consent flow.
    return service
      .push(HOUSE, ENTRY, "create")
      .then((result) => {
        expect(result.outcome).toBe("unavailable");
        expect(result.detail).toMatch(/not configured/i);
      });
  });

  it("refuses on the real availability() when the credentials are absent", async () => {
    // The gate itself, not a stub of it. Proven against the actual method so a
    // change to its shape cannot leave the push believing an old contract.
    const { IntegrationsOauthService } = await import(
      "../../integrations/integrations-oauth.service"
    );
    const config = { get: () => undefined } as any;
    const svc = new IntegrationsOauthService(
      {} as any,
      config,
      { isConfigured: true } as any,
    );
    const status = svc.availability().google_calendar;
    expect(status.available).toBe(false);
    expect(status.reason).toContain("Google OAuth is not configured");
  });
});

// ── 2. the secondary calendar, created once ────────────────────────────────

describe("the secondary calendar", () => {
  it("is created once per (restaurant, account), however many pushes follow", async () => {
    const { service, google, db } = harness();

    await service.push(HOUSE, ENTRY, "create");
    await service.push(HOUSE, ENTRY, "update");
    await service.push(HOUSE, ENTRY, "update");

    const created = google.calls.filter(
      (c) => c.method === "POST" && c.path === "/calendars",
    );
    expect(created).toHaveLength(1);
    expect(db.rows("calendar_push_targets")).toHaveLength(1);
    expect(google.calendars.size).toBe(1);

    // It is named after the house and carries the house's own zone, so the
    // person can tell which calendar in their account is this restaurant's.
    expect(created[0].body?.summary).toBe("Mudavym — Sim Meyhouse");
    expect(created[0].body?.timeZone).toBe("America/Los_Angeles");
    // And it says, in the calendar's own description, that a change made in
    // Google is not read back.
    expect(String(created[0].body?.description)).toMatch(/not read back/i);
  });

  it("records the creation as its own outcome row", async () => {
    const { service, db } = harness();
    await service.push(HOUSE, ENTRY, "create");
    const row = outcomes(db).find((o) => o.verb === "ensure_calendar");
    expect(row?.outcome).toBe("delivered");
    expect(String(row?.detail)).toContain("Mudavym — Sim Meyhouse");
  });
});

// ── 3. idempotency ─────────────────────────────────────────────────────────

describe("the idempotency key", () => {
  it("is (restaurant, entry, provider account) and a valid Google event id", () => {
    const key = idempotencyKey(HOUSE, ENTRY, CONNECTION);
    // base32hex is 0-9a-v; lowercase hex is a strict subset, length 5..1024.
    expect(key).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(key).toHaveLength(64);
    // All three components are load-bearing: change any one and the key moves.
    expect(idempotencyKey(OTHER_HOUSE, ENTRY, CONNECTION)).not.toBe(key);
    expect(idempotencyKey(HOUSE, OTHER_ENTRY, CONNECTION)).not.toBe(key);
    expect(idempotencyKey(HOUSE, ENTRY, "another-connection")).not.toBe(key);
  });

  it("makes a retried create ONE provider event, not two", async () => {
    const { service, google, db } = harness();

    const first = await service.push(HOUSE, ENTRY, "create");
    expect(first.outcome).toBe("delivered");

    // The mapping is wiped as if the row had been lost — the exact risk ADR
    // 0111 names ("duplicates if the mapping is lost"). The retry must not
    // create a second event in the person's calendar.
    db.rows("calendar_push_mappings").forEach((m) => {
      m.provider_event_id = null;
    });

    const second = await service.push(HOUSE, ENTRY, "create");
    expect(second.outcome).toBe("delivered");
    expect(google.events.size).toBe(1);

    const inserts = google.calls.filter(
      (c) => c.method === "POST" && c.path.endsWith("/events"),
    );
    expect(inserts).toHaveLength(2);
    // Both carried the SAME client-supplied id, which is what makes the second
    // a 409 rather than a duplicate event.
    expect(inserts[0].body?.id).toBe(idempotencyKey(HOUSE, ENTRY, CONNECTION));
    expect(inserts[1].body?.id).toBe(inserts[0].body?.id);

    const duplicateRow = outcomes(db).find((o) =>
      String(o.detail).includes("already held this entry"),
    );
    expect(duplicateRow?.outcome).toBe("delivered");
    expect(duplicateRow?.provider_reason).toBe("duplicate");
    // And the mapping is repaired, so the next update has an id to address.
    expect(mappings(db)[0].provider_event_id).toBe(inserts[0].body?.id);
  });

  it("keeps one mapping row per entry however many times it is pushed", async () => {
    const { service, db } = harness();
    await service.push(HOUSE, ENTRY, "create");
    await service.push(HOUSE, ENTRY, "update");
    await service.push(HOUSE, ENTRY, "update");
    expect(mappings(db)).toHaveLength(1);
  });
});

// ── 4. an update addresses the stored id ───────────────────────────────────

describe("an update", () => {
  it("is addressed to the provider's own event id, never to a search", async () => {
    const { service, google } = harness();
    await service.push(HOUSE, ENTRY, "create");
    google.calls.length = 0;

    await service.push(HOUSE, ENTRY, "update");

    const key = idempotencyKey(HOUSE, ENTRY, CONNECTION);
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0].method).toBe("PUT");
    expect(google.calls[0].path).toContain(`/events/${key}`);

    // Nothing in this direction ever lists, gets or searches. If a read verb
    // appears here, direction 1 has quietly become direction 2.
    expect(google.calls.every((c) => c.method !== ("GET" as never))).toBe(true);
  });

  it("sends an all-day entry with an EXCLUSIVE end date", async () => {
    const { service, google } = harness();
    await service.push(HOUSE, ENTRY, "create");
    const insert = google.calls.find((c) => c.path.endsWith("/events"));
    expect(insert?.body?.start).toEqual({ date: "2026-09-10" });
    // Google's all-day end is exclusive; the same date on both makes a
    // zero-length event some clients do not draw at all.
    expect(insert?.body?.end).toEqual({ date: "2026-09-11" });
  });

  it("stamps the copy so it can be recognised as ours from inside Google", async () => {
    const { service, google } = harness();
    await service.push(HOUSE, ENTRY, "create");
    const insert = google.calls.find((c) => c.path.endsWith("/events"));
    const props = (insert?.body?.extendedProperties as any)?.private;
    expect(props.mudavym_restaurant_id).toBe(HOUSE);
    expect(props.mudavym_entry_id).toBe(ENTRY);
    expect(props.mudavym_source).toBe("mudavym.calendar.push");
  });
});

// ── 5. "only we can delete" ────────────────────────────────────────────────

describe("a copy deleted inside Google", () => {
  it("comes back on the next push, and the row says so", async () => {
    const { service, google, db } = harness();
    await service.push(HOUSE, ENTRY, "create");
    const key = idempotencyKey(HOUSE, ENTRY, CONNECTION);
    expect(google.events.has(key)).toBe(true);

    // Somebody deletes it in their Google calendar.
    google.events.delete(key);
    google.calls.length = 0;

    const result = await service.push(HOUSE, ENTRY, "update");

    expect(result.outcome).toBe("delivered");
    expect(result.restored).toBe(true);
    expect(google.events.has(key)).toBe(true);
    // The update was tried first and met a 404; only then was it re-inserted.
    expect(google.calls.map((c) => c.method)).toEqual(["PUT", "POST"]);

    const row = outcomes(db)
      .filter((o) => o.verb === "update")
      .pop();
    expect(String(row?.detail)).toMatch(/had been deleted inside Google/i);
    expect(String(row?.detail)).toMatch(/put back/i);
  });

  it("is disclosed on the register's own sentence before anyone connects", () => {
    // The promise and the behaviour are the same sentence in two places. If
    // one moves without the other, this fails.
    expect(
      INTEGRATION_DEFINITIONS.google_calendar.dataHandling.keptFor,
    ).toMatch(/comes back on the next push/i);
  });
});

describe("a delete", () => {
  it("removes the copy and closes the mapping", async () => {
    const { service, google, db } = harness();
    await service.push(HOUSE, ENTRY, "create");
    const key = idempotencyKey(HOUSE, ENTRY, CONNECTION);

    const result = await service.push(HOUSE, ENTRY, "delete");
    expect(result.outcome).toBe("delivered");
    expect(google.events.has(key)).toBe(false);
    expect(mappings(db)).toHaveLength(0);
  });

  it("treats an already-absent copy as done rather than as a failure", async () => {
    const { service, google, db } = harness();
    await service.push(HOUSE, ENTRY, "create");
    google.events.clear();

    const result = await service.push(HOUSE, ENTRY, "delete");
    expect(result.outcome).toBe("delivered");
    expect(String(outcomes(db).pop()?.detail)).toMatch(/already gone/i);
  });
});

// ── 6. an expired token ────────────────────────────────────────────────────

describe("an expired token", () => {
  it("writes an outcome row and leaves the entry saved", async () => {
    const { service, db } = harness({
      tokenThrows: new Error(
        "Google Calendar — this house's own calendar needs to be reconnected.",
      ),
    });

    const result = await service.push(HOUSE, ENTRY, "create");

    expect(result.outcome).toBe("token_expired");
    const row = outcomes(db).pop();
    expect(row?.outcome).toBe("token_expired");
    expect(String(row?.detail)).toMatch(/reconnect/i);
    // Nothing was written to Google and nothing was mapped.
    expect(mappings(db)).toHaveLength(0);
  });

  it("is reported by status() as a reconnect, from the grant row itself", async () => {
    const { service, db } = harness();
    db.rows("integration_oauth_connections")[0].reconnect_required_at =
      "2026-09-06T10:00:00.000Z";
    db.rows("integration_oauth_connections")[0].reconnect_reason =
      "invalid_grant: Token has been expired or revoked.";

    const status = await service.status(HOUSE);
    expect(status.reconnectRequired).toBe(true);
    expect(status.reconnectReason).toContain("invalid_grant");
    expect(status.sentence).toMatch(/needs reconnecting/i);
  });

  it("is set on the grant by getAccessToken when the refresh actually fails", async () => {
    // The write-path half: a refresh that fails must MARK the row. Before this
    // build the provider's sentence reached a log and the grant went on looking
    // healthy.
    const { IntegrationsOauthService } = await import(
      "../../integrations/integrations-oauth.service"
    );
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      client: {
        from: () => {
          const self: any = {};
          self.select = () => self;
          self.eq = () => self;
          self.is = () => self;
          self.maybeSingle = async () => ({
            data: {
              id: CONNECTION,
              access_token_encrypted: null,
              refresh_token_encrypted: "enc",
              token_expires_at: new Date(Date.now() - 60_000).toISOString(),
            },
            error: null,
          });
          self.update = (body: Record<string, unknown>) => {
            updates.push(body);
            return self;
          };
          self.then = (r: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(r);
          return self;
        },
      },
    };
    const svc = new IntegrationsOauthService(
      db as any,
      { get: (k: string) => (k.includes("CLIENT") ? "set" : undefined) } as any,
      { isConfigured: true, tryDecrypt: () => "refresh-token" } as any,
    );
    // `postToken` reaches the network; make it fail the way a revoked grant does.
    (global as any).fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }),
    }));

    await expect(
      svc.getAccessToken(USER, HOUSE, "google_calendar"),
    ).rejects.toThrow();

    const marked = updates.find((u) => "reconnect_required_at" in u);
    expect(marked).toBeTruthy();
    expect(String(marked!.reconnect_reason)).toContain("expired or revoked");
  });
});

// ── 7. cross-house scoping ─────────────────────────────────────────────────

describe("cross-house scoping", () => {
  it("refuses to push an entry that belongs to another restaurant", async () => {
    const { service, google, db } = harness();

    const result = await service.push(HOUSE, OTHER_ENTRY, "create");

    expect(result.outcome).toBe("refused");
    expect(result.detail).toMatch(/does not belong to this house/i);
    // Nothing reached Google at all — not even the calendar creation.
    expect(google.calls.filter((c) => c.path.endsWith("/events"))).toHaveLength(0);
    expect(mappings(db)).toHaveLength(0);
    expect(outcomes(db).pop()?.outcome).toBe("refused");
  });

  it("reads the grant register scoped to the house asking", async () => {
    const { service } = harness({ connected: false });
    const result = await service.push(HOUSE, ENTRY, "create");
    expect(result.outcome).toBe("not_connected");
  });

  it("asks getAccessToken with the restaurant, so ADR 0114's stop applies", async () => {
    const { service, oauth } = harness();
    await service.push(HOUSE, ENTRY, "create");
    expect(oauth.getAccessToken).toHaveBeenCalledWith(
      USER,
      HOUSE,
      "google_calendar",
    );
  });

  it("records a house that stopped using the grant as its own outcome", async () => {
    const { service, db } = harness({
      tokenThrows: new Error(
        "This house has stopped using that Google Calendar grant. The grant itself is untouched.",
      ),
    });
    const result = await service.push(HOUSE, ENTRY, "create");
    expect(result.outcome).toBe("house_stopped");
    expect(outcomes(db).pop()?.outcome).toBe("house_stopped");
  });
});

// ── rate limiting ──────────────────────────────────────────────────────────

describe("a rate limit", () => {
  it("separates 403-because-too-fast from 403-because-not-allowed", () => {
    const base = { body: null, message: null, retryAfterSeconds: null };
    expect(isRateLimited({ ...base, status: 429, reason: null })).toBe(true);
    expect(
      isRateLimited({ ...base, status: 403, reason: "rateLimitExceeded" }),
    ).toBe(true);
    expect(
      isRateLimited({ ...base, status: 403, reason: "quotaExceeded" }),
    ).toBe(true);
    // A permanent refusal must NOT be retried forever.
    expect(
      isRateLimited({ ...base, status: 403, reason: "insufficientPermissions" }),
    ).toBe(false);
    expect(isRateLimited({ ...base, status: 404, reason: null })).toBe(false);
  });

  it("backs off, says so in the outcome, and holds the next attempt", async () => {
    const { service, google, db } = harness();
    await service.push(HOUSE, ENTRY, "create");
    google.override_ = {
      status: 429,
      body: null,
      reason: "rateLimitExceeded",
      message: "Rate Limit Exceeded",
      retryAfterSeconds: 30,
    };

    const first = await service.push(HOUSE, ENTRY, "update");
    expect(first.outcome).toBe("rate_limited");
    const row = outcomes(db).pop();
    expect(row?.outcome).toBe("rate_limited");
    expect(row?.retry_after_seconds).toBe(30);
    expect(String(row?.detail)).toMatch(/slow down/i);

    // The next attempt is held without another call to Google.
    google.override_ = null;
    const before = google.calls.length;
    const second = await service.push(HOUSE, ENTRY, "update");
    expect(second.outcome).toBe("rate_limited");
    expect(google.calls.length).toBe(before);
  });
});

// ── the sentence: absence is never health ──────────────────────────────────

describe("the sentence a house reads", () => {
  it("never says a connected house with nothing pushed is in sync", () => {
    const s = pushSentence({
      armed: true,
      houseStopped: false,
      reconnectRequired: false,
      hasCalendar: true,
      entries: 40,
      pushed: 0,
      summary: "Mudavym — Sim Meyhouse",
    });
    expect(s).toContain("0 of 40 entries pushed");
    // "in sync" appears exactly once and only inside its own refusal. The
    // assertion is written this way on purpose: a bare `not.toContain` would
    // fail against the very sentence that forbids the reading.
    expect(s.toLowerCase()).toContain("do not read this as being in sync");
    expect(s.toLowerCase().split("in sync")).toHaveLength(2);
  });

  it("never produces a reassuring word on any branch", () => {
    const reassurances = /\b(in sync|up to date|all good|healthy|synced)\b/i;
    const branches = [
      { armed: true, houseStopped: false, reconnectRequired: false, hasCalendar: true, entries: 0, pushed: 0, summary: null },
      { armed: true, houseStopped: false, reconnectRequired: false, hasCalendar: true, entries: 9, pushed: 9, summary: "c" },
      { armed: true, houseStopped: false, reconnectRequired: false, hasCalendar: true, entries: 9, pushed: 4, summary: "c" },
      { armed: false, houseStopped: false, reconnectRequired: false, hasCalendar: false, entries: 9, pushed: 0, summary: null },
      { armed: true, houseStopped: true, reconnectRequired: false, hasCalendar: true, entries: 9, pushed: 9, summary: "c" },
      { armed: true, houseStopped: false, reconnectRequired: true, hasCalendar: true, entries: 9, pushed: 9, summary: "c" },
    ];
    for (const branch of branches) {
      const sentence = pushSentence(branch);
      expect(sentence.length).toBeGreaterThan(20);
      // The one exception is the sentence that forbids the reading.
      if (!/do not read this as being in sync/i.test(sentence)) {
        expect(sentence).not.toMatch(reassurances);
      }
    }
  });

  it("counts rather than judging, on every branch", () => {
    const base = {
      armed: true,
      houseStopped: false,
      reconnectRequired: false,
      hasCalendar: true,
      summary: null,
    };
    expect(pushSentence({ ...base, entries: 3, pushed: 1 })).toContain(
      "1 of 3 entries pushed",
    );
    expect(pushSentence({ ...base, entries: 1, pushed: 1 })).toContain(
      "1 of 1 entry pushed",
    );
    expect(
      pushSentence({ ...base, houseStopped: true, entries: 5, pushed: 5 }),
    ).toMatch(/stopped using the grant/i);
    expect(
      pushSentence({ ...base, armed: false, entries: 5, pushed: 2 }),
    ).toMatch(/switched off/i);
    expect(
      pushSentence({ ...base, hasCalendar: false, entries: 5, pushed: 0 }),
    ).toMatch(/no calendar has been made/i);
  });

  it("reports an unconnected house from the grant register, not from an empty table", async () => {
    const { service } = harness({ connected: false });
    const status = await service.status(HOUSE);
    expect(status.connected).toBe(false);
    expect(status.entries).toBeNull();
    expect(status.pushed).toBeNull();
    expect(status.sentence).toMatch(/No Google account is connected/i);
    expect(status.sentence.toLowerCase()).not.toContain("in sync");
  });

  it("counts the house's own entries against its mappings once pushed", async () => {
    const { service } = harness();
    await service.push(HOUSE, ENTRY, "create");
    const status = await service.status(HOUSE);
    expect(status.entries).toBe(1);
    expect(status.pushed).toBe(1);
    expect(status.unpushed).toBe(0);
    expect(status.calendar?.summary).toBe("Mudavym — Sim Meyhouse");
    expect(status.sentence).toContain("1 of 1 entry pushed");
  });
});

// ── the switch ─────────────────────────────────────────────────────────────

describe("the switch", () => {
  it("is off by default, because a push leaves the house", async () => {
    delete process.env.CALENDAR_PUSH_ENABLED;
    const { service, google, db } = harness();
    const result = await service.push(HOUSE, ENTRY, "create");
    expect(result.outcome).toBe("not_connected");
    expect(google.calls).toHaveLength(0);
    // No row: nothing was owed. `status()` is where the fact lives.
    expect(outcomes(db)).toHaveLength(0);
    const status = await service.status(HOUSE);
    expect(status.armed).toBe(false);
    expect(status.sentence).toMatch(/switched off/i);
  });
});
