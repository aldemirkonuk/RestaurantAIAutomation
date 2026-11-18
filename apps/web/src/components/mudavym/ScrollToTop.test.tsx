import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { ScrollToTop } from './ScrollToTop';

let go: (to: string | number, opts?: { replace?: boolean }) => void = () => {};
function Nav() {
  const nav = useNavigate();
  go = (to, o) => (typeof to === 'number' ? nav(to) : nav(to, o));
  return null;
}
const scrollTo = vi.fn();
beforeEach(() => {
  scrollTo.mockReset();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});
function mount() {
  render(
    <MemoryRouter initialEntries={['/a']}>
      <ScrollToTop />
      <Nav />
      <Routes><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  );
}

describe('ScrollToTop', () => {
  it('does nothing on first paint', () => {
    mount();
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('resets to the top when a link opens a different path', () => {
    mount();
    act(() => go('/b'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
  it('leaves a same-path change (a query) alone', () => {
    mount();
    act(() => go('/a?tab=2'));
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('leaves Back to the browser own restoration', () => {
    mount();
    act(() => go('/b'));
    scrollTo.mockReset();
    act(() => go(-1));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
