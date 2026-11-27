/**
 * Plan prep on /cocktails (r109 drinks-g3), any role: serves per drink in, pull list and batches out
 * (prepPlan.ts). No money, no on-hand stock. The house Sheet carries the motion (ADR 0112); paper
 * under html[data-print-prep]. An editor gets a link into a drink to link a line naming no good.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { useAuth } from '../../../../contexts/AuthContext';
import { dishesApi, type CardComponent, type DrinkCard } from '../../../../services/api/recipes';
import { useCanEditRecipe } from './useRecipe';
import {
  SERVES_SAID, keepPlan, localDay, makeWords, planKey, planPrep, planWas, pullWords, readServes, type PrepPlan,
} from './prepPlan';

const FLAG = 'data-print-prep';
export const PREP_UNREAD = 'The recipes could not be read just now, so no prep is planned rather than a shorter list.';

function PlanSaid({ plan, canEdit }: { plan: PrepPlan; canEdit: boolean }) {
  if (plan.planned === 0) return <p className="cl-note">Type the serves you expect, and the pull list appears here.</p>;
  return (
    <>
      <h3 className="cl-sec">Pull from the shelf</h3>
      {plan.pull.length ? (
        <ul className="cl-prep-list" data-testid="prep-pull">
          {plan.pull.map((r) => (
            <li key={`${r.inventoryId}|${r.baseUnit}`}>
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
          <ul className="cl-prep-list" data-testid="prep-make">
            {plan.make.map((m) => (
              <li key={`${m.componentId}|${m.baseUnit}`}>
                {makeWords(m)} <span className="cl-dim">· {m.drinks.join(', ')}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {plan.notLinked.length ? (
        <ul className="cl-prep-list" data-testid="prep-not-linked">
          {plan.notLinked.map((r) => (
            <li key={r.label}>
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

export default function PlanPrep() {
  const id = useId();
  const { activeRestaurantId } = useAuth();
  const canEdit = useCanEditRecipe();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<{ drinks: DrinkCard[]; components: CardComponent[] } | 'reading' | 'unread' | null>(null);
  const key = planKey(activeRestaurantId, localDay());
  const [texts, setTexts] = useState<Record<string, string>>(() => planWas(key));
  const [printing, setPrinting] = useState(false);

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
    setTexts(planWas(key));
    if (!activeRestaurantId) return;
    setRead('reading');
    try {
      setRead(await dishesApi.prepCards(activeRestaurantId));
    } catch {
      setRead('unread');
    }
  };

  const drinks = useMemo(() => (read && typeof read === 'object' ? [...read.drinks].sort((a, b) => a.name.localeCompare(b.name)) : []), [read]);
  const serves = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, t] of Object.entries(texts)) {
      const n = readServes(t);
      if (n != null) out[k] = n;
    }
    return out;
  }, [texts]);
  const plan = read && typeof read === 'object' ? planPrep(read.drinks, read.components, serves) : null;
  const type = (cid: string, t: string) => {
    const next = { ...texts, [cid]: t };
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
              {plan ? <PlanSaid plan={plan} canEdit={canEdit} /> : null}
            </div>
          )
        ) : null}
      </Sheet>
      {printing && plan
        ? createPortal(
            <div className="cl-print-prep" data-testid="prep-paper" aria-hidden="true">
              <h1>Prep list, {localDay()}</h1>
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
