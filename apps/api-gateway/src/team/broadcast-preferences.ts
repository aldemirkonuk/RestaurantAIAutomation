/**
 * A crew broadcast honours the person's own channel switches.
 *
 * THE DEFECT THIS CLOSES (ADR 0088 T4)
 * ------------------------------------
 * `POST …/team/broadcast` mapped roster emails and phones straight to Gmail and
 * Plivo. The scheduled mailer goes through
 * `communications/recipient-resolver.service.ts`, which at least *consults*
 * `notification_preferences`. Same restaurant, same people, same channels — one
 * path looked and the other did not.
 *
 * THE RULE IS **NOT** COPIED FROM THE RESOLVER, AND THAT IS DELIBERATE
 * -------------------------------------------------------------------
 * The intention was to mirror `RecipientResolverService.checkChannelPreference`
 * (`recipient-resolver.service.ts:343-368`) exactly, so that an opt-out means
 * one thing. Writing it down named the columns out loud, and
 * `scripts/check_read_columns_exist.py` (ADR 0074) refused the read:
 *
 *     notification_preferences.order_channels   — no such column
 *     notification_preferences.report_channels  — no such column
 *
 * The real columns are `order_approval_channels` and
 * `financial_reports_channels`. The resolver never noticed because it issues
 * `.select("*")` and then reads the three field names off the row in
 * JavaScript, where a column that does not exist is simply `undefined`.
 *
 * **Measured on production `exzueerziesmczwlhomd`, 2026-09-02, all 3 rows:**
 *
 *     email_enabled  true   sms_enabled  false
 *     low_stock_channels          ['sms','push']        (the column DEFAULT)
 *     order_approval_channels     ['sms','push','email']
 *     financial_reports_channels  ['email','dashboard']
 *
 * Trace the resolver's rule over that row and it is **backwards on both
 * channels**: for `email` the two phantom arrays are `undefined`, so the
 * "nothing configured" branch cannot fire (`low_stock_channels` is truthy),
 * `['sms','push']` has no `email`, and it returns FALSE — email refused to
 * three people whose `email_enabled` is `true`. For `sms` it returns TRUE,
 * because `low_stock_channels` contains `sms`, although `sms_enabled` is
 * `false`. The register is denying a channel nobody declined and sending on one
 * they did.
 *
 * That file is `communications/**` and belongs to another session; it is
 * reported, not edited here. But mirroring it would mean shipping a *new*
 * caller of a rule measured wrong, which is worse than the divergence it was
 * meant to avoid.
 *
 * WHAT THIS READS INSTEAD
 * -----------------------
 * `email_enabled` and `sms_enabled` — columns that exist, that say exactly
 * "does this person want email / SMS from us", and that are the only
 * preference a *crew broadcast* could be governed by: the per-category arrays
 * are named for low stock, order approval, deliveries, financial reports and
 * calendar reminders, and a message from your manager is none of those.
 *
 * `null`/absent is NOT an opt-out. A person who never opened the settings page
 * has not declined anything.
 */

export type BroadcastChannel = "email" | "sms";

export interface ChannelPreferences {
  /** user ids that have turned this channel OFF. */
  optedOut: Record<BroadcastChannel, Set<string>>;
}

/** The column each broadcast channel is governed by. Both exist; see above. */
const CHANNEL_COLUMN: Record<BroadcastChannel, string> = {
  email: "email_enabled",
  sms: "sms_enabled",
};

/**
 * True unless the person explicitly switched this channel off.
 *
 * Only a literal `false` is an opt-out. `undefined` (no row), `null` (a row
 * that never set it) and `true` all mean send — silence is not a refusal.
 */
export function channelAllowed(prefs: any, channel: BroadcastChannel): boolean {
  if (!prefs) return true;
  return prefs[CHANNEL_COLUMN[channel]] !== false;
}

/**
 * Read `notification_preferences` for these users and return, per channel, the
 * set of user ids that have opted out.
 *
 * A failed read returns `null` — NOT an empty set. The caller must decide out
 * loud rather than sending to people who may have said no: an empty answer from
 * a query that failed looks exactly like an empty answer from a query that ran
 * ([[absence-reported-as-health]]).
 */
export async function loadChannelOptOuts(
  sb: any,
  userIds: string[],
): Promise<ChannelPreferences | null> {
  const result: ChannelPreferences = {
    optedOut: { email: new Set<string>(), sms: new Set<string>() },
  };
  if (!userIds.length) return result;

  const { data, error } = await sb
    .from("notification_preferences")
    .select("user_id, email_enabled, sms_enabled")
    .in("user_id", userIds);

  if (error) return null;

  for (const prefs of data ?? []) {
    for (const channel of ["email", "sms"] as BroadcastChannel[]) {
      if (!channelAllowed(prefs, channel)) {
        result.optedOut[channel].add(prefs.user_id);
      }
    }
  }
  return result;
}
