import { beforeEach, describe, expect, it } from 'vitest';
import { firstLoadThisSession, resetFirstLoad } from './firstLoad';

beforeEach(() => {
  resetFirstLoad();
  window.sessionStorage.clear();
});

describe('firstLoadThisSession', () => {
  it('is true once per key, then false', () => {
    expect(firstLoadThisSession('a')).toBe(true);
    expect(firstLoadThisSession('a')).toBe(false);
    expect(firstLoadThisSession('b')).toBe(true);
  });
  it('stays false after a reload of the page (memory cleared, session kept)', () => {
    expect(firstLoadThisSession('a')).toBe(true);
    resetFirstLoad();
    expect(firstLoadThisSession('a')).toBe(false);
  });
  it('still answers once per load when storage throws', () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(firstLoadThisSession('c')).toBe(true);
      expect(firstLoadThisSession('c')).toBe(false);
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});
