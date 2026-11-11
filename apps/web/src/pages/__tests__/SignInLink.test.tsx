// QA round 23: mail scanners open links, so the page never spends the token on
// load. The token rules are proven in the gateway (`sign-in-link.spec.ts`).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({ session: vi.fn(), link: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ signInWithSession: h.session }) }))
vi.mock('../../services/api/passkeys', () => ({ signInWithEmailLink: h.link }))

import { SignInLink } from '../SignInLink'

const PAIR = { accessToken: 'a.b.c', refreshToken: 'r' }
const TOKEN = '00000000-0000-4000-8000-000000000001.mac_-'
const button = () => screen.findByRole('button', { name: 'Sign in' })

function draw() {
  window.history.replaceState(null, '', `/login/code#t=${TOKEN}`)
  render(
    <MemoryRouter initialEntries={['/login/code']}>
      <Routes>
        <Route path="/login/code" element={<SignInLink />} />
        <Route path="/" element="home page" />
        <Route path="/login" element="login page" />
      </Routes>
    </MemoryRouter>,
  )
}

describe('/login/code', () => {
  beforeEach(() => {
    h.session.mockReset().mockResolvedValue(undefined)
    h.link.mockReset().mockResolvedValue(PAIR)
  })

  it('sends nothing on load and clears the hash at once', async () => {
    draw()
    await button()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.link).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/login/code')
  })

  it('one click sends the token once and signs in', async () => {
    draw()
    fireEvent.click(await button())
    await screen.findByText('home page')
    expect(h.link.mock.calls).toEqual([[TOKEN]])
    expect(h.session).toHaveBeenCalledWith(PAIR)
  })

  it('a refusal shows the sentence and the way back to sign in', async () => {
    const sentence = 'That sign-in link has expired or was already used. Ask for a new code.'
    h.link.mockRejectedValue(new Error(sentence))
    draw()
    fireEvent.click(await button())
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence)
    expect(h.session).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Go to sign in' }))
    await screen.findByText('login page')
  })
})
