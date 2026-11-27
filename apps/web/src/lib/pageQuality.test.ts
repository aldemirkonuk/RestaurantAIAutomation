import { describe, expect, it } from 'vitest';
import { BLUR_MIN, CONTRAST_MIN, SMALL_EDGE, checkPage, checkPixels, qualityKind } from './pageQuality';

const SIZE = 128;

function make(fn: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = fn(x, y);
      const i = (y * SIZE + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: SIZE, height: SIZE };
}

function boxBlur(src: ReturnType<typeof make>, r: number) {
  return make((x, y) => {
    let s = 0;
    let c = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
        s += src.data[(yy * SIZE + xx) * 4];
        c++;
      }
    return s / c;
  });
}

const checker = make((x, y) => ((x + y) % 2 ? 255 : 0));
// Pale text strokes on black: a chalkboard menu, dark by mean brightness.
const chalk = make((x, y) => (x % 8 < 3 && y % 12 < 6 ? 235 : 12));

describe('checkPixels', () => {
  it('does not call a sharp pattern blurred', () => {
    expect(checkPixels(checker).blurred).toBe(false);
  });
  it('calls the same pattern box-blurred at radius 4 blurred', () => {
    expect(checkPixels(boxBlur(checker, 4)).blurred).toBe(true);
  });
  it('does not call white-on-black text flat, nor dark', () => {
    const q = checkPixels(chalk);
    expect(q.flat).toBe(false);
    expect(q.blurred).toBe(false);
    expect(Object.keys(q)).not.toContain('dark');
  });
  it('calls a uniform grey flat', () => {
    expect(checkPixels(make(() => 128)).flat).toBe(true);
  });
  it('exports the thresholds', () => {
    expect([BLUR_MIN, CONTRAST_MIN, SMALL_EDGE].every((n) => n > 0)).toBe(true);
  });
});

describe('checkPage', () => {
  it('calls a source under 1000 px on its long edge small, before any canvas work', () => {
    const q = checkPage({ width: 640, height: 900 } as unknown as ImageBitmap);
    expect(q.small).toBe(true);
  });
});

describe('qualityKind', () => {
  it('says the worst one first and nothing for a good page', () => {
    expect(qualityKind({ blurred: true, flat: true, small: true })).toBe('flat');
    expect(qualityKind({ blurred: true, flat: false, small: true })).toBe('blurred');
    expect(qualityKind({ blurred: false, flat: false, small: true })).toBe('small');
    expect(qualityKind({ blurred: false, flat: false, small: false })).toBeNull();
    expect(qualityKind(null)).toBeNull();
  });
});
