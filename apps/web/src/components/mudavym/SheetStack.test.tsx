/**
 * The Spindle — sketch 103 · 1c, and ADR 0112 · F9.
 *
 * Against the pre-fix primitive none of this could even be attempted: it had a
 * `zIndex` and a counted scroll lock and nothing else, so there was no depth to
 * name, no cap to enforce, and — the point of 1c — no way to SAY the cap
 * (finder B, D4).
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

import { Panel, Sheet } from './Sheet';
import { resetLabelWarnings, resetSheetWidth } from './overlayState';
import { SheetStackProvider } from './SheetStack';
import { SHEET_STACK_REFUSAL } from './sheetStackContext';

/** matchMedia, answering both the reduced-motion and the phone query. */
function setMedia({ reduced = false, phone = false } = {}) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (query: string) => ({
      matches: query.includes('prefers-reduced-motion')
        ? reduced
        : query.includes('max-width: 639px')
          ? phone
          : false,
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

const NAMES = ['Order 118', 'Öküzgözü', 'Answers', 'The fourth'];

/** Four sheets, each opened by the one before it — the real nesting shape. */
function Spindle({ levels = 3, phoneForm = false }: { levels?: number; phoneForm?: boolean }) {
  const [open, setOpen] = useState<number>(levels);
  void phoneForm;
  return (
    <SheetStackProvider>
      <div className="mudavym">
        {NAMES.slice(0, levels).map((name, i) => (
          <Sheet
            key={name}
            open={open > i}
            onClose={() => setOpen(i)}
            title={name}
            label={`This shows ${name}. Nothing here writes; leaving costs nothing.`}
          >
            <button type="button">{`body ${i}`}</button>
          </Sheet>
        ))}
      </div>
    </SheetStackProvider>
  );
}

beforeEach(() => {
  setMedia();
  resetLabelWarnings();
  resetSheetWidth();
  document.body.style.overflow = '';
});

describe('depth is visible, not stacked', () => {
  it('draws no spine for a single sheet', () => {
    render(<Spindle levels={1} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('.mdv-ovl__spine')).toBeNull();
  });

  it('keeps an underlying level in place when its title changes', () => {
    function ChangingTitle() {
      const [title, setTitle] = useState('Order 118');
      return <SheetStackProvider><div className="mudavym">
        <Sheet open onClose={() => {}} title={title} label="This shows the order. Nothing here writes.">
          <button type="button">First sheet</button>
        </Sheet>
        <Sheet open onClose={() => {}} title="Bottle" label="This shows a bottle. Nothing here writes.">
          <button type="button" onClick={() => setTitle('Order 119')}>Rename parent</button>
        </Sheet>
      </div></SheetStackProvider>;
    }
    render(<ChangingTitle />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename parent' }));
    const spine = document.querySelector('.mdv-ovl__spine') as HTMLElement;
    expect(within(spine).getByRole('button', { name: /Order 119/ })).toBeInTheDocument();
    expect(spine.textContent).toMatch(/Order 119.*Bottle/);
    expect(within(spine).queryByRole('button', { name: /Bottle/ })).toBeNull();
  });

  it('names every level on the top sheet, and only on the top sheet', () => {
    render(<Spindle levels={3} />);
    const spines = document.querySelectorAll('.mdv-ovl__spine');
    expect(spines).toHaveLength(1);
    const spine = spines[0] as HTMLElement;
    expect(within(spine).getByRole('button', { name: 'Order 118' })).toBeInTheDocument();
    expect(within(spine).getByRole('button', { name: 'Öküzgözü' })).toBeInTheDocument();
    // The level you are on is not a control back to itself.
    expect(within(spine).queryByRole('button', { name: 'Answers' })).toBeNull();
    expect(within(spine).getByText('Answers')).toBeInTheDocument();
    expect(within(spine).getByText('Depth 3 of 3')).toBeInTheDocument();
  });

  it('leaves to any level in a single touch', () => {
    render(<Spindle levels={3} />);
    expect(screen.getAllByRole('dialog')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Order 118' }));
    // Everything above level 0 is gone; level 0 stays.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.querySelector('.mdv-ovl__spine')).toBeNull();
  });

  it('refuses a fourth level in words, on the paper, and opens no fourth sheet', () => {
    render(<Spindle levels={4} />);
    expect(screen.getAllByRole('dialog')).toHaveLength(3);
    const said = screen.getByRole('alert');
    expect(said).toHaveTextContent(SHEET_STACK_REFUSAL);
    expect(said).toHaveAttribute('aria-live', 'assertive');
    // The way out is named in the sentence itself.
    expect(said).toHaveTextContent(/Close one to open this/);
    // And nothing was silently dropped: the fourth level's own body is absent.
    expect(screen.queryByText('body 3')).toBeNull();
  });

  it('takes the refusal back when a level is closed', () => {
    render(<Spindle levels={4} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Order 118' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still moves focus into the top sheet when levels open together', () => {
    // Two levels opening in one commit: the focus effect of each asks the
    // provider whether it holds a level, and the last one to act is the top.
    render(<Spindle levels={2} />);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs[dialogs.length - 1]).toContainElement(document.activeElement as HTMLElement);
  });

  /* Judge probe J1 (2026-09-17). The lane's own test above cannot see this: its
     harness closes every level above the one closed, the waiting one included.
     Here each sheet has its own state, the way sibling sheets on a real page
     do. Against the lane's first cut: 2 dialogs, the refusal still on the
     paper saying three are open, and the fourth sheet never rendered. */
  it('admits a waiting sheet the moment a sibling level closes, and takes the sentence back', () => {
    function Siblings() {
      const [open, setOpen] = useState([true, true, true, true]);
      const close = (i: number) => setOpen((o) => o.map((v, j) => (j === i ? false : v)));
      return (
        <SheetStackProvider>
          <div className="mudavym">
            {['A1', 'B2', 'C3', 'D4'].map((n, i) => (
              <Sheet
                key={n}
                open={open[i]}
                onClose={() => close(i)}
                title={n}
                label={`This shows ${n}. Nothing here writes; leaving costs nothing.`}
              >
                <button type="button">{`body ${n}`}</button>
              </Sheet>
            ))}
          </div>
        </SheetStackProvider>
      );
    }
    render(<Siblings />);
    expect(screen.getAllByRole('dialog')).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent(SHEET_STACK_REFUSAL);
    expect(screen.queryByText('body D4')).toBeNull();

    // Close the middle level by its own Close control.
    const b2 = screen.getByRole('dialog', { name: /This shows B2/ });
    fireEvent.click(within(b2).getByRole('button', { name: 'Close' }));

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(3);
    expect(screen.getByText('body D4')).toBeInTheDocument();
    // The sentence goes when nothing is waiting — it cannot outlive its truth.
    expect(screen.queryByRole('alert')).toBeNull();
    // The admitted sheet is the top: it draws the spine, and it has focus.
    const d4 = screen.getByRole('dialog', { name: /This shows D4/ });
    const spine = d4.querySelector('.mdv-ovl__spine') as HTMLElement;
    expect(spine).not.toBeNull();
    expect(spine.textContent).toMatch(/A1.*C3.*D4/);
    expect(d4).toContainElement(document.activeElement as HTMLElement);
    // And Escape now belongs to it.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('body D4')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
  });

  /* Judge probe J6a (2026-09-17): a Sheet and a Panel mounted in ONE commit
     under the provider — a deep link, a restored draft. The lane's first cut
     made the stacked Sheet live a commit late, so it registered for Escape
     after the Panel: Escape closed the Sheet behind (panel 0, sheet 1) and
     focus landed in the Sheet. Without a provider the same markup was right. */
  it('keeps the topmost-Escape rule for a Sheet and a Panel opened in the same commit', () => {
    const closeSheet = vi.fn();
    const closePanel = vi.fn();
    render(
      <SheetStackProvider>
        <div className="mudavym">
          <Sheet open onClose={closeSheet} title="Order" label="This shows the order. Nothing here writes; leaving costs nothing.">
            <button type="button">in the sheet</button>
          </Sheet>
          <Panel open onClose={closePanel} title="Ask" label="This asks one question. Answering writes nothing yet.">
            <button type="button">in the panel</button>
          </Panel>
        </div>
      </SheetStackProvider>,
    );
    const panel = screen.getByRole('dialog', { name: /This asks one question/ });
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    // Painted in tree order too: the Panel's root is after the Sheet's.
    const roots = Array.from(document.querySelectorAll('.mdv-ovl'));
    expect(roots.map((r) => r.getAttribute('data-shape'))).toEqual(['sheet', 'panel']);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(closeSheet).not.toHaveBeenCalled();
  });

  /* Judge probe J2 (2026-09-17): a spine jump called each level's `onClose`
     directly, so a dirty level left with no stub — `onTear` 0 calls. */
  it('tears a dirty level when the spine jumps over it, rather than dropping its draft', () => {
    const onTear = vi.fn();
    function Two() {
      const [open, setOpen] = useState(2);
      return (
        <SheetStackProvider>
          <div className="mudavym">
            <Sheet open={open > 0} onClose={() => setOpen(0)} title="Order 118" label="This shows the order. Nothing here writes; leaving costs nothing.">
              <button type="button">b0</button>
            </Sheet>
            <Sheet
              open={open > 1}
              onClose={() => setOpen(1)}
              title="Note"
              dirty
              onTear={onTear}
              label="A note on this order. Saving writes it; leaving holds it on the row."
            >
              <textarea defaultValue="half a sentence" />
            </Sheet>
          </div>
        </SheetStackProvider>
      );
    }
    setMedia({ reduced: true });
    render(<Two />);
    fireEvent.click(screen.getByRole('button', { name: 'Order 118' }));
    expect(onTear).toHaveBeenCalledTimes(1);
    expect(onTear).toHaveBeenCalledWith('spine');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('puts a short word on the spine, never the contract sentence', () => {
    render(
      <SheetStackProvider>
        <div className="mudavym">
          <Sheet open onClose={() => {}} title="Order 118" label="This shows the order. Nothing here writes; leaving costs nothing.">
            <button type="button">b0</button>
          </Sheet>
          <Sheet
            open
            onClose={() => {}}
            title={<span>Öküzgözü <em>2019</em></span>}
            eyebrow="Wine"
            label="This shows one wine from the order. Nothing here writes; leaving costs nothing."
          >
            <button type="button">b1</button>
          </Sheet>
          <Sheet
            open
            onClose={() => {}}
            title={<span>Answers</span>}
            label="This shows what the vendor answered. Nothing here writes; leaving costs nothing."
          >
            <button type="button">b2</button>
          </Sheet>
        </div>
      </SheetStackProvider>,
    );
    const spine = document.querySelector('.mdv-ovl__spine') as HTMLElement;
    expect(within(spine).getByRole('button', { name: 'Wine' })).toBeInTheDocument();
    expect(within(spine).getByText('Sheet')).toBeInTheDocument();
    expect(spine.textContent).not.toMatch(/Nothing here writes/);
  });

  it('caps nothing outside a page — no provider, no spine, no refusal', () => {
    render(
      <div className="mudavym">
        {NAMES.map((n) => (
          <Sheet key={n} open onClose={() => {}} title={n} label={`This shows ${n} and writes nothing at all.`}>
            <button type="button">{n}</button>
          </Sheet>
        ))}
      </div>,
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(4);
    expect(document.querySelector('.mdv-ovl__spine')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the phone form — detents and one breadcrumb (F9)', () => {
  beforeEach(() => setMedia({ phone: true }));
  afterEach(() => vi.useRealTimers());

  /* Judge probe J9 (2026-09-17): an inline `detents` array is a new array on
     every render, and the reset effect depended on its identity — the reader's
     chosen height snapped back to `full` after one parent tick. */
  it('keeps the reader\'s height across a parent re-render with an inline detents array', () => {
    vi.useFakeTimers();
    function Ticking() {
      const [n, setN] = useState(0);
      return (
        <div className="mudavym" data-tick={n}>
          <button type="button" onClick={() => setN((x) => x + 1)}>tick</button>
          <Sheet
            open
            onClose={() => {}}
            title="Order"
            label="This shows the order. Nothing here writes; leaving costs nothing."
            detents={['peek', 'half', 'full']}
          >
            <button type="button" onClick={() => setN((x) => x + 1)}>tick inside</button>
          </Sheet>
        </div>
      );
    }
    render(<Ticking />);
    const root = () => document.querySelector('.mdv-ovl') as HTMLElement;
    fireEvent.keyDown(screen.getByRole('button', { name: /Sheet height/ }), { key: 'ArrowDown' });
    expect(root()).toHaveAttribute('data-detent', 'half');
    fireEvent.click(screen.getByRole('button', { name: 'tick inside' }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(root()).toHaveAttribute('data-detent', 'half');
  });

  /* Judge probe J10: the phone form still told the page 440px, so a page's
     `padding-right: var(--sheet-width)` would pad a 375px screen by 440px. */
  it('tells the page the bottom sheet takes no width', () => {
    render(
      <div className="mudavym" data-testid="page">
        <Sheet open onClose={() => {}} layout="compress" label="This shows the order. Nothing here writes; leaving costs nothing.">
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl')).toHaveAttribute('data-form', 'bottom');
    const page = screen.getByTestId('page');
    expect(page).toHaveAttribute('data-sheet-open', 'compress');
    expect(page.style.getPropertyValue('--sheet-width')).toBe('0px');
  });

  /* Judge minor 12: `useIsPhone` started `false`, so a sheet mounted already
     open painted its first commit in the desktop form. A child's layout effect
     runs in that first commit, before any passive effect could correct it. */
  it('is in the phone form from its first commit, not one frame later', () => {
    const seen: (string | null)[] = [];
    function Probe() {
      const ref = useRef<HTMLSpanElement>(null);
      useLayoutEffect(() => {
        seen.push(ref.current?.closest('.mdv-ovl')?.getAttribute('data-form') ?? null);
      }, []);
      return <span ref={ref}>probe</span>;
    }
    render(
      <div className="mudavym">
        <Sheet open onClose={() => {}} label="This shows the order. Nothing here writes; leaving costs nothing.">
          <Probe />
        </Sheet>
      </div>,
    );
    expect(seen).toEqual(['bottom']);
  });

  it('rests on the bottom edge at the full detent, with a grabber', () => {
    render(<Spindle levels={1} />);
    const root = document.querySelector('.mdv-ovl--sheet') as HTMLElement;
    expect(root).toHaveAttribute('data-form', 'bottom');
    expect(root).toHaveAttribute('data-detent', 'full');
    expect(screen.getByRole('button', { name: /Sheet height/ })).toBeInTheDocument();
  });

  it('cycles the detents on a tap — a drag-only handle fails SC 2.5.7', () => {
    render(<Spindle levels={1} />);
    const grab = screen.getByRole('button', { name: /Sheet height/ });
    const root = () => document.querySelector('.mdv-ovl--sheet') as HTMLElement;
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 300 });
    expect(root()).toHaveAttribute('data-detent', 'peek');
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 300 });
    expect(root()).toHaveAttribute('data-detent', 'half');
  });

  it('steps with the arrow keys, and snaps a drag to the next height', () => {
    render(<Spindle levels={1} />);
    const grab = screen.getByRole('button', { name: /Sheet height/ });
    const root = () => document.querySelector('.mdv-ovl--sheet') as HTMLElement;
    fireEvent.keyDown(grab, { key: 'ArrowDown' });
    expect(root()).toHaveAttribute('data-detent', 'half');
    fireEvent.keyDown(grab, { key: 'ArrowDown' });
    expect(root()).toHaveAttribute('data-detent', 'peek');
    // Down the screen is shorter, up is taller.
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 200 });
    expect(root()).toHaveAttribute('data-detent', 'half');
  });

  it('cycles on native keyboard activation without double-counting pointer clicks', () => {
    render(<Spindle levels={1} />);
    const grab = screen.getByRole('button', { name: /Sheet height/ });
    const root = () => document.querySelector('.mdv-ovl');
    fireEvent.click(grab, { detail: 0 });
    expect(root()).toHaveAttribute('data-detent', 'peek');
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 300 });
    fireEvent.click(grab, { detail: 1 });
    expect(root()).toHaveAttribute('data-detent', 'half');
  });

  it('draws no grabber when there is only one height to move between', () => {
    render(
      <div className="mudavym">
        <Sheet open onClose={() => {}} title="One height" detents={['full']} label="This rests at one height and writes nothing.">
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    expect(screen.queryByRole('button', { name: /Sheet height/ })).toBeNull();
  });

  it('shows the same three levels as one breadcrumb', () => {
    render(<Spindle levels={3} />);
    const spines = document.querySelectorAll('.mdv-ovl__spine');
    expect(spines).toHaveLength(1);
    expect(within(spines[0] as HTMLElement).getByRole('button', { name: 'Order 118' })).toBeInTheDocument();
  });
});
