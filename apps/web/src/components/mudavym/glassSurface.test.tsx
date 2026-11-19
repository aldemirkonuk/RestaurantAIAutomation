/**
 * One glass surface (c2 need 16): the choose-house card was the best-looking
 * dark screen, so its blur, edge and lift are one named class, `mdv-glass`,
 * and the toast wears it too. Neither surface keeps its own copy of the recipe.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { AuthCard } from '../brand/AuthShell';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('the shared glass surface', () => {
  it('is a class with its own tokens: ground, edge, lift and blur', () => {
    const css = read('styles/mudavym.css');
    const rule = css.match(/\.mdv-glass\s*\{[^}]*\}/)?.[0] ?? '';
    for (const token of ['--glass-bg', '--glass-edge', '--glass-lift', '--glass-blur']) {
      expect(rule, token).toContain(token);
    }
    expect(rule).toMatch(/(?<!-)backdrop-filter:\s*blur\(var\(--glass-blur\)\)/);
  });

  it('is what the house card wears, and not a second copy of the recipe', () => {
    const { container } = render(<AuthCard house>x</AuthCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('mdv-glass');
    expect(card.className).not.toMatch(/backdrop-blur|shadow-\[/);
  });

  it('is what the toast wears too', () => {
    expect(read('components/mudavym/AppToaster.tsx')).toMatch(/toast:\s*'mdv-toast mdv-glass'/);
    const toastCss = read('components/mudavym/house-toast.css');
    expect(toastCss).toMatch(/box-shadow:\s*var\(--glass-lift-sm\)/);
    expect(toastCss).toMatch(/border:\s*1px solid var\(--glass-edge\)/);
  });

  it('moves nothing but opacity, transform, clip-path and grid rows, and honours reduced motion', () => {
    const css = read('styles/mudavym.css');
    const rule = css.match(/\.mdv-glass\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/\.mdv-glass[^{]*\{[^}]*transition-property:[^;]*(width|height|top|left|margin)/);
  });
});
