/**
 * Render contract for the house overlay primitive.
 *
 * These are the seven things no rebuilt page's hand-rolled overlay did, and the
 * reason a shared primitive exists at all: focus goes in, Tab stays in, Esc and
 * the scrim get you out, focus comes back to the control you opened it with,
 * the page's ground travels across the portal, and reduced motion means no
 * movement — not a shorter one. CORRECTED 2026-09-21 (ADR 0134 §6, CLAUDE.md
 * §5b): an ENTRANCE is now the one disclosed exception, a 120ms opacity-only
 * cross-fade (`REDUCED_FADE` in Sheet.tsx) — every other motion in the family
 * is unaffected and still renders none.
 */

import { useRef, useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/* `data-motion` says what the component INTENDS ('fade' under reduced motion,
   since ADR 0134 §6); this spy says what it actually scheduled. Under reduced
   motion the primitive must not call `animate()` for anything but the
   disclosed entrance fade — not call it and let it collapse to the end state
   — so the assertion has to be on the call, not on an attribute alone. */
vi.mock('../../lib/mudavym/motion', async (orig) => {
  const actual = await orig<typeof import('../../lib/mudavym/motion')>();
  return { ...actual, animate: vi.fn(actual.animate) };
});

import { Panel, Popover, Sheet } from './Sheet';
import { resetLabelWarnings, resetSheetWidth } from './overlayState';
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

/** The pointer target outside an overlay, found from the dialog it belongs to.
    Since 2026-09-17 it is hidden from assistive technology wherever the surface
    draws its own Close control, so it is found by structure, not by name. */
function scrimOf(dialogName: string): HTMLElement {
  const dialog = screen.getByRole('dialog', { name: dialogName });
  const scrim = dialog.closest('.mdv-ovl')?.querySelector<HTMLElement>('.mdv-ovl__scrim');
  if (!scrim) throw new Error(`no scrim for dialog "${dialogName}"`);
  return scrim;
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
    fireEvent.click(scrimOf('Ask'));
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

  it('renders the ADR-0134-§6 fade, not "none", under prefers-reduced-motion', () => {
    // Corrected 2026-09-21 (ADR 0134 §6, CLAUDE.md §5b): this used to assert
    // 'none'. An entrance is now the one disclosed exception — a 120ms
    // opacity-only cross-fade — so 'none' would be a false claim about a
    // surface that did, in fact, animate.
    setReducedMotion(true);
    render(<Harness shape="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'fade');
  });

  it('schedules exactly the 120ms opacity-only entrance fade under prefers-reduced-motion — nothing else', () => {
    setReducedMotion(true);
    render(<Harness shape="sheet" />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(vi.mocked(animate)).toHaveBeenCalledTimes(1);
    const [, keyframes, token, options] = vi.mocked(animate).mock.calls[0];
    expect(token).toEqual({ easing: 'linear', ms: 120 });
    expect(options).toMatchObject({ respectReducedMotion: false });
    expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
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

    fireEvent.click(scrimOf('Second'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(scrimOf('First'));
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
/* ADR 0134 §4, locked by the founder 2026-09-21 ("Lock all four (Recommended)"): a surface
   opened from the keyboard arrives with no enter animation at all, whatever the
   motion setting. The control case — the same Panel without `instant` — is in
   each pair, so a primitive that stopped animating everything would fail here
   rather than pass. */
describe('an instant surface (ADR 0134 §4)', () => {
  function Opened({ instant }: { instant?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <div className="mudavym">
        <button type="button" onClick={() => setOpen(true)}>
          opener
        </button>
        <Panel open={open} onClose={() => setOpen(false)} label="Palette" instant={instant}>
          <button type="button">row</button>
        </Panel>
      </div>
    );
  }

  it('schedules nothing and says "none" under full motion', () => {
    render(<Opened instant />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'none');
    expect(vi.mocked(animate)).not.toHaveBeenCalled();
  });

  it('schedules nothing — not even the §6 fade — under reduced motion', () => {
    setReducedMotion(true);
    render(<Opened instant />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'none');
    expect(vi.mocked(animate)).not.toHaveBeenCalled();
  });

  it('the same Panel without it still settles, and still fades under reduced motion', () => {
    const { unmount } = render(<Opened />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'settle');
    expect(vi.mocked(animate)).toHaveBeenCalledTimes(1);
    unmount();

    vi.mocked(animate).mockClear();
    setReducedMotion(true);
    render(<Opened />);
    fireEvent.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-motion', 'fade');
    expect(vi.mocked(animate)).toHaveBeenCalledTimes(1);
  });
});

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

describe('Escape — only the topmost overlay closes', () => {
  // A window-level Escape listener on every open overlay is how each one
  // closes "from anywhere" — but that means a Sheet opened from inside an
  // open Panel has two listeners on the same target, and stopPropagation()
  // does nothing for sibling listeners registered directly on `window`. One
  // Escape press used to close both.
  it('a Sheet opened from inside an open Panel: Escape closes the Sheet, not the Panel underneath', () => {
    const onClosePanel = vi.fn();
    const onCloseSheet = vi.fn();

    const panel = render(
      <Panel open onClose={onClosePanel} label="Approval">
        <p>Panel body</p>
      </Panel>,
    );
    try {
      const sheet = render(
        <Sheet open onClose={onCloseSheet} label="Vendor detail">
          <p>Sheet body</p>
        </Sheet>,
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCloseSheet).toHaveBeenCalledTimes(1);
      expect(onClosePanel).not.toHaveBeenCalled();

      // The Sheet is gone (unmounted, as a real close would do) — the Panel
      // is topmost now, and its own Escape handler should act.
      sheet.unmount();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClosePanel).toHaveBeenCalledTimes(1);
    } finally {
      panel.unmount();
    }
  });

  it('three deep: each Escape closes exactly one, innermost first', () => {
    const calls: string[] = [];
    const a = render(
      <Panel open onClose={() => calls.push('a')} label="A">
        <p>a</p>
      </Panel>,
    );
    try {
      const b = render(
        <Panel open onClose={() => calls.push('b')} label="B">
          <p>b</p>
        </Panel>,
      );
      try {
        const c = render(
          <Panel open onClose={() => calls.push('c')} label="C">
            <p>c</p>
          </Panel>,
        );

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(calls).toEqual(['c']);
        c.unmount();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(calls).toEqual(['c', 'b']);
      } finally {
        b.unmount();
      }
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(calls).toEqual(['c', 'b', 'a']);
    } finally {
      a.unmount();
    }
  });
});

describe('focus on open — cascades past a candidate that does not actually take it', () => {
  it('skips an inline-hidden first control and focuses the next real one', () => {
    // jsdom's own HTMLElement.focus() is more permissive than a real
    // browser's — it moves activeElement onto a `display:none` element
    // without complaint, which is exactly the gap `focusables()`'s own
    // comment names (jsdom reports no layout for anything, so a filter on
    // computed visibility would pass tests for the wrong reason). That gap
    // is why this defect was invisible to a unit test in the first place —
    // so this test stubs `.focus()` to the one rule a real browser actually
    // enforces (a `display:none` element cannot become
    // `document.activeElement`) and checks that the open-focus cascade
    // — try, verify, move to the next candidate — reacts correctly when a
    // `.focus()` call silently does nothing.
    const nativeFocus = HTMLElement.prototype.focus;
    const spy = vi
      .spyOn(HTMLElement.prototype, 'focus')
      .mockImplementation(function (this: HTMLElement, ...args) {
        if (this.style.display === 'none') return;
        nativeFocus.apply(this, args as never);
      });
    const rendered = render(
      // showClose=false: this test is about the CHILD candidate order, not
      // the header's own Close control (which would otherwise be the first
      // focusable element, and correctly so).
      <Panel open onClose={() => {}} label="Form" showClose={false}>
        {/* A first child styled invisible by an inline style — the same
            observable effect a compiled Tailwind `hidden md:block` utility
            has in a real browser, and the one case `focusables()` cannot
            see (it checks the `hidden` ATTRIBUTE, not computed display). */}
        <button style={{ display: 'none' }}>invisible first</button>
        <button>real target</button>
      </Panel>,
    );
    try {
      expect(document.activeElement).toBe(screen.getByText('real target'));
    } finally {
      rendered.unmount();
      spy.mockRestore();
    }
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
    // A label that differs from the contract: when the two are the same
    // sentence the description is dropped so it is not heard twice (see
    // "describes nothing twice" below).
    render(
      <Panel
        open
        onClose={() => {}}
        label="Confirm delivery 119: sealing writes the count, leaving writes nothing."
        title="Delivery 119"
        contract={CONTRACT}
      >
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

/**
 * The Pass — sketch 103 · 1a, accepted 2026-09-06.
 *
 * Against the pre-sketch-103 file every one of these fails: `data-scrim` did
 * not exist, so a Sheet dimmed the page exactly as a Panel did, and nothing on
 * the page was ever told a sheet had opened.
 *
 * The scrim default is the interim reading while OD-123 is open (2026-09-17): a
 * Sheet gives up light only where its page gave up columns (`compress`). The
 * lane's first cut turned it off for every Sheet, leaving the live callers over
 * a lit page the scrim still made unclickable.
 */
describe('a sheet takes width, never light', () => {
  beforeEach(() => {
    resetLabelWarnings();
    resetSheetWidth();
  });

  it('paints no scrim for a Sheet laid beside the list, and one for a Panel', () => {
    const { unmount } = render(
      <div className="mudavym">
        <Sheet open onClose={() => {}} label="The sheet takes width, never light" layout="compress">
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).toHaveAttribute('data-scrim', 'off');
    unmount();

    render(
      <div className="mudavym">
        <Panel open onClose={() => {}} label="A question dims the page behind it">
          <button type="button">body</button>
        </Panel>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl--panel')).toHaveAttribute('data-scrim', 'on');
  });

  it('keeps the dim on a Sheet whose page has not laid it beside the list (OD-123 interim)', () => {
    render(
      <div className="mudavym">
        <Sheet open onClose={() => {}} label="This sheet sits over a page with no compress rule">
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).toHaveAttribute('data-scrim', 'on');
  });

  it('still moves focus in, still closes on Esc, and still locks the body', () => {
    // 1a changes the PAINT. Everything the primitive exists for is unchanged.
    function H() {
      const [open, setOpen] = useState(false);
      return (
        <div className="mudavym">
          <button type="button" onClick={() => setOpen(true)}>
            opener
          </button>
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            label="This asks nothing and writes nothing"
            layout="compress"
          >
            <button type="button">inside</button>
          </Sheet>
        </div>
      );
    }
    render(<H />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('lets an explicit scrim win over the layout, both ways', () => {
    const { unmount } = render(
      <div className="mudavym">
        <Sheet open onClose={() => {}} label="This one wants the page taken away" layout="compress" scrim>
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).toHaveAttribute('data-scrim', 'on');
    unmount();

    render(
      <div className="mudavym">
        <Sheet open onClose={() => {}} label="This one asks for no dim at all" scrim={false}>
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl--sheet')).toHaveAttribute('data-scrim', 'off');
  });

  it('tells the page a sheet is beside it, and takes it back on close', () => {
    function H() {
      const [open, setOpen] = useState(true);
      return (
        <div className="mudavym" data-testid="page">
          <button type="button" onClick={() => setOpen(false)}>
            leave
          </button>
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            label="This asks nothing and writes nothing"
            layout="compress"
          >
            <button type="button">body</button>
          </Sheet>
        </div>
      );
    }
    render(<H />);
    const page = screen.getByTestId('page');
    expect(page).toHaveAttribute('data-sheet-open', 'compress');
    expect(page.style.getPropertyValue('--sheet-width')).toBe('440px');

    fireEvent.click(screen.getByRole('button', { name: 'leave' }));
    expect(page.hasAttribute('data-sheet-open')).toBe(false);
    expect(page.style.getPropertyValue('--sheet-width')).toBe('');
  });

  it('gives a wide sheet its own width, and never marks the overlay root itself', () => {
    render(
      <div className="mudavym" data-testid="page">
        <Sheet open onClose={() => {}} label="A letter is prose read back as prose" wide>
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(screen.getByTestId('page').style.getPropertyValue('--sheet-width')).toBe('640px');
    // The overlay root is a `.mudavym` too — it must never be mistaken for the
    // page and told about itself.
    expect(document.querySelector('.mdv-ovl')).not.toHaveAttribute('data-sheet-open');
  });

  it('says nothing to the page for a Panel or a Popover', () => {
    render(
      <div className="mudavym" data-testid="page">
        <Panel open onClose={() => {}} label="A question dims the page behind it">
          <button type="button">body</button>
        </Panel>
      </div>,
    );
    expect(screen.getByTestId('page')).not.toHaveAttribute('data-sheet-open');
  });
});

/* ── fixes from the lane A audit (2026-09-17) ─────────────────────────────
   Each test names the judge's probe it closes. Every one of them fails against
   the lane's first cut (codex/page-finalization 6ab500a0); see A-fix.md. */
describe('the scrim, the name and the nudge', () => {
  beforeEach(() => {
    resetLabelWarnings();
    resetSheetWidth();
  });

  it('hides the scrim from assistive technology where a Close control is the named way out', () => {
    render(
      <Panel open onClose={() => {}} label="This asks one thing and writes nothing when you leave." title="Ask">
        <button type="button">body</button>
      </Panel>,
    );
    const scrim = scrimOf('This asks one thing and writes nothing when you leave.');
    expect(scrim).toHaveAttribute('aria-hidden', 'true');
    expect(scrim).toHaveAttribute('tabindex', '-1');
    // One control named Close, not a second one named "Close <the sentence>".
    expect(screen.getAllByRole('button', { name: /^Close/ })).toHaveLength(1);
  });

  it('keeps the scrim as the named way out of a popover with no Close control', () => {
    function P() {
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <div className="mudavym">
          <button type="button" ref={anchor}>theme</button>
          <Popover open anchorRef={anchor} onClose={() => {}} label="Theme">
            <button type="button">Dark</button>
          </Popover>
        </div>
      );
    }
    render(<P />);
    expect(screen.getByRole('button', { name: 'Close Theme' })).toBeInTheDocument();
  });

  /* Judge probe J7: the "reads like a title" nudge fired for a menu. */
  it('does not nudge a popover or a menu to write a contract sentence', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function P() {
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <div className="mudavym">
          <button type="button" ref={anchor}>theme</button>
          <Popover open anchorRef={anchor} onClose={() => {}} label="Theme">
            <button type="button">Dark</button>
          </Popover>
        </div>
      );
    }
    render(<P />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('describes nothing twice — a contract equal to the label is shown, not re-announced', () => {
    const SENTENCE = 'This asks one thing. Sealing writes the count. Leaving writes nothing.';
    render(
      <Panel open onClose={() => {}} label={SENTENCE} contract={SENTENCE} title="Delivery 119">
        <button type="button">body</button>
      </Panel>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.mdv-ovl__contract')).toHaveTextContent(SENTENCE);
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });
});

describe('leaving mid-tear', () => {
  /* Judge probe J3: Close clicked while a tear's tuck runs called onClose twice. */
  it('calls onClose exactly once when Close is clicked during the tear', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const onTear = vi.fn();
      render(
        <div className="mudavym">
          <Sheet open onClose={onClose} onTear={onTear} dirty title="Note" label="A note on the order. Saving writes it; leaving holds it on the row.">
            <textarea defaultValue="x" />
          </Sheet>
        </div>,
      );
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onTear).toHaveBeenCalledWith('esc');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a page root that arrives after the sheet', () => {
  beforeEach(() => resetSheetWidth());

  /* Judge probe J8: `data-sheet-open` was painted only at open and close, so a
     page root mounted later never learned a sheet was beside it. */
  it('is told a sheet is open when it mounts, and told again when the sheet closes', async () => {
    function Late() {
      const [late, setLate] = useState(false);
      const [open, setOpen] = useState(true);
      return (
        <>
          <div className="mudavym" data-testid="early" />
          {late ? (
            <section>
              <div className="mudavym" data-testid="late" />
            </section>
          ) : null}
          <Sheet open={open} onClose={() => setOpen(false)} layout="compress" label="This shows the order. Nothing here writes; leaving costs nothing.">
            <button type="button" onClick={() => setLate(true)}>mount late</button>
          </Sheet>
        </>
      );
    }
    render(<Late />);
    expect(screen.getByTestId('early')).toHaveAttribute('data-sheet-open', 'compress');
    fireEvent.click(screen.getByRole('button', { name: 'mount late' }));
    // MutationObserver callbacks are microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    const late = screen.getByTestId('late');
    expect(late).toHaveAttribute('data-sheet-open', 'compress');
    expect(late.style.getPropertyValue('--sheet-width')).toBe('440px');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(late).not.toHaveAttribute('data-sheet-open');
    expect(screen.getByTestId('early')).not.toHaveAttribute('data-sheet-open');
  });
});
