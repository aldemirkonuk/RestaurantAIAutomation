/**
 * The house's low-stock number, after setup (F-1414, a rehit of F-075).
 *
 * The number was set only on the arrival's low-stock step, and that step hides
 * for good once it is saved, so an owner who picked 6 in the first week had no
 * way to make it 4 later. This row reads the saved number and writes it with
 * the same call the step makes: it reaches items added from now on, and the
 * items carried now only on the counted tick (F-1059).
 *
 * Owners and managers only — the gateway's `assertCanManageRestaurant` on
 * `/onboarding/threshold` is the rule; the disabled field is a courtesy.
 */
import { useEffect, useState } from 'react';
import { Action, Note, Row, fieldStyle } from './SectionKit';
import { SANS } from './st-format';
import { getLowStockSetting, setDefaultThreshold } from '@/services/api/menus';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; saved: number | null; carried: number };

function messageOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can change the low-stock number';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  return e?.message || 'no reason was given';
}

export function LowStockSection({ canManage }: { canManage: boolean }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [typed, setTyped] = useState('');
  const [applyToCarried, setApplyToCarried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [kept, setKept] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    getLowStockSetting()
      .then((s) => {
        if (!live) return;
        setLoad({ status: 'ready', saved: s.defaultThresholdMin, carried: s.carried });
        setTyped(s.defaultThresholdMin == null ? '' : String(s.defaultThresholdMin));
      })
      .catch((err) => {
        if (live) setLoad({ status: 'error', message: messageOf(err) });
      });
    return () => {
      live = false;
    };
  }, [canManage]);

  if (!canManage) return <Note>Only an owner or a manager can change the low-stock number.</Note>;
  if (load.status === 'loading') return <Note>Reading the low-stock number…</Note>;
  if (load.status === 'error') {
    return (
      <div role="alert">
        <Note>The low-stock number could not be read — {load.message}. Nothing below is claimed for it.</Note>
      </div>
    );
  }

  const n = /^\d{1,3}$/.test(typed.trim()) ? Number(typed.trim()) : null;
  const changed = n !== null && (n !== load.saved || applyToCarried);

  const save = async () => {
    if (n === null) return;
    setBusy(true);
    setFailed(null);
    setKept(null);
    try {
      const out = await setDefaultThreshold(n, applyToCarried && load.carried > 0);
      setLoad({ ...load, saved: n });
      setApplyToCarried(false);
      const also = out.applied_to_carried ? ` and set on the ${out.applied_to_carried} items you carry now` : '';
      setKept(`Saved: ${n}${also}.`);
    } catch (err) {
      setFailed(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label="Low-stock number"
      consequence={
        <>
          An item is flagged when it drops below this many. Every item you add from now on starts with it; each item
          you carry keeps its own number unless you tick the box below. You can still change any one item’s number on
          Inventory.
        </>
      }
      control={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Low-stock number"
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
            className="st-ink st-focus"
            style={{ ...fieldStyle, width: 64, textAlign: 'right' }}
          />
          <Action onClick={save} disabled={!changed || busy}>
            {busy ? 'Saving…' : 'Save'}
          </Action>
        </span>
      }
    >
      {typed.trim() !== '' && n === null && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', margin: '6px 0 0' }}>
          Type a whole number from 0 to 999.
        </p>
      )}
      {load.carried > 0 && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: SANS, fontSize: 12, margin: '8px 0 0' }}>
          <input type="checkbox" checked={applyToCarried} onChange={(e) => setApplyToCarried(e.target.checked)} />
          <span>
            Also set it on the {load.carried} item{load.carried === 1 ? '' : 's'} you carry now.
          </span>
        </label>
      )}
      {kept && (
        <p role="status" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)', margin: '6px 0 0' }}>
          {kept}
        </p>
      )}
      {failed && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', margin: '6px 0 0' }}>
          That did not go through — {failed}.
        </p>
      )}
    </Row>
  );
}
