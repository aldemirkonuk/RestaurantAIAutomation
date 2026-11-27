/**
 * The Mail tab's heavy panels arrive as code when asked for, not with
 * /communications. Each is held back until the person opens it, and the
 * pointer or focus reaching the control that opens it starts the fetch, so a
 * click usually finds the code already there.
 *
 * While the code arrives the panel's place is a static block of fixed height:
 * no fade, no spinner, nothing that moves, so reduced motion has nothing to
 * remove and nothing shifts when the panel lands (MOTIONS.md, ADR 0112).
 */
import type { ReactNode } from 'react';
import { MONO } from './cm-format';

/**
 * The three dynamic imports, in one place so the lazy() calls and the warms share
 * one specifier each (one chunk each), and a spec can count and hold them.
 */
export const loaders = {
  thread: () => import('./MailThread'),
  setup: () => import('./MailSetup'),
  whoIsWriting: () => import('./WhoIsWriting'),
};

/** Start a fetch for the code a control will open; a failed warm is silent, the click retries it. */
export const warmMailThread = () => void loaders.thread().catch(() => {});
export const warmMailSetup = () => void loaders.setup().catch(() => {});

/** The place held for a panel: the thread and the setup page, and the Who is writing strip. */
export const CODE_HOLD_PANEL_PX = 320;
export const CODE_HOLD_STRIP_PX = 120;

export function CodeHold({ testId, height, children }: { testId: string; height: number; children: ReactNode }) {
  return (
    <div
      role="status"
      data-testid={testId}
      style={{
        minHeight: height,
        fontFamily: MONO,
        fontSize: 11,
        color: 'var(--ink-4, #665D50)',
        animation: 'none',
        transition: 'none',
      }}
    >
      {children}
    </div>
  );
}
