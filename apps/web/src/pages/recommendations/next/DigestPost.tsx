/**
 * The post — sketch 120's binding of the Morning Letter's functionality into
 * the built page, item 2 ("The post, in the rail, where the dark 'Daily
 * digest' block stood").
 *
 * Two different facts, two doors, two sheets — never one control standing in
 * for both:
 *
 *   THE HOUSE'S POST  — does a scheduled send exist for this house at all,
 *   and at what hour and floor. One stored row
 *   (`recommendation_digest_prefs`, `PUT /analytics/recommendations/:rid/digest`,
 *   already on `main`). Any manager can set it; it subscribes nobody.
 *
 *   YOUR COPY — whether THIS person receives a copy of it, and on what
 *   cadence. A per-person row (`recommendation_digest_subscriptions`) on the
 *   sender built on `feat/finish-digest` (`useDigestSubscription.ts` — read
 *   that file's header for what is and is not built here).
 *
 * Both render as a `Sheet` (ADR 0112) — a form that commits, in the one shape
 * the locked ADR gives a form (0112 F2: a second `Popover modal` component is
 * "the signal that collapses the policy", so this is drawn as a sheet, never
 * an anchored popover — sketch 120 §5, founder question 5 still open on
 * whether a `/settings` row should exist instead; not decided here).
 */

import { useState } from 'react';
import { Sheet } from '@/components/mudavym';
import { EM, URGENCY_LABEL, fmtDay } from './rec-format';
import type { DigestPref, DigestWrite } from './useRecommendationsNextData';
import { useDigestSubscription, type DigestFrequency } from './useDigestSubscription';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAYS: Array<{ iso: number; label: string }> = [
  { iso: 1, label: 'Monday' },
  { iso: 2, label: 'Tuesday' },
  { iso: 3, label: 'Wednesday' },
  { iso: 4, label: 'Thursday' },
  { iso: 5, label: 'Friday' },
  { iso: 6, label: 'Saturday' },
  { iso: 7, label: 'Sunday' },
];

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/* ── door one: the house's post ──────────────────────────────────────────── */

function HousePostSheet({
  digest,
  onClose,
  onSave,
}: {
  digest: DigestPref | null | undefined;
  onClose: () => void;
  onSave: (patch: {
    digestEnabled?: boolean;
    digestHour?: number;
    digestMinUrgency?: string;
  }) => Promise<DigestWrite>;
}) {
  const known = digest ?? null;
  const isSet = known?.set === true;
  const [enabled, setEnabled] = useState(known?.digestEnabled ?? false);
  const [hour, setHour] = useState(known?.digestHour ?? 7);
  const [floor, setFloor] = useState(known?.digestMinUrgency ?? 'this_week');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <Sheet
      open
      onClose={onClose}
      label="The house's post"
      eyebrow="Recommendations · the post"
      title="The house's post"
    >
      <div className="rc-sheet-block">
        <p className="rc-why">
          One stored row for this house: whether a scheduled send is armed at all, at
          what hour, and which floor of urgency it carries. Setting this does not
          subscribe anyone — it only arms the house. Whoever wants a copy asks for
          their own, separately (<span className="rc-num">Your copy</span>).
        </p>
        {known !== null && !isSet && (
          <p className="rc-said" role="status">
            This house has never stored a post preference. Nothing below is the house's
            current setting — it is a starting point for the first one.
          </p>
        )}
      </div>

      <div className="rc-sheet-block">
        <label className="rc-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(ev) => setEnabled(ev.target.checked)}
          />
          <span className="rc-micro">Arm the house's post</span>
        </label>
      </div>

      <div className="rc-sheet-block">
        <label className="rc-field">
          <span className="rc-micro">
            Hour ({known === null ? 'no house time known yet' : isSet ? 'house local time' : 'starting point, not yet stored'})
          </span>
          <select
            value={hour}
            aria-label="Digest hour"
            onChange={(ev) => setHour(Number(ev.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {fmtHour(h)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rc-sheet-block">
        <label className="rc-field">
          <span className="rc-micro">Floor — the lowest urgency it carries</span>
          <select value={floor} aria-label="Digest floor" onChange={(ev) => setFloor(ev.target.value)}>
            {(['now', 'this_week', 'this_month'] as const).map((u) => (
              <option key={u} value={u}>
                {URGENCY_LABEL[u]}
              </option>
            ))}
          </select>
        </label>
        <p className="rc-why">
          The engine's own three urgency words, the same ones the docket sorts by —
          not a new scale invented for this form.
        </p>
      </div>

      {refusal && (
        <p className="rc-said" role="alert">
          {refusal}
        </p>
      )}

      <div className="rc-row">
        <button
          type="button"
          className="rc-act"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setRefusal(null);
            const res = await onSave({
              digestEnabled: enabled,
              digestHour: hour,
              digestMinUrgency: floor,
            });
            setBusy(false);
            if (res.ok) onClose();
            else setRefusal(res.message);
          }}
        >
          {busy ? 'Storing…' : 'Store it'}
        </button>
        <button type="button" className="rc-quiet" onClick={onClose}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

/* ── door two: your copy ─────────────────────────────────────────────────── */

function YourCopySheet({ onClose }: { onClose: () => void }) {
  const sub = useDigestSubscription(true);
  const [frequency, setFrequency] = useState<DigestFrequency>('daily');
  const [weekday, setWeekday] = useState(1);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <Sheet open onClose={onClose} label="Your copy" eyebrow="Recommendations · the post" title="Your copy">
      {sub.phase === 'loading' && <p className="rc-why">Reading your subscription…</p>}

      {sub.phase === 'unreachable' && (
        <div className="rc-sheet-block">
          <p className="rc-said" role="status">
            {sub.looksUnmerged
              ? 'This deployment does not yet serve your digest copy (404). The sender that mails it (branch feat/finish-digest) has not merged here yet — this is not a broken account, the door is not open on this build.'
              : `Your copy could not be read (${sub.failure?.message ?? 'unknown error'}). Nothing below is claimed.`}
          </p>
          <button type="button" className="rc-quiet" onClick={sub.refresh}>
            Try again
          </button>
        </div>
      )}

      {sub.phase === 'ready' && sub.status && (
        <>
          {sub.status.blockers.length > 0 && (
            <div className="rc-sheet-block">
              <span className="rc-micro">Will it reach you?</span>
              <ul className="rc-excl">
                {sub.status.blockers.map((b, i) => (
                  <li key={i}>
                    <span className="rc-said">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rc-sheet-block">
            <span className="rc-micro">The house's post</span>
            <p className="rc-plain">
              {sub.status.house.set
                ? `${sub.status.house.enabled ? 'Armed' : 'Not armed'}, ${String(
                    sub.status.house.hour,
                  ).padStart(2, '0')}:00, floor ${URGENCY_LABEL[sub.status.house.urgencyFloor] ?? sub.status.house.urgencyFloor}`
                : 'This house has never set a digest preference.'}
              {sub.status.timeZone
                ? ` — ${sub.status.timeZone.zone}${sub.status.timeZone.isFallback ? ' (fallback, not the house’s own)' : ''}`
                : ''}
            </p>
          </div>

          <div className="rc-sheet-block">
            <span className="rc-micro">Your subscription</span>
            {sub.status.subscription ? (
              <>
                <p className="rc-plain">
                  {sub.status.subscription.frequency === 'weekly'
                    ? `Weekly, ${
                        WEEKDAYS.find((w) => w.iso === sub.status!.subscription!.weekday)?.label ??
                        EM
                      }`
                    : 'Daily'}
                </p>
                {refusal && (
                  <p className="rc-said" role="alert">
                    {refusal}
                  </p>
                )}
                <div className="rc-row">
                  <button
                    type="button"
                    className="rc-quiet"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const ok = await sub.unsubscribe();
                      setBusy(false);
                      if (!ok) setRefusal(sub.failure?.message ?? 'the stop was not stored');
                    }}
                  >
                    {busy ? 'Stopping…' : 'Stop my copy'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rc-scopes" role="radiogroup" aria-label="How often">
                  {(['daily', 'weekly'] as DigestFrequency[]).map((f) => (
                    <label key={f} className="rc-scope">
                      <input
                        type="radio"
                        name="digest-frequency"
                        checked={frequency === f}
                        onChange={() => setFrequency(f)}
                      />
                      <span>{f === 'daily' ? 'Daily' : 'Weekly'}</span>
                    </label>
                  ))}
                </div>
                {frequency === 'weekly' && (
                  <label className="rc-field">
                    <span className="rc-micro">On</span>
                    <select
                      value={weekday}
                      aria-label="Weekday"
                      onChange={(ev) => setWeekday(Number(ev.target.value))}
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w.iso} value={w.iso}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {refusal && (
                  <p className="rc-said" role="alert">
                    {refusal}
                  </p>
                )}
                <div className="rc-row">
                  <button
                    type="button"
                    className="rc-act"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setRefusal(null);
                      const ok = await sub.subscribe(frequency, frequency === 'weekly' ? weekday : null);
                      setBusy(false);
                      if (!ok) setRefusal(sub.failure?.message ?? 'nothing was stored');
                    }}
                  >
                    {busy ? 'Asking for it…' : 'Ask for a copy'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="rc-sheet-block">
            <span className="rc-micro">Last send to you</span>
            {sub.status.lastSend ? (
              <p className="rc-plain">
                {sub.status.lastSend.outcome ?? 'unknown'} — {fmtDay(sub.status.lastSend.dueAt)}
                {sub.status.lastSend.entriesCount != null
                  ? `, ${sub.status.lastSend.entriesCount} ${
                      sub.status.lastSend.entriesCount === 1 ? 'entry' : 'entries'
                    }`
                  : ''}
              </p>
            ) : (
              <p className="rc-plain">None recorded.</p>
            )}
            <p className="rc-why">
              Whether it was opened is not recorded — the sender knows only that mail was
              handed off, not that it was read.
            </p>
          </div>

          <p className="rc-why">
            The letter itself is not previewed here yet: that needs a read the gateway
            does not serve on this build (<span className="rc-num">GET /recommendations/digest/preview</span>).
          </p>
        </>
      )}
    </Sheet>
  );
}

/* ── the rail block ──────────────────────────────────────────────────────── */

export default function DigestPost({
  digest,
  onSaveHouse,
  houseLastPost,
}: {
  digest: DigestPref | null | undefined;
  /**
   * The house's latest post and how many letters went out on it — never who
   * (sketch 122 Q8, the founder 2026-09-25, round 5, "Count, not who
   * (Recommended)"). Shown to every member, recipient or not. undefined =
   * not read (or this gateway does not send it): nothing is said about it.
   */
  houseLastPost?: { periodKey: string; sent: number; atCap: boolean } | null;
  onSaveHouse: (patch: {
    digestEnabled?: boolean;
    digestHour?: number;
    digestMinUrgency?: string;
  }) => Promise<DigestWrite>;
}) {
  const [open, setOpen] = useState<'house' | 'mine' | null>(null);

  return (
    <div className="rc-aside-block">
      <div className="rc-micro">The post</div>
      <p className="rc-plain">
        {digest === undefined
          ? 'Reading the house’s post…'
          : digest === null
            ? `House preference unreadable ${EM}`
            : !digest.set
              ? 'Not yet set for this house'
              : `${digest.digestEnabled ? 'Armed' : 'Not armed'}, ${String(
                  digest.digestHour,
                ).padStart(2, '0')}:00`}
      </p>
      <div className="rc-row">
        <button type="button" className="rc-quiet" onClick={() => setOpen('house')}>
          The house's post
        </button>
        <button type="button" className="rc-quiet" onClick={() => setOpen('mine')}>
          Your copy
        </button>
      </div>
      <p className="rc-why">
        The house's post arms a scheduled send for everyone; your copy is whether you
        personally receive one, on your own cadence.
      </p>
      {houseLastPost !== undefined && (
        <p className="rc-plain" data-testid="rc-post-count">
          {houseLastPost === null
            ? 'No letter has gone out from this house yet.'
            : `Last sent ${fmtDay(houseLastPost.periodKey)}: ${houseLastPost.atCap ? 'at least ' : ''}${
                houseLastPost.sent
              } ${houseLastPost.sent === 1 ? 'letter' : 'letters'}. Who received one is not shown.`}
        </p>
      )}

      {open === 'house' && (
        <HousePostSheet digest={digest} onClose={() => setOpen(null)} onSave={onSaveHouse} />
      )}
      {open === 'mine' && <YourCopySheet onClose={() => setOpen(null)} />}
    </div>
  );
}
