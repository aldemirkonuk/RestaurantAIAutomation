import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom'
import { readInviteMailSecret } from '../lib/inviteMailSecret'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Wine, ArrowRight, ArrowLeft, Check, X, AlertCircle, Mail, Lock, User } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { EndpaperShell } from '../components/brand/EndpaperShell'
import { Button } from '../components/ui'
import { apiClient } from '../services/api/client'
import { prefersReducedMotion } from '../lib/mudavym/motion'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton'
import '../components/brand/auth-house.css'
import { Pending } from '@/components/onboarding/Pending'

/** Height the valid-invite card takes (16 px gap included), measured in the r102 walk at 375 px. */
const INVITE_CARD_ROOM_PX = 142

/** ADR 0112 / DD-r102-3: reduced motion is no animation, opacity fades included. */
const dur = (seconds: number) => (prefersReducedMotion() ? 0 : seconds)

/*
 * THE HOUSE PATH (ADR 0133 §Decision 1). `usePublicDesign()` is the public
 * door's one switch; off, every className in this file is today's string,
 * untouched. On, the SAME elements take token colours and nothing else — the
 * founder chose "improve today's pages in place, no redraw" (ADR 0143 §1), and
 * `pages/__tests__/authPages.publicDesign.test.tsx` fails if anything but a
 * colour, shadow, ring or opacity class differs between the two.
 *
 * The swaps follow the rules written out in Login.tsx (grays by value to ink
 * and paper, the wine scale to the seal, card = paper-1 plate on the paper-0
 * ground with paper-0 fields inside, no hand-drawn focus rings, status hues
 * unchanged because the house stylesheet has no status token, `!` on <p>/<h*> colours
 * to outrank globals.css's `.dark p`). Two more that only this page needs:
 *   - white-alpha on the seal fill (`bg-white/20`, `text-white/75`) becomes
 *     the same alpha of `--paper-0`, the ink that sits on the seal, through
 *     `color-mix` — var-backed colours cannot take a Tailwind `/20` modifier.
 *   - literal İznik shadows keep their geometry and take `--seal-ring` (0.32,
 *     today 0.30/0.35) or `--seal-tint` (0.10, today 0.18/0.08) as colour.
 */
/** The shared Button merges `className` last (tailwind-merge), so this replaces
 *  its wine fill and its literal-rgba shadow rather than stacking on them. */
const HOUSE_BUTTON = 'bg-seal text-paper-0 hover:bg-seal-deep shadow-none hover:shadow-none'
// The wordmark this file drew above the old single card is the endpaper's
// now (`MarkDraws.tsx`, drawn once per page load; sketch 118).

// Email availability check result
type EmailAvailability = {
  checking: boolean
  available: boolean | null
  error: string | null
}

type Path = 'join' | 'create'
type PathAStep = 1 | 2

interface InvitePreview {
  valid: boolean
  organization?: string
  restaurant?: string
  city?: string
  inviter?: string
  role?: string
  reason?: 'not_found' | 'expired' | 'used'
}

export function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // ADR 0229 fork 9 (item 77): the invite mail's secret, carried here from
  // /invite/<code> as a fragment. Sent with the join; without it the new
  // account is unverified.
  const inviteMailSecret = readInviteMailSecret(useLocation().hash)
  const { registerAccount, joinViaInvite, error: authError } = useAuth()
  const on = usePublicDesign()

  // Read the address before the first paint. The two-card chooser is retired
  // (ADR 0344): RegisterDoor sends a bare /register to the landing page, so
  // this form is only ever reached with `?type=new`, `?type=join` or an
  // invite, and anything else opens the new-house form the landing's "Start
  // free" asks for.
  const [path, setPath] = useState<Path>(() => {
    const type = searchParams.get('type')
    if (searchParams.get('invite') || type === 'join') return 'join'
    return 'create'
  })
  const [pathAStep, setPathAStep] = useState<PathAStep>(1)
    const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Path A state
  // An invite link carries its code; read it before the first paint so the
  // card's room is held from the first frame, not one commit later (r103).
  const [inviteCode, setInviteCode] = useState(() => (searchParams.get('invite') ?? '').toUpperCase())
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null)
  const [validating, setValidating] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Path A account fields
  const [joinName, setJoinName] = useState('')
  const [joinEmail, setJoinEmail] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [joinConfirm, setJoinConfirm] = useState('')

  // Path B account fields
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createConfirm, setCreateConfirm] = useState('')

  // Email availability checking state
  const [joinEmailCheck, setJoinEmailCheck] = useState<EmailAvailability>({ checking: false, available: null, error: null })
  const [createEmailCheck, setCreateEmailCheck] = useState<EmailAvailability>({ checking: false, available: null, error: null })
  const emailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Email availability check — returns true=available, false=taken, null=error/unknown
  const checkEmailAvailability = useCallback(async (
    email: string,
    setEmailCheck: (check: EmailAvailability) => void,
  ): Promise<boolean | null> => {
    if (!email || !email.includes('@')) {
      setEmailCheck({ checking: false, available: null, error: null })
      return null
    }

    setEmailCheck({ checking: true, available: null, error: null })

    try {
      const { data } = await apiClient.get<{ available: boolean; email: string }>(
        `/auth/check-email?email=${encodeURIComponent(email)}`,
      )
      setEmailCheck({
        checking: false,
        available: data.available,
        error: data.available ? null : 'This email is already registered. Please sign in instead.',
      })
      return data.available
    } catch {
      // Network / server error — don't block registration, let the backend validate
      setEmailCheck({ checking: false, available: null, error: null })
      return null
    }
  }, [])

  // Debounced email check for Path A (join)
  const debouncedCheckJoinEmail = useCallback((email: string) => {
    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current)
    emailDebounceRef.current = setTimeout(() => {
      checkEmailAvailability(email, setJoinEmailCheck)
    }, 400)
  }, [checkEmailAvailability])

  // Debounced email check for Path B (create)
  const debouncedCheckCreateEmail = useCallback((email: string) => {
    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current)
    emailDebounceRef.current = setTimeout(() => {
      checkEmailAvailability(email, setCreateEmailCheck)
    }, 400)
  }, [checkEmailAvailability])

  // Auto-route from URL params on mount (D-09):
  // ?invite=CODE  → Path A (join) with code pre-filled
  // ?type=join    → Path A (join), no code pre-filled
  // ?type=new     → Path B (create restaurant)
  useEffect(() => {
    const code = searchParams.get('invite')
    const type = searchParams.get('type')
    if (code) {
      setInviteCode(code.toUpperCase())
      setPath('join')
    } else if (type === 'join') {
      setPath('join')
    } else if (type === 'new') {
      setPath('create')
    }
  }, [searchParams])

  // Inline invite validation — debounced 400ms (D-08)
  useEffect(() => {
    if (inviteCode.length !== 8) {
      setInvitePreview(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setValidating(true)
      try {
        const { data } = await apiClient.get<InvitePreview>(
          `/auth/invite/${inviteCode.toUpperCase()}`,
        )
        setInvitePreview(data)
      } catch {
        setInvitePreview({ valid: false, reason: 'not_found' })
      } finally {
        setValidating(false)
      }
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inviteCode])

  // PATH A — Step 1: Invite code entry
  const pathAStep1 = () => (
    <div key="pathA-1">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/register')}
        className={on ? 'flex items-center gap-1 text-sm text-inkm-3 hover:text-inkm-4 mb-6' : 'flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6'}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Step indicator: two dots connected by a line. The endpaper's folio
          carries the step on the house path ("Join · 1 of 2"). */}
      {!on && (
      <div className="flex items-start mb-7">
        {/* Step 1 — active */}
        <div className="flex flex-col items-center gap-1">
          <div className={on ? 'w-7 h-7 rounded-full bg-seal text-paper-0 text-[0.7rem] font-bold flex items-center justify-center shadow-[0_2px_8px_var(--seal-ring)]' : 'w-7 h-7 rounded-full bg-wine-600 text-white text-[0.7rem] font-bold flex items-center justify-center shadow-[0_2px_8px_rgba(26,94,107,0.3)]'}>
            1
          </div>
          <span className={on ? 'text-[0.68rem] font-semibold text-seal' : 'text-[0.68rem] font-semibold text-wine-600'}>Code</span>
        </div>
        {/* Connector line */}
        <div className={on ? 'flex-1 h-[2px] bg-paper-2 mt-[13px] mx-1' : 'flex-1 h-[2px] bg-gray-200 mt-[13px] mx-1'} />
        {/* Step 2 — pending */}
        <div className="flex flex-col items-center gap-1">
          <div className={on ? 'w-7 h-7 rounded-full bg-paper-1 border-2 border-paper-2 text-inkm-3 text-[0.7rem] font-bold flex items-center justify-center' : 'w-7 h-7 rounded-full bg-gray-100 border-2 border-gray-200 text-gray-400 text-[0.7rem] font-bold flex items-center justify-center'}>
            2
          </div>
          <span className={on ? 'text-[0.68rem] font-semibold text-inkm-3' : 'text-[0.68rem] font-semibold text-gray-400'}>Account</span>
        </div>
      </div>
      )}

      {/* Heading — on the house path the leaf's own title says this. */}
      {!on && (
      <div className="mb-[22px]">
        <h2 className="font-display text-[1.4rem] font-extrabold text-gray-900 tracking-tight mb-[5px]">
          Enter your invite code
        </h2>
        <p className="text-[0.875rem] text-gray-500">8-character code — check your email or Slack</p>
      </div>
      )}

      {/* Code input */}
      <div className="mb-[14px]">
        <div className={on ? 'mdv-ep-caps flex justify-between items-center mb-[7px]' : 'flex justify-between items-center text-[0.8rem] font-semibold text-gray-900 mb-[7px]'}>
          Invite Code
          <span className={on ? 'font-normal text-inkm-3 text-[0.74rem]' : 'font-normal text-gray-400 text-[0.74rem]'}>Auto-validates when complete</span>
        </div>
        <div className="relative">
          <input
            id="invite-code"
            type="text"
            aria-label="Invite Code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase().slice(0, 8))}
            className={[
              'block w-full py-4 px-[18px] pr-[50px]',
              'font-mono text-2xl font-bold tracking-[0.2em] uppercase text-center',
              'border-2 rounded-xl outline-none transition-all motion-reduce:transition-none',
              // House path: the status border stays (no status token), and
              // the three hand-drawn focus halos go — the seal outline comes
              // from auth-house.css.
              ...(on ? ['mdv-ep-code'] : []),
              invitePreview?.valid === true
                ? on
                  ? 'border-seal'
                  : 'border-green-500 focus:border-green-500 shadow-[0_0_0_3px_rgba(5,150,105,0.08)]'
                : invitePreview?.valid === false
                  ? on
                    ? 'border-red-400'
                    : 'border-red-400 focus:border-red-400 shadow-[0_0_0_3px_rgba(220,38,38,0.08)]'
                  : on
                    ? 'border-paper-2'
                    : 'border-gray-200 focus:border-wine-600 focus:shadow-[0_0_0_3px_rgba(26,94,107,0.08)]',
            ].join(' ')}
            placeholder="········"
            maxLength={8}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {/* Status icon */}
          {validating && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <Pending size="md" className={on ? 'text-inkm-3' : 'text-gray-400'} />
            </div>
          )}
          {!validating && invitePreview?.valid === true && (
            <div className={on ? 'absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-seal flex items-center justify-center' : 'absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center'}>
              <Check className="w-[10px] h-[10px] text-white stroke-[3]" />
            </div>
          )}
          {!validating && invitePreview?.valid === false && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
              <X className="w-[10px] h-[10px] text-white stroke-[3]" />
            </div>
          )}
        </div>
      </div>

      {/* r103: the card that arrives after the preview read pushed Continue from
          451 to 593 px (CLS 0.02 at 375). While the read is out, its room is held. */}
      {inviteCode.length === 8 && invitePreview === null && (
        <div aria-hidden data-testid="invite-card-room" style={{ minHeight: INVITE_CARD_ROOM_PX }} />
      )}
      {/* Trust card (valid) */}
      <AnimatePresence>
        {invitePreview?.valid === true && (
          <motion.div
            key="trust-card"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: dur(0.18), ease: 'easeOut' } }}
            exit={{ opacity: 0, y: -6, transition: { duration: dur(0.13), ease: 'easeIn' } }}
            className={on ? 'mb-4 border border-paper-2 rounded-[3px] overflow-hidden' : 'mb-4 border border-green-200 rounded-xl overflow-hidden'}
          >
            {/* Green top — on the house path, a paper plate: the seal marks it good */}
            <div className={on ? 'bg-paper-1 px-4 py-[14px] flex items-center gap-[10px]' : 'bg-green-50 px-4 py-[14px] flex items-center gap-[10px]'}>
              <div className={on ? 'w-[38px] h-[38px] rounded-[3px] bg-paper-0 border border-paper-2 flex items-center justify-center flex-shrink-0' : 'w-[38px] h-[38px] rounded-[10px] bg-white border border-green-200 flex items-center justify-center flex-shrink-0'}>
                <Wine className={on ? 'w-[18px] h-[18px] text-seal' : 'w-[18px] h-[18px] text-green-600'} />
              </div>
              <div>
                <p className={on ? 'font-display font-bold !text-inkm-1 text-[0.9375rem]' : 'font-display font-bold text-green-900 text-[0.9375rem]'}>
                  {invitePreview.restaurant}
                  {invitePreview.city && ` — ${invitePreview.city}`}
                </p>
              </div>
              <div className={on ? 'ml-auto w-[22px] h-[22px] rounded-full bg-seal flex items-center justify-center' : 'ml-auto w-[22px] h-[22px] rounded-full bg-green-500 flex items-center justify-center'}>
                <Check className={on ? 'w-[11px] h-[11px] text-paper-0 stroke-[3]' : 'w-[11px] h-[11px] text-white stroke-[3]'} />
              </div>
            </div>
            {/* White bottom */}
            <div className={on ? 'bg-paper-0 px-4 py-[10px] flex justify-between' : 'bg-white px-4 py-[10px] flex justify-between'}>
              <div className="flex flex-col gap-[2px]">
                <span className={on ? 'text-[0.67rem] uppercase tracking-[0.07em] text-inkm-3 font-semibold' : 'text-[0.67rem] uppercase tracking-[0.07em] text-gray-400 font-semibold'}>Invited by</span>
                <span className={on ? 'text-[0.8rem] font-bold text-inkm-1' : 'text-[0.8rem] font-bold text-gray-900'}>{invitePreview.inviter}</span>
              </div>
              <div className={on ? 'w-px bg-paper-2' : 'w-px bg-gray-100'} />
              <div className="flex flex-col gap-[2px]">
                <span className={on ? 'text-[0.67rem] uppercase tracking-[0.07em] text-inkm-3 font-semibold' : 'text-[0.67rem] uppercase tracking-[0.07em] text-gray-400 font-semibold'}>Your Role</span>
                <span className={on ? 'text-[0.8rem] font-bold text-seal' : 'text-[0.8rem] font-bold text-wine-600'}>{invitePreview.role}</span>
              </div>
              <div className={on ? 'w-px bg-paper-2' : 'w-px bg-gray-100'} />
              <div className="flex flex-col gap-[2px]">
                <span className={on ? 'text-[0.67rem] uppercase tracking-[0.07em] text-inkm-3 font-semibold' : 'text-[0.67rem] uppercase tracking-[0.07em] text-gray-400 font-semibold'}>Expires</span>
                <span className={on ? 'text-[0.8rem] font-bold text-inkm-1' : 'text-[0.8rem] font-bold text-gray-900'}>7 days</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invalid card */}
      <AnimatePresence>
        {invitePreview?.valid === false && (
          <motion.div
            key="invalid-card"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: dur(0.2) }}
            className={on ? 'mdv-ep-note border-red-700' : 'mb-4 flex items-center gap-[9px] bg-red-50 border border-red-200 rounded-lg px-[14px] py-[11px]'}
          >
            {!on && <X className="w-[15px] h-[15px] text-red-600 flex-shrink-0" />}
            <span className={on ? 'mdv-ep-note-title !text-red-800' : 'text-[0.8125rem] text-red-600 font-medium'}>
              {invitePreview.reason === 'expired'
                ? 'This invite code has expired. Contact the restaurant owner for a new one.'
                : invitePreview.reason === 'used'
                  ? 'This invite code has already been used.'
                  : 'Code not found, expired, or already used'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        className={on ? `w-full h-12 motion-reduce:transition-none ${HOUSE_BUTTON}` : 'w-full h-12 motion-reduce:transition-none'}
        disabled={!invitePreview?.valid || loading}
        type="button"
        onClick={() => setPathAStep(2)}
      >
        Continue <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  )

  // PATH A — Step 2: Account fields + submit
  const handleJoinSubmit = async () => {
    if (joinPassword !== joinConfirm) {
      setError('Passwords do not match')
      return
    }
    if (joinPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await joinViaInvite({
        code: inviteCode,
        name: joinName,
        email: joinEmail,
        password: joinPassword,
        ...(inviteMailSecret ? { emailSecret: inviteMailSecret } : {}),
      })
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join restaurant')
    } finally {
      setLoading(false)
    }
  }

  const pathAStep2 = () => (
    <div key="pathA-2">
      <button
        type="button"
        onClick={() => setPathAStep(1)}
        className={on ? 'flex items-center gap-1 text-sm text-inkm-3 hover:text-inkm-4 mb-4' : 'flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4'}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* On the house path the endpaper carries the house's name and who is
          expecting you, and the leaf's title says what this page is — so the
          banner and the "Your Account" heading are today's page only. */}
      {!on && invitePreview?.valid && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-sm text-green-700 font-medium">
            Joining <strong>{invitePreview.restaurant}</strong>
            {invitePreview.city && ` · ${invitePreview.city}`}
          </p>
          <p className="text-xs text-green-600 mt-0.5">
            Invited by {invitePreview.inviter} · Role: {invitePreview.role}
          </p>
        </div>
      )}
      {!on && <h2 className="text-xl font-bold text-gray-900 mb-5">Your Account</h2>}
      <div className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="join-name" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Full Name *</label>
          <div className="relative">
            <User className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="join-name"
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Jane Smith"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>

        {/* Email with availability check */}
        <div>
          <label htmlFor="join-email" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Email *</label>
          <div className="relative">
            <Mail className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="join-email"
              type="email"
              value={joinEmail}
              onChange={(e) => {
                setJoinEmail(e.target.value)
                debouncedCheckJoinEmail(e.target.value)
              }}
              placeholder="jane@restaurant.com"
              className={[
                on
                  ? 'block w-full pl-10 pr-10 py-3 border rounded-lg bg-paper-0 focus:outline-none transition-all motion-reduce:transition-none'
                  : 'block w-full pl-10 pr-10 py-3 border rounded-lg bg-white/80 focus:ring-2 focus:outline-none transition-all motion-reduce:transition-none',
                joinEmailCheck.available === false
                  ? (on ? 'border-red-400' : 'border-red-400 focus:border-red-500 focus:ring-red-500/20')
                  : joinEmailCheck.available === true
                    ? (on ? 'border-seal' : 'border-green-400 focus:border-green-500 focus:ring-green-500/20')
                    : (on ? 'border-paper-2' : 'border-gray-300 focus:border-wine-500 focus:ring-wine-500/20')
              ].join(' ')}
            />
            {/* Status icon */}
            {joinEmailCheck.checking && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Pending className={on ? 'text-inkm-3' : 'text-gray-400'} />
              </div>
            )}
            {!joinEmailCheck.checking && joinEmailCheck.available === true && (
              <div className={on ? 'absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-seal flex items-center justify-center' : 'absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center'}>
                <Check className={on ? 'w-3 h-3 text-paper-0 stroke-[3]' : 'w-3 h-3 text-white stroke-[3]'} />
              </div>
            )}
            {!joinEmailCheck.checking && joinEmailCheck.available === false && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <X className="w-3 h-3 text-white stroke-[3]" />
              </div>
            )}
          </div>
          {/* Availability message */}
          <AnimatePresence mode="wait">
            {joinEmailCheck.available === false && joinEmailCheck.error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: dur(0.18), ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -4, transition: { duration: dur(0.13), ease: 'easeIn' } }}
                className="mt-2 flex items-center gap-2 text-sm text-red-600"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{joinEmailCheck.error}</span>
                <Link to="/login" className={on ? 'text-seal hover:text-seal-deep font-medium underline' : 'text-wine-600 hover:text-wine-700 font-medium underline'}>
                  Sign in
                </Link>
              </motion.div>
            )}
            {joinEmailCheck.available === true && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: dur(0.18), ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -4, transition: { duration: dur(0.13), ease: 'easeIn' } }}
                className={on ? 'mt-1 text-xs !text-seal' : 'mt-1 text-xs text-green-600'}
              >
                Email is available
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="join-password" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Password *</label>
          <div className="relative">
            <Lock className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="join-password"
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder="••••••••"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
          <p className={on ? 'text-xs !text-inkm-3 mt-1' : 'text-xs text-gray-400 mt-1'}>Min. 8 characters</p>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="join-confirm-password" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Confirm Password *</label>
          <div className="relative">
            <Lock className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="join-confirm-password"
              type="password"
              value={joinConfirm}
              onChange={(e) => setJoinConfirm(e.target.value)}
              placeholder="••••••••"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>
      </div>
      {(error || authError) && (
        <div role={on ? 'alert' : undefined} className={on ? 'mdv-ep-note mt-4 border-red-700' : 'mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2'}>
          {!on && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
          <p className={on ? 'mdv-ep-note-title !text-red-800' : 'text-sm text-red-700'}>{error || authError}</p>
        </div>
      )}
      <Button
        className={on ? `w-full h-12 mt-5 motion-reduce:transition-none ${HOUSE_BUTTON}` : 'w-full h-12 mt-5 motion-reduce:transition-none'}
        disabled={loading || joinEmailCheck.checking || !joinName || !joinEmail || !joinPassword || !joinConfirm || joinEmailCheck.available === false}
        onClick={async () => {
          // If debounced check hasn't settled, run immediately before submitting
          let available = joinEmailCheck.available
          if (available === null && joinEmail && joinEmail.includes('@')) {
            available = await checkEmailAvailability(joinEmail, setJoinEmailCheck)
          }
          if (available === false) {
            setError('This email is already registered. Please sign in instead.')
            return
          }
          handleJoinSubmit()
        }}
      >
        {loading ? (
          <>
            <Pending label="Joining..." />
          </>
        ) : joinEmailCheck.checking ? (
          <>
            <Pending label="Checking email…" />
          </>
        ) : (
          'Join Restaurant'
        )}
      </Button>
    </div>
  )

  // PATH B — Step 1: Account fields — called as a function
  const pathBStep1 = () => (
    <div key="pathB-1">
      <button
        type="button"
        onClick={() => navigate('/register')}
        className={on ? 'flex items-center gap-1 text-sm text-inkm-3 hover:text-inkm-4 mb-4' : 'flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-4'}
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* Step indicator (simple bar for Path B step 1). On the house path the
          leaf's folio carries the step and its title names the page. */}
      {!on && (
        <>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1.5 flex-1 rounded-full bg-wine-600" />
            <span className="text-xs text-gray-400 ml-1">Account</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-5">Your Account</h2>
        </>
      )}
      <div className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="create-name" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Full Name *</label>
          <div className="relative">
            <User className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="create-name"
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="John Smith"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>

        {/* Email with availability check */}
        <div>
          <label htmlFor="create-email" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Email *</label>
          <div className="relative">
            <Mail className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="create-email"
              type="email"
              value={createEmail}
              onChange={(e) => {
                setCreateEmail(e.target.value)
                debouncedCheckCreateEmail(e.target.value)
              }}
              placeholder="john@myrestaurant.com"
              className={[
                on
                  ? 'block w-full pl-10 pr-10 py-3 border rounded-lg bg-paper-0 focus:outline-none transition-all motion-reduce:transition-none'
                  : 'block w-full pl-10 pr-10 py-3 border rounded-lg bg-white/80 focus:ring-2 focus:outline-none transition-all motion-reduce:transition-none',
                createEmailCheck.available === false
                  ? (on ? 'border-red-400' : 'border-red-400 focus:border-red-500 focus:ring-red-500/20')
                  : createEmailCheck.available === true
                    ? (on ? 'border-seal' : 'border-green-400 focus:border-green-500 focus:ring-green-500/20')
                    : (on ? 'border-paper-2' : 'border-gray-300 focus:border-wine-500 focus:ring-wine-500/20')
              ].join(' ')}
            />
            {/* Status icon */}
            {createEmailCheck.checking && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Pending className={on ? 'text-inkm-3' : 'text-gray-400'} />
              </div>
            )}
            {!createEmailCheck.checking && createEmailCheck.available === true && (
              <div className={on ? 'absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-seal flex items-center justify-center' : 'absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center'}>
                <Check className={on ? 'w-3 h-3 text-paper-0 stroke-[3]' : 'w-3 h-3 text-white stroke-[3]'} />
              </div>
            )}
            {!createEmailCheck.checking && createEmailCheck.available === false && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <X className="w-3 h-3 text-white stroke-[3]" />
              </div>
            )}
          </div>
          {/* Availability message */}
          <AnimatePresence mode="wait">
            {createEmailCheck.available === false && createEmailCheck.error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: dur(0.18), ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -4, transition: { duration: dur(0.13), ease: 'easeIn' } }}
                className="mt-2 flex items-center gap-2 text-sm text-red-600"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{createEmailCheck.error}</span>
                <Link to="/login" className={on ? 'text-seal hover:text-seal-deep font-medium underline' : 'text-wine-600 hover:text-wine-700 font-medium underline'}>
                  Sign in
                </Link>
              </motion.div>
            )}
            {createEmailCheck.available === true && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: dur(0.18), ease: 'easeOut' } }}
                exit={{ opacity: 0, y: -4, transition: { duration: dur(0.13), ease: 'easeIn' } }}
                className={on ? 'mt-1 text-xs !text-seal' : 'mt-1 text-xs text-green-600'}
              >
                Email is available
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="create-password" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Password *</label>
          <div className="relative">
            <Lock className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="create-password"
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="••••••••"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
          <p className={on ? 'text-xs !text-inkm-3 mt-1' : 'text-xs text-gray-400 mt-1'}>Min. 8 characters</p>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="create-confirm-password" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Confirm Password *</label>
          <div className="relative">
            <Lock className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="create-confirm-password"
              type="password"
              value={createConfirm}
              onChange={(e) => setCreateConfirm(e.target.value)}
              placeholder="••••••••"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>
      </div>
      <Button
        type="button"
        className={on ? `w-full h-12 mt-5 motion-reduce:transition-none ${HOUSE_BUTTON}` : 'w-full h-12 mt-5 motion-reduce:transition-none'}
        disabled={
          !createName ||
          !createEmail ||
          createPassword.length < 8 ||
          createPassword !== createConfirm ||
          createEmailCheck.available === false ||
          createEmailCheck.checking
        }
        onClick={async () => {
          if (createPassword !== createConfirm) {
            setError('Passwords do not match')
            return
          }

          // If the debounced check hasn't settled, run it immediately now
          let available = createEmailCheck.available
          if (available === null && createEmail && createEmail.includes('@')) {
            available = await checkEmailAvailability(createEmail, setCreateEmailCheck)
          }

          if (available === false) {
            setError('This email is already registered. Please sign in instead.')
            return
          }

          setError(null)
          setLoading(true)
          try {
            await registerAccount({
              name: createName,
              email: createEmail,
              password: createPassword,
            })
            navigate('/verify-email', { replace: true })
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Registration failed')
          } finally {
            setLoading(false)
          }
        }}
      >
        {createEmailCheck.checking ? (
          <>
            <Pending label="Checking email…" />
          </>
        ) : (
          <>Create account <ArrowRight className="w-4 h-4 ml-1" /></>
        )}
      </Button>
      <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        or
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <GoogleSignInButton
        mode="register"
        onSuccess={() => navigate('/get-started', { replace: true })}
        onError={setError}
      />
    </div>
  )

  // Single step key — AnimatePresence fires ONLY when the user actually navigates between steps
  const stepKey = `${path}-${path === 'join' ? pathAStep : 1}`

  const content = (() => {
    if (path === 'join') return pathAStep === 1 ? pathAStep1() : pathAStep2()
    if (path === 'create') return pathBStep1()
  })()

  // sketch 118 · Direction B, the founder's pick (2026-09-19; ADR 0149 row 35,
  // his build directions in the sketch README). The endpaper holds still
  // across every register screen: its kicker is the page's, its line is house
  // voice until the form knows the house's name, and then it is that name —
  // the one place the endpaper changes. The leaf carries everything that
  // changes per screen, and the folio is the only place a step is counted.
  // Derived from the existing path/pathAStep state; the flow above
  // is untouched.
  const endpaperFor = (): { houseLine: string; tag: string; folio: string; title: string; lede: string } => {
    const voice = { houseLine: 'Every house keeps its own.', tag: 'Open one, or be entered in one that already exists.' }
    if (path === 'join') {
      const named = invitePreview?.valid ? invitePreview.restaurant : undefined
      const expecting =
        pathAStep === 2 && invitePreview?.valid && invitePreview.inviter && invitePreview.role
          ? `${invitePreview.inviter} is expecting you, as a ${invitePreview.role}.`
          : undefined
      return {
        houseLine: named ?? voice.houseLine,
        tag: expecting ?? voice.tag,
        folio: pathAStep === 1 ? 'Join · 1 of 2' : 'Join · 2 of 2',
        title: pathAStep === 1 ? 'Be entered in a book that exists.' : 'Who is joining?',
        lede:
          pathAStep === 1
            ? 'The code names the house before you have an account.'
            : `Your own line in ${named ?? 'the house'}'s book.`,
      }
    }
    return {
      ...voice,
      folio: 'Register',
      title: 'Who keeps this book?',
      lede: 'Name, email, and a password — or continue with Google. The house comes after you verify.',
    }
  }

  if (on) {
    const ep = endpaperFor()
    return (
      <EndpaperShell
        kicker="A new set of books"
        houseLine={ep.houseLine}
        tag={ep.tag}
        folio={ep.folio}
        pageKey={stepKey}
      >
        <h2 className="mdv-ep-leaf-title">{ep.title}</h2>
        <p className="mdv-ep-leaf-lede">{ep.lede}</p>
        {content}
      </EndpaperShell>
    )
  }

  return (
    <div className="relative min-h-screen flex items-start justify-center px-4 py-12 overflow-hidden bg-[#FAF7F5]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(26,94,107,0.10),transparent_50%),radial-gradient(ellipse_at_100%_100%,rgba(26,94,107,0.07),transparent_45%)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur(0.5) }}
        className="relative w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={prefersReducedMotion() ? { duration: 0 } : { delay: 0.1, type: 'spring' }}
            className="inline-flex mb-5"
          >
            <BrandMark size={34} />
          </motion.div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">Join Mudavym</h1>
          <p className="text-[15px] text-gray-500">Transform your restaurant&apos;s wine operations</p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <div
            key={stepKey}
            className="rounded-2xl border border-wine-100/80 bg-white/80 backdrop-blur-md p-8 overflow-hidden shadow-[0_24px_64px_-24px_rgba(26,94,107,0.18),0_8px_24px_-12px_rgba(15,23,42,0.08)]"
          >
            {content}
          </div>
        </AnimatePresence>

        <p className="text-center text-xs text-gray-400 mt-8">© 2026 Mudavym. All rights reserved.</p>
      </motion.div>
    </div>
  )
}
