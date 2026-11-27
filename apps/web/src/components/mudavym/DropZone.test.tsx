/**
 * The drop zone: idle, dragging, held, reading, and the camera first on touch
 * (r58, N-14).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';

const css = readFileSync(join(__dirname, 'drop-zone.css'), 'utf8');

function coarse(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: on && query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const pdf = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });

function mount(over: Partial<React.ComponentProps<typeof DropZone>> = {}) {
  const onFiles = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <DropZone files={[]} onFiles={onFiles} onClear={onClear} accept="image/*,application/pdf" multiple inputLabel="Menu to read" {...over} />,
  );
  return { onFiles, onClear, ...utils };
}

beforeEach(() => coarse(false));
afterEach(() => vi.restoreAllMocks());

describe('idle', () => {
  it('invites a drop in words and keeps the real, labelled file input', () => {
    mount();
    expect(screen.getByText('Drop a menu, a photo, or a PDF')).toBeTruthy();
    expect(screen.getByLabelText('Menu to read').getAttribute('type')).toBe('file');
    expect(screen.queryByRole('button', { name: /Take a photo/ })).toBeNull();
  });

  it('a picked file is handed over as a replacement', () => {
    const { onFiles } = mount();
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [pdf] } });
    expect(onFiles).toHaveBeenCalledWith([pdf], 'replace');
  });

  it('Enter on the zone opens the picker', () => {
    mount();
    const input = screen.getByLabelText('Menu to read');
    const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByText('Drop a menu, a photo, or a PDF').closest('[role="button"]') as HTMLElement, { key: 'Enter' });
    expect(click).toHaveBeenCalled();
  });
});

describe('dragging and dropping', () => {
  it('shows the held state while a file is over the box and hands over what is dropped', () => {
    const { onFiles, container } = mount();
    const zone = container.querySelector('.mdv-drop') as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: { files: [pdf] } });
    expect(zone.getAttribute('data-state')).toBe('dragging');
    fireEvent.drop(zone, { dataTransfer: { files: [pdf] } });
    expect(zone.getAttribute('data-state')).toBe('idle');
    expect(onFiles).toHaveBeenCalledWith([pdf], 'replace');
  });

  it('a single-file zone keeps only the first of several dropped', () => {
    const second = new File(['x'], 'b.pdf', { type: 'application/pdf' });
    const { onFiles, container } = mount({ multiple: false });
    fireEvent.drop(container.querySelector('.mdv-drop') as HTMLElement, { dataTransfer: { files: [pdf, second] } });
    expect(onFiles).toHaveBeenCalledWith([pdf], 'replace');
  });

  it('a disabled zone takes nothing', () => {
    const { onFiles, container } = mount({ disabled: true });
    fireEvent.drop(container.querySelector('.mdv-drop') as HTMLElement, { dataTransfer: { files: [pdf] } });
    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe('held and reading', () => {
  it('names the file and its size, with Change and Clear', () => {
    const { onClear } = mount({ files: [pdf] });
    expect(screen.getByText('menu.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('says how many pages when several are held', () => {
    mount({ files: [pdf, new File(['x'], 'p2.jpg', { type: 'image/jpeg' })] });
    expect(screen.getByText('2 pages')).toBeTruthy();
  });

  it('while reading says so, with three dots, and offers no Change', () => {
    const { container } = mount({ files: [pdf], reading: true });
    expect(screen.getByRole('status').textContent).toMatch(/Reading/);
    expect(container.querySelectorAll('.mdv-drop__dots i')).toHaveLength(3);
    expect(container.querySelector('.mdv-drop')?.getAttribute('data-state')).toBe('reading');
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});

describe('on a touch device', () => {
  it('offers the camera first, full width, and a photo taken is added to the pages held', () => {
    coarse(true);
    const photo = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    const { onFiles } = mount();
    const cam = screen.getByRole('button', { name: 'Take a photo of the menu' });
    expect(cam.className).toMatch(/mdv-drop__camera/);
    const input = screen.getByLabelText('Menu to read: take a photo');
    expect(input.getAttribute('capture')).toBe('environment');
    fireEvent.change(input, { target: { files: [photo] } });
    expect(onFiles).toHaveBeenCalledWith([photo], 'add');
  });

  it('a phone holding one page offers Take the next page, and a photo taken there is added, not replaced', () => {
    coarse(true);
    const photo = new File(['x'], 'p2.jpg', { type: 'image/jpeg' });
    const one = new File(['x'], 'p1.jpg', { type: 'image/jpeg' });
    const { onFiles } = mount({ files: [one] });
    expect(screen.queryByRole('button', { name: 'Take a photo of the menu' })).toBeNull();
    const next = screen.getByRole('button', { name: 'Take the next page' });
    expect(css).toMatch(/\.mdv-drop__next\s*\{[^}]*min-height: 44px/);
    const input = screen.getByLabelText('Menu to read: take a photo');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(next);
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [photo] } });
    expect(onFiles).toHaveBeenCalledWith([photo], 'add');
  });

  it('no next-page button while reading, or for a single-file host', () => {
    coarse(true);
    const one = new File(['x'], 'p1.jpg', { type: 'image/jpeg' });
    mount({ files: [one], reading: true });
    expect(screen.queryByRole('button', { name: 'Take the next page' })).toBeNull();
  });

  it('on a desktop, Add pages opens a second picker and what it picks is added', () => {
    const one = new File(['x'], 'p1.jpg', { type: 'image/jpeg' });
    const two = new File(['x'], 'p2.jpg', { type: 'image/jpeg' });
    const { onFiles } = mount({ files: [one] });
    const input = screen.getByLabelText('Menu to read: add pages');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Add pages' }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [two] } });
    expect(onFiles).toHaveBeenCalledWith([two], 'add');
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('is a 56 px button', () => {
    expect(css).toMatch(/\.mdv-drop__camera\s*\{[^}]*min-height: 56px/);
  });
});

describe('the stylesheet', () => {
  it('is 180 px of 1.5 px dashed hairline that breathes 1.01 over 1.6 s', () => {
    expect(css).toMatch(/\.mdv-drop\s*\{[^}]*min-height: 180px/);
    expect(css).toMatch(/border: 1\.5px dashed/);
    expect(css).toMatch(/animation: mdv-drop-breathe 1\.6s/);
    expect(css).toMatch(/50%\s*\{\s*transform: scale\(1\.01\)/);
  });

  it('stops every animation under reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.mdv-drop\[data-state='dragging'\][\s\S]*animation: none/);
    expect(reduced).toMatch(/\.mdv-drop__dots i\s*\{\s*animation: none/);
  });

  it('moves only transform and opacity, and never transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/);
    for (const f of css.match(/@keyframes [\w-]+\s*\{[\s\S]*?\n\}/g) ?? [])
      expect(f).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
});
