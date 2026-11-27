/**
 * The advisory look at each page before Read (r110 g2): said under the page,
 * never blocking, run once per file, still under reduced motion (ADR 0112).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/pageQuality', async (orig) => ({
  ...(await orig<typeof import('../../lib/pageQuality')>()),
  checkFile: vi.fn(),
}));
import { checkFile } from '../../lib/pageQuality';
import { DropZone } from './DropZone';

const css = readFileSync(join(__dirname, 'drop-pages.css'), 'utf8');
const fine = { blurred: false, flat: false, small: false };
const page = (n: number) => new File(['x'], `q${n}-${Math.random()}.jpg`, { type: 'image/jpeg' });

function media(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: coarse && q.includes('pointer: coarse'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  cleanup();
  vi.mocked(checkFile).mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
  media(false);
});

function mount(files: File[], extra: Partial<React.ComponentProps<typeof DropZone>> = {}) {
  const onFiles = vi.fn();
  const view = render(<DropZone files={files} onFiles={onFiles} accept="image/*" multiple inputLabel="Menu to read" {...extra} />);
  return { onFiles, view };
}

describe('the page check, said under the page', () => {
  it('says a blurred page, in words, and leaves Read to the host', async () => {
    const [a, b] = [page(1), page(2)];
    vi.mocked(checkFile).mockImplementation(async (f) => (f === b ? { ...fine, blurred: true } : fine));
    mount([a, b]);
    expect((await screen.findByTestId('page-quality-hint')).textContent).toBe('Page 2 looks blurred. Retake it, or Read anyway.');
    expect(screen.getAllByTestId('page-quality-hint')).toHaveLength(1);
    // Nothing in the drop zone is disabled by the finding: the host's Read stays its own.
    expect(screen.getByRole('button', { name: 'Change' }).hasAttribute('disabled')).toBe(false);
  });

  it('says little contrast and a small source', async () => {
    const [a, b] = [page(1), page(2)];
    vi.mocked(checkFile).mockImplementation(async (f) => (f === a ? { ...fine, flat: true } : { ...fine, small: true }));
    mount([a, b]);
    await waitFor(() => expect(screen.getAllByTestId('page-quality-hint')).toHaveLength(2));
    const t = screen.getAllByTestId('page-quality-hint').map((n) => n.textContent);
    expect(t[0]).toBe('Page 1 has little contrast. Retake it, or Read anyway.');
    expect(t[1]).toBe('Page 2 is small; text may not read. Retake it, or Read anyway.');
  });

  it('says it under the single photo too', async () => {
    vi.mocked(checkFile).mockResolvedValue({ ...fine, blurred: true });
    mount([page(1)]);
    expect((await screen.findByTestId('page-quality-hint')).textContent).toBe('This photo looks blurred. Retake it, or Read anyway.');
  });

  it('runs once per file: a reorder does not run it again', async () => {
    const [a, b] = [page(1), page(2)];
    vi.mocked(checkFile).mockResolvedValue({ ...fine, blurred: true });
    const { view, onFiles } = mount([a, b]);
    await waitFor(() => expect(screen.getAllByTestId('page-quality-hint')).toHaveLength(2));
    expect(checkFile).toHaveBeenCalledTimes(2);
    view.rerender(<DropZone files={[b, a]} onFiles={onFiles} accept="image/*" multiple inputLabel="Menu to read" />);
    expect(screen.getAllByTestId('page-quality-hint')).toHaveLength(2);
    expect(checkFile).toHaveBeenCalledTimes(2);
  });

  it('says nothing for a good page', async () => {
    vi.mocked(checkFile).mockResolvedValue(fine);
    mount([page(1), page(2)]);
    await waitFor(() => expect(checkFile).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('page-quality-hint')).toBeNull();
  });
});

describe('Retake on a phone', () => {
  it('replaces that page only, through a picker that keeps the other pages', async () => {
    media(true);
    const [a, b, c] = [page(1), page(2), page(3)];
    vi.mocked(checkFile).mockImplementation(async (f) => (f === b ? { ...fine, blurred: true } : fine));
    const { onFiles } = mount([a, b, c]);
    const btn = await screen.findByRole('button', { name: 'Retake' });
    const input = screen.getByLabelText('Page 2: retake') as HTMLInputElement;
    const fresh = page(9);
    fireEvent.change(input, { target: { files: [fresh] } });
    const [sent, mode] = onFiles.mock.calls[0] as [File[], string];
    // Files compare equal by value in matchers: identity is what says which page was replaced.
    expect(sent.map((f) => f === a || f === fresh || f === c)).toEqual([true, true, true]);
    expect([sent[0] === a, sent[1] === fresh, sent[2] === c]).toEqual([true, true, true]);
    expect(mode).toBe('replace');
    expect(btn).toBeTruthy();
  });

  it('offers no Retake button on a mouse', async () => {
    vi.mocked(checkFile).mockResolvedValue({ ...fine, blurred: true });
    mount([page(1), page(2)]);
    await screen.findAllByTestId('page-quality-hint');
    expect(screen.queryByRole('button', { name: 'Retake' })).toBeNull();
  });
});

describe('motion (ADR 0112)', () => {
  it('rises 4 px over 160 ms with no stagger, has no exit, and none of it runs under reduced motion', () => {
    expect(css).toMatch(/\.mdv-qhint__line\s*{[^}]*animation:\s*mdv-qhint-in 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\) both;/);
    expect(css).toMatch(/@keyframes mdv-qhint-in\s*{\s*from\s*{\s*opacity: 0;\s*transform: translateY\(4px\);/);
    expect(css).not.toMatch(/mdv-qhint[^{]*{[^}]*animation-delay/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.mdv-qhint__line\s*{\s*animation:\s*none;/);
    expect(css).toMatch(/\.mdv-qhint\s*{[^}]*min-height: 3\.9em;/);
  });

  it('draws the line with no running animation under reduced motion', async () => {
    vi.mocked(checkFile).mockResolvedValue({ ...fine, blurred: true });
    mount([page(1), page(2)]);
    const line = await screen.findAllByTestId('page-quality-hint');
    // jsdom applies no stylesheet: nothing inline may animate either.
    for (const n of line) {
      expect((n as HTMLElement).style.animation).toBe('');
      expect(((n as HTMLElement).getAnimations?.() ?? []).length).toBe(0);
    }
  });
});
