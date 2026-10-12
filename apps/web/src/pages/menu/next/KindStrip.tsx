/**
 * The kind strip of the make-live review (ADR 0340 rule 18; lane 6).
 *
 * Above the review's groups a strip reads "Drinks 84 · Food 41 · Desserts 9":
 * one target per kind, counting the lines of that kind's draft in this read.
 * A section of a draft is dragged onto another kind to move it there (rule 10:
 * only between the drafts one read made; a kind with no draft yet gets one,
 * `created_menu`). Dragging is not the only way: a long press on a section,
 * or its "Move to…" button, opens a sheet (ADR 0112) listing the kinds, so a
 * keyboard, a screen reader or a phone moves a section too.
 *
 * Drag and drop is the browser's own (HTML5): apps/web has no drag library,
 * and one target per kind does not need one. The gateway decides every move;
 * this file only asks.
 */
import { useRef, useState, type DragEvent } from 'react';
import { Sheet } from '@/components/mudavym';
import { kindName, MENU_KINDS, type MenuKind } from '../../../services/api/menus';

export interface StripKind {
  kind: MenuKind
  /** Lines on this kind's draft in the read; null when the read made no draft of it. */
  count: number | null
  /** The draft of this kind in the read; null when there is none yet. */
  menuId: string | null
}

export interface MovableSection {
  id: string
  title: string
  /** The draft the section is on. */
  menuId: string
  kind: MenuKind
  lines: number
}

const DRAG_TYPE = 'text/plain';
const LONG_PRESS_MS = 500;

/** "Drinks 84 · Food 41 · Desserts 9": a kind with no draft is left out. */
export function kindStripWords(kinds: StripKind[]): string {
  return kinds
    .filter((k) => k.count !== null)
    .map((k) => `${kindName(k.kind)} ${k.count}`)
    .join(' · ');
}

/** What moving a section to `to` will do, in a sentence; says when it makes a new draft. */
export function moveWords(section: Pick<MovableSection, 'title' | 'lines'>, to: StripKind): string {
  const name = kindName(to.kind) ?? to.kind;
  const lines = `${section.lines} ${section.lines === 1 ? 'line' : 'lines'}`;
  if (to.menuId) return `Move ${section.title} (${lines}) to ${name}.`;
  return `Move ${section.title} (${lines}) to ${name}. This read has no ${name} draft yet, so moving makes one; the live ${name} menu's lines that are not in it show under Gone.`;
}

export function KindStrip({ kinds, sections, canMove, moving, onMove }: {
  kinds: StripKind[]
  sections: MovableSection[]
  canMove: boolean
  /** The section being moved now, if any. */
  moving: string | null
  onMove: (section: MovableSection, kind: MenuKind) => void
}) {
  const [over, setOver] = useState<MenuKind | null>(null);
  const [sheetFor, setSheetFor] = useState<MovableSection | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const byKind = new Map(kinds.map((k) => [k.kind, k]));
  const strip: StripKind[] = MENU_KINDS.map((k) => byKind.get(k) ?? { kind: k, count: null, menuId: null });

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };
  const drop = (kind: MenuKind) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const s = sections.find((x) => x.id === id);
    if (s && s.kind !== kind) onMove(s, kind);
  };

  return (
    <div data-testid="kind-strip" style={{ marginTop: 10 }}>
      <ul
        aria-label="Kinds in this read"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}
      >
        {strip.map((k) => (
          <li
            key={k.kind}
            data-testid={`kind-strip-${k.kind}`}
            data-over={over === k.kind ? 'true' : 'false'}
            className="cl-btn"
            style={{ cursor: 'default', outline: over === k.kind ? '2px solid var(--ink, currentColor)' : undefined }}
            onDragOver={
              canMove
                ? (e) => {
                    e.preventDefault();
                    setOver(k.kind);
                  }
                : undefined
            }
            onDragLeave={canMove ? () => setOver(null) : undefined}
            onDrop={canMove ? drop(k.kind) : undefined}
          >
            {kindName(k.kind)} {k.count === null ? <span className="cl-dim">none</span> : k.count}
          </li>
        ))}
      </ul>

      {canMove && sections.length > 0 ? (
        <details style={{ marginTop: 8 }} data-testid="kind-strip-sections">
          <summary className="cl-said cl-focus" style={{ cursor: 'pointer' }}>
            Sections ({sections.length}): drag one onto a kind, or press and hold it, to move it
          </summary>
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
            {sections.map((s) => (
              <li
                key={s.id}
                data-testid="kind-strip-section"
                draggable={moving === null}
                onDragStart={(e) => {
                  cancelPress();
                  e.dataTransfer.setData(DRAG_TYPE, s.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onPointerDown={() => {
                  cancelPress();
                  press.current = setTimeout(() => setSheetFor(s), LONG_PRESS_MS);
                }}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                className="cl-row-controls"
                style={{ alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'grab' }}
              >
                <span>
                  {s.title} <span className="cl-dim">· {kindName(s.kind)} · {s.lines} {s.lines === 1 ? 'line' : 'lines'}</span>
                </span>
                <button
                  type="button"
                  className="cl-btn cl-focus"
                  disabled={moving !== null}
                  onClick={() => setSheetFor(s)}
                  aria-label={`Move ${s.title} to another kind`}
                >
                  {moving === s.id ? 'Moving…' : 'Move to…'}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Sheet
        open={sheetFor !== null}
        onClose={() => setSheetFor(null)}
        label={
          sheetFor
            ? `Move the section ${sheetFor.title} to another kind of menu. Moving changes only this read's drafts; nothing goes live until the menus are made live. Leaving moves nothing.`
            : 'Move a section to another kind of menu. Leaving moves nothing.'
        }
        eyebrow="Section"
        title={sheetFor ? `Move ${sheetFor.title} to…` : 'Move to…'}
        closeLabel="Not now"
      >
        {sheetFor ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="kind-move-sheet">
            {strip
              .filter((k) => k.kind !== sheetFor.kind)
              .map((k) => (
                <li key={k.kind} style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="cl-btn cl-focus"
                    data-testid={`kind-move-${k.kind}`}
                    onClick={() => {
                      const s = sheetFor;
                      setSheetFor(null);
                      onMove(s, k.kind);
                    }}
                  >
                    {kindName(k.kind)}
                  </button>
                  <span className="cl-said" style={{ display: 'block', fontSize: 12 }}>
                    {moveWords(sheetFor, k)}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
      </Sheet>
    </div>
  );
}

export default KindStrip;
