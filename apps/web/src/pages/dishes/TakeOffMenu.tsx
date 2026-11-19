/**
 * /dishes: the dishes the current menu no longer prints are counted, shown, and
 * taken off the list together after one confirm (g2 menu gap). A re-uploaded
 * menu left every dish it dropped live on the list with nothing saying so.
 *
 * One line says how many; the sheet lists each by name, and one button takes
 * them all off. Nothing is written before that button; the gateway reads the
 * menu again and names every dish it leaves, which is said here in words. A
 * failed take-off says nothing came off. A dish taken off keeps its recipe's
 * saved versions.
 */
import { useState } from 'react';
import type { TakeOffMenuAnswer } from '../../services/api/recipes';
import { reason } from '../cellar/next/recipe/useRecipe';

export interface OffMenu {
  id: string;
  name: string;
  section: string | null;
}

const dishes = (n: number) => `${n} ${n === 1 ? 'dish' : 'dishes'}`;

export default function TakeOffMenu({
  items,
  showing,
  onShowing,
  onTakeOff,
}: {
  items: OffMenu[];
  showing: boolean;
  onShowing: (v: boolean) => void;
  onTakeOff: (ids: string[]) => Promise<TakeOffMenuAnswer>;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string; left: string[] } | null>(null);

  const takeOff = async () => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    try {
      const out = await onTakeOff(items.map((i) => i.id));
      onShowing(false);
      setSaid({
        ok: true,
        text: out.removed.length > 0 ? `${dishes(out.removed.length)} ${out.removed.length === 1 ? 'is' : 'are'} off your list.` : 'No dish was taken off.',
        left: out.skipped.map((s) => `${s.name} was left on the list: ${s.why}`),
      });
    } catch (e) {
      setSaid({ ok: false, text: `Nothing was taken off: ${reason(e)}`, left: [] });
    } finally {
      setBusy(false);
    }
  };

  const result = said ? (
    <div data-testid="take-off-menu-said" role={said.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>
      <p className="cl-said">{said.text}</p>
      {said.left.map((l) => (
        <p key={l} className="cl-note">{l}</p>
      ))}
    </div>
  ) : null;

  if (items.length === 0) return result ? <div style={{ marginTop: 12 }}>{result}</div> : null;

  return (
    <div className="cl-panel" style={{ marginTop: 12, display: 'grid', gap: 8 }} data-testid="take-off-menu">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="cl-said">
          {dishes(items.length)} {items.length === 1 ? 'is' : 'are'} not on the current menu.
        </span>
        <button type="button" className="cl-btn cl-focus" aria-pressed={showing} onClick={() => onShowing(!showing)}>
          {showing ? 'Show all dishes' : 'Show them'}
        </button>
      </div>
      {showing ? (
        <div role="group" aria-label="Dishes the current menu does not print" data-testid="take-off-menu-sheet" style={{ display: 'grid', gap: 8 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th scope="col">Dish</th>
                  <th scope="col">Section</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} data-testid={`take-off-menu-row-${i.id}`}>
                    <td>{i.name}</td>
                    <td>{i.section ?? 'No section'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cl-note">
            The current menu has no line of these names. Nothing comes off until you take them off. A dish taken off keeps its recipe’s saved versions. If a dish is on the menu under another name, keep it and rename it.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => void takeOff()}>
              {busy ? 'Taking off…' : `Take ${items.length === 1 ? 'it' : 'them'} off the list`}
            </button>
            <button type="button" className="cl-btn cl-focus" disabled={busy} onClick={() => onShowing(false)}>
              Keep them
            </button>
          </div>
        </div>
      ) : null}
      {result}
    </div>
  );
}
