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
 *      bounds the database holds (5 to 95; the band 0 to 20 points).
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
  getTargetMargin,
  setTargetMargin,
  type TargetMarginReadout,
} from '@/services/api/pricing';

export const MIN_PCT = 5;
export const MAX_PCT = 95;
export const MAX_BAND = 20;

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
  recorded: { bottlePct: number | null; glassPct: number | null; bandPts: number | null },
): { canRecord: boolean; sentence: string; body: { bottlePct: number | null; glassPct: number | null; bandPts: number } | null } {
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
  const bandT = bandRaw.trim();
  if (bandT === '') {
    return { canRecord: false, sentence: 'Say how close is close enough, in margin points (2 means within 2 points of the target is fine; 0 means advise on any difference).', body: null };
  }
  const band = Number(bandT);
  if (!Number.isFinite(band) || band < 0 || band > MAX_BAND) {
    return { canRecord: false, sentence: `“Close enough” is between 0 and ${MAX_BAND} margin points.`, body: null };
  }
  const same =
    b.value === recorded.bottlePct && g.value === recorded.glassPct && band === recorded.bandPts;
  if (same) return { canRecord: false, sentence: 'That is what is already recorded.', body: null };
  const parts = [
    b.value !== null ? `${b.value} percent on a bottle` : 'no bottle target',
    g.value !== null ? `${g.value} percent on a glass` : 'no glass target',
  ];
  return {
    canRecord: true,
    sentence: `Record will write ${parts.join(' and ')}, with ${band} point${band === 1 ? '' : 's'} as close enough. Each wine then gets “raise to” or “lower to” this margin from its recorded cost, applied only when a manager accepts it.`,
    body: { bottlePct: b.value, glassPct: g.value, bandPts: band },
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
  const [band, setBand] = useState(reg.bandPts === null ? '' : String(reg.bandPts));
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
              , within {reg.bandPts} point{reg.bandPts === 1 ? '' : 's'}.
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
            {field('st-target-band', 'close enough', band, setBand, 'pts', '2')}
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

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '14px 0 0' }}>
        How the advice is worked out: price = cost ÷ (1 − target). A bottle that cost 20 at a 65 percent target is
        57.14. A glass costs its share of the bottle (cost × pour ÷ bottle size). A wine with no recorded cost gets no
        advice and says so.
      </p>
    </>
  );
}

export default TargetMarginSection;
