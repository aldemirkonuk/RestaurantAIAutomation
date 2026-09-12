/**
 * How a producer says a thing happened.
 *
 * THE RULE, AND WHERE IT COMES FROM
 * ---------------------------------
 * A stored notification is a permanent row. It cannot be restyled, retranslated
 * or apologised for later — `notification-text-is-plain.spec.ts` exists because
 * a previous generation of these producers wrote emoji into `title`, and the
 * rebuilt page has to strip them at render time precisely because the DATA
 * cannot be fixed retroactively. So the text a producer writes must be a
 * SENTENCE OF RECORD: the object, the state it reached, when, and the number
 * that decided it. Never an exclamation, never an instruction.
 *
 * Three products that had to solve this were read on 2026-09-03:
 *
 *  1. **Linear** phrases every notification event impersonally and factually —
 *     "an issue is marked as completed or canceled", "a new project update is
 *     posted". No actor, no adjective, no congratulation; a state change and its
 *     object. https://linear.app/docs/project-notifications
 *
 *  2. **Stripe** names the crossing after the crossing: the webhook is
 *     `billing.alert.triggered`, the threshold is an explicit field the operator
 *     sets (`usage_threshold[gte]`), and `recurrence: one_time` means an alert
 *     "triggers when a customer exceeds the specified usage level for the first
 *     time, and only triggers one time per customer, regardless of future
 *     usage". Two rules taken directly from that: the threshold is DATA carried
 *     with the event, not a constant hidden in code; and a crossing fires once.
 *     https://docs.stripe.com/billing/subscriptions/usage-based/alerts
 *
 *  3. **Sentry**'s spike-protection notification states "the threshold, the
 *     duration, and the count of events that we dropped" — the numbers that made
 *     the decision travel with the decision, and the same channel reports
 *     activation AND deactivation, so the absence of a spike is also a fact.
 *     https://docs.sentry.io/pricing/quotas/spike-protection/
 *
 * What that yields here: the TITLE is the record and carries no verb of
 * approval; the MESSAGE carries the arithmetic that produced it; the numbers
 * that decided it are repeated in `metadata` so a reader — or an audit — can
 * check the sentence against them. The only place a judgement is allowed is the
 * action label, which is a control, not a claim.
 *
 * NO EMOJI, ANYWHERE IN THIS FILE OR ITS CALLERS. `notification-text-is-plain`
 * scans every gateway file that names one of the notification funnels, and this
 * whole directory names `persistForRestaurant`.
 */

/** `$1,240.50`. Whole dollars keep their `.00` — a figure of record is exact. */
export function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** `18%` — rounded to whole percent, which is the precision a reader can act on. */
export function percent(fraction: number): string {
  return `${Math.round(Math.abs(fraction) * 100)}%`;
}

/** `Tuesday, 2 September` on the house's own clock. */
export function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(instant);
}

/** `11:04 PM` on the house's own clock. */
export function clockIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/**
 * "3 days early", "on the day", "2 days late" — how a crossing sits against the
 * date it was aimed at.
 *
 * `null` in, `null` out: a goal with no deadline is not early and is not late,
 * and inventing "on time" for it would be a claim about a schedule that does not
 * exist. The founder asked for "how early was it" and this is the only honest
 * answer when there is nothing to be early against.
 */
export function earliness(
  crossedAt: Date,
  deadline: Date | null,
): { days: number; phrase: string } | null {
  if (!deadline || !Number.isFinite(deadline.getTime())) return null;
  const days = Math.round(
    (deadline.getTime() - crossedAt.getTime()) / 86_400_000,
  );
  if (days === 0) return { days, phrase: "on the deadline itself" };
  if (days > 0) {
    return { days, phrase: `${days} day${days === 1 ? "" : "s"} early` };
  }
  const late = Math.abs(days);
  return { days, phrase: `${late} day${late === 1 ? "" : "s"} past the deadline` };
}

/**
 * "Ada Lovelace (bar), Grace Hopper (floor)" — who was working at an instant.
 *
 * An empty roster returns `null`, never "nobody": the schedule not naming anyone
 * for that hour and nobody actually being there are different facts, and only
 * the first is one this product can observe.
 */
export function onShiftPhrase(
  people: Array<{ name: string; role: string | null }>,
): string | null {
  if (!people.length) return null;
  return people
    .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
    .join(", ");
}
