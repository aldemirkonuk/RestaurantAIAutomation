/**
 * useUnsavedWorkGuard — ask before typed work is dropped (F-712).
 *
 * A door count, a cart of order lines or a manual receipt lived only in
 * `useState`, so a refresh, the Back button or a phone's swipe-back threw it
 * away without a word. While `active` is true this hook:
 *
 *   · asks the browser to confirm a reload, a closed tab or a typed address
 *     (`beforeunload` — the browser writes its own words there, by design);
 *   · asks before Back leaves the screen. Back is caught with one extra
 *     history entry for the same address: Back takes that entry off, we ask,
 *     and either put it back (stay) or step back once more (leave).
 *
 * WHY NOT react-router's `useBlocker`. It only works under a data router
 * (`createBrowserRouter`); App.tsx mounts `<BrowserRouter>`, where it throws.
 * Moving the whole route table to a data router is its own change. The guard
 * entry carries the router's own `history.state`, so the router sees the same
 * location when Back takes it off and nothing remounts.
 *
 * WHAT IT DOES NOT CATCH: a push to another route while work is open (a link).
 * The three callers are a full-screen door and two modal surfaces, which cover
 * the app's links while they are open.
 *
 * The draft helpers below keep the work itself in sessionStorage, so a leave
 * the person confirmed — or one the browser never asked about — still finds
 * the work again on return. Storage can be missing or full; every call is
 * best-effort and says nothing when it fails.
 */
import { useEffect, useRef } from 'react';

const MARK = '__mdvUnsavedWork';

/** A disarm waiting for the next tick, so a guard that re-arms at once
 *  (React StrictMode's double effect, a dirty flag that flickers) reuses the
 *  entry instead of stepping back across it. */
let pendingDisarm: ReturnType<typeof setTimeout> | null = null;
/** Our own step back off the guard entry is on its way until this time; a
 *  popstate before then is that step, not the person pressing Back. */
let disarmPopUntil = 0;

function onGuardEntry(): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state && state[MARK]);
}

function arm(): void {
  if (pendingDisarm !== null) {
    clearTimeout(pendingDisarm);
    pendingDisarm = null;
  }
  if (onGuardEntry()) return;
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.pushState({ ...state, [MARK]: true }, '', window.location.href);
}

export function useUnsavedWorkGuard(active: boolean, message: string): void {
  const messageRef = useRef(message);
  messageRef.current = message;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers only ask when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    arm();
    let leaving = false;
    const onPop = () => {
      if (Date.now() < disarmPopUntil) {
        // A guard that stood down took its entry off just as this one armed.
        disarmPopUntil = 0;
        arm();
        return;
      }
      if (leaving || onGuardEntry()) return;
      // Back took the guard entry off; the page's own entry is showing again.
      if (window.confirm(messageRef.current)) {
        leaving = true;
        window.history.back();
      } else {
        arm();
      }
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPop);
      if (leaving) return;
      // The work was saved or put down while standing here: take the guard
      // entry off, or the next Back would look like it did nothing.
      if (pendingDisarm !== null) clearTimeout(pendingDisarm);
      pendingDisarm = setTimeout(() => {
        pendingDisarm = null;
        if (!onGuardEntry()) return;
        disarmPopUntil = Date.now() + 1000;
        window.history.back();
      }, 0);
    };
  }, [active]);
}

/** Read a draft kept for this tab, or null when there is none or it cannot be read. */
export function readSessionDraft<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSessionDraft(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: the guard still asks before leaving */
  }
}

export function clearSessionDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
