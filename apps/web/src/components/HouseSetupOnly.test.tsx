/**
 * r36 onboarding gap 14: /house and /house/menu had no role, so staff could
 * open the owner's first-house pages and their vendor form. Staff are now
 * told who does it and given the desk; an owner or a manager opens the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let role: 'owner' | 'manager' | 'staff' | null = 'staff'
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u-1', role, restaurantId: 'r-1' } }),
}))

import { HouseSetupOnly } from './HouseSetupOnly'

function openAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>the desk</p>} />
        <Route path="/house" element={<HouseSetupOnly><p>the house page</p></HouseSetupOnly>} />
        <Route path="/house/menu" element={<HouseSetupOnly><p>the house menu</p></HouseSetupOnly>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the first-house pages are for the people who run setup', () => {
  it('staff opening /house are told who does it, given the desk, and never shown the page', () => {
    role = 'staff'
    openAt('/house')
    expect(screen.queryByText('the house page')).toBeNull()
    expect(screen.getByRole('heading', { name: 'The owner or a manager does this' })).toBeInTheDocument()
    expect(screen.getByText(/done by the owner or a manager/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the desk' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Access Denied')).toBeNull()
  })

  it('staff on /house/menu are told the same', () => {
    role = 'staff'
    openAt('/house/menu')
    expect(screen.queryByText('the house menu')).toBeNull()
    expect(screen.getByRole('heading', { name: 'The owner or a manager does this' })).toBeInTheDocument()
  })

  it('an owner and a manager open the page', () => {
    for (const r of ['owner', 'manager'] as const) {
      role = r
      openAt('/house')
      expect(screen.getByText('the house page')).toBeInTheDocument()
      cleanup()
    }
  })

  it('a role not read yet is left to the page, never bounced', () => {
    role = null
    openAt('/house/menu')
    expect(screen.getByText('the house menu')).toBeInTheDocument()
  })

  it('App.tsx routes both pages through it', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
    for (const page of ['HouseContents', 'HouseMenu']) {
      expect(app).toMatch(new RegExp(`<HouseSetupOnly>\\s*<${page} />\\s*</HouseSetupOnly>`))
    }
    expect(app.match(/<HouseSetupOnly>/g)).toHaveLength(2)
  })
})
