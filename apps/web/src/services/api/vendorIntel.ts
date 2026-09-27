/**
 * Vendor price intelligence API.
 *
 * Goes through `apiClient` rather than a bare axios call. The page previously
 * read `localStorage.accessToken` itself and passed it as a header, which
 * skipped the shared client's reactive 401 refresh — so an expired token
 * rendered as "could not load the comparison" instead of silently refreshing,
 * and looked like a broken feature rather than an old session.
 */

import { apiClient } from './client'

export type PriceSourceType =
  | 'invoice'
  | 'quote'
  | 'api_catalog'
  | 'website_scrape'
  | 'chat'
  | 'social'
  | 'manual'

/** The subset a human may legitimately attest to; see ManualObservationDto. */
export type ManualSourceType = Extract<
  PriceSourceType,
  'quote' | 'chat' | 'social' | 'manual'
>

export interface VendorQuote {
  vendorId: string | null
  vendorName: string | null
  unitPrice: number
  sourceType: PriceSourceType
  ageDays: number
  isOutlier: boolean
}

export interface PriceTrend {
  windowDays: number
  current: number | null
  previous: number | null
  absoluteChange: number | null
  pctChange: number | null
  note: string
  /** Sample sizes for the two windows the trend compares — fork 5(a): a
   * chip refuses below a minimum and prints the count either way. */
  currentCount: number
  previousCount: number
}

/**
 * A comparison never crosses a class (ADR 0160 §112, fork 1 — the founder's
 * words, "Quoted to this house $30.20" and "Public pages $40.49" are two
 * figures that never average). Mirrors the gateway's own
 * `price-below-average.ts#ComparisonClass` — a string union there, widened
 * here to `string` because `other:<sourceType>` is open-ended by design: an
 * unrecognised source type gets its own class rather than being folded into
 * "quoted" (`price-below-average.ts:130-135`).
 */
export type ComparisonClass = 'quoted' | 'public_site' | string

/** `price-below-average.ts#COMPARISON_CLASS_LABEL`, kept in one place there —
 * this is the client's copy, checked by the same words. */
export function comparisonClassLabel(cls: ComparisonClass): string {
  if (cls === 'quoted') return 'Quoted to this house'
  if (cls === 'public_site') return 'Public vendor site (tier 4)'
  const raw = cls.startsWith('other:') ? cls.slice('other:'.length) : cls
  return `Unrecognised source (${raw})`
}

/**
 * One row behind a rung — the "show your working" panel, and (since ADR 0160
 * §112) the sighting sheet's source. Every field here is additive on the
 * gateway's `VendorComparison.observations[]`
 * (`apps/api-gateway/src/vendor-intel/vendor-comparison.service.ts`); the
 * legacy `/vendor-prices` page never reads `observations` at all, so nothing
 * here can break it.
 */
export interface VendorObservationRow {
  id: string
  vendorName: string | null
  providerId: string | null
  sourceType: PriceSourceType
  sourceUrl: string | null
  /** `receipt_verified:<orderId>` / `order_confirmed:<orderId>` for the
   * house's own paper (`procurement/own-paper-sighting.ts`); null for a
   * hand-recorded row, which has no paper to link. */
  sourceRef: string | null
  comparisonClass: ComparisonClass
  rawPrice: number
  currency: string
  /** ADR 0117's 1 (best) to 7 (least); null only if the row predates the
   * column. */
  trustTier: number | null
  packSize: number
  unitVolumeMl: number | null
  observedAt: string
  parseConfidence: number | null
  /** The STORED write-time verdict — never re-derived on the client, so the
   * ladder always agrees with `own-paper-sighting.ts` /
   * `outlier-rejudge.ts`. */
  isOutlier: boolean
  outlierReason: string | null
  /** The note recorded with this sighting, own-paper or hand-typed — null
   * when none was written (review finding: the sighting sheet used to have
   * no way to show this even when one existed, ADR 0160 §112). */
  note: string | null
  /** ADR 0124 — null means unidentified, ranked by name and vintage alone. */
  identityId: string | null
  /** The identity's own name, best effort — null when unidentified or the
   * label could not be read (never swaps out `identityId`, which is always
   * present when a row is identified). */
  identityLabel: string | null
  /** Per-750ml, pack- and yield-adjusted; null when the row cannot be
   * normalised (ranked last within its class, never treated as free). */
  normalizedUnitPrice: number | null
  /** ADR 0160 §112 fork 6(a) — the paper, its line, the message and the
   * person, read FRESH by the gateway on every compare
   * (`vendor-intel/price-provenance.ts`). Optional only because a gateway
   * older than this field sends none; the page then says it was not sent,
   * never "no paper". */
  provenance?: ObservationProvenance
}

export interface ProvenanceDocument {
  id: string
  docType: string | null
  docNumber: string | null
  docDate: string | null
  sourceChannel: string | null
  status: string | null
}

export interface ProvenanceDocumentLine {
  id: string
  lineNo: number | null
  description: string | null
  unitPrice: number | null
  qty: number | null
  uom: string | null
}

export interface ProvenanceMessage {
  id: string
  channel: string | null
  direction: string | null
  at: string | null
  subject: string | null
  /** Null once the house's retention window deleted the words
   * (`textDeletedAt` says when). */
  excerpt: string | null
  textDeletedAt: string | null
  orderId: string | null
}

export interface ProvenancePerson {
  name: string | null
  address: string | null
  role: string | null
  basis: 'named_contact' | 'message_sender' | 'message_recipient'
}

export interface ObservationProvenance {
  document: ProvenanceDocument | null
  documentLine: ProvenanceDocumentLine | null
  message: ProvenanceMessage | null
  person: ProvenancePerson | null
  /** What the four fields cannot say themselves — a failed read, a paper
   * deleted since, the writer's own note. Empty = nothing to add. */
  sentences: string[]
}

export interface VendorCompareResponse {
  productName: string | null
  consensus: {
    consensusPrice: number | null
    bestPrice: number | null
    bestVendorName: string | null
    observationCount: number
    admittedCount: number
    outlierCount: number
    sourceBreakdown: Record<string, number>
    ladder: VendorQuote[]
    confidence: number
    notes: string[]
  }
  /** The same consensus, run once per comparison class — see
   * `comparisonClassLabel`. A class with too few admitted rows still gets an
   * entry (never a thrown error), so one class can read "not enough" while
   * another has a real number. */
  consensusByClass: Record<string, VendorCompareResponse['consensus']>
  trends: PriceTrend[]
  /** The 7/30/90 chips, per class — for the same reason as
   * `consensusByClass`: a trend that blended two classes would report the
   * exact crossing the founder ruled out. */
  trendsByClass: Record<string, PriceTrend[]>
  observations: VendorObservationRow[]
  /** False when the gateway's 500-row cap was hit — every count above is
   * then a FLOOR, not a total. */
  complete: boolean
  /** The window this read actually covered, in days (365 unless the caller
   * passed `windowDays`) — an older rung outside it is dropped silently
   * unless the page states this. */
  windowDays: number
}

export async function compareVendorPrices(params: {
  masterWineId?: string
  signatureHash?: string
  windowDays?: number
}): Promise<VendorCompareResponse> {
  const res = await apiClient.get<VendorCompareResponse>(
    '/vendor-intel/compare',
    { params },
  )
  return res.data
}

export interface ManualObservationInput {
  masterWineId?: string
  productName?: string
  producer?: string
  vintage?: number
  providerId?: string
  vendorName?: string
  price: number
  /** ISO 4217, required by the Mudavym register's own client-side rule (no
   * default) even though the DTO keeps it optional for the legacy page,
   * which has never sent one and must keep working unchanged. */
  currency?: string
  packSize?: number
  unitVolumeMl?: number
  sourceType?: ManualSourceType
  sourceUrl?: string
  observedAt?: string
  note?: string
  /** Fork 6(a): the attached paper (`attachPaper` returns its id), its line,
   * the house's message and the vendor contact the price came from. */
  documentId?: string
  documentLineId?: string
  conversationMessageId?: string
  contactId?: string
}

export async function recordVendorPrice(input: ManualObservationInput) {
  const res = await apiClient.post('/vendor-intel/observations', input)
  return res.data as { success: boolean; observation: { id: string } }
}

export interface ProviderUsualCurrency {
  providerId: string
  code: string | null
  setAt: string | null
  setByName: string | null
  sentence: string
}

/**
 * `GET /providers/:id/usual-currency` — fork 2(c) (ADR 0160 §112, README
 * `354-383`, accepted by the founder's blanket "I agree… in the other
 * things"): "the vendor's usual currency where stated, else required." The
 * endpoint already exists (built for the order sheet's own currency
 * default) — this page only reads it, and only ever OFFERS the value as a
 * starting point; it never overrides what a person actually types.
 */
export async function fetchProviderUsualCurrency(providerId: string): Promise<ProviderUsualCurrency> {
  const { data } = await apiClient.get(`/providers/${providerId}/usual-currency`)
  return {
    providerId: typeof data?.providerId === 'string' ? data.providerId : providerId,
    code: typeof data?.code === 'string' ? data.code : null,
    setAt: typeof data?.setAt === 'string' ? data.setAt : null,
    setByName: typeof data?.setByName === 'string' ? data.setByName : null,
    sentence: typeof data?.sentence === 'string' ? data.sentence : '',
  }
}

/**
 * The server's message, not axios's.
 *
 * `error.message` on a failed request is "Request failed with status code 400",
 * which tells the user nothing they can act on. The API's own message — "pick a
 * wine from the list rather than typing a name" — is the whole point of having
 * returned a 400.
 */
/**
 * Retry the network, never the request.
 *
 * The global default retries once. For a 4xx that costs a round trip and buys
 * nothing — the server has already said the request itself is wrong, and it
 * will say so again. Worse, it leaves the UI in a hole: between attempts
 * react-query reports neither `isLoading` (nothing is in flight) nor `isError`
 * (the query has not given up), so a page that renders loading / error / data
 * and nothing else renders NOTHING. Hitting /vendor-prices with a bad id
 * showed a blank panel under the search box for exactly that reason.
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return failureCount < 1
}

/** The HTTP status a failed request answered with, or null when there is
 * none to read (a dropped connection, a thrown non-axios error). Lets a page
 * tell a REFUSAL (403 — a role that will never be let in) from an UNKNOWN
 * (a 5xx, a timeout — retrying might work). */
export function apiErrorStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: number } })?.response?.status
  return typeof status === 'number' ? status : null
}

export function apiErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const body = (error as { response?: { data?: { message?: unknown } } })?.response?.data
  const message = body?.message
  if (Array.isArray(message)) return message.join('. ')
  if (typeof message === 'string' && message) return message
  const plain = (error as { message?: string })?.message
  return plain || fallback
}

// ---------------------------------------------------------------------------
// The identity decision log (ADR 0124 Q2)
// ---------------------------------------------------------------------------

/**
 * The founder, 2026-09-05: "staff may confirm, log the decisions."
 *
 * These calls are open to staff where the rest of this module is owner/manager,
 * because an identity is not a price: it says whether two bottles are the same
 * bottle, and it carries no vendor, no number and no terms. Undoing is the
 * manager's, and the gateway enforces that as well as the route decorator.
 */

export type IdentityDecisionAction = 'confirmed' | 'rejected' | 'undone'

/**
 * Which house took a decision, relative to the reader (ADR 0149 answer 17).
 * `null` means the gateway did not say (a gateway older than the deciding-house
 * column), which is not the same as "this house".
 */
export type IdentityDecidedIn = 'this_house' | 'another_house' | 'unrecorded'

export interface IdentityDecision {
  id: string
  candidateId: string
  restaurantId: string | null
  action: IdentityDecisionAction
  /**
   * Null when the person has since been removed (the label still names them),
   * or when the gateway withheld the person from this house.
   */
  decidedBy: string | null
  /**
   * Null when the person is withheld: a decision on a shared register names its
   * person only inside the house that took it.
   */
  decidedByLabel: string | null
  decidedByRole: string | null
  decidedAt: string
  /** What the SERVER showed the person, captured at the moment they decided. */
  evidenceShown: Record<string, unknown>
  /** Null when `personShown` is false — a note is the person's own words. */
  note: string | null
  linkWritten: string | null
  undoesDecisionId: string | null
  decidedIn: IdentityDecidedIn | null
  /** False when the gateway withheld who decided from this house. */
  personShown: boolean
  /**
   * Why this house may not take the decision back, in the gateway's words;
   * null when the house rule allows it (the role rule is separate).
   */
  undoRefusal: string | null
}

export interface IdentityDecisionLog {
  items: IdentityDecision[]
  scope: string
  limit: number
  /**
   * False when the page came back full: the count is then a FLOOR, and the view
   * must say so rather than printing it as a total.
   */
  complete: boolean
}

/**
 * A failed read REJECTS. An empty list here would claim nobody ever decided.
 *
 * `identityId`, when given, narrows the log to decisions on ONE bottle — the
 * sighting sheet's "identity decisions on this row" card (ADR 0160 §112).
 * Omitted, this is the house-wide log `IdentityDecisionLog.tsx` already reads.
 */
export async function fetchIdentityDecisions(
  limit = 50,
  identityId?: string,
): Promise<IdentityDecisionLog> {
  const { data } = await apiClient.get('/vendor-intel/identity/decisions', {
    params: identityId ? { limit, identityId } : { limit },
  })
  const rows: any[] = Array.isArray(data?.items) ? data.items : []
  return {
    items: rows.map((r) => ({
      id: r.id,
      candidateId: r.candidate_id,
      restaurantId: r.restaurant_id ?? null,
      action: r.action,
      decidedBy: r.decided_by ?? null,
      decidedByLabel: typeof r.decided_by_label === 'string' ? r.decided_by_label : null,
      decidedByRole: typeof r.decided_by_role === 'string' ? r.decided_by_role : null,
      decidedAt: r.decided_at,
      evidenceShown: r.evidence_shown ?? {},
      note: r.note ?? null,
      linkWritten: r.link_written ?? null,
      undoesDecisionId: r.undoes_decision_id ?? null,
      decidedIn:
        r.decided_in === 'this_house' ||
        r.decided_in === 'another_house' ||
        r.decided_in === 'unrecorded'
          ? r.decided_in
          : null,
      // A withheld person is never rendered as a blank name: the gateway's
      // `person_shown: false` wins, and a row with no label is not "shown".
      personShown: r.person_shown !== false && typeof r.decided_by_label === 'string',
      undoRefusal: typeof r.undo_refusal === 'string' ? r.undo_refusal : null,
    })),
    scope: typeof data?.scope === 'string' ? data.scope : '',
    limit: typeof data?.limit === 'number' ? data.limit : limit,
    // Absent rather than false: if the gateway did not say, we do not claim the
    // page was complete.
    complete: data?.complete === true,
  }
}

// ---------------------------------------------------------------------------
// The identity candidate queue (ADR 0124 Q2) — "are these two bottles the
// same bottle", open to staff because it carries no price, vendor or terms.
// ---------------------------------------------------------------------------

export interface IdentityCandidate {
  id: string
  subjectTable: string
  subjectId: string
  restaurantId: string | null
  identityId: string
  method: 'exact_key_ambiguous' | 'normalised_key' | 'person'
  confidence: number
  evidence: Record<string, unknown>
  createdAt: string
}

export interface IdentityCandidateQueue {
  items: IdentityCandidate[]
  count: number
  limit: number
  /** A full page is a FLOOR, not a total — same rule as the decision log. */
  complete: boolean
}

/**
 * `identityId`, when given, narrows the queue to proposals naming ONE
 * bottle — the sighting sheet's pending line. Omitted, this is the house's
 * whole "waiting for a person" queue (ADR 0160 §112, 1b).
 */
export async function fetchIdentityCandidates(
  opts: { identityId?: string; limit?: number } = {},
): Promise<IdentityCandidateQueue> {
  const { limit = 50, identityId } = opts
  const { data } = await apiClient.get('/vendor-intel/identity/candidates', {
    params: identityId ? { limit, identityId } : { limit },
  })
  const rows: any[] = Array.isArray(data?.items) ? data.items : []
  return {
    items: rows.map((r) => ({
      id: r.id,
      subjectTable: r.subject_table,
      subjectId: r.subject_id,
      restaurantId: r.restaurant_id ?? null,
      identityId: r.identity_id,
      method: r.method,
      confidence: Number(r.confidence),
      evidence: r.evidence ?? {},
      createdAt: r.created_at,
    })),
    count: typeof data?.count === 'number' ? data.count : rows.length,
    limit: typeof data?.limit === 'number' ? data.limit : limit,
    complete: data?.complete === true,
  }
}

/** Staff may confirm; only a manager may undo (`undoIdentityDecision`). */
export async function decideIdentityCandidate(input: {
  candidateId: string
  decision: 'confirmed' | 'rejected'
  note?: string
}) {
  const { data } = await apiClient.post('/vendor-intel/identity/candidates/decide', input)
  return data as {
    id: string
    status: string
    linkWritten: string | null
    decisionId: string
  }
}

export async function undoIdentityDecision(input: { decisionId: string; note?: string }) {
  const { data } = await apiClient.post('/vendor-intel/identity/decisions/undo', input)
  return data as {
    decisionId: string
    undid: string
    candidateId: string
    linkCleared: string | null
  }
}

// ---------------------------------------------------------------------------
// The masthead standing line and the below-average box (ADR 0160 §112 review:
// "the page before a bottle is picked is nearly empty… build both from the
// existing endpoints"). All four reads below are owner/manager; a staff
// session never calls them — the page's 403 branch handles that page-wide.
// ---------------------------------------------------------------------------

export interface IdentityRegisterStatus {
  identities: number | null
  keys: number | null
  candidates: { pending: number; confirmed: number; rejected: number } | null
  notes: string[]
}

/** `GET /vendor-intel/identity/status` — platform-wide register counts, not
 * scoped to this house (there is no house-scoped identity count to show). */
export async function fetchIdentityStatus(): Promise<IdentityRegisterStatus> {
  const { data } = await apiClient.get('/vendor-intel/identity/status')
  return {
    identities: typeof data?.identities === 'number' ? data.identities : null,
    keys: typeof data?.keys === 'number' ? data.keys : null,
    candidates: data?.candidates ?? null,
    notes: Array.isArray(data?.notes) ? data.notes : [],
  }
}

export interface PriceIndexSourceStatus {
  key: string
  issuer: string | null
  jurisdiction: string | null
  rows: number
  lastFetchedAt: string | null
  silentBecause: string | null
}

/** `GET /price-index/status` — a sibling register (ADR 0111), never pooled
 * with a vendor quote; this masthead only counts it. */
export async function fetchPriceIndexStatus(): Promise<{ armed: boolean; sources: PriceIndexSourceStatus[] }> {
  const { data } = await apiClient.get('/price-index/status')
  const sources: any[] = Array.isArray(data?.sources) ? data.sources : []
  return {
    armed: data?.armed === true,
    sources: sources.map((s) => ({
      key: String(s?.key ?? 'unknown'),
      issuer: s?.issuer ?? null,
      jurisdiction: s?.jurisdiction ?? null,
      rows: typeof s?.rows === 'number' ? s.rows : 0,
      lastFetchedAt: s?.lastFetchedAt ?? null,
      silentBecause: s?.silentBecause ?? null,
    })),
  }
}

export interface SweepStatusSummary {
  armed: boolean
  /** In-memory only (the service's own contract): null after a redeploy even
   * if a sweep ran minutes before it, and the page must say so, not "never". */
  lastRunAt: string | null
  activeCount: number
  totalCount: number
}

/** `GET /vendor-intel/site-sweep/status` — owner only; call this only when
 * the session's role is owner (E8: a manager gets a 403 here). */
export async function fetchSiteSweepStatus(): Promise<SweepStatusSummary> {
  const { data } = await apiClient.get('/vendor-intel/site-sweep/status')
  const vendors: any[] = Array.isArray(data?.vendors) ? data.vendors : []
  return {
    armed: data?.armed === true,
    lastRunAt: data?.lastRun?.finishedAt ?? null,
    activeCount: vendors.filter((v) => (v?.rowsWritten ?? 0) > 0).length,
    totalCount: vendors.length,
  }
}

/** `GET /vendor-intel/shop-sweep/status` — owner only, same reason. */
export async function fetchShopSweepStatus(): Promise<SweepStatusSummary> {
  const { data } = await apiClient.get('/vendor-intel/shop-sweep/status')
  const shops: any[] = Array.isArray(data?.shops) ? data.shops : []
  return {
    armed: data?.armed === true,
    lastRunAt: data?.lastRun?.finishedAt ?? null,
    activeCount: shops.filter((s) => (s?.rowsWritten ?? 0) > 0).length,
    totalCount: shops.length,
  }
}

export interface BelowAverageItem {
  productKey: string
  keyedBy: 'identity' | 'wine' | 'signature'
  sourceClass: ComparisonClass
  productName: string | null
  currency: string
  latest: { unitPrice: number; observedAt: string; vendorName: string | null; sourceType: string }
  average: { unitPrice: number; observations: number; from: string; to: string }
  absoluteBelow: number
  fractionBelow: number
}

export interface BelowAverageResult {
  items: BelowAverageItem[]
  publicSiteItems: BelowAverageItem[]
  scanned: { observations: number; products: number; comparisons: number }
  minObservations: number
  window: { days: number; from: string }
}

/** `GET /vendor-intel/below-average` — "newest below the earlier mean", the
 * cross-product box the empty picker state is missing (T-not-named in the
 * review). `quoted` only in `items`; `publicSiteItems` is its own line,
 * never pooled with a house quote (the founder's rule, price-below-average.ts). */
export async function fetchBelowAverage(params: {
  windowDays?: number
  minObservations?: number
  limit?: number
} = {}): Promise<BelowAverageResult> {
  const { data } = await apiClient.get('/vendor-intel/below-average', { params })
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    publicSiteItems: Array.isArray(data?.publicSiteItems) ? data.publicSiteItems : [],
    scanned: data?.scanned ?? { observations: 0, products: 0, comparisons: 0 },
    minObservations: typeof data?.minObservations === 'number' ? data.minObservations : 3,
    window: data?.window ?? { days: 30, from: '' },
  }
}

export interface ObservationSources {
  providerId: string
  messages: ProvenanceMessage[]
  contacts: Array<{ id: string; name: string | null; email: string | null; role: string | null }>
}

/**
 * `GET /vendor-intel/observation-sources` — this house's recent messages with
 * one of its vendors and that vendor's contacts, for naming where a recorded
 * price came from (ADR 0160 §112 fork 6(a)).
 */
export async function fetchObservationSources(providerId: string): Promise<ObservationSources> {
  const { data } = await apiClient.get('/vendor-intel/observation-sources', { params: { providerId } })
  return {
    providerId: typeof data?.providerId === 'string' ? data.providerId : providerId,
    messages: Array.isArray(data?.messages) ? data.messages : [],
    contacts: Array.isArray(data?.contacts) ? data.contacts : [],
  }
}

/**
 * The attach-a-paper step (ADR 0160 §112 fork 6(a), sketch 112 README: "an
 * upload plus `document_id` on `POST /vendor-intel/observations`"). The file
 * goes through the house's one document door, `POST /procurement/documents`
 * — the same door the receiving desk photographs through — which stores it,
 * reads it, and returns its id. An upload the door refuses, or one that comes
 * back with no id, is an error here: a price is never recorded as "with this
 * paper" when the paper did not arrive.
 */
export async function attachPaper(params: {
  contentBase64: string
  filename: string
  mimeType: string
  providerId?: string
}): Promise<{ documentId: string; duplicate: boolean }> {
  const { data } = await apiClient.post('/procurement/documents', { ...params, source: 'upload' })
  const documentId = typeof data?.documentId === 'string' ? data.documentId : null
  if (!documentId) {
    throw new Error('The paper was not stored, so the price was not recorded with it. Try attaching it again.')
  }
  return { documentId, duplicate: data?.duplicate === true }
}
