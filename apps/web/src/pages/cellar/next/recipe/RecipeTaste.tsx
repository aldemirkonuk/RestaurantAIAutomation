/**
 * "How it tastes" on a recipe sheet (founder ask 2026-11-19: dishes and
 * cocktails show their taste profile, like a good does in the drawer).
 *
 * Two parts that read the same query, so they never disagree and the drink is
 * read once:
 *  - `RecipeTasteLine`: the one-line summary at the top of the sheet, said in
 *    words with its provenance marks; one tap goes to the card.
 *  - `RecipeTaste`: the card (the inventory drawer's TasteCard, read-only here)
 *    and the one action: "Work it out" when no recipe layer exists yet, "Read
 *    again" once one does. It asks the gateway to work the taste out of the
 *    SAVED recipe (POST /taste/:rid/:kind/:id/rollup); what it keeps is
 *    labelled "worked out from the recipe".
 *
 * What it keeps to:
 * - nothing shown as known unless a read said so; a failed read says it failed
 *   (ADR 0020); no number from the 0..10 scale and no confidence figure
 *   (ADR 0104);
 * - an action that fails says why in words and the taste stays as it was:
 *   no recipe written, recipes unavailable (503), gateway unreachable;
 * - the roll-up reads the saved recipe, so with unsaved typed lines the sheet
 *   says which recipe it worked from.
 * The same component serves a dish (`kind="dish"`); a dish's recipe sheet
 * mounts it where the dishes stack lands.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCanEditRecipe } from './useRecipe';
import TasteCard, { Glyph } from '../../../inventory/next/TasteCard';
import { PROV_MARK, leadLine } from '../../../inventory/next/taste-words';
import { getTaste, rollupTaste, tasteKeys, ROLLUP_ABSENT, type ProvKind, type TasteRead } from '../../../../services/api/taste';

export const RECIPE_TASTE_EMPTY = 'Not worked out yet. It is worked out from the saved recipe.';
export const RECIPE_TASTE_LINE_FAILED = 'How it tastes could not be read just now.';
export const RECIPE_TASTE_UNSAVED = 'Worked out from the saved recipe, not the lines you have typed since.';
export const RECIPE_TASTE_NO_RECIPE = 'Save a recipe with lines, then its taste can be worked out from it.';
export const RECIPE_TASTE_EMPTY_READ = 'Not worked out yet. A manager works it out from the saved recipe.';
export const RECIPE_TASTE_NO_RECIPE_READ = 'No recipe yet, so there is nothing to work a taste out from.';
const CARD_ID = 'recipe-taste-card';
/**
 * The height the taste reserves from the first paint, so what is below it does
 * not move when the read lands (r85 walk: CLS 0.064 at 1440 on a ?open= deep
 * link). A worked-out card is about 450px tall at desktop width, its top line
 * one line. A drink with nothing to show gives the space back once the read
 * says so.
 */
export const TASTE_CARD_RESERVE_PX = 450;
export const TASTE_LINE_RESERVE_PX = 30;

type Kind = 'cocktail' | 'dish';

interface Props {
  kind: Kind;
  subjectId: string;
  restaurantId: string | null;
}

function useTaste({ kind, subjectId, restaurantId }: Props) {
  return useQuery<TasteRead>({
    queryKey: tasteKeys.subject(restaurantId ?? '', kind, subjectId),
    queryFn: () => getTaste(kind, subjectId, restaurantId ?? undefined),
    enabled: restaurantId !== null && subjectId !== '',
    staleTime: 30_000,
    retry: false,
  });
}

export function RecipeTasteLine(props: Props) {
  const q = useTaste(props);
  let sentence: string | null = null;
  let kinds: ProvKind[] = [];
  const failed = q.isError || q.data?.state === 'failed';
  if (q.isLoading) {
    return <p className="tc-line tc-line--foot cl-rcp-taste-line" data-testid="recipe-taste-line-wait" aria-hidden style={{ minHeight: TASTE_LINE_RESERVE_PX }} />;
  }
  if (!failed && q.data?.state === 'ready') {
    const line = leadLine(q.data.data);
    if (line) ({ sentence, kinds } = line);
  }
  if (!failed && sentence === null) return null;
  const said = failed ? RECIPE_TASTE_LINE_FAILED : (sentence as string);
  return (
    <p className="tc-line tc-line--foot cl-rcp-taste-line" data-testid="recipe-taste-line" data-state={failed ? 'failed' : 'ready'}>
      <span className="tc-line-k">How it tastes</span>
      <button
        type="button"
        className="iv-linkish iv-focus tc-line-btn"
        data-testid="recipe-taste-line-open"
        onClick={() => document.getElementById(CARD_ID)?.scrollIntoView?.({ block: 'start' })}
      >
        <span>{said}</span>
        {kinds.length ? (
          <span className="tc-marks" role="img" aria-label={`Where it came from: ${kinds.map((k) => PROV_MARK[k].words).join(', ')}`} data-testid="recipe-taste-line-marks">
            {[...new Set(kinds.map((k) => PROV_MARK[k].shape))].map((s) => (
              <span key={s} className="tc-mark" data-shape={s}>
                <Glyph shape={s} />
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </p>
  );
}

export default function RecipeTaste(props: Props & { /** The saved recipe has at least one line. */ hasRecipe: boolean; /** Lines are typed on the sheet and not saved. */ unsaved: boolean }) {
  const { kind, subjectId, restaurantId, hasRecipe, unsaved } = props;
  const qc = useQueryClient();
  const q = useTaste(props);
  // The sheet is read-only to staff; the recipe layer is written by who writes the recipe.
  const canWrite = useCanEditRecipe();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const readable = q.data?.state === 'ready';
  const worked = q.data?.state === 'ready' && q.data.data.layers.some((l) => l.source === 'recipe');

  const run = async () => {
    setBusy(true);
    setSaid(null);
    const r = await rollupTaste(kind, subjectId, restaurantId ?? undefined);
    setBusy(false);
    if (r.state === 'ready') {
      qc.setQueryData<TasteRead>(tasteKeys.subject(restaurantId ?? '', kind, subjectId), { state: 'ready', data: r.data });
      void qc.invalidateQueries({ queryKey: tasteKeys.subject(restaurantId ?? '', kind, subjectId) });
    } else setSaid(r.state === 'absent' ? ROLLUP_ABSENT : r.sentence);
  };

  return (
    <section
      id={CARD_ID}
      className="cl-rcp-taste"
      data-testid="recipe-taste"
      data-state={q.isLoading ? 'loading' : 'settled'}
      aria-label="How it tastes"
      style={q.isLoading ? { minHeight: TASTE_CARD_RESERVE_PX } : undefined}
    >
      <h4 className="cl-sec" style={{ margin: 0 }}>How it tastes</h4>
      <TasteCard row={{ id: subjectId }} restaurantId={restaurantId} subject={kind} describe={false} emptyWords={canWrite ? RECIPE_TASTE_EMPTY : RECIPE_TASTE_EMPTY_READ} />
      {readable ? (
        !hasRecipe ? (
          <p className="cl-note" data-testid="recipe-taste-norecipe">{canWrite ? RECIPE_TASTE_NO_RECIPE : RECIPE_TASTE_NO_RECIPE_READ}</p>
        ) : canWrite ? (
          <p className="cl-rcp-taste-acts">
            <button type="button" className="cl-btn cl-focus" data-testid="recipe-taste-act" disabled={busy} onClick={() => void run()}>
              {busy ? (worked ? 'Reading again…' : 'Working it out…') : worked ? 'Read again' : 'Work it out'}
            </button>
          </p>
        ) : null
      ) : null}
      {readable && hasRecipe && unsaved ? (
        <p className="cl-note" data-testid="recipe-taste-unsaved">{RECIPE_TASTE_UNSAVED}</p>
      ) : null}
      {said ? (
        <p className="cl-note" role="alert" data-testid="recipe-taste-said">{said}</p>
      ) : null}
    </section>
  );
}
