import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  User,
  Lock,
  Link2,
  Palette,
  MapPin,
  AlertTriangle,
  Sparkles,
  Loader2,
  Check,
  Building2,
  CreditCard,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Header } from '../components/layout/Header'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { cn } from '../lib/utils'
import { apiClient } from '../services/api/client'
import { profileApi, type LinkedProviders } from '../services/api/profile'

type SectionId =
  | 'account'
  | 'security'
  | 'linked'
  | 'preferences'
  | 'restaurant'
  | 'payment'
  | 'memberships'
  | 'danger'

const PERSONAL_SECTIONS: { id: SectionId; label: string; icon: typeof User }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'linked', label: 'Linked accounts', icon: Link2 },
  { id: 'preferences', label: 'Preferences', icon: Palette },
]

const MANAGER_SECTIONS: { id: SectionId; label: string; icon: typeof User }[] = [
  { id: 'restaurant', label: 'Restaurant', icon: Building2 },
  { id: 'payment', label: 'Payment', icon: CreditCard },
  { id: 'memberships', label: 'Memberships', icon: Users },
]

function formatRoleLabel(role: string | null | undefined): string {
  if (!role) return '—'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export default function Profile() {
  const {
    user,
    activeRestaurantId,
    activeRole,
    availableRestaurants,
    setActiveRestaurantId,
    refreshBranches,
  } = useAuth()
  const { theme, setTheme } = useTheme()
  const [activeSection, setActiveSection] = useState<SectionId>('account')

  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [linked, setLinked] = useState<LinkedProviders | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [hasPassword, setHasPassword] = useState(true)

  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState('')

  const [restaurantName, setRestaurantName] = useState('')
  const [restaurantCity, setRestaurantCity] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [billingPhone, setBillingPhone] = useState('')
  const [savingRestaurant, setSavingRestaurant] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [planLabel] = useState('Free')

  const effectiveRole = activeRole ?? user?.role ?? null
  const isOwner = effectiveRole === 'owner'
  const isManagerOrOwner = effectiveRole === 'owner' || effectiveRole === 'manager'
  const activeBranch = availableRestaurants.find((r) => r.id === activeRestaurantId)

  const railSections = [
    ...PERSONAL_SECTIONS,
    ...(isManagerOrOwner ? MANAGER_SECTIONS : []),
    { id: 'danger' as const, label: 'Danger zone', icon: AlertTriangle },
  ]

  useEffect(() => {
    setName(user?.name ?? '')
  }, [user?.name])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const me = await profileApi.getMe()
        if (cancelled) return
        setPhone(me.phone ?? '')
        setHasPassword(me.hasPassword)
        setLinked(me.linkedProviders)
      } catch {
        // Graceful: page still usable with auth context data
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isManagerOrOwner || !activeRestaurantId) return
    let cancelled = false
    async function loadRestaurant() {
      try {
        const { data } = await apiClient.get<{
          id: string
          name: string
          city: string | null
          email: string | null
          phone: string | null
        }>(`/organizations/locations/${activeRestaurantId}`)
        if (cancelled || !data) return
        setRestaurantName(data.name ?? '')
        setRestaurantCity(data.city ?? '')
        setBillingEmail(data.email ?? '')
        setBillingPhone(data.phone ?? '')
      } catch {
        setRestaurantName(activeBranch?.name ?? '')
        setRestaurantCity(activeBranch?.city ?? '')
      }
    }
    void loadRestaurant()
    return () => {
      cancelled = true
    }
  }, [isManagerOrOwner, activeRestaurantId, activeBranch?.name, activeBranch?.city])

  // Scroll spy: highlight the rail item for the section under the reading line
  useEffect(() => {
    const ids: SectionId[] = [
      ...PERSONAL_SECTIONS.map((s) => s.id),
      ...(isManagerOrOwner ? MANAGER_SECTIONS.map((s) => s.id) : []),
      'danger',
    ]
    let ticking = false

    const update = () => {
      ticking = false
      // At the very bottom, the last section wins even if its top never
      // crosses the reading line (short sections at the end of the page).
      const scrolledToBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      if (scrolledToBottom) {
        setActiveSection(ids[ids.length - 1])
        return
      }
      const readingLine = 120 // just below the sticky header
      let current: SectionId = ids[0]
      for (const id of ids) {
        const el = document.getElementById(`profile-${id}`)
        if (!el) continue
        if (el.getBoundingClientRect().top <= readingLine) {
          current = id
        } else {
          break
        }
      }
      setActiveSection(current)
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [isManagerOrOwner])

  const scrollTo = (id: SectionId) => {
    setActiveSection(id)
    document.getElementById(`profile-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const saveProfile = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      toast.error('Display name must be at least 2 characters')
      return
    }
    setSavingProfile(true)
    try {
      await profileApi.updateMe({ name: trimmed, phone: phone.trim() || undefined })
      toast.success('Profile saved')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to save profile'
      toast.error(msg)
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async () => {
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    setSavingPassword(true)
    try {
      await profileApi.changePassword({ currentPassword, newPassword })
      toast.success('Password updated')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setHasPassword(true)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to change password'
      toast.error(msg)
    } finally {
      setSavingPassword(false)
    }
  }

  const linkProvider = async (provider: 'google' | 'microsoft') => {
    setLinking(provider)
    try {
      // Full OAuth popup → id_token handoff is wired via POST /auth/me/link/:provider.
      // Until the client popup is connected, surface a clear next step (no empty-token call).
      toast.message(`Connect ${provider === 'google' ? 'Google' : 'Microsoft'}`, {
        description:
          'Sign in with the provider when prompted. API: POST /auth/me/link/' + provider,
      })
    } finally {
      setLinking(null)
    }
  }

  const unlinkProvider = async (provider: 'google' | 'microsoft') => {
    setLinking(provider)
    try {
      const result = await profileApi.unlinkProvider(provider)
      setLinked(result.linkedProviders)
      toast.success(`${provider === 'google' ? 'Google' : 'Microsoft'} unlinked`)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to unlink provider'
      toast.error(msg)
    } finally {
      setLinking(null)
    }
  }

  const leaveRestaurant = async () => {
    if (!activeRestaurantId) return
    setLeaving(true)
    try {
      await apiClient.post(`/auth/me/leave-restaurant`, { restaurantId: activeRestaurantId })
      toast.success('Left restaurant')
      await refreshBranches()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Could not leave restaurant'
      toast.error(msg)
    } finally {
      setLeaving(false)
    }
  }

  const deleteAccount = async () => {
    if (confirmDelete !== 'DELETE') {
      toast.error('Type DELETE to confirm')
      return
    }
    setDeleting(true)
    try {
      await apiClient.delete('/auth/me')
      toast.success('Account deleted')
      window.location.href = '/login'
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Could not delete account'
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  const saveRestaurant = async () => {
    if (!activeRestaurantId) return
    const trimmed = restaurantName.trim()
    if (trimmed.length < 2) {
      toast.error('Restaurant name must be at least 2 characters')
      return
    }
    setSavingRestaurant(true)
    try {
      await apiClient.patch(`/organizations/locations/${activeRestaurantId}`, {
        name: trimmed,
        city: restaurantCity.trim() || undefined,
      })
      toast.success('Restaurant updated')
      await refreshBranches()
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to update restaurant'
      toast.error(msg)
    } finally {
      setSavingRestaurant(false)
    }
  }

  const savePayment = async () => {
    if (!activeRestaurantId) return
    setSavingPayment(true)
    try {
      await apiClient.patch(`/organizations/locations/${activeRestaurantId}`, {
        email: billingEmail.trim() || undefined,
        phone: billingPhone.trim() || undefined,
      })
      toast.success('Payment contact details saved')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to save payment details'
      toast.error(msg)
    } finally {
      setSavingPayment(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Profile" subtitle="Your account, security, and preferences" />

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Identity strip */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-wine-400 to-wine-600 flex items-center justify-center text-white text-2xl font-semibold shadow-sm">
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{user?.name || 'User'}</h2>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatRoleLabel(effectiveRole)}
              {activeBranch ? ` · ${activeBranch.name}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Left rail */}
          <nav className="md:w-52 shrink-0" aria-label="Profile sections">
            <ul className="sticky top-24 space-y-1">
              {railSections.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                      activeSection === id
                        ? 'bg-wine-50 text-wine-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100',
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Sections */}
          <div className="flex-1 space-y-6 min-w-0">
            <motion.section
              id="profile-account"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6"
            >
              <h3 className="text-base font-semibold text-gray-900 mb-4">Account</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="display-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Display name
                  </label>
                  <input
                    id="display-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    id="email"
                    value={user?.email ?? ''}
                    readOnly
                    className="w-full px-3 py-2 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Contact{' '}
                    <a
                      href={`mailto:${import.meta.env.VITE_SUPPORT_EMAIL || 'support@wineops.ai'}`}
                      className="text-wine-600 hover:underline"
                    >
                      support
                    </a>{' '}
                    to change your email.
                  </p>
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 000 0000"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                  />
                </div>
                <div>
                  <span className="block text-sm font-medium text-gray-700 mb-1">Role</span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 text-sm text-gray-700">
                    {formatRoleLabel(effectiveRole)}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">Role is set by your restaurant owner.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={savingProfile}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-wine-600 text-white text-sm font-medium hover:bg-wine-700 disabled:opacity-60"
                >
                  {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Save changes
                </button>
              </div>
            </motion.section>

            <section id="profile-security" className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Security</h3>
              {!hasPassword ? (
                <p className="text-sm text-gray-500 mb-4">
                  You signed in with a linked account. Set a password to also use email login.
                </p>
              ) : null}
              <div className="space-y-4 max-w-md">
                {hasPassword && (
                  <div>
                    <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-1">
                      Current password
                    </label>
                    <input
                      id="current-password"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm new password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void changePassword()}
                  disabled={savingPassword || !newPassword}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                >
                  {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  {hasPassword ? 'Update password' : 'Set password'}
                </button>
              </div>
            </section>

            <section id="profile-linked" className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Linked accounts</h3>
              <p className="text-sm text-gray-500 mb-4">Sign in faster with Google or Microsoft.</p>
              <div className="space-y-3">
                {(['google', 'microsoft'] as const).map((provider) => {
                  const isLinked = linked?.[provider] ?? false
                  const label = provider === 'google' ? 'Google' : 'Microsoft'
                  return (
                    <div
                      key={provider}
                      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gray-100"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
                          <Link2 className="w-4 h-4 text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{label}</p>
                          <p className="text-xs text-gray-400">{isLinked ? 'Connected' : 'Not connected'}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={linking === provider}
                        onClick={() =>
                          void (isLinked ? unlinkProvider(provider) : linkProvider(provider))
                        }
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                          isLinked
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-wine-700 hover:bg-wine-50',
                        )}
                      >
                        {linking === provider ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isLinked ? (
                          'Unlink'
                        ) : (
                          'Connect'
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>

            <section id="profile-preferences" className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Preferences</h3>
              <div className="space-y-5">
                <div>
                  <span className="block text-sm font-medium text-gray-700 mb-2">Theme</span>
                  <div className="flex gap-2">
                    {(['light', 'dark', 'system'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTheme(t)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-sm capitalize border transition-colors',
                          theme === t
                            ? 'border-wine-400 bg-wine-50 text-wine-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="block text-sm font-medium text-gray-700 mb-2">
                    <MapPin className="w-3.5 h-3.5 inline mr-1" />
                    Active restaurant
                  </span>
                  {availableRestaurants.length === 0 ? (
                    <p className="text-sm text-gray-500">No restaurants available.</p>
                  ) : (
                    <select
                      value={activeRestaurantId ?? ''}
                      onChange={(e) => void setActiveRestaurantId(e.target.value)}
                      className="w-full max-w-md px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30"
                    >
                      {availableRestaurants.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.city ? ` · ${r.city}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </section>

            {isManagerOrOwner && (
              <>
                <section id="profile-restaurant" className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6">
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Restaurant</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Managers and owners can rename the active location. Staff cannot edit this.
                  </p>
                  <div className="space-y-4 max-w-md">
                    <div>
                      <label htmlFor="restaurant-name" className="block text-sm font-medium text-gray-700 mb-1">
                        Restaurant name
                      </label>
                      <input
                        id="restaurant-name"
                        value={restaurantName}
                        onChange={(e) => setRestaurantName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                      />
                    </div>
                    <div>
                      <label htmlFor="restaurant-city" className="block text-sm font-medium text-gray-700 mb-1">
                        City
                      </label>
                      <input
                        id="restaurant-city"
                        value={restaurantCity}
                        onChange={(e) => setRestaurantCity(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveRestaurant()}
                      disabled={savingRestaurant || !activeRestaurantId}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-wine-600 text-white text-sm font-medium hover:bg-wine-700 disabled:opacity-60"
                    >
                      {savingRestaurant ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Building2 className="w-4 h-4" />
                      )}
                      Save restaurant
                    </button>
                  </div>
                </section>

                <section id="profile-payment" className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6">
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Payment</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Billing contact for invoices and plan notices. Card checkout coming later.
                  </p>
                  <div className="mb-4 flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 text-sm text-gray-700">
                      Plan: {planLabel}
                    </span>
                    {isOwner && (
                      <span className="text-xs text-wine-600 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        Upgrade coming soon
                      </span>
                    )}
                  </div>
                  <div className="space-y-4 max-w-md">
                    <div>
                      <label htmlFor="billing-email" className="block text-sm font-medium text-gray-700 mb-1">
                        Billing email
                      </label>
                      <input
                        id="billing-email"
                        type="email"
                        value={billingEmail}
                        onChange={(e) => setBillingEmail(e.target.value)}
                        placeholder="billing@restaurant.com"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                      />
                    </div>
                    <div>
                      <label htmlFor="billing-phone" className="block text-sm font-medium text-gray-700 mb-1">
                        Billing phone
                      </label>
                      <input
                        id="billing-phone"
                        type="tel"
                        value={billingPhone}
                        onChange={(e) => setBillingPhone(e.target.value)}
                        placeholder="+1 555 000 0000"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void savePayment()}
                      disabled={savingPayment || !activeRestaurantId}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {savingPayment ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CreditCard className="w-4 h-4" />
                      )}
                      Save payment details
                    </button>
                  </div>
                </section>

                <section id="profile-memberships" className="scroll-mt-24 bg-white rounded-2xl border border-gray-200 p-6">
                  <h3 className="text-base font-semibold text-gray-900 mb-1">Memberships</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Restaurants you belong to. Switch the active location anytime.
                  </p>
                  {availableRestaurants.length === 0 ? (
                    <p className="text-sm text-gray-500">No memberships yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {availableRestaurants.map((r) => {
                        const isActive = r.id === activeRestaurantId
                        return (
                          <li
                            key={r.id}
                            className={cn(
                              'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border',
                              isActive ? 'border-wine-200 bg-wine-50/50' : 'border-gray-100',
                            )}
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">{r.name}</p>
                              <p className="text-xs text-gray-400">
                                {r.city || '—'}
                                {isActive ? ` · ${formatRoleLabel(effectiveRole)}` : ''}
                                {r.chain_name ? ` · ${r.chain_name}` : ''}
                              </p>
                            </div>
                            {isActive ? (
                              <span className="text-xs font-medium text-wine-700 px-2 py-1 rounded-lg bg-wine-100">
                                Active
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void setActiveRestaurantId(r.id)}
                                className="text-sm font-medium text-wine-700 hover:bg-wine-50 px-3 py-1.5 rounded-lg"
                              >
                                Switch
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="text-xs text-gray-400 mt-4">
                    Invite teammates and manage roles in{' '}
                    <Link to="/settings?tab=team" className="text-wine-600 hover:underline">
                      Settings → Team
                    </Link>
                    .
                  </p>
                </section>
              </>
            )}

            {isOwner && (
              <section className="bg-gradient-to-br from-wine-50 to-white rounded-2xl border border-wine-100 p-6">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-wine-600 mt-0.5" />
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Upgrade</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Unlock advanced analytics, multi-location automation, and priority support.
                      Coming soon.
                    </p>
                    <button
                      type="button"
                      disabled
                      className="mt-3 px-3 py-1.5 rounded-lg text-sm font-medium bg-wine-100 text-wine-700 opacity-70 cursor-not-allowed"
                    >
                      Coming soon
                    </button>
                  </div>
                </div>
              </section>
            )}

            <section
              id="profile-danger"
              className="scroll-mt-24 bg-white rounded-2xl border border-red-100 p-6"
            >
              <h3 className="text-base font-semibold text-red-700 mb-4">Danger zone</h3>
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-medium text-gray-900">Leave this restaurant</p>
                  <p className="text-sm text-gray-500 mt-0.5 mb-3">
                    Remove yourself from {activeBranch?.name || 'the active restaurant'}. You will
                    lose access until re-invited.
                  </p>
                  <button
                    type="button"
                    onClick={() => void leaveRestaurant()}
                    disabled={leaving || !activeRestaurantId}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    {leaving ? 'Leaving…' : 'Leave restaurant'}
                  </button>
                </div>
                <div className="border-t border-red-50 pt-6">
                  <p className="text-sm font-medium text-gray-900">Delete account</p>
                  <p className="text-sm text-gray-500 mt-0.5 mb-3">
                    Permanently delete your WineOps account. This cannot be undone.
                  </p>
                  <input
                    value={confirmDelete}
                    onChange={(e) => setConfirmDelete(e.target.value)}
                    placeholder='Type DELETE to confirm'
                    className="w-full max-w-xs mb-3 px-3 py-2 rounded-xl border border-red-100 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void deleteAccount()}
                    disabled={deleting || confirmDelete !== 'DELETE'}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {deleting ? 'Deleting…' : 'Delete account'}
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Need restaurant settings instead?{' '}
                  <Link to="/settings" className="text-wine-600 hover:underline">
                    Open Settings
                  </Link>
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
