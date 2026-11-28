import { describe, expect, it } from 'vitest';
import { amountUnit, isPoured, orderUnitOf } from './iv-amount';

describe('amountUnit: what is typed for a good, in its own unit (ADR 0070)', () => {
  it('a good kept in grams takes kg with up to three places, a comma or a point', () => {
    const g = amountUnit('g');
    expect(g.parse('2.25')).toBe(2250);
    expect(g.parse('2,25')).toBe(2250);
    expect(g.parse('12.0')).toBe(12_000);
    expect(g.parse('12 kg')).toBe(12_000);
    expect(g.parse('0.035 kg')).toBe(35);
    expect(g.parse('250 g')).toBe(250);
    expect(g.parse('250g')).toBe(250);
  });

  it('asks about a bare whole number, since 500 could be grams or kilograms', () => {
    const g = amountUnit('g');
    expect(g.parse('500')).toBeNull();
    expect(g.why('500')).toBe('Say which: 500 g or 500 kg.');
    expect(g.parse('500 g')).toBe(500);
    expect(g.parse('500 kg')).toBe(500_000);
    expect(g.why('500 g')).toBeNull();
    expect(g.why('0.5')).toBeNull();
    // Zero is zero in any unit, so a count to empty is one keystroke.
    expect(g.parse('0')).toBe(0);
    expect(g.why('0')).toBeNull();
    const ml = amountUnit('ml');
    expect(ml.parse('2')).toBeNull();
    expect(ml.why('1500')).toBe('Say which: 1,500 ml or 1,500 l.');
    expect(amountUnit('bottle').why('500')).toBeNull();
  });

  it('refuses what is not a whole gram, never rounding it', () => {
    const g = amountUnit('g');
    expect(g.parse('2.5 g')).toBeNull();
    expect(g.parse('1.2345')).toBeNull();
    expect(g.parse('-1')).toBeNull();
    expect(g.parse('two')).toBeNull();
    expect(g.parse('3 lb')).toBeNull();
    expect(g.parse('')).toBeNull();
  });

  it('a good kept in ml takes l, cl or ml', () => {
    const ml = amountUnit('ml');
    expect(ml.parse('1.5')).toBe(1500);
    expect(ml.parse('70 cl')).toBe(700);
    expect(ml.parse('7.5 cl')).toBe(75);
    expect(ml.parse('330 ml')).toBe(330);
    expect(ml.parse('0.05 cl')).toBeNull();
  });

  it('says an amount in kg or l from 1,000 up', () => {
    expect(amountUnit('g').words(11_750)).toBe('11.75 kg');
    expect(amountUnit('g').words(650)).toBe('650 g');
    expect(amountUnit('ml').words(1500)).toBe('1.5 l');
  });

  it('a counted good takes a whole number only', () => {
    const b = amountUnit(null);
    expect(b.base).toBe('bottle');
    expect(b.parse('6')).toBe(6);
    expect(b.parse('6.5')).toBeNull();
    expect(b.words(1)).toBe('1 bottle');
    expect(amountUnit('each').words(3)).toBe('3 items');
    expect(amountUnit('case').fieldUnit).toBe('cases');
  });
});

describe('which acts fit a good', () => {
  it('only a bottle or a keg of a drink is poured', () => {
    expect(isPoured(null, 'wine')).toBe(true);
    expect(isPoured('keg', 'beer')).toBe(true);
    expect(isPoured('g', 'food')).toBe(false);
    expect(isPoured('bottle', 'food')).toBe(false);
    expect(isPoured('each', 'supply')).toBe(false);
  });

  it('an order is placed only in a unit that is the book’s own, one to one', () => {
    expect(orderUnitOf(null)).toBe('bottle');
    expect(orderUnitOf('each')).toBe('each');
    expect(orderUnitOf('keg')).toBe('keg');
    expect(orderUnitOf('g')).toBeNull();
    expect(orderUnitOf('ml')).toBeNull();
    expect(orderUnitOf('case')).toBeNull();
  });
});
