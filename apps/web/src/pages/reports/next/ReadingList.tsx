/**
 * The reading's own rendering: the engine's sentences, verbatim, filtered by
 * the categories this restaurant ACTUALLY has. A category with nothing in it is
 * not offered as a chip — an empty filter claims a kind of insight the engine
 * never produced.
 *
 * It lives in its own file because it is the one catalogue entry whose "table"
 * is stateful; every other analysis reduces to data (`rp-view.ts`) and is drawn
 * by `Cutting.tsx`.
 */

import { useState } from 'react';
import { categoryLabel } from './rp-format';
import type { ReadingRow } from './rp-catalogue';

export default function ReadingList({ rows }: { rows: ReadingRow[] }) {
  const [only, setOnly] = useState<string | null>(null);
  const cats = Array.from(new Set(rows.map((r) => r.category)));
  const shown = only ? rows.filter((r) => r.category === only) : rows;
  return (
    <>
      <div className="rp-row">
        {cats.map((c) => (
          <button
            key={c}
            type="button"
            className="rp-chip rp-ink rp-focus rp-no-drag"
            aria-pressed={only === c}
            onClick={() => setOnly(only === c ? null : c)}
          >
            {categoryLabel(c)}
          </button>
        ))}
      </div>
      <ul className="rp-list">
        {shown.slice(0, 24).map((r) => (
          <li key={r.ruleKey} style={{ display: 'grid', gap: 3 }}>
            <span className="rp-row">
              <span className="rp-tag">{categoryLabel(r.category)}</span>
              {r.entityLabel && <span className="rp-cap">{r.entityLabel}</span>}
            </span>
            {/* Verbatim engine sentence — never reworded on this page. */}
            <p className="rp-sentence">{r.sentence}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

