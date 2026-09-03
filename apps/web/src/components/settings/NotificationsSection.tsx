import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useAuthStore } from '../../stores'
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../hooks/queries'
import { ThemedSelect } from '../ui/ThemedSelect'
import { cn } from '../../lib/utils'

const TIME_OPTIONS = [
  { value: '08:00', label: '8:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '10:00', label: '10:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '14:00', label: '2:00 PM' },
  { value: '17:00', label: '5:00 PM' },
  { value: '20:00', label: '8:00 PM' },
]

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily digest' },
  { value: 'off', label: 'Off' },
]

const MODE_OPTIONS = [
  { value: 'both', label: 'In-app + email' },
  { value: 'in_app', label: 'In-app only' },
  { value: 'off', label: 'Off' },
]

const CATEGORIES = [
  { id: 'low', label: 'Low stock' },
  { id: 'orders', label: 'Orders' },
  { id: 'reports', label: 'Reports' },
] as const
type CategoryId = (typeof CATEGORIES)[number]['id']

type LowStock = {
  enabled: boolean
  instantFirstAlert: boolean
  criticalImmediate: boolean
  digestFrequency: 'daily' | 'off'
  digestTime: string
}
type Quiet = { enabled: boolean; startTime: string; endTime: string }
type Mode = 'both' | 'in_app' | 'off'

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full shrink-0 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:ring-offset-2',
        disabled
          ? 'bg-gray-100 cursor-not-allowed'
          : checked
            ? 'bg-wine-600'
            : 'bg-gray-200',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function Row({
  title,
  desc,
  tag,
  children,
}: {
  title: string
  desc?: string
  tag?: string
  children: React.ReactNode
}) {
  return (
    <div className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
          {title}
          {tag && (
            <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-wine-50 text-wine-700">
              {tag}
            </span>
          )}
        </p>
        {desc && <p className="text-xs text-gray-400 mt-0.5 max-w-md">{desc}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  )
}

export function NotificationsSection() {
  const user = useAuthStore((s) => s.user)
  const userId = user?.userId || ''
  const { data: prefs } = useNotificationPreferences(userId)
  const updatePrefs = useUpdateNotificationPreferences()

  const [cat, setCat] = useState<CategoryId>('low')
  const [low, setLow] = useState<LowStock>({
    enabled: true,
    instantFirstAlert: true,
    criticalImmediate: true,
    digestFrequency: 'daily',
    digestTime: '12:00',
  })
  const [quiet, setQuiet] = useState<Quiet>({
    enabled: false,
    startTime: '22:00',
    endTime: '08:00',
  })
  const [ordersMode, setOrdersMode] = useState<Mode>('both')
  const [reportsMode, setReportsMode] = useState<Mode>('both')

  useEffect(() => {
    if (prefs?.lowStock) setLow((p) => ({ ...p, ...prefs.lowStock }))
  }, [prefs?.lowStock])
  useEffect(() => {
    if (prefs?.quietHours) setQuiet((p) => ({ ...p, ...prefs.quietHours }))
  }, [prefs?.quietHours])
  useEffect(() => {
    if (prefs?.ordersMode) setOrdersMode(prefs.ordersMode)
  }, [prefs?.ordersMode])
  useEffect(() => {
    if (prefs?.reportsMode) setReportsMode(prefs.reportsMode)
  }, [prefs?.reportsMode])

  const saveLow = (patch: Partial<LowStock>) => {
    const next = { ...low, ...patch }
    setLow(next)
    if (userId) updatePrefs.mutate({ userId, preferences: { lowStock: next } })
  }
  const saveQuiet = (patch: Partial<Quiet>) => {
    const next = { ...quiet, ...patch }
    setQuiet(next)
    if (userId) updatePrefs.mutate({ userId, preferences: { quietHours: next } })
  }
  const saveOrdersMode = (v: Mode) => {
    setOrdersMode(v)
    if (userId) updatePrefs.mutate({ userId, preferences: { ordersMode: v } })
  }
  const saveReportsMode = (v: Mode) => {
    setReportsMode(v)
    if (userId) updatePrefs.mutate({ userId, preferences: { reportsMode: v } })
  }

  const off = !low.enabled

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 flex items-center gap-2 border-b border-gray-100">
        <Bell className="w-4 h-4 text-wine-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
          <p className="text-xs text-gray-400 mt-0.5">How and when Mudavym alerts you</p>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {/* category selector */}
        <div className="px-6 py-4">
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  cat === c.id
                    ? 'bg-wine-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* LOW STOCK */}
        {cat === 'low' && (
          <>
            <Row title="Low-stock alerts" desc="Wines that drop below par level">
              <Toggle checked={low.enabled} onChange={() => saveLow({ enabled: !low.enabled })} />
            </Row>
            <Row
              title="Alert me the moment a wine runs low"
              tag="INSTANT"
              desc="The first time it drops below par — even a POS sale or pour that crosses the line alerts within seconds."
            >
              <Toggle
                checked={low.instantFirstAlert}
                disabled={off}
                onChange={() => saveLow({ instantFirstAlert: !low.instantFirstAlert })}
              />
            </Row>
            <Row
              title="Bundle wines that stay low"
              desc="A reminder for anything still below par, so you're not nagged repeatedly."
            >
              <ThemedSelect
                value={low.digestFrequency}
                options={FREQUENCY_OPTIONS}
                disabled={off}
                onChange={(v) => saveLow({ digestFrequency: v as 'daily' | 'off' })}
              />
              {low.digestFrequency === 'daily' && (
                <ThemedSelect
                  value={low.digestTime}
                  options={TIME_OPTIONS}
                  disabled={off}
                  onChange={(v) => saveLow({ digestTime: v })}
                />
              )}
            </Row>
            <Row
              title="Critical alerts interrupt immediately"
              desc="At or below 50% of par — sends now and overrides quiet hours."
            >
              <Toggle
                checked={low.criticalImmediate}
                disabled={off}
                onChange={() => saveLow({ criticalImmediate: !low.criticalImmediate })}
              />
            </Row>
          </>
        )}

        {/* ORDERS */}
        {cat === 'orders' && (
          <Row
            title="Deliveries, payments & recurring orders"
            desc="Delivery ETAs, payment reminders, and upcoming recurring orders."
          >
            <ThemedSelect
              value={ordersMode}
              options={MODE_OPTIONS}
              onChange={(v) => saveOrdersMode(v as Mode)}
            />
          </Row>
        )}

        {/* REPORTS */}
        {cat === 'reports' && (
          <Row
            title="Weekly report & summaries"
            desc="Your weekly inventory and sales summary."
          >
            <ThemedSelect
              value={reportsMode}
              options={MODE_OPTIONS}
              onChange={(v) => saveReportsMode(v as Mode)}
            />
          </Row>
        )}

        {/* GLOBAL — quiet hours */}
        <Row
          title="Quiet hours"
          desc="Hold non-urgent alerts overnight. Critical low-stock always overrides."
        >
          <input
            type="time"
            value={quiet.startTime}
            disabled={!quiet.enabled}
            onChange={(e) => saveQuiet({ startTime: e.target.value })}
            className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm font-semibold tabular-nums text-gray-900 focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none disabled:opacity-50"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="time"
            value={quiet.endTime}
            disabled={!quiet.enabled}
            onChange={(e) => saveQuiet({ endTime: e.target.value })}
            className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm font-semibold tabular-nums text-gray-900 focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none disabled:opacity-50"
          />
          <Toggle checked={quiet.enabled} onChange={() => saveQuiet({ enabled: !quiet.enabled })} />
        </Row>
      </div>
    </div>
  )
}
