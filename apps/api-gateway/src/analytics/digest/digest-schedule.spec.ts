/**
 * The pure half of the digest sender: when it is due, on whose clock, what it
 * may carry, what arms it, and the token that stops it. Fixed instants only.
 */

import { createHash } from "crypto";
import {
  DIGEST_LATE_LIMIT_MS,
  digestSendArmed,
  hashUnsubscribeToken,
  isWellFormedUnsubscribeToken,
  localDateKey,
  meetsUrgencyFloor,
  mostRecentDue,
  newUnsubscribeToken,
  nextDue,
  sourcesUnreadWords,
} from "./digest-schedule";
import { isSingleMailbox } from "./recommendation-digest.service";
import {
  buildDigestLetter,
  encodeSubject,
  escapeHtml,
  unsubscribePage,
} from "./recommendation-digest.template";

/** Wall-clock `HH:MM` of `instant` in `zone`. */
function wall(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

describe("DIGEST_SEND_ENABLED is an allow-list", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["", false],
    ["false", false],
    ["0", false],
    ["yes", false],
    ["on", false],
    ["enabled", false],
    ["true", true],
    ["1", true],
    [" TRUE ", true],
  ])("%p → %p", (raw, armed) => {
    expect(digestSendArmed(raw as any)).toBe(armed);
  });
});

describe("a daily digest falls due on the house's wall clock", () => {
  const cadence = { frequency: "daily" as const, weekday: null, hour: 7 };

  it("before today's hour, the most recent due is yesterday's", () => {
    const due = mostRecentDue(
      new Date("2026-09-17T03:59:00Z"),
      "Europe/Istanbul",
      cadence,
    );
    expect(due.periodKey).toBe("2026-09-16");
    expect(due.dueAt.toISOString()).toBe("2026-09-16T04:00:00.000Z");
  });

  it("at or after today's hour, it is today's", () => {
    const due = mostRecentDue(
      new Date("2026-09-17T04:00:00Z"),
      "Europe/Istanbul",
      cadence,
    );
    expect(due.periodKey).toBe("2026-09-17");
    expect(due.dueAt.toISOString()).toBe("2026-09-17T04:00:00.000Z");
  });

  it("the period is the HOUSE's date: 07:00 in Auckland is the previous UTC day", () => {
    // 2026-09-17 07:30 NZST (+12) = 2026-09-16 19:30Z.
    const now = new Date("2026-09-16T19:30:00Z");
    const due = mostRecentDue(now, "Pacific/Auckland", cadence);
    expect(due.periodKey).toBe("2026-09-17");
    expect(localDateKey(now, "UTC")).toBe("2026-09-16");
    expect(wall(due.dueAt, "Pacific/Auckland")).toBe("07:00");
  });

  it("stays at 07:00 local across both DST shifts in New York", () => {
    for (const iso of [
      "2026-03-07T20:00:00Z",
      "2026-03-08T20:00:00Z",
      "2026-10-31T20:00:00Z",
      "2026-11-01T20:00:00Z",
    ]) {
      const due = mostRecentDue(new Date(iso), "America/New_York", cadence);
      expect(wall(due.dueAt, "America/New_York")).toBe("07:00");
      expect(due.periodKey).toBe(iso.slice(0, 10));
    }
  });

  it("the next due is one day on", () => {
    const next = nextDue(
      new Date("2026-09-17T04:05:00Z"),
      "Europe/Istanbul",
      cadence,
    );
    expect(next.dueAt.toISOString()).toBe("2026-09-18T04:00:00.000Z");
    expect(next.periodKey).toBe("2026-09-18");
  });

  it("refuses an hour that is not an hour of the day", () => {
    expect(() =>
      mostRecentDue(new Date(), "UTC", { ...cadence, hour: 24 }),
    ).toThrow(/0–23/);
    expect(() =>
      mostRecentDue(new Date(), "UTC", { ...cadence, hour: 6.5 }),
    ).toThrow(/0–23/);
  });
});

describe("a weekly digest falls due on its ISO weekday", () => {
  // 2026-09-17 is a Thursday (ISO 4).
  const monday = { frequency: "weekly" as const, weekday: 1, hour: 7 };

  it("on Thursday, a Monday digest was last due this Monday", () => {
    const due = mostRecentDue(new Date("2026-09-17T12:00:00Z"), "UTC", monday);
    expect(due.periodKey).toBe("2026-09-14");
  });

  it("on Monday before the hour, it was last due the Monday before", () => {
    const due = mostRecentDue(new Date("2026-09-14T06:59:00Z"), "UTC", monday);
    expect(due.periodKey).toBe("2026-09-07");
  });

  it("the next one is the coming Monday", () => {
    const next = nextDue(new Date("2026-09-17T12:00:00Z"), "UTC", monday);
    expect(next.periodKey).toBe("2026-09-21");
  });

  it("refuses a weekly cadence with no weekday", () => {
    expect(() =>
      mostRecentDue(new Date(), "UTC", { ...monday, weekday: null }),
    ).toThrow(/ISO weekday/);
    expect(() =>
      mostRecentDue(new Date(), "UTC", { ...monday, weekday: 8 }),
    ).toThrow(/ISO weekday/);
  });
});

describe("the urgency floor", () => {
  it("now takes only now; this_week takes now and this week; this_month takes all three", () => {
    expect(
      ["now", "this_week", "this_month"].filter((u) =>
        meetsUrgencyFloor(u, "now"),
      ),
    ).toEqual(["now"]);
    expect(
      ["now", "this_week", "this_month"].filter((u) =>
        meetsUrgencyFloor(u, "this_week"),
      ),
    ).toEqual(["now", "this_week"]);
    expect(
      ["now", "this_week", "this_month"].filter((u) =>
        meetsUrgencyFloor(u, "this_month"),
      ),
    ).toEqual(["now", "this_week", "this_month"]);
  });

  it("an urgency it does not recognise is left out, not guessed into a band", () => {
    expect(meetsUrgencyFloor("urgent", "this_month")).toBe(false);
    expect(meetsUrgencyFloor(undefined, "this_month")).toBe(false);
  });

  it("the late limit is twelve hours", () => {
    expect(DIGEST_LATE_LIMIT_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("the unsubscribe token", () => {
  it("is 32 random bytes of hex, fresh each time, stored as its SHA-256", () => {
    const a = newUnsubscribeToken();
    const b = newUnsubscribeToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(hashUnsubscribeToken(a)).toBe(
      createHash("sha256").update(a).digest("hex"),
    );
    expect(hashUnsubscribeToken(a)).not.toBe(a);
  });

  it("accepts exactly that shape", () => {
    expect(isWellFormedUnsubscribeToken("a".repeat(64))).toBe(true);
    expect(isWellFormedUnsubscribeToken("A".repeat(64))).toBe(false);
    expect(isWellFormedUnsubscribeToken("a".repeat(63))).toBe(false);
    expect(isWellFormedUnsubscribeToken(`${"a".repeat(64)}/../x`)).toBe(false);
    expect(isWellFormedUnsubscribeToken(42)).toBe(false);
  });
});

describe("words", () => {
  it("names the sources the engine could not read", () => {
    expect(sourcesUnreadWords([])).toBeNull();
    expect(sourcesUnreadWords(["goals"])).toBe(
      "The engine could not read one of its sources (goals), so entries that depend on it could not fire.",
    );
    expect(sourcesUnreadWords(["risk profile", "cashflow", "goals"])).toMatch(
      /3 of its sources \(risk profile, cashflow and goals\)/,
    );
  });

  it("a recipient is one mailbox and nothing that could open a header or a second recipient", () => {
    expect(isSingleMailbox("ana@house.test")).toBe(true);
    for (const bad of [
      "",
      "ana",
      "@house.test",
      "ana@house",
      "ana@@house.test",
      "ana@house.test, bo@x.test",
      "Ana <ana@house.test>",
      "ana@house.test\r\nBcc: x@y.z",
      "a b@house.test",
      `${"a".repeat(250)}@house.test`,
    ]) {
      expect(isSingleMailbox(bad)).toBe(false);
    }
  });

  it("encodes a non-ASCII subject and leaves an ASCII one alone, on one line", () => {
    expect(
      encodeSubject("Mudavym: 2 recommendations standing at Meyhouse"),
    ).toBe("Mudavym: 2 recommendations standing at Meyhouse");
    const enc = encodeSubject("Mudavym: Kaleiçi\r\nBcc: x@y.z");
    expect(enc).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(enc.slice(10, -2), "base64").toString("utf8")).toBe(
      "Mudavym: Kaleiçi Bcc: x@y.z",
    );
  });

  it("escapes what the engine and the house wrote", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
    const letter = buildDigestLetter({
      houseName: "<b>House</b>",
      recipientName: null,
      frequency: "weekly",
      weekday: 1,
      hour: 7,
      timeZone: "UTC",
      timeZoneIsFallback: false,
      urgencyFloor: "this_week",
      entries: [
        {
          ruleKey: "r",
          category: "sales",
          urgency: "now",
          observation: `<img src=x onerror=alert(1)>`,
          recommendation: "Do it",
          rationale: "Because",
          firstSeenAt: null,
        },
      ],
      standing: 3,
      rulesEvaluated: 12,
      engineGeneratedAt: "2026-09-17T04:00:00Z",
      subscribedAt: "2026-09-01T00:00:00Z",
      unsubscribeUrl:
        "https://api.mudavym.test/api/v1/recommendations/digest/unsubscribe/abc",
      appOrigin: null,
    });
    expect(letter.html).not.toContain("<img");
    expect(letter.html).not.toContain("<b>House</b>");
    expect(letter.text).toMatch(/every Monday at 07:00 UTC/);
    expect(letter.text).toMatch(
      /2 more stand on the page; this letter carries the first 1/,
    );
    expect(letter.text).toContain("first sighting not recorded");
    expect(letter.text).not.toContain("Open it:"); // no app origin → no invented link
  });

  it("the unsubscribe page's button posts back to the same URL, and the no-button pages have no form", () => {
    expect(
      unsubscribePage({
        title: "Stop?",
        body: "b",
        confirmLabel: "Stop the digest",
      }),
    ).toMatch(/<form method="post" action="">/);
    expect(unsubscribePage({ title: "Stopped", body: "b" })).not.toContain(
      "<form",
    );
  });
});
