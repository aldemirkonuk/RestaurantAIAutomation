/**
 * The command palette's insight entry advertises no hard-coded type count.
 *
 * [2026-09-28, ADR 0149 cutover: this file also held the legacy
 * `pages/InsightCatalog.tsx` (`typeStatus`, `CoverageMeter`) to ADR 0020. That
 * page was deleted (CUTOVER-MANIFEST-2026-09-28.md, group `recommendations`);
 * the Mudavym catalogue carries the same honesty in
 * `recommendations/next/rec-catalog.test.ts` and `CatalogView.test.tsx`. The
 * palette entry below is live and stays.]
 */

import { describe, it, expect } from 'vitest'
import { staticCommands } from '../../components/command/commands'

describe('command palette insight entry', () => {
  it('advertises no hard-coded type count', () => {
    // It said "Browse all 375 insight types" against a 573-type catalogue. The
    // catalogue is generated, so any literal here goes stale silently; the
    // count belongs on the page, next to the data that produces it.
    const browse = staticCommands().find((c) => c.id === 'insight-browse')
    expect(browse).toBeDefined()
    expect(browse!.title).not.toMatch(/\d/)
    expect(`${browse!.title} ${browse!.keywords ?? ''}`).not.toContain('375')
  })
})
