/**
 * The goals desk — the one cutting on this sheet that writes.
 *
 *   "the Goals section that owners/managers decide, and it can be edited (will
 *    be using AI to create the analytics and their wanted feature if not
 *    already created), and then they will have access to edit change as they
 *    like. Will be available to visible."
 *                                        — the founder, /reports, 2026-09-03
 *
 * Four things, in the order the founder named them:
 *
 *  1. **Owners and managers decide.** A goal is a measure the gateway already
 *     computes (`GoalsService.SUPPORTED_METRICS`), a target and a deadline. The
 *     measure list comes from the server, so this page cannot offer a goal the
 *     engine cannot score.
 *  2. **It can be edited.** `PATCH /analytics/goals/:rid/:goalId`, built this
 *     pass. Everything but the measure: a goal's baseline was taken against its
 *     measure when it was set, and swapping the measure underneath would leave
 *     "where we started" reading a different quantity. The form says so.
 *  3. **AI creates the analytics if not already created** — read exactly, and
 *     built as the only version of it that does not fabricate: "Ask the book"
 *     sends the goal to `POST …/cutting-spec`, where a model picks WHICH of the
 *     analyses this page already computes answers it, how to draw it and over
 *     what window. The gateway validates all three against a closed catalogue
 *     and this page validates them again. The model never writes a number, a
 *     sentence on a chart, or a new analysis — the engine remains the only
 *     thing that measures anything (ADR 0020/0051).
 *  4. **Available to visible.** `goals` is on the default sheet, and a stored
 *     sheet written before it existed gains it (`IDS_ADDED_IN_V3`).
 *
 * Progress comes from `GET /analytics/goals/:rid/progress`, which recomputes
 * each goal rather than reading the stored `current_value` column — that column
 * is only refreshed when someone opens one goal, so a bar drawn off the list
 * would read "nothing done yet" for a goal that is half met.
 */

import { useState } from 'react';
import { BookOpen, Pencil, Plus, Sparkles, Target, X } from 'lucide-react';
import { EM, countOf, figure, num, ratioPct } from './rp-format';
import { analysis, arr, obj, str } from './rp-spec';
import type { GoalScenario, GoalScenarios } from '@/hooks/useGoalScenarios';
import type { GoalsDesk } from './useGoalsDesk';
import type { ViewCtx } from './rp-spec';

/* ─────────────────────────────────────────────────────── the payload ───── */

export interface GoalRow {
  id: string;
  name: string;
  metricKey: string;
  metricLabel: string;
  unit: string;
  direction: string;
  deadline: string | null;
  period: string;
  /** null = the goal could not be read; never 0 standing in for it. */
  current: number | null;
  target: number | null;
  progressPct: number | null;
  expectedByNow: number | null;
  onTrack: boolean | null;
  daysLeft: number | null;
  projected: number | null;
  projectionHitsTarget: boolean | null;
  baseline: number | null;
  unreadable: string | null;
}

export interface GoalsRegister {
  goals: GoalRow[];
  total: number;
  truncated: boolean;
  metrics: Array<{ key: string; label: string; unit: string }>;
  basis: Array<string | null | undefined>;
}

/** A figure in its own unit — a percent is not a count is not money. */
function inUnit(v: number | null, unit: string): string {
  if (v === null) return EM;
  if (unit === 'percent') return ratioPct(v);
  if (unit === 'currency') return figure(v, 'compact');
  return figure(v, 'compact');
}

/* ──────────────────────────────────────────────────────────── the desk ── */

const PERIODS = ['day', 'week', 'month', 'quarter', 'custom'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="rp-field">
      <span className="rp-eyebrow">{label}</span>
      {children}
    </label>
  );
}

/**
 * What the picker says about one scenario, once it is chosen.
 *
 * Three sentences, in a fixed order, and never fewer: what operators publish
 * (or why nothing is published), what that number is a fact ABOUT, and the
 * standing caveat. The range is printed as WORDS — the source's own sentence —
 * and never parsed into a number, because the moment a figure from a report
 * reaches a numeric field it is indistinguishable from a target this house set.
 */
function ScenarioReading({ scenario, caveat }: { scenario: GoalScenario; caveat: string }) {
  return (
    <div className="rp-scenario-note" data-testid="rp-scenario-note">
      <p className="rp-cap">{scenario.question}</p>
      {scenario.range.kind === 'published' ? (
        <p className="rp-cap">
          What operators publish: {scenario.range.words}{' '}
          <a
            className="rp-focus"
            href={scenario.range.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {scenario.range.source}
          </a>
          , {scenario.range.published}. {scenario.range.caveat}
        </p>
      ) : (
        <p className="rp-cap">No operator source publishes a range for this. {scenario.range.why}</p>
      )}
      <p className="rp-cap">{caveat}</p>
      {scenario.metricKey === null && scenario.needsMetric && (
        <p className="rp-cap" role="status">
          This house cannot hold a goal on it yet. It would need: {scenario.needsMetric}
        </p>
      )}
    </div>
  );
}

/**
 * "Start from a scenario" — the book, above the measure list.
 *
 *   *"we're going to create possible analytic scenarios a restaurant might set
 *    as a goal"*                                — the founder, 2026-09-04
 *
 * It fills the name, the measure, the direction and the period. It does NOT
 * fill the target, and that is the whole discipline of the panel: the book
 * knows what operators measure, and it does not know what this room should
 * take. The one field left blank is the one the manager must decide.
 *
 * Scenarios the gateway cannot hold are LISTED and disabled rather than hidden.
 * A picker showing only the nine servable ones would say this product covers
 * the field; it covers about half of it, and the missing half is the more
 * useful thing to know.
 */
function ScenarioPicker({
  scenarios,
  chosenId,
  onChoose,
}: {
  scenarios: GoalScenarios;
  chosenId: string;
  onChoose: (scenario: GoalScenario | null) => void;
}) {
  if (scenarios.failure) {
    return (
      <div className="rp-scenario">
        <p className="rp-cap" role="status">
          {scenarios.failure}
        </p>
      </div>
    );
  }
  if (scenarios.loading || !scenarios.book) {
    return (
      <div className="rp-scenario">
        <p className="rp-cap">Reading the book of scenarios{EM}</p>
      </div>
    );
  }

  const book = scenarios.book;
  const held = book.scenarios.filter((s) => s.servable);
  const unheld = book.scenarios.filter((s) => !s.servable);
  const chosen = book.scenarios.find((s) => s.id === chosenId) ?? null;

  return (
    /* One full-width block. The form is an auto-fit grid, so a bare fragment
       would drop the label in one column and its reading in the next — the
       picker has to own the whole row for the two to read as one thing. */
    <div className="rp-scenario">
      <label className="rp-field">
        <span className="rp-eyebrow">Start from a scenario</span>
        <select
          className="rp-select rp-focus"
          value={chosenId}
          aria-label="Start from a scenario"
          onChange={(e) =>
            onChoose(book.scenarios.find((s) => s.id === e.target.value) ?? null)
          }
        >
          <option value="">Choose the measure yourself</option>
          <optgroup label="Held on the figures this engine scores">
            {held.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Not held yet — the measure does not exist">
            {unheld.map((s) => (
              <option key={s.id} value={s.id} disabled>
                {s.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {chosen ? (
        <ScenarioReading scenario={chosen} caveat={book.caveat} />
      ) : (
        <p className="rp-cap">
          <BookOpen size={12} strokeWidth={1.6} aria-hidden />{' '}
          {countOf(book.counts.servable, 'scenario', 'scenarios')} can be held on the figures
          this engine already scores; {book.counts.needsAMetric} more are listed and greyed,
          each naming the measure it would take. None of them carries a target.
        </p>
      )}
    </div>
  );
}

function GoalForm({
  metrics,
  scenarios,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  metrics: GoalsRegister['metrics'];
  scenarios: GoalScenarios;
  initial: Partial<GoalRow> | null;
  submitLabel: string;
  busy: boolean;
  onSubmit: (v: {
    name: string;
    metricKey: string;
    targetValue: number;
    deadline: string | null;
    direction: 'at_least' | 'at_most';
    period: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [metricKey, setMetricKey] = useState(initial?.metricKey ?? metrics[0]?.key ?? '');
  const [target, setTarget] = useState(initial?.target != null ? String(initial.target) : '');
  const [deadline, setDeadline] = useState(initial?.deadline ?? '');
  const [direction, setDirection] = useState<'at_least' | 'at_most'>(
    initial?.direction === 'at_most' ? 'at_most' : 'at_least',
  );
  const [period, setPeriod] = useState(initial?.period ?? 'month');
  const [scenarioId, setScenarioId] = useState('');
  const editing = !!initial?.id;

  const targetValue = num(target);
  const ready = name.trim() !== '' && targetValue !== null && targetValue > 0 && metricKey !== '';

  /**
   * Choosing a scenario fills four fields and deliberately leaves the fifth.
   *
   * The name is overwritten rather than merged: the manager can retype it, and
   * a half-replaced sentence ("Lift wine revenue before the holidaysHold
   * purchasing spend") is worse than either version. The TARGET is never
   * touched — not cleared, not filled — because the number the house is held to
   * is the one thing the book has no business writing.
   */
  const chooseScenario = (s: GoalScenario | null) => {
    setScenarioId(s?.id ?? '');
    if (!s || s.metricKey === null) return;
    setName(s.name);
    setMetricKey(s.metricKey);
    setDirection(s.direction);
    setPeriod(s.period);
  };

  return (
    <form
      className="rp-goalform rp-no-drag"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || targetValue === null) return;
        onSubmit({
          name: name.trim(),
          metricKey,
          targetValue,
          deadline: deadline === '' ? null : deadline,
          direction,
          period,
        });
      }}
    >
      {/* The book sits ABOVE the measure list, because it is how a manager who
          does not already know the six metric keys finds the right one. While
          editing it is absent: a scenario fills the measure, and the measure is
          the one field an existing goal cannot change. */}
      {!editing && (
        <ScenarioPicker
          scenarios={scenarios}
          chosenId={scenarioId}
          onChoose={chooseScenario}
        />
      )}
      <Field label="What are we after">
        <input
          className="rp-input rp-focus"
          value={name}
          maxLength={160}
          placeholder="Lift wine revenue before the holidays"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Measure">
        <select
          className="rp-select rp-focus"
          value={metricKey}
          disabled={editing}
          onChange={(e) => setMetricKey(e.target.value)}
        >
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Direction">
        <select
          className="rp-select rp-focus"
          value={direction}
          onChange={(e) => setDirection(e.target.value === 'at_most' ? 'at_most' : 'at_least')}
        >
          <option value="at_least">Reach at least</option>
          <option value="at_most">Keep at most</option>
        </select>
      </Field>
      <Field label="Target">
        <input
          className="rp-input rp-focus"
          value={target}
          inputMode="decimal"
          placeholder="9000"
          onChange={(e) => setTarget(e.target.value)}
        />
      </Field>
      <Field label="By">
        <input
          className="rp-input rp-focus"
          type="date"
          value={deadline ?? ''}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </Field>
      <Field label="Counted over">
        <select
          className="rp-select rp-focus"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <div className="rp-row" style={{ gap: 6 }}>
        <button type="submit" className="rp-mini rp-ink rp-focus" data-strong="true" disabled={!ready || busy}>
          {busy ? 'Writing…' : submitLabel}
        </button>
        <button type="button" className="rp-mini rp-ink rp-focus" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {editing && (
        <p className="rp-cap">
          The measure cannot change: this goal’s baseline was taken against it when it was set, and
          every figure above is counted from that baseline. Archive it and set a new one instead.
        </p>
      )}
      {!ready && (
        <p className="rp-cap">A goal needs a name and a target above zero before it can be set.</p>
      )}
    </form>
  );
}

function ProposalCard({ desk }: { desk: GoalsDesk }) {
  const p = desk.proposal;
  if (!p) return null;
  return (
    <div className="rp-proposal rp-no-drag" role="status">
      <p className="rp-eyebrow">
        <Sparkles size={12} strokeWidth={1.6} aria-hidden /> The book, on “{p.goalName}”
      </p>
      {p.cutting ? (
        <>
          {/* The assistant's own words, labelled as the assistant's. They are
              never printed as a chart caption, an axis or a figure. */}
          {p.why && <p className="rp-cap">“{p.why}” — the assistant’s words, not a measurement.</p>}
          <div className="rp-row" style={{ gap: 6 }}>
            <button
              type="button"
              className="rp-mini rp-ink rp-focus"
              data-strong="true"
              onClick={() => {
                desk.place(p.cutting!);
                desk.dismiss();
              }}
            >
              Put it on the sheet
            </button>
            <button type="button" className="rp-mini rp-ink rp-focus" onClick={desk.dismiss}>
              No thanks
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="rp-cap">{p.refusal}</p>
          <button type="button" className="rp-mini rp-ink rp-focus" onClick={desk.dismiss}>
            Close
          </button>
        </>
      )}
    </div>
  );
}

function Desk({ reg, desk }: { reg: GoalsRegister; desk: GoalsDesk }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="rp-goals">
      {desk.error && (
        <p className="rp-cap rp-goals__error" role="status">
          {desk.error}{' '}
          <button type="button" className="rp-mini rp-ink rp-focus" onClick={desk.clearError}>
            Dismiss
          </button>
        </p>
      )}
      {desk.readOnlyReason && (
        <p className="rp-cap" role="status">
          {desk.readOnlyReason}
        </p>
      )}

      {reg.goals.length === 0 && !adding && (
        <p className="rp-note">
          No goal is running. A goal is a measure the engine already scores, a target and a date —
          set one and every figure below is counted from the day you set it.
        </p>
      )}

      <ul className="rp-goals__list">
        {reg.goals.map((g) => (
          <li key={g.id} className="rp-goal">
            {editing === g.id ? (
              <GoalForm
                metrics={reg.metrics}
                scenarios={desk.scenarios}
                initial={g}
                submitLabel="Save the change"
                busy={desk.busy === g.id}
                onCancel={() => setEditing(null)}
                onSubmit={(v) => {
                  desk.update(g.id, {
                    name: v.name,
                    targetValue: v.targetValue,
                    deadline: v.deadline,
                    direction: v.direction,
                    period: v.period,
                  });
                  setEditing(null);
                }}
              />
            ) : (
              <>
                <div className="rp-goal__head">
                  <h3 className="rp-goal__name">{g.name}</h3>
                  {desk.canWrite && (
                    <div className="rp-row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="rp-mini rp-ink rp-focus rp-no-drag"
                        aria-label={`Ask the book which analysis shows ${g.name}`}
                        disabled={desk.asking === g.id}
                        onClick={() => desk.ask(g.id, g.name)}
                      >
                        <Sparkles size={12} strokeWidth={1.6} aria-hidden />
                        {desk.asking === g.id ? 'Asking…' : 'Ask the book'}
                      </button>
                      <button
                        type="button"
                        className="rp-mini rp-ink rp-focus rp-no-drag"
                        aria-label={`Edit ${g.name}`}
                        onClick={() => setEditing(g.id)}
                      >
                        <Pencil size={12} strokeWidth={1.6} aria-hidden />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rp-mini rp-ink rp-focus rp-no-drag"
                        aria-label={`Archive ${g.name}`}
                        disabled={desk.busy === g.id}
                        onClick={() => desk.archive(g.id)}
                      >
                        <X size={12} strokeWidth={1.6} aria-hidden />
                        Archive
                      </button>
                    </div>
                  )}
                </div>

                {g.unreadable ? (
                  <p className="rp-cap" role="status">
                    This goal could not be scored ({g.unreadable}). Nothing below it is claimed.
                  </p>
                ) : (
                  <>
                    <p className="rp-goal__line">
                      <span className="rp-mono">{inUnit(g.current, g.unit)}</span> of{' '}
                      <span className="rp-mono">{inUnit(g.target, g.unit)}</span> ·{' '}
                      {g.metricLabel} · {g.direction === 'at_most' ? 'keep at most' : 'reach at least'}
                      {g.deadline ? ` · by ${g.deadline}` : ' · no deadline'}
                    </p>
                    {/* The bar is the SERVER's progressPct. An unknown one draws
                        no bar at all rather than an empty track that reads
                        "nothing has happened". */}
                    {g.progressPct === null ? (
                      <p className="rp-cap">
                        Progress is unknown — the engine returned no figure for this measure, and an
                        empty bar would claim it returned zero.
                      </p>
                    ) : (
                      <div
                        className="rp-bar"
                        role="img"
                        aria-label={`${ratioPct(Math.min(1, g.progressPct))} of the target`}
                      >
                        <span style={{ width: `${Math.min(100, Math.max(0, g.progressPct * 100))}%` }} />
                      </div>
                    )}
                    <p className="rp-cap">
                      {g.onTrack === null
                        ? 'No deadline, so there is no schedule to be ahead or behind of.'
                        : g.onTrack
                          ? `On the pace this goal needs${g.daysLeft !== null ? `, ${countOf(g.daysLeft, 'day', 'days')} left` : ''}.`
                          : `Behind the pace this goal needs${g.daysLeft !== null ? `, ${countOf(g.daysLeft, 'day', 'days')} left` : ''}.`}
                      {g.projected !== null &&
                        ` The trend projects ${inUnit(g.projected, g.unit)} by the deadline${
                          g.projectionHitsTarget === null
                            ? ''
                            : g.projectionHitsTarget
                              ? ' — enough.'
                              : ' — short.'
                        }`}
                      {g.projected === null && g.deadline
                        ? ' There is not enough history to project the deadline, so none is drawn.'
                        : ''}
                    </p>
                  </>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <ProposalCard desk={desk} />

      {desk.canWrite &&
        (adding ? (
          <GoalForm
            metrics={reg.metrics}
            scenarios={desk.scenarios}
            initial={null}
            submitLabel="Set the goal"
            busy={desk.busy === 'new'}
            onCancel={() => setAdding(false)}
            onSubmit={(v) => {
              desk.create(v);
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="rp-mini rp-ink rp-focus rp-no-drag"
            onClick={() => setAdding(true)}
          >
            <Plus size={12} strokeWidth={1.6} aria-hidden />
            Set a goal
          </button>
        ))}

      {reg.truncated && (
        <p className="rp-cap">
          {countOf(reg.total, 'goal is', 'goals are')} running; the first {reg.goals.length} are
          scored here. Scoring every one is several queries each, so the rest are not read rather
          than read badly.
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────── the catalogue ── */

export const goals = analysis<GoalsRegister>({
  title: 'Goals',
  register: 'goals register',
  answers: 'What this house said it would do, and how far along it is',
  window: () => 'each goal counted from the day it was set',
  path: (rid) => `/analytics/goals/${rid}/progress`,
  graphs: ['table', 'bars', 'figure'],
  graphNote:
    'The desk — where a goal is set, edited and archived — lives on the Table drawing, because it is a list of records with controls, not a picture. Bars draw the one thing every goal shares: how much of its own target it has reached. No line, area, scatter or heat map: goals are not a sequence and share no axis.',
  select: (raw) => {
    const d = obj(raw);
    const rows = arr(d.goals).map((entry): GoalRow => {
      const g = obj(entry.goal);
      const unreadable = entry.unreadable === true ? str(entry.reason) || 'reason not given' : null;
      return {
        id: str(g.id),
        name: str(g.name) || 'Untitled goal',
        metricKey: str(g.metric_key),
        metricLabel: str(entry.metricLabel) || str(g.metric_key),
        unit: str(entry.unit) || 'count',
        direction: str(g.direction) || 'at_least',
        deadline: g.deadline == null ? null : str(g.deadline),
        period: str(g.period) || 'custom',
        current: num(entry.current),
        target: num(entry.target),
        progressPct: num(entry.progressPct),
        expectedByNow: num(entry.expectedByNow),
        onTrack: typeof entry.onTrack === 'boolean' ? entry.onTrack : null,
        daysLeft: num(entry.daysLeft),
        projected: num(entry.projectedAtDeadline),
        projectionHitsTarget:
          typeof entry.projectionHitsTarget === 'boolean' ? entry.projectionHitsTarget : null,
        baseline: num(g.baseline_value),
        unreadable,
      };
    });
    const basis = obj(d.basis);
    return {
      goals: rows,
      total: num(d.total) ?? rows.length,
      truncated: d.truncated === true,
      metrics: arr(d.supportedMetrics).map((m) => ({
        key: str(m.key),
        label: str(m.label) || str(m.key),
        unit: str(m.unit) || 'count',
      })),
      basis: [basis.current, basis.peers] as Array<string | null | undefined>,
    };
  },
  view: (reg, ctx: ViewCtx) => {
    const scored = reg.goals.filter((g) => !g.unreadable && g.progressPct !== null);
    const onTrack = reg.goals.filter((g) => g.onTrack === true).length;
    const behind = reg.goals.filter((g) => g.onTrack === false).length;

    const figures = [
      { label: 'Goals running', value: figure(reg.total) },
      {
        label: 'On pace',
        value: reg.goals.some((g) => g.onTrack !== null) ? figure(onTrack) : EM,
        note: reg.goals.some((g) => g.onTrack !== null)
          ? undefined
          : 'no goal carries a deadline, so none has a pace',
      },
      {
        label: 'Behind',
        value: reg.goals.some((g) => g.onTrack !== null) ? figure(behind) : EM,
      },
      {
        label: 'Could not be scored',
        value: figure(reg.goals.filter((g) => g.unreadable).length),
      },
    ];

    return {
      // The desk replaces the table rendering: these are records with controls,
      // and a grid of cells cannot carry a form.
      node: ctx.goals ? <Desk reg={reg} desk={ctx.goals} /> : undefined,
      cats:
        scored.length > 0
          ? {
              data: scored.map((g) => ({
                label: g.name.length > 16 ? `${g.name.slice(0, 15)}…` : g.name,
                value: Math.round((g.progressPct as number) * 1000) / 10,
                full: g.name,
              })),
              xLabel: 'goal',
              yLabel: '% of target',
              unit: 'per cent of its own target',
              format: (v: number) => `${v.toFixed(1)}%`,
            }
          : undefined,
      table: {
        cols: [
          { key: 'goal', label: 'Goal' },
          { key: 'now', label: 'Now', numeric: true },
          { key: 'target', label: 'Target', numeric: true },
          { key: 'by', label: 'By' },
        ],
        rows: reg.goals.map((g) => ({
          key: g.id,
          cells: [
            g.name,
            g.unreadable ? EM : inUnit(g.current, g.unit),
            inUnit(g.target, g.unit),
            g.deadline ?? EM,
          ],
        })),
      },
      figures,
      notes: [
        ctx.goals
          ? null
          : 'The desk is not wired on this rendering, so this cutting is read-only here.',
        'Every figure is this house against its own baseline. No other restaurant’s books are in it.',
      ].filter((n): n is string => n !== null),
      basis: reg.basis,
    };
  },
});

/** The icon the desk answers to, exported so the page can label its section. */
export const GoalsIcon = Target;
