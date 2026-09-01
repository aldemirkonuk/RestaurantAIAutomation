/**
 * ADR 0020 — the insight-catalogue coverage meter must not present the roadmap
 * as a capability.
 *
 * `/recommendations/catalog` enumerates 573 candidate types. Roughly two dozen
 * have a generator behind them (`insight-implementations.ts`, guarded against
 * the generator source by `insight-implementations.spec.ts`). The shipped meter
 * decided "computable now" from DATA AVAILABILITY ALONE, so a restaurant with a
 * POS feed was shown a number an order of magnitude past what the engine can
 * produce. ADR 0020: *"A mislabelled number is a fabrication."*
 *
 * `typeStatus` is asserted directly rather than through a render because the
 * decision is what matters: "not built" must not be reachable by connecting
 * data, and an unknown must stay unknown instead of collapsing to a boolean.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { typeStatus, CoverageMeter } from '../InsightCatalog'
import { staticCommands } from '../../components/command/commands'

afterEach(cleanup)

const built = { implemented: true, requires: ['checks'] }
const roadmap = { implemented: false, requires: ['checks'] }

describe('typeStatus — ADR 0020', () => {
  it('calls a type computable only when it is built AND the data is there', () => {
    expect(typeStatus(built, new Set(['checks']))).toBe('computable')
  })

  it('never calls an unbuilt type computable, however complete the data', () => {
    // The whole defect: data availability alone used to be the entire test.
    expect(typeStatus(roadmap, new Set(['checks', 'tables', 'goals']))).toBe(
      'not_built',
    )
  })

  it('separates "blocked on data" from "not built" — they are different fixes', () => {
    expect(typeStatus(built, new Set([]))).toBe('blocked')
    expect(typeStatus(roadmap, new Set([]))).toBe('not_built')
  })

  it('says unknown when the visitor is signed out rather than guessing', () => {
    expect(typeStatus(built, null)).toBe('unknown')
  })

  it('says unknown when the API predates the implemented flag', () => {
    // A missing field must not read as "not built" — that would understate the
    // count as badly as the old meter overstated it.
    expect(typeStatus({ requires: ['checks'] }, new Set(['checks']))).toBe(
      'unknown',
    )
  })

  it('treats a type with no data requirements as built-or-not, never free', () => {
    expect(typeStatus({ implemented: true, requires: [] }, new Set())).toBe(
      'computable',
    )
    expect(typeStatus({ implemented: false, requires: [] }, new Set())).toBe(
      'not_built',
    )
  })
})

describe('CoverageMeter — what the owner actually reads', () => {
  const REAL = {
    catalogued: 573,
    implemented: 24,
    computable: 24,
    blockedOnData: 0,
    notBuilt: 549,
  }

  it('shows the built count as computable, not the catalogue size', () => {
    render(<CoverageMeter total={573} coverage={REAL} />)
    const text = screen.getByText(/computable now/).textContent ?? ''
    expect(text).toContain('24 computable now')
    // The number the shipped meter would have shown for the same restaurant.
    expect(text).not.toContain('573 computable')
  })

  it('keeps the catalogue visible, labelled as catalogued', () => {
    render(<CoverageMeter total={573} coverage={REAL} />)
    // The roadmap is legitimate — it just may not be called a capability.
    expect(screen.getByText(/573 catalogued/)).toBeTruthy()
  })

  it('names the two different reasons a type is not computable', () => {
    render(
      <CoverageMeter
        total={573}
        coverage={{ ...REAL, computable: 14, blockedOnData: 10 }}
      />,
    )
    const text = screen.getByText(/computable now/).textContent ?? ''
    expect(text).toContain('10 blocked on missing data')
    expect(text).toContain('549 not built yet')
  })

  it('asks the visitor to sign in rather than showing a data-free count', () => {
    render(
      <CoverageMeter
        total={573}
        coverage={{ ...REAL, computable: null, blockedOnData: null }}
      />,
    )
    expect(screen.getByText(/sign in to see/)).toBeTruthy()
    expect(screen.queryByText(/computable now/)).toBeNull()
  })

  it('admits it cannot split the catalogue when the server sent no coverage', () => {
    render(<CoverageMeter total={573} coverage={null} />)
    expect(screen.getByText(/coverage unavailable/)).toBeTruthy()
    expect(screen.queryByText(/computable now/)).toBeNull()
  })
})

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
