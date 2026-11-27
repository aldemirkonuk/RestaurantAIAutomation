/**
 * Learn the specs on /cocktails (r110 drinks-g4), any role: the house's own cards, one at a time. The face says the name,
 * the glass and the method word; Space shows the spec (lines, garnish, method); 1 is "Knew it", 2 is "Not yet" (learnBoxes.ts).
 * Reads GET drinks/cards (no money at all). Progress is kept in this browser only. The house Sheet carries the panel motion
 * (no exit animation, ADR 0112); the reveal and the next face fade in a little, and under reduced motion nothing animates.
 * The room under the face is held at the tallest card's height, measured on read, so the buttons never move.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { useAuth } from '../../../../contexts/AuthContext';
import { useReducedMotion } from '../../../../lib/mudavym/motion';
import { dishesApi, type DrinkCard } from '../../../../services/api/recipes';
import { scaledAmount } from './recipeScale';
import { afterAnswer, dealOrder, endWords, keepBoxes, methodWord, progressKey, readBoxes, type Boxes } from './learnBoxes';

export const LEARN_UNREAD = 'The specs could not be read just now, so there is nothing to learn from.';
export const LEARN_EMPTY = 'No drink has a saved recipe yet, so there is nothing to learn.';

function Spec({ c }: { c: DrinkCard }) {
  return (
    <>
      <ol className="cl-learn-lines">
        {c.lines.map((l, i) => (
          <li key={i}>
            <b className="cl-num">{scaledAmount(l.qty, 1, l.unit)}</b> {l.name ?? l.label}
          </li>
        ))}
      </ol>
      {c.garnish ? <p className="cl-learn-line">Garnish: {c.garnish}</p> : null}
      {c.method ? <p className="cl-learn-line cl-learn-method">{c.method}</p> : null}
    </>
  );
}

/** The card most likely to stand tallest: the most lines, then the longest method. */
const tallest = (cards: DrinkCard[]): DrinkCard | null =>
  cards.reduce<DrinkCard | null>((best, c) => {
    const size = (x: DrinkCard) => x.lines.length * 3 + Math.ceil((x.method?.length ?? 0) / 40) + (x.garnish ? 1 : 0);
    return !best || size(c) > size(best) ? c : best;
  }, null);

export default function LearnSpecs() {
  const { activeRestaurantId, user } = useAuth();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<DrinkCard[] | 'reading' | 'unread' | null>(null);
  const [deck, setDeck] = useState<DrinkCard[]>([]);
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState(false);
  const [knew, setKnew] = useState(0);
  const [room, setRoom] = useState<number | null>(null);
  const boxes = useRef<Boxes>({});
  const ask = useRef(0);
  const probe = useRef<HTMLDivElement>(null);
  const personId = user?.userId ?? null;
  const key = activeRestaurantId && personId ? progressKey(activeRestaurantId, personId) : null;

  useEffect(() => {
    ask.current += 1;
    setRead(null);
  }, [activeRestaurantId]);

  const deal = (cards: DrinkCard[]) => {
    boxes.current = key ? readBoxes(key) : {};
    setDeck(dealOrder(cards, boxes.current));
    setAt(0);
    setShown(false);
    setKnew(0);
  };

  const start = async () => {
    setOpen(true);
    if (!activeRestaurantId) return;
    setRead('reading');
    const mine = ++ask.current;
    try {
      const cards = await dishesApi.drinkCards(activeRestaurantId);
      if (mine !== ask.current) return;
      setRead(cards);
      deal(cards);
    } catch {
      if (mine === ask.current) setRead('unread');
    }
  };

  const cards = Array.isArray(read) ? read : null;
  const done = deck.length > 0 && at >= deck.length;
  const card = deck[at] ?? null;
  const tall = useMemo(() => (cards ? tallest(cards) : null), [cards]);

  // Measured once the cards are read: the buttons below never move when a spec is shown.
  useLayoutEffect(() => {
    if (tall && probe.current) setRoom(probe.current.offsetHeight || null);
    else setRoom(null);
  }, [tall]);

  const answer = (didKnow: boolean) => {
    if (!card || !shown) return;
    boxes.current = { ...boxes.current, [card.cocktailId]: afterAnswer(boxes.current[card.cocktailId], didKnow) };
    if (key) keepBoxes(key, boxes.current);
    if (didKnow) setKnew((n) => n + 1);
    setAt((n) => n + 1);
    setShown(false);
  };

  useEffect(() => {
    if (!open || !card) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      if (e.key === ' ') {
        e.preventDefault();
        setShown(true);
      } else if (e.key === '1') answer(true);
      else if (e.key === '2') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const word = card ? methodWord(card.method) : null;

  return (
    <>
      <button type="button" className="cl-btn cl-focus" onClick={start} disabled={!activeRestaurantId} data-testid="learn-open">
        <GraduationCap size={13} aria-hidden />
        Learn the specs
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Learn the specs" eyebrow="The house's own cards" title="Learn the specs">
        {read === 'reading' ? <p className="cl-note" role="status">Reading the specs…</p> : null}
        {read === 'unread' ? <p className="cl-note" role="alert" data-testid="learn-unread">{LEARN_UNREAD}</p> : null}
        {cards && cards.length === 0 ? <p className="cl-note" data-testid="learn-empty">{LEARN_EMPTY}</p> : null}
        {cards && cards.length > 0 ? (
          <div className="cl-learn" data-testid="learn-sheet">
            {tall ? (
              <div className="cl-learn-probe" ref={probe} aria-hidden="true">
                <Spec c={tall} />
              </div>
            ) : null}
            {done ? (
              <>
                <p className="cl-note" role="status" data-testid="learn-end">{endWords(knew, deck.length)}</p>
                <button type="button" className="cl-btn cl-focus" onClick={() => deal(cards)}>Go round again</button>
              </>
            ) : card ? (
              <>
                <p className="cl-dim cl-num" data-testid="learn-count">{at + 1} of {deck.length}</p>
                <div key={card.cocktailId} className={reduced ? 'cl-learn-face' : 'cl-learn-face cl-learn-face--in'} data-testid="learn-face">
                  <h3>{card.name}</h3>
                  <p className="cl-dim">{[card.glass, word].filter(Boolean).join(' · ') || ' '}</p>
                </div>
                <div className="cl-learn-room" style={room ? { minHeight: room } : undefined} data-testid="learn-room">
                  {shown ? (
                    <div className={reduced ? undefined : 'cl-learn-reveal'} data-testid="learn-spec">
                      <Spec c={card} />
                    </div>
                  ) : null}
                </div>
                <div className="cl-learn-actions">
                  {shown ? (
                    <>
                      <button type="button" className="cl-btn cl-focus" onClick={() => answer(true)}>Knew it <kbd>1</kbd></button>
                      <button type="button" className="cl-btn cl-focus" onClick={() => answer(false)}>Not yet <kbd>2</kbd></button>
                    </>
                  ) : (
                    <button type="button" className="cl-btn cl-focus" onClick={() => setShown(true)} data-testid="learn-show">Show the spec <kbd>Space</kbd></button>
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
