/**
 * One entry in the standing book.
 *
 * The structural idea, in one row: an entry is not a card of prose — it is a
 * ruled record with THREE stated facts the legacy feed never gave, in the same
 * place on every entry:
 *
 *   WHAT IT WOULD CHANGE (the stake) · WHOSE HAND (and where) · STANDING (how long)
 *
 * Everything else — the rationale, the rule key, the assignment, the feedback,
 * and the sealed "rule off" — lives under "the working", which opens on the
 * house `settle` curve (the founder's named favourite motion).
 *
 * Honesty: `standing` is the first time this rule was ever SHOWN — the gateway
 * reads it from `recommendation_impressions` — and the row says which clock it
 * came from, because "first fired" and "last decided on" are different facts.
 * An em dash only where nothing recorded either. The house's own hand is
 * rendered DISABLED with the reason, because no autonomous execution exists
 * anywhere in the gateway today.
 *
 * The dismissal sheet (2026-09-03) is the one control here that stores a
 * STANDING INSTRUCTION rather than a note about a card, so it is the one that
 * asks before it acts: a reason, a scope (this finding · this subject · the
 * whole rule), and — separately — whether the day should also come out of the
 * analysis. It never builds a suppression key; the gateway sends all three.
 *
 * All styling is in `rec-next.css` (imported by the page) — Mudavym tokens only.
 */

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import {
  EM,
  SCOPE_ORDER,
  STAKE_LABEL,
  STANDING_BASIS,
  dateOfGrain,
  dismissalSentence,
  entryNo,
  fmtDay,
  fmtWakes,
  readKey,
  scopeLabel,
  scopePromise,
  standingOf,
  urgencyLabel,
  type SuppressionScope,
} from './rec-format';
import type {
  DismissChoice,
  EntryVM,
  ExclusionsVM,
  Leaf,
  TeamOption,
} from './useRecommendationsNextData';

const REASONS: Array<{ id: string; label: string }> = [
  { id: 'not_relevant', label: 'Not relevant' },
  { id: 'already_handled', label: 'Already handled' },
  { id: 'disagree', label: 'I disagree' },
  { id: 'not_now', label: 'Not right now' },
];

/**
 * The snooze vocabulary — a dropdown, not a table of rows: `value` is the
 * number of days the label already says out loud, and nothing here describes
 * the tenant. (Kept to descriptor keys deliberately, per
 * `scripts/check_no_seeded_defaults.py` S1's descriptor-vs-row distinction.)
 */
const SNOOZES: Array<{ id: string; label: string; value: number }> = [
  { id: 'tomorrow', label: 'Until tomorrow', value: 1 },
  { id: 'week', label: 'Until next week', value: 7 },
  { id: 'month', label: 'Until next month', value: 30 },
];

export interface EntryProps {
  entry: EntryVM;
  index: number;
  leaf: Leaf;
  focused: boolean;
  selected: boolean;
  expanded: boolean;
  team: TeamOption[] | null | undefined;
  /** The day-exclusion store, so the sheet can offer — or refuse — that choice. */
  exclusions: ExclusionsVM | undefined;
  /** The `d` key asked for this entry's dismissal sheet. */
  openDismiss: boolean;
  onDismissOpened: () => void;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onAct: () => void;
  onDismiss: (choice: DismissChoice) => void;
  onSnooze: (days: number, label: string) => void;
  onPin: () => void;
  onRate: (value: 'helpful' | 'not_helpful') => void;
  onDone: () => void;
  onRestore: () => void;
  onAssign: (member: TeamOption | null) => void;
  onWantTeam: () => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rc-fact">
      <div className="rc-micro">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Quiet({
  children,
  onClick,
  pressed,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button type="button" className="rc-quiet" onClick={onClick} aria-pressed={pressed}>
      {children}
    </button>
  );
}

/**
 * What this entry can actually be silenced BY.
 *
 * A scope the entry cannot support is not offered. A rule that names no
 * weekday cannot be silenced "for Wednesdays", and a rule that names no period
 * cannot be silenced "for this day" — offering either would be the fake
 * control the house rule forbids, and would quietly store a wider silence than
 * the manager agreed to. The gateway has already resolved this: it sends the
 * three keys, and `keys.insight === keys.rule` is exactly the case where the
 * narrow choice does not exist.
 */
function scopesFor(e: EntryVM): SuppressionScope[] {
  const keys = e.suppression?.keys;
  if (!keys) return ['rule'];
  // Walk WIDEST first. Two scopes that resolve to the same key are the same
  // instruction, and the honest name for it is the wider one: a rule naming no
  // weekday collapses all three keys to the bare rule key, and calling that
  // "this exact finding" would promise a narrow silence while storing a total
  // one. Then restore the reading order (narrowest first) so the default stays
  // the narrowest choice the entry can actually support.
  const seen = new Set<string>();
  const kept = new Set<SuppressionScope>();
  for (const s of [...SCOPE_ORDER].reverse()) {
    if (seen.has(keys[s])) continue;
    seen.add(keys[s]);
    kept.add(s);
  }
  return SCOPE_ORDER.filter((s) => kept.has(s));
}

export default function Entry(props: EntryProps) {
  const { entry: e, leaf, focused, selected, expanded, team } = props;
  const [menu, setMenu] = useState<'dismiss' | 'snooze' | 'assign' | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  /* ── the dismissal sheet's own state ──────────────────────────────────── */
  const scopes = useMemo(() => scopesFor(e), [e]);
  const [reason, setReason] = useState<string | null>(null);
  const [scope, setScope] = useState<SuppressionScope>(scopes[0]);
  const [alsoExclude, setAlsoExclude] = useState(false);
  useEffect(() => {
    // Opening the sheet always starts from the founder's default — the exact
    // finding — never from whatever was chosen last time.
    if (menu === 'dismiss') {
      setReason(null);
      setScope(scopes[0]);
      setAlsoExclude(false);
    }
  }, [menu, scopes]);

  // The keyboard shortcut opens the sheet; it never dismisses. A dismissal
  // now carries a scope, and a keystroke cannot choose one for the manager.
  const { openDismiss, onDismissOpened } = props;
  useEffect(() => {
    if (!openDismiss) return;
    setMenu('dismiss');
    onDismissOpened();
  }, [openDismiss, onDismissOpened]);

  const day = dateOfGrain(e.periodKey);
  const exclusions = props.exclusions;
  const canExclude = !!day && exclusions?.readable === true;

  useEffect(() => {
    const node = rootRef.current;
    // jsdom (and any engine without the CSSOM view module) has no
    // scrollIntoView — keyboard navigation must still work there.
    if (focused && typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const stood = standingOf(e);
  const standing = leaf === 'snoozed' ? fmtWakes(e.snoozeUntil) : stood.text;
  const live = leaf === 'standing';
  /** On the dismissed/history leaves the row's own key IS the stored silence. */
  const silenced = leaf === 'dismissed' || leaf === 'history';

  return (
    <article
      ref={rootRef}
      id={`rc-entry-${e.ruleKey}`}
      data-testid="rc-entry"
      className="rc-entry"
      data-focused={focused ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
    >
      {/* gutter — the entry's number in the book, and its pin */}
      <div className="rc-gutter">
        <div className="rc-num">{entryNo(props.index)}</div>
        {e.pinned && <div className="rc-micro rc-micro-seal">PIN</div>}
      </div>

      <div className="rc-body">
        {/* the register line — urgency and rule category, the engine's own words */}
        <div className="rc-stamps">
          <span className="rc-micro">{urgencyLabel(e.urgency)}</span>
          <span className="rc-micro rc-micro-dim">{e.category || 'uncategorised'}</span>
          {e.acted && <span className="rc-micro">acted</span>}
          {e.assignedName && <span className="rc-micro rc-micro-seal">{e.assignedName}</span>}
        </div>

        {/* the product speaking: the observed number, restated */}
        <p className="rc-serif rc-obs">
          {e.observation || 'This entry carries no stored observation.'}
        </p>

        {e.recommendation ? (
          <p className="rc-do">{e.recommendation}</p>
        ) : (
          <p className="rc-do-none">
            No action was stored with this entry {EM} it was filed from a snapshot.
          </p>
        )}

        {/* ── the three facts, in the same place on every entry ─────────── */}
        <div className="rc-facts">
          <Fact label="Would change">{STAKE_LABEL[e.stake]}</Fact>
          <Fact label="Whose hand">Yours, in {e.hand.where}</Fact>
          <Fact label={leaf === 'snoozed' ? 'Wakes' : 'Standing'}>
            <span className="rc-num" title={leaf === 'snoozed' ? undefined : STANDING_BASIS[stood.basis]}>
              {standing}
            </span>
            {leaf !== 'snoozed' && (
              <span className="rc-basis">{STANDING_BASIS[stood.basis]}</span>
            )}
          </Fact>
        </div>

        {/* what a dismissal actually silenced, read back from the stored key */}
        {silenced && e.status === 'dismissed' && (
          <p className="rc-said rc-silenced" data-testid="rc-silenced">
            {dismissalSentence(e.ruleKey)}{' '}
            {readKey(e.ruleKey).subject
              ? 'Return it to the book below to see it again.'
              : 'Return it to the book below to hear from this rule again.'}
          </p>
        )}

        {/* ── controls ──────────────────────────────────────────────────── */}
        <div className="rc-controls">
          {live ? (
            <>
              <button type="button" className="rc-act" onClick={props.onAct}>
                {e.hand.label} →
              </button>
              <Quiet onClick={props.onToggleExpand}>
                {expanded ? 'Hide the working' : 'The working'}
              </Quiet>
              <Quiet onClick={() => setMenu(menu === 'snooze' ? null : 'snooze')}>Snooze</Quiet>
              <Quiet onClick={() => setMenu(menu === 'dismiss' ? null : 'dismiss')}>Dismiss</Quiet>
              <Quiet onClick={props.onPin} pressed={e.pinned}>
                {e.pinned ? 'Pinned' : 'Pin'}
              </Quiet>
              <Quiet onClick={props.onToggleSelect} pressed={selected}>
                {selected ? 'Selected' : 'Select'}
              </Quiet>
            </>
          ) : (
            <>
              <Quiet onClick={props.onToggleExpand}>
                {expanded ? 'Hide the working' : 'The working'}
              </Quiet>
              <Quiet onClick={props.onRestore}>Return it to the book</Quiet>
            </>
          )}
        </div>

        {menu === 'dismiss' && (
          <div className="rc-menu rc-sheet" role="group" aria-label="Dismiss this entry">
            <p className="rc-serif rc-sheet-title">Dismiss it — and never show it again</p>

            <div className="rc-sheet-block">
              <span className="rc-micro">Why are you dismissing it?</span>
              <div className="rc-row">
                {REASONS.map((r) => (
                  <Quiet
                    key={r.id}
                    pressed={reason === r.id}
                    onClick={() => setReason(r.id)}
                  >
                    {r.label}
                  </Quiet>
                ))}
              </div>
            </div>

            <div className="rc-sheet-block">
              <span className="rc-micro">Never show me…</span>
              <div className="rc-scopes" role="radiogroup" aria-label="What to silence">
                {scopes.map((s) => (
                  <label key={s} className="rc-scope">
                    <input
                      type="radio"
                      name={`scope-${e.ruleKey}`}
                      value={s}
                      checked={scope === s}
                      onChange={() => setScope(s)}
                    />
                    <span>{scopeLabel(s, e.subject, day)}</span>
                  </label>
                ))}
              </div>
              {scopes.length === 1 && (
                <p className="rc-why">
                  This rule names no weekday and no date, so there is no narrower
                  silence to offer {EM} dismissing it silences the whole rule.
                </p>
              )}
            </div>

            <div className="rc-sheet-block">
              <label className="rc-scope">
                <input
                  type="checkbox"
                  checked={alsoExclude}
                  disabled={!canExclude}
                  onChange={(ev) => setAlsoExclude(ev.target.checked)}
                />
                <span>
                  Also exclude {day ? fmtDay(day) : 'this day'} from the analysis
                </span>
              </label>
              <p className="rc-why">
                {!day
                  ? `This entry names no single day, so there is nothing to exclude ${EM} dismissing it hides the entry only.`
                  : exclusions === undefined
                    ? 'Reading the exclusion list…'
                    : exclusions.readable
                      ? 'A closure or an outage should not drag the average down. Excluding the day stops its numbers counting toward every baseline, on this page and everywhere else.'
                      : `The exclusion store could not be read (${exclusions.problem ?? 'no reason given'}), so this cannot be offered. Dismissing still works.`}
              </p>
            </div>

            <p className="rc-said rc-sheet-promise">
              After this you will not see{' '}
              {scopePromise(scope, e.subject, scope === 'insight' ? day : null, e.ruleKey)}.
              Undo it from the History leaf.
            </p>

            <div className="rc-row">
              <button
                type="button"
                className="rc-act"
                disabled={!reason}
                onClick={() => {
                  if (!reason) return;
                  const key = e.suppression?.keys[scope] ?? e.ruleKey;
                  setMenu(null);
                  props.onDismiss({
                    reason,
                    scope,
                    key,
                    excludeDate: alsoExclude && day ? day : null,
                    said: `Dismissed. You will not see ${scopePromise(
                      scope,
                      e.subject,
                      scope === 'insight' ? day : null,
                      e.ruleKey,
                    )}.`,
                  });
                }}
              >
                Dismiss it
              </button>
              <Quiet onClick={() => setMenu(null)}>Keep it standing</Quiet>
              {!reason && (
                <span className="rc-said">Pick a reason first {EM} it is stored with the entry.</span>
              )}
            </div>
          </div>
        )}

        {menu === 'snooze' && (
          <div className="rc-menu" role="group" aria-label="Snooze this entry">
            <span className="rc-micro">Put it back on the shelf until…</span>
            <div className="rc-row">
              {SNOOZES.map((s) => (
                <Quiet
                  key={s.id}
                  onClick={() => {
                    setMenu(null);
                    props.onSnooze(s.value, s.label.toLowerCase());
                  }}
                >
                  {s.label}
                </Quiet>
              ))}
            </div>
          </div>
        )}

        {/* ── the working — settle, 0fr → 1fr ───────────────────────────── */}
        {/*
          The working stays in the DOM so the grid-rows settle has something to
          animate — but a collapsed panel must not be readable or tabbable, so
          it is aria-hidden here and `visibility: hidden` in the CSS. Both flip
          with `expanded`; nothing is announced or focusable behind a closed
          row.
        */}
        <div className="rc-work" data-open={expanded ? 'true' : 'false'}>
          <div aria-hidden={!expanded}>
            <div className="rc-workbox">
              <span className="rc-micro">Why this follows</span>
              <p className="rc-prose">
                {e.rationale ??
                  `No rationale was stored with this entry ${EM} the snapshot in the actions table keeps the observation and the action only.`}
              </p>

              <div className="rc-workblock">
                <span className="rc-micro">The rule that fired</span>
                <p className="rc-num rc-rulekey">{e.ruleKey}</p>
                <p className="rc-said">
                  A deterministic rule, evaluated against your own numbers. No model wrote this
                  sentence.
                </p>
              </div>

              {/* the house's own hand — honestly dark */}
              <div className="rc-workblock">
                <span className="rc-micro">The house’s hand</span>
                <div className="rc-row">
                  <button type="button" className="rc-dark rc-dark-inline" disabled>
                    Let Mudavym do it
                  </button>
                  <span className="rc-said">
                    Not built: nothing in the gateway can carry out a recommendation on your
                    behalf, with or without permission.
                  </span>
                </div>
              </div>

              {/* assignment — real */}
              <div className="rc-workblock">
                <span className="rc-micro">Assigned to</span>
                <div className="rc-row">
                  <span className="rc-plain">
                    {e.assignedName ?? `nobody ${EM} this entry has no owner`}
                  </span>
                  <Quiet
                    onClick={() => {
                      props.onWantTeam();
                      setMenu(menu === 'assign' ? null : 'assign');
                    }}
                  >
                    {e.assignedName ? 'Reassign' : 'Assign'}
                  </Quiet>
                  {e.assignedName && <Quiet onClick={() => props.onAssign(null)}>Clear</Quiet>}
                </div>
                {menu === 'assign' && (
                  <div className="rc-row">
                    {team === undefined && <span className="rc-said">Reading the roster…</span>}
                    {team === null && (
                      <span className="rc-said">
                        The roster could not be read — nobody can be picked here right now.
                      </span>
                    )}
                    {Array.isArray(team) && team.length === 0 && (
                      <span className="rc-said">
                        The roster is empty — add a teammate on /team first.
                      </span>
                    )}
                    {Array.isArray(team) &&
                      team.map((m) => (
                        <Quiet
                          key={m.id}
                          onClick={() => {
                            setMenu(null);
                            props.onAssign(m);
                          }}
                        >
                          {m.name}
                        </Quiet>
                      ))}
                  </div>
                )}
              </div>

              {/* feedback — real */}
              <div className="rc-workblock rc-row">
                <span className="rc-micro">Was it worth reading?</span>
                <Quiet onClick={() => props.onRate('helpful')} pressed={e.feedback === 'helpful'}>
                  Worth it
                </Quiet>
                <Quiet
                  onClick={() => props.onRate('not_helpful')}
                  pressed={e.feedback === 'not_helpful'}
                >
                  Not worth it
                </Quiet>
              </div>

              {e.reason && <p className="rc-said rc-workblock">Filed with the reason “{e.reason}”.</p>}

              {/* the seal — the one ceremony on this page */}
              {live && (
                <div className="rc-seal-block">
                  <span className="rc-micro">Rule it off</span>
                  <p className="rc-said">
                    Hold to close the entry: you are asserting the work was done, and the book
                    rules it off.
                  </p>
                  <HoldToApprove
                    onApprove={props.onDone}
                    label="Hold to rule off"
                    approvedLabel="Ruled off"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
