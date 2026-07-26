import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, Server, AlertCircle, CheckCircle2, RefreshCw, Clock, X as XCircle } from 'lucide-react'
import { toast } from 'sonner'
import axios from 'axios'

const API_GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface AgentHealth {
  agent_name: string
  version: string
  status: 'active' | 'idle' | 'degraded' | 'error' | 'stopped'
  healthy: boolean
  capabilities: string[]
}

interface HealthResponse {
  agents: AgentHealth[]
  count: number
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  active:   { label: 'Active',   color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  idle:     { label: 'Idle',     color: 'text-blue-600 bg-blue-50 border-blue-200',          icon: Clock },
  degraded: { label: 'Degraded', color: 'text-amber-600 bg-amber-50 border-amber-200',       icon: AlertCircle },
  error:    { label: 'Error',    color: 'text-rose-600 bg-rose-50 border-rose-200',          icon: AlertCircle },
  stopped:  { label: 'Stopped',  color: 'text-slate-600 bg-slate-50 border-slate-200',       icon: Server },
}

export default function AdminHealth() {
  const [agents, setAgents] = useState<AgentHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  /** NEW-549 status filter · NEW-548 per-agent drill-down. */
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'unhealthy'>('all')
  const [detail, setDetail] = useState<{ name: string; data: any; loading: boolean } | null>(null)

  const fetchHealth = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const res = await axios.get<HealthResponse>(`${API_GATEWAY_URL}/api/v1/health/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setAgents(res.data.agents ?? [])
      setLastUpdated(new Date())
    } catch {
      toast.error('Failed to fetch agent health — check api-gateway connection')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000) // Poll every 30s
    return () => clearInterval(interval)
  }, [])

  /** NEW-548: GET /health/agents/:name already existed but nothing called it. */
  const openAgentDetail = async (name: string) => {
    setDetail({ name, data: null, loading: true })
    try {
      const token = localStorage.getItem('accessToken')
      const res = await axios.get(`${API_GATEWAY_URL}/api/v1/health/agents/${name}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      })
      setDetail({ name, data: res.data, loading: false })
    } catch {
      setDetail({ name, data: { error: 'Could not reach this agent.' }, loading: false })
    }
  }

  // NEW-553: `r` refreshes; Esc closes the detail sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape' && detail) { setDetail(null); return }
      if (e.key === 'r' && !detail) { e.preventDefault(); void fetchHealth() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail])

  const visibleAgents = agents.filter((a) =>
    statusFilter === 'all' ? true : statusFilter === 'healthy' ? a.healthy : !a.healthy,
  )

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-indigo-600" />
            <h1 className="text-xl font-bold text-gray-900">Agent Health</h1>
            {agents.length > 0 && (
              <span className="text-sm text-gray-500 font-normal">
                {agents.filter(a => a.healthy).length}/{agents.length} healthy
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* NEW-549: filter by status */}
            {agents.length > 0 && (
              <div className="flex items-center gap-1">
                {([
                  { key: 'all' as const, label: 'All' },
                  { key: 'healthy' as const, label: 'Healthy' },
                  { key: 'unhealthy' as const, label: 'Needs attention' },
                ]).map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      statusFilter === f.key
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            {lastUpdated && (
              <span className="text-xs text-gray-400">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchHealth}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh now"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center min-h-[40vh]">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-gray-500 text-sm">Loading agent health...</p>
            </div>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
            <Server className="w-12 h-12 text-gray-300 mb-4" />
            <h2 className="text-lg font-semibold text-gray-700 mb-1">No agents running</h2>
            <p className="text-gray-400 text-sm max-w-sm">
              The orchestrator has no active agents. Check that the agent-orchestrator service is running on Railway.
            </p>
          </div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {visibleAgents.map((agent) => {
              const statusCfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.stopped
              const StatusIcon = statusCfg.icon
              return (
                <motion.div
                  key={agent.agent_name}
                  variants={itemVariants}
                  role="button"
                  tabIndex={0}
                  onClick={() => openAgentDetail(agent.agent_name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openAgentDetail(agent.agent_name) }}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${agent.healthy ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      <p className="text-sm font-semibold text-gray-900 truncate max-w-[140px]" title={agent.agent_name}>
                        {agent.agent_name.replace(/_agent$/, '').replace(/_/g, ' ')}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${statusCfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">v{agent.version}</div>
                  {agent.capabilities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {agent.capabilities.slice(0, 2).map(cap => (
                        <span key={cap} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {cap.replace(/_/g, ' ')}
                        </span>
                      ))}
                      {agent.capabilities.length > 2 && (
                        <span className="text-xs text-slate-400">+{agent.capabilities.length - 2}</span>
                      )}
                    </div>
                  )}
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </div>

      {/* Per-agent detail (NEW-548 / NEW-552) */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null) }}
        >
          <div className="absolute inset-0 bg-gray-900/40" aria-hidden />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" role="dialog" aria-modal="true">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">
                  {detail.name.replace(/_agent$/, '').replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-gray-400 font-mono truncate">{detail.name}</p>
              </div>
              <button onClick={() => setDetail(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg" aria-label="Close">
                <XCircle className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {detail.loading ? (
                <p className="text-sm text-gray-400">Fetching live health…</p>
              ) : (
                <pre className="text-[11px] leading-relaxed text-gray-700 whitespace-pre-wrap font-mono">
                  {JSON.stringify(detail.data, null, 2)}
                </pre>
              )}
            </div>
            <div className="px-5 py-2.5 border-t border-gray-100 text-[11px] text-gray-400">
              Live payload from <span className="font-mono">GET /health/agents/{detail.name}</span>. Restart control is not exposed by the orchestrator.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
