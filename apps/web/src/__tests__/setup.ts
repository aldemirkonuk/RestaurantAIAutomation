/**
 * Vitest Setup File
 * 
 * This file runs before each test file.
 * Use it to set up global test utilities and mocks.
 */

// Pin the suite's timezone to a non-UTC zone BEFORE anything touches Date.
// CI runners are UTC, where a naive UTC-midnight parse of a date-only value
// is indistinguishable from a correct local-calendar-day parse — every
// date-rendering assertion would be a no-op there (Opus review 2026-08-31).
process.env.TZ = 'America/New_York';

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Guard all window-dependent setup so tests that run in the node environment
// (e.g. files annotated with // @vitest-environment node) don't crash.
if (typeof window !== 'undefined') {
  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock scrollTo
  window.scrollTo = vi.fn() as typeof window.scrollTo;

  // Mock localStorage with a real store so persistence tests work correctly.
  // Wrapped in vi.fn() so call history remains inspectable.
  const _store: Record<string, string> = {};
  const localStorageMock = {
    getItem: vi.fn((key: string) => _store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { _store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete _store[key]; }),
    clear: vi.fn(() => { Object.keys(_store).forEach((k) => { delete _store[k]; }); }),
  };
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

// Mock ResizeObserver (available in both jsdom and node globals)
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

// Suppress console errors during tests (optional)
// vi.spyOn(console, 'error').mockImplementation(() => {});
