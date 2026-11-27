/**
 * What choosing a menu will do, shown BEFORE anyone chooses it (ADR 0193
 * round 3, L13).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "add a section to that where you can lock
 * price, but wha f that menu item disappears? so think verify validate your
 * decision and build". This is that section:
 *   - every price this menu would REPLACE, with who set it and when, and a
 *     Keep switch beside it (an owner or a manager locks the price there and
 *     then; the plan is read again);
 *   - every price a lock already holds, which this menu will not touch;
 *   - a locked wine that comes back with this menu, and a vintage that reads
 *     differently from the locked wine's, so a wrong link is seen;
 *   - every lock whose wine is NOT on this menu: kept, not changed;
 *   - every line of the menu, per kind, behind one "Every line" disclosure.
 * A price a person set AFTER this menu was read is listed FIRST, with who and
 * when (the founder, 2026-09-21, confirming L11 verbatim: "The menu sets it,
 * locks keep"): the menu replaces it unless someone keeps it.
 * "Make it current" sends the plan's fingerprint; the gateway refuses (409,
 * nothing changed) if the plan moved in the meantime, and the page reads it
 * again.
 *
 * Simple and readable for people (the founder's Wave Four / Arrival bar): one
 * sentence first, the detail after. No motion.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMenuPlan,
  makeMenuCurrent,
  type MakeCurrentResult,
  type MenuPlan as Plan,
  type PlanKind,
  type PlanLine,
} from '../../../services/api/menus';
import { lockPrice, releasePriceLock } from '../../../services/api/pricing';
// Drawn with the cellar's classes wherever it is shown (/menu and onboarding).
import '../../cellar/next/cellar-next.css';

const EM = '—';

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? EM : n.toFixed(2);
}

function day(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : 'an unknown day';
}

/** The gateway's own words for a refusal, never a bare status. */
function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can do that';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  // The transport's own words ("Network Error") say nothing to a person: the
  // request never got an answer, so say that.
  const sent = err as { code?: unknown; response?: unknown };
  if (sent?.code === 'ERR_NETWORK' && !sent.response) return 'Mudavym could not be reached just now.';
  return e?.message || 'no reason was given';
}

/** No answer came back (a timeout, a dropped connection): the choice may still have been made. */
function noAnswer(err: unknown): boolean {
  const e = err as { code?: unknown; response?: unknown; message?: unknown };
  if (e?.response) return false;
  return e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.code === 'ERR_NETWORK' || /timeout/i.test(String(e?.message ?? ''));
}

/** Prices of a menu that are still to reach the house (a choice made, a carry cut off). */
function toCarry(plan: Pick<Plan, 'counts'>): number {
  return plan.counts.change + plan.counts.new_wine;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The plan in one sentence, in the order a person reads a menu change. */
export function planSentence(plan: Pick<Plan, 'counts' | 'dormantLocks' | 'current' | 'lines'>): string {
  if (plan.current) {
    const left = toCarry(plan);
    return left > 0
      ? `This is already the current menu, but ${plural(left, 'price has', 'prices have')} not reached the house yet. Choosing it again carries ${left === 1 ? 'it' : 'them'}.`
      : 'This is already the current menu. Choosing it again changes nothing.';
  }
  const c = plan.counts;
  const parts: string[] = [];
  if (c.change > 0) parts.push(`set ${plural(c.change, 'price', 'prices')} from this menu`);
  if (c.new_wine > 0) parts.push(`add ${plural(c.new_wine, 'price', 'prices')} for wines new to the house`);
  if (c.held_by_lock > 0)
    parts.push(`leave ${plural(c.held_by_lock, 'locked price', 'locked prices')} as ${c.held_by_lock === 1 ? 'it is' : 'they are'}`);
  if (c.unchanged > 0) parts.push(`find ${plural(c.unchanged, 'price', 'prices')} already the same`);
  const lead = parts.length ? `Choosing this menu will ${parts.join(', ')}.` : 'Choosing this menu changes no price.';
  const more: string[] = [];
  if (c.blank_kept > 0) more.push(`${plural(c.blank_kept, 'price is', 'prices are')} blank on the menu, so the house keeps its own (flagged)`);
  const unpriced = plan.lines.filter((l) => l.flag === 'blank_no_house_price').length;
  if (unpriced > 0) more.push(`${plural(unpriced, 'line shows', 'lines show')} no price and the house has none either (flagged)`);
  const unmatched = plan.lines.filter((l) => l.bottle.result === 'not_linked').length;
  if (unmatched > 0) more.push(`${plural(unmatched, 'line is', 'lines are')} not matched to a wine, so no price`);
  if (plan.dormantLocks.length > 0)
    more.push(
      `${plural(plan.dormantLocks.length, 'locked price is', 'locked prices are')} not on this menu and ${plan.dormantLocks.length === 1 ? 'stays' : 'stay'} locked`,
    );
  return more.length ? `${lead} ${more.join('; ')}.` : lead;
}

/**
 * The move that matters most when a menu is chosen: how many prices move, the
 * largest one (by the size of the change, in the house's money) and how many
 * locked prices stay. Null when no price moves (r102 menu-critic-3).
 */
export function largestMove(plan: Pick<Plan, 'lines' | 'counts'>): {
  moved: number;
  kept: number;
  name: string;
  kind: 'bottle' | 'glass';
  from: number;
  to: number;
} | null {
  let best: { name: string; kind: 'bottle' | 'glass'; from: number; to: number } | null = null;
  let moved = 0;
  for (const line of plan.lines) {
    for (const k of [line.bottle, line.glass]) {
      if (k.result !== 'change') continue;
      moved += 1;
      if (k.menuPrice === null || k.housePrice === null) continue;
      if (!best || Math.abs(k.menuPrice - k.housePrice) > Math.abs(best.to - best.from)) {
        best = { name: line.name, kind: k.kind, from: k.housePrice, to: k.menuPrice };
      }
    }
  }
  if (moved === 0) return null;
  return { moved, kept: plan.counts.held_by_lock ?? 0, name: best?.name ?? '', kind: best?.kind ?? 'bottle', from: best?.from ?? 0, to: best?.to ?? 0 };
}

/** Who set the price that would be replaced, in words. */
function setWords(k: PlanKind): string {
  if (!k.lastSet) return '';
  const who = k.lastSet.by.name ?? (k.lastSet.by.userId ? 'someone whose name is not on record' : 'no person named');
  const how = k.lastSet.source === 'import' ? 'from a menu' : k.lastSet.source === 'agent_accepted' ? 'accepting advice' : 'by hand';
  return `set ${how} by ${who} on ${day(k.lastSet.at)}${k.setAfterRead ? ', after this menu was read' : ''}`;
}

/**
 * The prices this menu would change or leaves held, a price a person set after
 * the menu was read FIRST (the founder's L11 confirmation), the rest in menu
 * order.
 */
export function orderedRows(lines: PlanLine[]): Row[] {
  const rows: Row[] = lines
    .flatMap((line) => [line.bottle, line.glass].map((k) => ({ line, k })))
    .filter((r) => r.k.result === 'change' || r.k.result === 'held_by_lock');
  return [...rows.filter((r) => r.k.setAfterRead === true), ...rows.filter((r) => r.k.setAfterRead !== true)];
}

/** One kind of one line, in the words of what choosing the menu does to it. */
export function kindWords(line: PlanLine, k: PlanKind): string {
  switch (k.result) {
    case 'change':
      return `becomes ${money(k.menuPrice)} (now ${money(k.housePrice)})`;
    case 'unchanged':
      return `already ${money(k.housePrice)}`;
    case 'held_by_lock':
      return `stays ${money(k.lock?.lockedPrice ?? k.housePrice)}, locked`;
    case 'blank_kept':
      return `blank on the menu; the house keeps ${money(k.housePrice)} (flagged)`;
    case 'blank_never_priced':
      return line.flag === 'blank_no_house_price' ? 'no price on the menu or at the house (flagged)' : EM;
    case 'not_linked':
      return 'not matched to a wine, so no price';
    case 'new_wine':
      return k.menuPrice === null ? EM : `new to the house at ${money(k.menuPrice)}`;
    default:
      // A result this page does not know is still shown, never dropped.
      return String(k.result).replace(/_/g, ' ');
  }
}

export interface Row {
  line: PlanLine;
  k: PlanKind;
}

function KeepSwitch({
  row,
  canManage,
  onChanged,
}: {
  row: Row;
  canManage: boolean;
  onChanged: (said: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const held = row.k.result === 'held_by_lock';
  const act = useMutation({
    mutationFn: async () => {
      if (held && row.k.lock) return releasePriceLock(row.k.lock.lockId, 'released from the menu plan');
      if (!row.line.inventoryId) throw new Error('this line has no wine of the house to lock');
      return lockPrice(row.line.inventoryId, row.k.kind, 'kept from the menu plan');
    },
    onSuccess: (r) => {
      setError(null);
      onChanged(r.sentence);
    },
    onError: (e) => setError(reasonOf(e)),
  });
  if (!canManage) return <span className="cl-dim">{held ? 'Kept (locked)' : EM}</span>;
  // L2: a lock holds a price that exists. A kind the house has no price for
  // has nothing to keep (the gateway would answer 409 nothing_to_lock).
  if (!held && row.k.housePrice === null) return <span className="cl-dim">Nothing to keep yet</span>;
  return (
    <span>
      <button
        type="button"
        className="cl-btn cl-focus"
        data-on={held ? 'true' : 'false'}
        aria-pressed={held}
        disabled={act.isPending}
        onClick={() => act.mutate()}
        aria-label={`${held ? 'Let the menu set' : 'Keep'} the ${row.k.kind} price of ${row.line.name}`}
      >
        {act.isPending ? 'Saving…' : held ? 'Kept' : 'Keep'}
      </button>
      {error ? (
        <span role="alert" className="cl-note" style={{ display: 'block' }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function MenuPlan({
  menuId,
  canManage,
  onDone,
  onCancel,
}: {
  menuId: string;
  canManage: boolean;
  /** Called with what the choice did, once it is made. */
  onDone: (result: MakeCurrentResult) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const q = useQuery({ queryKey: ['menu', 'plan', menuId], queryFn: () => getMenuPlan(menuId) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['menu', 'plan', menuId] });

  const choose = useMutation({
    mutationFn: (fingerprint: string) => makeMenuCurrent(menuId, fingerprint),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'locks'] });
      onDone(r);
    },
    onError: (e) => {
      if (noAnswer(e)) {
        // The switch commits before the carry runs: look again at what is true now.
        void queryClient.invalidateQueries({ queryKey: ['menu'] });
        return;
      }
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setMoved(true);
        refresh();
      }
    },
  });

  if (q.isLoading) {
    return (
      <p className="cl-said" role="status" style={{ marginTop: 10 }}>
        Working out what choosing this menu would do…
      </p>
    );
  }
  if (q.isError || !q.data) {
    return (
      <p className="cl-said" role="alert" style={{ marginTop: 10 }} data-testid="menu-plan-error">
        What choosing this menu would do could not be worked out ({reasonOf(q.error)}), so it cannot be made current
        yet. Nothing has changed.
      </p>
    );
  }
  const plan = q.data;
  const replacing = orderedRows(plan.lines);
  const typedAfter = replacing.filter((r) => r.k.setAfterRead === true).length;
  const returned = plan.lines.filter((l) => l.returned);
  const mismatched = plan.lines.filter((l) => l.vintageMismatch);
  const move = largestMove(plan);

  return (
    <section className="cl-panel" style={{ marginTop: 12 }} aria-labelledby={`plan-h-${menuId}`} data-testid="menu-plan">
      <h3 id={`plan-h-${menuId}`} className="cl-crumb" style={{ margin: 0 }}>
        Before it becomes current
      </h3>
      <p className="cl-standing" style={{ marginTop: 6 }} data-testid="menu-plan-sentence">
        {planSentence(plan)}
      </p>
      {moved ? (
        <p role="status" className="cl-said" style={{ marginTop: 6 }} data-testid="menu-plan-moved">
          A price or a lock changed since this was shown, so nothing was changed. Here it is again.
        </p>
      ) : null}
      {!plan.namesReadable ? (
        <p className="cl-note">Some names could not be read ({plan.namesReason}). The prices below are exact.</p>
      ) : null}

      {replacing.length > 0 ? (
        <>
          <p className="cl-said" style={{ marginTop: 12 }}>
            {canManage
              ? 'Prices this menu would change. Keep one to hold it at the house price: no menu changes it until an owner or a manager does.'
              : 'Prices this menu would change. An owner or a manager can keep one as it is.'}
          </p>
          {typedAfter > 0 ? (
            <p className="cl-said" style={{ marginTop: 6 }} data-testid="menu-plan-typed-after">
              {plural(typedAfter, 'price was', 'prices were')} set by a person after this menu was read
              {plan.readAt ? ` (${day(plan.readAt)})` : ''}. This menu would replace {typedAfter === 1 ? 'it' : 'them'}, so{' '}
              {typedAfter === 1 ? 'it is' : 'they are'} listed first{canManage ? ': keep one to hold it' : ''}.
            </p>
          ) : null}
          <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 8 }}>
            <table className="cl-table" style={{ width: '100%' }} data-testid="menu-plan-prices">
              <thead>
                <tr>
                  <th>Wine</th>
                  <th>Price</th>
                  <th>House now</th>
                  <th>This menu</th>
                  <th>What happens</th>
                  <th>Keep</th>
                </tr>
              </thead>
              <tbody>
                {replacing.map((r) => (
                  <tr
                    key={`${r.line.menuItemId}:${r.k.kind}`}
                    data-testid="menu-plan-row"
                    data-after-read={r.k.setAfterRead === true ? 'true' : 'false'}
                  >
                    <td>{r.line.name}</td>
                    <td className="cl-dim">{r.k.kind}</td>
                    <td>{money(r.k.housePrice)}</td>
                    <td>{money(r.k.menuPrice)}</td>
                    <td className="cl-dim">
                      {r.k.result === 'held_by_lock' && r.k.lock
                        ? `Stays ${money(r.k.lock.lockedPrice)}: locked by ${r.k.lock.lockedBy.name ?? 'someone whose name is not on record'} on ${day(r.k.lock.lockedAt)}`
                        : `Becomes ${money(r.k.menuPrice)}${setWords(r.k) ? `; it was ${setWords(r.k)}` : ''}`}
                    </td>
                    <td>
                      <KeepSwitch
                        row={r}
                        canManage={canManage}
                        onChanged={(s) => {
                          setSaid(s);
                          setMoved(false);
                          refresh();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {returned.length > 0 || mismatched.length > 0 ? (
        <ul className="cl-said" style={{ marginTop: 10, paddingLeft: 18 }} data-testid="menu-plan-returned">
          {returned.map((l) => (
            <li key={`r-${l.menuItemId}`}>
              {l.name} comes back with this menu and its lock still holds
              {l.house?.wineName ? ` (the house's ${l.house.wineName}${l.house.vintage ? ` ${l.house.vintage}` : ''})` : ''}.
            </li>
          ))}
          {mismatched.map((l) => (
            <li key={`v-${l.menuItemId}`} role="note">
              Check this one: the menu reads {l.name}
              {l.vintage ? ` ${l.vintage}` : ''}, and the locked wine it is linked to is the {l.house?.vintage ?? 'unknown'} vintage.
            </li>
          ))}
        </ul>
      ) : null}

      {plan.lines.length > 0 ? (
        <details style={{ marginTop: 12 }} data-testid="menu-plan-every-line">
          <summary className="cl-said cl-focus" style={{ cursor: 'pointer' }}>
            Every line on this menu ({plan.lines.length})
          </summary>
          <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 8 }}>
            <table className="cl-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Wine</th>
                  <th>Bottle</th>
                  <th>Glass</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((l) => (
                  <tr key={`all-${l.menuItemId}`} data-testid="menu-plan-line">
                    <td>
                      {l.name}
                      {l.vintage ? ` ${l.vintage}` : ''}
                    </td>
                    <td className="cl-dim">{kindWords(l, l.bottle)}</td>
                    <td className="cl-dim">{kindWords(l, l.glass)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {plan.dormantLocks.length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-dormant">
          <p className="cl-said">Locked, and not on this menu. They stay locked and unchanged:</p>
          <ul className="cl-said" style={{ paddingLeft: 18, marginTop: 4 }}>
            {plan.dormantLocks.map((d) => (
              <li key={d.lockId}>
                {d.wineName ?? 'A wine'} ({d.kind}) at {money(d.lockedPrice)}
                {d.active === false ? ', removed from inventory' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {said ? (
        <p role="status" className="cl-said" style={{ marginTop: 8 }}>
          {said}
        </p>
      ) : null}

      {canManage && !plan.current && move ? (
        <p className="cl-standing" style={{ marginTop: 12 }} data-testid="menu-plan-change-summary">
          {plural(move.moved, 'price moves', 'prices move')}.{' '}
          {move.name
            ? `The largest is ${move.name}, ${move.kind}: ${money(move.from)} to ${money(move.to)}, ${money(Math.abs(move.to - move.from))} ${move.to >= move.from ? 'more' : 'less'}. `
            : ''}
          {move.kept > 0 ? `${plural(move.kept, 'locked price stays', 'locked prices stay')} as ${move.kept === 1 ? 'it is' : 'they are'}.` : 'No locked price is in the way.'}
        </p>
      ) : null}

      <div className="cl-row-controls" style={{ marginTop: 14 }}>
        {canManage && (!plan.current || toCarry(plan) > 0) ? (
          <button
            type="button"
            className="cl-btn cl-ink cl-focus"
            disabled={choose.isPending}
            onClick={() => choose.mutate(plan.fingerprint)}
          >
            {plan.current
              ? choose.isPending ? 'Carrying…' : `Finish carrying ${plural(toCarry(plan), 'price', 'prices')}`
              : choose.isPending ? 'Making it current…' : 'Make it current'}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className="cl-btn cl-focus" onClick={onCancel} disabled={choose.isPending}>
            Not now
          </button>
        ) : null}
      </div>
      {!canManage ? (
        <p className="cl-note">An owner or a manager chooses the current menu. Every price here is read at this house only.</p>
      ) : (
        <p className="cl-note">A lock holds a price at this house only.</p>
      )}
      {choose.isError && !moved ? (
        <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
          {(() => {
            // The gateway's own sentence may already say nothing was changed.
            if (noAnswer(choose.error))
              return 'Mudavym did not answer in time, so the menu may now be current. Look at the menu again before choosing it a second time.';
            const why = reasonOf(choose.error).trim().replace(/\.+$/, '');
            return `It was not made current: ${why}.${/nothing (was|has) changed$/i.test(why) ? '' : ' Nothing has changed.'}`;
          })()}
        </p>
      ) : null}
    </section>
  );
}

export default MenuPlan;
