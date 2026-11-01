import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { EndpaperShell } from './EndpaperShell'
import { leaf, turn } from '../../lib/mudavym/motion'

/**
 * The book frame itself — sketch 118 Direction B. Per-screen copy and field
 * behaviour are covered where each screen lives (Login.tsx, Register.tsx);
 * this file only proves the shell's own contract, since it is the piece
 * every caller (including, per ADR 0164, the sign-in house chooser) shares.
 */

describe('EndpaperShell', () => {
  it('renders the recto content, the kicker and the house line', () => {
    render(
      <EndpaperShell kicker="The house" houseLine="Kept, page by page.">
        <p>Recto content</p>
      </EndpaperShell>,
    )
    expect(screen.getByText('Recto content')).toBeInTheDocument()
    expect(screen.getByText('The house')).toBeInTheDocument()
    expect(screen.getByText('Kept, page by page.')).toBeInTheDocument()
  })

  it('renders the tag caption when given, and omits it when not', () => {
    const { rerender, container } = render(
      <EndpaperShell kicker="The house" houseLine="Kept, page by page." tag="Every house's book looks the same.">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(screen.getByText("Every house's book looks the same.")).toBeInTheDocument()

    rerender(
      <EndpaperShell kicker="The house" houseLine="Kept, page by page.">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(container.querySelector('.mdv-ep-tagline')).toBeNull()
  })

  it('renders the folio label only when given', () => {
    const { rerender, container } = render(
      <EndpaperShell kicker="k" houseLine="h" folio="Sign in">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(screen.getByText('Sign in')).toBeInTheDocument()

    rerender(
      <EndpaperShell kicker="k" houseLine="h">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(container.querySelector('.mdv-ep-folio')).toBeNull()
  })

  it('carries the house scope and the auth stylesheet hook on its root, exactly one .mudavym node', () => {
    const { container } = render(
      <EndpaperShell kicker="k" houseLine="h">
        <p>x</p>
      </EndpaperShell>,
    )
    const scopes = container.querySelectorAll('.mudavym')
    expect(scopes).toHaveLength(1)
    expect(scopes[0]).toBe(container.firstElementChild)
    expect(scopes[0]).toHaveClass('mdv-auth')
    expect(scopes[0]).toHaveClass('mdv-endpaper')
  })

  it('defaults to the paper ground, and accepts an explicit charcoal override', () => {
    const { container, rerender } = render(
      <EndpaperShell kicker="k" houseLine="h">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(container.firstElementChild).toHaveAttribute('data-ground', 'paper')

    rerender(
      <EndpaperShell kicker="k" houseLine="h" ground="charcoal">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(container.firstElementChild).toHaveAttribute('data-ground', 'charcoal')
  })

  it('takes the wide leaf modifier only when asked', () => {
    const { container, rerender } = render(
      <EndpaperShell kicker="k" houseLine="h">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(container.querySelector('.mdv-ep-book')).not.toHaveClass('mdv-ep-book--wide')

    rerender(
      <EndpaperShell kicker="k" houseLine="h" wide>
        <p>x</p>
      </EndpaperShell>,
    )
    expect(container.querySelector('.mdv-ep-book')).toHaveClass('mdv-ep-book--wide')
  })

  it('gives every instance its own pattern id, so two mounted shells never collide', () => {
    const { container: a } = render(
      <EndpaperShell kicker="k" houseLine="h">
        <p>a</p>
      </EndpaperShell>,
    )
    const { container: b } = render(
      <EndpaperShell kicker="k" houseLine="h">
        <p>b</p>
      </EndpaperShell>,
    )
    const idA = a.querySelector('pattern')?.id
    const idB = b.querySelector('pattern')?.id
    expect(idA).toBeTruthy()
    expect(idB).toBeTruthy()
    expect(idA).not.toEqual(idB)
    // the tile rect must reference the SAME instance's pattern, not the other one
    expect(a.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${idA})`)
    expect(b.querySelector('rect')?.getAttribute('fill')).toBe(`url(#${idB})`)
  })

  it('renders the wordmark with an accessible label', () => {
    render(
      <EndpaperShell kicker="k" houseLine="h">
        <p>x</p>
      </EndpaperShell>,
    )
    expect(screen.getByRole('img', { name: 'Mudavym' })).toBeInTheDocument()
  })

  /*
   * Motion. jsdom has no Web Animations, so `Element.prototype.animate` is
   * stubbed per test; `lib/mudavym/motion.animate()` calls it with the house
   * token's duration and easing, which is what these assert.
   */
  describe('motion', () => {
    let calls: { el: Element; keyframes: unknown; options: KeyframeAnimationOptions }[]
    beforeEach(() => {
      calls = []
      Element.prototype.animate = vi.fn(function (this: Element, keyframes: unknown, options: KeyframeAnimationOptions) {
        calls.push({ el: this, keyframes, options })
        return {} as Animation
      }) as unknown as Element['animate']
    })
    afterEach(() => {
      // @ts-expect-error — jsdom has no animate(); put it back the way it was
      delete Element.prototype.animate
      vi.resetModules()
    })

    it('draws the mark once per page load: the first shell plays it, a later one opens still', async () => {
      vi.resetModules()
      const { EndpaperShell: Fresh } = await import('./EndpaperShell')
      const first = render(
        <Fresh kicker="k" houseLine="h">
          <p>x</p>
        </Fresh>,
      )
      // name (turn), full stop (stamp), two rules (settle), kicker + voice (ink)
      expect(calls).toHaveLength(6)
      expect(calls.map((c) => c.options.duration)).toEqual([420, 360, 320, 320, 160, 160])
      expect(calls.map((c) => c.options.delay)).toEqual([0, 300, 340, 400, 560, 560])
      first.unmount()
      calls = []
      render(
        <Fresh kicker="k" houseLine="h">
          <p>x</p>
        </Fresh>,
      )
      expect(calls).toHaveLength(0)
    })

    it('turns the leaf when the page changes, never on first render, and holds the endpaper still', () => {
      const { rerender, container } = render(
        <EndpaperShell kicker="k" houseLine="h" pageKey="address">
          <p>x</p>
        </EndpaperShell>,
      )
      calls = []
      rerender(
        <EndpaperShell kicker="k" houseLine="h" pageKey="address">
          <p>x</p>
        </EndpaperShell>,
      )
      expect(calls).toHaveLength(0)
      rerender(
        <EndpaperShell kicker="k" houseLine="h" pageKey="methods">
          <p>y</p>
        </EndpaperShell>,
      )
      expect(calls).toHaveLength(1)
      expect(calls[0].el).toBe(container.querySelector('.mdv-ep-leaf-inner'))
      expect(calls[0].options.duration).toBe(420)
      expect(container.querySelector('.mdv-ep-endpaper')?.contains(calls[0].el)).toBe(false)
    })
  })

  /*
   * The front matter (/login's Easter egg; founder 2026-09-19, sketch 118
   * front-matter.html Direction 1). jsdom has no Web Animations, so the turn
   * lands at once; what is under test is where the page lands, what stays
   * alive underneath, and where focus goes.
   */
  describe('the front matter', () => {
    const TURN = 'Turn back to the front of the book'

    it('is not there unless asked for — /register and every other caller get a plain endpaper', () => {
      const { container } = render(
        <EndpaperShell kicker="k" houseLine="h">
          <p>x</p>
        </EndpaperShell>,
      )
      expect(screen.queryByRole('button', { name: TURN })).toBeNull()
      // and its leaf keeps today's block layout: only the front-matter leaf is a grid
      expect(container.querySelector('.mdv-ep-leaf--front-matter')).toBeNull()
    })

    it('the house voice describes the turn, so a screen reader still hears it', () => {
      render(
        <EndpaperShell kicker="k" houseLine="Kept, page by page." tag="Every house's book." frontMatter>
          <p>x</p>
        </EndpaperShell>,
      )
      expect(screen.getByRole('button', { name: TURN })).toHaveAccessibleDescription(/Kept, page by page\.\s+Every house's book\./)
    })

    describe('with Web Animations', () => {
      type Run = {
        el: Element
        keyframes: Keyframe[]
        options: KeyframeAnimationOptions
        cancelledWith: boolean | null
        finish: () => void
      }
      let calls: Run[]
      beforeEach(() => {
        vi.useFakeTimers()
        calls = []
        Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
          let finish = () => {}
          const finished = new Promise<Animation>((resolve) => {
            finish = () => resolve({} as Animation)
          })
          const entry: Run = { el: this, keyframes, options, cancelledWith: null, finish }
          calls.push(entry)
          return {
            finished,
            cancel: () => {
              // what the DOM already says the FIRST time the run lets go of
              // its last frame (a later, redundant cancel must not mask it)
              if (entry.cancelledWith === null) entry.cancelledWith = !!document.querySelector('.mdv-ep-leaf[data-front]')
            },
          } as unknown as Animation
        }) as unknown as Element['animate']
      })
      afterEach(() => {
        vi.useRealTimers()
        // @ts-expect-error — jsdom has no animate(); put it back the way it was
        delete Element.prototype.animate
      })

      const leafRuns = () => calls.filter((c) => c.options.duration === leaf.ms)
      const runOn = (selector: string) => {
        const el = document.querySelector(selector)
        const run = leafRuns().find((c) => c.el === el)
        if (!run) throw new Error(`no leaf run on ${selector}`)
        return run
      }
      const offsets = (run: Run) => run.keyframes.map((k) => [k.offset ?? null, k.opacity ?? null])
      const finishAll = async () => {
        await act(async () => {
          for (const run of leafRuns()) run.finish()
        })
      }
      const isOpen = () => !!document.querySelector('.mdv-ep-leaf[data-front]')

      it('lets go of the turn only after the landed page is on the DOM, never before', async () => {
        render(
          <EndpaperShell kicker="k" houseLine="h" folio="Sign in" frontMatter>
            <input aria-label="Email address" />
          </EndpaperShell>,
        )
        calls = []
        fireEvent.click(screen.getByRole('button', { name: TURN }))
        const turnRuns = leafRuns()
        expect(turnRuns.length).toBeGreaterThanOrEqual(4)
        // The leaf runs on its own token, never `turn`'s front-loaded curve (ADR 0349).
        for (const run of turnRuns) expect(run.options.easing).toBe(leaf.easing)
        expect(leaf.easing).not.toBe(turn.easing)
        await finishAll()
        expect(turnRuns.every((c) => c.cancelledWith === true)).toBe(true)
      })

      it("settles on the runs' own end, not on a clock beside them", async () => {
        render(
          <EndpaperShell kicker="k" houseLine="h" folio="Sign in" frontMatter>
            <p>x</p>
          </EndpaperShell>,
        )
        fireEvent.click(screen.getByRole('button', { name: TURN }))
        act(() => {
          vi.advanceTimersByTime(leaf.ms)
        })
        // the token's length has passed, but the runs have not reported done
        expect(isOpen()).toBe(false)
        await finishAll()
        expect(isOpen()).toBe(true)
      })

      it('lands on the backstop when a run never reports done, and not before', () => {
        render(
          <EndpaperShell kicker="k" houseLine="h" folio="Sign in" frontMatter>
            <p>x</p>
          </EndpaperShell>,
        )
        fireEvent.click(screen.getByRole('button', { name: TURN }))
        act(() => {
          vi.advanceTimersByTime(leaf.ms * 2 - 1)
        })
        expect(isOpen()).toBe(false)
        act(() => {
          vi.advanceTimersByTime(1)
        })
        expect(isOpen()).toBe(true)
      })

      it('keys each hand-off to the leaf: the cut at 47–53%, the back at 80%, the cover at 97%', async () => {
        render(
          <EndpaperShell kicker="k" houseLine="h" folio="Sign in" frontMatter>
            <p>x</p>
          </EndpaperShell>,
        )
        // opening
        calls = []
        fireEvent.click(screen.getByRole('button', { name: TURN }))
        const OUT = [[null, 1], [0.47, 1], [0.53, 0], [null, 0]]
        const IN = [[null, 0], [0.47, 0], [0.53, 1], [null, 1]]
        expect(offsets(runOn('.mdv-ep-leaf-inner'))).toEqual(OUT)
        expect(offsets(runOn('.mdv-ep-poem-page'))).toEqual(IN)
        expect(offsets(runOn('.mdv-ep-sheet-face--verso'))).toEqual([[null, 1], [0.8, 1], [null, 0]])
        // the inside cover is under the endpaper from the first frame
        expect(offsets(runOn('.mdv-ep-cover-in'))).toEqual([[null, 1], [null, 1]])
        await finishAll()
        // closing
        calls = []
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(offsets(runOn('.mdv-ep-leaf-inner'))).toEqual(IN)
        expect(offsets(runOn('.mdv-ep-poem-page'))).toEqual(OUT)
        expect(offsets(runOn('.mdv-ep-sheet-face--verso'))).toEqual([[null, 0], [0.2, 1], [null, 1]])
        // covered again only as the leaf lands back on it
        expect(offsets(runOn('.mdv-ep-cover-in'))).toEqual([[null, 1], [0.97, 1], [null, 0]])
        expect(offsets(runOn('.mdv-ep-turn'))).toEqual([[null, 0], [0.97, 0], [null, 1]])
      })

      it('a sign-in step that lands while the front matter is open does not animate over it', async () => {
        const { rerender, container } = render(
          <EndpaperShell kicker="k" houseLine="h" folio="Sign in" pageKey="address" frontMatter>
            <p>x</p>
          </EndpaperShell>,
        )
        fireEvent.click(screen.getByRole('button', { name: TURN }))
        await finishAll()
        calls = []
        rerender(
          <EndpaperShell kicker="k" houseLine="h" folio="Sign in" pageKey="methods" frontMatter>
            <p>y</p>
          </EndpaperShell>,
        )
        expect(calls.filter((c) => c.el === container.querySelector('.mdv-ep-leaf-inner'))).toHaveLength(0)
      })
    })

    it('turns to the inside cover and the poem, keeps what was typed, and gives focus to the poem', () => {
      const { container } = render(
        <EndpaperShell kicker="k" houseLine="h" folio="Sign in" frontMatter>
          <input aria-label="Email address" />
        </EndpaperShell>,
      )
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'defne@meyhane.test' } })
      const turn = screen.getByRole('button', { name: TURN })
      expect(turn).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(turn)

      const title = screen.getByRole('heading', { name: 'Every house keeps a book.' })
      expect(document.activeElement).toBe(title)
      expect(screen.getAllByText('müdavim').length).toBeGreaterThan(0)
      expect(screen.getByText('Front matter')).toBeInTheDocument()
      expect(container.querySelector('.mdv-ep-leaf-inner')).toHaveAttribute('inert')
      expect(turn).toHaveAttribute('aria-expanded', 'true')
      // the sign-in is covered, not unmounted: the typed address is still there
      expect(screen.getByLabelText('Email address')).toHaveValue('defne@meyhane.test')
    })

    it('turns back on Escape and on its own link, returning focus to the endpaper', () => {
      const { container } = render(
        <EndpaperShell kicker="k" houseLine="h" folio="Sign in" frontMatter>
          <input aria-label="Email address" />
        </EndpaperShell>,
      )
      const turn = screen.getByRole('button', { name: TURN })
      fireEvent.click(turn)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('heading', { name: 'Every house keeps a book.' })).toBeNull()
      expect(screen.getByText('Sign in')).toBeInTheDocument()
      expect(container.querySelector('.mdv-ep-leaf-inner')).not.toHaveAttribute('inert')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: TURN }))

      fireEvent.click(screen.getByRole('button', { name: TURN }))
      fireEvent.click(screen.getByRole('button', { name: 'Turn back to sign in →' }))
      expect(screen.queryByRole('heading', { name: 'Every house keeps a book.' })).toBeNull()
    })
  })
})
