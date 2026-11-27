import { describe, expect, it } from 'vitest';
import { readMake, scaledAmount, scaledCost } from './recipeScale';

describe('recipeScale', () => {
  it('N = 1 is the identity', () => {
    expect(scaledAmount(50, 1, 'ml')).toBe('50 ml');
    expect(scaledAmount(0.1, 1, 'each')).toBe('0.1 each');
    expect(scaledCost(2.11, 1)).toBe(2.11);
  });
  it('N = 12 on 50 ml and 0.1 of a piece', () => {
    expect(scaledAmount(50, 12, 'ml')).toBe('600 ml');
    expect(scaledAmount(0.1, 12, 'each')).toBe('1.2 each');
  });
  it('keeps the line\'s own unit (no conversion) and the dash plural', () => {
    expect(scaledAmount(2, 12, 'dash')).toBe('24 dashes');
    expect(scaledAmount(30, 100, 'ml')).toBe('3000 ml');
  });
  it('the lines are for the whole recipe: N serves is N / yieldServes of them (r107f)', () => {
    expect(scaledAmount(200, 2, 'ml', 4)).toBe('100 ml');
    expect(scaledAmount(200, 4, 'ml', 4)).toBe('200 ml');
    expect(scaledAmount(50, 12, 'ml', 1)).toBe('600 ml');
  });
  it('a large amount is shown to its precision, never as "about"', () => {
    expect(scaledAmount(1234.5678, 12, 'g')).toBe('14814.814 g');
  });
  it('the cost is N x the serve, to the cent once', () => {
    expect(scaledCost(2.11, 12)).toBe(25.32);
    expect(scaledCost(2.105, 3)).toBe(6.32);
  });
  it('reads a whole number from 1 to 200 and nothing else', () => {
    expect(readMake('12')).toBe(12);
    expect(readMake(' 200 ')).toBe(200);
    for (const bad of ['0', '201', '-3', '1.5', '', 'abc', '1,5', '12x']) expect(readMake(bad)).toBeNull();
  });
});
