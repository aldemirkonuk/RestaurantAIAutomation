/**
 * r102 menu-motion-1/2: the drop zone eases its height instead of snapping, and a
 * read shows its stage: Sending (a bar), then Kept (dots only here).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';

const css = readFileSync(join(__dirname, 'drop-zone.css'), 'utf8');

/** The body of every `@media (prefers-reduced-motion: reduce)` block, comments removed. */
function reducedBlocks(source: string): string {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const at = /@media \(prefers-reduced-motion: reduce\)\s*\{/g;
  for (let m = at.exec(code); m; m = at.exec(code)) {
    let depth = 1;
    let i = at.lastIndex;
    while (i < code.length && depth > 0) depth += code[i] === '{' ? 1 : code[i] === '}' ? -1 : 0, i++;
    out.push(code.slice(at.lastIndex, i - 1));
  }
  return out.join('\n');
}
const pdf = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
const mount = (over: Partial<React.ComponentProps<typeof DropZone>>) =>
  render(<DropZone files={[pdf]} onFiles={() => {}} reading accept="application/pdf" inputLabel="Menu to read" {...over} />);

describe('DropZone — the read has stages (r102 menu-motion-2)', () => {
  it('Sending shows a bar scaled to what was sent, and no dots', () => {
    const { container } = mount({ stage: 'sending', sent: 0.4 });
    expect(screen.getByRole('status')).toHaveTextContent('Sending');
    expect(container.querySelector('.mdv-drop__dots')).toBeNull();
    expect((container.querySelector('.mdv-drop__bar i') as HTMLElement).style.transform).toBe('scaleX(0.4)');
  });

  it('Kept is the stage that carries the dots, and has no bar', () => {
    const { container } = mount({ stage: 'kept' });
    expect(screen.getByRole('status')).toHaveTextContent('Kept, reading');
    expect(container.querySelector('.mdv-drop__dots')).not.toBeNull();
    expect(container.querySelector('.mdv-drop__bar')).toBeNull();
  });

  it('a host with no stages still says Reading', () => {
    mount({});
    expect(screen.getByRole('status')).toHaveTextContent(/^Reading$/);
  });

  it('a stage word crossfades in 160 ms, and the bar moves by transform only', () => {
    expect(css).toMatch(/\.mdv-drop__stage\s*\{[^}]*animation: mdv-drop-fade 160ms/);
    expect(css).toMatch(/\.mdv-drop__bar i\s*\{[^}]*transition: transform 160ms/);
  });

  it('under reduced motion the stage word and the bar do not animate', () => {
    const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
    expect(reduced).toMatch(/\.mdv-drop__stage\s*\{\s*animation: none/);
    expect(reduced).toMatch(/\.mdv-drop__bar i\s*\{\s*transition: none/);
  });
});

describe('DropZone — the height eases (r102 menu-motion-1)', () => {
  it('under reduced motion the zone does not ease: .mdv-drop { transition: none } sits inside the reduce block', () => {
    expect(reducedBlocks(css)).toMatch(/\.mdv-drop\s*\{\s*transition: none;?\s*\}/);
  });

  it('min-height is in the transition list, 240 ms', () => {
    expect(css).toMatch(/\.mdv-drop\s*\{[^}]*min-height 240ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  });
});
