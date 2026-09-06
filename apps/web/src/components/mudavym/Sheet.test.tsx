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

/* `data-motion="none"` says what the component INTENDS; this spy says what it
   actually scheduled. Under reduced motion the primitive must not call
   `animate()` at all — not call it and let it collapse to the end state — so
   the assertion has to be on the call, not on an attribute. */
vi.mock('../../lib/mudavym/motion', async (orig) => {
  const actual = await orig<typeof import('../../lib/mudavym/motion')>();
  return { ...actual, animate: vi.fn(actual.animate) };
});

import { Panel, Popover, Sheet, resetLabelWarnings } from './Sheet';
import { animate } from '../../lib/mudavym/motion';
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
  vi.mocked(animate).mockClear();
  document.body.style.overflow = '';
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

  it('schedules no animation at all under prefers-reduced-motion', () => {
    setReducedMotion(true);
    render(<Harness shape="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(vi.mocked(animate)).not.toHaveBeenCalled();
  });

  it('does schedule one when motion is allowed — so the test above can fail', () => {
    render(<Harness shape="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(vi.mocked(animate)).toHaveBeenCalledTimes(1);
  });

  it('counts the scroll lock: two overlays, and the body stays locked until the second closes', () => {
    // A boolean lock unlocks the page the moment EITHER overlay closes, which
    // is the bug this counter exists to prevent — and it only ever shows up
    // with two of them open.
    function Two() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <div className="mudavym">
          <Panel open={a} onClose={() => setA(false)} label="First" title="First">
            <button type="button">a</button>
          </Panel>
          <Panel open={b} onClose={() => setB(false)} label="Second" title="Second">
            <button type="button">b</button>
          </Panel>
        </div>
      );
    }
    render(<Two />);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Close Second' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Close First' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
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

/**
 * The `wide` sheet — ADR 0112's one anticipated exception, asked for by sketch
 * 100 and used by exactly one surface (the house email composer).
 *
 * The assertion is on the ATTRIBUTE, not on a computed width: jsdom applies no
 * stylesheet, so `getComputedStyle(...).maxWidth` reads empty for the 440px
 * default too and a width test would pass for the wrong reason in both
 * directions. `sheet.css` carries the 640px against `[data-wide='true']`, and
 * this proves the component emits the hook that rule needs — and, just as
 * importantly, that it does NOT emit it for a Panel, where it would be a
 * no-op the next reader would take for a supported option.
 */
describe('the wide sheet', () => {
  it('marks a wide Sheet and leaves a plain one unmarked', () => {
    const { rerender } = render(
      <Sheet open onClose={() => {}} label="Letter" wide>
        <button type="button">body</button>
      </Sheet>,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).toHaveAttribute('data-wide', 'true');

    rerender(
      <Sheet open onClose={() => {}} label="Letter">
        <button type="button">body</button>
      </Sheet>,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).not.toHaveAttribute('data-wide');
  });

  it('refuses to mark a Panel, where the rule does not exist', () => {
    render(
      <Panel open onClose={() => {}} label="Ask" wide>
        <button type="button">body</button>
      </Panel>,
    );
    expect(document.querySelector('.mdv-ovl--panel')).not.toHaveAttribute('data-wide');
  });
});

/**
 * Announced — sketch 103 · 1e, accepted by the founder on 2026-09-06.
 *
 * These four assertions fail against the pre-fix file (`git show
 * HEAD:…/Sheet.tsx`, measured 2026-09-06): it set
 * `aria-label={title ? undefined : label}` + `aria-labelledby={titleId}`, so on
 * every one of the sixty live rows — all of which carry a title — the REQUIRED
 * `label` reached no ear, and no `aria-describedby` existed anywhere in the
 * primitive (finder B, D1).
 */
describe('the contract sentence', () => {
  const CONTRACT =
    'This asks one thing: confirm the 10 bottles that arrived. ' +
    'Sealing writes the count to the book. Leaving writes nothing.';

  beforeEach(() => resetLabelWarnings());

  it('names the dialog with the label even when a title is on the paper', () => {
    render(
      <Panel open onClose={() => {}} label={CONTRACT} title="Delivery 119">
        <button type="button">body</button>
      </Panel>,
    );
    // The heading is still visible…
    expect(screen.getByRole('heading', { name: 'Delivery 119' })).toBeInTheDocument();
    // …and it is NOT the name.
    expect(screen.getByRole('dialog')).toHaveAccessibleName(CONTRACT);
  });

  it('renders the contract in the header and describes the dialog with it', () => {
    render(
      <Panel open onClose={() => {}} label={CONTRACT} title="Delivery 119" contract={CONTRACT}>
        <button type="button">body</button>
      </Panel>,
    );
    const dialog = screen.getByRole('dialog');
    const line = dialog.querySelector('.mdv-ovl__contract') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line).toHaveTextContent(CONTRACT);
    expect(dialog.getAttribute('aria-describedby')).toBe(line.id);
    expect(dialog).toHaveAccessibleDescription(CONTRACT);
  });

  it('describes nothing when no contract was given — an absence, not an invented one', () => {
    render(
      <Panel open onClose={() => {}} label={CONTRACT} title="Delivery 119">
        <button type="button">body</button>
      </Panel>,
    );
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('.mdv-ovl__contract')).toBeNull();
  });

  it('warns in dev when the label reads like a title, and stays quiet for a contract', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { unmount } = render(
      <Panel open onClose={() => {}} label="Ask" title="Ask the book">
        <button type="button">body</button>
      </Panel>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('reads like a title');
    unmount();

    warn.mockClear();
    render(
      <Panel open onClose={() => {}} label={CONTRACT} title="Delivery 119">
        <button type="button">body</button>
      </Panel>,
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
