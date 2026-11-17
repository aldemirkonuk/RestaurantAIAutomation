import { describe, expect, it } from 'vitest';
import { doorAge } from './doorAge';

describe('doorAge', () => {
  it('says hours under two days', () => {
    expect(doorAge(5, 'fresh')).toBe('5h ago');
    expect(doorAge(30.4, 'stale')).toBe('30h ago');
    expect(doorAge(47.4, 'stale')).toBe('47h ago');
  });
  it('says whole days from two days on', () => {
    expect(doorAge(48, 'stale')).toBe('2 days ago');
    expect(doorAge(7199, 'stale')).toBe('299 days ago');
  });
  it('marks an overdue count in words', () => {
    expect(doorAge(7199, 'overdue')).toBe('299 days ago, overdue');
    expect(doorAge(40, 'overdue')).toBe('40h ago, overdue');
  });
  it('never draws a negative age', () => {
    expect(doorAge(-3, 'fresh')).toBe('0h ago');
  });
});
