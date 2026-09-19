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
  currency: 'EUR',
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
it('keeps the vendor board scroller a keyboard-reachable, labelled region', async () => {
  h.axiosGet.mockResolvedValueOnce({ data: { page } })
  const { container } = mount(<VendorPortal />, '/v/vendor', '/v/:slug')
  await screen.findByRole('heading', { name: 'The Vendor' })
  // wave4 R1: `.mdv-pub__scroll` carries role="region" + aria-label + a real
  // tabIndex so the board is reachable without a pointer. Fails if any one of
  // the three is dropped (mutation M3, wave4 confirm D4).
  const region = screen.getByRole('region', { name: 'The Vendor catalogue' })
  expect(region).toHaveAttribute('tabIndex', '0')
  expect(container.querySelector('.mdv-pub__scroll')).toBe(region)
})

it('does not announce the listing count as a live region (F11)', async () => {
  h.axiosGet.mockResolvedValueOnce({ data: { page } })
  mount(<VendorPortal />, '/v/vendor', '/v/:slug')
  await screen.findByRole('heading', { name: 'The Vendor' })
  // Fails if `role="status"` returns to the listing-count paragraph
  // (mutation M5, wave4 confirm D4): a status role here re-announces the
  // count on every filter keystroke, which is not a live update a screen
  // reader user asked for.
  expect(screen.getByText(/1 of 1 listings/)).not.toHaveAttribute(
    'role',
    'status',
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('shows a resend failure inline only, with no duplicate toast (D5c)', async () => {
  h.auth.user = { email: 'reader@house.test' }
  h.post.mockRejectedValueOnce(new Error('offline'))
  mount(<VerifyEmail />, '/verify-email')
  fireEvent.click(
    screen.getByRole('button', { name: 'Resend verification email' }),
  )
  // Fails if the resend error goes back to a toast-only surface (mutation
  // M4, wave4 confirm D4): both renderings already show `error` inline, so a
  // toast here would be the same failure announced twice.
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Request failed. Try again.',
  )
  const { toast } = await import('sonner')
  expect(toast.error).not.toHaveBeenCalled()
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

it('the public design switch defaults on with no override at all', () => {
  localStorage.removeItem('mudavym.design.public')
  const { container } = mount(<ForgotPassword />, '/forgot-password')
  expect(container.querySelector('.mdv-pub')).not.toBeNull()
})

it('a vendor 404 shows no retry and a neutral eyebrow, with no footer claim', async () => {
  h.axiosGet.mockRejectedValueOnce({ response: { status: 404 } })
  const { container } = mount(<VendorPortal />, '/v/missing', '/v/:slug')
  await screen.findByRole('heading', { name: 'Catalogue unavailable' })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'This vendor page does not exist or has not been published yet.',
  )
  expect(
    screen.queryByRole('button', { name: 'Try again' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('Vendor catalogue')).toBeInTheDocument()
  expect(container.querySelector('footer')).toBeNull()
})

it('a vendor 503 (or any non-404 failure) keeps the retry button', async () => {
  h.axiosGet.mockRejectedValueOnce({ response: { status: 503 } })
  mount(<VendorPortal />, '/v/down', '/v/:slug')
  await screen.findByRole('heading', { name: 'Catalogue unavailable' })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not load this catalogue. Please try again shortly.',
  )
  expect(
    screen.getByRole('button', { name: 'Try again' }),
  ).toBeInTheDocument()
})

it('refuses a javascript: vendor website and logo URL', async () => {
  h.axiosGet.mockResolvedValueOnce({
    data: {
      page: {
        ...page,
        websiteUrl: 'javascript:alert(1)',
        logoUrl: 'javascript:alert(2)',
        about: 'A short line about the vendor.',
      },
    },
  })
  mount(<VendorPortal />, '/v/vendor', '/v/:slug')
  await screen.findByRole('heading', { name: 'The Vendor' })
  expect(screen.queryByText('Vendor website')).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it('names which reason an invite is unavailable (0149 row 49), not one collapsed message', async () => {
  h.get.mockResolvedValueOnce({ data: { valid: false, reason: 'used' } })
  mount(<InviteLanding />, '/invite/used-code', '/invite/:code')
  await screen.findByRole('heading', { name: 'This invitation was already used' })
  expect(
    screen.getByText(/Someone has already accepted it/),
  ).toBeInTheDocument()
  cleanup()

  h.get.mockResolvedValueOnce({ data: { valid: false, reason: 'expired' } })
  mount(<InviteLanding />, '/invite/expired-code', '/invite/:code')
  await screen.findByRole('heading', { name: 'This invitation has expired' })
  cleanup()

  h.get.mockResolvedValueOnce({ data: { valid: false, reason: 'not_found' } })
  mount(<InviteLanding />, '/invite/missing-code', '/invite/:code')
  await screen.findByRole('heading', { name: 'This invitation was not found' })
})

it('capitalises the invite role', async () => {
  h.get.mockResolvedValueOnce({
    data: { valid: true, restaurant: 'The House', role: 'manager' },
  })
  mount(<InviteLanding />, '/invite/example-code', '/invite/:code')
  await screen.findByRole('heading', { name: 'You are invited' })
  expect(screen.getByText('Manager')).toBeInTheDocument()
  expect(screen.queryByText('manager')).not.toBeInTheDocument()
})

it('only offers a new reset link for a server-confirmed token failure, not a client mismatch', async () => {
  mount(<ResetPassword />, '/reset-password?token=example-token')
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'password-one' },
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'password-two' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  await screen.findByRole('alert')
  expect(
    screen.queryByRole('link', { name: 'Request a new link' }),
  ).not.toBeInTheDocument()

  h.axiosPost.mockRejectedValueOnce({
    response: { data: { message: 'This reset link has expired.' } },
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'password-one' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This reset link has expired.',
  )
  expect(
    screen.getByRole('link', { name: 'Request a new link' }),
  ).toHaveAttribute('href', '/forgot-password')
})
