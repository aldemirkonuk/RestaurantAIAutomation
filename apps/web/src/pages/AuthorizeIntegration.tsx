import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  Scale,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import {
  integrationsApi,
  type IntegrationCatalogEntry,
  type RetentionDisclosure,
} from '../services/api/integrations'
import { BrandMark } from '../components/brand/BrandMark'

/**
 * Consent screen shown before we hand the user to Google/Microsoft.
 *
 * Providers show their own consent screen, but theirs describes scopes in their
 * vocabulary ("See, edit, create and delete all of your Google Drive files").
 * This page states, in our vocabulary, what we will do with the grant, what we
 * deliberately do not ask for, and where what we fetch lands — so the provider
 * screen confirms a decision the user has already understood rather than being
 * the first they hear of it.
 *
 * WHAT DECIDES WHETHER AN ID IS REAL (fixed 2026-09-04)
 * ----------------------------------------------------
 * The catalogue the server returns, and nothing else. This file used to hold
 * `const VALID_IDS = ['google_drive', 'excel']` and check the route parameter
 * against it before looking at the catalogue at all. The consequence was
 * measured on this branch: `gmail_send` was declared on the gateway on
 * 2026-09-04 and appeared as a Connect row everywhere, and every one of those
 * rows links here — so the only way to consent to a sending grant led to
 * "Unknown integration. That integration doesn't exist." The grant was
 * unreachable and nothing failed.
 *
 * A hard-coded copy of a server list is the same fault as a hard-coded copy of
 * a scope list: it is right on the day it is written. Now the catalogue is
 * loaded first and an id that is not in it gets the honest sentence — this
 * DEPLOYMENT does not offer that integration — which is a claim about the
 * server's answer rather than about a literal in a page.
 */
export default function AuthorizeIntegration() {
  const { integrationId } = useParams<{ integrationId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [retention, setRetention] = useState<RetentionDisclosure | null>(null)
  /**
   * Why the retention read has its OWN error state instead of joining
   * `loadError`. A catalogue that will not load leaves nothing to consent to,
   * so the page stops. A retention figure that will not load leaves a page that
   * could still send somebody to Google without telling them how long their
   * mail is kept — which is the silence ADR 0118 named as the fault. So the
   * failure is shown in the retention section's own place, in words, and the
   * Continue button is refused for a grant that mirrors mail until the figure
   * is there to read.
   */
  const [retentionError, setRetentionError] = useState<string | null>(null)

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
    integrationsApi
      .getRetentionDisclosure()
      .then((r) => {
        if (!cancelled) setRetention(r)
      })
      .catch((e: any) => {
        if (cancelled) return
        setRetentionError(
          e?.response?.data?.message ||
            e?.message ||
            'The retention figure could not be read.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  const entry = useMemo(
    () => catalog?.find((c) => c.id === integrationId) ?? null,
    [catalog, integrationId],
  )

  /**
   * Does THIS grant mirror mail into the house's book? The SERVER says so, on
   * the catalogue entry, and the page never decides it from the id — a page
   * that hard-codes `gmail_read` is the same fault as the `VALID_IDS` array
   * this file used to carry, and it would get `gmail_send` wrong (a sending
   * grant reads nothing and mirrors nothing).
   *
   * `?? false` rather than a guess: a gateway deployed before 2026-09-05 does
   * not send the field, and on such a deployment there is no retention rule to
   * describe either, so "does not mirror" is the true answer for it.
   */
  const mirrorsMail = entry?.mirrorsMail ?? false

  /**
   * A grant that mirrors mail may not be consented to while its retention
   * disclosure is missing. Deliberately a REFUSAL and not a warning: ADR 0118's
   * own finding was that the consent screen answered the retention question
   * with silence, and a Continue button that still works when the answer could
   * not be loaded is that silence with an extra step.
   */
  const retentionBlocks = mirrorsMail && retention === null

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

  if (!integrationId) {
    return (
      <Shell>
        <EmptyState
          title="No integration named"
          body="This link is missing the integration it was meant to connect. Pick one from Connections instead."
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
          body={`This deployment's integration catalogue does not include "${integrationId}", so there is nothing to consent to. Pick one from Connections instead.`}
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

            {entry.dataHandling && (
              <section className="border-t border-gray-100 px-7 py-6">
                <h2 className="text-sm font-semibold text-gray-900">
                  Where it goes, and who can see it
                </h2>
                <dl className="mt-3 space-y-3">
                  {(
                    [
                      ['What we read', entry.dataHandling.reads],
                      ['What we never read', entry.dataHandling.doesNotRead],
                      ['Where it lands', entry.dataHandling.landsIn],
                      ['Who can see it', entry.dataHandling.visibleTo],
                      // The fifth question, rendered only when the gateway
                      // answers it. An older gateway sends four and the page
                      // shows four, rather than inventing a fifth answer.
                      ['How long it is kept', entry.dataHandling.keptFor],
                    ] as Array<[string, string | undefined]>
                  )
                    .filter((pair): pair is [string, string] => Boolean(pair[1]))
                    .map(([term, detail]) => (
                      <div key={term}>
                        <dt className="text-sm font-medium text-gray-800">{term}</dt>
                        <dd className="mt-0.5 text-xs leading-relaxed text-gray-500">
                          {detail}
                        </dd>
                      </div>
                    ))}
                </dl>
              </section>
            )}

            {mirrorsMail && (
              <section
                className="border-t border-gray-100 bg-gray-50/60 px-7 py-6"
                data-testid="retention-disclosure"
              >
                <h2 className="text-sm font-semibold text-gray-900">
                  How long this restaurant keeps it
                </h2>

                {retention ? (
                  <div className="mt-3 space-y-4">
                    <p className="text-xs leading-relaxed text-gray-600">
                      {retention.split}
                    </p>

                    <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-wine-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          The mail itself: {retention.figureDays} days
                          {retention.figureFrom === 'measured_now'
                            ? ' (measured now)'
                            : null}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500">
                          {retention.windowIntro}
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                          {retention.basis}
                        </p>
                        {retention.storedAt && (
                          <p className="mt-1.5 text-[11px] text-gray-400">
                            Worked out on{' '}
                            {retention.storedAt.slice(0, 10)}; worked out again
                            every quarter.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
                      <Scale className="mt-0.5 h-4 w-4 shrink-0 text-wine-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          The order&apos;s facts:{' '}
                          {retention.jurisdiction.factsFloorYears} years —{' '}
                          {retention.jurisdiction.label}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500">
                          {retention.jurisdiction.why}
                        </p>
                        {retention.jurisdiction.defaultedBecause && (
                          <p className="mt-1.5 text-xs leading-relaxed text-[#8B6363]">
                            {retention.jurisdiction.defaultedBecause}
                          </p>
                        )}
                        <ul className="mt-2 space-y-1.5">
                          {retention.jurisdiction.citations.map((c) => (
                            <li key={c.url + c.statute}>
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-[11px] font-medium text-wine-600 underline-offset-2 hover:underline"
                              >
                                {c.statute}
                              </a>
                              <span className="text-[11px] text-gray-400">
                                {' '}
                                — read {c.fetchedOn}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4">
                      <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-wine-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          If you disconnect
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500">
                          {retention.revocation}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div>
                      <p className="text-sm font-medium text-amber-900">
                        {retentionError
                          ? 'This restaurant’s retention figure could not be read'
                          : 'Reading this restaurant’s retention figure'}
                      </p>
                      <p className="mt-0.5 text-sm text-amber-800">
                        {retentionError
                          ? `${retentionError} This grant copies mail out of your mailbox, so you are not being asked to agree to it until this page can tell you how long that copy is kept and what happens when you disconnect.`
                          : 'One moment — this grant copies mail out of your mailbox, and you are owed the figure before you agree to it.'}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}

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
                disabled={redirecting || retentionBlocks}
                title={
                  retentionBlocks
                    ? 'This grant copies mail out of your mailbox. You cannot agree to it until this page can tell you how long that copy is kept.'
                    : undefined
                }
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
