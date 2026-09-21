import { CalendarService } from "./calendar.service";

/**
 * A view must not mint a credential (fixed 2026-09-21, ADR 0111 §5 bracket).
 *
 * Before this fix, `GET /calendar/ical-token` (`getOrGenerateICalToken`) read
 * the restaurant row and, when `calendar_ical_token` was null, minted
 * `crypto.randomBytes(32)` and persisted it right there — reachable from a
 * plain page mount (`useConnectionsNextData.ts`'s `icalQ`, legacy
 * `Settings.tsx`'s `CalendarSubscriptionSection`), with no role check and no
 * audit row. A page VIEW was writing a permanent, unauthenticated bearer
 * credential.
 *
 * `getICalToken` is now read-only. Minting is `createICalToken`, reached only
 * from the controller's POST and gated on manager/owner. This file pins:
 *
 *   1. THE GATE ITSELF — `getICalToken` never calls `.update()`, on a house
 *      with a token and on a house without one. This is the assertion the
 *      lane's fix exists to make true, and it is built so a mutation that
 *      reintroduces the write is caught: `db.updateCalls` is a real call log
 *      on a stateful stub, not a mock that always reports "not called".
 *   2. `createICalToken` / `revokeICalToken` are idempotent no-ops — and no
 *      audit row — when there is nothing to change.
 *   3. T-30-09 holds across revoke and rotate: the OLD token, after either,
 *      reads through `getICalFeed` exactly as a token that never existed
 *      does — an empty 200, never a 404 (`ical-feed.spec.ts:132-138`). A
 *      revoked-vs-never-issued distinction in the feed's response would be
 *      the validity oracle T-30-09 exists to prevent, so revoke/rotate do not
 *      introduce one: they only make the SELECT stop matching.
 */

interface AuditRow {
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  restaurant_id: string;
  changes: Record<string, unknown>;
}

/** One event, so "the feed serves" is an observed VEVENT, not an assumption. */
const EVENT = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Delivery: PO-1001",
  description: null,
  start_date: "2026-09-22",
  start_time: "09:00",
  end_date: "2026-09-22",
  end_time: "10:00",
  all_day: false,
  status: "approved",
  is_recurring: false,
  parent_event_id: null,
};

/**
 * A stateful `restaurants` + `calendar_events` + `system_audit_log` double,
 * one restaurant row. UPDATE honours its `.eq`/`.is` filters the way
 * PostgREST does — a filter that matches no row changes nothing and returns
 * no row, never an error — so the conditional create is exercised, not
 * assumed. `beforeUpdate` lets a test land a competing write between the
 * service's read and its write (the race the conditional exists for).
 */
function makeStatefulDb(
  restaurantId: string,
  initialToken: string | null,
  opts: { beforeUpdate?: (setToken: (t: string | null) => void) => void } = {},
) {
  let token: string | null = initialToken;
  const setToken = (t: string | null) => {
    token = t;
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  const auditRows: AuditRow[] = [];

  const client: any = {
    from(table: string) {
      if (table === "restaurants") {
        return {
          select: () => {
            let field = "";
            let value: unknown;
            const chain = {
              eq: (f: string, v: unknown) => {
                field = f;
                value = v;
                return chain;
              },
              single: async () => {
                const match =
                  (field === "id" && value === restaurantId) ||
                  (field === "calendar_ical_token" &&
                    token !== null &&
                    value === token);
                if (!match) return { data: null, error: { message: "no rows" } };
                return {
                  data: {
                    id: restaurantId,
                    name: "Test House",
                    timezone: "UTC",
                    calendar_ical_token: token,
                  },
                  error: null,
                };
              },
            };
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            updateCalls.push(payload);
            const filters: Array<[string, unknown]> = [];
            const apply = () => {
              opts.beforeUpdate?.(setToken);
              const matches = filters.every(([f, v]) =>
                f === "id"
                  ? v === restaurantId
                  : f === "calendar_ical_token"
                    ? v === token
                    : false,
              );
              if (matches && "calendar_ical_token" in payload) {
                token = payload.calendar_ical_token as string | null;
              }
              return matches;
            };
            const chain: any = {
              eq: (f: string, v: unknown) => {
                filters.push([f, v]);
                return chain;
              },
              is: (f: string, v: unknown) => {
                filters.push([f, v]);
                return chain;
              },
              select: async () => {
                const matched = apply();
                return {
                  data: matched ? [{ calendar_ical_token: token }] : [],
                  error: null,
                };
              },
              then: (
                resolve: (v: { error: null }) => unknown,
                reject: (e: unknown) => unknown,
              ) => {
                try {
                  apply();
                  return Promise.resolve(resolve({ error: null }));
                } catch (e) {
                  return Promise.resolve(reject(e));
                }
              },
            };
            return chain;
          },
        };
      }
      if (table === "calendar_events") {
        const q: any = {
          select: () => q,
          eq: () => q,
          is: () => q,
          order: async () => ({ data: [EVENT], error: null }),
        };
        return q;
      }
      if (table === "system_audit_log") {
        return {
          insert: async (row: AuditRow) => {
            auditRows.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table in ical-token test double: ${table}`);
    },
  };

  return {
    supabase: client,
    updateCalls,
    auditRows,
    currentToken: () => token,
  };
}

const RID = "r-1";
const ACTOR = "u-1";

function svc(db: ReturnType<typeof makeStatefulDb>) {
  return new CalendarService(db as any, {} as any);
}

describe("getICalToken — read-only, the whole fix", () => {
  it("a house with no token: returns null and writes NOTHING", async () => {
    const db = makeStatefulDb(RID, null);
    const out = await svc(db).getICalToken(RID);

    expect(out).toBeNull();
    // The mutation-tested assertion: any code path that calls
    // `.update()` from a GET fails this, on a stateful double that actually
    // records the call rather than a mock that always says "not called".
    expect(db.updateCalls).toHaveLength(0);
  });

  it("a house with a token already: returns it unchanged and writes NOTHING", async () => {
    const db = makeStatefulDb(RID, "existing-token");
    const out = await svc(db).getICalToken(RID);

    expect(out).toBe("existing-token");
    expect(db.updateCalls).toHaveLength(0);
  });

  it("a failed read is an error, never rendered as 'no token'", async () => {
    const db = makeStatefulDb(RID, null);
    db.supabase.from = () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: "connection reset" } }),
        }),
      }),
    });
    await expect(svc(db).getICalToken(RID)).rejects.toThrow(/connection reset/);
  });
});

describe("createICalToken — the only writer, and only from an explicit act", () => {
  it("mints and audits when there is none", async () => {
    const db = makeStatefulDb(RID, null);
    const out = await svc(db).createICalToken(RID, ACTOR);

    expect(out.created).toBe(true);
    expect(out.token).toHaveLength(64);
    expect(db.updateCalls).toHaveLength(1);
    expect(db.auditRows).toHaveLength(1);
    expect(db.auditRows[0]).toMatchObject({
      actor_id: ACTOR,
      action: "calendar_ical_token_created",
      entity_type: "restaurant",
      entity_id: RID,
      restaurant_id: RID,
    });
    // The credential itself never lands in the audit trail — see the file
    // header on `writeIcalAudit`.
    expect(JSON.stringify(db.auditRows[0].changes)).not.toContain(out.token);
  });

  it("is idempotent: a house that already has one gets it back, nothing written, nothing audited", async () => {
    const db = makeStatefulDb(RID, "already-here");
    const out = await svc(db).createICalToken(RID, ACTOR);

    expect(out).toEqual({ token: "already-here", created: false });
    expect(db.updateCalls).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
  });

  it("a create that loses a race hands back the WINNER's token — never its own dead one — and files no row", async () => {
    // Another create lands between this call's read (null) and its write.
    const db = makeStatefulDb(RID, null, {
      beforeUpdate: (setToken) => setToken("winner-token"),
    });
    const out = await svc(db).createICalToken(RID, ACTOR);

    expect(out).toEqual({ token: "winner-token", created: false });
    // The winner's token is still the stored one: this call replaced nothing.
    expect(db.currentToken()).toBe("winner-token");
    expect(db.auditRows).toHaveLength(0);
  });

  it("no actor on the request: the write still happens, the paper does not, and it is logged", async () => {
    const db = makeStatefulDb(RID, null);
    const out = await svc(db).createICalToken(RID, "");

    expect(out.created).toBe(true);
    expect(db.updateCalls).toHaveLength(1);
    expect(db.auditRows).toHaveLength(0);
  });
});

describe("revokeICalToken", () => {
  it("nulls an existing token and audits it", async () => {
    const db = makeStatefulDb(RID, "tok-to-revoke");
    const out = await svc(db).revokeICalToken(RID, ACTOR);

    expect(out).toEqual({ revoked: true });
    expect(db.currentToken()).toBeNull();
    expect(db.auditRows).toHaveLength(1);
    expect(db.auditRows[0].action).toBe("calendar_ical_token_revoked");
  });

  it("a house with no token: no-op, nothing written, nothing audited", async () => {
    const db = makeStatefulDb(RID, null);
    const out = await svc(db).revokeICalToken(RID, ACTOR);

    expect(out).toEqual({ revoked: false });
    expect(db.updateCalls).toHaveLength(0);
    expect(db.auditRows).toHaveLength(0);
  });

  it("the revoked token stops serving: events before, an empty calendar after — the same answer an unknown token gets (T-30-09)", async () => {
    const db = makeStatefulDb(RID, "tok-to-revoke");

    // Not vacuous: the token serves this house's event until it is revoked.
    const before = await svc(db).getICalFeed("tok-to-revoke");
    expect(before).toContain("BEGIN:VEVENT");
    expect(before).toContain("Delivery: PO-1001");

    await svc(db).revokeICalToken(RID, ACTOR);

    const after = await svc(db).getICalFeed("tok-to-revoke");
    expect(after).toMatch(/^BEGIN:VCALENDAR/);
    expect(after).not.toContain("BEGIN:VEVENT");
    expect(after).not.toContain("Delivery: PO-1001");
    // Identical to a token that never existed, so the response is no oracle.
    const neverIssued = await svc(db).getICalFeed("f".repeat(64));
    expect(after).toBe(neverIssued);
  });
});

describe("regenerateICalToken (rotate)", () => {
  it("replaces the token and audits it", async () => {
    const db = makeStatefulDb(RID, "old-tok");
    const next = await svc(db).regenerateICalToken(RID, ACTOR);

    expect(next).not.toBe("old-tok");
    expect(db.currentToken()).toBe(next);
    expect(db.auditRows).toHaveLength(1);
    expect(db.auditRows[0].action).toBe("calendar_ical_token_rotated");
  });

  it("T-30-09 holds: the OLD token reads as unknown after rotation, and the NEW one serves", async () => {
    const db = makeStatefulDb(RID, "old-tok");
    const next = await svc(db).regenerateICalToken(RID, ACTOR);

    const oldFeed = await svc(db).getICalFeed("old-tok");
    expect(oldFeed).toMatch(/^BEGIN:VCALENDAR/);
    expect(oldFeed).not.toContain("BEGIN:VEVENT");

    // The NEW token serves the house's event through the real feed path.
    const newFeed = await svc(db).getICalFeed(next);
    expect(newFeed).toContain("BEGIN:VEVENT");
    expect(newFeed).toContain("Delivery: PO-1001");
  });
});
