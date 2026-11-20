import { PublicShell } from '../components/mudavym/PublicShell'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface Listing {
  id: string
  productName: string
  producer: string | null
  vintage: number | null
  region: string | null
  country: string | null
  grapeVarieties: string | null
  price: number | null
  currency: string
  packSize: number
  volumeMl: number | null
  unitLabel: string | null
  inStock: boolean | null
  minOrderQuantity: number | null
  leadTimeDays: number | null
  notes: string | null
}

interface VendorPage {
  slug: string
  displayName: string
  tagline: string | null
  about: string | null
  logoUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  websiteUrl: string | null
  updatedAt: string
  listings: Listing[]
}

/**
 * Public vendor catalogue.
 *
 * Rendered for a vendor's own customers, and read back by our own ingester as
 * an api_catalog observation rather than a website_scrape — which is the whole
 * reason to host it. The JSON-LD block below is not decoration: it is the
 * machine-readable contract that lets the price be parsed rather than guessed.
 *
 * No auth, no tenant. Everything here is what a vendor chose to publish.
 */

/** Price per 750ml equivalent, so a case and a bottle sort against each other. */
export function unitPrice(l: Listing): number | null {
  if (l.price === null || l.packSize <= 0) return null
  const perUnit = l.price / l.packSize
  if (!l.volumeMl || l.volumeMl <= 0) return null
  return perUnit * (750 / l.volumeMl)
}

/** A vendor-supplied URL is untrusted input; only http(s) is safe to render
 * as a link or an image source (a `javascript:` URL must never reach the
 * DOM, React 18 only warns and does not block it). */
function isHttpUrl(value: string | null): value is string {
  if (!value) return false
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

function formatMoney(value: number | null, currency: string): string {
  if (value === null) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatFormat(l: Listing): string {
  const parts: string[] = []
  if (l.packSize > 1) parts.push(`${l.packSize}-pack`)
  if (l.volumeMl)
    parts.push(l.volumeMl >= 1000 ? `${l.volumeMl / 1000}L` : `${l.volumeMl}ml`)
  if (l.unitLabel) parts.push(l.unitLabel)
  return parts.length ? parts.join(' · ') : 'Single unit'
}

export function VendorPortal() {
  const [reload, setReload] = useState(0)
  const { slug } = useParams<{ slug: string }>()
  const [page, setPage] = useState<VendorPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'vintage'>('name')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPage(null)
    setError(null)
    setNotFound(false)

    axios
      .get(`${API_URL}/api/v1/vendor-portal/${encodeURIComponent(slug ?? '')}`)
      .then((res) => {
        if (!cancelled) setPage(res.data.page)
      })
      .catch((err) => {
        if (cancelled) return
        const is404 = err?.response?.status === 404
        setNotFound(is404)
        setError(
          is404
            ? 'This vendor page does not exist or has not been published yet.'
            : 'Could not load this catalogue. Please try again shortly.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug, reload])

  // JSON-LD and the tab title for this page are served in the response head
  // (ADR 0158, `vendor-edge.ts`; `RouteHead.tsx` leaves a /v/ title as
  // served) — a second client-side
  // ItemList after render would contradict the first, so this page injects
  // neither (ADR 0158 "Integration at cutover" item 2).

  const visible = useMemo(() => {
    if (!page) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? page.listings.filter((l) =>
          [l.productName, l.producer, l.region, l.country, l.grapeVarieties]
            .filter(Boolean)
            .some((f) => String(f).toLowerCase().includes(q)),
        )
      : page.listings

    const sorted = [...filtered]
    if (sortBy === 'price') {
      // Listings with no price sort last rather than as zero — absent is not
      // cheapest, and putting them first would bury the real offers.
      sorted.sort((a, b) => {
        const pa = unitPrice(a)
        const pb = unitPrice(b)
        if (pa === null && pb === null) return 0
        if (pa === null) return 1
        if (pb === null) return -1
        const currencyOrder = a.currency.localeCompare(b.currency)
        return currencyOrder || pa - pb
      })
    } else if (sortBy === 'vintage') {
      sorted.sort((a, b) => (b.vintage ?? 0) - (a.vintage ?? 0))
    } else {
      sorted.sort((a, b) => a.productName.localeCompare(b.productName))
    }
    return sorted
  }, [page, query, sortBy])

  return (
    <PublicShell
      measure="board"
      title={
        loading
          ? 'Opening the catalogue'
          : error || !page
            ? 'Catalogue unavailable'
            : page.displayName
      }
      eyebrow={error || !page ? 'Vendor catalogue' : 'Published vendor catalogue'}
      voice={page?.tagline ?? undefined}
      homeHref="/"
      seal={false}
      footer={
        error || !page ? undefined : (
          <>
            <a className="mdv-link" href="/">
              Published on Mudavym
            </a>
            . Prices and availability are supplied by the vendor.
          </>
        )
      }
    >
      <div className="mdv-pub__stack">
        {loading ? (
          <p role="status">Loading catalogue…</p>
        ) : error || !page ? (
          <div className="mdv-pub__plate mdv-pub__stack">
            <p role="alert">
              {error || 'This catalogue could not be loaded.'}
            </p>
            {!notFound && (
              <button
                className="mdv-btn"
                onClick={() => setReload((n) => n + 1)}
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          <>
            {(page.about ||
              page.logoUrl ||
              page.contactEmail ||
              page.contactPhone ||
              page.websiteUrl) && (
              <section
                className="mdv-pub__plate mdv-pub__stack"
                aria-label="About the vendor"
              >
                {isHttpUrl(page.logoUrl) && (
                  <img
                    className="mdv-pub__logo"
                    src={page.logoUrl}
                    alt={`${page.displayName} logo`}
                  />
                )}
                {page.about && <p>{page.about}</p>}
                <div className="mdv-pub__contacts">
                  {page.contactEmail && (
                    <a
                      className="mdv-link"
                      href={`mailto:${page.contactEmail}`}
                    >
                      {page.contactEmail}
                    </a>
                  )}
                  {page.contactPhone && (
                    <a className="mdv-link" href={`tel:${page.contactPhone}`}>
                      {page.contactPhone}
                    </a>
                  )}
                  {isHttpUrl(page.websiteUrl) && (
                    <a
                      className="mdv-link"
                      href={page.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      Vendor website
                    </a>
                  )}
                </div>
              </section>
            )}
            <div className="mdv-pub__toolbar">
              <div>
                <label htmlFor="vendor-search" className="mdv-label">
                  Find a wine
                </label>
                <input
                  id="vendor-search"
                  className="mdv-input"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Wine, producer, grape or place"
                />
              </div>
              <div>
                <label htmlFor="vendor-sort" className="mdv-label">
                  Sort catalogue
                </label>
                <select
                  id="vendor-sort"
                  className="mdv-input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                >
                  <option value="name">Name</option>
                  <option value="price">Per 750ml, within currency</option>
                  <option value="vintage">Vintage, newest first</option>
                </select>
              </div>
            </div>
            <p className="mdv-note">
              {visible.length} of {page.listings.length} listings
              {page.updatedAt && !Number.isNaN(Date.parse(page.updatedAt))
                ? ` · Updated ${new Date(page.updatedAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}`
                : ''}
            </p>
            {!visible.length ? (
              <div className="mdv-pub__plate">
                <p>
                  {query
                    ? 'No listings match your search.'
                    : 'This vendor has not published any listings yet.'}
                </p>
                {query && (
                  <button className="mdv-btn" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div
                className="mdv-pub__scroll"
                role="region"
                aria-label={`${page.displayName} catalogue`}
                tabIndex={0}
              >
                <table className="mdv-pub__board" role="table">
                  <caption className="sr-only">
                    {page.displayName} published wine catalogue
                  </caption>
                  <thead role="rowgroup">
                    <tr role="row">
                      <th scope="col" role="columnheader">
                        Wine
                      </th>
                      <th scope="col" role="columnheader">
                        Vintage
                      </th>
                      <th scope="col" role="columnheader">
                        Origin
                      </th>
                      <th scope="col" role="columnheader">
                        Format
                      </th>
                      <th scope="col" role="columnheader" className="mdv-pub__num">
                        List price
                      </th>
                      <th scope="col" role="columnheader" className="mdv-pub__num">
                        Per 750ml
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {visible.map((l) => (
                      <tr key={l.id} role="row">
                        <td role="cell" className="mdv-pub__wine">
                          <strong>{l.productName}</strong>
                          {l.producer && <small>{l.producer}</small>}
                          {l.grapeVarieties && (
                            <small>{l.grapeVarieties}</small>
                          )}
                          <small>
                            {l.inStock === null
                              ? 'Availability not stated'
                              : l.inStock
                                ? 'In stock'
                                : 'Out of stock'}
                          </small>
                          {l.notes && <small>{l.notes}</small>}
                        </td>
                        <td role="cell" className="mdv-pub__detail">
                          <span className="mdv-pub__cellname" aria-hidden="true">
                            Vintage:{' '}
                          </span>
                          {l.vintage ?? 'Not stated'}
                        </td>
                        <td role="cell" className="mdv-pub__detail">
                          <span className="mdv-pub__cellname" aria-hidden="true">
                            Origin:{' '}
                          </span>
                          {[l.region, l.country].filter(Boolean).join(', ') ||
                            'Not stated'}
                        </td>
                        <td role="cell" className="mdv-pub__detail">
                          <span className="mdv-pub__cellname" aria-hidden="true">
                            Format:{' '}
                          </span>
                          {formatFormat(l)}
                          {l.minOrderQuantity !== null && (
                            <small>Minimum order: {l.minOrderQuantity}</small>
                          )}
                          {l.leadTimeDays !== null && (
                            <small>Lead time: {l.leadTimeDays} days</small>
                          )}
                        </td>
                        <td role="cell" className="mdv-pub__price mdv-pub__num">
                          <span className="mdv-pub__cellname" aria-hidden="true">
                            List price:{' '}
                          </span>
                          {formatMoney(l.price, l.currency)}
                          {l.price !== null && (
                            <small>
                              {l.currency} · per{' '}
                              {l.packSize > 1 ? 'pack' : 'unit'}
                            </small>
                          )}
                        </td>
                        <td role="cell" className="mdv-pub__per750 mdv-pub__num">
                          <span className="mdv-pub__cellname" aria-hidden="true">
                            Per 750ml:{' '}
                          </span>
                          {formatMoney(unitPrice(l), l.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mdv-note">
              These are published list prices. Contact the vendor for your
              terms. A dash means the price or bottle size is not stated;
              prices in different currencies are not converted.
            </p>
          </>
        )}
      </div>
    </PublicShell>
  )
}

export default VendorPortal
