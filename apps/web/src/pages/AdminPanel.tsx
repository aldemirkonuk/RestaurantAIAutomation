import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  Settings, 
  Zap, 
  Bell, 
  Database, 
  Save, 
  RefreshCw,
  ArrowLeft,
  Activity,
  Server,
  Cpu,
  Clock,
  ChevronRight,
  AlertCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { BrandMark } from '../components/brand/BrandMark'

/** Admin config persists locally — there is no admin-config endpoint (NEW-544). */
const ADMIN_SETTINGS_KEY = 'wineops.admin.settings'

interface RestaurantSettings {
  buffer_window_minutes: number
  default_threshold_min: number
  enable_auto_procurement: boolean
  enable_visual_verification: boolean
  enable_predictive_analytics: boolean
}

/** Shape of one entry in GET /api/v1/health/agents — base_agent.py get_health(). */
interface AgentSummary {
  agent_name?: string
  version?: string
  status?: string
  healthy?: boolean
  capabilities?: string[]
}

/** `metrics` block of GET /api/v1/health/agents/:name — AgentMetrics.to_dict(). */
interface AgentDetailMetrics {
  messages?: {
    received?: number
    processed?: number
    failed?: number
    skipped?: number
    /** Preformatted by the service, e.g. "98.50%". */
    success_rate?: string
  }
  timing?: { avg_ms?: number }
}

interface AgentCard {
  status: 'active' | 'inactive' | 'warning'
  messages: number | string
  avgTime: string
  errors: string
}

/** Shown wherever the service did not give us the number. Never substitute a 0. */
const METRIC_UNAVAILABLE = '—'

/**
 * "Reached the orchestrator, it has no agents" is a successful answer, not a failure.
 * It shares the empty-state branch with real errors, so it gets its own sentinel and
 * its own heading rather than being reported as an outage.
 */
const NO_AGENTS_MESSAGE = 'The orchestrator responded but reports no running agents.'

/**
 * Map orchestrator health onto the badge vocabulary. `healthy` is the service's own
 * verdict (status in {active,idle} AND success_rate >= 0.9 AND breaker closed), so an
 * unhealthy-but-running agent lands on "warning" rather than being painted green.
 */
function toAgentCard(agent: AgentSummary, metrics: AgentDetailMetrics | null): AgentCard {
  const state = (agent.status ?? '').toLowerCase()
  let status: AgentCard['status']
  if (agent.healthy === true) {
    status = 'active'
  } else if (state === 'error' || state === 'stopped' || state === 'stopping') {
    status = 'inactive'
  } else {
    status = 'warning'
  }

  const processed = metrics?.messages?.processed
  const avgMs = metrics?.timing?.avg_ms
  // success_rate arrives as a formatted percentage string; the card's slot is an
  // error rate, so invert it. Anything unparseable stays unknown.
  const successPct = Number.parseFloat(metrics?.messages?.success_rate ?? '')

  return {
    status,
    messages: typeof processed === 'number' ? processed : METRIC_UNAVAILABLE,
    avgTime: typeof avgMs === 'number' ? `${avgMs.toFixed(1)}ms` : METRIC_UNAVAILABLE,
    errors: Number.isFinite(successPct)
      ? `${Math.max(0, 100 - successPct).toFixed(2)}%`
      : METRIC_UNAVAILABLE,
  }
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

// Toggle Switch Component
function Toggle({ 
  checked, 
  onChange 
}: { 
  checked: boolean
  onChange: (checked: boolean) => void 
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:ring-offset-2 ${
        checked ? 'bg-slate-900' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// Status Badge Component
function StatusBadge({ status }: { status: 'active' | 'inactive' | 'warning' }) {
  const styles = {
    active: 'badge-success',
    inactive: 'badge-danger',
    warning: 'badge-warning',
  }
  
  const labels = {
    active: 'Active',
    inactive: 'Inactive',
    warning: 'Warning',
  }

  return (
    <span className={styles[status]}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'active' ? 'bg-success-500' : 
        status === 'inactive' ? 'bg-danger-500' : 'bg-warning-500'
      }`} />
      {labels[status]}
    </span>
  )
}

// Number Input Component
function NumberInput({ 
  value, 
  onChange, 
  min, 
  max, 
  step = 1 
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(min ?? -Infinity, value - step))}
        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
      >
        -
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="w-20 px-3 py-2 text-center rounded-lg bg-white border border-slate-200 text-slate-900 font-medium tabular-nums"
      />
      <button
        onClick={() => onChange(Math.min(max ?? Infinity, value + step))}
        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
      >
        +
      </button>
    </div>
  )
}

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<'general' | 'agents' | 'notifications' | 'integrations'>('general')
  const [saving, setSaving] = useState(false)
  const [agentStatus, setAgentStatus] = useState<Record<string, AgentCard>>({})
  const [agentStatusLoading, setAgentStatusLoading] = useState(true)
  const [agentStatusError, setAgentStatusError] = useState<string | null>(null)
  const [infraProviders, setInfraProviders] = useState<
    Array<{ id: string; name: string; desc: string; status: string; healthy: boolean }>
  >([])
  
  const [settings, setSettings] = useState<RestaurantSettings>(() => {
    const defaults: RestaurantSettings = {
      buffer_window_minutes: 30,
      default_threshold_min: 5,
      enable_auto_procurement: true,
      enable_visual_verification: false,
      enable_predictive_analytics: false,
    }
    // Rehydrate what Save wrote, so "saved on this device" is actually true.
    try {
      const stored = localStorage.getItem(ADMIN_SETTINGS_KEY)
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults
    } catch {
      return defaults
    }
  })

  // Provider health (Supabase / Gemini / Claude for Studio)
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'
        const token = localStorage.getItem('accessToken')
        const { data } = await axios.get(`${apiUrl}/api/v1/health/providers`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 5000,
        })
        const fromApi = (data?.providers ?? []) as Array<{
          id: string
          name: string
          desc: string
          status: string
          healthy: boolean
        }>
        setInfraProviders([
          ...fromApi,
          { id: 'rabbitmq', name: 'Message Queue', desc: 'RabbitMQ', status: 'Active', healthy: true },
          { id: 'redis', name: 'Cache', desc: 'Redis', status: 'Running', healthy: true },
        ])
      } catch {
        setInfraProviders([
          { id: 'supabase', name: 'Database', desc: 'Supabase PostgreSQL', status: 'Unknown', healthy: false },
          { id: 'rabbitmq', name: 'Message Queue', desc: 'RabbitMQ', status: 'Unknown', healthy: false },
          { id: 'redis', name: 'Cache', desc: 'Redis', status: 'Unknown', healthy: false },
          { id: 'gemini', name: 'AI Engine', desc: 'Gemini Pro', status: 'Unknown', healthy: false },
          {
            id: 'claude',
            name: 'Studio Vision',
            desc: 'Claude API (Haiku / Sonnet — /studio extract)',
            status: 'Unknown',
            healthy: false,
          },
        ])
      }
    }
    if (activeTab === 'general') void fetchProviders()
  }, [activeTab])

  /**
   * Agent health (ADR 0019 / D4).
   *
   * This used to call the Python orchestrator directly at
   * `${VITE_AGENT_ORCHESTRATOR_URL}/health/agents` with a bare axios GET, which was
   * wrong twice over, so the panel could only ever reach its catch branch:
   *   1. the real route is `/api/v1/health/agents`
   *      (services/agent-orchestrator/api/health_routes.py:244, mounted with no
   *      prefix at services/agent-orchestrator/main.py:154), so the old path 404'd;
   *   2. it requires an `X-Admin-Key` matching the server's ADMIN_API_KEY
   *      (health_routes.py:230-241) — a secret that must never reach browser JS.
   *
   * The api-gateway already proxies both routes and injects that header server-side
   * (apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts:27-35 →
   * orchestrator.service.ts:77-97), so we go through the gateway with the user's JWT,
   * exactly like the provider fetch above and like handleRestartAgent below.
   */
  useEffect(() => {
    if (activeTab !== 'agents') return
    let cancelled = false

    const fetchAgentMetrics = async () => {
      setAgentStatusLoading(true)
      setAgentStatusError(null)

      const apiUrl = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'
      const token = localStorage.getItem('accessToken')
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

      try {
        const { data } = await axios.get(`${apiUrl}/api/v1/health/agents`, {
          headers: authHeaders,
          timeout: 8000,
        })

        // health_routes.py:254-258 returns a LIST under `agents`, not a name-keyed map,
        // and each entry is get_health() (core/base_agent.py:990-1004) — agent_name /
        // status / healthy only. The old code read `state`, `messages_processed`,
        // `avg_processing_time_ms` and `error_rate`, none of which exist on any payload.
        const summaries: AgentSummary[] = Array.isArray(data?.agents) ? data.agents : []

        // Counters live only on the per-agent detail route (get_detailed_health,
        // core/base_agent.py:1006-1025). Fetch them per agent; one failure must not
        // blank the others, and a missing metric renders as "—", never a made-up 0.
        const details = await Promise.all(
          summaries.map(async (agent) => {
            if (!agent?.agent_name) return null
            try {
              const res = await axios.get(
                `${apiUrl}/api/v1/health/agents/${encodeURIComponent(agent.agent_name)}`,
                { headers: authHeaders, timeout: 8000 },
              )
              return (res.data?.metrics ?? null) as AgentDetailMetrics | null
            } catch {
              return null
            }
          }),
        )
        if (cancelled) return

        const transformed: Record<string, AgentCard> = {}
        summaries.forEach((agent, index) => {
          const name = agent?.agent_name
          if (!name) return
          transformed[name] = toAgentCard(agent, details[index])
        })

        setAgentStatus(transformed)
        setAgentStatusError(
          Object.keys(transformed).length === 0 ? NO_AGENTS_MESSAGE : null,
        )
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch agent metrics:', error)
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        setAgentStatusError(
          status === 401 || status === 403
            ? 'Sign in again — the gateway rejected this session when proxying agent health.'
            : status === 404
              ? 'The api-gateway has no /api/v1/health/agents proxy — it may be running an older build.'
              : 'Could not reach the orchestrator through the api-gateway. Check that AGENT_ORCHESTRATOR_URL and ADMIN_API_KEY are set on the gateway and that the orchestrator is running.',
        )
        setAgentStatus({})
      } finally {
        if (!cancelled) setAgentStatusLoading(false)
      }
    }

    void fetchAgentMetrics()
    return () => {
      cancelled = true
    }
  }, [activeTab])

  /**
   * NEW-544. This previously faked a 1s delay and reported "saved
   * successfully" — a success message for a no-op. There is no admin-config
   * endpoint (the settings module only exposes feature flags), so the values
   * are persisted locally and the toast says exactly that instead of implying
   * a server write.
   */
  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(settings))
      toast.success('Settings saved on this device', {
        description: 'Admin config has no server endpoint yet, so these apply locally.',
      })
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  /**
   * NEW-545. This previously waited 2s and claimed the agent "restarted
   * successfully" without calling anything. Restarting needs an orchestrator
   * control endpoint that doesn't exist (only GET /api/v1/health/agents[/:name]
   * is exposed), so rather than lie we re-check the agent's live health and tell
   * the user what's actually true.
   */
  const handleRestartAgent = async (agentName: string) => {
    const pretty = agentName.replace(/_/g, ' ')
    try {
      const apiUrl = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'
      const token = localStorage.getItem('accessToken')
      const res = await axios.get(`${apiUrl}/api/v1/health/agents/${agentName}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 8000,
      })
      const healthy = res.data?.healthy ?? res.data?.agent?.healthy
      toast.warning(`Restart isn't wired for ${pretty}`, {
        description: healthy
          ? `It currently reports healthy. Restarting needs an orchestrator control endpoint.`
          : `It currently reports unhealthy. Restarting needs an orchestrator control endpoint — check the service logs.`,
      })
    } catch {
      toast.error(`Couldn't reach ${pretty}`, {
        description: 'Restart control is not implemented; the health check also failed.',
      })
    }
  }

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'agents', label: 'Agents', icon: Zap },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'integrations', label: 'Integrations', icon: Database },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link 
                to="/" 
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </Link>
              <div className="flex items-center gap-3">
                <BrandMark variant="mark" size={26} alt="" />
                <div>
                  <h1 className="text-lg font-bold text-slate-900">Admin Settings</h1>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="badge-success">
                <Activity className="w-3.5 h-3.5" />
                System Healthy
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Tabs */}
          <motion.div variants={itemVariants} className="mb-8">
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      activeTab === tab.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </motion.div>

          {/* Tab Content */}
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* General Settings */}
            {activeTab === 'general' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Restaurant Settings Card */}
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-card overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-lg font-semibold text-slate-900">Restaurant Settings</h3>
                    <p className="text-sm text-slate-500 mt-1">Configure your inventory parameters</p>
                  </div>
                  <div className="p-6 space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Buffer Window
                      </label>
                      <NumberInput
                        value={settings.buffer_window_minutes}
                        onChange={(val) => setSettings({ ...settings, buffer_window_minutes: val })}
                        min={10}
                        max={120}
                        step={5}
                      />
                      <p className="text-sm text-slate-500 mt-2">
                        Time window (minutes) for aggregating sales before alerts
                      </p>
                    </div>

                    <div className="divider" />

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Default Low Stock Threshold
                      </label>
                      <NumberInput
                        value={settings.default_threshold_min}
                        onChange={(val) => setSettings({ ...settings, default_threshold_min: val })}
                        min={1}
                        max={50}
                      />
                      <p className="text-sm text-slate-500 mt-2">
                        Minimum bottles before triggering low stock alert
                      </p>
                    </div>

                    <div className="divider" />

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Auto Procurement</p>
                          <p className="text-sm text-slate-500">Automatically create orders when low</p>
                        </div>
                        <Toggle
                          checked={settings.enable_auto_procurement}
                          onChange={(checked) => setSettings({ ...settings, enable_auto_procurement: checked })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Visual Verification</p>
                          <p className="text-sm text-slate-500">Require photo confirmation</p>
                        </div>
                        <Toggle
                          checked={settings.enable_visual_verification}
                          onChange={(checked) => setSettings({ ...settings, enable_visual_verification: checked })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Predictive Analytics</p>
                          <p className="text-sm text-slate-500">AI-powered demand forecasting</p>
                        </div>
                        <Toggle
                          checked={settings.enable_predictive_analytics}
                          onChange={(checked) => setSettings({ ...settings, enable_predictive_analytics: checked })}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
                    <button
                      onClick={handleSaveSettings}
                      disabled={saving}
                      className="btn-primary w-full"
                    >
                      {saving ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Settings
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* System Status Card */}
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-card overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-lg font-semibold text-slate-900">System Status</h3>
                    <p className="text-sm text-slate-500 mt-1">Infrastructure health overview</p>
                  </div>
                  <div className="p-6 space-y-3">
                    {(infraProviders.length
                      ? infraProviders
                      : [
                          { id: 'supabase', name: 'Database', desc: 'Supabase PostgreSQL', status: '…', healthy: true },
                          { id: 'rabbitmq', name: 'Message Queue', desc: 'RabbitMQ', status: '…', healthy: true },
                          { id: 'redis', name: 'Cache', desc: 'Redis', status: '…', healthy: true },
                          { id: 'gemini', name: 'AI Engine', desc: 'Gemini Pro', status: '…', healthy: true },
                          {
                            id: 'claude',
                            name: 'Studio Vision',
                            desc: 'Claude API (Haiku / Sonnet — /studio extract)',
                            status: '…',
                            healthy: true,
                          },
                        ]
                    ).map((service) => {
                      const Icon =
                        service.id === 'supabase'
                          ? Database
                          : service.id === 'rabbitmq'
                            ? Server
                            : service.id === 'redis'
                              ? Cpu
                              : Zap
                      return (
                      <div
                        key={service.id}
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              service.healthy ? 'bg-success-500 animate-pulse-soft' : 'bg-amber-400'
                            }`}
                          />
                          <div className="flex items-center gap-2.5">
                            <Icon className="w-4 h-4 text-slate-400" />
                            <div>
                              <p className="font-medium text-slate-900">{service.name}</p>
                              <p className="text-sm text-slate-500">{service.desc}</p>
                            </div>
                          </div>
                        </div>
                        <span className={service.healthy ? 'badge-success' : 'badge-warning'}>
                          {service.status}
                        </span>
                      </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Agents Tab */}
            {activeTab === 'agents' && (
              <>
                {agentStatusLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <RefreshCw className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
                      <p className="text-sm text-slate-500">Loading agent metrics...</p>
                    </div>
                  </div>
                ) : agentStatusError || Object.keys(agentStatus).length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200/80 shadow-card p-8">
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                        <AlertCircle className="w-8 h-8 text-slate-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">
                        {agentStatusError === NO_AGENTS_MESSAGE
                          ? 'No Agents Running'
                          : 'Agent Health Unavailable'}
                      </h3>
                      <p className="text-sm text-slate-500 max-w-md">
                        {agentStatusError || 'The api-gateway returned no agent health for this session.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(agentStatus).map(([name, data]) => (
                      <div
                        key={name}
                        className="bg-white rounded-2xl border border-slate-200/80 shadow-card p-6 hover:shadow-card-hover transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="font-semibold text-slate-900 capitalize">
                              {name.replace(/_/g, ' ')}
                            </h3>
                            <StatusBadge status={data.status} />
                          </div>
                          <div className="p-2.5 bg-slate-100 rounded-xl">
                            <Zap className="w-5 h-5 text-slate-600" />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Messages Processed</span>
                            <span className="font-semibold text-slate-900 tabular-nums">{data.messages}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Avg Processing Time</span>
                            <span className="font-semibold text-slate-900 tabular-nums">{data.avgTime}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Error Rate</span>
                            <span className={`font-semibold tabular-nums ${
                              data.errors === METRIC_UNAVAILABLE
                                ? 'text-slate-400'
                                : parseFloat(data.errors) > 0.1
                                  ? 'text-warning-600'
                                  : 'text-success-600'
                            }`}>
                              {data.errors}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleRestartAgent(name)}
                          className="btn-secondary w-full mt-4"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Restart Agent
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Notifications Tab */}
            {activeTab === 'notifications' && (
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-card overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="text-lg font-semibold text-slate-900">Notification Settings</h3>
                  <p className="text-sm text-slate-500 mt-1">Configure how you receive alerts</p>
                </div>
                <div className="p-6 space-y-8">
                  {/* Low Stock Alerts */}
                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">
                      Low Stock Alerts
                    </h4>
                    <div className="space-y-3">
                      {[
                        { name: 'SMS Notifications', enabled: true },
                        { name: 'Email Notifications', enabled: true },
                        { name: 'Push Notifications', enabled: true },
                      ].map((item) => (
                        <div
                          key={item.name}
                          className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                        >
                          <span className="font-medium text-slate-700">{item.name}</span>
                          <Toggle checked={item.enabled} onChange={() => {}} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="divider" />

                  {/* Reports */}
                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">
                      Scheduled Reports
                    </h4>
                    <div className="space-y-3">
                      {[
                        { name: 'Daily Report', time: '8:00 AM', enabled: true },
                        { name: 'Weekly Summary', time: 'Monday 9:00 AM', enabled: true },
                        { name: 'Monthly Analytics', time: '1st of month', enabled: false },
                      ].map((item) => (
                        <div
                          key={item.name}
                          className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                        >
                          <div>
                            <p className="font-medium text-slate-700">{item.name}</p>
                            <p className="text-sm text-slate-500 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {item.time}
                            </p>
                          </div>
                          <Toggle checked={item.enabled} onChange={() => {}} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
                  <button onClick={handleSaveSettings} className="btn-primary w-full">
                    <Save className="w-4 h-4" />
                    Save Notification Settings
                  </button>
                </div>
              </div>
            )}

            {/* Integrations Tab */}
            {activeTab === 'integrations' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    name: 'Toast POS',
                    description: 'Point of Sale Integration',
                    status: 'Connected',
                    statusType: 'success' as const,
                    details: 'Real-time sales sync enabled',
                  },
                  {
                    name: 'Plivo SMS',
                    description: 'SMS Notifications',
                    status: 'Sandbox',
                    statusType: 'warning' as const,
                    details: 'Activate trial for production use',
                  },
                  {
                    name: 'Gmail SMTP',
                    description: 'Email Delivery',
                    status: 'Active',
                    statusType: 'success' as const,
                    details: 'Email notifications configured',
                  },
                  {
                    name: 'Sentry',
                    description: 'Error Monitoring',
                    status: 'Tracking',
                    statusType: 'success' as const,
                    details: 'Performance monitoring enabled',
                  },
                ].map((integration) => (
                  <div
                    key={integration.name}
                    className="bg-white rounded-2xl border border-slate-200/80 shadow-card p-6 hover:shadow-card-hover transition-shadow group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{integration.name}</h3>
                        <p className="text-sm text-slate-500">{integration.description}</p>
                      </div>
                      <span className={`badge-${integration.statusType}`}>
                        {integration.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mb-4">{integration.details}</p>
                    <button className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors group-hover:gap-2">
                      Configure
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      </main>
    </div>
  )
}
