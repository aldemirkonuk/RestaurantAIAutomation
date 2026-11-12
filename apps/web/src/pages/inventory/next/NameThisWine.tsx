/**
 * ADR 0192's naming flag (founder amendment, 2026-09-21) on the rebuilt page.
 *
 * The legacy page mounts three pieces (InventoryCommandPage.tsx:1428 the row
 * hint, RowExpansion.tsx:166 the editor, InventoryCommandPage.tsx:1597 the
 * unread notice). This is the same behaviour on the same calls, in the page's
 * own classes:
 *
 * - the research list is the legacy `useHouseItemResearch` query, so the two
 *   pages share one cache entry (`['inventory','research']`) and one read;
 * - the flag's words are the gateway's (`flag`), never re-worded here;
 * - the rename is the same PATCH every item edit uses (`updateInventoryItem`,
 *   `wineName`), which re-decides the research on the server;
 * - a refusal is said in the house's words (iv-failure), not the server's raw
 *   message, and an unanswered rename says it may have landed.
 *
 * DeliveriesToName is a different list (delivered lines that booked nothing,
 * `['procurement','items-to-name']`), so it does not cover this one.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateInventoryItem, type HouseItemResearch } from '../../../services/api/inventory';
import { queryKeys } from '../../../lib/query-keys';
import { HOUSE_ITEM_RESEARCH_KEY, useHouseItemResearch } from '../command/NameThisWine';
import { failureReason, writeFailure } from './iv-failure';

function entryFor(list: HouseItemResearch[] | undefined, inventoryId: string): HouseItemResearch | undefined {
  return list?.find((r) => r.inventoryId === inventoryId);
}

/** One quiet line under the title in its row. Nothing when there is nothing to ask. */
export function NameHint({ inventoryId }: { inventoryId: string }) {
  const research = useHouseItemResearch();
  const entry = entryFor(research.data, inventoryId);
  if (!entry?.flag) return null;
  return (
    <span className="iv-namehint" data-testid="name-this-wine-hint" title={entry.flag}>
      {entry.flag}
    </span>
  );
}

/** In the opened row: the flag, and the house's own name for the wine, editable. */
export function NameThisWine({
  inventoryId,
  currentName,
  restaurantId,
}: {
  inventoryId: string;
  currentName: string | null;
  restaurantId?: string | null;
}) {
  const research = useHouseItemResearch();
  const queryClient = useQueryClient();
  const entry = entryFor(research.data, inventoryId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName ?? '');
  const [saving, setSaving] = useState(false);
  const [says, setSays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!entry?.flag && !says) return null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all }),
      queryClient.invalidateQueries({ queryKey: ['inventory-next'] }),
    ]);

  const save = async () => {
    const name = draft.trim();
    if (!name) {
      setProblem('Write the wine’s name, for example its producer and wine.');
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      await updateInventoryItem(inventoryId, { wineName: name }, restaurantId ?? undefined);
      setEditing(false);
      await refresh();
      // Only what the RE-READ list says: a re-read that failed leaves the old
      // list in the cache, and reading it would word the old status as the new
      // one (the legacy rule, NameThisWine.tsx:84-89).
      const state = queryClient.getQueryState(HOUSE_ITEM_RESEARCH_KEY);
      const reread = !(state?.status === 'error' && state.errorUpdatedAt >= state.dataUpdatedAt);
      const fresh = reread ? queryClient.getQueryData<HouseItemResearch[]>(HOUSE_ITEM_RESEARCH_KEY) : undefined;
      const now = entryFor(fresh, inventoryId);
      setSays(
        now?.status === 'not_findable'
          ? 'Saved. That name still does not say which wine this is.'
          : now?.status === 'queued'
            ? 'Saved. We will look this wine up by its new name.'
            : 'Saved.',
      );
    } catch (e) {
      const f = writeFailure(e, {
        refused: 'The name was not saved',
        act: 'the new name was saved',
        check: 'Re-read the book before trying again.',
      });
      if (f.unknown) void refresh();
      setProblem(f.text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="iv-namewine" data-testid="name-this-wine">
      {entry?.flag ? <p className="iv-said">{entry.flag}</p> : null}
      {entry?.flag && !editing ? (
        <button
          type="button"
          className="iv-linkish iv-focus"
          onClick={() => {
            setDraft(currentName ?? '');
            setEditing(true);
            setSays(null);
            setProblem(null);
          }}
        >
          Name this wine
        </button>
      ) : null}
      {editing ? (
        <form
          className="iv-row-controls"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="iv-sr" htmlFor={`iv-name-this-wine-${inventoryId}`}>
            The wine’s name
          </label>
          <input
            id={`iv-name-this-wine-${inventoryId}`}
            className="iv-field iv-focus"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Producer and wine, e.g. Kavaklıdere Yakut 2019"
            maxLength={200}
          />
          <button type="submit" className="iv-btn iv-focus" data-seal="true" disabled={saving}>
            {saving ? 'Saving' : 'Save the name'}
          </button>
          <button type="button" className="iv-linkish iv-focus" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : null}
      {says ? (
        <p className="iv-note" role="status" data-testid="name-this-wine-says">
          {says}
        </p>
      ) : null}
      {problem ? (
        <p className="iv-said-alarm" role="alert" data-testid="name-this-wine-problem">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Said once on the page when the list cannot be read: a failed read, not "nothing to name". */
export function NamingUnread() {
  const research = useHouseItemResearch();
  if (!research.isError) return null;
  return (
    <p className="iv-note" role="status" data-testid="house-item-research-unread">
      Which wines need naming could not be read ({failureReason(research.error)}). That is a failed read, not
      “nothing to name”.
    </p>
  );
}
