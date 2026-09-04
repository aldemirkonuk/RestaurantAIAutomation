/**
 * Render contract for the house overlay primitive.
 *
 * These are the seven things no rebuilt page's hand-rolled overlay did, and the
 * reason a shared primitive exists at all: focus goes in, Tab stays in, Esc and
 * the scrim get you out, focus comes back to the control you opened it with,
 * the page's ground travels across the portal, and reduced motion means no
 * motion — not a shorter one.
 */

import { useRef, useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Panel, Popover, Sheet } from './Sheet';
import {
  claimMudavymShell,
  getMudavymShell,
  readGroundFromDom,
  readShellGroundFromDom,
  releaseMudavymShell,
  resetMudavymShell,
} from '../../lib/mudavym/shellGround';

function setReducedMotion(reduce: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

/** A page root + an opener button + the overlay, the way a real page uses it. */
function Harness({
  shape = 'panel',
  ground,
}: {
  shape?: 'sheet' | 'panel' | 'popover';
  ground?: 'charcoal';
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const body = (
    <div>
      <button type="button">first</button>
      <button type="button">second</button>
    </div>
  );
  return (
    <div className="mudavym" data-ground={ground}>
      <button type="button" ref={anchor} onClick={() => setOpen(true)}>
        opener
      </button>
      {shape === 'popover' ? (
        <Popover open={open} onClose={() => setOpen(false)} label="Menu" anchorRef={anchor}>
          {body}
        </Popover>
      ) : shape === 'sheet' ? (
        <Sheet open={open} onClose={() => setOpen(false)} label="Detail" eyebrow="Vendor" title="Kavaklıdere">
          {body}
        </Sheet>
      ) : (
        <Panel open={open} onClose={() => setOpen(false)} label="Ask" title="Ask the book">
          {body}
        </Panel>
      )}
    </div>
  );
}

beforeEach(() => {
  setReducedMotion(false);
  resetMudavymShell();
});

describe('the house overlay', () => {
  it('moves focus inside on open and back to the opener on close', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener);

    // The Close control is the first focusable in the header, so focus lands
    // inside the dialog rather than staying on a control behind the scrim.
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('cycles Tab inside the panel instead of letting it walk onto the page', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    const dialog = screen.getByRole('dialog');
    const inside = Array.from(dialog.querySelectorAll('button'));
    expect(inside.length).toBeGreaterThan(1);

    const last = inside[inside.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(inside[0]);

    inside[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and on a scrim click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('carries a charcoal ground across the portal', () => {
    const { unmount } = render(<Harness ground="charcoal" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    const root = document.querySelector('.mdv-ovl') as HTMLElement;
    expect(root.parentElement).toBe(document.body); // portalled, not in the page
    expect(root).toHaveClass('mudavym');
    expect(root).toHaveAttribute('data-ground', 'charcoal');
    unmount();
  });

  it('leaves a paper page paper — the attribute is absent, as on the page root', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    const root = document.querySelector('.mdv-ovl') as HTMLElement;
    expect(root.hasAttribute('data-ground')).toBe(false);
  });

  it('locks body scroll for a modal shape and releases it on close', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('renders no animation under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(<Harness shape="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'none');
  });

  it('names its motion token when motion is allowed', () => {
    render(<Harness shape="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'tuck');
  });

  it('is a non-modal dialog as a popover, and does not lock scroll', () => {
    render(<Harness shape="popover" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(document.body.style.overflow).toBe('');
  });
});

describe('the shell gate', () => {
  it('is off until a gate claims it, and reports the last claim while pages overlap', () => {
    expect(getMudavymShell()).toEqual({ on: false, ground: 'paper' });
    const a = Symbol('a');
    const b = Symbol('b');
    claimMudavymShell(a, 'paper');
    expect(getMudavymShell()).toEqual({ on: true, ground: 'paper' });
    // The arriving page mounts before the departing one unmounts.
    claimMudavymShell(b, 'charcoal');
    expect(getMudavymShell()).toEqual({ on: true, ground: 'charcoal' });
    releaseMudavymShell(a);
    expect(getMudavymShell()).toEqual({ on: true, ground: 'charcoal' });
    releaseMudavymShell(b);
    expect(getMudavymShell().on).toBe(false);
  });

  it('reads a ground off the DOM, and says null when the anchor is in no page', () => {
    document.body.innerHTML =
      '<div class="mudavym" data-ground="charcoal"><button id="in">x</button></div>' +
      '<button id="out">y</button>';
    expect(readGroundFromDom(document.getElementById('in'))).toBe('charcoal');
    expect(readGroundFromDom(document.getElementById('out'))).toBeNull();
    expect(readShellGroundFromDom()).toBe('charcoal');
    document.body.innerHTML = '';
    expect(readShellGroundFromDom()).toBe('paper');
  });

  it('does not read an open overlay back as if it were the page', () => {
    document.body.innerHTML = '<div class="mdv-ovl mudavym" data-ground="charcoal"></div>';
    expect(readShellGroundFromDom()).toBe('paper');
    document.body.innerHTML = '';
  });
});
