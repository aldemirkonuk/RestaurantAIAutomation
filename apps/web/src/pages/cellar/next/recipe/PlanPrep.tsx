/**
 * Plan prep on /cocktails (r109 drinks-g3), any role: serves per drink in, pull list and batches out
 * (prepPlan.ts). No money, no on-hand stock. The house Sheet carries the motion (ADR 0112); paper
 * under html[data-print-prep]. An editor gets a link into a drink to link a line naming no good.
 */
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { useAuth } from '../../../../contexts/AuthContext';
import { dishesApi, type CardComponent, type DrinkCard } from '../../../../services/api/recipes';
import { useCanEditRecipe } from './useRecipe';
import { useHouseDate, useHouseZone } from './useHouseDate';
import { useSortFlip } from '../useSortFlip';
import {
  SERVES_SAID, houseDay, keepPlan, localDay, makeWords, planKey, planPrep, pullWords, readPlan, readServes, rowIds, type PrepPlan,
} from './prepPlan';

const FLAG = 'data-print-prep';
export const PREP_UNREAD = 'The recipes could not be read just now, so no prep is planned rather than a shorter list.';

type ListRefs = { pull: RefObject<HTMLUListElement>; make: RefObject<HTMLUListElement>; notLinked: RefObject<HTMLUListElement> };

function PlanSaid({ plan, canEdit, refs }: { plan: PrepPlan; canEdit: boolean; refs?: ListRefs }) {
  const ids = rowIds(plan);
  if (plan.planned === 0) return <p className="cl-note">Type the serves you expect, and the pull list appears here.</p>;
  return (
    <>
      <h3 className="cl-sec">Pull from the shelf</h3>
      {plan.pull.length ? (
        <ul className="cl-prep-list" data-testid="prep-pull" ref={refs?.pull}>
          {plan.pull.map((r, i) => (
            <li key={ids.pull[i]} data-row={ids.pull[i]}>
              <b className="cl-num">{pullWords(r.base, r.baseUnit)}</b> {r.name} <span className="cl-dim">· {r.drinks.join(', ')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cl-note">Nothing linked to the shelf.</p>
      )}
      {plan.make.length ? (
        <>
          <h3 className="cl-sec">Make in the house</h3>
          <ul className="cl-prep-list" data-testid="prep-make" ref={refs?.make}>
            {plan.make.map((m, i) => (
              <li key={ids.make[i]} data-row={ids.make[i]}>
                {makeWords(m)} <span className="cl-dim">· {m.drinks.join(', ')}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {plan.notLinked.length ? (
        <ul className="cl-prep-list" data-testid="prep-not-linked" ref={refs?.notLinked}>
          {plan.notLinked.map((r, i) => (
            <li key={ids.notLinked[i]} data-row={ids.notLinked[i]}>
              {`not linked: ${r.label} (${r.drinks.join(', ')})`}
              {canEdit ? (
                <>
                  {' '}
                  <Link className="cl-linkish cl-focus" to={`/cocktails?open=${encodeURIComponent(r.firstDrinkId)}`}>
                    Link it
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.notCounted.length ? (
        <p className="cl-note" data-testid="prep-not-counted">
          {`Not counted: ${plan.notCounted.map((r) => `${r.label} (${r.drinks.join(', ')})`).join('; ')}.`}
        </p>
      ) : null}
    </>
  );
}

const servesOf = (texts: Record<string, string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(texts)) {
    const n = readServes(t);
    if (n != null) out[k] = n;
  }
  return out;
};

export default function PlanPrep() {
  const id = useId();
  const { activeRestaurantId } = useAuth();
  const canEdit = useCanEditRecipe();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<{ drinks: DrinkCard[]; components: CardComponent[] } | 'reading' | 'unread' | null>(null);
  // The day is the house's (its zone and its date form), not this browser's: 23:30 UTC is already tomorrow in an Istanbul house.
  const zone = useHouseZone();
  const sayDate = useHouseDate();
  const key = planKey(activeRestaurantId, houseDay(zone));
  const browserKey = planKey(activeRestaurantId, localDay());
  const [texts, setTexts] = useState<Record<string, string>>(() => readPlan(key, browserKey));
  const [printing, setPrinting] = useState(false);
  // One number per ask: an answer counts only if it is still the latest ask for the house still open. The component does not
  // remount on a house switch, so a slow read for the house left behind would otherwise land on the house now open.
  const ask = useRef(0);
  useEffect(() => {
    ask.current += 1;
    setRead(null);
  }, [activeRestaurantId]);

  useEffect(() => () => document.documentElement.removeAttribute(FLAG), []);
  useEffect(() => {
    if (!printing) return;
    const root = document.documentElement;
    root.setAttribute(FLAG, '');
    const done = () => {
      root.removeAttribute(FLAG);
      setPrinting(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing]);

  const start = async () => {
    setOpen(true);
    setTexts(readPlan(key, browserKey));
    if (!activeRestaurantId) return;
    setRead('reading');
    const mine = ++ask.current;
    try {
      const got = await dishesApi.prepCards(activeRestaurantId);
      if (mine === ask.current) setRead(got);
    } catch {
      if (mine === ask.current) setRead('unread');
    }
  };

  const drinks = useMemo(() => (read && typeof read === 'object' ? [...read.drinks].sort((a, b) => a.name.localeCompare(b.name)) : []), [read]);
  const serves = useMemo(() => servesOf(texts), [texts]);
  const plan = read && typeof read === 'object' ? planPrep(read.drinks, read.components, serves) : null;
  // The lists move when a typed serve inserts or drops a row (the id order changes), never when only a figure does (ADR 0112).
  const lists: ListRefs = { pull: useRef<HTMLUListElement>(null), make: useRef<HTMLUListElement>(null), notLinked: useRef<HTMLUListElement>(null) };
  const order = plan ? rowIds(plan) : { pull: [], make: [], notLinked: [] };
  const FLIP = { selector: 'li[data-row]', enter: true } as const;
  const flips = {
    pull: useSortFlip(lists.pull, order.pull.join('\n'), FLIP),
    make: useSortFlip(lists.make, order.make.join('\n'), FLIP),
    notLinked: useSortFlip(lists.notLinked, order.notLinked.join('\n'), FLIP),
  };
  const type = (cid: string, t: string) => {
    const next = { ...texts, [cid]: t };
    if (read && typeof read === 'object') {
      const after = rowIds(planPrep(read.drinks, read.components, servesOf(next)));
      for (const k of ['pull', 'make', 'notLinked'] as const) if (after[k].join('\n') !== order[k].join('\n')) flips[k].before();
    }
    setTexts(next);
    keepPlan(key, next);
  };

  return (
    <>
      <button type="button" className="cl-btn cl-focus" onClick={start} disabled={!activeRestaurantId} data-testid="prep-open">
        <ClipboardList size={13} aria-hidden />
        Plan prep
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        label="Plan prep"
        eyebrow="Today's prep"
        title="Plan prep"
        footer={
          plan && plan.planned > 0 ? (
            <button type="button" className="cl-btn cl-focus" onClick={() => setPrinting(true)} data-testid="prep-print">
              <Printer size={13} aria-hidden />
              Print the prep list
            </button>
          ) : undefined
        }
      >
        {read === 'reading' ? <p className="cl-note" role="status">Reading the recipes…</p> : null}
        {read === 'unread' ? <p className="cl-note" role="alert" data-testid="prep-unread">{PREP_UNREAD}</p> : null}
        {read && typeof read === 'object' ? (
          read.drinks.length === 0 ? (
            <p className="cl-note">No drink has a saved recipe yet, so there is nothing to plan.</p>
          ) : (
            <div className="cl-prep" data-testid="prep-sheet">
              <ol className="cl-prep-drinks">
                {drinks.map((d) => {
                  const t = texts[d.cocktailId] ?? '';
                  const bad = readServes(t) == null;
                  return (
                    <li key={d.cocktailId}>
                      <label htmlFor={`${id}-${d.cocktailId}`}>{d.name}</label>
                      <input
                        id={`${id}-${d.cocktailId}`}
                        className="cl-field cl-focus cl-num cl-prep-in"
                        inputMode="numeric"
                        placeholder="0"
                        value={t}
                        aria-invalid={bad}
                        onChange={(e) => type(d.cocktailId, e.target.value)}
                      />
                      <span className="cl-dim">{bad ? SERVES_SAID : 'serves'}</span>
                    </li>
                  );
                })}
              </ol>
              {plan ? <PlanSaid plan={plan} canEdit={canEdit} refs={lists} /> : null}
            </div>
          )
        ) : null}
      </Sheet>
      {printing && plan
        ? createPortal(
            <div className="cl-print-prep" data-testid="prep-paper" aria-hidden="true">
              <h1>Prep list, {sayDate(new Date().toISOString()) ?? houseDay(zone)}</h1>
              <ul>
                {drinks.filter((d) => (serves[d.cocktailId] ?? 0) > 0).map((d) => (
                  <li key={d.cocktailId}>{`${serves[d.cocktailId]} ${d.name}`}</li>
                ))}
              </ul>
              <PlanSaid plan={plan} canEdit={false} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
