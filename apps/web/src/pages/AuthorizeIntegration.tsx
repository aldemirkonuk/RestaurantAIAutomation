import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  integrationsApi,
  type IntegrationCatalogEntry,
  type IntegrationId,
} from '../services/api/integrations'
import { BrandMark } from '../components/brand/BrandMark'

const VALID_IDS: IntegrationId[] = ['google_drive', 'excel']

function isValidId(value: string | undefined): value is IntegrationId {
  return !!value && (VALID_IDS as string[]).includes(value)
}

/**
 * Consent screen shown before we hand the user to Google/Microsoft.
 *
 * Providers show their own consent screen, but theirs describes scopes in their
 * vocabulary ("See, edit, create and delete all of your Google Drive files").
 * This page states, in our vocabulary, what we will do with the grant and what
 * we deliberately do not ask for — so the provider screen confirms a decision
 * the user has already understood rather than being the first they hear of it.
 */
export default function AuthorizeIntegration() {
  const { integrationId } = useParams<{ integrationId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const returnPath = useMemo(() => {
    const raw = searchParams.get('returnPath')
    // Only same-site paths; the server enforces this too, but no reason to send
    // an off-site value in the first place.
    return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/settings'
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    integrationsApi
      .getCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog(entries)
      })
      .catch((e: any) =>
        setLoadError(
          e?.response?.data?.message || e?.message || 'Could not load integration details',
        ),
      )
    return () => {
      cancelled = true
    }
  }, [])

  const entry = useMemo(
    () =>
      isValidId(integrationId)
        ? catalog?.find((c) => c.id === integrationId) ?? null
        : null,
    [catalog, integrationId],
  )

  const handleAllow = async () => {
    if (!entry) return
    setActionError(null)
    setRedirecting(true)
    try {
      const url = await integrationsApi.authorize(entry.id, returnPath)
      // Full navigation, not react-router: the destination is the provider.
      window.location.assign(url)
    } catch (e: any) {
      setActionError(
        e?.response?.data?.message || e?.message || 'Could not start authorization',
      )
      setRedirecting(false)
    }
  }

  if (!isValidId(integrationId)) {
    return (
      <Shell>
        <EmptyState
          title="Unknown integration"
          body="That integration doesn't exist. Pick one from Settings instead."
          returnPath="/settings"
        />
      </Shell>
    )
  }

  if (loadError) {
    return (
      <Shell>
        <EmptyState title="Couldn't load this page" body={loadError} returnPath={returnPath} />
      </Shell>
    )
  }

  if (!catalog) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading authorization details…
        </div>
      </Shell>
    )
  }

  if (!entry) {
    return (
      <Shell>
        <EmptyState
          title="Unknown integration"
          body="That integration isn't offered on this deployment."
          returnPath={returnPath}
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        className="overflow-hidden rounded-2xl border border-wine-100/80 bg-white/90 shadow-[0_24px_64px_-24px_rgba(26,94,107,0.18)] backdrop-blur-md"
      >
        <div className="border-b border-gray-100 px-7 py-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-wine-600">
            Authorization request
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-gray-900">
            Connect {entry.label} to Mudavym
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{entry.description}</p>
        </div>

        {!entry.available ? (
          <div className="px-7 py-6">
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-900">Not available yet</p>
                <p className="mt-0.5 text-sm text-amber-800">
                  {entry.unavailableReason ??
                    'This integration is not configured on this deployment.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <section className="px-7 py-6">
              <h2 className="text-sm font-semibold text-gray-900">
                What Mudavym will be able to do
              </h2>
              <ul className="mt-3 space-y-3">
                {entry.scopes.map((scope) => (
                  <li key={scope.scope} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-wine-50">
                      <Check className="h-3 w-3 text-wine-600" strokeWidth={3} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{scope.label}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                        {scope.reason}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="border-t border-gray-100 bg-gray-50/60 px-7 py-6">
              <h2 className="text-sm font-semibold text-gray-900">
                What we don&apos;t ask for
              </h2>
              <ul className="mt-3 space-y-2">
                {entry.notRequested.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200/70">
                      <X className="h-3 w-3 text-gray-500" strokeWidth={3} />
                    </span>
                    <p className="text-sm text-gray-600">{item}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="border-t border-gray-100 px-7 py-5">
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <p className="text-xs leading-relaxed text-gray-500">
                  {entry.providerLabel} will ask you to confirm on their own screen next. Access
                  tokens are encrypted before they are stored, and you can revoke this at any
                  time from Settings — see our{' '}
                  <Link
                    to="/privacy"
                    className="font-medium text-wine-600 hover:text-wine-700"
                  >
                    privacy notice
                  </Link>
                  .
                </p>
              </div>
            </section>

            {actionError && (
              <div className="px-7 pb-1">
                <p className="flex items-start gap-2 text-[13px] leading-5 text-[#8B6363]">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-wine-500/80" />
                  {actionError}
                </p>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2.5 border-t border-gray-100 px-7 py-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => navigate(returnPath, { replace: true })}
                disabled={redirecting}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAllow}
                disabled={redirecting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-wine-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-10px_rgba(26,94,107,0.55)] transition-colors hover:bg-wine-700 disabled:opacity-60"
              >
                {redirecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Redirecting to {entry.providerLabel}…
                  </>
                ) : (
                  <>
                    Continue to {entry.providerLabel}
                    <ExternalLink className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </motion.div>

      <p className="mt-5 text-center">
        <Link
          to={returnPath}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to settings
        </Link>
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FAF7F5] px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(26,94,107,0.10),transparent_50%)]"
      />
      <div className="relative mx-auto w-full max-w-lg">
        <div className="mb-7 flex flex-col items-center text-center">
          <BrandMark size={26} />
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
            <ShieldCheck className="h-3.5 w-3.5 text-wine-500" />
            You are granting access to your own account
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}

function EmptyState({
  title,
  body,
  returnPath,
}: {
  title: string
  body: string
  returnPath: string
}) {
  return (
    <div className="rounded-2xl border border-wine-100/80 bg-white/90 p-7 text-center shadow-sm">
      <p className="text-base font-semibold text-gray-900">{title}</p>
      <p className="mt-1.5 text-sm text-gray-500">{body}</p>
      <Link
        to={returnPath}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Link>
    </div>
  )
}
