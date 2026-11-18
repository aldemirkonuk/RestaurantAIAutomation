/**
 * What was typed into an open dish's name, section and price and not saved yet,
 * kept for the session.
 *
 * The open dish's form is keyed by its dish, so opening another dish drops its
 * state; without this, a price typed for one dish was lost, with nothing said,
 * the moment another row was clicked. The recipe sheet below it already keeps
 * its own lines the same way (`../cellar/next/recipe/drafts.ts`). Memory only:
 * a shared tablet does not keep one person's typing on disk for the next, and
 * a draft is keyed by person, house and dish, so it returns only to the dish it
 * was typed for.
 */
export type DishDraft = { name: string; section: string; price: string };

const kept = new Map<string, DishDraft>();

export const dishDraftKey = (userId: string | null | undefined, rid: string | null | undefined, dishId: string) =>
  `${userId ?? ''}|${rid ?? ''}|${dishId}`;

export const takeDishDraft = (key: string): DishDraft | null => kept.get(key) ?? null;
export const keepDishDraft = (key: string, d: DishDraft) => void kept.set(key, d);
export const dropDishDraft = (key: string) => void kept.delete(key);

/** Every kept draft. Tests start from none. */
export const forgetDishDrafts = () => kept.clear();
