/**
 * Register 06 — Approval thresholds.
 *
 * The founder's line for the sketch: *"The hold-to-approve ceremony exists and
 * has no policy behind it — this is the policy."* Measured, that is exactly
 * right: `ProcurementService.approveOrder`
 * (`apps/api-gateway/src/procurement/procurement.service.ts:1438-1460`) writes
 * `status`, `approved_at` and `approved_by` without reading a role or an
 * amount, and `POST /procurement/orders/:id/approve`
 * (`procurement.controller.ts:283`) carries `JwtAuthGuard` and nothing else. So
 * anyone who can reach the endpoint can seal any amount, and `/orders`'
 * `HoldToApprove` (`pages/orders/next/LedgerRow.tsx:227`) renders for every
 * pending row.
 *
 * THE HONESTY PROBLEM THIS REGISTER HAD TO SOLVE. A settings page that let a
 * manager set a ceiling, and did not say that nothing reads it, would be worse
 * than the blank page it replaces: it would be
 * [[absence-reported-as-health]] pointed at money — an owner believing a
 * control is holding while every order goes through untouched. So the banner at
 * the top of this register is not a caveat, it is the register's first
 * sentence, it names the exact file and line where enforcement has to land, and
 * it is rendered from `enforcement.enforcedBy` being EMPTY rather than from a
 * hard-coded string — the day something reads these rows, that array is what
 * changes.
 *
 * WHAT MAKES IT WORTH SETTING ANYWAY. Every threshold shows how often it WOULD
 * have fired over this restaurant's own orders in the last year. A ceiling of
 * 15,000 means something completely different in a house that places four
 * orders a month and one that places four hundred, and no other surface in the
 * product would ever tell them which they are.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Action, Choice, Note, Register, Row, SaveFailure, Toggle, fieldStyle } from './SectionKit';
import { EM, MONO, SANS, SERIF } from './st-format';
import type {
  ApprovalRule,
  SettingsNextData,
  ThresholdRow,
  ThresholdsRegister,
} from './useSettingsNextData';

/**
 * The three rules, in the order they are read.
 *
 * A descriptor list, not a table of rows: it names and explains the closed set
 * the database's own CHECK constraint already enforces
 * (`restaurant_approval_thresholds_rule_check`), and asserts nothing about any
 * house. The numbers all come from the server.
 */
const RULES: Array<{
  id: ApprovalRule;
  label: string;
  description: string;
  hint: string;
  kind: 'amount' | 'always' | 'percent';
}> = [
  {
    id: 'manager_ceiling',
    label: 'A manager may seal an order up to',
    description:
      'Above this, the order waits for an owner. The manager still writes it and still sees the price — a threshold that hid the number would only teach people to split an order in two.',
    hint: 'The amount, in this house’s own currency.',
    kind: 'amount',
  },
  {
    id: 'new_vendor',
    label: 'The first order to a vendor',
    description:
      'At any amount. The house has no price history to judge a first order against, which is the same reason the reply engine holds a draft from a sender it has never seen.',
    hint: 'Fires on the first order this restaurant has placed with that vendor.',
    kind: 'always',
  },
  {
    id: 'price_jump',
    label: 'A price above what the house last paid',
    description:
      'Compared against the last price paid for the same item. A quiet ten percent every quarter is the increase nobody argues with and everybody pays.',
    hint: 'How far above, in percent.',
    kind: 'percent',
  },
];

function findRow(reg: ThresholdsRegister, rule: ApprovalRule): ThresholdRow | undefined {
  return reg.thresholds.find((t) => t.rule === rule);
}

function Retrospective({ reg, rule }: { reg: ThresholdsRegister; rule: ApprovalRule }) {
  if (!reg.retrospective.readable) {
    return (
      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
        {EM} the order ledger could not be read, so this cannot say how often the
        rule would have fired — {reg.retrospective.reason}.
      </p>
    );
  }
  const count = reg.retrospective.counts.find((c) => c.rule === rule);
  if (!count || count.tested === 0) {
    return (
      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
        {EM} no order in the last {reg.retrospective.windowDays} days could be tested
        against this rule, so there is nothing to count.
      </p>
    );
  }
  return (
    <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-2)', margin: '5px 0 0' }}>
      <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--seal-deep)', fontWeight: 600 }}>
        {count.wouldHaveFired} of {count.tested}
      </span>{' '}
      orders in the last {reg.retrospective.windowDays} days would have waited for a
      second signature under this rule.
    </p>
  );
}

function RuleEditor({
  spec,
  row,
  busy,
  canManage,
  onSave,
}: {
  spec: (typeof RULES)[number];
  row: ThresholdRow | undefined;
  busy: boolean;
  /**
   * Owner or manager at this restaurant (ADR 0116). The server refuses either
   * way — `SettingsController.setApprovalThreshold` calls
   * `assertCanManageRestaurant` — so this is a courtesy, not the rule, and it
   * is written that way: the controls are DISABLED with the reason beside
   * them, never removed. A control that disappears leaves a person unable to
   * tell a missing feature from a permission they do not have.
   */
  canManage: boolean;
  onSave: (next: { enabled: boolean; amountLimit: number | null; percentLimit: number | null; requiredRole: 'owner' | 'manager' }) => void;
}) {
  const [amount, setAmount] = useState(
    row?.amountLimit === null || row?.amountLimit === undefined ? '' : String(row.amountLimit),
  );
  const [percent, setPercent] = useState(
    row?.percentLimit === null || row?.percentLimit === undefined ? '' : String(row.percentLimit),
  );
  const [role, setRole] = useState<'owner' | 'manager'>(row?.requiredRole ?? 'owner');

  const needsNumber = spec.kind === 'amount' || spec.kind === 'percent';
  const numberText = spec.kind === 'amount' ? amount : percent;
  const numberMissing = needsNumber && numberText.trim() === '';

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
      {needsNumber && (
        <label style={{ display: 'block' }}>
          <span
            style={{
              display: 'block', fontFamily: MONO, fontSize: 9, fontWeight: 600,
              letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 3,
            }}
          >
            {spec.hint}
          </span>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            value={numberText}
            onChange={(e) =>
              spec.kind === 'amount' ? setAmount(e.target.value) : setPercent(e.target.value)
            }
            disabled={!canManage}
            style={{ ...fieldStyle, width: 130, opacity: canManage ? 1 : 0.5 }}
          />
        </label>
      )}
      <Choice<'owner' | 'manager'>
        value={role}
        onChange={setRole}
        disabled={!canManage}
        label="Who has to sign"
        options={[
          { value: 'owner', label: 'An owner' },
          { value: 'manager', label: 'A manager' },
        ]}
      />
      <Action
        disabled={busy || numberMissing || !canManage}
        onClick={() =>
          onSave({
            enabled: row?.enabled ?? true,
            amountLimit: spec.kind === 'amount' && amount.trim() !== '' ? Number(amount) : null,
            percentLimit: spec.kind === 'percent' && percent.trim() !== '' ? Number(percent) : null,
            requiredRole: role,
          })
        }
      >
        {busy ? 'Recording…' : row ? 'Change it' : 'Set it'}
      </Action>
      {numberMissing && canManage && (
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
          A rule with no number cannot fire, so it cannot be set.
        </span>
      )}
      {!canManage && (
        <span style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', maxWidth: 340 }} role="status">
          Only an owner or a manager of this restaurant may set a threshold. The
          rule and the number are shown because a limit you cannot see is one you
          cannot plan around.
        </span>
      )}
    </div>
  );
}

export function ThresholdsSection({ data }: { data: SettingsNextData }) {
  return (
    <Register<ThresholdsRegister> remote={data.thresholds} name="the approval thresholds">
      {(reg) => (
        <div>
          {/* The register's first sentence, rendered from the measurement. */}
          <p
            role="status"
            style={{
              display: 'flex', gap: 9, alignItems: 'flex-start',
              fontFamily: SANS, fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-1)',
              background: 'var(--seal-tint)', border: '1px solid var(--seal-ring)',
              borderRadius: 10, padding: '10px 12px', margin: '0 0 14px', maxWidth: 760,
            }}
          >
            <AlertTriangle size={15} aria-hidden style={{ color: 'var(--seal-deep)', flexShrink: 0, marginTop: 1 }} />
            <span>
              {reg.enforcement.enforcedBy.length === 0 ? (
                <>
                  <strong>Nothing stops an order yet.</strong> These rules are
                  recorded and read back, and no code consults them before an
                  order is sealed: {reg.enforcement.note} Enforcement has to be
                  added at <code style={{ fontFamily: MONO, fontSize: 11.5 }}>{reg.enforcement.wouldBeEnforcedAt}</code>.
                  Until then this register is the house&rsquo;s written policy,
                  not a gate, and it is shown as one.
                </>
              ) : (
                <>
                  <strong>Enforced.</strong> {reg.enforcement.enforcedBy.length} code
                  path{reg.enforcement.enforcedBy.length === 1 ? '' : 's'} consult
                  these rules before an order can be sealed:{' '}
                  {reg.enforcement.enforcedBy.join(', ')}.
                </>
              )}
            </span>
          </p>

          {!reg.readable && (
            <p
              role="alert"
              style={{
                fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-1)',
                background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '0 0 12px',
              }}
            >
              The policy could not be read — {reg.reason}. This is not a house
              with no policy; it is a register we could not open.
            </p>
          )}

          {reg.readable && reg.policyEmpty && (
            <Note role="status">
              This house has set no rule at all. That is different from having
              chosen &ldquo;anyone, any amount&rdquo; — nobody has decided yet,
              and nothing below is filled in with a number somebody would then
              have to notice was never theirs.
            </Note>
          )}

          {RULES.map((spec) => {
            const row = findRow(reg, spec.id);
            return (
              <Row
                key={spec.id}
                label={spec.label}
                consequence={spec.description}
                provenance={
                  row
                    ? {
                        kept: 'restaurant',
                        when: row.updatedAt,
                        whenUnknown: 'the rule carries no date, which should be impossible',
                        verb: row.setBy?.name ? `set by ${row.setBy.name}` : 'set',
                      }
                    : undefined
                }
                control={
                  row ? (
                    <Toggle
                      checked={row.enabled}
                      label={`${spec.label} — in force`}
                      disabled={!data.canManage}
                      busy={data.writer.busy === `threshold:${spec.id}`}
                      onChange={(next) =>
                        void data.saveThreshold(spec.id, {
                          enabled: next,
                          amountLimit: row.amountLimit,
                          percentLimit: row.percentLimit,
                          requiredRole: row.requiredRole,
                        })
                      }
                    />
                  ) : undefined
                }
              >
                <p style={{ fontFamily: MONO, fontSize: 13, color: 'var(--ink-1)', margin: '6px 0 0', fontVariantNumeric: 'tabular-nums' }}>
                  {row
                    ? row.enabled
                      ? describe(spec.kind, row)
                      : `${describe(spec.kind, row)} — switched off, and the number is kept`
                    : `${EM} not set`}
                </p>
                <Retrospective reg={reg} rule={spec.id} />
                <RuleEditor
                  spec={spec}
                  row={row}
                  busy={data.writer.busy === `threshold:${spec.id}`}
                  canManage={data.canManage}
                  onSave={(next) => void data.saveThreshold(spec.id, next)}
                />
              </Row>
            );
          })}

          <Row
            label="A per-vendor override"
            consequence="Would let one trusted vendor sit above the house ceiling, or one troublesome vendor below it. Ottimate calls this a vendor-based policy and lists it beside amount and role."
            control={
              <span
                style={{
                  fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: 'var(--ink-3)', border: '1px dashed var(--paper-2)',
                  borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
                }}
              >
                no switch
              </span>
            }
          >
            <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
              No switch: the rule set is closed by a database constraint
              (<code style={{ fontFamily: MONO }}>restaurant_approval_thresholds_rule_check</code>),
              and a fourth rule would need a row per vendor and a reader that does
              not exist. Drawing the control before the column exists is the fake
              toggle this page removed everywhere else.
            </p>
          </Row>

          <SaveFailure
            failed={data.writer.failed?.key.startsWith('threshold:') ? data.writer.failed : null}
            what="Nothing was recorded; the rule stands as it was."
          />

          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '14px 0 0', maxWidth: 720 }}>
            {reg.retrospective.caveat}
          </p>

          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '10px 0 0', maxWidth: 720 }}>
            Read this register beside Features. That one already carries the
            switch that lets an AI email a vendor with nobody reading it; this is
            the same decision with a number attached — and both are why the
            record below has to exist. A policy nobody can audit is a policy
            nobody will trust enough to raise.
          </p>
        </div>
      )}
    </Register>
  );
}

function describe(kind: 'amount' | 'always' | 'percent', row: ThresholdRow): string {
  const who = row.requiredRole === 'owner' ? 'an owner' : 'a manager';
  if (kind === 'amount') {
    return row.amountLimit === null
      ? `${EM} no amount is recorded`
      : `over ${row.amountLimit.toLocaleString('en-GB')} — ${who} must sign`;
  }
  if (kind === 'percent') {
    return row.percentLimit === null
      ? `${EM} no percentage is recorded`
      : `over ${row.percentLimit}% above the last price — ${who} must sign`;
  }
  return `always — ${who} must sign`;
}

export default ThresholdsSection;
