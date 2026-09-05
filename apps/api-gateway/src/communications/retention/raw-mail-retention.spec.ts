/**
 * A mirrored reply states how long it is kept — proved at the seams that
 * matter (ADR 0118, retention, decided 2026-09-05).
 *
 * Nine things, each of which would be a silent falsehood if it broke:
 *
 *   1. A FAILED DISPUTE READ IS NEVER "NO DISPUTES". supabase-js resolves
 *      `{ data, error }` and never throws, so a swallowed error would turn a
 *      database outage into "this house has never disputed anything" and
 *      SHORTEN the window on the strength of it.
 *   2. NO DISPUTES GIVES THE MARGIN, AND SAYS SO. `longest_dispute_days` is
 *      NULL, not 0 — 0 would read as "we measured a dispute and it lasted no
 *      time", which is the absence-as-health shape.
 *   3. THE SPAN IS MEASURED FROM THE CONVERSATION, not from the claim's own
 *      `opened_at`, because a claim is opened after the argument started and
 *      the mail that matters is the mail from before it was opened.
 *   4. THE MARGIN IS TIED TO THE CADENCE. It is one re-derivation interval, and
 *      the constant that says so is the same one the cron's quarter is.
 *   5. A SWEEP THAT DELETED NOTHING STILL WRITES A COUNT (ADR 0078).
 *   6. THE SWEEP NEVER TOUCHES A FACT. The update payload names exactly the raw
 *      columns; `rolling_summary`, `conversation_context`, `detected_intent`
 *      and `detected_sentiment` are absent from it.
 *   7. THE BODY IS TOMBSTONED, NOT EMPTIED. `message_text` is NOT NULL on the
 *      baseline, and an empty string would read as "the vendor sent nothing".
 *   8. REVOCATION IS SCOPED TO THE GRANT. A shared-mailbox reply on the same
 *      order, and a reply mirrored under a second person's grant in the same
 *      house, are not touched.
 *   9. AN UNKNOWN COUNTRY GETS THE STRICTEST RULE AND A SENTENCE SAYING WHY.
 *
 * No test here reaches a network, a mailbox or a live database.
 */

import {
  JURISDICTION_RULES,
  LONGEST_QUARTER_DAYS,
  RETENTION_MARGIN_DAYS,
  resolveJurisdiction,
} from "./retention-rules";
import { RawMailRetentionService } from "./raw-mail-retention.service";
import type { DatabaseService } from "../../database/database.service";
import type { NotificationsService } from "../../notifications/notifications.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const OTHER_GRANT = "ffffffff-0000-4000-8000-ffffffffffff";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const ORDER = "11111111-0000-4000-8000-111111111111";

const DAY = 24 * 60 * 60 * 1000;

type Rows = Record<string, unknown>[] | { error: { message: string } };

interface Recorded {
  tables: string[];
  inserts: Array<{ table: string; body: Record<string, unknown> }>;
  updates: Array<{ table: string; body: Record<string, unknown> }>;
  /** `.eq(col, value)` calls, in order, per table. */
  filters: Array<{ table: string; op: string; args: unknown[] }>;
  removed: string[][];
}

/**
 * A supabase-shaped stub addressed by table, in the same shape
 * `house-inbox.spec.ts` uses. `update(...).select(...)` resolves to the rows
 * the table was seeded with, which is what the real client does and is what
 * makes the deleted count meaningful.
 */
function build(rows: Record<string, Rows>, removeError?: string) {
  const rec: Recorded = {
    tables: [],
    inserts: [],
    updates: [],
    filters: [],
    removed: [],
  };

  const chain = (table: string, payload: Rows) => {
    const failed = !Array.isArray(payload);
    const data = Array.isArray(payload) ? payload : null;
    const error = failed ? (payload as { error: { message: string } }).error : null;
    const self: Record<string, unknown> = {};
    const track =
      (op: string) =>
      (...args: unknown[]) => {
        rec.filters.push({ table, op, args });
        return self;
      };
    self.select = track("select");
    self.eq = track("eq");
    self.in = track("in");
    self.is = track("is");
    self.not = track("not");
    self.order = track("order");
    self.limit = track("limit");
    self.insert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.upsert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.update = (body: Record<string, unknown>) => {
      rec.updates.push({ table, body });
      return self;
    };
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.maybeSingle = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve);
    return self;
  };

  const db = {
    supabase: {
      from: (table: string) => {
        rec.tables.push(table);
        return chain(table, rows[table] ?? []);
      },
      storage: {
        from: () => ({
          remove: (paths: string[]) => {
            rec.removed.push(paths);
            return Promise.resolve({
              data: null,
              error: removeError ? { message: removeError } : null,
            });
          },
        }),
      },
    },
  } as unknown as DatabaseService;

  return { rec, db };
}

function notifier() {
  const calls: Array<{
    restaurantId: string;
    payload: Record<string, unknown>;
    opts: Record<string, unknown>;
  }> = [];
  const service = {
    persistForRestaurant: jest.fn(
      async (
        restaurantId: string,
        payload: Record<string, unknown>,
        opts: Record<string, unknown>,
      ) => {
        calls.push({ restaurantId, payload, opts });
        return { inserted: 1, ids: ["n1"] };
      },
    ),
  } as unknown as NotificationsService;
  return { service, calls };
}

const HOUSE_ROW = { id: HOUSE, country: "Türkiye", state_province: null };

describe("the rule table", () => {
  it("carries a URL and a fetch date on every statute it cites", () => {
    for (const rule of Object.values(JURISDICTION_RULES)) {
      expect(rule.citations.length).toBeGreaterThan(0);
      for (const c of rule.citations) {
        expect(c.url).toMatch(/^https:\/\//);
        expect(c.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Not a placeholder. A one-line "says" is the same absence wearing a
        // value, the fault `gmail-read-asks-for-one-thing.spec.ts` already
        // guards for the data-handling block.
        expect(c.says.trim().length).toBeGreaterThan(60);
        expect(c.statute.trim().length).toBeGreaterThan(8);
      }
      expect(rule.why.trim().length).toBeGreaterThan(40);
    }
  });

  it("ties the margin to the re-derivation cadence, not to a round number", () => {
    // If the cadence stops being quarterly this fails, which is the point:
    // a margin shorter than the gap between two derivations can expire mail on
    // a figure a dispute opened since has already made too short.
    expect(RETENTION_MARGIN_DAYS).toBe(LONGEST_QUARTER_DAYS);
    expect(RETENTION_MARGIN_DAYS % 30).not.toBe(0);
  });

  it("gives an unrecorded country the strictest floor AND a sentence saying why", () => {
    expect(resolveJurisdiction(null)).toBe("UNKNOWN");
    expect(resolveJurisdiction("   ")).toBe("UNKNOWN");
    // A country nobody researched is UNKNOWN, not a nearest guess.
    expect(resolveJurisdiction("France")).toBe("UNKNOWN");

    const unknown = JURISDICTION_RULES.UNKNOWN;
    const longest = Math.max(
      ...Object.values(JURISDICTION_RULES).map((r) => r.factsFloorYears),
    );
    expect(unknown.factsFloorYears).toBe(longest);
    expect(unknown.defaultedBecause).toBeTruthy();
    expect(unknown.defaultedBecause!.length).toBeGreaterThan(80);
    // Every other row is a rule that was CHOSEN, so none of them carries the
    // defaulted sentence — a reader must be able to tell the two apart.
    for (const [code, rule] of Object.entries(JURISDICTION_RULES)) {
      if (code === "UNKNOWN") continue;
      expect(rule.defaultedBecause).toBeUndefined();
    }
  });

  it("resolves the four researched jurisdictions and only those", () => {
    expect(resolveJurisdiction("Türkiye")).toBe("TR");
    expect(resolveJurisdiction("TR")).toBe("TR");
    expect(resolveJurisdiction("United Kingdom")).toBe("GB");
    expect(resolveJurisdiction("United States")).toBe("US");
    expect(resolveJurisdiction("United States", "California")).toBe("US-CA");
    expect(resolveJurisdiction("United States", "NY")).toBe("US");
    expect(JURISDICTION_RULES.TR.factsFloorYears).toBe(10);
    expect(JURISDICTION_RULES.GB.factsFloorYears).toBe(6);
    // Türkiye is the one whose statute reaches the correspondence itself, and
    // the table must keep saying so rather than smoothing it away.
    expect(JURISDICTION_RULES.TR.bindsCorrespondence).toBe(true);
    expect(JURISDICTION_RULES.GB.bindsCorrespondence).toBe(false);
  });
});

describe("deriving the window", () => {
  it("REFUSES to derive when the dispute ledger could not be read", async () => {
    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: { error: { message: "connection reset" } },
    });
    const service = new RawMailRetentionService(db);

    await expect(service.computeWindow(HOUSE)).rejects.toThrow(
      /disputes could not be read/i,
    );
    // And it never quietly becomes the short answer.
    await expect(service.computeWindow(HOUSE)).rejects.toThrow(
      /never disputed anything/i,
    );
  });

  it("gives a house with no disputes the margin alone, with NULL not zero", async () => {
    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: [],
    });
    const service = new RawMailRetentionService(db);

    const derived = await service.computeWindow(HOUSE);
    expect(derived.basisKind).toBe("no_dispute_recorded");
    expect(derived.longestDisputeDays).toBeNull();
    expect(derived.figureDays).toBe(RETENTION_MARGIN_DAYS);
    expect(derived.disputesConsidered).toBe(0);
    expect(derived.basis).toMatch(/recorded no dispute/i);
    expect(derived.basis).toMatch(/shortest figure this rule can produce/i);
  });

  it("measures the span from the first message on the order, not from the claim", async () => {
    const now = Date.now();
    const conversationStart = new Date(now - 200 * DAY).toISOString();
    const claimOpened = new Date(now - 30 * DAY).toISOString();
    const settled = new Date(now - 10 * DAY).toISOString();

    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: [
        {
          id: "c1",
          order_id: ORDER,
          opened_at: claimOpened,
          settled_at: settled,
          state: "credited",
        },
      ],
      procurement_conversations: [
        { order_id: ORDER, created_at: conversationStart },
        { order_id: ORDER, created_at: claimOpened },
      ],
    });
    const service = new RawMailRetentionService(db);

    const derived = await service.computeWindow(HOUSE);
    expect(derived.basisKind).toBe("dispute_span");
    // 200 days back to 10 days back = 190 days. From the CLAIM it would have
    // been 20, which is the whole point of the distinction.
    expect(derived.longestDisputeDays).toBe(190);
    expect(derived.figureDays).toBe(190 + RETENTION_MARGIN_DAYS);
    expect(derived.basis).toContain("190 day");
  });

  it("treats a still-open claim as running until today", async () => {
    const now = Date.now();
    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: [
        {
          id: "c1",
          order_id: null,
          opened_at: new Date(now - 45 * DAY).toISOString(),
          settled_at: null,
          state: "open",
        },
      ],
    });
    const service = new RawMailRetentionService(db);

    const derived = await service.computeWindow(HOUSE);
    // A range, not a number, and the reason is the assertion's own honesty:
    // the open end of the span is the SERVICE's `Date.now()`, which is a few
    // milliseconds after the fixture's, so `Math.ceil` lands on 45 or 46
    // depending on how fast the suite ran. Pinning it to one of the two made
    // this test pass alone and fail in the full run, which is a test asserting
    // the clock rather than the behaviour. What is being proved is that an
    // unsettled claim runs to today instead of being skipped for having no
    // `settled_at`.
    expect(derived.longestDisputeDays).toBeGreaterThanOrEqual(45);
    expect(derived.longestDisputeDays).toBeLessThanOrEqual(46);
    expect(derived.basisKind).toBe("dispute_span");
  });

  it("resolves the jurisdiction from the house and stores it with the figure", async () => {
    const { rec, db } = build({
      restaurants: [{ id: HOUSE, country: "Türkiye", state_province: null }],
      procurement_credits: [],
    });
    const service = new RawMailRetentionService(db);

    await service.deriveWindow(HOUSE);
    const written = rec.inserts.find(
      (i) => i.table === "house_mail_retention_windows",
    );
    expect(written).toBeDefined();
    expect(written!.body.jurisdiction).toBe("TR");
    expect(written!.body.facts_floor_years).toBe(10);
    expect(written!.body.jurisdiction_source).toBe("restaurants.country");
    // Explicit keys on every write: a row can never be short of a field
    // because a branch did not run.
    for (const key of [
      "restaurant_id",
      "figure_days",
      "basis",
      "basis_kind",
      "longest_dispute_days",
      "disputes_considered",
      "margin_days",
      "jurisdiction",
      "jurisdiction_source",
      "facts_floor_years",
      "derived_at",
    ]) {
      expect(Object.keys(written!.body)).toContain(key);
    }
  });

  it("says the country was not recorded rather than picking one", async () => {
    const { rec, db } = build({
      restaurants: [{ id: HOUSE, country: null, state_province: null }],
      procurement_credits: [],
    });
    const service = new RawMailRetentionService(db);

    const derived = await service.deriveWindow(HOUSE);
    expect(derived.jurisdiction).toBe("UNKNOWN");
    expect(derived.jurisdictionSource).toBe("unrecorded");
    const written = rec.inserts.find(
      (i) => i.table === "house_mail_retention_windows",
    );
    expect(written!.body.jurisdiction_source).toBe("unrecorded");
  });
});

describe("the sweep", () => {
  it("records a count on a run that deleted nothing", async () => {
    const now = Date.now();
    const { rec, db } = build({
      house_mail_retention_windows: [
        { figure_days: 100, derived_at: new Date(now).toISOString() },
      ],
      procurement_conversations: [
        {
          id: "m1",
          received_at: new Date(now - 5 * DAY).toISOString(),
          created_at: new Date(now - 5 * DAY).toISOString(),
        },
      ],
    });
    const service = new RawMailRetentionService(db);

    const run = await service.sweepHouse(HOUSE);
    expect(run.considered).toBe(1);
    expect(run.deleted).toBe(0);

    const count = rec.inserts.find(
      (i) => i.table === "house_mail_retention_sweeps",
    );
    expect(count).toBeDefined();
    expect(count!.body.considered).toBe(1);
    expect(count!.body.deleted).toBe(0);
    // No conditional spread anywhere: both counts are present as keys even at
    // zero, which is what makes a zero distinguishable from an omission.
    expect(Object.keys(count!.body)).toEqual(
      expect.arrayContaining(["considered", "deleted", "window_days", "reason"]),
    );
  });

  it("records a count even when the house has no window derived yet", async () => {
    const { rec, db } = build({ house_mail_retention_windows: [] });
    const service = new RawMailRetentionService(db);

    const run = await service.sweepHouse(HOUSE);
    expect(run.deleted).toBe(0);
    expect(run.says).toMatch(/refuses to invent one/i);
    expect(
      rec.inserts.some((i) => i.table === "house_mail_retention_sweeps"),
    ).toBe(true);
  });

  it("tombstones the body and never touches a fact column", async () => {
    const now = Date.now();
    const old = new Date(now - 500 * DAY).toISOString();
    const { rec, db } = build({
      house_mail_retention_windows: [
        { figure_days: 100, derived_at: new Date(now).toISOString() },
      ],
      procurement_conversations: [
        { id: "m1", received_at: old, created_at: old },
      ],
      conversation_attachments: [
        { id: "a1", storage_path: `${HOUSE}/m1/deadbeef-invoice.pdf` },
      ],
    });
    const service = new RawMailRetentionService(db);

    await service.sweepHouse(HOUSE);

    const update = rec.updates.find(
      (u) => u.table === "procurement_conversations",
    );
    expect(update).toBeDefined();

    // The raw columns, and exactly these.
    expect(Object.keys(update!.body).sort()).toEqual([
      "content",
      "email_headers",
      "message_text",
      "raw_deleted_at",
      "raw_deleted_reason",
    ]);

    // Not empty. An empty body reads as "the vendor sent nothing".
    const tombstone = String(update!.body.message_text);
    expect(tombstone.length).toBeGreaterThan(80);
    expect(tombstone).toMatch(/retention window ran out/i);
    expect(tombstone).toMatch(/order's own record and was not deleted/i);
    expect(update!.body.raw_deleted_reason).toBe("window_expired");

    // The attachment BYTES go; the row stays and is stamped.
    expect(rec.removed).toEqual([[`${HOUSE}/m1/deadbeef-invoice.pdf`]]);
    const stamp = rec.updates.find(
      (u) => u.table === "conversation_attachments",
    );
    expect(Object.keys(stamp!.body)).toEqual(["bytes_deleted_at"]);
  });
});

describe("revocation", () => {
  it("deletes only what THIS grant mirrored, and tells the owner", async () => {
    const { rec, db } = build({
      procurement_conversations: [
        { id: "m1", restaurant_id: HOUSE },
        { id: "m2", restaurant_id: HOUSE },
      ],
      conversation_attachments: [],
    });
    const notify = notifier();
    const service = new RawMailRetentionService(db, notify.service);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: PERSON,
    });

    expect(run.deleted).toBe(2);
    expect(run.reason).toBe("grant_revoked");

    // The scope is the CONNECTION, not the restaurant: a shared-mailbox reply
    // and a second person's mirrored reply in the same house are covered by no
    // grant of this person's.
    const scoped = rec.filters.filter(
      (f) => f.table === "procurement_conversations" && f.op === "eq",
    );
    expect(scoped).toContainEqual({
      table: "procurement_conversations",
      op: "eq",
      args: ["mirrored_by_grant_id", GRANT],
    });
    expect(
      scoped.some((f) => String(f.args[0]) === "restaurant_id"),
    ).toBe(false);

    // The notice goes through the producers' own funnel, to that one person.
    expect(notify.calls).toHaveLength(1);
    expect(notify.calls[0].restaurantId).toBe(HOUSE);
    expect(notify.calls[0].opts.onlyUserIds).toEqual([PERSON]);
    expect(notify.calls[0].opts.broadcast).toBe(false);
    expect(String(notify.calls[0].payload.message)).toMatch(
      /stays on the restaurant's own record/i,
    );
    expect(run.notice).toMatch(/owner of the grant was told/i);
  });

  it("says nothing was deleted rather than reporting success, when the read fails", async () => {
    const { db } = build({
      procurement_conversations: { error: { message: "timeout" } },
    });
    const notify = notifier();
    const service = new RawMailRetentionService(db, notify.service);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: PERSON,
    });

    expect(run.deleted).toBe(0);
    expect(run.error).toMatch(/could not be read/i);
    expect(run.says).toMatch(/The mail is still there/i);
  });

  it("does not pretend a notice went out when there is no notifier", async () => {
    const { db } = build({
      procurement_conversations: [{ id: "m1", restaurant_id: HOUSE }],
      conversation_attachments: [],
    });
    const service = new RawMailRetentionService(db);

    const run = await service.sweepForRevokedGrant({
      connectionId: OTHER_GRANT,
      restaurantId: OTHER_HOUSE,
      ownerUserId: PERSON,
    });

    expect(run.deleted).toBe(1);
    expect(run.notice).toMatch(/No notice was sent/i);
    expect(run.notice).toMatch(/deletion still happened/i);
  });
});

describe("the disclosure the consent screen reads", () => {
  it("reports the STORED figure when there is one, and says when it was derived", async () => {
    const derivedAt = "2026-07-01T03:00:00.000Z";
    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: [],
      house_mail_retention_windows: [
        {
          figure_days: 300,
          basis: "the stored sentence",
          derived_at: derivedAt,
        },
      ],
    });
    const service = new RawMailRetentionService(db);

    const disclosure = await service.disclosureFor(HOUSE);
    expect(disclosure.figureDays).toBe(300);
    expect(disclosure.figureFrom).toBe("stored_derivation");
    expect(disclosure.storedAt).toBe(derivedAt);
    // The stored figure and a fresh measure disagree here, and the page is told
    // rather than shown one number as if it were both.
    expect(disclosure.wouldBeDays).toBe(RETENTION_MARGIN_DAYS);
    expect(disclosure.basis).toMatch(/Measured again just now/i);
  });

  it("says a figure is a live measure when nothing has been derived yet", async () => {
    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: [],
      house_mail_retention_windows: [],
    });
    const service = new RawMailRetentionService(db);

    const disclosure = await service.disclosureFor(HOUSE);
    expect(disclosure.figureFrom).toBe("measured_now");
    expect(disclosure.storedAt).toBeNull();
    expect(disclosure.wouldBeDays).toBeNull();
    expect(disclosure.basis).toMatch(/No quarterly derivation has been stored/i);
    // The grants it covers come from the server, so the page never hard-codes
    // an integration id against it.
    expect(disclosure.appliesTo).toContain("gmail_read");
    expect(disclosure.appliesTo).not.toContain("gmail_send");
  });

  it("refuses to print a figure it could not source", async () => {
    const { db } = build({
      restaurants: [HOUSE_ROW],
      procurement_credits: [],
      house_mail_retention_windows: { error: { message: "permission denied" } },
    });
    const service = new RawMailRetentionService(db);

    await expect(service.disclosureFor(HOUSE)).rejects.toThrow(
      /will not print a figure it cannot source/i,
    );
  });
});
