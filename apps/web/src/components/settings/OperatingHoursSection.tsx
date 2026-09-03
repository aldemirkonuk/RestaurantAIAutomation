import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  MAX_RANGES_PER_DAY,
  OperatingHours,
  OperatingHoursResponse,
  WEEKDAYS,
  WEEKDAY_LABELS,
  Weekday,
  operatingHoursErrorsFrom,
  restaurantsApi,
} from '../../services/api/restaurants'
import { cn } from '../../lib/utils'

/**
 * When is this venue open? (ADR 0093 D1)
 *
 * Before this section the product had no answer, and every consumer that
 * needed a service day invented one. The whole design constraint here is that
 * FOUR states stay visibly different:
 *
 *   loading      — we have not asked yet
 *   failed       — we asked and could not find out; the error is shown
 *   not set      — the venue genuinely has no hours recorded (null)
 *   closed all week — someone deliberately saved seven empty days
 *
 * Rendering `null` as an all-closed grid would be the fabricated answer ADR
 * 0020 forbids, and rendering a failed load as "not set" would be worse: it
 * blames the venue for the network.
 */

type Status = 'loading' | 'failed' | 'ready'

const EMPTY_WEEK: OperatingHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
}

const DEFAULT_RANGE = { open: '12:00', close: '23:00' }

function cloneWeek(hours: OperatingHours): OperatingHours {
  return WEEKDAYS.reduce((acc, d) => {
    acc[d] = (hours[d] ?? []).map((r) => ({ ...r }))
    return acc
  }, {} as OperatingHours)
}

export function OperatingHoursSection({
  restaurantId,
  canEdit = true,
}: {
  restaurantId?: string
  /** Owner or manager. The gateway is the real gate; this only hides the controls. */
  canEdit?: boolean
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [meta, setMeta] = useState<OperatingHoursResponse | null>(null)
  /** null = the venue's hours are unknown. Never conflated with EMPTY_WEEK. */
  const [draft, setDraft] = useState<OperatingHours | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setLoadError(null)
    setFieldErrors(null)
    try {
      const res = await restaurantsApi.getOperatingHours(restaurantId)
      setMeta(res)
      setDraft(res.operatingHours ? cloneWeek(res.operatingHours) : null)
      setDirty(false)
      setStatus('ready')
    } catch (err) {
      // The error is rendered, not swallowed into an empty editor. An empty
      // editor over a failed GET invites someone to "fix" hours that were
      // never read, and the save would then overwrite the real ones.
      setLoadError(
        (err as Error)?.message || 'Operating hours could not be loaded',
      )
      setMeta(null)
      setDraft(null)
      setStatus('failed')
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = (next: OperatingHours | null) => {
    setDraft(next)
    setDirty(true)
    setFieldErrors(null)
  }

  /**
   * Open the editor on a venue with no hours, WITHOUT marking it dirty. One
   * click must not be able to save seven closed days — "closed every day" is a
   * real claim about the venue and has to be made deliberately.
   */
  const beginEditing = () => {
    setDraft(cloneWeek(EMPTY_WEEK))
    setDirty(false)
    setFieldErrors(null)
  }

  const setDay = (day: Weekday, ranges: { open: string; close: string }[]) => {
    const week = draft ? cloneWeek(draft) : cloneWeek(EMPTY_WEEK)
    week[day] = ranges
    mutate(week)
  }

  const save = async () => {
    setSaving(true)
    setFieldErrors(null)
    try {
      const res = await restaurantsApi.putOperatingHours(restaurantId, draft)
      setMeta(res)
      setDraft(res.operatingHours ? cloneWeek(res.operatingHours) : null)
      setDirty(false)
      toast.success('Operating hours saved')
    } catch (err) {
      const errors = operatingHoursErrorsFrom(err)
      if (errors) {
        // The server lists EVERY fault. Showing one of them, or a generic
        // "invalid", would send the person back around the loop per mistake.
        setFieldErrors(errors)
      } else {
        setFieldErrors([
          (err as Error)?.message || 'Operating hours could not be saved',
        ])
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
      data-testid="operating-hours-section"
    >
      <div className="px-6 py-4 flex items-center justify-between gap-3 border-b border-gray-100 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-wine-500" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Operating hours</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              When this venue is open. Everything that reads a service day uses these.
            </p>
          </div>
        </div>
        {status === 'ready' && (
          <p className="text-xs text-gray-400" data-testid="operating-hours-timezone">
            {meta?.timezone
              ? `Times are local to ${meta.timezone}`
              : 'Timezone not set — times cannot be placed'}
          </p>
        )}
      </div>

      {status === 'loading' && (
        <p className="px-6 py-6 text-sm text-gray-400" data-testid="operating-hours-loading">
          Loading hours…
        </p>
      )}

      {status === 'failed' && (
        <div className="px-6 py-6" data-testid="operating-hours-load-error">
          <p className="text-sm font-medium text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Hours could not be loaded
          </p>
          <p className="text-xs text-gray-500 mt-1">{loadError}</p>
          <p className="text-xs text-gray-400 mt-1">
            This is not the same as having no hours set — nothing is shown because
            nothing was read.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && meta?.storedHoursErrors && (
        <div
          className="px-6 py-4 bg-amber-50 border-b border-amber-100"
          data-testid="operating-hours-stored-invalid"
        >
          <p className="text-sm font-medium text-amber-800">
            The saved hours for this venue do not parse and are being ignored
          </p>
          <ul className="mt-1 text-xs text-amber-700 list-disc pl-4">
            {meta.storedHoursErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {status === 'ready' && draft === null && (
        <div className="px-6 py-6" data-testid="operating-hours-not-set">
          <p className="text-sm text-gray-700">Hours not set</p>
          <p className="text-xs text-gray-400 mt-1">
            Nobody has recorded when this venue opens. That is different from being
            closed — nothing will assume a schedule on its behalf.
          </p>
          {dirty && (
            <p className="text-xs text-amber-600 mt-1" data-testid="operating-hours-clear-pending">
              Not saved yet — the venue still has its saved hours until you save.
            </p>
          )}
          {canEdit && !dirty && (
            <button
              type="button"
              onClick={beginEditing}
              className="mt-3 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-wine-600 text-white hover:bg-wine-700"
            >
              Set hours
            </button>
          )}
        </div>
      )}

      {status === 'ready' && draft !== null && (
        <div className="divide-y divide-gray-50">
            {WEEKDAYS.map((day) => {
              const ranges = draft[day] ?? []
              const closed = ranges.length === 0
              return (
                <div
                  key={day}
                  className="px-6 py-3 flex items-start justify-between gap-4 flex-wrap"
                  data-testid={`operating-hours-row-${day}`}
                >
                  <p className="text-sm font-medium text-gray-700 w-28 pt-1.5">
                    {WEEKDAY_LABELS[day]}
                  </p>

                  <div className="flex-1 min-w-[16rem] space-y-2">
                    {closed ? (
                      <p className="text-sm text-gray-400 pt-1.5">Closed</p>
                    ) : (
                      ranges.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <input
                            type="time"
                            aria-label={`${WEEKDAY_LABELS[day]} range ${i + 1} opens`}
                            value={r.open}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const next = ranges.map((x) => ({ ...x }))
                              next[i].open = e.target.value
                              setDay(day, next)
                            }}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-sm"
                          />
                          <span className="text-xs text-gray-400">to</span>
                          <input
                            type="time"
                            aria-label={`${WEEKDAY_LABELS[day]} range ${i + 1} closes`}
                            value={r.close}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const next = ranges.map((x) => ({ ...x }))
                              next[i].close = e.target.value
                              setDay(day, next)
                            }}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-sm"
                          />
                          {canEdit && (
                            <button
                              type="button"
                              aria-label={`Remove ${WEEKDAY_LABELS[day]} range ${i + 1}`}
                              onClick={() =>
                                setDay(
                                  day,
                                  ranges.filter((_, j) => j !== i),
                                )
                              }
                              className="text-gray-300 hover:text-wine-500"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-3 shrink-0 pt-1">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">
                        <input
                          type="checkbox"
                          aria-label={`${WEEKDAY_LABELS[day]} closed`}
                          checked={closed}
                          onChange={() =>
                            setDay(day, closed ? [{ ...DEFAULT_RANGE }] : [])
                          }
                        />
                        Closed
                      </label>
                      <button
                        type="button"
                        disabled={ranges.length >= MAX_RANGES_PER_DAY}
                        onClick={() => setDay(day, [...ranges, { ...DEFAULT_RANGE }])}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium',
                          ranges.length >= MAX_RANGES_PER_DAY
                            ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                        )}
                      >
                        <Plus className="w-3 h-3" /> range
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {status === 'ready' && fieldErrors && (
        <div className="px-6 py-3 bg-red-50" data-testid="operating-hours-save-errors">
          <p className="text-sm font-medium text-red-700">These hours were not saved</p>
          <ul className="mt-1 text-xs text-red-600 list-disc pl-4">
            {fieldErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The save bar lives OUTSIDE the grid: clearing the hours collapses the
          grid to the "not set" panel, and the pending change still has to be
          saveable — otherwise "clear" would be a change nobody could commit. */}
      {status === 'ready' && canEdit && (draft !== null || dirty) && (
        <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-gray-100 flex-wrap">
          {draft !== null ? (
            <button
              type="button"
              onClick={() => mutate(null)}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Clear hours (record them as unknown)
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(
                  meta?.operatingHours ? cloneWeek(meta.operatingHours) : null,
                )
                setDirty(false)
                setFieldErrors(null)
              }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Undo
            </button>
          )}
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-gray-400">Unsaved changes</span>}
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void save()}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-sm font-medium',
                saving || !dirty
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-wine-600 text-white hover:bg-wine-700',
              )}
            >
              {saving ? 'Saving…' : 'Save hours'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
