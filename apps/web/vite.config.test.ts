// @vitest-environment node
import { describe, expect, it } from 'vitest'
import config from './vite.config'

/**
 * The dev server pre-bundles lucide-react into one file. Excluded, every icon
 * is a separate module request: about 3,100 of the 3,466 files one dashboard
 * load asked for (r17 request-flood walk, 2026-11-13).
 */
describe('vite dev server dependencies', () => {
  it('pre-bundles lucide-react instead of serving each icon as its own request', () => {
    const exclude = config.optimizeDeps?.exclude ?? []
    expect(exclude).not.toContain('lucide-react')
  })
})
