/**
 * Measurement — one browser setting and one restaurant fact, each saying where
 * it is kept.
 *
 * The display unit is zustand `persist` under `restaurant-settings-storage`,
 * i.e. localStorage: it only changes how this browser writes volumes out.
 *
 * The house's glass pour is NOT kept here any more (recipes walk G13, call
 * F11). It used to be a browser-only number nothing on the server read, so two
 * managers could see two pours and the stock draw used neither. It is now
 * `restaurants.default_pour_ml`, read from `GET /pricing/target-margin` and
 * confirmed through `PUT /pricing/pour-size` (owner or manager; the gateway
 * refuses anyone else). `record_glass_pour` draws it, once confirmed, for a
 * glass that states no pour of its own (migration one_pour_size_for_the_house).
 *
 * The recipes on/off switch and the recipe-yield unit are gone (G15, call
 * F14): nothing read them. A recipe takes stock when the house switches the
 * cocktail kind on, on the server.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRestaurantSettingsStore } from '@/stores';
import { confirmPourSize, getTargetMargin, type TargetMarginReadout } from '@/services/api/pricing';
import { Action, Choice, Note, Row, SaveFailure, fieldStyle } from './SectionKit';
import { KEPT_NOTE, MONO, PROVENANCE_UNKNOWN, SANS } from './st-format';
import { readPourInput } from './TargetMarginSection';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reg: TargetMarginReadout };

function messageOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can confirm the pour';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

function HousePour() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [pour, setPour] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ message: string } | null>(null);

  const refresh = useCallback(() => {
    getTargetMargin()
      .then((reg) => {
        setLoad({ status: 'ready', reg });
        setPour(reg.pour.ml === null ? '' : String(reg.pour.ml));
      })
      .catch((err) => setLoad({ status: 'error', message: messageOf(err) }));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (load.status === 'loading') return <Note>Reading the house's pour…</Note>;
  if (load.status === 'error' || !load.reg.readable) {
    const reason = load.status === 'error' ? load.message : load.reg.reason ?? 'no reason was given';
    return (
      <div role="alert">
        <Note>The house's pour could not be read — {reason}. That is not the same as a house that has not confirmed one.</Note>
      </div>
    );
  }

  const { reg } = load;
  const read = readPourInput(pour, reg.pour.ml);
  const confirm = async () => {
    if (read.ml === null) return;
    setBusy(true);
    setFailed(null);
    try {
      const next = await confirmPourSize(read.ml);
      setLoad({ status: 'ready', reg: next });
      setPour(next.pour.ml === null ? '' : String(next.pour.ml));
    } catch (err) {
      setFailed({ message: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label="House glass pour"
      provenance={{ kept: 'restaurant', when: reg.pour.confirmedAt, whenUnknown: 'not confirmed yet', verb: 'confirmed' }}
      consequence={
        reg.pour.confirmed
          ? <>A glass takes {reg.pour.ml} ml from the bottle when neither the sale nor the wine states a pour. A wine&apos;s own pour still comes first. Glass price advice is costed on it.</>
          : <>Not confirmed. Until it is, a glass that neither the sale nor the wine sizes takes 150 ml, and glass price advice waits.</>
      }
      control={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number" inputMode="decimal" min={10} max={500} step="1" placeholder="125"
            aria-label="House glass pour in millilitres" value={pour} disabled={busy}
            onChange={(e) => setPour(e.target.value)}
            className="st-ink st-focus"
            style={{ ...fieldStyle, width: 76, textAlign: 'right' }}
          />
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)' }}>ml</span>
          <Action disabled={busy || !read.canConfirm} onClick={() => void confirm()}>
            {busy ? 'Confirming…' : 'Confirm'}
          </Action>
        </span>
      }
    >
      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
        {read.sentence}
      </p>
      {reg.pour.confirmedBy?.name && (
        <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '6px 0 0' }}>
          confirmed by · {reg.pour.confirmedBy.name}
        </p>
      )}
      <SaveFailure failed={failed} what="Nothing was recorded." />
    </Row>
  );
}

export function MeasurementSection() {
  const { measurementUnit, setMeasurementUnit } = useRestaurantSettingsStore();
  const browser = { kept: 'browser' as const, when: null, whenUnknown: PROVENANCE_UNKNOWN.browser };

  return (
    <>
      <Note>
        <strong>{KEPT_NOTE.browser}</strong> That is true of the display unit only. The house's pour below is kept on
        the restaurant.
      </Note>
      <Row
        label="Display unit"
        provenance={browser}
        consequence="How every volume in the product is written out for you. It changes nothing about what is stored."
        control={
          <Choice label="Display unit" value={measurementUnit}
            options={[{ value: 'ml' as const, label: 'Metric (ml/L)' }, { value: 'oz' as const, label: 'US (oz)' }]}
            onChange={setMeasurementUnit} />
        }
      />
      <HousePour />
    </>
  );
}

export default MeasurementSection;
