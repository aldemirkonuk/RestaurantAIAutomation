import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { type ReactElement } from 'react'
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  auth: {
    user: null as null | { email: string },
    isAuthenticated: false,
    logout: vi.fn(),
    refreshBranches: vi.fn(),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('../../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('axios', () => ({
  default: { get: h.axiosGet, post: h.axiosPost, isAxiosError: () => false },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { ForgotPassword } from '../ForgotPassword'
import { ResetPassword } from '../ResetPassword'
import { VerifyEmail } from '../VerifyEmail'
import { InviteLanding } from '../InviteLanding'
import { NoAccess } from '../NoAccess'
import Privacy from '../Privacy'
import { VendorPortal, unitPrice } from '../VendorPortal'
function mount(el: ReactElement, path: string, route = path.split('?')[0]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_MUDAVYM_PUBLIC', '')
  localStorage.clear()
  localStorage.setItem('mudavym.design.public', 'true')
  h.auth.user = null
  h.auth.isAuthenticated = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})
it('keeps reset requests enumeration safe and failures recoverable', async () => {
  h.axiosPost
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ data: {} })
  mount(<ForgotPassword />, '/forgot-password?email=unknown%40house.test')
  expect(screen.getByLabelText('Email address')).toHaveValue(
    'unknown@house.test',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  await screen.findByRole('alert')
  expect(
    screen.queryByRole('heading', { name: 'Check your email' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  await screen.findByRole('heading', { name: 'Check your email' })
  expect(screen.getByRole('status')).toHaveTextContent('If an account exists')
  expect(h.axiosPost).toHaveBeenLastCalledWith(
    expect.stringContaining('/auth/request-password-reset'),
    { email: 'unknown@house.test' },
  )
})
it('provides a new-link path for a missing reset token without a request', () => {
  mount(<ResetPassword />, '/reset-password')
  expect(
    screen.getByRole('link', { name: 'Request a new link' }),
  ).toHaveAttribute('href', '/forgot-password')
  expect(h.axiosPost).not.toHaveBeenCalled()
})
it('validates reset confirmation before sending the password', async () => {
  mount(<ResetPassword />, '/reset-password?token=example-token')
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'password-one' },
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'password-two' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Passwords do not match',
  )
  expect(h.axiosPost).not.toHaveBeenCalled()
})
it('gives signed-out verification a sign-in path instead of an authenticated resend', () => {
  mount(<VerifyEmail />, '/verify-email')
  expect(
    screen.getByRole('link', { name: 'Sign in to resend' }),
  ).toHaveAttribute('href', '/login?redirect=%2Fverify-email')
  expect(
    screen.queryByRole('button', { name: /Resend/ }),
  ).not.toBeInTheDocument()
  expect(h.post).not.toHaveBeenCalled()
})
it('does not call a failed invite preview expired and permits retry', async () => {
  h.get
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      data: { valid: true, restaurant: 'The House', role: 'staff' },
    })
  mount(<InviteLanding />, '/invite/example-code', '/invite/:code')
  await screen.findByRole('heading', { name: 'Invitation unavailable' })
  expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'You are invited' })
  expect(
    screen.getByRole('link', { name: 'Sign in to accept' }),
  ).toHaveAttribute('href', '/login?redirect=%2Finvite%2Fexample-code')
})
it('shows no-access account context and signs out without a fake workspace', () => {
  h.auth.user = { email: 'reader@house.test' }
  mount(<NoAccess />, '/no-access')
  expect(screen.getByText('reader@house.test')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(h.auth.logout).toHaveBeenCalledTimes(1)
})
it('renders privacy as one document with accurate broad Excel scope', () => {
  const { container } = mount(<Privacy />, '/privacy')
  expect(container.querySelector('.mdv-pub')).toHaveAttribute(
    'data-measure',
    'document',
  )
  expect(container.querySelectorAll('h1')).toHaveLength(1)
  expect(
    screen.getByText(
      /Microsoft Excel requests file read and write access to your OneDrive/,
    ),
  ).toBeInTheDocument()
})
const listing = {
  id: 'wine-1',
  productName: 'House red',
  producer: null,
  vintage: null,
  region: null,
  country: null,
  grapeVarieties: null,
  price: 120,
  currency: 'USD',
  packSize: 6,
  volumeMl: null,
  unitLabel: null,
  inStock: null,
  minOrderQuantity: null,
  leadTimeDays: null,
  notes: null,
}
const page = {
  slug: 'vendor',
  displayName: 'The Vendor',
  tagline: null,
  about: null,
  logoUrl: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  updatedAt: '2026-09-13T00:00:00Z',
  listings: [listing],
}
it('preserves unknown vendor stock and volume and recovers from a failed read', async () => {
  h.axiosGet
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ data: { page } })
  const { container } = mount(<VendorPortal />, '/v/vendor', '/v/:slug')
  await screen.findByRole('heading', { name: 'Catalogue unavailable' })
  expect(
    screen.queryByText(/has not published any listings/),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'The Vendor' })
  expect(screen.getByText('Availability not stated')).toBeInTheDocument()
  expect(container.querySelector('table')).toBeInTheDocument()
  expect(unitPrice(listing)).toBeNull()
  expect(unitPrice({ ...listing, volumeMl: 750 })).toBe(20)
  const json = JSON.parse(
    document.querySelector('script[type="application/ld+json"]')!.textContent!,
  )
  expect(json.itemListElement[0].item.offers).not.toHaveProperty('availability')
  fireEvent.change(screen.getByLabelText('Find a wine'), {
    target: { value: 'absent' },
  })
  expect(
    await screen.findByText('No listings match your search.'),
  ).toBeInTheDocument()
})
it('retains the legacy route while the public flag is off', () => {
  localStorage.setItem('mudavym.design.public', 'false')
  const { container } = mount(<ForgotPassword />, '/forgot-password')
  expect(container.querySelector('.mdv-pub')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Send Reset Link' }),
  ).toBeInTheDocument()
})

it('keeps provider scope and disconnect facts accurate with the design flag off', () => {
  localStorage.setItem('mudavym.design.public', 'false')
  mount(<Privacy />, '/privacy')
  expect(
    screen.getByText(
      /Microsoft Excel requests file read and write access to your OneDrive/,
    ),
  ).toBeInTheDocument()
  expect(
    screen.queryByText(/which also revokes it at the provider/),
  ).not.toBeInTheDocument()
})
