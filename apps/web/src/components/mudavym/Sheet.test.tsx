/**
 * Sheet.test.tsx — the two behaviors this module's most recent pass fixed,
 * plus a smoke test that the primitive renders and unmounts cleanly.
 *
 * Not a general regression suite for every prop this file has (motion,
 * ground resolution, popover positioning, body-scroll counting): those are
 * either exercised indirectly wherever a page adopts the primitive, or are
 * straightforward enough that a smoke render covers them. These three are
 * here because they were WRONG, found by review, and fixed in this same
 * change — a green run here is the evidence the fix works, not a claim
 * about the rest of the file.
 *
 * Every render is unmounted before its test returns (never left to the
 * global RTL `afterEach(cleanup)`): the stacking logic under test lives in
 * a module-level array, so a render left dangling between tests silently
 * poisons the next one — the exact way a `Sheet` opened in production and
 * never closed would poison a page's next overlay, which is precisely the
 * class of bug this file exists to catch.
 */
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Panel, Sheet } from './Sheet';

function escape() {
  fireEvent.keyDown(window, { key: 'Escape' });
}

describe('Sheet/Panel — smoke', () => {
  it('renders its content when open and nothing when closed', () => {
    const { rerender, unmount } = render(
      <Sheet open onClose={() => {}} label="Test sheet">
        <p>Sheet body</p>
      </Sheet>,
    );
    try {
      expect(screen.getByText('Sheet body')).toBeTruthy();
      rerender(
        <Sheet open={false} onClose={() => {}} label="Test sheet">
          <p>Sheet body</p>
        </Sheet>,
      );
      expect(screen.queryByText('Sheet body')).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe('Escape — only the topmost overlay closes', () => {
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

      escape();
      expect(onCloseSheet).toHaveBeenCalledTimes(1);
      expect(onClosePanel).not.toHaveBeenCalled();

      // The Sheet is gone (unmounted, as a real close would do) — the Panel
      // is topmost now, and its own Escape handler should act.
      sheet.unmount();
      escape();
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

        escape();
        expect(calls).toEqual(['c']);
        c.unmount();
        escape();
        expect(calls).toEqual(['c', 'b']);
      } finally {
        b.unmount();
      }
      escape();
      expect(calls).toEqual(['c', 'b', 'a']);
    } finally {
      a.unmount();
    }
  });
});

describe('Focus on open — cascades past a candidate that does not actually take it', () => {
  it('skips an inline-hidden first control and focuses the next real one', () => {
    // jsdom's own HTMLElement.focus() is more permissive than a real
    // browser's — it moves activeElement onto a `display:none` element
    // without complaint, which is exactly the gap the code comment on
    // `focusables()` names ("jsdom reports every element as focusable
    // regardless of layout"). That gap is why the bug this test guards
    // against was invisible to jsdom in the first place, and it means this
    // one test cannot exercise the real defect through jsdom's real
    // behavior — so it stubs `.focus()` to the one rule a real browser
    // actually enforces (a `display:none` element cannot become
    // `document.activeElement`) and checks that THIS module's cascade
    // logic — try, verify, move to the next candidate — reacts correctly
    // when a `.focus()` call silently does nothing. That is the part this
    // change actually added; the browser's own enforcement is not this
    // codebase's to test.
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

  it('still honours an explicit initialFocusRef when it is actually focusable', () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement | null>(null);
      return (
        <Panel open onClose={() => {}} label="Form" showClose={false} initialFocusRef={ref}>
          <button>first</button>
          <button ref={ref}>wanted</button>
        </Panel>
      );
    }
    const rendered = render(<Harness />);
    try {
      expect(document.activeElement).toBe(screen.getByText('wanted'));
    } finally {
      rendered.unmount();
    }
  });
});
