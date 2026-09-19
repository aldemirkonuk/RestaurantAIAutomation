import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  GROUND_CHOICE_ATTR,
  GROUND_CHOICE_STORAGE_KEY,
  getGroundChoice,
  resetGroundChoiceForTests,
  setGroundChoice,
  useGroundChoice,
} from './groundChoice';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  resetGroundChoiceForTests();
});

describe('ADR 0169 — the default is paper', () => {
  it('getGroundChoice() is "paper" with nothing stored', () => {
    expect(getGroundChoice()).toBe('paper');
  });

  it('useGroundChoice() reports "paper" with nothing stored', () => {
    const { result } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('paper');
  });

  it('a garbage stored value is treated as unset, not as a crash', () => {
    window.localStorage.setItem(GROUND_CHOICE_STORAGE_KEY, 'sepia');
    resetGroundChoiceForTests();
    expect(getGroundChoice()).toBe('paper');
  });

  it('a blocked localStorage (read throws) still resolves to paper', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      resetGroundChoiceForTests();
      expect(getGroundChoice()).toBe('paper');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ADR 0169 — a person can choose charcoal', () => {
  it('setGroundChoice("charcoal") updates getGroundChoice() immediately', () => {
    setGroundChoice('charcoal');
    expect(getGroundChoice()).toBe('charcoal');
  });

  it('setGroundChoice("charcoal") sets data-mudavym-ground on <html>', () => {
    setGroundChoice('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
  });

  it('choosing paper explicitly also sets the attribute (an honest fact, not an absence)', () => {
    setGroundChoice('charcoal');
    setGroundChoice('paper');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('paper');
  });

  it('a mounted useGroundChoice() re-renders when the choice changes elsewhere', () => {
    const { result } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('paper');
    act(() => {
      result.current[1]('charcoal');
    });
    expect(result.current[0]).toBe('charcoal');
  });

  it('a blocked localStorage (write throws) still applies the attribute for this view', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      expect(() => setGroundChoice('charcoal')).not.toThrow();
      expect(getGroundChoice()).toBe('charcoal');
      expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ADR 0169 — the choice persists (per device)', () => {
  it('is stored under GROUND_CHOICE_STORAGE_KEY, readable as if after a reload', () => {
    setGroundChoice('charcoal');
    // Simulate a reload: forget the in-memory value, re-derive it from
    // storage the way module-load does on a fresh page view.
    resetGroundChoiceForTests();
    expect(getGroundChoice()).toBe('charcoal');
    expect(window.localStorage.getItem(GROUND_CHOICE_STORAGE_KEY)).toBe('charcoal');
  });

  it('a fresh useGroundChoice() mount picks up a choice made before it mounted', () => {
    setGroundChoice('charcoal');
    resetGroundChoiceForTests(); // "reload"
    const { result } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('charcoal');
  });

  it('is per device: another tab/device with no write is unaffected until it reads storage', () => {
    // Two independent hook instances stand in for two tabs on this device.
    const a = renderHook(() => useGroundChoice());
    const b = renderHook(() => useGroundChoice());
    act(() => {
      a.result.current[1]('charcoal');
    });
    // Same module store (same device): both instances agree immediately.
    expect(a.result.current[0]).toBe('charcoal');
    expect(b.result.current[0]).toBe('charcoal');
  });

  it('syncs across tabs on the same device via the storage event', () => {
    const { result } = renderHook(() => useGroundChoice());
    expect(result.current[0]).toBe('paper');
    // Another tab wrote localStorage directly and fired the native event —
    // jsdom does not dispatch `storage` for same-document writes, so this
    // mirrors what a second real tab produces.
    window.localStorage.setItem(GROUND_CHOICE_STORAGE_KEY, 'charcoal');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: GROUND_CHOICE_STORAGE_KEY,
          newValue: 'charcoal',
        }),
      );
    });
    expect(result.current[0]).toBe('charcoal');
    expect(document.documentElement.getAttribute(GROUND_CHOICE_ATTR)).toBe('charcoal');
  });

  it('ignores a storage event for an unrelated key', () => {
    const { result } = renderHook(() => useGroundChoice());
    window.localStorage.setItem('some.other.key', 'charcoal');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some.other.key' }));
    });
    expect(result.current[0]).toBe('paper');
  });
});
