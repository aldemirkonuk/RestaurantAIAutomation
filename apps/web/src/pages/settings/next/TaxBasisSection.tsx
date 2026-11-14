/**
 * Tax in the house's prices — whether its own prices hold tax, and whether it
 * reclaims the tax it pays on what it buys (ADR 0359 C2/C3, lane 3.5a).
 *
 * `GET`/`PUT /settings/tax-basis` (`house-tax-basis.service.ts`). Every house
 * reads "not answered" until someone answers here, and until then every
 * delivery is costed as its invoice prints it. A house that reclaims the tax
 * then has stock costed with tax in it, and every margin reads thin by the
 * rate.
 *
 * Rules this section keeps:
 *   1. Nothing is offered as a default: no country guess, no pre-pressed
 *      choice. The sentence under the choices says what Record will write
 *      BEFORE it writes (ADR 0083).
 *   2. Both answers together. A house that charges no VAT reclaims none, so
 *      the reclaim question is not asked of it.
 *   3. Only from now on (founder F2, 2026-10-12): deliveries already costed
 *      keep their cost, and the page says so.
 *   4. A failed read is not "not answered".
 */
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { fmtWhen } from '@/lib/mudavym/format';
import { Action, Choice, Note, Row } from './SectionKit';
import { MONO, SANS } from './st-format';

export type TaxBasis = 'prices_include_tax' | 'prices_exclude_tax' | 'not_vat_charging';

export interface TaxBasisReadout {
  restaurantId: string;
  basis: TaxBasis | 'unset';
  reclaimsInputTax: boolean | null;
  since: string | null;
  statedAt: string | null;
  statedBy: { userId: string; name: string | null } | null;
  readable: boolean;
  reason: string | null;
  audited?: boolean;
  auditReason?: string | null;
}

const BASIS_OPTIONS: Array<{ value: TaxBasis; label: string }> = [
  { value: 'prices_include_tax', label: 'Our prices include tax' },
  { value: 'prices_exclude_tax', label: 'Our prices are before tax' },
  { value: 'not_vat_charging', label: 'We charge no VAT' },
];
const RECLAIM_OPTIONS: Array<{ value: 'yes' | 'no'; label: string }> = [
  { value: 'yes', label: 'Yes, we reclaim it' },
  { value: 'no', label: 'No, we keep it as a cost' },
];

/** What Record would write, in words, before it writes. */
export function readTaxAnswer(
  basis: TaxBasis | null,
  reclaims: boolean | null,
  recorded: Pick<TaxBasisReadout, 'basis' | 'reclaimsInputTax'>,
): { canRecord: boolean; sentence: string; body: { basis: TaxBasis; reclaimsInputTax: boolean } | null } {
  if (basis === null) {
    return {
      canRecord: false,
      sentence: 'Not answered yet. Until it is, every delivery is costed as its invoice prints it, tax and all.',
      body: null,
    };
  }
  const r = basis === 'not_vat_charging' ? false : reclaims;
  if (r === null) {
    return {
      canRecord: false,
      sentence: 'Say whether the house reclaims the tax it pays on its purchases. Its stock is costed before tax only if it does.',
      body: null,
    };
  }
  if (recorded.basis === basis && recorded.reclaimsInputTax === r) {
    return { canRecord: false, sentence: 'That is what is already recorded.', body: null };
  }
  const how =
    basis === 'not_vat_charging'
      ? 'This house charges no VAT, so it reclaims none: a delivery whose invoice shows its tax is costed with the tax in it.'
      : r
        ? 'This house reclaims the tax it pays: a delivery whose invoice shows its tax is costed before tax.'
        : 'This house keeps the tax it pays as a cost: a delivery whose invoice shows its tax is costed with the tax in it.';
  return {
    canRecord: true,
    sentence: `Record will write: ${how} This counts from now on. Deliveries already costed keep their cost.`,
    body: { basis, reclaimsInputTax: r },
  };
}

function messageOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can answer this';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; reg: TaxBasisReadout };

export function TaxBasisSection({ canManage }: { canManage: boolean }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const refresh = useCallback(() => {
    apiClient
      .get<TaxBasisReadout>('/settings/tax-basis')
      .then(({ data }) => setLoad({ status: 'ready', reg: data }))
      .catch((err) => setLoad({ status: 'error', message: messageOf(err) }));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (load.status === 'loading') return <Note>Reading the tax answer…</Note>;
  if (load.status === 'error' || !load.reg.readable) {
    const reason = load.status === 'error' ? load.message : load.reg.reason ?? 'no reason was given';
    return (
      <div role="alert">
        <Note>
          The tax answer could not be read — {reason}. Nothing below is claimed for it, and this is not the same as a
          house that has not answered.
        </Note>
      </div>
    );
  }
  return <TaxBasisBody reg={load.reg} canManage={canManage} onSaved={(reg) => setLoad({ status: 'ready', reg })} />;
}

function TaxBasisBody({
  reg, canManage, onSaved,
}: { reg: TaxBasisReadout; canManage: boolean; onSaved: (reg: TaxBasisReadout) => void }) {
  const [basis, setBasis] = useState<TaxBasis | null>(reg.basis === 'unset' ? null : reg.basis);
  const [reclaims, setReclaims] = useState<boolean | null>(reg.reclaimsInputTax);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const read = readTaxAnswer(basis, reclaims, reg);

  const record = async () => {
    if (!read.body) return;
    setBusy(true);
    setFailed(null);
    try {
      const { data } = await apiClient.put<TaxBasisReadout>('/settings/tax-basis', read.body);
      onSaved(data);
    } catch (err) {
      setFailed(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const answered = reg.basis !== 'unset';
  return (
    <>
      <Note>
        Mudavym costs each delivery from its invoice. Whether tax belongs in that cost depends on two things only you
        can say: whether your own prices include tax, and whether you get back the tax you pay your suppliers.
      </Note>

      <Row
        label="Your own prices"
        consequence={answered ? BASIS_OPTIONS.find((o) => o.value === reg.basis)?.label ?? reg.basis : 'Not answered.'}
        provenance={{ kept: 'restaurant', when: reg.statedAt, whenUnknown: 'nobody has answered yet' }}
      >
        <div style={{ margin: '8px 0 0' }}>
          <Choice value={basis} options={BASIS_OPTIONS} onChange={setBasis} label="Your own prices" disabled={!canManage || busy} />
        </div>
      </Row>

      {basis !== 'not_vat_charging' && (
        <Row
          label="Do you reclaim the tax you pay on purchases?"
          consequence={
            reg.reclaimsInputTax === null || !answered
              ? 'Not answered.'
              : reg.reclaimsInputTax
                ? 'Yes. Stock is costed before tax where the invoice shows it.'
                : 'No. Stock is costed with its tax in it.'
          }
        >
          <div style={{ margin: '8px 0 0' }}>
            <Choice
              value={reclaims === null ? null : reclaims ? 'yes' : 'no'}
              options={RECLAIM_OPTIONS}
              onChange={(v) => setReclaims(v === 'yes')}
              label="Do you reclaim the tax you pay on purchases?"
              disabled={!canManage || busy}
            />
          </div>
        </Row>
      )}

      <p data-testid="st-tax-sentence" style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', margin: '10px 0 8px' }}>
        {read.sentence}
      </p>
      {canManage ? (
        <Action onClick={() => void record()} disabled={!read.canRecord || busy}>
          {busy ? 'Recording…' : 'Record'}
        </Action>
      ) : (
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
          Only an owner or a manager can answer this.
        </p>
      )}

      {answered && reg.since && (
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '8px 0 0' }}>
          First answered {fmtWhen(reg.since)}. Deliveries costed before then keep the cost they were posted at.
        </p>
      )}
      {reg.statedBy?.name && (
        <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '6px 0 0' }}>
          set by · {reg.statedBy.name}
        </p>
      )}
      {reg.audited === false && reg.auditReason !== 'nothing changed' && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
          The answer was saved, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
        </p>
      )}
      {failed && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
          {/[.!]$/.test(failed) ? failed : `Nothing was recorded — ${failed}.`}
        </p>
      )}
    </>
  );
}

export default TaxBasisSection;
