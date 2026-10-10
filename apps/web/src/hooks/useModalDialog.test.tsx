/**
 * useModalDialog — the dialog behaviour the older inventory modals lacked
 * (F-321): focus moves in and comes back, Escape closes, Tab stays inside, and
 * a modal opened from inside one closes on its own Escape first.
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useModalDialog } from './useModalDialog';

function Modal({ onClose, children }: { onClose: () => void; children?: React.ReactNode }) {
  const ref = useModalDialog(true, onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Count" tabIndex={-1}>
      <button type="button">First</button>
      <button type="button">Last</button>
      {children}
    </div>
  );
}

function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

describe('useModalDialog', () => {
  it('moves focus into the dialog, and Escape closes it and returns focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('an Escape inside a modal opened from it closes only the inner one', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    const inner = vi.fn();
    const portal = document.createElement('div');
    document.body.appendChild(portal);
    function Inner() {
      const ref = useModalDialog(true, inner);
      return (
        <div ref={ref} role="dialog" aria-label="Inner" tabIndex={-1}>
          <button type="button">Inside</button>
        </div>
      );
    }
    const { createPortal } = await import('react-dom');
    render(<Modal onClose={outer}>{createPortal(<Inner />, portal)}</Modal>);

    screen.getByRole('button', { name: 'Inside' }).focus();
    await user.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    portal.remove();
  });

  it('an Escape a control inside already handled does not close the dialog (F-1037)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <button
          type="button"
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.preventDefault();
          }}
        >
          Open list
        </button>
      </Modal>,
    );

    screen.getByRole('button', { name: 'Open list' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
