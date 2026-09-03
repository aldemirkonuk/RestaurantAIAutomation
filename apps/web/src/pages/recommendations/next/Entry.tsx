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
import {
  CUTTING_BASIS_WORDS,
  PERIOD_LABEL,
  UNIT_SUFFIX,
  cuttingFor,
  deadlineFor,
  goalOfferFor,
  landingWords,
  toStored,
  type GoalPeriod,
  type GoalPlan,
} from './rec-forward';
import type {
  DismissChoice,
  EntryVM,
  ExclusionsVM,
  GoalWrite,
  GoalsVM,
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
  /** The tenant's live goals — undefined not asked, null unreadable, [] none. */
  goals: GoalsVM;
  onWantGoals: () => void;
  onMakeGoal: (input: {
    name: string;
    metricKey: string;
    targetValue: number;
    direction: 'at_least' | 'at_most';
    period: string;
    deadline: string;
  }) => Promise<GoalWrite>;
  onSeeInReports: (href: string) => void;
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

/**
 * The goal sheet — the second of the page's two "asks before it acts" panels.
 *
 * A goal is a standing target a house is later judged against, so, like the
 * dismissal sheet, it states everything it is about to write BEFORE it writes
 * it: the metric and why that metric, the direction, the period, the deadline,
 * and the fact that the deadline can never be changed afterwards. The one
 * field it will not fill is the target — the rule states a gap, not a number a
 * house should be held to, and inventing one would be exactly the fabricated
 * figure this page exists to refuse.
 */
function GoalSheet({
  plan,
  goals,
  onCancel,
  onWrite,
}: {
  plan: GoalPlan;
  goals: GoalsVM;
  onCancel: () => void;
  onWrite: (input: {
    name: string;
    metricKey: string;
    targetValue: number;
    direction: 'at_least' | 'at_most';
    period: string;
    deadline: string;
  }) => Promise<GoalWrite>;
}) {
  const [name, setName] = useState(plan.name);
  const [typed, setTyped] = useState('');
  const [period, setPeriod] = useState<GoalPeriod>(plan.period);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deadline = useMemo(() => deadlineFor(period), [period]);
  const value = Number(typed);
  const usable = typed.trim() !== '' && Number.isFinite(value) && value > 0;

  /**
   * "You already track this figure" — the strongest true statement available.
   * `analytics_goals` records no provenance, so the page can never say "this
   * recommendation is already a goal"; it can say the house has a live target
   * on the same metric, which is what stops a duplicate.
   */
  const sameMetric = Array.isArray(goals)
    ? goals.filter((g) => g.metricKey === plan.metricKey)
    : [];

  return (
    <div className="rc-menu rc-sheet" role="group" aria-label="Make this a goal">
      <p className="rc-serif rc-sheet-title">Make this a goal</p>

      <div className="rc-sheet-block">
        <span className="rc-micro">Held on</span>
        <p className="rc-plain">
          <span className="rc-num">{plan.metricLabel}</span> ·{' '}
          {plan.direction === 'at_most' ? 'at most' : 'at least'} your target
        </p>
        <p className="rc-why">{plan.basis}</p>
      </div>

      <div className="rc-sheet-block">
        <label className="rc-field">
          <span className="rc-micro">What to call it</span>
          <input
            type="text"
            value={name}
            aria-label="Goal name"
            onChange={(ev) => setName(ev.target.value)}
          />
        </label>
      </div>

      <div className="rc-sheet-block">
        <label className="rc-field">
          <span className="rc-micro">
            The target ({UNIT_SUFFIX[plan.unit]})
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={typed}
            aria-label={`Target in ${UNIT_SUFFIX[plan.unit]}`}
            onChange={(ev) => {
              setTyped(ev.target.value);
              setRefusal(null);
            }}
          />
        </label>
        <p className="rc-why">
          The rule states a gap, not a target {EM} Mudavym will not invent the
          number your house is held to.
          {plan.unit === 'percent' && usable
            ? ` Stored as ${toStored('percent', value)}, because the engine keeps a rate as a fraction.`
            : ''}
        </p>
      </div>

      <div className="rc-sheet-block">
        <span className="rc-micro">Over</span>
        <div className="rc-scopes" role="radiogroup" aria-label="The goal's period">
          {(['week', 'month'] as GoalPeriod[]).map((p) => (
            <label key={p} className="rc-scope">
              <input
                type="radio"
                name={`period-${plan.metricKey}`}
                value={p}
                checked={period === p}
                onChange={() => setPeriod(p)}
              />
              <span>{PERIOD_LABEL[p]}</span>
            </label>
          ))}
        </div>
        <p className="rc-why">
          Due <span className="rc-num">{fmtDay(deadline)}</span>. A deadline cannot be
          changed afterwards {EM} the gateway’s only goal write after creation moves its
          status, nothing else. The period the entry suggested came from its urgency;
          “tonight” is a window for acting, not one a figure can be read over.
        </p>
      </div>

      <div className="rc-sheet-block">
        {goals === undefined ? (
          <p className="rc-why">Reading your goals…</p>
        ) : goals === null ? (
          <p className="rc-why" role="status">
            Your goals could not be read, so this may duplicate one you already have.
            The write below still works.
          </p>
        ) : sameMetric.length === 0 ? (
          <p className="rc-why">
            No live goal is held on {plan.metricLabel} today.
          </p>
        ) : (
          <p className="rc-why" data-testid="rc-goal-duplicate">
            You already hold {sameMetric.length === 1 ? 'a goal' : `${sameMetric.length} goals`} on{' '}
            {plan.metricLabel}: {sameMetric.map((g) => `“${g.name}”`).join(', ')}. Nothing
            records which recommendation a goal came from, so this is a match on the
            figure, not on this entry.
          </p>
        )}
      </div>

      {refusal && (
        <p className="rc-said" role="alert" data-testid="rc-goal-refusal">
          {refusal}
        </p>
      )}

      <div className="rc-row">
        <button
          type="button"
          className="rc-act"
          disabled={!usable || busy}
          onClick={async () => {
            if (!usable) return;
            setBusy(true);
            const res = await onWrite({
              name: name.trim() || plan.name,
              metricKey: plan.metricKey,
              targetValue: toStored(plan.unit, value),
              direction: plan.direction,
              period,
              deadline,
            });
            setBusy(false);
            if (!res.ok) setRefusal(res.message);
          }}
        >
          {busy ? 'Setting it…' : 'Set the goal'}
        </button>
        <Quiet onClick={onCancel}>Not now</Quiet>
        {!usable && (
          <span className="rc-said">
            Type a target above {EM} the gateway refuses anything at or below zero.
          </span>
        )}
      </div>
    </div>
  );
}

export default function Entry(props: EntryProps) {
  const { entry: e, leaf, focused, selected, expanded, team } = props;
  const [menu, setMenu] = useState<'dismiss' | 'snooze' | 'assign' | 'goal' | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  /* ── the two forward doors, resolved from the rule alone ──────────────── */
  const forward = { ruleKey: e.ruleKey, category: e.category, urgency: e.urgency, subject: e.subject };
  const goalOffer = useMemo(() => goalOfferFor(forward), [e.ruleKey, e.urgency, e.subject]); // eslint-disable-line react-hooks/exhaustive-deps
  const cutting = useMemo(() => cuttingFor(forward), [e.ruleKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/*
          ── controls, classified by what they DO ─────────────────────────
          The founder, fourth pass: "we need everything in a categorized
          classified section in order for people to understand what to do as
          action". The register above classifies the ENTRIES; this classifies
          the CONTROLS, which is the other half of the same request. Two rows,
          each labelled: what carries the work forward, and what files the
          entry. A dismissal and a deep link were previously the same shape of
          button sitting side by side.
        */}
        {live ? (
          <>
            <div className="rc-controls rc-controls-do">
              <span className="rc-micro rc-ctl-label">Carry it out</span>
              <button type="button" className="rc-act" onClick={props.onAct}>
                {e.hand.label} →
              </button>
              {goalOffer.kind === 'plan' ? (
                <Quiet
                  onClick={() => {
                    props.onWantGoals();
                    setMenu(menu === 'goal' ? null : 'goal');
                  }}
                  pressed={menu === 'goal'}
                >
                  Make this a goal
                </Quiet>
              ) : (
                <button
                  type="button"
                  className="rc-dark rc-dark-inline"
                  disabled
                  title={goalOffer.why}
                  data-testid="rc-goal-dark"
                >
                  Make this a goal
                </button>
              )}
              {cutting.kind === 'cutting' ? (
                <Quiet onClick={() => props.onSeeInReports(cutting.link.href)}>
                  See it in reports
                </Quiet>
              ) : (
                <button
                  type="button"
                  className="rc-dark rc-dark-inline"
                  disabled
                  title={cutting.why}
                  data-testid="rc-cutting-dark"
                >
                  See it in reports
                </button>
              )}
            </div>
            <div className="rc-controls rc-controls-file">
              <span className="rc-micro rc-ctl-label">File it</span>
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
            </div>
          </>
        ) : (
          <div className="rc-controls">
            <Quiet onClick={props.onToggleExpand}>
              {expanded ? 'Hide the working' : 'The working'}
            </Quiet>
            <Quiet onClick={props.onRestore}>Return it to the book</Quiet>
          </div>
        )}

        {/* the two forward doors, said in words under the controls */}
        {live && (
          <p className="rc-said rc-forward-note">
            {goalOffer.kind === 'plan'
              ? `A goal from this entry is held on ${goalOffer.plan.metricLabel}, ${
                  goalOffer.plan.direction === 'at_most' ? 'at most' : 'at least'
                }.`
              : goalOffer.why}{' '}
            {cutting.kind === 'cutting'
              ? `Reports draws it as “${cutting.link.title}” — ${
                  CUTTING_BASIS_WORDS[cutting.link.basis]
                }. ${landingWords(cutting.link)}`
              : cutting.why}
          </p>
        )}

        {menu === 'goal' && goalOffer.kind === 'plan' && (
          <GoalSheet
            plan={goalOffer.plan}
            goals={props.goals}
            onCancel={() => setMenu(null)}
            onWrite={async (input) => {
              const res = await props.onMakeGoal(input);
              if (res.ok) setMenu(null);
              return res;
            }}
          />
        )}

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
