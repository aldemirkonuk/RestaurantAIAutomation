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
  Check,
  X,
  Activity,
  Server,
  Cpu,
  Clock,
  ChevronRight,
  ExternalLink,
  Wine,
  AlertCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import axios from 'axios'

interface RestaurantSettings {
  buffer_window_minutes: number
  default_threshold_min: number
  enable_auto_procurement: boolean
  enable_visual_verification: boolean
  enable_predictive_analytics: boolean
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
  const [agentStatus, setAgentStatus] = useState<Record<string, { status: 'active' | 'inactive' | 'warning', messages: number | string, avgTime: string, errors: string }>>({})
  const [agentStatusLoading, setAgentStatusLoading] = useState(true)
  const [agentStatusError, setAgentStatusError] = useState<string | null>(null)
  
  const [settings, setSettings] = useState<RestaurantSettings>({
    buffer_window_minutes: 30,
    default_threshold_min: 5,
    enable_auto_procurement: true,
    enable_visual_verification: false,
    enable_predictive_analytics: false,
  })

  // Fetch agent metrics from agent-orchestrator
  useEffect(() => {
    const fetchAgentMetrics = async () => {
      setAgentStatusLoading(true)
      setAgentStatusError(null)
      try {
        const agentOrchestratorUrl = import.meta.env.VITE_AGENT_ORCHESTRATOR_URL || 'http://localhost:8000'
        const response = await axios.get(`${agentOrchestratorUrl}/health/agents`, {
          timeout: 5000,
        })
        
        // Transform the response to match the expected format
        const agents = response.data?.agents || {}
        const transformed: Record<string, { status: 'active' | 'inactive' | 'warning', messages: number | string, avgTime: string, errors: string }> = {}
        
        Object.entries(agents).forEach(([name, data]: [string, any]) => {
          const state = data.state || 'idle'
          transformed[name] = {
            status: state === 'active' ? 'active' : state === 'failed' ? 'inactive' : 'warning',
            messages: data.messages_processed || 0,
            avgTime: data.avg_processing_time_ms ? `${data.avg_processing_time_ms.toFixed(1)}ms` : 'N/A',
            errors: data.error_rate ? `${(data.error_rate * 100).toFixed(2)}%` : '0.00%',
          }
        })
        
        setAgentStatus(transformed)
      } catch (error) {
        console.error('Failed to fetch agent metrics:', error)
        setAgentStatusError('Agent metrics will be available when the monitoring service is connected')
        // Set empty status so UI shows graceful message
        setAgentStatus({})
      } finally {
        setAgentStatusLoading(false)
      }
    }

    if (activeTab === 'agents') {
      fetchAgentMetrics()
    }
  }, [activeTab])

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      toast.success('Settings saved successfully')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleRestartAgent = async (agentName: string) => {
    toast.info(`Restarting ${agentName.replace('_', ' ')}...`)
    await new Promise(resolve => setTimeout(resolve, 2000))
    toast.success(`${agentName.replace('_', ' ')} restarted successfully`)
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
                <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center">
                  <Wine className="w-5 h-5 text-white" />
                </div>
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
                    {[
                      { name: 'Database', desc: 'Supabase PostgreSQL', icon: Database, status: 'Connected' },
                      { name: 'Message Queue', desc: 'RabbitMQ', icon: Server, status: 'Active' },
                      { name: 'Cache', desc: 'Redis', icon: Cpu, status: 'Running' },
                      { name: 'AI Engine', desc: 'Gemini Pro', icon: Zap, status: 'Ready' },
                    ].map((service) => (
                      <div
                        key={service.name}
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 bg-success-500 rounded-full animate-pulse-soft" />
                          <div>
                            <p className="font-medium text-slate-900">{service.name}</p>
                            <p className="text-sm text-slate-500">{service.desc}</p>
                          </div>
                        </div>
                        <span className="badge-success">{service.status}</span>
                      </div>
                    ))}
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
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">Agent Metrics Unavailable</h3>
                      <p className="text-sm text-slate-500 max-w-md">
                        {agentStatusError || 'Agent metrics will be available when the monitoring service is connected'}
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
                              typeof data.errors === 'string' && parseFloat(data.errors) > 0.1 ? 'text-warning-600' : 'text-success-600'
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
