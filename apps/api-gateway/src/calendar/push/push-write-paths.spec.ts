/**
 * Every path that changes `calendar_events` decides whether it pushes.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * ADR 0111 direction 1's build brief said "find the single write path in the
 * calendar service and hook there, never a second path". There is no single
 * write path. `calendar.service.ts` mutates `calendar_events` in ELEVEN
 * statements across five public methods, and two of them are early-returning
 * branches that skip the shared code entirely — `updateEvent`'s
 * `this_and_future` split inserts a whole new parent and returns, and
 * `deleteEvent`'s `this` scope cancels an occurrence and returns.
 *
 * Hooking a subset is the failure this file is aimed at, and it is not
 * hypothetical: the `updateScope: "all"` branch updates the PARENT of a series
 * and then goes on to update and push only the occurrence, so before push site
 * 8 was added the parent's copy in Google kept the old title for ever, on the
 * one scope a person picks when they mean "change all of them". It was found by
 * counting the statements, not by reading the method.
 *
 * So the rule this file enforces is not "there is one path" — it is "the number
 * of paths is known, and changing it is a decision somebody makes on purpose".
 * A new mutation statement fails this test, and the person adding it has to
 * come here and say whether the copy in Google follows.
 *
 * The counts are asserted, and so is the pairing: nothing calls
 * `CalendarPushService.push` except the one private funnel.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SERVICE = readFileSync(
  join(__dirname, "..", "calendar.service.ts"),
  "utf8",
);

/**
 * Eleven, as of 2026-09-06. Each is listed with what it does, because a bare
 * number ages into a mystery.
 *
 *  1. createEvent          insert  — the new entry                  (pushed, site 1)
 *  2. createEvent          update  — is_recurring rollback          (bookkeeping)
 *  3. createEvent          update  — recurrence_rule_id             (bookkeeping)
 *  4. updateEvent          insert  — the split's new parent         (pushed, site 2)
 *  5. updateEvent          update  — the truncated series' parent   (pushed, site 8)
 *  6. updateEvent          update  — the entry itself               (pushed, site 3)
 *  7. deleteEvent          update  — cancel one occurrence          (pushed, site 4)
 *  8. deleteEvent          delete  — the entry                      (pushed, site 5)
 *  9. updateEventStatus    update  — the status                     (pushed, site 6)
 * 10. deleteRecurringSeries delete — the occurrences                (pushed, site 7)
 * 11. deleteRecurringSeries delete — the parent                     (pushed, site 7)
 *
 * Three are bookkeeping that changes nothing a Google copy would show; the
 * other eight are pushed. If this number moves, decide which group the new one
 * is in and say so here.
 */
const KNOWN_MUTATIONS = 11;

/** Nine textual calls: eight numbered sites, one of which fires twice. */
const KNOWN_HOOK_CALLS = 9;

const MUTATION =
  /\.from\("calendar_events"\)\s*\n?\s*\.(insert|update|delete)\(/g;

describe("the calendar service's write paths", () => {
  it("mutates calendar_events in exactly the number of places we know about", () => {
    const found = SERVICE.match(MUTATION) ?? [];
    expect(found).toHaveLength(KNOWN_MUTATIONS);
  });

  it("funnels every push through one private method", () => {
    expect(SERVICE.match(/this\.copyToGoogle\(/g) ?? []).toHaveLength(
      KNOWN_HOOK_CALLS,
    );
    // The funnel is the ONLY caller of the push service in this file. A second
    // call site is how a verb starts being sent twice, or with a different
    // guarantee about throwing.
    expect(SERVICE.match(/this\.push\.push\(/g) ?? []).toHaveLength(1);
  });

  it("names every site, so a missing number is visible on inspection", () => {
    for (let n = 1; n <= 8; n += 1) {
      expect(SERVICE).toContain(`Push site ${n} of 8`);
    }
  });

  it("contains the funnel's own promise never to throw at the caller", () => {
    // The entry is the house's record and is already saved when the push runs.
    // A push that threw would roll a person's edit back because somebody
    // else's server was down.
    const funnel = SERVICE.slice(
      SERVICE.indexOf("private async copyToGoogle"),
      SERVICE.indexOf("// CREATE"),
    );
    expect(funnel).toContain("try {");
    expect(funnel).toContain("catch");
  });

  it("has no read verb anywhere in the push module — direction 1 does not read", () => {
    const push = readFileSync(
      join(__dirname, "calendar-push.service.ts"),
      "utf8",
    );
    const client = readFileSync(
      join(__dirname, "google-calendar.client.ts"),
      "utf8",
    );
    // `calendar.app.created` permits reading back what we wrote. Reading is
    // direction 2 and a separate decision (ADR 0111 §5). The client's method
    // type is the structural block: there is no "GET" in it.
    expect(client).toContain('export type GoogleCalendarMethod =');
    expect(client).not.toMatch(/"GET"/);
    expect(push).not.toMatch(/method: "GET"/);
    expect(push).not.toMatch(/syncToken|nextSyncToken|watch\(/);
  });
});
