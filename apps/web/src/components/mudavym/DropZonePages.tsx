/**
 * The page strip of a several-photo menu (r109 g2): each page seen, put in
 * order, turned or removed before Read; the order is the printed order
 * (DD-r108-67). Keyboard buttons are the accessible path, a mouse can also
 * drag. It holds files and tells its host; it reads nothing.
 *
 * Motion (ADR 0112): 180 ms rise staggered 30 ms, transform-only FLIP of
 * 200 ms (180 ms closing a removal), 160 ms turn; all instant under reduced
 * motion, opacity fades included.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './drop-pages.css';

export type Turn = 0 | 90 | 180 | 270;

export interface DropZonePagesProps {
  files: File[];
  onFiles: (files: File[], mode: 'replace' | 'add') => void;
  turns?: Record<number, Turn>;
  onTurn?: (index: number, turn: Turn) => void;
  disabled?: boolean;
}

let nextId = 1;
const ids = new WeakMap<File, number>();
const idOf = (f: File) => {
  let id = ids.get(f);
  if (!id) ids.set(f, (id = nextId++));
  return id;
};

const reduced = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function PageThumb({ file, turn }: { file: File; turn: Turn }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') {
      setSrc(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL?.(url);
  }, [file]);
  return src ? (
    <img className="mdv-pages__img" src={src} alt="" draggable={false} style={{ transform: `rotate(${turn}deg)` }} />
  ) : (
    <span className="mdv-pages__img mdv-pages__img--doc" aria-hidden>
      {(file.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}
    </span>
  );
}

export function DropZonePages({ files, onFiles, turns = {}, onTurn, disabled = false }: DropZonePagesProps) {
  const [said, setSaid] = useState('');
  const items = useRef(new Map<number, HTMLLIElement>());
  const before = useRef(new Map<number, DOMRect>());
  const lifted = useRef<{ id: number; rect: DOMRect } | null>(null);
  const count = useRef(files.length);
  // Pages already drawn: only a page new to the strip plays its entry (a node React moves on a reorder would replay a CSS animation).
  const entered = useRef(new Set<number>());
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  // FLIP on transform only: remember where every page was, and after a change
  // play each page from there to where it is now.
  useLayoutEffect(() => {
    const removal = files.length < count.current;
    count.current = files.length;
    const settle = reduced() ? null : removal ? 180 : 200;
    for (const f of files) {
      const id = idOf(f);
      const el = items.current.get(id);
      if (!el) continue;
      const from = lifted.current?.id === id ? lifted.current.rect : before.current.get(id);
      const to = el.getBoundingClientRect();
      if (settle && from && (from.left !== to.left || from.top !== to.top)) {
        el.style.transition = 'none';
        el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
        void el.offsetWidth;
        el.style.transition = `transform ${settle}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        el.style.transform = '';
      }
    }
    lifted.current = null;
    for (const f of files) entered.current.add(idOf(f));
    const next = new Map<number, DOMRect>();
    for (const f of files) {
      const el = items.current.get(idOf(f));
      if (el) next.set(idOf(f), el.getBoundingClientRect());
    }
    before.current = next;
  }, [files]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= files.length || to === from) return;
    const order = files.slice();
    const [page] = order.splice(from, 1);
    order.splice(to, 0, page);
    setSaid(`Page ${from + 1} is now page ${to + 1}`);
    onFiles(order, 'replace');
  };
  const remove = (i: number) => {
    setSaid(`Page ${i + 1} removed`);
    onFiles(
      files.filter((_, j) => j !== i),
      'replace',
    );
  };
  const turn = (i: number) => onTurn?.(i, (((turns[i] ?? 0) + 90) % 360) as Turn);

  const onDown = (e: React.PointerEvent, id: number) => {
    if (disabled || e.pointerType === 'touch' || (e.button ?? 0) !== 0) return;
    drag.current = { id, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const el = items.current.get(id);
    if (el) {
      el.style.transition = 'none';
      el.dataset.lifted = 'true';
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = d && items.current.get(d.id);
    if (d && el) el.style.transform = `translate(${e.clientX - d.x}px, ${e.clientY - d.y}px)`;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = d && items.current.get(d.id);
    if (!d || !el) return;
    delete el.dataset.lifted;
    const from = files.findIndex((f) => idOf(f) === d.id);
    let to = from;
    files.forEach((f, j) => {
      const r = items.current.get(idOf(f))?.getBoundingClientRect();
      if (j !== from && r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) to = j;
    });
    lifted.current = { id: d.id, rect: el.getBoundingClientRect() };
    el.style.transform = '';
    if (to !== from) {
      move(from, to);
    } else if (!reduced()) {
      const back = lifted.current.rect;
      const home = el.getBoundingClientRect();
      el.style.transition = 'none';
      el.style.transform = `translate(${back.left - home.left}px, ${back.top - home.top}px)`;
      void el.offsetWidth;
      el.style.transition = 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = '';
      lifted.current = null;
    } else {
      lifted.current = null;
    }
  };

  return (
    <>
      <ol className="mdv-pages" aria-label="Pages of the menu">
        {files.map((f, i) => {
          const id = idOf(f);
          return (
            <li
              key={id}
              className="mdv-pages__page"
              ref={(el) => {
                if (el) items.current.set(id, el);
                else items.current.delete(id);
              }}
              style={{ ['--mdv-pg-delay' as string]: `${Math.min(i, 5) * 30}ms` }}
              data-testid="menu-page"
              data-in={entered.current.has(id) ? undefined : 'true'}
            >
              <div
                className="mdv-pages__thumb"
                onPointerDown={(e) => onDown(e, id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                <PageThumb file={f} turn={turns[i] ?? 0} />
              </div>
              <span className="mdv-pages__n">Page {i + 1}</span>
              <div className="mdv-pages__acts">
                <button
                  type="button"
                  className="mdv-pages__btn"
                  aria-label={`Move page ${i + 1} earlier`}
                  disabled={disabled || i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  {'←'}
                </button>
                <button
                  type="button"
                  className="mdv-pages__btn"
                  aria-label={`Move page ${i + 1} later`}
                  disabled={disabled || i === files.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  {'→'}
                </button>
                {f.type.startsWith('image/') ? (
                  <button
                    type="button"
                    className="mdv-pages__btn"
                    aria-label={`Turn page ${i + 1}`}
                    disabled={disabled}
                    onClick={() => turn(i)}
                  >
                    Turn
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mdv-pages__btn"
                  aria-label={`Remove page ${i + 1}`}
                  disabled={disabled}
                  onClick={() => remove(i)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <span className="mdv-drop__sr" role="status" aria-live="polite">
        {said}
      </span>
    </>
  );
}

export default DropZonePages;
