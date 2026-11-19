import { useEffect, useRef, useState, type ReactNode } from 'react';

/** How long the close runs; `--dur-collapse` in styles/motion.css is 280 ms. */
const CLOSE_MS = 300;

/**
 * An inline panel that opens in place instead of shoving the page down in one
 * frame (design critic N-12). `grid-template-rows` goes 0fr to 1fr in 280 ms
 * and the content fades in 120 ms later; `styles/motion.css` owns the motion
 * and its reduced-motion tier. While closed the content is `inert` and hidden
 * from assistive technology, so nothing inside can take focus.
 *
 * `unmountWhenClosed` is for a panel with a form in it: the content is not in
 * the page while closed (a field cannot hold a stale draft, and a test can
 * assert it is absent), it mounts closed, opens on the next frame, and is
 * removed once the close has finished.
 */
export function Collapse({
  open,
  children,
  className,
  unmountWhenClosed = false,
  appear = false,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  unmountWhenClosed?: boolean;
  /**
   * With `unmountWhenClosed`: a panel that mounts already open still eases
   * open (one frame at 0fr first), as a row dropdown does when its row opens.
   * Without it a panel that mounts open appears at full height.
   */
  appear?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open && !(unmountWhenClosed && appear));
  const first = useRef(true);

  useEffect(() => {
    if (!unmountWhenClosed) return;
    if (first.current) {
      first.current = false;
      if (appear && open) {
        const id = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(id);
      }
      return;
    }
    if (open) {
      setMounted(true);
      // One painted frame at 0fr first, or the opening has nothing to travel from.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(t);
  }, [open, unmountWhenClosed, appear]);

  const isOpen = unmountWhenClosed ? shown : open;
  if (unmountWhenClosed && !mounted && !open) return null;

  return (
    <div className={`mdv-collapse${className ? ` ${className}` : ''}`} data-open={isOpen ? 'true' : 'false'}>
      <div
        className="mdv-collapse__inner"
        // Reachable the moment `open` is true (the opening frame is only
        // visual), unreachable the moment it is false (the closing is too).
        aria-hidden={open ? undefined : true}
        // `inert` is not yet in React 18's DOM typings; an empty string sets it.
        {...(open ? {} : ({ inert: '' } as Record<string, string>))}
      >
        {unmountWhenClosed && !mounted && open ? null : children}
      </div>
    </div>
  );
}
