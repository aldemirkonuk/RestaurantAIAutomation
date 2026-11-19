/**
 * GroupRail — one long page cut into groups, one open at a time (r73 c3 need 8).
 *
 * `/settings` ran 15,359 px and `/connections` 6,065 px because every register was
 * open at once. Here the page is a rail of groups (a select on a phone) and a
 * column of panes; a pane is a sticky 44 px head over a body that opens with
 * `grid-template-rows` 0fr -> 1fr.
 *
 * Closed bodies stay MOUNTED and are `inert`: a half-typed value in a closed group
 * is not thrown away when the reader opens another, and nothing inside a closed
 * body can be tabbed to or read out. Motion is in group-rail.css; it is dropped
 * under prefers-reduced-motion.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import './group-rail.css';

export interface RailGroup {
  id: string;
  title: string;
  roman?: string;
  hint?: string;
  /** A rail entry that leaves the page (Settings -> Connections). */
  to?: string;
}

/** Group heads, one open at a time. `pick` opens a group and says it was a choice to scroll to. */
export function useOpenGroup(initial: string | null) {
  const [openId, setOpenId] = useState<string | null>(initial);
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null);
  const open = useCallback((id: string) => setOpenId(id), []);
  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);
  /** Open a group and bring its head to the top once the neighbours have moved. */
  const pick = useCallback((id: string) => {
    setOpenId(id);
    setScrollTo((cur) => ({ id, n: (cur?.n ?? 0) + 1 }));
  }, []);
  return { openId, open, toggle, pick, scrollTo };
}

/** After a pick: scroll the head into view now, and again when the others have finished closing. */
export function useScrollAfterPick(
  scrollTo: { id: string; n: number } | null,
  elementFor: (id: string) => HTMLElement | null,
  reduced: boolean,
  settleMs = 280,
) {
  useEffect(() => {
    if (!scrollTo) return;
    const go = () => {
      const el = elementFor(scrollTo.id);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    };
    go();
    if (reduced) return;
    const t = window.setTimeout(go, settleMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pick, not on the callbacks
  }, [scrollTo]);
}

export interface GroupRailProps {
  groups: RailGroup[];
  openId: string | null;
  onPick: (id: string) => void;
  ariaLabel: string;
  selectLabel?: string;
  /** Extra content under the desktop rail (a note, a link). */
  footer?: ReactNode;
}

export function GroupRail({ groups, openId, onPick, ariaLabel, selectLabel = 'Jump to a group', footer }: GroupRailProps) {
  const navigate = useNavigate();
  return (
    <>
      <div className="gr-select">
        <label htmlFor="gr-select-field">{selectLabel}</label>
        <select
          id="gr-select-field"
          value={openId ?? ''}
          onChange={(e) => {
            const g = groups.find((x) => x.id === e.target.value);
            if (!g) return;
            if (g.to) navigate(g.to);
            else onPick(g.id);
          }}
        >
          {openId === null && <option value="" disabled>Choose a group</option>}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.roman ? `${g.roman}. ` : ''}{g.title}</option>
          ))}
        </select>
      </div>
      <nav aria-label={ariaLabel} className="gr-rail">
        {groups.map((g) => {
          const inner = (
            <>
              {g.roman ? <span className="gr-rail-roman">{g.roman}</span> : null}
              <span style={{ display: 'block', minWidth: 0 }}>
                <span className="gr-rail-title">{g.title}</span>
                {g.hint ? <span className="gr-rail-hint">{g.hint}</span> : null}
              </span>
            </>
          );
          return g.to ? (
            <Link key={g.id} to={g.to} className="gr-rail-item">{inner}</Link>
          ) : (
            <button key={g.id} type="button" className="gr-rail-item" aria-current={openId === g.id ? 'true' : undefined} onClick={() => onPick(g.id)}>
              {inner}
            </button>
          );
        })}
        {footer}
      </nav>
    </>
  );
}

export interface GroupPaneProps {
  /** DOM id of the pane (a deep-link anchor). */
  anchor: string;
  /** Id for the head's heading (aria-labelledby target). */
  headId: string;
  title: string;
  roman?: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function GroupPane({ anchor, headId, title, roman, meta, open, onToggle, children }: GroupPaneProps) {
  const bodyId = `${anchor}-body`;
  const [settled, setSettled] = useState(open);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSettled(false);
    const t = window.setTimeout(() => setSettled(true), 320);
    return () => window.clearTimeout(t);
  }, [open]);
  const inert = open ? {} : ({ inert: '' } as Record<string, string>);
  return (
    <section id={anchor} className="gr-pane" data-open={open} aria-labelledby={headId}>
      <h2 id={headId} className="gr-head">
        <button type="button" className="gr-head-btn" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          {roman ? <span className="gr-head-roman">{roman}</span> : null}
          <span className="gr-head-title">{title}</span>
          {meta ? <span className="gr-head-meta">{meta}</span> : null}
          <ChevronDown className="gr-chev" aria-hidden />
        </button>
      </h2>
      <div
        id={bodyId}
        className="gr-body"
        data-open={open}
        data-settled={settled}
        {...inert}
      >
        <div className="gr-inner"><div className="gr-pad">{children}</div></div>
      </div>
    </section>
  );
}
