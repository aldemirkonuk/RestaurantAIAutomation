/**
 * Team Ops API — Manager Shift Desk (sketch 038 production port).
 * All routes are scoped under /restaurants/:restaurantId/team.
 */
import { apiClient, getActiveRestaurantId } from './client'

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
  hourly_wage: number | null
  skills: string[]
  hire_date: string | null
  status: string
  notes: string | null
  role: 'owner' | 'manager' | 'staff' | null
  accountLinked: boolean
  linkedUser?: { name?: string; email?: string; avatar_url?: string } | null
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
  labor_cost: number | null
  shift_breaks?: ShiftBreak[]
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

export interface WeekPayload {
  schedule: Schedule | null
  shifts: Shift[]
  coverage: { days: CoverageDay[]; totalGaps: number }
  labor: {
    enabled: boolean
    totalHours: number
    totalCost?: number
    targetPct?: number
    overtime?: Array<{ memberId: string; hours: number }>
  }
  receipts: Array<{ member_id: string; seen_at: string }>
  settings: TeamSettings
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
  wage_visible: boolean
  labor_target_pct: number
}

export interface MemberPerformance {
  hasData: boolean
  metrics?: { salesPerShift: number; avgCheck: number; wineAttachPct: number }
  // median/band are null when the peer benchmark is UNKNOWN — either the
  // server_sales read failed or the restaurant has no other servers with
  // covers. They used to arrive as 0, which drew the peer line at the bottom
  // of the chart and put every server above it. ADR 0067.
  analytic?: { unit: string; series: number[]; median: number | null; band: readonly [number, number] | null }
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
export async function deleteTeamMember(memberId: string, rid?: string) {
  await apiClient.delete(`${base(rid)}/members/${memberId}`)
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
export async function reviewTimeOff(requestId: string, status: 'approved' | 'denied', rid?: string) {
  const { data } = await apiClient.patch(`${base(rid)}/time-off/${requestId}`, { status })
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
export async function deleteCoverageTemplate(id: string, rid?: string) {
  await apiClient.delete(`${base(rid)}/coverage-templates/${id}`)
}

// ── Performance / sales ─────────────────────────────────────────────────
export async function getMemberPerformance(memberId: string, rid?: string): Promise<MemberPerformance> {
  const { data } = await apiClient.get<MemberPerformance>(`${base(rid)}/members/${memberId}/performance`)
  return data
}
export async function ingestSales(body: Record<string, any>, rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/sales`, body)
  return data
}
export async function ingestSalesBatch(rows: Record<string, any>[], rid?: string) {
  const { data } = await apiClient.post(`${base(rid)}/sales/batch`, { rows })
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
}

export interface TeamNotesReadout {
  weekStart: string
  notes: TeamNote[]
  /** `false` renders as words. An unreadable register is never a quiet week. */
  readable: boolean
  reason: string | null
  namesReadable?: boolean
}

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
