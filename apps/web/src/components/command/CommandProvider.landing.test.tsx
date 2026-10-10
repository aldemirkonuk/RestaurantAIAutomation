/**
 * The default landing page is one person's choice (F-438). Held as one value
 * per device, the next person to sign in on a shared tablet was sent to
 * whatever page the last one had chosen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthContext } from '../../contexts/AuthContext'
import { CommandProvider, LANDING_KEY, landingKeyFor } from './CommandProvider'

vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./ShortcutsSheet', () => ({ ShortcutsSheet: () => null }))
vi.mock('./RecentlyViewed', () => ({ RecentlyViewed: () => null }))

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function bootAs(userId: string) {
  return render(
    <AuthContext.Provider value={{ user: { userId } } as never}>
      <MemoryRouter initialEntries={['/']}>
        <CommandProvider>
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </CommandProvider>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

beforeEach(() => localStorage.clear())

describe('default landing page, per person', () => {
  it("sends the person who chose it to their page", () => {
    localStorage.setItem(landingKeyFor('u-owner')!, '/reports')
    bootAs('u-owner')
    expect(screen.getByTestId('where').textContent).toBe('/reports')
  })

  it("does not send the next person to the owner's page", () => {
    localStorage.setItem(landingKeyFor('u-owner')!, '/reports')
    bootAs('u-waiter')
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('ignores and removes the old device-wide value', () => {
    localStorage.setItem(LANDING_KEY, '/reports')
    bootAs('u-waiter')
    expect(screen.getByTestId('where').textContent).toBe('/')
    expect(localStorage.getItem(LANDING_KEY)).toBeNull()
  })
})
