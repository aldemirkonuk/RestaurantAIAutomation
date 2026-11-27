/**
 * "Edit as a new draft" on /menu (r109 menu-g5). The current menu is copied
 * as it is into a new draft (POST /menu-versions/:menuId/draft), and the draft
 * opens in the same review a read menu opens in (MenuReviewScreen): lines are
 * added or corrected there with the existing routes, and Make current goes
 * through the existing plan. Left for later, the draft stays in Menus kept
 * for later. The current menu and the house's prices are not touched.
 *
 * Motion: none. The card appears in place and focus moves to its heading;
 * nothing slides or fades, under reduced motion or not (ADR 0112).
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  copyMenuIntoDraft,
  getKeptMenu,
  type MenuDraftCopy,
  type MenuImportResult,
  type MenuLine,
} from '../../../services/api/menus';
import { MenuReviewScreen } from '../../../components/onboarding/MenuReviewScreen';
import { houseMoment } from './menu-clock';

/** A kept draft's lines as the review reads them: the same shape a read menu answers. */
export function reviewResultOf(menuId: string, items: MenuLine[]): MenuImportResult {
  return {
    menuId,
    current: false,
    itemsExtracted: items.length,
    submissionsCreated: 0,
    items: items.map((l) => ({
      menuItemId: l.id,
      submissionId: null,
      name: l.name,
      producer: l.producer,
      category: l.category,
      vintage: l.vintage,
      region: l.region,
      grapeVariety: l.grape_variety,
      byGlassPrice: l.by_glass_price,
      bottlePrice: l.bottle_price,
      rawText: null,
      matched: !!(l.wine_library_id || l.inventory_item_id),
      needsReview: l.status !== 'approved',
      priceFlag: l.price_flag ?? null,
      priceFlagNote: l.price_flag_note ?? null,
    })),
  };
}

/** The draft card's sentence: when it was copied, and what it does not hold. */
export function copiedSentence(made: MenuDraftCopy): string {
  const at = houseMoment(made.copiedAt, made.timezone) ?? made.copiedAt;
  return `Copied from the current menu at ${at}; changes made to the current menu after that are not in this draft.`;
}

function refusalWords(err: unknown): string {
  const d = (err as { response?: { data?: { message?: unknown } } })?.response?.data;
  const said = d?.message;
  if (typeof said === 'string' && said) return said;
  if (Array.isArray(said) && typeof said[0] === 'string') return said[0];
  return `The draft was not made (${err instanceof Error ? err.message : 'no reason given'}).`;
}

export function MenuEditDraft({ menuId }: { menuId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [made, setMade] = useState<MenuDraftCopy | null>(null);
  const [result, setResult] = useState<MenuImportResult | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (made) heading.current?.focus();
  }, [made]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    setSaid(null);
    try {
      const copy = await copyMenuIntoDraft(menuId);
      setMade(copy);
      void queryClient.invalidateQueries({ queryKey: ['menu', 'versions'] });
      // The draft exists now; a failed read of its lines is said, and the draft stays kept.
      const kept = await getKeptMenu(copy.menuId);
      setResult(reviewResultOf(copy.menuId, kept.items ?? []));
    } catch (err) {
      setRefused(refusalWords(err));
    } finally {
      setBusy(false);
    }
  };

  const close = (words: string) => {
    setResult(null);
    setMade(null);
    setSaid(words);
  };

  return (
    <section style={{ marginTop: 12 }} data-testid="menu-edit-draft">
      {made ? null : (
        <button
          type="button"
          className="cl-btn cl-focus"
          style={{ minHeight: 44 }}
          disabled={busy}
          aria-busy={busy}
          onClick={start}
          data-testid="menu-edit-draft-start"
        >
          {busy ? 'Copying the menu…' : 'Edit as a new draft'}
        </button>
      )}
      {refused ? (
        <p role="alert" className="cl-said" data-testid="menu-edit-draft-refused">
          {refused}
        </p>
      ) : null}
      {said ? (
        <p role="status" className="cl-said" data-testid="menu-edit-draft-said">
          {said}
        </p>
      ) : null}
      {made ? (
        <div style={{ border: '1px solid var(--paper-2)', borderRadius: 10, padding: 12, marginTop: 8 }} data-testid="menu-edit-draft-card">
          <h3 ref={heading} tabIndex={-1} className="cl-focus" style={{ margin: 0 }}>
            {made.name}
          </h3>
          <p className="cl-note" data-testid="menu-edit-draft-copied">
            {copiedSentence(made)}
          </p>
          {result ? (
            <MenuReviewScreen
              embedded
              result={result}
              canChoose
              onSkip={() => close('Kept, not current. It stays in Menus kept for later.')}
              onConfirm={(madeCurrent) => {
                if (madeCurrent) {
                  void queryClient.invalidateQueries({ queryKey: ['menu'] });
                  close('This draft is now the current menu.');
                } else {
                  close('Kept, not current. It stays in Menus kept for later.');
                }
              }}
            />
          ) : busy ? (
            <p className="cl-note">Reading the draft's lines…</p>
          ) : refused ? (
            <p className="cl-note">The draft was made and is kept in Menus kept for later; open it there.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
