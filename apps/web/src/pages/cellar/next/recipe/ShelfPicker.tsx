/**
 * Search the house's own shelf and pick the thing a recipe line pours from
 * (proposal §4 F2: a line points at a house item, never a catalogue row).
 *
 * The search waits a quarter second after the last key, so typing "campari"
 * asks the shelf once, not seven times. A failed read says so (ADR 0020): an
 * empty list is only ever drawn for a read that answered with nothing.
 */
import { useEffect, useId, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import type { ShelfItem } from '../../../../services/api/recipes';
import { useShelf } from './useRecipe';

const DEBOUNCE_MS = 250;

/** A shelf kind in plain words: "non_alcoholic" reads "non alcoholic". */
export function kindWords(kind: string | null | undefined): string {
  if (!kind) return 'kind not set';
  return kind.replace(/[_-]+/g, ' ').trim().toLowerCase();
}

export default function ShelfPicker({
  initial,
  onPick,
  onClose,
}: {
  initial: string;
  onPick: (item: ShelfItem) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [search, setSearch] = useState(initial.trim());

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const shelf = useShelf(search, true);

  return (
    <div className="cl-rcp-picker" data-testid="shelf-picker">
      <label htmlFor={`${id}-q`} className="cl-sr">Find it on your shelf</label>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Search size={13} aria-hidden style={{ color: 'var(--ink-3)' }} />
        <input
          id={`${id}-q`}
          className="cl-field cl-focus"
          type="search"
          autoFocus
          value={text}
          placeholder="Find it on your shelf"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" className="cl-btn cl-focus" onClick={onClose}>
          Close
        </button>
      </span>
      {shelf.loading ? (
        <p className="cl-note" role="status">Looking on your shelf…</p>
      ) : shelf.error ? (
        <p className="cl-note" role="alert" style={{ color: 'var(--ink-1)' }}>
          <AlertTriangle size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Your shelf could not be read just now ({shelf.error}). Nothing is listed rather than a wrong list.
        </p>
      ) : (shelf.data ?? []).length === 0 ? (
        <p className="cl-note" role="status">
          {search ? `Nothing on your shelf matches “${search}”.` : 'Your shelf has nothing on it yet.'}
        </p>
      ) : (
        <ul className="cl-rcp-picks" aria-label="On your shelf">
          {(shelf.data ?? []).map((item) => (
            <li key={item.id}>
              <button type="button" className="cl-rcp-pick cl-focus" onClick={() => onPick(item)}>
                <span className="cl-rcp-pick-name">{item.name}</span>
                <span className="cl-dim">{kindWords(item.kind)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
