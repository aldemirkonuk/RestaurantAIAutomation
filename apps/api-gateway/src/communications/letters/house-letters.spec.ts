/**
 * The house letter path, proved at the seams that matter (ADR 0118).
 *
 * Six things, each of which would be a silent falsehood if it broke:
 *
 *   1. NO HOUSE SENDER IS THE ANSWER TODAY, and it is `none` with a reason —
 *      not `house_mailbox` because a Google account happens to be connected.
 *      The distinction is a SCOPE, read off the stored `scopes` array.
 *   2. A FAILED READ IS `unknown`, never `none`. "This house has no mailbox"
 *      and "we could not find out" are different sentences.
 *   3. AN OFF-BOOK ADDRESS IS REFUSED, and the refusal names the addresses that
 *      ARE on record rather than saying "invalid".
 *   4. THE GUARDRAIL RUNS OVER A HUMAN DRAFT, blocks, and carries the sentence.
 *   5. THE HOUSE'S ADR-0114 REVOKE STOPS A LETTER. The queue calls the one door
 *      that enforces it and lets the ForbiddenException through untouched.
 *   6. THE UNDO WINDOW IS REAL: a queued letter cancels before its window
 *      closes and REFUSES to be marked cancelled after it, because by then the
 *      dispatcher may hold it and "cancelled" would be a claim about a letter
 *      that went.
 *
 * The dispatcher itself is exercised with a stubbed `fetch`, so the request
 * shape (bearer token, base64url raw, the 403-scope message) is proved without
 * a network and without a real mailbox.
 */

import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import {
  HouseSenderService,
  GMAIL_SEND_SCOPE,
  HOUSE_LETTER_UNDO_MS,
} from "./house-sender.service";
import {
  HouseLettersService,
  LETTER_STATUS,
  AI_ONLY_STATUS,
  mergeFieldsIn,
  sameAddress,
  sendThroughGrant,
} from "./house-letters.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";

interface Recorded {
  tables: string[];
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

/**
 * A supabase-shaped stub whose rows are addressed BY TABLE, and which records
 * what was written. Deliberately not a mock of the service under test: the
 * refusals must be proved against the queries the service really issues.
 */
function build(
  rows: Record<
    string,
    Record<string, unknown>[] | { error: { message: string } }
  >,
) {
  const rec: Recorded = { tables: [], inserts: [], updates: [] };

  const chain = (
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
      rec.inserts.push(body);
      return self;
    };
    self.update = (body: Record<string, unknown>) => {
      rec.updates.push(body);
      return self;
    };
    self.single = () =>
      Promise.resolve({ data: data?.[0] ?? { id: "letter-1" }, error });
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
        return chain(rows[table] ?? []);
      },
    },
  } as unknown as DatabaseService;

  return { rec, db };
}

function configWith(values: Record<string, string | undefined>) {
  return { get: (k: string) => values[k] } as never;
}

const OAUTH_OK = {
  getAccessToken: jest.fn().mockResolvedValue("ya29.token"),
} as unknown as IntegrationsOauthService;

const BOOK_ROWS = {
  providers: [
    {
      id: PROVIDER,
      name: "Fikri Tarım Gıda",
      contact_email: "fikri@fikritarim.com",
      primary_contact: { name: "Fikri", email: "fikri@fikritarim.com" },
    },
  ],
  provider_contacts: [
    {
      provider_id: PROVIDER,
      name: "Muhasebe",
      email: "muhasebe@fikritarim.com",
    },
  ],
};

const GRANT_WITH_SEND = {
  id: "conn-1",
  user_id: PERSON,
  integration_id: "gmail_send",
  provider: "google",
  account_email: "siparis@lokantamudavim.com",
  scopes: [GMAIL_SEND_SCOPE, "openid"],
  restaurant_id: HOUSE,
  revoked_at: null,
};

const GRANT_DRIVE_ONLY = {
  ...GRANT_WITH_SEND,
  integration_id: "google_drive",
  scopes: ["https://www.googleapis.com/auth/drive.file", "openid", "email"],
};

// ===========================================================================
// 1 + 2 — which mailbox, and what "we do not know" looks like
// ===========================================================================

describe("the house's sending identity", () => {
  it("is `none`, with the reason, when nothing is connected at all", async () => {
    const { db } = build({ integration_oauth_connections: [] });
    const sender = new HouseSenderService(db, configWith({}));
    const identity = await sender.resolve(HOUSE, PERSON);

    expect(identity.kind).toBe("none");
    expect(identity.sendable).toBe(false);
    expect(identity.ceremony).toBe("none");
    expect(identity.words).toContain("has not connected a mailbox of its own");
    // The deployment mailbox is NAMED as refused, not merely absent.
    expect(identity.deployment.address).toBe("notifications@wineops.ai");
    expect(identity.deployment.refusedBecause).toContain(
      "belongs to the deployment",
    );
  });

  it("is still `none` when a Google account is connected WITHOUT the send scope", async () => {
    const { db } = build({ integration_oauth_connections: [GRANT_DRIVE_ONLY] });
    const sender = new HouseSenderService(db, configWith({}));
    const identity = await sender.resolve(HOUSE, PERSON);

    // The whole point: a connection is not a consent to send.
    expect(identity.kind).toBe("none");
    expect(identity.words).toContain("granted file access, not sending");
    expect(identity.missing.join(" ")).toContain(GMAIL_SEND_SCOPE);
  });

  it("becomes the house's own mailbox once the send scope is actually granted", async () => {
    const { db } = build({ integration_oauth_connections: [GRANT_WITH_SEND] });
    const sender = new HouseSenderService(db, configWith({}));
    const identity = await sender.resolve(HOUSE, PERSON);

    expect(identity.kind).toBe("house_mailbox");
    expect(identity.address).toBe("siparis@lokantamudavim.com");
    expect(identity.ceremony).toBe("undo");
    expect(identity.undoMs).toBe(HOUSE_LETTER_UNDO_MS);
  });

  it("wears the seal, and no undo window, on a provisioned Mudavym subdomain", async () => {
    const { db } = build({ integration_oauth_connections: [] });
    const sender = new HouseSenderService(
      db,
      configWith({ MUDAVYM_SENDING_DOMAIN: "mail.mudavym.com" }),
    );
    const identity = await sender.resolve(HOUSE, PERSON);

    expect(identity.kind).toBe("mudavym_subdomain");
    expect(identity.ceremony).toBe("seal");
    expect(identity.undoMs).toBeNull();
    expect(identity.words).toContain("deliverability");
  });

  it("says the subdomain is a PAID tier, and never states a price", async () => {
    const { db } = build({ integration_oauth_connections: [] });
    const sender = new HouseSenderService(db, configWith({}));
    const identity = await sender.resolve(HOUSE, PERSON);

    expect(identity.subdomain.tier).toBe("paid");
    expect(identity.subdomain.words).toContain("paid-tier option");
    expect(identity.subdomain.words).toContain("free plan");
    // Pricing is OD-23 and belongs to the founder, not to this resolver.
    expect(identity.subdomain.words).not.toMatch(/[$€£₺]\s?\d|\bper month\b/);
  });

  it("a FAILED read is `unknown`, which is not `none`", async () => {
    const { db } = build({
      integration_oauth_connections: { error: { message: "ECONNREFUSED" } },
    });
    const sender = new HouseSenderService(db, configWith({}));
    const identity = await sender.resolve(HOUSE, PERSON);

    expect(identity.kind).toBe("unknown");
    expect(identity.kind).not.toBe("none");
    expect(identity.sendable).toBe(false);
    expect(identity.words).toContain("ECONNREFUSED");
    expect(identity.words).toContain("failed read, not an empty answer");
  });
});

// ===========================================================================
// 3 + 4 + 5 — the refusals, in the order that makes each of them reachable
// ===========================================================================

describe("queueing a letter", () => {
  function service(
    rows: Record<
      string,
      Record<string, unknown>[] | { error: { message: string } }
    >,
    config: Record<string, string | undefined> = {},
    oauth: IntegrationsOauthService = OAUTH_OK,
  ) {
    const { rec, db } = build(rows);
    const sender = new HouseSenderService(db, configWith(config));
    return { rec, service: new HouseLettersService(db, sender, oauth) };
  }

  const draft = {
    providerId: PROVIDER,
    to: "fikri@fikritarim.com",
    subject: "Standing order",
    body: "Merhaba, geçen haftanın teslimatını konuşabilir miyiz?",
  };

  it("refuses an address the book does not hold, and names the ones it does", async () => {
    const { service: svc } = service({
      ...BOOK_ROWS,
      integration_oauth_connections: [],
    });
    await expect(
      svc.queue({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { ...draft, to: "someone@elsewhere.com" },
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    await svc
      .queue({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { ...draft, to: "someone@elsewhere.com" },
      })
      .catch((e) => {
        expect(String(e.message)).toContain("not in this house's book");
        // The addresses that ARE on record, so the refusal is actionable.
        expect(String(e.message)).toContain("fikri@fikritarim.com");
        expect(String(e.message)).toContain("muhasebe@fikritarim.com");
      });
  });

  it("blocks commitment language in a HUMAN draft, with the sentence", async () => {
    const { service: svc } = service({
      ...BOOK_ROWS,
      integration_oauth_connections: [],
    });
    await svc
      .queue({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { ...draft, body: "We accept your price of 480 per case." },
      })
      .then(
        () => {
          throw new Error("a commitment letter was queued");
        },
        (e) => {
          const said = JSON.stringify(e.getResponse());
          expect(said).toContain("binding purchase commitment");
          expect(said).toContain("commitment_language");
        },
      );
  });

  it("blocks an unfilled merge field — a raw placeholder is a claim", async () => {
    const { service: svc } = service({
      ...BOOK_ROWS,
      integration_oauth_connections: [],
    });
    await svc
      .queue({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { ...draft, body: "Son fiyatınız {{last_price}} idi." },
      })
      .then(
        () => {
          throw new Error("a letter with an unfilled merge field was queued");
        },
        (e) => {
          expect(JSON.stringify(e.getResponse())).toContain(
            "unresolved_merge_field",
          );
        },
      );
  });

  it("refuses when the house has no sending identity — AFTER the book and the guardrails", async () => {
    const { service: svc } = service({
      ...BOOK_ROWS,
      integration_oauth_connections: [],
    });
    await expect(
      svc.queue({ restaurantId: HOUSE, userId: PERSON, dto: draft }),
    ).rejects.toThrow(ConflictException);
    await svc
      .queue({ restaurantId: HOUSE, userId: PERSON, dto: draft })
      .catch((e) => {
        expect(String(e.message)).toContain("No house sender");
        expect(String(e.message)).toContain(
          "Nothing was queued and nothing was sent",
        );
      });
  });

  it("lets the house's ADR-0114 revoke stop the letter, untranslated", async () => {
    const revoked = {
      getAccessToken: jest
        .fn()
        .mockRejectedValue(
          new ForbiddenException(
            "This house has stopped using that Gmail grant. The grant itself is untouched.",
          ),
        ),
    } as unknown as IntegrationsOauthService;

    const { service: svc } = service(
      { ...BOOK_ROWS, integration_oauth_connections: [GRANT_WITH_SEND] },
      {},
      revoked,
    );

    // A 403 must stay a 403: turning it into "could not be used" would hide a
    // deliberate act by a manager behind a generic outage.
    await expect(
      svc.queue({ restaurantId: HOUSE, userId: PERSON, dto: draft }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("queues a letter as QUEUED — never as the AI cron's own status", async () => {
    const { rec, service: svc } = service({
      ...BOOK_ROWS,
      integration_oauth_connections: [GRANT_WITH_SEND],
      analytics_insights: [],
    });
    const out = await svc.queue({
      restaurantId: HOUSE,
      userId: PERSON,
      dto: draft,
    });

    expect(out.status).toBe(LETTER_STATUS.QUEUED);
    const written = rec.inserts[0];
    expect(written.status).toBe("HOUSE_QUEUED");
    // `processScheduledAutoSends` selects AUTO_SEND_SCHEDULED and nothing else.
    // A house letter wearing that word would be dispatched by the AI's cron
    // through the deployment mailbox.
    expect(written.status).not.toBe(AI_ONLY_STATUS);
    expect(written.ai_generated).toBe(false);
    expect(written.outbound_email_type).toBe("HOUSE_LETTER");
    expect(out.says).toContain("has not been sent");
    expect(out.says).not.toMatch(/\bSent\b/);
  });

  it("records only the insight sentences it could re-read", async () => {
    const { rec, service: svc } = service({
      ...BOOK_ROWS,
      integration_oauth_connections: [GRANT_WITH_SEND],
      analytics_insights: [
        {
          candidate_key: "weekday.baseline.wednesday",
          category: "sales",
          sentence: "Wednesday came in 38% under its own average.",
          period_start: "2026-08-01",
          period_end: "2026-08-28",
          computed_at: "2026-09-01T06:00:00Z",
        },
      ],
    });

    const out = await svc.queue({
      restaurantId: HOUSE,
      userId: PERSON,
      dto: {
        ...draft,
        insights: [
          {
            candidateKey: "weekday.baseline.wednesday",
            sentence: "Wednesday came in 38% under its own average.",
          },
          // A sentence the engine never said. It must not be recorded as if it
          // had — a provenance chip is only worth the row behind it.
          { candidateKey: "invented.rule", sentence: "Sales are up 400%." },
        ],
      },
    });

    expect(out.insightsRecorded).toBe(1);
    const recorded = rec.inserts[0].inserted_insights as Record<
      string,
      unknown
    >[];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].candidate_key).toBe("weekday.baseline.wednesday");
    expect(recorded[0].computed_at).toBe("2026-09-01T06:00:00Z");
  });
});

// ===========================================================================
// 6 — the undo window
// ===========================================================================

describe("pulling a letter back", () => {
  function svcWith(row: Record<string, unknown>) {
    const { rec, db } = build({ procurement_conversations: [row] });
    const sender = new HouseSenderService(db, configWith({}));
    return { rec, service: new HouseLettersService(db, sender, OAUTH_OK) };
  }

  it("cancels a letter still inside its window", async () => {
    const { rec, service } = svcWith({
      id: "letter-1",
      status: LETTER_STATUS.QUEUED,
      scheduled_send_at: new Date(Date.now() + 60_000).toISOString(),
      restaurant_id: HOUSE,
    });
    const out = await service.cancel({ restaurantId: HOUSE, id: "letter-1" });
    expect(out.status).toBe(LETTER_STATUS.CANCELLED);
    expect(rec.updates[0].status).toBe("HOUSE_CANCELLED");
    expect(out.says).toContain("never sent");
  });

  it("REFUSES to cancel once the window has closed, rather than claiming it stopped it", async () => {
    const { service } = svcWith({
      id: "letter-1",
      status: LETTER_STATUS.QUEUED,
      scheduled_send_at: new Date(Date.now() - 1_000).toISOString(),
      restaurant_id: HOUSE,
    });
    await expect(
      service.cancel({ restaurantId: HOUSE, id: "letter-1" }),
    ).rejects.toThrow(ConflictException);
    await service.cancel({ restaurantId: HOUSE, id: "letter-1" }).catch((e) => {
      expect(String(e.message)).toContain("was NOT cancelled");
    });
  });

  it("refuses a letter that is not queued at all", async () => {
    const { service } = svcWith({
      id: "letter-1",
      status: "SENT",
      scheduled_send_at: null,
      restaurant_id: HOUSE,
    });
    await expect(
      service.cancel({ restaurantId: HOUSE, id: "letter-1" }),
    ).rejects.toThrow(ConflictException);
  });
});

// ===========================================================================
// The dispatcher's request, without a network
// ===========================================================================

describe("sending through the house's own grant", () => {
  it("uses the grant's bearer token and a base64url MIME body", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "gmail-1" }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    const id = await sendThroughGrant({
      token: "ya29.token",
      from: "siparis@lokantamudavim.com",
      to: "fikri@fikritarim.com",
      subject: "Standing order",
      text: "Merhaba,",
      fetchImpl,
    });

    expect(id).toBe("gmail-1");
    const [url, init] = calls[0];
    // `users/me`, not a configured address: the letter leaves from the mailbox
    // that granted, which is the whole difference from GmailService.
    expect(url).toContain("gmail/v1/users/me/messages/send");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ya29.token",
    );
    const raw = JSON.parse(String(init.body)).raw as string;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: siparis@lokantamudavim.com");
    expect(decoded).toContain("To: fikri@fikritarim.com");
    expect(decoded).toContain("Merhaba,");
  });

  it("names the missing scope on a 403 rather than widening it", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 403,
      json: async () => null,
      text: async () => "Request had insufficient authentication scopes.",
    })) as unknown as typeof fetch;

    await expect(
      sendThroughGrant({
        token: "t",
        from: "a@b.com",
        to: "c@d.com",
        subject: "s",
        text: "t",
        fetchImpl,
      }),
    ).rejects.toThrow(/gmail\.send/);
  });
});

// ===========================================================================
// Small pieces, pinned
// ===========================================================================

describe("the small rules", () => {
  it("compares addresses case- and whitespace-insensitively", () => {
    expect(sameAddress(" Fikri@FikriTarim.com ", "fikri@fikritarim.com")).toBe(
      true,
    );
    expect(sameAddress("a@b.com", "a@c.com")).toBe(false);
  });

  it("declares a template's merge fields from its own text, in order, once each", () => {
    expect(
      mergeFieldsIn(
        "Son fiyat {{last_price}} ve {{vendor}} — {{last_price}}",
        "{{vendor}} için",
      ),
    ).toEqual([{ key: "vendor" }, { key: "last_price" }]);
  });

  it("keeps the undo window equal to the AI reply path's, which it was copied from", () => {
    // `inbound-responder.service.ts:36` — AUTO_SEND_UNDO_MS = 2 * 60 * 1000.
    // The founder's decision was "the AI reply path's shape", and the shape
    // includes the duration; a drift here would make two windows in one product.
    expect(HOUSE_LETTER_UNDO_MS).toBe(2 * 60 * 1000);
  });
});
