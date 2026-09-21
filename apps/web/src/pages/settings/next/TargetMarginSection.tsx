/**
 * Target margin — the margin this house needs on a bottle and on a glass, and
 * how close is close enough (ADR 0193).
 *
 * THE FOUNDER, 2026-09-21: "... advise the manager or owner to increase
 * decrease the prices so that the profit margin is where it's needed. We don't
 * want market average because that will be already shown in another column."
 * He picked "Advise to target margin".
 *
 * THE RULES IT HOLDS (the carrying-cost register's, CarryingCostSection.tsx):
 *   1. Stated before it is recorded. The sentence under the fields says what
 *      Record will write. Nothing is written by opening this page, and no
 *      number is offered as a starting point: nothing implies a house's margin.
 *   2. Units said out loud. A PERCENT of the selling price: 65, not 0.65. The
 *      fraction spelling is refused here and by the gateway with the same
 *      bounds the database holds (5 to 95). "Close enough" is a PERCENT OF THE
 *      ADVISED PRICE, 0 to 20 (founder, 2026-09-21: "percent is always shown
 *      everywhere").
 *   4. The pour, once. Glass advice waits until the house confirms the pour
 *      it serves (founder, 2026-09-21); bottle advice never does.
 *   3. Three states, never two. A failed read says so; nothing set says what
 *      that costs (every wine reads "no target set"); a set target says who
 *      typed it and when.
 *
 * Owners and managers only — the gateway's `assertCanManageRestaurant` on
 * `PUT /pricing/target-margin` is the rule; the disabled fields are a courtesy.
 */
import { useCallback, useEffect, useState } from 'react';
import { Action, Note, Row, fieldStyle } from './SectionKit';
import { MONO, SANS } from './st-format';
import {
  confirmPourSize,
  getTargetMargin,
  setTargetMargin,
  type TargetMarginReadout,
} from '@/services/api/pricing';

export const MIN_PCT = 5;
export const MAX_PCT = 95;
export const MAX_BAND = 20;
export const MIN_POUR_ML = 10;
export const MAX_POUR_ML = 500;

/** What the pour field means before it is confirmed; one pass, so the button and the sentence agree. */
export function readPourInput(raw: string, confirmedMl: number | null): { canConfirm: boolean; sentence: string; ml: number | null } {
  const t = raw.trim().replace(/\s*ml$/i, '');
  if (t === '') return { canConfirm: false, sentence: 'Type the pour this house serves, in ml (for example 125 or 150).', ml: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { canConfirm: false, sentence: `“${raw.trim()}” is not a number of ml.`, ml: null };
  if (n < MIN_POUR_ML || n > MAX_POUR_ML) {
    return { canConfirm: false, sentence: `A pour is between ${MIN_POUR_ML} and ${MAX_POUR_ML} ml.`, ml: null };
  }
  if (confirmedMl !== null && n === confirmedMl) return { canConfirm: false, sentence: 'That is the pour already confirmed.', ml: null };
  return {
    canConfirm: true,
    sentence: `Confirm will record a ${n} ml pour. Every glass is then costed as its share of the bottle (${n} ml of the bottle's size) and advised toward your glass target.`,
    ml: n,
  };
}

type Parsed = { value: number | null; error: string | null };

function parsePct(label: string, raw: string): Parsed {
  const t = raw.trim().replace(/%$/, '');
  if (t === '') return { value: null, error: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, error: `“${raw.trim()}” is not a number.` };
  if (n < MIN_PCT)
    return {
      value: n,
      error: `${n} is below ${MIN_PCT}. The ${label} target is a PERCENT of the price: a 65 percent margin is 65, not 0.65.`,
    };
  if (n > MAX_PCT)
    return { value: n, error: `${n} percent means the ${label} costs under a twentieth of its price. A 3x markup is a 66.7 percent margin.` };
  return { value: n, error: null };
}

/**
 * What the three fields mean, before anything is recorded. One pass returns
 * the sentence AND whether Record may fire, so the two cannot disagree.
 */
export function readTargetInputs(
  bottleRaw: string,
  glassRaw: string,
  bandRaw: string,
  recorded: { bottlePct: number | null; glassPct: number | null; bandPct: number | null },
): { canRecord: boolean; sentence: string; body: { bottlePct: number | null; glassPct: number | null; bandPct: number } | null } {
  const b = parsePct('bottle', bottleRaw);
  const g = parsePct('glass', glassRaw);
  const err = b.error ?? g.error;
  if (err) return { canRecord: false, sentence: `${err} Nothing can be recorded.`, body: null };
  if (b.value === null && g.value === null) {
    return {
      canRecord: false,
      sentence:
        recorded.bottlePct === null && recorded.glassPct === null
          ? 'Nothing is recorded yet. Type the margin you need on a bottle, on a glass, or both.'
          : 'Type a target for bottles, glasses, or both. A target cannot be taken back to none here.',
      body: null,
    };
  }
  const bandT = bandRaw.trim().replace(/%$/, '');
  if (bandT === '') {
    return {
      canRecord: false,
      sentence:
        'Say how close is close enough, as a percent of the advised price (3 means a wine priced within 3 percent of its advised price gets no advice; 0 means advise on any difference).',
      body: null,
    };
  }
  const band = Number(bandT);
  if (!Number.isFinite(band) || band < 0 || band > MAX_BAND) {
    return { canRecord: false, sentence: `“Close enough” is between 0 and ${MAX_BAND} percent of the advised price.`, body: null };
  }
  const same =
    b.value === recorded.bottlePct && g.value === recorded.glassPct && band === recorded.bandPct;
  if (same) return { canRecord: false, sentence: 'That is what is already recorded.', body: null };
  const parts = [
    b.value !== null ? `${b.value} percent on a bottle` : 'no bottle target',
    g.value !== null ? `${g.value} percent on a glass` : 'no glass target',
  ];
  return {
    canRecord: true,
    sentence: `Record will write ${parts.join(' and ')}, treating a price within ${band} percent of the advised price as close enough. Each wine then gets “raise to” or “lower to” this margin from its recorded cost, applied only when a manager accepts it.`,
    body: { bottlePct: b.value, glassPct: g.value, bandPct: band },
  };
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reg: TargetMarginReadout };

function messageOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can state the target margin';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

export function TargetMarginSection({ canManage, onSaved }: { canManage: boolean; onSaved?: () => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const refresh = useCallback(() => {
    getTargetMargin()
      .then((reg) => setLoad({ status: 'ready', reg }))
      .catch((err) => setLoad({ status: 'error', message: messageOf(err) }));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (load.status === 'loading') return <Note>Reading the target margin…</Note>;
  if (load.status === 'error' || (load.status === 'ready' && !load.reg.readable)) {
    const reason = load.status === 'error' ? load.message : load.reg.reason ?? 'no reason was given';
    return (
      <div role="alert">
        <Note>
          The target margin could not be read — {reason}. Nothing below is claimed for it, and this is not the same as
          a house that has not set one.
        </Note>
      </div>
    );
  }
  return (
    <TargetMarginBody
      reg={load.reg}
      canManage={canManage}
      onRecorded={(reg) => {
        setLoad({ status: 'ready', reg });
        onSaved?.();
      }}
    />
  );
}

function TargetMarginBody({
  reg, canManage, onRecorded,
}: { reg: TargetMarginReadout; canManage: boolean; onRecorded: (reg: TargetMarginReadout) => void }) {
  const [bottle, setBottle] = useState(reg.bottlePct === null ? '' : String(reg.bottlePct));
  const [glass, setGlass] = useState(reg.glassPct === null ? '' : String(reg.glassPct));
  const [band, setBand] = useState(reg.bandPct === null ? '' : String(reg.bandPct));
  const [pour, setPour] = useState(reg.pour.ml === null ? '' : String(reg.pour.ml));
  const [pourBusy, setPourBusy] = useState(false);
  const [pourFailed, setPourFailed] = useState<string | null>(null);
  const pourRead = readPourInput(pour, reg.pour.ml);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const read = readTargetInputs(bottle, glass, band, reg);
  const isSet = reg.bottlePct !== null || reg.glassPct !== null;

  const record = async () => {
    if (!read.body) return;
    setBusy(true);
    setFailed(null);
    try {
      const next = await setTargetMargin(read.body);
      onRecorded(next);
    } catch (err) {
      setFailed(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmPour = async () => {
    if (pourRead.ml === null) return;
    setPourBusy(true);
    setPourFailed(null);
    try {
      onRecorded(await confirmPourSize(pourRead.ml));
    } catch (err) {
      setPourFailed(messageOf(err).replace('state the target margin', 'confirm the pour size'));
    } finally {
      setPourBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, unit: string, placeholder: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <label htmlFor={id} style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.1"
        placeholder={placeholder}
        value={value}
        disabled={!canManage || busy}
        onChange={(e) => set(e.target.value)}
        className="st-ink st-focus"
        style={{ ...fieldStyle, opacity: canManage ? 1 : 0.45, width: 76, textAlign: 'right' }}
      />
      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>{unit}</span>
    </span>
  );

  return (
    <>
      <Note>
        The margin this house needs, as a percent of the selling price. For each wine the system takes what it cost you
        and what it sells for, and says “raise to” or “lower to” the price that earns this margin. It never changes a
        price on its own, and it never uses the market average, which stays in its own column.
      </Note>

      <Row
        label="Target margin"
        consequence={
          isSet ? (
            <>
              Every wine with a recorded cost is advised toward{' '}
              <strong>
                {[reg.bottlePct !== null ? `${reg.bottlePct} percent on a bottle` : null, reg.glassPct !== null ? `${reg.glassPct} percent on a glass` : null]
                  .filter(Boolean)
                  .join(' and ')}
              </strong>
              , close enough within {reg.bandPct} percent of the advised price.
            </>
          ) : (
            <>
              <strong>No price advice is given anywhere.</strong> Until a target is set, every wine reads “no target set”
              rather than being advised toward a margin nobody chose.
            </>
          )
        }
        provenance={{
          kept: 'restaurant',
          when: reg.statedAt,
          whenUnknown: 'nobody has set one yet, so there is no date to show',
          verb: 'set',
        }}
        control={
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {field('st-target-bottle', 'bottle', bottle, setBottle, '%', '65')}
            {field('st-target-glass', 'glass', glass, setGlass, '%', '75')}
            {field('st-target-band', 'close enough', band, setBand, '% of advised', '3')}
            <Action disabled={!canManage || busy || !read.canRecord} onClick={() => void record()}>
              {busy ? 'Recording…' : 'Record'}
            </Action>
          </span>
        }
      >
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          {read.sentence}
        </p>
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '6px 0 0' }}>
            set by · {reg.statedBy.name}
          </p>
        )}
        {!canManage && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only managers and owners can state the margin this restaurant needs. The fields stay legible so you can read
            the target, and the gateway refuses anyone else independently of this page.
          </p>
        )}
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The target was recorded, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
          </p>
        )}
      </Row>

      {failed && (
        <p
          role="alert"
          style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '10px 0 0' }}
        >
          That did not go through — {failed}. Nothing was recorded; the target above is unchanged.
        </p>
      )}

      <Row
        label="Pour size"
        consequence={
          reg.pour.confirmed ? (
            <>
              Glasses are costed on a <strong>{reg.pour.ml} ml</strong> pour and advised toward your glass target.
            </>
          ) : (
            <>
              <strong>No glass is advised yet.</strong> Confirm the pour this house serves, once, and glass advice
              starts. Bottle advice does not wait for it.
            </>
          )
        }
        provenance={{
          kept: 'restaurant',
          when: reg.pour.confirmedAt,
          whenUnknown: 'nobody has confirmed it yet, so there is no date to show',
          verb: 'confirmed',
        }}
        control={
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <label
                htmlFor="st-pour-ml"
                style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}
              >
                pour
              </label>
              <input
                id="st-pour-ml"
                type="number"
                inputMode="decimal"
                step="1"
                placeholder="125"
                value={pour}
                disabled={!canManage || pourBusy}
                onChange={(e) => setPour(e.target.value)}
                className="st-ink st-focus"
                style={{ ...fieldStyle, opacity: canManage ? 1 : 0.45, width: 76, textAlign: 'right' }}
              />
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3)' }}>ml</span>
            </span>
            <Action disabled={!canManage || pourBusy || !pourRead.canConfirm} onClick={() => void confirmPour()}>
              {pourBusy ? 'Confirming…' : 'Confirm'}
            </Action>
          </span>
        }
      >
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          {pourRead.sentence}
        </p>
        {reg.pour.confirmedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '6px 0 0' }}>
            confirmed by · {reg.pour.confirmedBy.name}
          </p>
        )}
      </Row>

      {pourFailed && (
        <p
          role="alert"
          style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '10px 0 0' }}
        >
          The pour was not confirmed — {pourFailed}. Glass advice still waits.
        </p>
      )}

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '14px 0 0' }}>
        How the advice is worked out: price = cost ÷ (1 − target). A bottle that cost 20 at a 65 percent target is
        57.14. A glass costs its share of the bottle (cost × the house's confirmed pour ÷ bottle size). A wine with no
        recorded cost gets no advice and says so. Close enough is measured as a percent of the advised price: at 3
        percent, a bottle advised at 57.14 is left alone anywhere from 55.43 to 58.86.
      </p>
    </>
  );
}

export default TargetMarginSection;
