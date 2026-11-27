/**
 * The spec book (r108 drinks-g7): one print of every drink's recipe card, safe to hand to staff. The cards come
 * from ONE read (GET drinks/cards), the same for every role and with no money at all: a book is handed round, so
 * the owner's cost, price and margin are not in it either (the single card's "Include cost" is not offered).
 * The title block (house name, the day in the house's own date form, the count) sits on the FIRST drink's page, so
 * no sheet is spent on a cover; the drinks go by section and then name, one card per page. Drawn in a portal and shown only on paper while `html[data-print-book]` is set
 * (cellar-next.css); a failed read says so and prints nothing, never a shorter book (ADR 0020). No animation.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../../../../contexts/AuthContext';
import { dishesApi, type DrinkCard, type CocktailRecipe } from '../../../../services/api/recipes';
import { cardAllergens } from './RecipeCard';
import { scaledAmount } from './recipeScale';
import { useHouseDate } from './useHouseDate';

const FLAG = 'data-print-book';
export const BOOK_UNREAD = 'The spec book could not be read just now. Nothing was printed.';
export const BOOK_EMPTY = 'No drink has a saved recipe yet, so there is no book to print.';
const NO_SECTION = 'Other drinks';

/** Sections by name with the unsectioned drinks last, and the drinks of a section by name. */
export function bookOrder(cards: DrinkCard[]): Array<{ section: string; cards: DrinkCard[] }> {
  const bySection = new Map<string, DrinkCard[]>();
  for (const c of cards) {
    const key = c.section?.trim() || NO_SECTION;
    bySection.set(key, [...(bySection.get(key) ?? []), c]);
  }
  return [...bySection.entries()]
    .sort(([a], [b]) => (a === NO_SECTION ? 1 : b === NO_SECTION ? -1 : a.localeCompare(b)))
    .map(([section, list]) => ({ section, cards: [...list].sort((x, y) => x.name.localeCompare(y.name)) }));
}

/** The card's allergen sentence is the single card's own: the list's row shape is read as the sheet's. */
const allergenWords = (a: DrinkCard['allergens']) =>
  cardAllergens(a.readable ? ({ readable: true, allergens: a.status, allergensUnstatedBy: a.unstatedBy } as unknown as CocktailRecipe['whatIsIn']) : { readable: false, sentence: '' });

export default function RecipeBook() {
  const { activeRestaurantId, availableRestaurants } = useAuth();
  const sayDate = useHouseDate();
  const [reading, setReading] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [book, setBook] = useState<DrinkCard[] | null>(null);

  // The flag is only ever on while the book is the thing being printed.
  useEffect(() => () => document.documentElement.removeAttribute(FLAG), []);

  // Printing runs after the cards are in the document, so the paper has them.
  useEffect(() => {
    if (!book) return;
    const root = document.documentElement;
    root.setAttribute(FLAG, '');
    const done = () => {
      root.removeAttribute(FLAG);
      setBook(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [book]);

  const read = async () => {
    if (!activeRestaurantId) return;
    setReading(true);
    setSaid(null);
    try {
      const cards = await dishesApi.drinkCards(activeRestaurantId);
      if (cards.length === 0) setSaid(BOOK_EMPTY);
      else setBook(cards);
    } catch {
      setSaid(BOOK_UNREAD);
    } finally {
      setReading(false);
    }
  };

  const houseName = availableRestaurants?.find((r) => r.id === activeRestaurantId)?.name ?? null;
  const today = sayDate(new Date().toISOString());

  return (
    <>
      <button type="button" className="cl-btn cl-focus" onClick={read} disabled={reading || !activeRestaurantId} data-testid="book-print-button">
        <BookOpen size={13} aria-hidden />
        Print the spec book
      </button>
      {said ? (
        <span className="cl-note" role="alert" data-testid="book-said" style={{ margin: 0 }}>
          {said}
        </span>
      ) : null}
      {book
        ? createPortal(
            <div className="cl-print-book" data-testid="recipe-book" aria-hidden="true">
              {bookOrder(book)
                .flatMap((s) => s.cards.map((c) => ({ s, c })))
                .map(({ s, c }, n) => (
                  <section key={c.cocktailId} className="cl-book-page" data-testid="book-card" data-section={s.section}>
                    {n === 0 ? (
                      <header data-testid="book-title">
                        <h1>{houseName ? `${houseName}: spec book` : 'Spec book'}</h1>
                        <p>
                          {today ? `${today} · ` : ''}
                          {book.length} {book.length === 1 ? 'drink' : 'drinks'}
                        </p>
                      </header>
                    ) : null}
                    <p>{s.section}</p>
                    <h2>{c.name}</h2>
                    <p>
                      Makes {c.yieldServes} {c.yieldServes === 1 ? 'serve' : 'serves'}
                      {c.glass ? ` · ${c.glass}` : ''}
                      {` · version ${c.version}${c.versionDate && sayDate(c.versionDate) ? `, ${sayDate(c.versionDate)}` : ''}`}
                    </p>
                    <ol>
                      {c.lines.map((l, i) => (
                        <li key={i}>
                          <b>{scaledAmount(l.qty, 1, l.unit)}</b> {l.name ?? l.label}
                        </li>
                      ))}
                    </ol>
                    {c.method ? <p className="cl-print-method">{c.method}</p> : null}
                    {c.garnish ? <p>Garnish: {c.garnish}</p> : null}
                    <p>{allergenWords(c.allergens)}</p>
                  </section>
                ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
