import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EndpaperShell } from './EndpaperShell'

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
})
