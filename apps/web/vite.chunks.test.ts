// @vitest-environment node
import { describe, expect, it } from 'vitest'
import viteConfig from './vite.config'

describe('the build config', () => {
  /**
   * A `manualChunks` group is loaded whole by whoever imports any member. The
   * old `ui` group bundled lucide-react (used by the shell) with Tremor and
   * framer-motion, so the shell's icons pulled about 1 MB of chart code onto
   * every page.
   */
  it('groups only the React core by hand, nothing a page imports alone', () => {
    const output = viteConfig.build?.rollupOptions?.output
    const chunks = (Array.isArray(output) ? output[0] : output)?.manualChunks
    expect(chunks).toEqual({ vendor: ['react', 'react-dom', 'react-router-dom'] })
  })
})
