/**
 * Coverage rules — the whole rule file as a `Sheet` (ADR 0112: a record
 * arriving from the right), with the act the rebuilt page was missing:
 * TAKING A RULE AWAY (founder, 2026-09-26, round 8, item 51).
 *
 * Before this, `/team` could add a rule only while the engine was idle (the
 * form under "Unfilled"), and once one existed there was no way to see the
 * rules, add another or remove one — the only route was the legacy Ops drawer
 * (`pages/team/command/OpsRulesPanel.tsx`), deleted at cutover.
 *
 * THE REMOVE IS TWO STEPS, LIKE EVERY OTHER REMOVE ON THIS PAGE. A shift and a
 * person are removed through an inline "are you sure" that says what goes
 * (`ShiftSheet.tsx`, `RosterSheet.tsx`); a rule follows the same shape and
 * says what the engine stops asking for. It is not sealed with a hold: a rule
 * is house configuration that re-adding restores exactly, not a record of
 * something that happened.
 *
 * THE ROUTES, ALL TENANT-SCOPED IN THE PATH (manager of that house):
 *   GET    /restaurants/:rid/team/coverage-templates
 *   POST   /restaurants/:rid/team/coverage-templates
 *   DELETE /restaurants/:rid/team/coverage-templates/:id   → the removed row, or 404
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getErrorMessage } from '@/services/api/client';
import { createCoverageTemplate, deleteCoverageTemplate } from '../../../services/api/team';
import { MutationError } from './tm-bits';
import { useActiveRestaurantId, type CoverageRule } from './useTeamNextData';
import { DOW_JS, periodLabel, ruleWords } from './coverage-words';

function invalidateRules(qc: ReturnType<typeof useQueryClient>, rid: string | null, weekStart: string) {
  void qc.invalidateQueries({ queryKey: ['team-next-coverage-rules', rid] });
  void qc.invalidateQueries({ queryKey: ['team-next-week', rid, weekStart] });
}

/**
 * The control that starts the staffing engine, and adds every rule after the
 * first. Before it existed, a page whose declared first object is "coverage
 * gaps" could not create the only thing that produces one.
 */
export function CoverageRuleForm({ weekStart }: { weekStart: string }) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const [form, setForm] = useState({ role: '', dayOfWeek: '', shiftPeriod: 'pm', minStaff: '1' });

  const add = useMutation({
    mutationFn: () =>
      createCoverageTemplate({
        dayOfWeek: form.dayOfWeek === '' ? undefined : Number(form.dayOfWeek),
        shiftPeriod: form.shiftPeriod,
        role: form.role.trim(),
        minStaff: Math.max(0, Number(form.minStaff) || 0),
      }),
    onSuccess: () => {
      setForm({ role: '', dayOfWeek: '', shiftPeriod: 'pm', minStaff: '1' });
      invalidateRules(qc, rid, weekStart);
    },
  });

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--paper-2)' }}>
      <div className="flex flex-wrap items-end gap-2">
        <label style={{ flex: '1 1 150px' }}>
          <span className="tm-label">Role</span>
          <input
            className="tm-input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="Floor, Bar, Host…"
          />
        </label>
        <label>
          <span className="tm-label">Day</span>
          <select
            className="tm-select"
            value={form.dayOfWeek}
            onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}
          >
            <option value="">Every day</option>
            {DOW_JS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="tm-label">Service</span>
          <select
            className="tm-select"
            value={form.shiftPeriod}
            onChange={(e) => setForm({ ...form, shiftPeriod: e.target.value })}
          >
            <option value="am">day</option>
            <option value="pm">evening</option>
          </select>
        </label>
        <label>
          <span className="tm-label">People</span>
          <input
            type="number"
            min={0}
            className="tm-input"
            style={{ width: 74 }}
            value={form.minStaff}
            onChange={(e) => setForm({ ...form, minStaff: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="tm-ctl"
          disabled={!form.role.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? 'Adding…' : 'Add coverage rule'}
        </button>
      </div>
      <MutationError when={add.isError}>
        The rule was not saved, so the rule file is unchanged. Try again.
      </MutationError>
    </div>
  );
}

function RuleRow({
  rule,
  weekStart,
  onRemoved,
}: {
  rule: CoverageRule;
  weekStart: string;
  onRemoved: (words: string) => void;
}) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const [confirming, setConfirming] = useState(false);
  const words = ruleWords(rule);

  const remove = useMutation({
    mutationFn: () => deleteCoverageTemplate(rule.id, rid ?? undefined),
    onSuccess: (gone) => {
      onRemoved(ruleWords(gone ?? rule));
      invalidateRules(qc, rid, weekStart);
    },
    // A 404 means another tab (or person) already removed it: the list is
    // stale, so it is read again and the sentence below says what happened.
    onError: () => invalidateRules(qc, rid, weekStart),
  });

  return (
    <li data-testid="rule-row">
      <div className="tm-facts" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>{words}</span>
        {!confirming && (
          <button
            type="button"
            className="tm-ctl tm-ctl--quiet tm-ctl--sm"
            aria-label={`Remove the rule ${words}`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        )}
      </div>
      {confirming && (
        <div className="tm-alert" style={{ marginTop: 6 }}>
          <p style={{ margin: 0 }}>
            Removing this rule stops the staffing engine asking for {rule.min_staff}{' '}
            {rule.role} on {rule.day_of_week == null ? 'every' : DOW_JS[rule.day_of_week]}{' '}
            {periodLabel(rule.shift_period)}
            {rule.day_of_week == null ? 's' : ''}. Any gap it raised leaves the week. Adding the
            same rule again restores it.
          </p>
          <div className="tm-actions">
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet tm-ctl--sm"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Removing…' : 'Remove the rule'}
            </button>
          </div>
        </div>
      )}
      <MutationError when={remove.isError}>
        The rule was not removed ({getErrorMessage(remove.error)}). The list has been read
        again.
      </MutationError>
    </li>
  );
}

export function CoverageRulesSheet({
  rules,
  failed,
  weekStart,
  onClose,
}: {
  /** `null` until the rule file answers. */
  rules: CoverageRule[] | null;
  failed: boolean;
  weekStart: string;
  onClose: () => void;
}) {
  const [removed, setRemoved] = useState<string | null>(null);
  const sorted = (rules ?? [])
    .slice()
    .sort(
      (a, b) =>
        (a.day_of_week ?? -1) - (b.day_of_week ?? -1) ||
        a.shift_period.localeCompare(b.shift_period) ||
        a.role.localeCompare(b.role),
    );

  return (
    <Sheet
      open
      onClose={onClose}
      label="These are the house’s coverage rules: how many people each role needs, by day and service. Adding or removing one changes this house’s rule file at once. Leaving writes nothing."
      eyebrow="Coverage rules"
      title="What the week must have"
      closeLabel="Close"
      footer={
        <span className="tm-hint">
          The staffing engine reads these to raise the gaps at the top of the page. A week
          with no rule has no gaps because nothing was asked for, not because it is staffed.
        </span>
      }
    >
      <div className="tm-in tm-form">
        {removed && (
          <p className="tm-note" role="status" data-testid="rule-removed">
            Removed: {removed}.
          </p>
        )}
        {failed ? (
          <p className="tm-alert" role="alert">
            The coverage rules could not be read, so none is listed. That is a failed read, not
            an empty file — do not add a duplicate on the strength of it.
          </p>
        ) : rules === null ? (
          <p className="tm-quiet">Reading the coverage rules…</p>
        ) : sorted.length === 0 ? (
          <p className="tm-note" data-testid="rules-empty">
            No coverage rule exists, so the staffing engine is idle. Add the first one below.
          </p>
        ) : (
          <ul className="tm-rules" aria-label="Coverage rules on file" data-testid="rule-list">
            {sorted.map((r) => (
              <RuleRow key={r.id} rule={r} weekStart={weekStart} onRemoved={setRemoved} />
            ))}
          </ul>
        )}
        {!failed && <CoverageRuleForm weekStart={weekStart} />}
      </div>
    </Sheet>
  );
}

export default CoverageRulesSheet;
