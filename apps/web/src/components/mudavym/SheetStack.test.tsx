/**
 * The Spindle — sketch 103 · 1c, and ADR 0112 · F9.
 *
 * Against the pre-fix primitive none of this could even be attempted: it had a
 * `zIndex` and a counted scroll lock and nothing else, so there was no depth to
 * name, no cap to enforce, and — the point of 1c — no way to SAY the cap
 * (finder B, D4).
 */

import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { Sheet, resetLabelWarnings, resetSheetWidth } from './Sheet';
import { SheetStackProvider, SHEET_STACK_REFUSAL } from './SheetStack';

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

  it('still moves focus into a sheet that had to wait for its level', () => {
    // The admission lands on the second commit; without `shown` in the focus
    // effect's deps the sheet would render with focus still on the page.
    render(<Spindle levels={2} />);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs[dialogs.length - 1]).toContainElement(document.activeElement as HTMLElement);
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
