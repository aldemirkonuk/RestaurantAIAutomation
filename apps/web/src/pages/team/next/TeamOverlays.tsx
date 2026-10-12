/**
 * Everything the desk opens that is not a shift or a person.
 *
 * The shapes are ADR 0112's, chosen by what the overlay is FOR:
 *   · `Panel`   — publish, re-publish, copy last week. Each one asks for a
 *                 decision, and each one DELETES before it writes, so each is
 *                 sealed with `HoldToApprove` and says in words what it
 *                 destroys.
 *   · `Sheet`   — the broadcast composer and the time-off file: one object, or
 *                 one act, arriving from the right.
 *   · `Popover` — export, hanging off the control that opened it.
 *
 * WHY THE SEAL IS ON THESE THREE AND NOTHING ELSE. `HoldToApprove` is the house
 * ceremony for real commitment and it is rationed. Copy-week DELETES every shift
 * already on the target week before it writes (`schedule.service.ts:202-207`),
 * and a re-publish DELETES every read receipt — the record of who has seen the
 * schedule (`:248-251`). Both were one click on the legacy desk. A first
 * publish destroys nothing, so it gets the die pressed dry: a plain confirm.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ClipboardCopy,
  FileSpreadsheet,
  FileText,
  Printer,
  Sheet as SheetIcon,
} from 'lucide-react';
import { HoldToApprove, Panel, Popover, Sheet } from '@/components/mudavym';
import {
  copyWeek,
  createTeamNote,
  createSchedule,
  createTimeOff,
  getTextSenders,
  publishSchedule,
  reviewTimeOff,
  type HouseMoney,
  type LeaveType,
  type Shift,
  type TeamMember,
  type TeamNotesReadout,
  type TextSendersReadout,
} from '../../../services/api/team';
import { isUnconfirmedWrite } from '../../../services/api/client';
import { useDraftWriteKey, writeOutcomeUnknown } from '@/lib/draftWriteKey';
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport';
import {
  EM,
  addDays,
  fmtDayShort,
  fmtWeekRange,
  resolveName,
  todayIso,
  workedHours,
} from './tm-format';
import { houseToday, useHouseZone } from '@/lib/houseZone';
import { MutationError, Tag, useHouseLabourRules } from './tm-bits';
import { useActiveRestaurantId, type TimeOffRow } from './useTeamNextData';
import { AwayMarker } from '@/components/mudavym/AwayMarker';
import { dayWords } from '@/components/mudavym/awayWords';
import type { AwayView } from '../../../services/api/areas';

/** The gateway's own words when it has them — a 409 says exactly what is missing. */
export function serverMessage(e: unknown): string | null {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

/* ── publish / re-publish ────────────────────────────────────────────────── */

/** The status of a refusal, when the gateway answered at all. */
function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

/** Whom a publish reached (F-1148, F-1228). `notified` is the crew alone. */
interface PublishReach {
  notified: number | null;
  heldAway: number;
  /** On the roster with no account: nothing could reach them. */
  noAccount: number;
  /** False when the notice was written to nobody at all. */
  announced: boolean;
}

function reachSentence(r: PublishReach): string {
  if (!r.announced) {
    return 'The week is live, but the announcement did not reach anyone, so nobody on the team has been told yet.';
  }
  const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);
  const left: string[] = [];
  if (r.heldAway > 0) left.push(`${people(r.heldAway)} who ${r.heldAway === 1 ? 'is' : 'are'} Away`);
  if (r.noAccount > 0) {
    left.push(`${people(r.noAccount)} on the roster with no account`);
  }
  if (r.notified === 0) {
    return `The week is live, but nobody on the crew was told: only owners and managers got the notice.${
      left.length ? ` Not told: ${left.join(' and ')}. Tell them yourself.` : ''
    }`;
  }
  return `The week is live and the team was told, except ${left.join(' and ')}: they were not told.`;
}

export function PublishPanel({
  weekStart,
  scheduleId,
  republish,
  receiptsSeen,
  onClose,
  onDone,
}: {
  weekStart: string;
  scheduleId: string | null;
  /** The week as last read, not as it was when the panel opened (F-1115). */
  republish: boolean;
  /** `null` when the week has not answered — the sentence then says so. */
  receiptsSeen: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  /** F-1114: the gateway left a live, unchanged week as it was and told nobody. */
  const [unchanged, setUnchanged] = useState(false);
  /**
   * F-1148: the week went live but the announcement reached nobody, or left
   * out the people who are Away. `null` until a publish says so.
   */
  const [reach, setReach] = useState<PublishReach | null>(null);
  /** Bumped by a refusal, so the seal stands up again for the next try. */
  const [tries, setTries] = useState(0);
  const publish = useMutation({
    mutationFn: async ({ again = false }: { again?: boolean } = {}) => {
      let id = scheduleId;
      if (!id) id = (await createSchedule(weekStart)).id;
      // The flag is sent ONLY from a branch that has already shown what it
      // destroys (a re-publish over receipts, or an unknown count), or from
      // the explicit "Send the announcement again", so the gateway's 409
      // keeps guarding every other path. A re-publish over no receipts sends
      // nothing, so an unchanged week is not announced twice (F-1082).
      const reset = again || (republish && receiptsSeen !== 0);
      return publishSchedule(id, reset ? { resetReceipts: true } : {});
    },
    onSuccess: (
      res:
        | {
            republished?: boolean;
            unchanged?: boolean;
            notified?: number | null;
            announced?: boolean;
            noAccount?: number | null;
            heldAway?: number;
          }
        | undefined,
    ) => {
      onDone();
      // A first publish also answers `republished: false`, with a count; only
      // the gateway's "left as it is" answer carries none (or says `unchanged`).
      if (
        res?.unchanged === true ||
        (res?.republished === false && typeof res.notified !== 'number')
      ) {
        setReach(null);
        setUnchanged(true);
        return;
      }
      // An older gateway sends no count; only a count it sent is read.
      const notified = typeof res?.notified === 'number' ? res.notified : null;
      const heldAway = typeof res?.heldAway === 'number' ? res.heldAway : 0;
      const noAccount = typeof res?.noAccount === 'number' ? res.noAccount : 0;
      // F-1228: `notified` counts the crew only, so 0 with the notice written
      // (`announced`) is a week only owners and managers heard about. Without
      // `announced`, 0 is the funnel's failed write, as before.
      const announced =
        typeof res?.announced === 'boolean' ? res.announced : notified !== 0;
      if (
        !announced ||
        notified === 0 ||
        (notified !== null && (heldAway > 0 || noAccount > 0))
      ) {
        setUnchanged(false);
        setReach({ notified, heldAway, noAccount, announced });
        return;
      }
      onClose();
    },
    // F-1082: a reply lost after the gateway published leaves the week live
    // and the crew told. The week is read again so the page shows what is
    // true; pressing again is safe, since an unchanged live week is not
    // announced twice. F-1115: a 409 means the week moved under the panel
    // (someone published it, or the crew started marking it seen), so it is
    // read again too and the panel redraws from what is there now.
    onError: (e) => {
      setTries((n) => n + 1);
      if (isUnconfirmedWrite(e) || statusOf(e) === 409) onDone();
    },
  });

  const failure = !publish.isError
    ? null
    : isUnconfirmedWrite(publish.error)
      ? 'We could not confirm the publish. The week may already be live and the crew told. Check the week before you publish again.'
      : statusOf(publish.error) === 409
        ? 'This week changed after you opened this panel: it was published, or someone has already marked it seen. Nothing was published. The panel now shows the week as it stands; press again if you still want to publish it.'
        : (serverMessage(publish.error) ??
          'The week was not published. Nothing changed and nobody was notified.');

  return (
    <Panel
      open
      onClose={onClose}
      label={republish ? 'Re-publish this week' : 'Publish this week'}
      eyebrow={fmtWeekRange(weekStart)}
      title={republish ? 'Re-publish this week' : 'Publish this week'}
    >
      <div className="tm-in" style={{ padding: '12px 16px 16px' }}>
        <MutationError when={publish.isError}>{failure}</MutationError>
        {reach ? (
          <>
            <p className="tm-note" role="status">
              {reachSentence(reach)}
            </p>
            <div className="tm-actions" style={{ marginTop: 14 }}>
              <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
                Done
              </button>
              {!reach.announced && (
                <button
                  type="button"
                  className="tm-ctl tm-ctl--seal"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate({ again: true })}
                >
                  {publish.isPending ? 'Sending…' : 'Send the announcement again'}
                </button>
              )}
            </div>
          </>
        ) : unchanged ? (
          <>
            <p className="tm-note" role="status">
              Nothing on this week has changed since it went live, so it was left as it is
              and nobody was notified again.
            </p>
            <p className="tm-note">
              If someone missed the announcement, you can send it again. Everyone on the
              team is told once more.
            </p>
            <div className="tm-actions" style={{ marginTop: 14 }}>
              <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
                Done
              </button>
              <button
                type="button"
                className="tm-ctl tm-ctl--seal"
                disabled={publish.isPending}
                onClick={() => publish.mutate({ again: true })}
              >
                {publish.isPending ? 'Sending…' : 'Send the announcement again'}
              </button>
            </div>
          </>
        ) : (
          <>
            {republish ? (
              <p className="tm-note">
                {receiptsSeen === 0
                  ? 'Nobody has marked this week seen yet, so no record is deleted. If a shift changed since it went live, everyone is told again; if nothing did, nobody is.'
                  : `Re-publishing clears every read receipt, so the record of who has already seen this schedule ${
                      receiptsSeen === null
                        ? `(${EM} — the week has not answered, so how many is unknown)`
                        : `(${receiptsSeen} so far)`
                    } is deleted, and everyone is notified again. This cannot be undone.`}
              </p>
            ) : (
              <p className="tm-note">
                Publishing tells the whole crew the week is final and starts collecting read
                receipts. Nothing is deleted.
              </p>
            )}
            <div className="tm-actions" style={{ marginTop: 14 }}>
              <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
                Not yet
              </button>
              {republish ? (
                <HoldToApprove
                  key={`${receiptsSeen ?? 'unknown'}:${tries}`}
                  onApprove={() => publish.mutate({})}
                  label={
                    receiptsSeen === 0
                      ? 'Hold to re-publish'
                      : 'Hold to re-publish and clear receipts'
                  }
                  approvedLabel="Publishing…"
                  disabled={publish.isPending}
                />
              ) : (
                <button
                  type="button"
                  className="tm-ctl tm-ctl--seal"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate({})}
                >
                  {publish.isPending ? 'Publishing…' : 'Publish the week'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ── copy last week ──────────────────────────────────────────────────────── */

export function CopyWeekPanel({
  weekStart,
  shiftsOnTarget,
  lostCopies,
  onClose,
  onDone,
}: {
  weekStart: string;
  /** `null` when the week has not answered — then the sentence refuses a number. */
  shiftsOnTarget: number | null;
  /**
   * The weeks whose last copy went unanswered (F-1117). Held by the desk, not
   * the panel: the seal approves once, so a retry is a panel opened again.
   */
  lostCopies?: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  /**
   * What the person agreed to (F-1030). The count they were shown goes with
   * the copy, so a week another manager filled after this page loaded is
   * refused in words instead of wiped. An empty week is copied into, never
   * replaced, so the gateway's own "already has shifts" refusal stays armed.
   * An unknown count was shown as "every shift already on it", and that is
   * what holding the button agreed to.
   */
  const empty = shiftsOnTarget === 0;
  /**
   * A copy whose answer was lost (F-1117) may have landed, so the week is
   * read again. A retry the week then refuses as changed is most likely
   * refused over this person's own copy, so it is not answered as someone
   * else's change.
   */
  const ownLost = useRef(new Set<string>());
  const lost = lostCopies ?? ownLost.current;
  const copy = useMutation({
    mutationFn: () =>
      copyWeek(
        addDays(weekStart, -7),
        weekStart,
        shiftsOnTarget === null
          ? { replaceTarget: true }
          : { replaceTarget: !empty, expectShifts: shiftsOnTarget },
      ),
    onSuccess: () => {
      lost.delete(weekStart);
      onDone();
      onClose();
    },
    onError: (e) => {
      if (writeOutcomeUnknown(e)) lost.add(weekStart);
      if (lost.has(weekStart)) onDone();
    },
  });
  const status = (copy.error as { response?: { status?: unknown } } | null)?.response?.status;

  return (
    <Panel
      open
      onClose={onClose}
      label="Copy last week"
      eyebrow={`into ${fmtWeekRange(weekStart)}`}
      title="Copy last week"
    >
      <div className="tm-in" style={{ padding: '12px 16px 16px' }}>
        <MutationError when={copy.isError}>
          {writeOutcomeUnknown(copy.error)
            ? 'No answer came back, so last week may already be copied in. Check the week before you copy again.'
            : lost.has(weekStart) && status === 409
              ? 'This week has changed since you opened this, most likely by your own copy whose answer was lost. Check the week before you copy again.'
              : (serverMessage(copy.error) ??
                'Nothing was copied, and this week is exactly as it was.')}
        </MutationError>
        {empty ? (
          <p className="tm-note">
            This week has no shifts yet, so last week&apos;s are copied in and nothing is
            deleted. If someone adds shifts here before you finish, nothing is copied and
            you are told.
          </p>
        ) : (
          <p className="tm-note">
            Copying replaces this week first:{' '}
            {shiftsOnTarget === null
              ? 'every shift already on it'
              : `all ${shiftsOnTarget} shift${shiftsOnTarget === 1 ? '' : 's'} already on it`}{' '}
            is deleted before last week&apos;s arrive — including anything added by hand.
            This cannot be undone.
          </p>
        )}
        <p className="tm-note">
          A shift whose person is set to inactive, has approved time off that day, or
          already works then arrives as an open shift for the crew to claim.
        </p>
        <div className="tm-actions" style={{ marginTop: 14 }}>
          <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
            Leave it
          </button>
          <HoldToApprove
            onApprove={() => copy.mutate()}
            label={empty ? 'Hold to copy last week' : 'Hold to replace the week'}
            approvedLabel={empty ? 'Copied' : 'Replaced'}
            disabled={copy.isPending}
          />
        </div>
      </div>
    </Panel>
  );
}

/* ── the crew note — inline comms on the week ────────────────────────────── */

/**
 * A crew message on `/team` is a NOTE ON THE SCHEDULE, not correspondence.
 *
 * The founder's rule, 2026-09-04: the message sits in the page beside the week
 * it concerns, it always names who it went to, and nothing leaves through the
 * house's vendor mailbox. So the composer sends `channels: ['inbox', 'push']`
 * — the two the product owns. The gateway's email and SMS legs are gone
 * entirely as of 2026-09-04: both left through shared senders (the single
 * configured `GMAIL_SENDER_EMAIL` procurement writes to vendors from, and a
 * shared SMS account), so a reply landed in the vendor thread and a text came
 * from an unknown number. The gateway half is `dto/team.dto.ts`'s `channels`
 * and the `NO_SENDER` gate in `team.controller.ts`.
 *
 * WHAT THE STRIP CAN AND CANNOT SAY. Rewritten 2026-09-04: this paragraph used
 * to say that nothing anywhere recorded a sent crew message and that a
 * `team_notes` store was still only a §13 request. Both stopped being true the
 * same day — migration `20260904180000` created `team_notes` and
 * `team_note_recipients`, and `notes.service.ts` reads them back (`list`,
 * `:55`) — so the paragraph was describing an absence that had been filled.
 *
 * There are now TWO durable receipt stores on this page, and the strip keeps
 * them in separate columns because they are separate facts:
 *
 *   `schedule_receipts`              opening the PUBLISHED WEEK. Written by
 *   (baseline `:5293-5298`)          `POST …/schedules/:id/acknowledge`.
 *   `team_note_recipients.opened_at` reading ONE NOTE. Written by
 *   (`notes.service.ts:227`)         `markOpened`; NULL means unopened.
 *
 * Blending them would make "saw the roster" and "read the message" the same
 * fact. Neither column ever reports a failed read as a zero: an unreadable
 * note register says whether anything was said is unknown, and a receipt list
 * that has not answered shows an em dash, not 0 of N.
 */

/**
 * The strip is a READ of the register now, not a memory of this page.
 *
 * Until 2026-09-04 it could only report the send it had just made, because
 * `broadcast` left nothing behind — so an empty strip had to be captioned "not
 * from here, this session". `team_notes` and `team_note_recipients` (migration
 * 20260904180000) give a note an author, the audience it named at send time,
 * and a per-person `openedAt`, so the strip survives a reload and can say who
 * has read the note as distinct from who has opened the SCHEDULE.
 *
 * The two receipts stay apart, deliberately. `schedule_receipts` records
 * opening the published week; `team_note_recipients.opened_at` records reading
 * one note. Blending them would make "saw the roster" and "read the message"
 * the same fact.
 */
export function CrewNoteStrip({
  members,
  notes,
  notesFailed,
  receipts,
  published,
  weekStart,
  onCompose,
}: {
  members: TeamMember[] | null;
  /** `null` until the register answers; `readable: false` is a failed read. */
  notes: TeamNotesReadout | null;
  notesFailed: boolean;
  /** `schedule_receipts` rows for the published week; `null` until it answers. */
  receipts: Array<{ member_id: string; seen_at: string }> | null;
  published: boolean;
  weekStart: string;
  onCompose: () => void;
}) {
  const seenNames = useMemo(() => {
    if (receipts === null || members === null) return null;
    const byId = new Map(members.map((m) => [m.id, resolveName(m).text]));
    return receipts.map((r) => byId.get(r.member_id) ?? 'someone no longer on the roster');
  }, [receipts, members]);
  const crew = (members ?? []).filter((m) => m.status === 'active' && m.accountLinked).length;
  const latest = notes?.notes[0] ?? null;
  const unreadable = notesFailed || (notes !== null && !notes.readable);

  return (
    <section className="tm-panel" aria-label="Crew note" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 className="tm-panel__title">The week&apos;s note</h2>
          {unreadable ? (
            <p className="tm-alert" role="alert">
              The note register could not be read
              {notes?.reason ? ` (${notes.reason})` : ''}, so whether anything has been
              said about this week is unknown — not no.
            </p>
          ) : notes === null ? (
            <p className="tm-quiet">Reading the week&apos;s notes…</p>
          ) : latest === null ? (
            <p className="tm-note">
              Nothing has been written about {fmtWeekRange(weekStart)}. That is the
              register answering, not this page forgetting.
            </p>
          ) : (
            <>
              <p className="tm-note">{latest.body}</p>
              <p className="tm-hint">
                {`Sent to ${latest.addressedCount} ${latest.addressedCount === 1 ? 'person' : 'people'} through ${latest.channels.join(' and ')} — `}
                {latest.openedCount === 0
                  ? 'nobody has opened it yet'
                  : `${latest.openedCount} of ${latest.addressedCount} have opened it: ${latest.recipients
                      .filter((r) => r.openedAt)
                      .map((r) => r.name ?? `${EM} name unreadable`)
                      .join(', ')}`}
                . No email and no SMS left the building.
              </p>
              {notes.notes.length > 1 && (
                <p className="tm-hint">
                  {notes.notes.length - 1} earlier note
                  {notes.notes.length - 1 === 1 ? '' : 's'} about this week.
                </p>
              )}
            </>
          )}
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h2 className="tm-panel__title">Who has opened the week</h2>
          {!published ? (
            <p className="tm-quiet">
              The week is not published, so there is nothing for anyone to have opened.
            </p>
          ) : seenNames === null ? (
            <p className="tm-quiet">
              The read receipts have not answered — {EM} of {crew || EM}.
            </p>
          ) : seenNames.length === 0 ? (
            <p className="tm-note">
              Nobody has opened the published week yet ({crew} on the crew). That is a
              measured zero: `schedule_receipts` holds no row for this schedule.
            </p>
          ) : (
            <>
              <p className="tm-note">
                {seenNames.length} of {crew} have opened it: {seenNames.join(', ')}.
              </p>
              <p className="tm-hint">
                From `schedule_receipts`, which records opening the SCHEDULE — a different
                fact from reading the note beside it.
              </p>
            </>
          )}
        </div>
        <button type="button" className="tm-ctl" onClick={onCompose}>
          Write a note
        </button>
      </div>
    </section>
  );
}

/**
 * The crew text, as a state rather than a switch (ADR 0121; the founder,
 * 2026-09-05: *"a crew text exists and build it next"*).
 *
 * WHY IT IS NOT A TOGGLE. A toggle implies the sender is a choice this composer
 * makes. It is not: a note reaches a person by text when THIS HOUSE has a
 * connected sender AND THAT PERSON has consented, and neither of those is
 * something the manager writing the note can decide here. A switch would let a
 * manager turn something "on" that stays off, which is a control that appears
 * to succeed — the one thing this product may not draw.
 *
 * THREE STATES, AND THE DISABLED ONES CARRY THE SENTENCE.
 *
 *   1. No sender.       The house has none, so nobody is texted. The control is
 *                       off and names where to get one.
 *   2. Sender, no one    A sender exists and nobody has agreed to be reached on
 *      consented.        it. The control is off and names WHOSE decision that is
 *                        — a manager cannot consent for anybody.
 *   3. Sender and        The people who agreed will be reached by text; the ones
 *      consents.         who did not are named as a number, not hidden.
 *
 * A FAILED READ IS A FOURTH THING and gets its own sentence, because "this
 * house has no sender" and "we could not find out" are different facts.
 */
export function CrewTextLeg({ recipientCount }: { recipientCount: number }) {
  // The gateway scopes the senders read by the active restaurant through a
  // header the key never sees; the id is IN the key so a house switch cannot
  // serve the previous house's senders from cache (ADR 0051 clause 2).
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['team-next-text-senders', rid],
    queryFn: getTextSenders,
    staleTime: 120_000,
    enabled: rid !== null,
  });
  const vm: TextSendersReadout | undefined = q.data;

  if (q.isLoading) {
    return (
      <div>
        <span className="tm-label">Text</span>
        <p className="tm-hint">Reading whether this house has a sender…</p>
      </div>
    );
  }
  if (q.isError || !vm || !vm.readable) {
    return (
      <div>
        <span className="tm-label">Text</span>
        <p className="tm-alert" role="alert">
          Whether this house has a text sender could not be read
          {vm?.reason ? ` (${vm.reason})` : ''}, so whether anybody would be texted
          is unknown — not no.
        </p>
      </div>
    );
  }

  const connected = [vm.senders.whatsapp, vm.senders.sms].filter(
    (s) => s && s.state === 'connected',
  );
  const consented = vm.crewConsents;

  const state: 'no_sender' | 'no_consent' | 'ready' =
    connected.length === 0 ? 'no_sender' : (consented ?? 0) === 0 ? 'no_consent' : 'ready';

  return (
    <div>
      <span className="tm-label">Text</span>
      <div className="tm-actions" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
        <button
          type="button"
          className="tm-ctl"
          disabled={state !== 'ready'}
          aria-disabled={state !== 'ready'}
        >
          {state === 'ready'
            ? `Also text ${consented} of ${recipientCount}`
            : 'Also text them'}
        </button>
      </div>
      {state === 'no_sender' && (
        <p className="tm-hint">
          This house has no text sender of its own, so nobody is texted. A crew
          text never leaves through a number shared with other restaurants:
          on a shared sender one person replying STOP silences the platform for
          every house on it. Connect one on /connections.
        </p>
      )}
      {state === 'no_consent' && (
        <p className="tm-hint">
          This house has a sender and nobody has agreed to be texted on it yet.
          Each person switches that on for themselves on /profile — nobody can
          agree on their behalf, and a consent a manager could grant would not be
          one.
        </p>
      )}
      {state === 'ready' && (
        <p className="tm-hint">
          {consented} of {recipientCount} have agreed to be texted at a number
          they gave. The rest are reached on the inbox and the phone only, and
          the note&apos;s receipt says so person by person.
          {vm.transport.built ? '' : ` ${vm.transport.words}`}
        </p>
      )}
      {consented === null && connected.length > 0 && (
        <p className="tm-hint">
          How many people have agreed is not shown here — that count is a
          manager&apos;s to see.
        </p>
      )}
    </div>
  );
}

/**
 * The composer. Small, always targeted, and it writes a RECORD: the note, its
 * author, the people it named and a per-person receipt. `broadcast` without
 * `memberIds` used to mean the whole restaurant across four channels, and a
 * control labelled "Message {name}" sent exactly that (ADR 0088/0089).
 */
export function CrewNoteSheet({
  members,
  membersFailed,
  only,
  weekStart,
  scheduleId,
  awayByUser,
  awayToday = null,
  onClose,
  onSent,
}: {
  members: TeamMember[] | null;
  membersFailed: boolean;
  /** A single member id, or null for the whole active crew. */
  only: string | null;
  weekStart: string;
  scheduleId: string | null;
  /**
   * Away windows by `public.users.user_id` (ADR 0218). A note to someone who
   * is Away waits until they are back, and the sender is told BEFORE sending
   * (the founder's round-2 answer 3: "the sender sees 'away until <date>'").
   * The gateway decides the hold; this only says it.
   */
  awayByUser?: ReadonlyMap<string, AwayView>;
  /** House-local today from the Away read; null while it has not answered. */
  awayToday?: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const recipients = useMemo(() => {
    const all = members ?? [];
    if (only) return all.filter((m) => m.id === only);
    return all.filter((m) => m.status === 'active' && m.accountLinked);
  }, [members, only]);
  // Who this note will wait for: Away TODAY (a window that starts later does
  // not hold a note sent now).
  const awayNow = (m: TeamMember): AwayView | null => {
    if (!awayByUser || awayToday === null || !m.user_id) return null;
    const w = awayByUser.get(m.user_id);
    return w && w.from <= awayToday && awayToday <= w.until ? w : null;
  };
  const waiting = recipients.filter((m) => awayNow(m) !== null);

  const send = useMutation({
    mutationFn: () =>
      createTeamNote({
        weekStart,
        body: message,
        memberIds: recipients.map((m) => m.id),
        scheduleId: scheduleId ?? undefined,
      }),
    onSuccess: () => {
      onSent();
      onClose();
    },
  });

  const n = recipients.length;
  return (
    <Sheet
      open
      onClose={onClose}
      label={only ? 'A note to one person' : 'A note to the crew'}
      eyebrow={`On the week of ${weekStart}`}
      title={only ? 'A note to one person' : 'A note to the crew'}
      footer={
        <span>
          Goes to the in-app inbox and the phone, and by text to anybody who has
          agreed and whom this house has a sender for. It does not become an
          email: this house has one mailbox and it is the one vendors are
          written from.
        </span>
      }
    >
      <div className="tm-in tm-form">
        <MutationError when={send.isError}>
          {serverMessage(send.error) ?? 'The note was not written, so nothing was sent.'}
        </MutationError>
        <div>
          <span className="tm-label">
            Reaches {n} {n === 1 ? 'person' : 'people'}
          </span>
          {membersFailed ? (
            <p className="tm-hint">
              The roster could not be read, so who this would reach is unknown. Sending is
              held until it can be named.
            </p>
          ) : members === null ? (
            <p className="tm-hint">Reading the roster…</p>
          ) : n === 0 ? (
            <p className="tm-hint">
              Nobody here has a linked account, so this note would reach nobody. The send
              control stays off rather than reporting a delivery that did not happen.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {recipients.map((m) => {
                const w = awayNow(m);
                const label = resolveName(m).text;
                return (
                  <Tag key={m.id}>
                    {w && awayToday ? (
                      <AwayMarker
                        name={label}
                        personLabel={label}
                        window={w}
                        today={awayToday}
                        interactive={false}
                      />
                    ) : (
                      label
                    )}
                  </Tag>
                );
              })}
            </div>
          )}
          {waiting.length > 0 && (
            <p className="tm-hint" data-testid="note-waits-for-away">
              {waiting
                .map((m) => `${resolveName(m).text} is away until ${dayWords(awayNow(m)!.until)}`)
                .join('; ')}
              . The note waits and reaches {waiting.length === 1 ? 'them' : 'each of them'} when
              they are back, outside their quiet hours.
            </p>
          )}
        </div>
        <CrewTextLeg recipientCount={n} />
        <label>
          <span className="tm-label">Note</span>
          <textarea
            className="tm-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="tm-hint">
            It is kept against this week and each person&apos;s reading of it is recorded,
            so it is still here after a reload — and you can see who has read it.
          </p>
        </label>
        <div className="tm-actions">
          <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tm-ctl tm-ctl--seal"
            disabled={send.isPending || message.trim() === '' || n === 0}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Sending…' : `Send to ${n}`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── time off ────────────────────────────────────────────────────────────── */

/** Whether the days are paid, in words. `unknown` is a real state: nobody said. */
function leaveWords(t: string | null | undefined): string {
  return t === 'paid' ? 'paid leave' : t === 'unpaid' ? 'unpaid leave' : 'paid or unpaid not said';
}

export function TimeOffSheet({
  requests,
  failed,
  members,
  weekStart,
  onClose,
  onChanged,
}: {
  requests: TimeOffRow[] | null;
  failed: boolean;
  members: TeamMember[] | null;
  weekStart: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [addFor, setAddFor] = useState('');
  /**
   * The days, picked like My Shifts does (F-936): the whole week on screen
   * made Tuesday's sick day take the person off all seven. It opens on the
   * house's today when that is in the week on screen, else the week's first
   * day; a past day can still be picked.
   */
  const zone = useHouseZone();
  const opening = (() => {
    const today = todayIso(houseToday(zone));
    return today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
  })();
  const [offFrom, setOffFrom] = useState(opening);
  const [offTo, setOffTo] = useState(opening);
  const rangeOk = offFrom !== '' && offTo !== '' && offFrom <= offTo;
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members ?? []) m.set(x.id, resolveName(x).text);
    return m;
  }, [members]);

  /*
   * F-1038: a decision moves the row (pending to decided, or its paid/unpaid
   * buttons go), so the button pressed is gone and focus would fall to the
   * page. Say what was recorded, aloud, and put focus on that line.
   */
  const [said, setSaid] = useState<string | null>(null);
  const saidRef = useRef<HTMLParagraphElement | null>(null);
  const review = useMutation({
    // Each button says the status its row showed, so a request another
    // manager decided since is refused, not overturned (F-1034).
    mutationFn: (v: {
      id: string;
      who: string;
      status: 'approved' | 'denied';
      leaveType?: LeaveType;
      expect: 'pending' | 'approved';
    }) => reviewTimeOff(v.id, v.status, v.leaveType, undefined, v.expect),
    onSuccess: (_d, v) => {
      setSaid(
        v.status === 'denied'
          ? `${v.who}: turned down.`
          : `${v.who}: approved as ${v.leaveType === 'paid' ? 'paid' : 'unpaid'}.`,
      );
      onChanged();
    },
  });
  useEffect(() => {
    if (!said) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    saidRef.current?.focus();
  }, [said, requests]);
  /** One key per request drawn, so a retry after a lost answer files it once (F-1118). */
  const addKey = useDraftWriteKey('time-off');
  const add = useMutation({
    mutationFn: () => {
      const draft = {
        memberId: addFor,
        startDate: offFrom,
        endDate: offTo,
        reason: 'Entered by a manager from the team desk',
      };
      return createTimeOff(draft, undefined, addKey.keyFor(draft));
    },
    onSuccess: () => {
      addKey.renew();
      setAddFor('');
      onChanged();
    },
    // A lost answer may be a filed request: read the file again.
    onError: (e) => {
      if (writeOutcomeUnknown(e)) onChanged();
    },
  });

  const whoOf = (r: TimeOffRow) => nameOf.get(r.member_id) ?? 'Someone no longer on the roster';
  const pending = (requests ?? []).filter((r) => r.status === 'pending');
  const settled = (requests ?? []).filter((r) => r.status !== 'pending');

  return (
    <Sheet
      open
      onClose={onClose}
      label="Time off"
      eyebrow="Requests on file"
      title="Time off"
      footer={
        <span>
          Approving a request changes its status and nothing else — it does not remove the
          person from shifts they already hold. Saying whether the days are paid lets the
          owner see paid leave beside the week&apos;s cost.
        </span>
      }
    >
      <div className="tm-in">
        <div style={{ padding: '12px 16px 0' }}>
          <MutationError when={review.isError}>
            {serverMessage(review.error) ??
              'The decision was not recorded, so the request is still where it was. If the person withdrew it, it is no longer yours to decide.'}
          </MutationError>
          <MutationError when={add.isError}>
            {writeOutcomeUnknown(add.error)
              ? 'No answer came back, so the request may already be on file. Check the list before filing it again.'
              : (serverMessage(add.error) ??
                "The request was not filed. Nothing is on the manager's desk.")}
          </MutationError>
          <p ref={saidRef} tabIndex={-1} role="status" className="tm-note">
            {said}
          </p>
          {failed ? (
            <p className="tm-alert" role="alert">
              The time-off file could not be read, so whether anyone has asked for this
              week is unknown — not no.
            </p>
          ) : requests === null ? (
            <p className="tm-quiet">Reaching the gateway…</p>
          ) : requests.length === 0 ? (
            <p className="tm-note">
              No request is on file for anyone. That is an empty file, and it is the only
              thing this page knows about availability — nothing records who is simply
              unavailable.
            </p>
          ) : null}
        </div>

        {pending.length > 0 && <span className="mdv-sect">Waiting on you</span>}
        {pending.map((r) => (
          <div key={r.id} className="tm-rrow" style={{ padding: '8px 16px' }}>
            <div id={`tm-off-${r.id}`} style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>
              {nameOf.get(r.member_id) ?? 'Someone no longer on the roster'}
            </div>
            <div className="tm-rrow__line">
              {fmtDayShort(r.start_date)} – {fmtDayShort(r.end_date)}
              {r.reason ? ` · ${r.reason}` : ''}
              {` · ${leaveWords(r.leave_type)}`}
            </div>
            <div className="tm-actions">
              <button
                type="button"
                className="tm-ctl tm-ctl--sm"
                disabled={review.isPending}
                aria-describedby={`tm-off-${r.id}`}
                onClick={() => review.mutate({ id: r.id, who: whoOf(r), status: 'approved', leaveType: 'paid', expect: 'pending' })}
              >
                Approve as paid
              </button>
              <button
                type="button"
                className="tm-ctl tm-ctl--sm"
                disabled={review.isPending}
                aria-describedby={`tm-off-${r.id}`}
                onClick={() => review.mutate({ id: r.id, who: whoOf(r), status: 'approved', leaveType: 'unpaid', expect: 'pending' })}
              >
                Approve as unpaid
              </button>
              <button
                type="button"
                className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                disabled={review.isPending}
                aria-describedby={`tm-off-${r.id}`}
                onClick={() => review.mutate({ id: r.id, who: whoOf(r), status: 'denied', expect: 'pending' })}
              >
                Deny
              </button>
            </div>
          </div>
        ))}

        {settled.length > 0 && <span className="mdv-sect">Decided</span>}
        {settled.map((r) => (
          <div key={r.id} className="tm-rrow" style={{ padding: '8px 16px' }}>
            <div id={`tm-off-${r.id}`} style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              {nameOf.get(r.member_id) ?? 'Someone no longer on the roster'} ·{' '}
              {r.status === 'denied'
                ? 'turned down'
                : r.status === 'withdrawn'
                  ? 'withdrawn by them'
                  : r.status}
            </div>
            <div className="tm-rrow__line">
              {fmtDayShort(r.start_date)} – {fmtDayShort(r.end_date)}
              {r.status === 'approved' ? ` · ${leaveWords(r.leave_type)}` : ''}
            </div>
            {r.status === 'approved' && (
              <div className="tm-actions">
                {(r.leave_type ?? 'unknown') === 'unknown' && (
                  <>
                    <button
                      type="button"
                      className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                      disabled={review.isPending}
                      aria-describedby={`tm-off-${r.id}`}
                      onClick={() => review.mutate({ id: r.id, who: whoOf(r), status: 'approved', leaveType: 'paid', expect: 'approved' })}
                    >
                      Mark paid
                    </button>
                    <button
                      type="button"
                      className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                      disabled={review.isPending}
                      aria-describedby={`tm-off-${r.id}`}
                      onClick={() => review.mutate({ id: r.id, who: whoOf(r), status: 'approved', leaveType: 'unpaid', expect: 'approved' })}
                    >
                      Mark unpaid
                    </button>
                  </>
                )}
                {/* An approved request blocks shifts on its days, so it has to
                    be undoable from here (F-936). The person is told. */}
                <button
                  type="button"
                  className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                  disabled={review.isPending}
                  aria-describedby={`tm-off-${r.id}`}
                  onClick={() => review.mutate({ id: r.id, who: whoOf(r), status: 'denied', expect: 'approved' })}
                >
                  Turn it down
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="tm-form" style={{ borderTop: '1px solid var(--paper-2)' }}>
          <label>
            <span className="tm-label">File a request for someone</span>
            <select
              className="tm-select"
              value={addFor}
              onChange={(e) => setAddFor(e.target.value)}
            >
              <option value="">Choose a person</option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {resolveName(m).text}
                </option>
              ))}
            </select>
          </label>
          <div className="tm-actions" style={{ flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                First day off
              </span>
              <input
                type="date"
                className="tm-input"
                value={offFrom}
                disabled={add.isPending}
                onChange={(e) => setOffFrom(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                Last day off
              </span>
              <input
                type="date"
                className="tm-input"
                value={offTo}
                min={offFrom || undefined}
                disabled={add.isPending}
                onChange={(e) => setOffTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="tm-ctl"
              disabled={add.isPending || addFor === '' || !rangeOk}
              onClick={() => add.mutate()}
            >
              {add.isPending ? 'Filing…' : 'File it'}
            </button>
            {!rangeOk && (
              <p className="tm-alert" role="alert" style={{ margin: 0, flexBasis: '100%' }}>
                {/* F-1019: a cleared date is not a reversed range. */}
                {offFrom === '' || offTo === ''
                  ? 'Pick both days.'
                  : 'The last day off comes before the first. Pick the days again.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* ── export ──────────────────────────────────────────────────────────────── */

const FORMATS: ReadonlyArray<[TableExportFormat, string]> = [
  ['csv', 'CSV'],
  ['excel', 'Excel'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['pdf', 'PDF'],
  ['clipboard', 'Copy to clipboard'],
];

export function ExportPopover({
  anchorRef,
  weekStart,
  shifts,
  members,
  moneyVisible,
  money,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  weekStart: string;
  /** `null` when the week has not answered — exporting is then refused in words. */
  shifts: Shift[] | null;
  members: TeamMember[] | null;
  /** The owner only (ADR 0215): nobody else's export carries a cost column. */
  moneyVisible: boolean;
  money: HouseMoney | null;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  /** Hours on the house's country's breaks (founder S195). */
  const rules = useHouseLabourRules();
  const rows = useMemo(
    () =>
      (shifts ?? [])
        .slice()
        .sort(
          (a, b) =>
            a.shift_date.localeCompare(b.shift_date) ||
            a.start_time.localeCompare(b.start_time),
        ),
    [shifts],
  );
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members ?? []) m.set(x.id, resolveName(x).text);
    return m;
  }, [members]);

  const columns: TableExportColumn<Shift>[] = [
    { header: 'Date', value: (s) => s.shift_date },
    { header: 'Who', value: (s) => (s.member_id ? (nameOf.get(s.member_id) ?? '') : 'open') },
    { header: 'Start', value: (s) => s.start_time },
    { header: 'End', value: (s) => s.end_time },
    { header: 'Station', value: (s) => s.role ?? '' },
    { header: 'Kind', value: (s) => s.shift_type },
    { header: 'State', value: (s) => s.state },
    // Hours are what payroll is handed (founder, 2026-09-21: "Hand hours
    // over"): worked hours, breaks taken out (the house's country's rule).
    {
      header: 'Hours worked',
      value: (s) =>
        Math.round(workedHours(s, rules) * 100) / 100,
    },
    // The owner only, and in the house's own money: the header names the
    // currency, because a bare number in a spreadsheet has none.
    // An unpriced shift exports as blank, never as 0 — a spreadsheet sums a 0.
    ...(moneyVisible
      ? [
          {
            header: `Labour cost (${money?.readable && money.currency ? money.currency : 'currency not recorded'})`,
            value: (s: Shift) => (s.labor_cost == null ? '' : s.labor_cost),
          },
        ]
      : []),
  ];

  const run = async (format: TableExportFormat) => {
    setFailed(null);
    try {
      await exportTable({
        format,
        rows,
        columns,
        filename: `schedule-${weekStart}`,
        title: `Schedule — week of ${weekStart}`,
      });
      onClose();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'the export did not complete');
    }
  };

  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      label="Export the week"
      width={260}
      showClose={false}
    >
      <span className="mdv-sect">
        {shifts === null ? 'The week has not answered' : `${rows.length} shifts`}
      </span>
      {shifts === null ? (
        <p className="mdv-note">
          Nothing is exported while the week is unknown — an empty file would read as a
          week with no shifts.
        </p>
      ) : (
        FORMATS.map(([format, label]) => (
          <button
            key={format}
            type="button"
            className="mdv-item"
            onClick={() => void run(format)}
          >
            {format === 'clipboard' ? (
              <ClipboardCopy size={14} aria-hidden className="mdv-item__icon" />
            ) : format === 'pdf' ? (
              <FileText size={14} aria-hidden className="mdv-item__icon" />
            ) : format === 'excel' ? (
              <SheetIcon size={14} aria-hidden className="mdv-item__icon" />
            ) : (
              <FileSpreadsheet size={14} aria-hidden className="mdv-item__icon" />
            )}
            <span className="mdv-item__text">{label}</span>
          </button>
        ))
      )}
      <button type="button" className="mdv-item" onClick={() => void run('print')}>
        <Printer size={14} aria-hidden className="mdv-item__icon" />
        <span className="mdv-item__text">Print the floor sheet</span>
      </button>
      {failed && <p className="mdv-note">The export did not run — {failed}.</p>}
    </Popover>
  );
}
