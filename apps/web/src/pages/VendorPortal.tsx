import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { Globe, Mail, Phone, Search, Wine, AlertCircle } from 'lucide-react'

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
function unitPrice(l: Listing): number | null {
  if (l.price === null || l.packSize <= 0) return null
  const perUnit = l.price / l.packSize
  if (!l.volumeMl || l.volumeMl <= 0) return perUnit
  return perUnit * (750 / l.volumeMl)
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
  if (l.volumeMl) parts.push(l.volumeMl >= 1000 ? `${l.volumeMl / 1000}L` : `${l.volumeMl}ml`)
  if (l.unitLabel) parts.push(l.unitLabel)
  return parts.length ? parts.join(' · ') : 'Single unit'
}

export function VendorPortal() {
  const { slug } = useParams<{ slug: string }>()
  const [page, setPage] = useState<VendorPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'vintage'>('name')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    axios
      .get(`${API_URL}/api/v1/vendor-portal/${slug}`)
      .then((res) => {
        if (!cancelled) setPage(res.data.page)
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err?.response?.status === 404
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
  }, [slug])

  // Injected rather than rendered into the tree: JSON-LD must live in a real
  // <script type="application/ld+json"> element for crawlers to read it, and
  // React will not render a script tag from JSX.
  useEffect(() => {
    if (!page) return
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${page.displayName} — wine catalogue`,
      url: window.location.href,
      numberOfItems: page.listings.length,
      itemListElement: page.listings.map((l, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: l.productName,
          ...(l.producer ? { brand: { '@type': 'Brand', name: l.producer } } : {}),
          ...(l.vintage ? { productionDate: String(l.vintage) } : {}),
          ...(l.price !== null
            ? {
                offers: {
                  '@type': 'Offer',
                  price: l.price,
                  priceCurrency: l.currency,
                  availability:
                    l.inStock === false
                      ? 'https://schema.org/OutOfStock'
                      : 'https://schema.org/InStock',
                  seller: { '@type': 'Organization', name: page.displayName },
                },
              }
            : {}),
        },
      })),
    })
    document.head.appendChild(el)
    document.title = `${page.displayName} — wine catalogue`
    return () => {
      document.head.removeChild(el)
    }
  }, [page])

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
        return pa - pb
      })
    } else if (sortBy === 'vintage') {
      sorted.sort((a, b) => (b.vintage ?? 0) - (a.vintage ?? 0))
    } else {
      sorted.sort((a, b) => a.productName.localeCompare(b.productName))
    }
    return sorted
  }, [page, query, sortBy])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <span className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          Loading catalogue…
        </div>
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-amber-600" strokeWidth={1.75} />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Catalogue unavailable</h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-start gap-4">
            {page.logoUrl ? (
              <img
                src={page.logoUrl}
                alt=""
                className="w-14 h-14 rounded-xl object-cover border border-gray-200"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-wine-50 flex items-center justify-center">
                <Wine className="w-7 h-7 text-wine-600" strokeWidth={1.75} />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">{page.displayName}</h1>
              {page.tagline && <p className="mt-1 text-gray-500">{page.tagline}</p>}
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
                {page.contactEmail && (
                  <a
                    href={`mailto:${page.contactEmail}`}
                    className="inline-flex items-center gap-1.5 hover:text-wine-700"
                  >
                    <Mail className="w-4 h-4" strokeWidth={1.75} />
                    {page.contactEmail}
                  </a>
                )}
                {page.contactPhone && (
                  <a
                    href={`tel:${page.contactPhone}`}
                    className="inline-flex items-center gap-1.5 hover:text-wine-700"
                  >
                    <Phone className="w-4 h-4" strokeWidth={1.75} />
                    {page.contactPhone}
                  </a>
                )}
                {page.websiteUrl && (
                  <a
                    href={page.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1.5 hover:text-wine-700"
                  >
                    <Globe className="w-4 h-4" strokeWidth={1.75} />
                    Website
                  </a>
                )}
              </div>
            </div>
          </div>
          {page.about && (
            <p className="mt-6 text-sm text-gray-600 leading-relaxed max-w-3xl">{page.about}</p>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search producer, region, grape…"
              aria-label="Search catalogue"
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-wine-500 focus:ring-4 focus:ring-wine-500/10"
            />
          </div>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            Sort
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-wine-500"
            >
              <option value="name">Name</option>
              <option value="price">Price per 750ml</option>
              <option value="vintage">Vintage</option>
            </select>
          </label>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          {visible.length} of {page.listings.length}{' '}
          {page.listings.length === 1 ? 'wine' : 'wines'}
          {page.updatedAt && (
            <> · updated {new Date(page.updatedAt).toLocaleDateString()}</>
          )}
        </p>

        {visible.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">
            {page.listings.length === 0
              ? 'This vendor has not listed any wines yet.'
              : 'No wines match that search.'}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-gray-500">
                    <th scope="col" className="px-4 py-3 font-medium">Wine</th>
                    <th scope="col" className="px-4 py-3 font-medium">Vintage</th>
                    <th scope="col" className="px-4 py-3 font-medium">Origin</th>
                    <th scope="col" className="px-4 py-3 font-medium">Format</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Price</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Per 750ml</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{l.productName}</div>
                        {l.producer && (
                          <div className="text-gray-500">{l.producer}</div>
                        )}
                        {l.inStock === false && (
                          <span className="inline-block mt-1 text-[11px] font-medium uppercase tracking-wide text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                            Out of stock
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{l.vintage ?? 'NV'}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {[l.region, l.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatFormat(l)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {formatMoney(l.price, l.currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {formatMoney(unitPrice(l), l.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400">
          Prices are list prices published by the vendor and may not reflect negotiated
          terms. Contact the vendor to confirm availability.
        </p>
      </main>
    </div>
  )
}

export default VendorPortal
