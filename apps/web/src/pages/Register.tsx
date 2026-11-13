import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom'
import { readInviteMailSecret } from '../lib/inviteMailSecret'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { Wine, Users, ArrowRight, ArrowLeft, Check, X, Loader2, AlertCircle, Mail, Lock, User, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { BrandMark } from '../components/brand/BrandMark'
import { signUpRefusal } from '../lib/authWords'
import { EndpaperShell } from '../components/brand/EndpaperShell'
import { Button } from '../components/ui'
import { apiClient } from '../services/api/client'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton'
import '../components/brand/auth-house.css'

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

/**
 * One password box with a show/hide toggle (OB-11). The confirm box went: a
 * person who can see what they typed does not need to type it twice.
 */
function PasswordInput({
  id,
  value,
  onChange,
  on,
  describedBy,
  invalid,
  required,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  on: boolean
  /** Ids of the lines that explain the box (its hint, and what it still needs). */
  describedBy?: string
  invalid?: boolean
  required?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Lock className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        className={on ? 'block w-full pl-10 pr-11 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-11 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className={on ? 'absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-inkm-3 hover:text-inkm-2' : 'absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600'}
      >
        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

/**
 * What the account step still needs, in the order its boxes stand. The button
 * used to stay greyed until all three were right and said nothing about why;
 * now a press names what is missing, marks those boxes and moves to the first
 * (walk r23, register-step2).
 */
type AccountGap = { id: 'create-name' | 'create-email' | 'create-password'; words: string }
function accountGaps(name: string, email: string, password: string): AccountGap[] {
  const gaps: AccountGap[] = []
  if (!name.trim()) gaps.push({ id: 'create-name', words: 'your name' })
  if (!email.trim()) gaps.push({ id: 'create-email', words: 'your email address' })
  else if (!email.includes('@')) gaps.push({ id: 'create-email', words: 'an email address with an @ in it' })
  if (password.length < 8) gaps.push({ id: 'create-password', words: 'a password of at least 8 characters' })
  return gaps
}
function gapSentence(gaps: AccountGap[]): string {
  const words = gaps.map((g) => g.words)
  const list = words.length < 2 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return `Add ${list}.`
}

type Path = 'selector' | 'join' | 'create'
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
  const { registerAccount, joinViaInvite, error: authError, clearError: clearAuthError } = useAuth()
  const on = usePublicDesign()

  const [path, setPath] = useState<Path>('selector')
  const [pathAStep, setPathAStep] = useState<PathAStep>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Path A state
  const [inviteCode, setInviteCode] = useState('')
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null)
  const [validating, setValidating] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Path A account fields
  const [joinName, setJoinName] = useState('')
  const [joinEmail, setJoinEmail] = useState('')
  const [joinPassword, setJoinPassword] = useState('')

  // Path B account fields
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  // Set by the first press with something missing; from then the step says
  // what is still missing, and the sentence goes when the boxes are filled.
  const [createTried, setCreateTried] = useState(false)
  const createGaps = accountGaps(createName, createEmail, createPassword)
  const createSays = createTried && createGaps.length > 0 ? gapSentence(createGaps) : null
  const createGap = (id: AccountGap['id']) => createTried && createGaps.some((g) => g.id === id)

  // A refused sign-up that means "this address already has an account"
  // offers Sign in under the sentence; a 429 holds the button until the
  // wait the gateway named has passed (OB-11). No address is probed while
  // it is typed: the account call itself says whether it is taken.
  const [signInHint, setSignInHint] = useState(false)
  const [waitUntil, setWaitUntil] = useState(0)
  // The wait sentence names a number of seconds. When those seconds have
  // passed and the button comes back, the sentence goes with it: a page that
  // still says "Wait 40 seconds" beside a live button contradicts itself.
  const waitSaid = useRef<string | null>(null)
  useEffect(() => {
    if (waitUntil <= Date.now()) return
    const t = setTimeout(() => {
      // Read the ref now: the updater runs at render, after it is cleared.
      const said = waitSaid.current
      waitSaid.current = null
      setWaitUntil(0)
      setError((cur) => (cur !== null && cur === said ? null : cur))
    }, waitUntil - Date.now())
    return () => clearTimeout(t)
  }, [waitUntil])
  const waiting = waitUntil > Date.now()
  const sayRefusal = (err: unknown, where: 'account' | 'join') => {
    const r = signUpRefusal(err, where)
    // This page words the refusal itself. The auth context's own sentence for
    // the same failure ("Too many requests. Please try again later.") would
    // otherwise show through `error || authError` once this one is cleared.
    clearAuthError?.()
    setError(r.text)
    setSignInHint(r.kind === 'exists')
    waitSaid.current = r.kind === 'wait' ? r.text : null
    if (r.kind === 'wait') setWaitUntil(Date.now() + (r.seconds ?? 60) * 1000)
  }

  // Auto-route from URL params on mount (D-09):
  // ?invite=CODE  → Path A (join) with code pre-filled
  // ?type=join    → Path A (join), no code pre-filled
  // ?type=new     → Path B (create restaurant), skip selector
  // default       → show path selector
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

  // PATH SELECTOR — Desktop: 2-col feature cards | Mobile: bold stacked
  const pathSelector = () => (
    <motion.div
      key="selector"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {on ? (
        /* The door, as sketch 118 draws it: two plain acts, the new house
           first. Same two paths as the cards below (create, join), one
           layout at every width. */
        <div className="mdv-ep-acts">
          <Button type="button" variant="default" size="lg" onClick={() => setPath('create')} className={`w-full ${HOUSE_BUTTON}`}>
            I&apos;m opening a new house
          </Button>
          <button type="button" onClick={() => setPath('join')} className="mdv-ep-act-quiet">
            I have an invite code
          </button>
        </div>
      ) : (
      <>
      {/* ── DESKTOP: Feature Cards (≥641px) ── */}
      <div className="hidden sm:grid grid-cols-2 gap-4">
        {/* Join card */}
        <button
          type="button"
          onClick={() => setPath('join')}
          className={on ? 'bg-paper-0 border border-paper-2 rounded-2xl p-7 text-left hover:-translate-y-0.5 transition-all hover:border-seal-ring' : 'bg-white border border-gray-200 rounded-2xl p-7 text-left hover:-translate-y-0.5 transition-all hover:shadow-card-hover hover:border-gray-300'}
        >
          <div className={on ? 'w-[50px] h-[50px] rounded-[13px] bg-seal-tint flex items-center justify-center mb-[18px]' : 'w-[50px] h-[50px] rounded-[13px] bg-wine-100 flex items-center justify-center mb-[18px]'}>
            <Users className={on ? 'w-[22px] h-[22px] text-seal' : 'w-[22px] h-[22px] text-wine-600'} />
          </div>
          <p className={on ? 'font-bold !text-inkm-1 text-[1.1rem] leading-tight mb-2' : 'font-bold text-gray-900 text-[1.1rem] leading-tight mb-2'}>Join Your Team</p>
          <p className={on ? 'text-[0.8rem] !text-inkm-3 leading-[1.55] mb-5' : 'text-[0.8rem] text-gray-500 leading-[1.55] mb-5'}>
            Your manager sent you an invite. Enter the 8-character code to join their restaurant.
          </p>
          <ul className="space-y-[7px] mb-6">
            {['Instant dashboard access', 'Role assigned by owner', 'No email verification needed'].map((item) => (
              <li key={item} className={on ? 'flex items-center gap-[7px] text-[0.8rem] text-inkm-3' : 'flex items-center gap-[7px] text-[0.8rem] text-gray-500'}>
                <Check className={on ? 'w-[11px] h-[11px] text-seal flex-shrink-0' : 'w-[11px] h-[11px] text-wine-600 flex-shrink-0'} />
                {item}
              </li>
            ))}
          </ul>
          <div className={on ? 'w-full py-[11px] px-[18px] rounded-[9px] bg-seal text-paper-0 text-[0.9rem] font-bold text-center' : 'w-full py-[11px] px-[18px] rounded-[9px] bg-wine-600 text-white text-[0.9rem] font-bold text-center'}>
            Enter Invite Code →
          </div>
        </button>

        {/* Create card */}
        <button
          type="button"
          onClick={() => setPath('create')}
          className={on ? 'bg-seal rounded-2xl p-7 text-left hover:-translate-y-0.5 transition-all hover:bg-seal-deep' : 'bg-wine-600 rounded-2xl p-7 text-left hover:-translate-y-0.5 transition-all hover:bg-wine-700'}
          style={on ? { boxShadow: '0 8px 24px var(--seal-ring)' } : { boxShadow: '0 8px 24px rgba(26,94,107,0.3)' }}
        >
          <div className={on ? 'w-[50px] h-[50px] rounded-[13px] bg-[color:color-mix(in_srgb,var(--paper-0)_20%,transparent)] flex items-center justify-center mb-[18px]' : 'w-[50px] h-[50px] rounded-[13px] bg-white/20 flex items-center justify-center mb-[18px]'}>
            <Wine className={on ? 'w-[22px] h-[22px] text-paper-0' : 'w-[22px] h-[22px] text-white'} />
          </div>
          <p className={on ? 'font-bold !text-paper-0 text-[1.1rem] leading-tight mb-2' : 'font-bold text-white text-[1.1rem] leading-tight mb-2'}>Open a Restaurant</p>
          <p className={on ? 'text-[0.8rem] !text-[color:color-mix(in_srgb,var(--paper-0)_75%,transparent)] leading-[1.55] mb-5' : 'text-[0.8rem] text-white/75 leading-[1.55] mb-5'}>
            Register your restaurant and start managing wine inventory with AI in minutes.
          </p>
          <ul className="space-y-[7px] mb-6">
            {['AI inventory agents', 'POS + supplier sync', 'Multi-location ready'].map((item) => (
              <li key={item} className={on ? 'flex items-center gap-[7px] text-[0.8rem] text-[color:color-mix(in_srgb,var(--paper-0)_85%,transparent)]' : 'flex items-center gap-[7px] text-[0.8rem] text-white/85'}>
                <Check className={on ? 'w-[11px] h-[11px] text-[color:color-mix(in_srgb,var(--paper-0)_90%,transparent)] flex-shrink-0' : 'w-[11px] h-[11px] text-white/90 flex-shrink-0'} />
                {item}
              </li>
            ))}
          </ul>
          <div className={on ? 'w-full py-[11px] px-[18px] rounded-[9px] bg-[color:color-mix(in_srgb,var(--paper-0)_20%,transparent)] text-paper-0 text-[0.9rem] font-bold text-center hover:bg-[color:color-mix(in_srgb,var(--paper-0)_30%,transparent)] transition-colors' : 'w-full py-[11px] px-[18px] rounded-[9px] bg-white/20 text-white text-[0.9rem] font-bold text-center hover:bg-white/30 transition-colors'}>
            Get Started Free →
          </div>
        </button>
      </div>

      {/* ── MOBILE: Bold primary stacked (<641px) ── */}
      <div className="sm:hidden flex flex-col gap-[14px]">
        {/* Create — primary */}
        <button
          type="button"
          onClick={() => setPath('create')}
          className={on ? 'relative bg-seal rounded-[20px] p-[26px] text-left overflow-hidden hover:-translate-y-0.5 transition-all' : 'relative bg-wine-600 rounded-[20px] p-[26px] text-left overflow-hidden hover:-translate-y-0.5 transition-all'}
          style={on ? { boxShadow: '0 8px 24px var(--seal-ring)' } : { boxShadow: '0 8px 24px rgba(26,94,107,0.3)' }}
        >
          <span
            className={on ? 'inline-flex items-center gap-[5px] bg-[color:color-mix(in_srgb,var(--paper-0)_20%,transparent)] text-paper-0 text-[0.65rem] font-bold tracking-widest uppercase px-[9px] py-[3px] rounded-full mb-3' : 'inline-flex items-center gap-[5px] bg-white/20 text-white text-[0.65rem] font-bold tracking-widest uppercase px-[9px] py-[3px] rounded-full mb-3'}
          >
            Most Popular
          </span>
          <p className={on ? 'font-bold !text-paper-0 text-[1.2rem] mb-[5px]' : 'font-bold text-white text-[1.2rem] mb-[5px]'}>Create a New Restaurant</p>
          <p className={on ? 'text-[0.8125rem] !text-[color:color-mix(in_srgb,var(--paper-0)_80%,transparent)]' : 'text-[0.8125rem] text-white/80'}>Set up your restaurant in under 3 minutes</p>
          <div className={on ? 'absolute right-[22px] top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-[color:color-mix(in_srgb,var(--paper-0)_20%,transparent)] flex items-center justify-center' : 'absolute right-[22px] top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-white/20 flex items-center justify-center'}>
            <ArrowRight className={on ? 'w-[14px] h-[14px] text-paper-0' : 'w-[14px] h-[14px] text-white'} />
          </div>
        </button>

        {/* Divider */}
        <div className={on ? 'flex items-center gap-3 text-inkm-3 text-[0.75rem]' : 'flex items-center gap-3 text-gray-400 text-[0.75rem]'}>
          <div className={on ? 'flex-1 h-px bg-paper-2' : 'flex-1 h-px bg-gray-200'} />
          or
          <div className={on ? 'flex-1 h-px bg-paper-2' : 'flex-1 h-px bg-gray-200'} />
        </div>

        {/* Join — secondary glassmorphism */}
        <button
          type="button"
          onClick={() => setPath('join')}
          className={on ? 'bg-paper-0 backdrop-blur border border-paper-2 rounded-[18px] px-[22px] py-[20px] flex items-center gap-[14px] hover:border-seal hover:-translate-y-0.5 transition-all' : 'bg-white/70 backdrop-blur border border-gray-200 rounded-[18px] px-[22px] py-[20px] flex items-center gap-[14px] hover:border-wine-400 hover:-translate-y-0.5 transition-all'}
        >
          <div className={on ? 'w-[40px] h-[40px] rounded-[11px] bg-seal-tint flex items-center justify-center flex-shrink-0' : 'w-[40px] h-[40px] rounded-[11px] bg-wine-100 flex items-center justify-center flex-shrink-0'}>
            <Users className={on ? 'w-[18px] h-[18px] text-seal' : 'w-[18px] h-[18px] text-wine-600'} />
          </div>
          <div className="text-left">
            <p className={on ? 'font-bold !text-inkm-1 text-[0.9375rem] mb-[2px]' : 'font-bold text-gray-900 text-[0.9375rem] mb-[2px]'}>Join an Existing Restaurant</p>
            <p className={on ? 'text-[0.78rem] !text-inkm-3' : 'text-[0.78rem] text-gray-500'}>I have an invite code from my manager</p>
          </div>
          <ChevronRight className={on ? 'w-[14px] h-[14px] text-inkm-3 ml-auto' : 'w-[14px] h-[14px] text-gray-400 ml-auto'} />
        </button>
      </div>

      {/* Trust row — desktop only */}
      <div className="hidden sm:flex items-center justify-center gap-[18px] mt-4">
        {['No credit card', '3-minute setup', 'Cancel anytime'].map((item) => (
          <span key={item} className={on ? 'flex items-center gap-[5px] text-xs text-inkm-3' : 'flex items-center gap-[5px] text-xs text-gray-400'}>
            <Check className="w-[11px] h-[11px] text-green-600 flex-shrink-0" />
            {item}
          </span>
        ))}
      </div>
      </>
      )}

      <p className={on ? 'text-center text-sm !text-inkm-3 mt-6' : 'text-center text-sm text-gray-500 mt-6'}>
        Already have an account?{' '}
        <Link to="/login" className={on ? 'text-seal hover:text-seal-deep font-medium' : 'text-wine-600 hover:text-wine-700 font-medium'}>
          Sign in
        </Link>
      </p>
    </motion.div>
  )

  // PATH A — Step 1: Invite code entry
  const pathAStep1 = () => (
    <motion.div
      key="pathA-1"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {/* Back */}
      <button
        type="button"
        onClick={() => setPath('selector')}
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
              'border-2 rounded-xl outline-none transition-all',
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
              <Loader2 className={on ? 'w-5 h-5 text-inkm-3 animate-spin' : 'w-5 h-5 text-gray-400 animate-spin'} />
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

      {/* Trust card (valid) */}
      <AnimatePresence>
        {invitePreview?.valid === true && (
          <motion.div
            key="trust-card"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
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
        className={on ? `w-full h-12 ${HOUSE_BUTTON}` : 'w-full h-12'}
        disabled={!invitePreview?.valid || loading}
        type="button"
        onClick={() => setPathAStep(2)}
      >
        Continue <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </motion.div>
  )

  // PATH B — Step 1: make the account (no house yet; it comes after verify).
  // No address probe first: the account call says when an address is taken.
  const handleAccountSubmit = async () => {
    setError(null)
    setSignInHint(false)
    setLoading(true)
    try {
      await registerAccount({
        name: createName,
        email: createEmail,
        password: createPassword,
      })
      navigate('/verify-email', { replace: true })
    } catch (err: unknown) {
      sayRefusal(err, 'account')
    } finally {
      setLoading(false)
    }
  }

  // PATH A — Step 2: Account fields + submit
  const handleJoinSubmit = async () => {
    if (joinPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setError(null)
    setSignInHint(false)
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
      sayRefusal(err, 'join')
    } finally {
      setLoading(false)
    }
  }

  const pathAStep2 = () => (
    <motion.div
      key="pathA-2"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
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
      {/* A form, so Enter submits (browser walk 2026-11-11: it did not). */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (loading || waiting || !joinName || !joinEmail || !joinPassword) return
          void handleJoinSubmit()
        }}
      >
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

        {/* Email */}
        <div>
          <label htmlFor="join-email" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Email *</label>
          <div className="relative">
            <Mail className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="join-email"
              type="email"
              autoComplete="email"
              value={joinEmail}
              onChange={(e) => setJoinEmail(e.target.value)}
              placeholder="jane@restaurant.com"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="join-password" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Password *</label>
          <PasswordInput id="join-password" value={joinPassword} onChange={setJoinPassword} on={on} />
          <p className={on ? 'text-xs !text-inkm-3 mt-1' : 'text-xs text-gray-400 mt-1'}>Min. 8 characters</p>
        </div>
      </div>
      {(error || authError) && (
        <div role={on ? 'alert' : undefined} className={on ? 'mdv-ep-note mt-4 border-red-700' : 'mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2'}>
          {!on && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
          <p className={on ? 'mdv-ep-note-title !text-red-800' : 'text-sm text-red-700'}>
            {error || authError}
            {signInHint && (
              <>
                {' '}
                <Link to="/login" className={on ? 'text-seal hover:text-seal-deep font-medium underline' : 'text-wine-600 hover:text-wine-700 font-medium underline'}>
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      )}
      <Button
        type="submit"
        className={on ? `w-full h-12 mt-5 ${HOUSE_BUTTON}` : 'w-full h-12 mt-5'}
        disabled={loading || waiting || !joinName || !joinEmail || !joinPassword}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Joining...
          </>
        ) : (
          'Join Restaurant'
        )}
      </Button>
      </form>
    </motion.div>
  )

  // PATH B — Step 1: Account fields — called as a function
  const pathBStep1 = () => (
    <motion.div
      key="pathB-1"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      <button
        type="button"
        onClick={() => setPath('selector')}
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
      {/* A form, so Enter submits (browser walk 2026-11-11: it did not). */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (loading || waiting) return
          if (createGaps.length > 0) {
            setCreateTried(true)
            document.getElementById(createGaps[0].id)?.focus()
            return
          }
          void handleAccountSubmit()
        }}
      >
      <div className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="create-name" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Full Name <span aria-hidden="true">*</span></label>
          <div className="relative">
            <User className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="create-name"
              type="text"
              autoComplete="name"
              required
              aria-invalid={createGap('create-name') || undefined}
              aria-describedby={createGap('create-name') ? 'create-account-says' : undefined}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="John Smith"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <label htmlFor="create-email" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Email <span aria-hidden="true">*</span></label>
          <div className="relative">
            <Mail className={on ? 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-inkm-3' : 'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400'} />
            <input
              id="create-email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={createGap('create-email') || undefined}
              aria-describedby={createGap('create-email') ? 'create-account-says' : undefined}
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="john@myrestaurant.com"
              className={on ? 'block w-full pl-10 pr-3 py-3 border border-paper-2 rounded-lg bg-paper-0 focus:outline-none' : 'block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-white/80 focus:ring-2 focus:ring-wine-500 focus:outline-none'}
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="create-password" className={on ? 'block text-sm font-medium text-inkm-2 mb-1' : 'block text-sm font-medium text-gray-700 mb-1'}>Password <span aria-hidden="true">*</span></label>
          <PasswordInput
            id="create-password"
            value={createPassword}
            onChange={setCreatePassword}
            on={on}
            required
            invalid={createGap('create-password')}
            describedBy={createGap('create-password') ? 'create-password-hint create-account-says' : 'create-password-hint'}
          />
          <p id="create-password-hint" className={on ? 'text-xs !text-inkm-3 mt-1' : 'text-xs text-gray-400 mt-1'}>Min. 8 characters</p>
        </div>
      </div>
      {/* Step 1 had no error line at all: a refused sign-up said nothing. What is
          still missing comes first: it is what the next press needs. */}
      {(createSays || error || authError) && (
        <div id="create-account-says" role="alert" className={on ? 'mdv-ep-note mt-4 border-red-700' : 'mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2'}>
          {!on && <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
          <p className={on ? 'mdv-ep-note-title !text-red-800' : 'text-sm text-red-700'}>
            {createSays ?? (error || authError)}
            {!createSays && signInHint && (
              <>
                {' '}
                <Link to="/login" className={on ? 'text-seal hover:text-seal-deep font-medium underline' : 'text-wine-600 hover:text-wine-700 font-medium underline'}>
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      )}
      <Button
        type="submit"
        className={on ? `w-full h-12 mt-5 ${HOUSE_BUTTON}` : 'w-full h-12 mt-5'}
        disabled={loading || waiting}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Creating account…
          </>
        ) : (
          <>Create account <ArrowRight className="w-4 h-4 ml-1" /></>
        )}
      </Button>
      </form>
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
    </motion.div>
  )

  // Single step key — AnimatePresence fires ONLY when the user actually navigates between steps
  const stepKey = `${path}-${path === 'join' ? pathAStep : 1}`

  const content = (() => {
    if (path === 'selector') return pathSelector()
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
    if (path === 'selector') {
      return {
        ...voice,
        folio: 'Register',
        title: 'Whose book is this?',
        lede: 'A new house is a new set of books, or a line in one that exists.',
      }
    }
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
        frontMatter
        backLabel="Turn back to register"
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
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: 'spring' }}
            className="inline-flex mb-5"
          >
            <BrandMark size={34} />
          </motion.div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">Join Mudavym</h1>
          <p className="text-[15px] text-gray-500">Transform your restaurant&apos;s wine operations</p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {/* The one card: a new owner's account, or an invitee's two steps. */}
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
