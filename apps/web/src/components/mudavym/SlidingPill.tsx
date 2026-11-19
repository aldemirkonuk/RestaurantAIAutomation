import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export interface SlidingPillOption<T extends string> {
  value: T;
  label: string;
  /** A count shown after the label; it ticks when it changes, and 0 dims the option. A string (an em dash for "not read") shows as it is and never dims. */
  count?: number | string;
  /** A hover hint carried onto this option's button (a shortcut, say). */
  title?: string;
  /** Carried onto this option's button, for a test or a tour anchor. */
  testId?: string;
  /** Carried onto the count's span. */
  countTestId?: string;
}

interface Props<T extends string> {
  options: ReadonlyArray<SlidingPillOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Names the group for assistive technology. */
  ariaLabel: string;
  className?: string;
  /** Carried onto the group, for a guided tour's anchor or a test. */
  testId?: string;
  /**
   * `tablist` for a control that switches what is shown beneath it: options
   * then carry `role="tab"` and `aria-selected` instead of `aria-pressed`.
   */
  role?: 'group' | 'tablist';
}

/**
 * A segmented control with one pill that slides under the active option
 * (design critic N-12), instead of each option filling in place. The pill is
 * placed by two custom properties measured from the active button, and moves
 * on transform only; `styles/motion.css` carries the spring, and the reduced
 * motion tier that drops it. It keeps the app's toggle pattern: a group of buttons with `aria-pressed`.
 */
export function SlidingPill<T extends string>({ options, value, onChange, ariaLabel, className, testId, role = 'group' }: Props<T>) {
  const tabs = role === 'tablist';
  const root = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const el = root.current?.querySelector<HTMLElement>('[aria-pressed="true"], [aria-selected="true"]');
    if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
  }, []);

  useLayoutEffect(measure, [measure, value, options]);
  useEffect(() => {
    // The first placement must not travel in from the left edge.
    const id = requestAnimationFrame?.(() => setReady(true));
    const ro = typeof ResizeObserver === 'function' && root.current ? new ResizeObserver(measure) : null;
    if (ro && root.current) ro.observe(root.current);
    return () => {
      if (id !== undefined) cancelAnimationFrame?.(id);
      ro?.disconnect();
    };
  }, [measure]);

  const style = box ? ({ '--pill-x': `${box.x}px`, '--pill-w': `${box.w}px` } as CSSProperties) : undefined;

  return (
    <div
      ref={root}
      role={role}
      aria-label={ariaLabel}
      className={`mdv-pill${className ? ` ${className}` : ''}`}
      data-ready={ready ? 'true' : 'false'}
      style={style}
      data-testid={testId}
    >
      <span className="mdv-pill__thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-value={o.value}
          {...(tabs
            ? { role: 'tab', 'aria-selected': o.value === value }
            : { 'aria-pressed': o.value === value })}
          title={o.title}
          data-testid={o.testId}
          data-empty={o.count === 0 ? 'true' : undefined}
          className="mdv-pill__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined ? (
            <span key={o.count} className="mdv-pill__count" data-testid={o.countTestId}>
              {o.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
