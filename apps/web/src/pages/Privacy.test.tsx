import { afterEach, describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../__tests__/utils/test-utils'
import { PUBLIC_OVERRIDE_KEY } from '../lib/mudavym/publicDesign'
import Privacy from './Privacy'

/**
 * ADR 0145, 2026-09-22 (round 6y), founder's pick verbatim: "Add to /privacy
 * now". Confirms the page renders and that its new "Questions you ask
 * Mudavym" section states the four things his pick asked for: what /ask
 * keeps, that the owner can opt out, that nothing asked while opted out is
 * ever used (even after opting back in), and that an export carries no
 * question text.
 *
 * ADR 0145, round 6z, founder's pick verbatim: "Add a plain line now
 * (Recommended)". The last block asserts the model-provider sentence in BOTH
 * copies of the section: the plate (the page that ships) and the legacy
 * `<Section>` copy, reachable only through the QA override.
 */
describe('Privacy page', () => {
  it('renders the page', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByRole('heading', { name: /privacy & data/i })).toBeInTheDocument()
  })

  it('states what /ask keeps and how the record is used', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByRole('heading', { name: /questions you ask mudavym/i })).toBeInTheDocument()
    expect(
      screen.getByText(/we keep the question, the answer, and how the answer was reached/i),
    ).toBeInTheDocument()
  })

  it('states the owner opt-out', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByText(/house's owner can turn training use off for the whole house/i)).toBeInTheDocument()
  })

  it('states that a question asked while opted out is never used, even after opting back in', () => {
    renderWithProviders(<Privacy />)
    expect(
      screen.getByText(/never used for training, even if the owner turns it back on afterward/i),
    ).toBeInTheDocument()
  })

  it('states that an export carries no question text', () => {
    renderWithProviders(<Privacy />)
    expect(screen.getByText(/that export carries no question text at all/i)).toBeInTheDocument()
  })
})

describe('Privacy page: where a question goes to be answered (round 6z)', () => {
  const sentence = /to answer it, the question is sent to an ai model provider outside turkey/i

  afterEach(() => {
    window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY)
  })

  it('says it on the plate copy that ships', () => {
    renderWithProviders(<Privacy />)
    expect(document.querySelector('.mdv-pub__plate')).not.toBeNull()
    expect(screen.getByText(sentence)).toBeInTheDocument()
  })

  it('says it on the legacy Section copy too', () => {
    window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'off')
    renderWithProviders(<Privacy />)
    expect(document.querySelector('.mdv-pub__plate')).toBeNull()
    expect(screen.getByRole('heading', { name: /questions you ask mudavym/i })).toBeInTheDocument()
    expect(screen.getByText(sentence)).toBeInTheDocument()
  })
})
