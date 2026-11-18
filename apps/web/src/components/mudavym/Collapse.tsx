import type { ReactNode } from 'react';

/**
 * An inline panel that opens in place instead of shoving the page down in one
 * frame (design critic N-12). `grid-template-rows` goes 0fr to 1fr in 280 ms
 * and the content fades in 120 ms later; `styles/motion.css` owns the motion
 * and its reduced-motion tier. While closed the content is `inert` and hidden
 * from assistive technology, so nothing inside can take focus.
 */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`mdv-collapse${className ? ` ${className}` : ''}`} data-open={open ? 'true' : 'false'}>
      <div
        className="mdv-collapse__inner"
        aria-hidden={open ? undefined : true}
        // `inert` is not yet in React 18's DOM typings; an empty string sets it.
        {...(open ? {} : ({ inert: '' } as Record<string, string>))}
      >
        {children}
      </div>
    </div>
  );
}
