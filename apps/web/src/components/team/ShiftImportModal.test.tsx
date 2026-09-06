/**
 * No success without an import.
 *
 * The modal's apply path used to be a 1200ms `setTimeout`, a
 * `toast.success("Successfully imported N shifts…")` and an `onImportComplete`
 * callback that made the desk refetch — over no network request at all, with N
 * derived from the file's byte size (`Math.floor(size / 80)`). Every assertion
 * below is about a claim the screen used to make and cannot make now.
 *
 * The picker itself is real and stays: choosing files is the half that worked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import { ShiftImportModal } from './ShiftImportModal';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function selectAFile(bytes = 8000) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array(bytes)], 'week.csv', { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return file;
}

describe('ShiftImportModal — the import is not built, and says so', () => {
  const onImportComplete = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says on the modal that nothing is imported', () => {
    render(<ShiftImportModal open onClose={vi.fn()} onImportComplete={onImportComplete} />);
    expect(screen.getByRole('note')).toHaveTextContent(/not built yet/i);
    expect(screen.getByRole('note')).toHaveTextContent(/nothing here writes a shift/i);
  });

  it('keeps the picker and lists a chosen file', () => {
    render(<ShiftImportModal open onClose={vi.fn()} onImportComplete={onImportComplete} />);
    selectAFile();
    expect(screen.getByText('week.csv')).toBeInTheDocument();
  });

  it('never prints a shift count derived from the file size', () => {
    render(<ShiftImportModal open onClose={vi.fn()} onImportComplete={onImportComplete} />);
    // 8000 bytes / 80 was "100 shifts" beside a green tick.
    selectAFile(8000);
    expect(screen.queryByText(/100 shifts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ shifts/)).not.toBeInTheDocument();
    expect(screen.getByText(/read, not parsed/i)).toBeInTheDocument();
  });

  it('leaves the import control disabled even with files chosen', () => {
    render(<ShiftImportModal open onClose={vi.fn()} onImportComplete={onImportComplete} />);
    selectAFile();
    const apply = screen.getByRole('button', { name: /^import/i });
    expect(apply).toBeDisabled();
  });

  it('reports no success and completes no import, however it is pressed', () => {
    render(<ShiftImportModal open onClose={vi.fn()} onImportComplete={onImportComplete} />);
    selectAFile();
    // A disabled button ignores the click; the assertions are about what did
    // NOT happen, which is the whole point of this file.
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onImportComplete).not.toHaveBeenCalled();
  });

  it('still refuses a file type it cannot read', () => {
    render(<ShiftImportModal open onClose={vi.fn()} onImportComplete={onImportComplete} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });
});
