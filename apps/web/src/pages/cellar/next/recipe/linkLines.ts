/**
 * Linking the drinks' loose lines (r108 drinks-g9): a counted line that names
 * no shelf good is linked through the drink's own save, the existing PUT with
 * `expectedVersionId`, one drink at a time. There is no second write path.
 *
 * THE INVARIANT. A link changes only `inventoryId`, and only on the lines it
 * names. Every other field of the version, and every other line, is sent back
 * exactly as the gateway read it, so the new version equals the old one but
 * for the link.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { getErrorStatus } from '../../../../services/api/client';
import { recipesApi, type LooseDrink, type SaveRecipeBody } from '../../../../services/api/recipes';

export const looseLinesKey = (rid: string | null | undefined) => ['recipes', rid ?? null, 'loose-lines'] as const;

/** Owners and managers only: the route refuses staff, so staff never ask. */
export function useLooseLines(enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  return useQuery({
    queryKey: looseLinesKey(activeRestaurantId),
    queryFn: () => recipesApi.looseLines(activeRestaurantId as string),
    enabled: enabled && Boolean(activeRestaurantId),
    retry: false,
  });
}

/** The PUT body that links `indices` of a drink's lines to a good: the version read, with only those `inventoryId`s changed. */
export function linkBody(drink: LooseDrink, indices: number[], inventoryId: string): SaveRecipeBody {
  const at = new Set(indices);
  return {
    expectedVersionId: drink.versionId,
    yieldServes: drink.yieldServes,
    method: drink.method,
    glass: drink.glass,
    garnish: drink.garnish,
    lines: drink.lines.map((l, i) => ({ ...l, inventoryId: at.has(i) ? inventoryId : l.inventoryId })),
  };
}

export type LinkOutcome = { cocktailId: string; name: string; ok: boolean; said: string };

/** One drink's save, said in a sentence: saved, someone saved first (409), or the gateway's own refusal. */
export function linkOutcome(drink: LooseDrink, error: unknown, done = 'linked', act = 'link this line'): LinkOutcome {
  const base = { cocktailId: drink.cocktailId, name: drink.name };
  if (error === null) return { ...base, ok: true, said: `${drink.name}: saved, ${done}.` };
  const status = getErrorStatus(error);
  if (status === 409) return { ...base, ok: false, said: `Someone saved ${drink.name} first; open it to ${act}.` };
  const m = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  const theirs = typeof m === 'string' && m.trim() ? m.trim() : Array.isArray(m) ? m.join(' ') : null;
  if (theirs) return { ...base, ok: false, said: `${drink.name}: not saved. ${theirs}` };
  if (status === null && (error as { request?: unknown })?.request) {
    return { ...base, ok: false, said: `${drink.name}: no answer came back, so whether it saved is not known. Open it to see.` };
  }
  return { ...base, ok: false, said: `${drink.name}: not saved. Its recipe is as it was.` };
}

/** Sends each drink's body, one after another, and says each one's outcome; one refusal never stops the others. */
export async function saveEach(
  restaurantId: string,
  jobs: Array<{ drink: LooseDrink; body: SaveRecipeBody }>,
  done?: string,
  act?: string,
): Promise<LinkOutcome[]> {
  const out: LinkOutcome[] = [];
  for (const { drink, body } of jobs) {
    try {
      await recipesApi.save(restaurantId, drink.cocktailId, body);
      out.push(linkOutcome(drink, null, done, act));
    } catch (e) {
      out.push(linkOutcome(drink, e, done, act));
    }
  }
  return out;
}

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
