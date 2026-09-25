/**
 * The one `<Toaster/>` mounted in App.tsx: gated the same way every shell
 * chrome piece is. Off, it must be the exact `<Toaster/>` props App.tsx
 * always passed (the `richColors`/slate `classNames` legacy look); on, the
 * house-token `mdv-toast` classNames, `visibleToasts={3}`, no `richColors`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const toasterProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    toasterProps.current = props;
    return null;
  },
}));

import { AppToaster } from './AppToaster';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  toasterProps.current = null;
});
afterEach(() => window.localStorage.clear());

describe('shell off (default)', () => {
  it('mounts the legacy Toaster: richColors, no visibleToasts cap, slate classNames', () => {
    render(<AppToaster />);
    expect(toasterProps.current?.richColors).toBe(true);
    expect(toasterProps.current?.visibleToasts).toBeUndefined();
    const classNames = toasterProps.current?.toastOptions as { classNames?: Record<string, string> };
    expect(classNames.classNames?.toast).toContain('bg-white');
  });
});

describe('shell on', () => {
  beforeEach(() => window.localStorage.setItem('mudavym.design.shell', '1'));

  it('mounts the house Toaster: tokens only, capped at 3 visible, no richColors', () => {
    render(<AppToaster />);
    expect(toasterProps.current?.richColors).toBeUndefined();
    expect(toasterProps.current?.visibleToasts).toBe(3);
    expect(toasterProps.current?.className).toContain('mudavym');
    const classNames = toasterProps.current?.toastOptions as { classNames?: Record<string, string> };
    expect(classNames.classNames?.toast).toBe('mdv-toast');
  });
});
