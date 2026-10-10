/**
 * F-613: "Read a menu" on /cellar opened a hand-built overlay that was not a
 * dialog — no role, no Escape, focus left on the page behind, and an unnamed
 * X. It now sits in the house Panel. These tests drive it the way a keyboard
 * and a screen reader meet it.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MenuScannerModal } from './MenuScannerModal';

function Host({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Read a menu
      </button>
      {open ? (
        <MenuScannerModal
          isOpen
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onWinesDetected={() => {}}
        />
      ) : null}
    </div>
  );
}

describe('MenuScannerModal — a real dialog (F-613)', () => {
  it('is a named modal dialog with a named close button, and focus moves in', async () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Read a menu' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: /^Read a menu\./ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape closes it and focus returns to "Read a menu"', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Read a menu' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('every button inside it has a name', async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Read a menu' }));
    const dialog = await screen.findByRole('dialog');
    for (const b of Array.from(dialog.querySelectorAll('button'))) {
      expect((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()).not.toBe('');
    }
  });
});
