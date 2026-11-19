import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'connections-next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// r74 walk: the five-column register row needs 1142 px beside the sidebar and the
// rail; it stacked only up to 1080 px, so 1081 to 1141 px scrolled the page sideways.
describe('connections-next.css row stacking', () => {
  it('stacks the register row at or below 1150 px, so no width scrolls sideways', () => {
    const m = css.match(/@media \(max-width: (\d+)px\) \{\s*\.mudavym \.cx-row \{\s*grid-template-columns: 24px minmax\(0, 1fr\)/);
    expect(m, 'a max-width media rule that stacks .cx-row').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1150);
  });
});
