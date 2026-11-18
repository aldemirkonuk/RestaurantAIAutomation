import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AttachmentRow, WHY_COLLAPSE_AT } from './AttachmentRow';

const base = {
  icon: null,
  title: 'Mail',
  owner: "the house's",
  last: null,
  stopNote: 'A manager stops it.',
};

describe('AttachmentRow why-line (r58 N-04)', () => {
  it('keeps a short sentence in view', () => {
    const { container } = render(<AttachmentRow {...base} why="Letters go out from here." />);
    expect(container.querySelector('details.cx-row-why')).toBeNull();
    expect(container.querySelector('div.cx-row-why')?.textContent).toBe('Letters go out from here.');
  });

  it('folds a long sentence behind "Why it is here", closed to start', () => {
    const long = 'x'.repeat(WHY_COLLAPSE_AT + 1);
    const { container } = render(<AttachmentRow {...base} why={long} />);
    const d = container.querySelector('details.cx-row-why') as HTMLDetailsElement;
    expect(d).not.toBeNull();
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')?.textContent).toBe('Why it is here');
    expect(d.textContent).toContain(long);
  });

  it('never folds a non-text why, which may carry a control', () => {
    const { container } = render(<AttachmentRow {...base} why={<b>{'y'.repeat(300)}</b>} />);
    expect(container.querySelector('details.cx-row-why')).toBeNull();
  });
});
