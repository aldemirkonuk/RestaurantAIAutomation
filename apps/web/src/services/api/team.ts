/**
 * Team Ops API — Manager Shift Desk (sketch 038 production port).
 * All routes are scoped under /restaurants/:restaurantId/team.
 */
import { apiClient, getActiveRestaurantId } from './client'
import { getBrowserTimezone } from '../../lib/browserTimezone'

const base = (rid?: string) => {
  const id = rid || getActiveRestaurantId()
  if (!id) throw new Error('No restaurant selected')
  return `/restaurants/${id}/team`
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface TeamMember {
  id: string
  restaurant_id: string
  user_id: string | null
  display_name: string
  email: string | null
  phone: string | null
  avatar_url: string | null
  position: string | null
  employment_type: string
  home_location: string | null
  /**
   * The OWNER's alone (ADR 0215). The gateway removes the key for anyone else,
   * so absent means "not yours to see" and `null` means "no wage on file".
   */
  hourly_wage?: number | null
  /**
   * `'owner'` when this row is an OWNER's and the viewer is a manager who sees
   * pay (founder 2026-09-27, item 71: "if owner taking money, manager can't
   * see it"): the wage is withheld because it is the owner's, not because the
   * viewer sees no pay and not because none is on file.
   */
  pay_withheld?: 'owner'
  skills: string[]
  hire_date: string | null
  status: string
  notes: string | null
  role: 'owner' | 'manager' | 'staff' | null
  accountLinked: boolean
  linkedUser?: { name?: string; email?: string; avatar_url?: string } | null
  /**
   * A MANAGER's pay switch, on the owner's roster only (ADR 0215, founder
   * 2026-09-25 round 4 item 19, "Pay visibility only"): `true`/`false` is the
   * switch; `null` = it could not be read; absent = not the owner's roster, or
   * not a manager.
   */
  payAccess?: boolean | null
}

/** One person removed from the roster, as the owner's former-staff history has them. */
export interface FormerStaffPerson {
  memberId: string
  /** From the removal's audit row; `null` = the name was not recorded. */
  name: string | null
  position: string | null
  leftAt: string
  keptUntil: string
  shifts: {
    id: string
    shift_date: string
    start_time: string
    end_time: string
    state: string
    role: string | null
    workedHours: number
    labor_cost: number | null
  }[]
  totals: {
    shiftsWorked: number
    workedHours: number
    /** `null` when any worked shift had no cost on file — never a partial. */
    cost: number | null
    unpricedShifts: number
  }
  leave: { id: string; start_date: string; end_date: string; status: string; leave_type: string }[]
  wageChanges: {
    old_wage: number | null
    new_wage: number | null
    currency: string | null
    changed_by_role: string | null
    changed_at: string
  }[]
  credentials: {
    id: string
    cert_type: string
    issued_at: string | null
    expires_at: string | null
    doc_url: string | null
    status: string
  }[]
}

export interface FormerStaffReadout {
  retentionYears: number
  money: { currency: string | null; country: string | null; readable: boolean }
  people: FormerStaffPerson[]
}

export interface ShiftBreak {
  id: string
  shift_id: string
  start_time: string
  duration_min: number
  covered_by: string | null
}

export interface Shift {
  id: string
  restaurant_id: string
  schedule_id: string | null
  member_id: string | null
  shift_date: string
  start_time: string
  end_time: string
  role: string | null
  shift_type: string
  state: string
  note: string | null
  /** The owner's alone (ADR 0215): absent for anyone else, `null` = unpriced. */
  labor_cost?: number | null
  /** `'owner'`: an owner's shift, its cost withheld from a manager who sees pay (item 71). */
  pay_withheld?: 'owner'
  shift_breaks?: ShiftBreak[]
  /**
   * The break whoever edits the shift recorded, in minutes (ADR 0215): `0` =
   * recorded as no break taken; `null` = nothing recorded, so a shift over 4
   * hours is counted with the 4857 Art. 68 minimum and shown as assumed.
   */
  recorded_break_min?: number | null
}

export interface Schedule {
  id: string
  restaurant_id: string
  week_start: string
  status: 'draft' | 'published'
  published_at: string | null
}

export interface CoverageDay {
  date: string
  staffed: number
  openShifts: number
  gaps: Array<{ role: string; period: string; staffed: number; required: number }>
  status: 'ok' | 'warn' | 'gap'
}

/** `time_off_requests.leave_type` (ADR 0215). `unknown` = nobody said. */
export type LeaveType = 'unknown' | 'paid' | 'unpaid'

/** The house's money, sent with the week to the owner only (ADR 0215). */
export interface HouseMoney {
  /** ISO 4217, or `null` when the house has not stated one — never dollars. */
  currency: string | null
  /** The house's country as recorded; the locale figures are printed in. */
  country: string | null
  /** False when the gateway could not read it — a different state from null. */
  readable: boolean
}

export interface WeekPayload {
  schedule: Schedule | null
  shifts: Shift[]
  coverage: { days: CoverageDay[]; totalGaps: number }
  labor: {
    enabled: boolean
    /** True for the owner only. Everyone else gets hours and no money. */
    moneyVisible?: boolean
    /** WORKED hours: each shift's span minus its breaks (4857 Art. 68). */
    totalHours: number
    /** The break time taken out of `totalHours`. */
    breakHours?: number
    /**
     * How much of `breakHours` is ASSUMED, and on how many shifts: a shift over
     * 4 hours with no break on record is counted with the Art. 68 minimum.
     */
    assumedBreakHours?: number
    assumedBreakShifts?: number
    /** 45 — over it is a review, never a price. */
    weeklyReviewHours?: number
    /** People over `weeklyReviewHours` worked hours. The key is historical. */
    overtime?: Array<{ memberId: string; hours: number }>
    // Owner only, below.
    totalCost?: number | null
    costComplete?: boolean
    pricedShifts?: number
    unpricedShifts?: number
    targetPct?: number | null
    costCovers?: 'scheduled_shifts'
    /** Worked shifts that are an owner's and so not in a manager's total (item 71); 0 for the owner. */
    ownerShiftsLeftOut?: number
    leave?: {
      readable: boolean
      paid: Array<{ memberId: string; days: number }> | null
      paidDays: number | null
      unknownTypeDays: number | null
    }
  }
  receipts: Array<{ member_id: string; seen_at: string }>
  settings: TeamSettings
  /** Owner only. */
  money?: HouseMoney
}

export interface MyWeekPayload {
  member: { id: string; display_name: string } | null
  schedule: Schedule | null
  mine: Shift[]
  open: Shift[]
  acknowledged?: boolean
}

export interface Certification {
  id: string
  member_id: string
  cert_type: string
  issued_at: string | null
  expires_at: string | null
  doc_url: string | null
  status: 'valid' | 'expiring' | 'expired' | 'submitted'
}

export interface TeamSettings {
  restaurant_id: string
  labor_tracking_enabled: boolean
  labor_target_pct: number | null
  /**
   * Owner only (ADR 0215 item 27): off (the default), a "Replace with"
   * hand-over onto someone already working then is refused; on, a warning.
   */
  allow_double_booking?: boolean
  /**
   * Who sees wages and labour cost: the owner, by role (ADR 0215). It replaced
   * `wage_visible`, which the gateway no longer returns or accepts.
   */
  moneyVisibleTo?: 'owner'
  configured?: boolean
  /**
   * What this viewer may change (ADR 0215; founder 2026-09-21, "Take all
   * five"): only the owner switches labour-cost tracking off or changes the
   * target. Absent from an older gateway: the page then offers nothing it
   * cannot promise.
   */
  mayChange?: { trackingOff: boolean; trackingOn: boolean; target: boolean; doubleBooking?: boolean }
}

/** Why the house benchmark has a median, or none (ADR 0294; `performance.service.ts`). */
export type PerformanceBenchmarkState = 'computed' | 'self-only' | 'no-covers' | 'unreadable'

export interface MemberPerformance {
  hasData: boolean
  /**
   * The house's currency and country, which every figure below is in (ADR
   * 0294). Optional only because a gateway built before it sends none; the
   * card then says the currency could not be read rather than guess one.
   */
  money?: { currency: string | null; country: string | null; readable: boolean }
  metrics?: {
    salesPerShift: number
    /** null when none of the services records a check: unknown, never 0 (ADR 0051). */
    avgCheck: number | null
    /** Over the services that record covers with their sales; null when none does. */
    salesPerCover?: number | null
    /** How many of `services` record covers with their sales. */
    coverServices?: number
    /**
     * A SHARE OF SALES (wine_sales / net_sales), not an attach rate — the card
     * labels it "Wine share of sales". The key keeps its old name. null when
     * the services record no sales.
     */
    wineAttachPct: number | null
  }
  // median/band are null when the house benchmark is UNKNOWN or refused —
  // `benchmark.state` says which. They used to arrive as 0, which drew the peer
  // line at the bottom of the chart and put every server above it. ADR 0067.
  analytic?: {
    unit: string
    series: number[]
    median: number | null
    band: readonly [number, number] | null
    /** Absent from a gateway built before ADR 0294. */
    benchmark?: {
      state: PerformanceBenchmarkState
      /** Services among the house's newest ≤200 (TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES) that record covers with their sales. */
      services: number
      /** The servers those services belong to. */
      servers: number
      /** Whether this member's own services are among them. */
      includesMember: boolean
    }
  }
  services?: Array<{ date: string; covers: number }>
}

// ── Members ──────────────────────────────────────────────────────────────
export async function getTeamMembers(rid?: string): Promise<TeamMember[]> {
  const { data } = await apiClient.get<TeamMember[]>(`${base(rid)}/members`)
  return data
}
export async function createTeamMember(body: Partial<TeamMember> & { displayName: string }, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/members`, body)
  return data
}
export async function updateTeamMember(memberId: string, body: Record<string, any>, rid?: string) {
  const { data } = await apiClient.patch(`${base(rid)}/members/${memberId}`, body)
  return data
}
/** Owner only: switch one manager's pay access on or off (ADR 0215, round 4). */
export async function setMemberPayAccess(memberId: string, payAccess: boolean, rid?: string) {
  const { data } = await apiClient.patch(`${base(rid)}/members/${memberId}/pay-access`, {
    payAccess,
  })
  return data as {
    memberId: string
    payAccess: boolean
    changed: boolean
    audited: boolean
    notified: boolean
  }
}

/** Owner only: the former-staff history (ADR 0215, round 4). */
export async function getFormerStaff(rid?: string): Promise<FormerStaffReadout> {
  const { data } = await apiClient.get(`${base(rid)}/former-staff`)
  return data
}

/** What a removal did to the person's shifts (ADR 0215 item 26, 2026-09-28). */
export interface RemovalReceipt {
  shiftsOpened?: number
  /** Shifts in progress cut at the removal minute; the rest opened. */
  shiftsSplit?: number
  /** With no clock at all: shifts that may have started, kept whole. */
  shiftsUnjudged?: number
  clock?: { zone: string | null; source: 'house' | 'country' | 'device' | 'none' }
  /** "Replace with" (ADR 0215 item 27): shifts handed to `handedTo` instead of opened. */
  shiftsHandedOver?: number
  handedTo?: string | null
}

/** The four checks a hand-over runs (ADR 0215 item 27). */
export type HandoverCheckCode = 'overlap' | 'time_off' | 'role' | 'weekly_hours'
export interface HandoverCheck {
  code: HandoverCheckCode
  level: 'refuse' | 'warn'
  message: string
}
export interface HandoverShiftPreview {
  id: string
  /** `rest` = the part after this minute of a shift they are working now. */
  part: 'whole' | 'rest'
  shift_date: string
  start_time: string
  end_time: string
  role: string | null
  checks: HandoverCheck[]
}
export interface HandoverPreview {
  doubleBooking: 'refuse' | 'warn'
  unjudged: number
  shifts: HandoverShiftPreview[]
}

/**
 * The leaving person's upcoming shifts and, with `to`, what the gateway's
 * four checks say about handing each to that person. Read-only; the removal
 * re-runs every check when it writes.
 */
export async function getHandoverPreview(memberId: string, to: string | null, rid?: string): Promise<HandoverPreview> {
  const deviceZone = getBrowserTimezone()
  const params: Record<string, string> = {}
  if (to) params.to = to
  if (deviceZone) params.deviceZone = deviceZone
  const { data } = await apiClient.get<HandoverPreview>(`${base(rid)}/members/${memberId}/handover`, { params })
  return data
}

/** A removal's "Replace with": who, which shifts, and the warnings accepted. */
export interface RemovalHandover {
  to: string
  shiftIds: string[]
  accept: HandoverCheckCode[]
}

/**
 * Sends this device's zone with the removal: the gateway judges which of the
 * person's shifts have started on the house's clock, and uses the device's
 * only when the house records no zone (`removalClock`). Omitted when the
 * browser will not say.
 */
export async function deleteTeamMember(
  memberId: string,
  rid?: string,
  handover?: RemovalHandover | null,
): Promise<RemovalReceipt> {
  const deviceZone = getBrowserTimezone()
  const params: Record<string, string> = {}
  if (deviceZone) params.deviceZone = deviceZone
  if (handover && handover.shiftIds.length > 0) {
    params.replaceWith = handover.to
    params.handOver = handover.shiftIds.join(',')
    if (handover.accept.length > 0) params.accept = handover.accept.join(',')
  }
  const { data } = await apiClient.delete(`${base(rid)}/members/${memberId}`, {
    params: Object.keys(params).length ? params : undefined,
  })
  return (data ?? {}) as RemovalReceipt
}

// ── Week / schedule ─────────────────────────────────────────────────────
export async function getWeek(weekStart: string, rid?: string): Promise<WeekPayload> {
  const { data } = await apiClient.get<WeekPayload>(`${base(rid)}/week`, { params: { weekStart } })
  return data
}
export async function getMyWeek(weekStart: string, rid?: string): Promise<MyWeekPayload> {
  const { data } = await apiClient.get<MyWeekPayload>(`${base(rid)}/my-week`, { params: { weekStart } })
  return data
}
export async function createSchedule(weekStart: string, rid?: string): Promise<Schedule> {
  const { data } = await apiClient.post<Schedule>(`${base(rid)}/schedules`, { weekStart })
  return data
}
/**
 * The client half of ADR 0088 (gateway) + ADR 0089 (page), completed once both
 * landed on `main` (#256 and #257, 2026-09-02).
 *
 * The gateway REFUSES an unqualified request on the three destructive/fan-out
 * verbs: copy-week 409s without `replaceTarget: true` when the target week is
 * not empty (`schedule.service.ts:260-265`), publish 409s without
 * `resetReceipts: true` when receipts exist (`schedule.service.ts:352-362`),
 * and broadcast 400s unless it carries exactly one of `memberIds` or
 * `audience: "everyone"` (`team.controller.ts:381-392`).
 *
 * #257 shipped the confirmations without these fields because the gateway DTO
 * did not know them yet and `forbidNonWhitelisted: true`
 * (`apps/api-gateway/src/main.ts:54`) 400s an unknown field. #256 then landed
 * the DTOs — which left the two halves inverted: the flags were required and
 * nobody sent them, so "Copy last week", "Re-publish" and "Broadcast crew"
 * failed on every click. The flag is passed ONLY from the branch that has
 * already shown the user what it destroys, so the 409 keeps guarding the
 * unconfirmed path.
 */
export async function copyWeek(
  fromWeekStart: string,
  toWeekStart: string,
  opts: { replaceTarget?: boolean } = {},
  rid?: string,
) {
  const { data } = await apiClient.post(`${base(rid)}/schedules/copy-week`, {
    fromWeekStart,
    toWeekStart,
    ...(opts.replaceTarget ? { replaceTarget: true } : {}),
  })
  return data
}
export async function publishSchedule(
  scheduleId: string,
  opts: { resetReceipts?: boolean } = {},
  rid?: string,
) {
  const { data } = await apiClient.post(
    `${base(rid)}/schedules/${scheduleId}/publish`,
    opts.resetReceipts ? { resetReceipts: true } : {},
  )
  return data
}
export async function acknowledgeSchedule(scheduleId: string, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/schedules/${scheduleId}/acknowledge`)
  return data
}

// ── Shifts ────────────────────────────────────────────────────────────────
export async function createShift(body: Record<string, any>, rid?: string): Promise<Shift> {
  const { data } = await apiClient.post<Shift>(`${base(rid)}/shifts`, body)
  return data
}
export async function updateShift(shiftId: string, body: Record<string, any>, rid?: string): Promise<Shift> {
  const { data } = await apiClient.patch<Shift>(`${base(rid)}/shifts/${shiftId}`, body)
  return data
}
export async function deleteShift(shiftId: string, rid?: string) {
  await apiClient.delete(`${base(rid)}/shifts/${shiftId}`)
}
export async function reportCallout(shiftId: string, reason?: string, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/shifts/${shiftId}/callout`, { reason })
  return data
}
export async function offerCover(shiftId: string, memberIds: string[], rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/shifts/${shiftId}/offer-cover`, { memberIds })
  return data
}
export async function assignCover(shiftId: string, memberId: string, rid?: string): Promise<Shift> {
  const { data } = await apiClient.post<Shift>(`${base(rid)}/shifts/${shiftId}/assign`, { memberId })
  return data
}

// ── Certifications ─────────────────────────────────────────────────────
export async function getCertifications(rid?: string): Promise<Certification[]> {
  const { data } = await apiClient.get<Certification[]>(`${base(rid)}/certifications`)
  return data
}
export async function createCertification(body: Record<string, any>, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/certifications`, body)
  return data
}
export async function updateCertification(certId: string, body: Record<string, any>, rid?: string) {
  const { data } = await apiClient.patch(`${base(rid)}/certifications/${certId}`, body)
  return data
}
export async function deleteCertification(certId: string, rid?: string) {
  await apiClient.delete(`${base(rid)}/certifications/${certId}`)
}

// ── Requests ───────────────────────────────────────────────────────────
export async function getTimeOff(rid?: string) {
  const { data } = await apiClient.get(`${base(rid)}/time-off`)
  return data
}
export async function createTimeOff(body: Record<string, any>, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/time-off`, body)
  return data
}
export async function reviewTimeOff(
  requestId: string,
  status: 'approved' | 'denied',
  leaveType?: LeaveType,
  rid?: string,
) {
  const { data } = await apiClient.patch(`${base(rid)}/time-off/${requestId}`, {
    status,
    ...(leaveType ? { leaveType } : {}),
  })
  return data
}

// ── Coverage templates ─────────────────────────────────────────────────
export async function getCoverageTemplates(rid?: string) {
  const { data } = await apiClient.get(`${base(rid)}/coverage-templates`)
  return data
}
export async function createCoverageTemplate(body: Record<string, any>, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/coverage-templates`, body)
  return data
}
/** A coverage rule as `coverage_templates` stores it (baseline `:2574-2582`). */
export interface CoverageTemplateRow {
  id: string
  restaurant_id?: string
  day_of_week: number | null
  shift_period: string
  role: string
  min_staff: number
  created_at?: string
}
/**
 * Removes one rule of this house and answers with the row that went. The
 * gateway answers 404 when this house has no rule by that id — it no longer
 * says 200 over a delete that removed nothing (founder, 2026-09-26, item 51).
 */
export async function deleteCoverageTemplate(id: string, rid?: string): Promise<CoverageTemplateRow> {
  const { data } = await apiClient.delete<CoverageTemplateRow>(`${base(rid)}/coverage-templates/${id}`)
  return data
}

// ── Performance / sales ─────────────────────────────────────────────────
export async function getMemberPerformance(memberId: string, rid?: string): Promise<MemberPerformance> {
  const { data } = await apiClient.get<MemberPerformance>(`${base(rid)}/members/${memberId}/performance`)
  return data
}
/**
 * One service's figures for one person — the `IngestSalesDto` shape
 * (`team.dto.ts`). A blank figure is sent as 0, as the legacy panel did; the
 * gateway writes the same row either way. A second write for the same person
 * and day REPLACES the first (`uq_server_sales`).
 */
export interface SalesEntry {
  memberId: string
  serviceDate: string
  covers?: number
  netSales?: number
  wineSales?: number
  checks?: number
  /** 'manual' for typed in, 'csv' for a file — the two the legacy panel wrote. */
  source?: string
}
export interface SalesBatchResult {
  inserted: number
  /** Rows naming someone not on this house's roster — not written, named back. */
  skipped: number
  skippedRows: Array<{ memberId: string; serviceDate: string }>
}
export async function ingestSales(body: SalesEntry, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/sales`, body)
  return data
}
export async function ingestSalesBatch(rows: SalesEntry[], rid?: string): Promise<SalesBatchResult> {
  const { data } = await apiClient.post<SalesBatchResult>(`${base(rid)}/sales/batch`, { rows })
  return data
}

// ── Broadcast ───────────────────────────────────────────────────────────
/**
 * Exactly one of `memberIds` or `audience: "everyone"` — the gateway 400s a
 * body carrying both or neither (`team.controller.ts:381-392`, ADR 0088 T3).
 * An omitted `memberIds` used to mean "everybody" by default, which is how a
 * control labelled "Message {name}" reached the whole restaurant; saying it
 * out loud is the fix, so this signature will not let a caller stay silent.
 */
/**
 * `channels` names the channels a send may use. Founder decisions of
 * 2026-09-04, all binding on EVERY caller including the legacy desk: a crew
 * message sends neither email nor SMS (the only senders available are the
 * house's shared mailbox and shared SMS account, the ones vendors are written
 * from), and the set is `['inbox', 'push']` — which is also the most it can be.
 * `email` and `sms` remain accepted VALUES so a caller naming one is told what
 * it would have reached under `withheldByProduct` rather than silently losing
 * the channel. Both return when a house has senders of its own.
 * Gateway half: `apps/api-gateway/src/team/dto/team.dto.ts` + `team.controller.ts`.
 */
export type BroadcastChannel = 'inbox' | 'push' | 'email' | 'sms'

export interface BroadcastReceipt {
  audience: 'everyone' | 'selected'
  recipients: { targeted: number; notified: number }
  /** The RECIPIENTS declined it. Push is the only channel this can be non-zero on. */
  suppressed: { email: number; sms: number; push?: number }
  /** This send did not ask for the channel. */
  withheldByCaller?: { email: number; sms: number; push?: number }
  /** The house has no sender of its own, with the reason and the count. */
  withheldByProduct?: { email: number; sms: number; reason: string }
  channels?: BroadcastChannel[]
  preferencesUnavailable: boolean
  notified: number
  emailed: number
  texted: number
  inbox: boolean
  /** Who this send waits for (ADR 0218). Older gateways omit it. */
  away?: AwaySendOutcome
}

/**
 * A note or message sent to someone who is Away waits until they are back
 * (ADR 0218, the founder's round-2 answer 3). `readable: false`: Away could not
 * be read and nothing was held. `holdFailed`: a hold could not be written and
 * they were sent it now instead.
 */
export interface AwaySendOutcome {
  readable: boolean
  holdFailed: boolean
  held: Array<{ memberId: string; until: string; detail: string }>
}

export async function broadcast(
  body: { message: string; title?: string; channels?: BroadcastChannel[] } & (
    | { memberIds: string[]; audience?: never }
    | { audience: 'everyone'; memberIds?: never }
  ),
  rid?: string,
) {
  const { data } = await apiClient.post<BroadcastReceipt>(`${base(rid)}/broadcast`, body)
  return data
}

// ── Crew notes ─────────────────────────────────────────────────────────
/**
 * A note about one week, kept as a record (migration 20260904180000).
 *
 * `broadcast` reaches people and leaves nothing a manager can read back; these
 * three give the note an author, the audience it named at send time, and a
 * per-person `openedAt`. Delivery is the inbox and the phone only.
 */
export interface TeamNoteRecipient {
  memberId: string
  /** `null` when the roster could not be read — never a member id shown raw. */
  name: string | null
  /** `null` means UNOPENED, and only that. */
  openedAt: string | null
}

/**
 * What happened to ONE person on ONE channel (ADR 0121 P0).
 *
 * `acceptedByService` is not a delivery and `readFailed` is a fact about this
 * system rather than about the crew. The old `notified` count could say none of
 * that: it counted roster entries, and reported eleven against zero devices.
 */
export interface TeamNoteDelivery {
  memberId: string
  name: string | null
  channel: 'inbox' | 'push' | 'whatsapp' | 'sms'
  state:
    | 'delivered'
    | 'accepted_by_service'
    | 'no_device_registered'
    | 'no_consent'
    | 'no_sender'
    | 'declined'
    | 'read_failed'
    | 'failed'
    /** The person is Away; the note waits for them (ADR 0218). `detail` says until when. */
    | 'held_away'
  detail: string
}

export interface TeamNote {
  id: string
  weekStart: string
  scheduleId: string | null
  body: string
  channels: string[]
  createdAt: string
  authorUserId: string
  recipients: TeamNoteRecipient[]
  openedCount: number
  addressedCount: number
  /** `null` means the RECEIPT READ failed — never an absence of receipts. */
  deliveries: TeamNoteDelivery[] | null
}

export interface TeamNotesReadout {
  weekStart: string
  notes: TeamNote[]
  /** `false` renders as words. An unreadable register is never a quiet week. */
  readable: boolean
  reason: string | null
  namesReadable?: boolean
  /** Whether the DELIVERY record could be read, separately from the notes. */
  receiptsReadable?: boolean
  receiptsReason?: string | null
}

/* ── The house's text senders (ADR 0121) ─────────────────────────────── */

/**
 * RE-EXPORTED, NOT REDECLARED. The house's sender is one object read by
 * `/connections`, `/team` and `/profile`; its client lives in
 * `services/api/textSenders.ts` and this line is the pointer. A second
 * declaration here would be the fourth-catalogue mistake ADR 0114 closed as
 * G20, one product over.
 */
export {
  getTextSenders,
  giveTextConsent,
  withdrawTextConsent,
} from './textSenders'
export type {
  HouseTextSender,
  PersonTextConsent,
  TextSendersReadout,
} from './textSenders'

export async function getTeamNotes(weekStart: string, rid?: string): Promise<TeamNotesReadout> {
  const { data } = await apiClient.get<TeamNotesReadout>(`${base(rid)}/notes`, {
    params: { weekStart },
  })
  return data
}

export async function createTeamNote(
  body: { weekStart: string; body: string; memberIds: string[]; scheduleId?: string },
  rid?: string,
) {
  const { data } = await apiClient.post(`${base(rid)}/notes`, body)
  return data as {
    id: string
    addressed: number
    delivered: { inbox: boolean; push: number }
    channels: string[]
    /**
     * The tally, computed from the receipt rows rather than from the roster
     * (ADR 0121 P0). `written: false` means the note went out and the record of
     * what happened to whom did not, which the strip has to be able to say.
     */
    receipts: {
      written: boolean
      error: string | null
      total: number
      byState: {
        delivered: number
        acceptedByService: number
        noDeviceRegistered: number
        noConsent: number
        noSender: number
        readFailed: number
        failed: number
        /** Receipts that wait for someone Away (ADR 0218). Older gateways omit it. */
        heldAway?: number
      }
      note: string
    }
    away?: AwaySendOutcome
  }
}

export async function openTeamNote(noteId: string, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/notes/${noteId}/opened`)
  return data as { recorded: boolean; alreadyOpen: boolean }
}

// ── Settings ───────────────────────────────────────────────────────────
export async function getTeamSettings(rid?: string): Promise<TeamSettings> {
  const { data } = await apiClient.get<TeamSettings>(`${base(rid)}/settings`)
  return data
}
export async function updateTeamSettings(body: Partial<TeamSettings> & Record<string, any>, rid?: string) {
  const { data } = await apiClient.patch(`${base(rid)}/settings`, body)
  return data
}
