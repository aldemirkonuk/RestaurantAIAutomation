/**
 * The experiment-ended producer: one notice, to one reader, when a window
 * closes with nobody named — and silence in every other state.
 *
 * WHAT THESE CASES ARE FOR. Not "does it call the ledger". Each one pins a way
 * this producer could quietly decide something the founder reserved:
 *
 *   * it must not speak twice, or the notice becomes a running tally and the
 *     ending stops being an event;
 *   * it must not speak while the experiment is still running, which would be
 *     asking for a decision before the measurement is finished;
 *   * it must not speak once a winner is named, which would be nagging about a
 *     decision already made;
 *   * it must never name or imply a winner, because a notice that arrives
 *     saying "the die won" settles by announcement the one question ADR 0127
 *     D10 reserves for a person;
 *   * it must carry no house identity, because the figures it prints are
 *     cross-house and that is the whole reason the route behind them is gated;
 *   * a failed read must be a failure, never "no experiment" — the state that
 *     reads as "still running" and would resume the silence forever.
 */

import { ExperimentEndedProducer } from "./experiment-ended.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import {
  FakeDb,
  fakeDatabase,
  fakeNotifications,
  recorder,
} from "./testing/fake-db";

const HOUSE = "rest-founder";
const OTHER_HOUSE = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-12-06T12:00:00Z");

/** An ended, unnamed window over the founder's real ratio. */
function report(over: Record<string, any> = {}) {
  return {
    experimentKey: "note_close_control",
    question:
      "Does the hold gesture on a written note help a person close it, or does it make them hesitate?",
    decidedOn: "2026-09-05",
    founderWords: "lets try both, 80 percent simple 20 percent signature",
    ratio: { plain: 80, die: 20 },
    arms: [
      {
        arm: "plain",
        sharePct: 80,
        housesAssigned: 8,
        exposures: 40,
        completed: 31,
        abandoned: 4,
        firstExposureAt: "2026-09-05T12:00:00.000Z",
      },
      {
        arm: "die",
        sharePct: 20,
        housesAssigned: 2,
        exposures: 11,
        completed: 7,
        abandoned: 3,
        firstExposureAt: "2026-09-06T09:00:00.000Z",
      },
    ],
    quarterDays: 91,
    firstExposureAt: "2026-09-05T12:00:00.000Z",
    endsAt: "2026-12-05T12:00:00.000Z",
    started: true,
    running: false,
    ended: true,
    winnerArm: null,
    winnerNamedAt: null,
    winnerWords: null,
    endedWithNoWinnerNamed: true,
    houseIdentitiesWithheld: true,
    abandonedIsAFloor: true,
    ...over,
  };
}

function build(
  reportOrThrow: any = report(),
  opts: {
    emails?: string[];
    resolveThrows?: string;
    house?: string | null;
    /** Make the sender refuse, the way GmailService does: a false `success`. */
    sendRefusal?: string;
    /** Make the sender break before it can answer. */
    sendThrows?: string;
  } = {},
) {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  // ONE ordered log across both doubles. The founder's rule is an ORDERING —
  // the row is the record, the mail is a copy of it — and an ordering is only
  // testable if both halves write into the same sequence.
  const order: string[] = [];
  const notifications = fakeNotifications(
    MEMBERS,
    () => {
      order.push("row");
      return null;
    },
    db,
  );
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const ux = {
    adminExperimentReport: recorder(async () => {
      if (reportOrThrow instanceof Error) throw reportOrThrow;
      return reportOrThrow;
    }),
  };
  const house = opts.house === undefined ? HOUSE : opts.house;
  const config = {
    get: (k: string) =>
      k === ExperimentEndedProducer.FOUNDER_HOUSE_ENV
        ? (house ?? undefined)
        : undefined,
  };
  const recipients = {
    resolveRecipients: recorder(async () => {
      if (opts.resolveThrows) throw new Error(opts.resolveThrows);
      return { emails: opts.emails ?? ["founder@example.test"], phones: [] };
    }),
  };
  const gmail = {
    sendEmail: recorder(async () => {
      order.push("mail");
      if (opts.sendThrows) throw new Error(opts.sendThrows);
      return opts.sendRefusal
        ? { success: false, error: opts.sendRefusal }
        : { success: true, messageId: "gmail-msg-1" };
    }),
  };
  const producer = new ExperimentEndedProducer(
    ux as any,
    ledger,
    config as any,
    recipients as any,
    gmail as any,
  );
  return { db, notifications, producer, ux, recipients, gmail, order };
}

/** The stored notification rows, which is where the send outcome is recorded. */
function storedRows(db: FakeDb) {
  return db.tables.notifications ?? [];
}

/** The one notification body this producer wrote, or a thrown assertion. */
function wrote(notifications: any) {
  expect(notifications.persistForRestaurant.calls.length).toBeGreaterThan(0);
  return notifications.persistForRestaurant.calls[0][1];
}

describe("ExperimentEndedProducer — the ending", () => {
  it("[REVERT-FAILS] tells the founder once when the window closed with nobody named", async () => {
    const { notifications, producer } = build();
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);

    expect(tally.considered).toBe(1);
    expect(tally.emitted).toBe(MEMBERS.length);
    expect(tally.failed).toBe(0);
    const call = wrote(notifications);
    expect(call.title).toBe(
      "The note_close_control experiment has ended with no winner named",
    );
    expect(call.priority).toBe("high");
    // No actionUrl: naming the winner is a POST with the admin key and there is
    // no page. A link that opened something else would be a control claiming an
    // act it cannot perform.
    expect(call.actionUrl).toBeUndefined();
  });

  it("[REVERT-FAILS] prints BOTH arms' figures, in the order the spec declares them", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);

    expect(call.message).toContain(
      "Arm plain (80 per cent): 8 houses, 40 shown, 31 closed, 4 left standing.",
    );
    expect(call.message).toContain(
      "Arm die (20 per cent): 2 houses, 11 shown, 7 closed, 3 left standing.",
    );
    expect(call.message.indexOf("Arm plain")).toBeLessThan(
      call.message.indexOf("Arm die"),
    );
    expect(call.metadata.arms).toHaveLength(2);
  });

  it("[REVERT-FAILS] NAMES NO WINNER and implies none", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);

    expect(call.message).toContain("These are counts and not a verdict");
    expect(call.message).toContain("the one you name");
    expect(call.metadata.winnerArm).toBeNull();
    // If any of these ever appears, the notice has started announcing a result
    // nobody reached.
    expect(`${call.title} ${call.message}`).not.toMatch(
      /\b(won|wins|winning|winner is|leading|leads|beats|better|worse|ahead)\b/i,
    );
    // And no arithmetic that sets one arm against the other.
    expect(call.message).not.toMatch(/\d\s*(?:%|per cent)\s*(?:vs|versus|against)/i);
  });

  it("[REVERT-FAILS] carries no house identity beside an arm", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);

    const body = JSON.stringify({
      title: call.title,
      message: call.message,
      metadata: call.metadata,
    });
    expect(body).not.toContain(OTHER_HOUSE);
    // The figures are cross-house counts; no restaurant id belongs in them.
    expect(body).not.toMatch(/restaurantId|restaurant_id/);
    expect(call.metadata.houseIdentitiesWithheld).toBe(true);
  });

  it("[REVERT-FAILS] names the route that ends it, and says what gates it", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);

    expect(call.message).toContain(
      "POST /ux/experiments/note_close_control/winner",
    );
    expect(call.message).toContain("X-Admin-Key");
    expect(call.metadata.winnerRoute).toBe(
      "POST /ux/experiments/note_close_control/winner",
    );
    expect(call.metadata.bothArmsRoute).toBe(
      "GET /ux/experiments/note_close_control/both-arms",
    );
  });

  it("[REVERT-FAILS] says the abandon figures are a floor", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);
    expect(call.message).toContain("Every abandon figure is a floor");
    expect(call.metadata.abandonedIsAFloor).toBe(true);
  });

  it("[REVERT-FAILS] dates the notice to when the window CLOSED, not to this sweep", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);
    // The inbox row's own created_at is the delivery time; the real instant
    // rides in the metadata so the two are never confused.
    expect(call.metadata.occurredAt).toBe("2026-12-05T12:00:00.000Z");
    expect(call.metadata.endsAt).toBe("2026-12-05T12:00:00.000Z");
    expect(call.metadata.quarterDays).toBe(91);
  });

  it("writes plain text with no emoji", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);
    const EMOJI =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(EMOJI.test(`${call.title} ${call.message}`)).toBe(false);
  });
});

describe("ExperimentEndedProducer — when it must stay quiet", () => {
  it("[REVERT-FAILS] a second sweep writes nothing — deduped on the experiment key", async () => {
    const { notifications, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const second = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.alreadyClaimed).toBe(1);
    expect(second.emitted).toBe(0);
    expect(second.withheldReason).toContain("already been reported");
  });

  it("[REVERT-FAILS] the dedupe key is the experiment, carrying no date and no count", async () => {
    const { db, producer } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const keys = db.tables.notification_producer_claims.map(
      (c: any) => c.dedupe_key,
    );
    expect(new Set(keys)).toEqual(
      new Set(["experiment:note_close_control:ended_unnamed"]),
    );
    // A key carrying the end date would repeat if the window were ever
    // re-derived; a key carrying the counts would fire on every new figure.
    for (const k of keys) {
      expect(k).not.toMatch(/2026|\d{4}-\d{2}-\d{2}/);
      expect(k).not.toMatch(/\b(40|31|11|7)\b/);
    }
  });

  it("[REVERT-FAILS] says nothing while the experiment is still running", async () => {
    const { notifications, producer } = build(
      report({ ended: false, running: true, endedWithNoWinnerNamed: false }),
    );
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
    expect(tally.failed).toBe(0);
    expect(tally.withheldReason).toContain("has not ended");
  });

  it("[REVERT-FAILS] says nothing once a winner is named", async () => {
    const { notifications, producer } = build(
      report({
        winnerArm: "plain",
        winnerNamedAt: "2026-12-06T09:00:00.000Z",
        endedWithNoWinnerNamed: false,
      }),
    );
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
    expect(tally.withheldReason).toContain("winner is already named");
  });

  it("[REVERT-FAILS] says nothing before anything has been exposed", async () => {
    const { notifications, producer } = build(
      report({
        started: false,
        ended: false,
        running: false,
        endsAt: null,
        firstExposureAt: null,
        endedWithNoWinnerNamed: false,
      }),
    );
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
  });

  it("[REVERT-FAILS] A FAILED READ IS A FAILURE, never 'no experiment'", async () => {
    const { notifications, producer } = build(new Error("statement timeout"));
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.failed).toBe(1);
    // Not a withheld reason: "we could not look" is not "there was nothing to
    // see", and only the second is a quiet run.
    expect(tally.withheldReason).toBeNull();
  });
});

describe("ExperimentEndedProducer — who it reports to", () => {
  it("[REVERT-FAILS] resolves the address the way the recipient resolver does", async () => {
    const { producer, recipients } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);

    expect(recipients.resolveRecipients.calls).toHaveLength(1);
    const query = recipients.resolveRecipients.calls[0][0];
    expect(query.restaurantId).toBe(HOUSE);
    expect(query.roles).toEqual(["manager"]);
    expect(query.channels).toEqual(["email"]);
    // Left at its default (true) deliberately: the fallback names the DEFAULT
    // restaurant's manager and this IS the default restaurant, the one query in
    // the gateway for which it is not a cross-tenant leak.
    expect(query.allowDefaultFallback).toBeUndefined();
  });

  it("[REVERT-FAILS] keeps the address OUT of the row and records only reachability", async () => {
    const { notifications, producer } = build(report(), {
      emails: ["founder@example.test"],
    });
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const call = wrote(notifications);

    const body = JSON.stringify(call);
    expect(body).not.toContain("founder@example.test");
    expect(call.metadata.founderAddressCount).toBe(1);
    expect(call.metadata.founderAddressSource).toContain(
      "RecipientResolverService",
    );
    expect(call.message).toContain("Your address resolves (1 on file)");
    expect(call.message).toContain("not emailed");
  });

  it("[REVERT-FAILS] still writes the notice when no address resolves, and says so", async () => {
    const { notifications, producer } = build(report(), { emails: [] });
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(MEMBERS.length);
    const call = wrote(notifications);
    expect(call.metadata.founderAddressCount).toBe(0);
    expect(call.message).toContain("No address resolves for you");
  });

  it("[REVERT-FAILS] a failed address lookup does not lose the notification", async () => {
    const { notifications, producer } = build(report(), {
      resolveThrows: "resolver exploded",
    });
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(MEMBERS.length);
    const call = wrote(notifications);
    expect(call.metadata.founderAddressSource).toContain("resolver exploded");
  });

  it("[REVERT-FAILS] founderHouseId is null when nobody named a house — it does not pick one", () => {
    const prior = process.env[ExperimentEndedProducer.FOUNDER_HOUSE_ENV];
    delete process.env[ExperimentEndedProducer.FOUNDER_HOUSE_ENV];
    try {
      const { producer } = build(report(), { house: null });
      expect(producer.founderHouseId()).toBeNull();
    } finally {
      if (prior === undefined)
        delete process.env[ExperimentEndedProducer.FOUNDER_HOUSE_ENV];
      else process.env[ExperimentEndedProducer.FOUNDER_HOUSE_ENV] = prior;
    }
  });

  it("[REVERT-FAILS] founderHouseId reads the env the recipient resolver anchors on", () => {
    expect(ExperimentEndedProducer.FOUNDER_HOUSE_ENV).toBe(
      "DEFAULT_RESTAURANT_ID",
    );
    const { producer } = build();
    expect(producer.founderHouseId()).toBe(HOUSE);
  });
});

describe("ExperimentEndedProducer — what the status page may say", () => {
  it("[REVERT-FAILS] counts the experiments that ended unnamed", async () => {
    const { producer } = build();
    await expect(producer.endedUnnamedCount()).resolves.toBe(1);
  });

  it("[REVERT-FAILS] counts zero when the winner is already named", async () => {
    const { producer } = build(
      report({ winnerArm: "plain", endedWithNoWinnerNamed: false }),
    );
    await expect(producer.endedUnnamedCount()).resolves.toBe(0);
  });

  it("[REVERT-FAILS] A FAILED COUNT IS NULL, not zero", async () => {
    // Zero means "no experiment has ended unnamed", which the page prints as a
    // reason for silence. An unreadable register printed as zero would be that
    // silence reported as health.
    const { producer } = build(new Error("connection reset"));
    await expect(producer.endedUnnamedCount()).resolves.toBeNull();
  });
});

/* ── the emailed copy (founder, 2026-09-05 batch 55) ─────────────────────── */

/**
 * "Inbox row and an email." The founder overruled the recommendation to leave
 * it as an inbox row, so the notice now also goes out through the existing
 * sender. Four rules, and each of these cases is one of them:
 *
 *   the row is the record and the mail is a copy of it (so: ordering, and only
 *   if the row landed); one copy per ending ever; the outcome written back in
 *   words, never a silent skip; and the address still off the row.
 */
describe("ExperimentEndedProducer — the emailed copy", () => {
  it("[REVERT-FAILS] sends the copy AFTER the row, and only after it", async () => {
    const { producer, order, gmail } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    // The ordering IS the rule. A mail that went out about a notice nobody can
    // find would be the worst of both.
    expect(order).toEqual(["row", "mail"]);
    expect(gmail.sendEmail.calls).toHaveLength(1);
  });

  it("[REVERT-FAILS] sends NOTHING when the row did not land", async () => {
    // The funnel is best-effort and returns 0 on failure; the ledger then
    // releases the claims and `emit` reports "failed". There is nothing to copy.
    const db = new FakeDb();
    const database = fakeDatabase(db, MEMBERS);
    const order: string[] = [];
    const notifications = fakeNotifications(
      MEMBERS,
      () => {
        order.push("row");
        return 0; // the funnel wrote no rows
      },
      db,
    );
    const ledger = new ProducerLedgerService(
      database as any,
      notifications as any,
    );
    const gmail = {
      sendEmail: recorder(async () => {
        order.push("mail");
        return { success: true };
      }),
    };
    const producer = new ExperimentEndedProducer(
      { adminExperimentReport: recorder(async () => report()) } as any,
      ledger,
      { get: () => HOUSE } as any,
      {
        resolveRecipients: recorder(async () => ({
          emails: ["founder@example.test"],
          phones: [],
        })),
      } as any,
      gmail as any,
    );
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(gmail.sendEmail.calls).toHaveLength(0);
    expect(order).toEqual(["row"]);
  });

  it("[REVERT-FAILS] a second sweep re-sends nothing", async () => {
    const { producer, gmail } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(gmail.sendEmail.calls).toHaveLength(1);
  });

  it("[REVERT-FAILS] a member served later by quiet hours gets a ROW but no second email", async () => {
    // The hole `emit` alone cannot close: a deferred member is legitimately
    // written to on a later sweep, so "emit said written" happens twice for one
    // ending. The mail is gated on `hasClaimFor` instead, which is about the
    // ending and not about the sweep.
    const { producer, gmail, notifications } = build();
    await producer.sweepFounder(
      HOUSE,
      ZONE,
      { ready: ["user-1"], deferred: ["user-2"] },
      NOW,
    );
    await producer.sweepFounder(
      HOUSE,
      ZONE,
      { ready: ["user-2"], deferred: [] },
      NOW,
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(gmail.sendEmail.calls).toHaveLength(1);
  });

  it("[REVERT-FAILS] records SENT on the row, in words", async () => {
    const { producer, db } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const rows = storedRows(db);
    expect(rows.length).toBe(MEMBERS.length);
    for (const row of rows) {
      expect(row.metadata.endNoticeMailState).toBe("sent");
      expect(row.metadata.endNoticeMail).toContain("A copy was emailed");
      expect(row.metadata.endNoticeMail).toContain("gmail-msg-1");
    }
  });

  it("[REVERT-FAILS] a REFUSED send leaves the row standing and says why", async () => {
    const { producer, db, notifications } = build(report(), {
      sendRefusal: "Fix GMAIL_REFRESH_TOKEN (run scripts/gmail-reauth.js)",
    });
    const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);

    // The notice is unaffected: it emitted, it is stored, and the sweep is not
    // a failure. Losing the record because the copy failed would be backwards.
    expect(tally.emitted).toBe(MEMBERS.length);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    for (const row of storedRows(db)) {
      expect(row.metadata.endNoticeMailState).toBe("refused");
      expect(row.metadata.endNoticeMail).toContain("was refused");
      // The sender's own sentence, verbatim — this is where a missing grant
      // surfaces, since GmailService does not expose its readiness separately.
      expect(row.metadata.endNoticeMail).toContain("GMAIL_REFRESH_TOKEN");
      expect(row.metadata.endNoticeMail).toContain("stands and is unaffected");
    }
  });

  it("[REVERT-FAILS] a sender that BREAKS is a refusal, not a lost sweep", async () => {
    const { producer, db, notifications } = build(report(), {
      sendThrows: "socket hang up",
    });
    await expect(
      producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW),
    ).resolves.toBeDefined();
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    for (const row of storedRows(db)) {
      expect(row.metadata.endNoticeMailState).toBe("refused");
      expect(row.metadata.endNoticeMail).toContain("socket hang up");
    }
  });

  it("[REVERT-FAILS] NO ADDRESS is not attempted, and the row says so", async () => {
    const { producer, db, gmail } = build(report(), { emails: [] });
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    expect(gmail.sendEmail.calls).toHaveLength(0);
    for (const row of storedRows(db)) {
      expect(row.metadata.endNoticeMailState).toBe("not_attempted");
      expect(row.metadata.endNoticeMail).toContain("no address resolves");
    }
  });

  it("[REVERT-FAILS] NEVER A SILENT SKIP — every row carries a state and a sentence", async () => {
    for (const opts of [
      {},
      { emails: [] as string[] },
      { sendRefusal: "mailbox full" },
    ]) {
      const { producer, db } = build(report(), opts);
      await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
      for (const row of storedRows(db)) {
        expect(["sent", "refused", "not_attempted"]).toContain(
          row.metadata.endNoticeMailState,
        );
        expect(typeof row.metadata.endNoticeMail).toBe("string");
        expect(row.metadata.endNoticeMail.length).toBeGreaterThan(20);
        // "pending" is the insert-time value; if it survived, the write-back
        // did not happen and the row would be implying nothing was tried.
        expect(row.metadata.endNoticeMailState).not.toBe("pending");
      }
    }
  });

  it("[REVERT-FAILS] the deferred member's later row says the copy already went", async () => {
    const { producer, db } = build();
    await producer.sweepFounder(
      HOUSE,
      ZONE,
      { ready: ["user-1"], deferred: ["user-2"] },
      NOW,
    );
    await producer.sweepFounder(
      HOUSE,
      ZONE,
      { ready: ["user-2"], deferred: [] },
      NOW,
    );
    const later = storedRows(db).find((r: any) => r.user_id === "user-2");
    expect(later).toBeDefined();
    expect(later!.metadata.endNoticeMailState).toBe("not_attempted");
    expect(later!.metadata.endNoticeMail).toContain(
      "already been sent with the first notice",
    );
  });

  it("[REVERT-FAILS] THE ADDRESS STILL NEVER TOUCHES THE ROW", async () => {
    const { producer, db } = build(report(), {
      emails: ["founder@example.test"],
    });
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    for (const row of storedRows(db)) {
      expect(JSON.stringify(row)).not.toContain("founder@example.test");
      expect(row.metadata.founderAddressCount).toBe(1);
    }
  });

  it("[REVERT-FAILS] the email carries the same words as the row, plain, both parts", async () => {
    const { producer, gmail } = build();
    await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
    const sent = gmail.sendEmail.calls[0][0];
    expect(sent.to).toEqual(["founder@example.test"]);
    expect(sent.subject).toBe(
      "The note_close_control experiment has ended with no winner named",
    );
    expect(sent.text).toContain("Arm plain (80 per cent): 8 houses");
    expect(sent.text).toContain("Arm die (20 per cent): 2 houses");
    expect(sent.text).toContain("These are counts and not a verdict");
    expect(sent.text).toContain(
      "POST /ux/experiments/note_close_control/winner",
    );
    // No verdict in the mail either — it is the same sentence, so the rule
    // travels with it.
    expect(`${sent.subject} ${sent.text}`).not.toMatch(
      /\b(won|wins|winning|leading|leads|beats|better|ahead)\b/i,
    );
    const EMOJI =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(EMOJI.test(`${sent.subject} ${sent.text} ${sent.html}`)).toBe(false);
  });

  it("[REVERT-FAILS] an unreadable claim ledger HOLDS the copy rather than risking two", async () => {
    const { producer, db, gmail } = build();
    (db as any).failures.notification_producer_claims_select =
      "connection reset";
    // The guard read fails; the row must still go out and the copy must not.
    const original = ProducerLedgerService.prototype.hasClaimFor;
    ProducerLedgerService.prototype.hasClaimFor = async () => {
      throw new Error("connection reset");
    };
    try {
      const tally = await producer.sweepFounder(HOUSE, ZONE, AUDIENCE, NOW);
      expect(tally.emitted).toBe(MEMBERS.length);
      expect(gmail.sendEmail.calls).toHaveLength(0);
      for (const row of storedRows(db)) {
        expect(row.metadata.endNoticeMailState).toBe("not_attempted");
        expect(row.metadata.endNoticeMail).toContain("connection reset");
      }
    } finally {
      ProducerLedgerService.prototype.hasClaimFor = original;
    }
  });
});

