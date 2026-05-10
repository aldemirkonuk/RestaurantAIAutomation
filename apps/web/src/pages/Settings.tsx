import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  Package,
  Ruler,
  Eye,
  Brain,
  MessageSquare,
  Calendar,
  FileText,
  DollarSign,
  Users,
  Wine,
  Shield,
  TrendingDown,
  GraduationCap,
  Calculator,
  ShoppingCart,
  Receipt,
  Gavel,
  Sparkles,
  Mic,
  Image,
  CreditCard,
  Building2,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '../components/layout/Header';
import { settingsApi, FeatureFlags, UpdateFeatureFlagsRequest } from '../services/api/settings';
import { useRestaurantSettingsStore } from '../stores';
import { InviteTeamDialog } from '../components/team/InviteTeamDialog';
import { AddLocationDialog } from '../components/locations/AddLocationDialog';
import { EditLocationChainDialog } from '../components/locations/EditLocationChainDialog';
import { useAuth, type RestaurantBranch } from '../contexts/AuthContext';
import {
  COMMON_POUR_SIZES,
  formatVolumeWithBothUnits,
  isValidPourSize,
} from '../utils/volumeUtils';

interface FeatureFlagItem {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'inventory' | 'procurement' | 'ai' | 'integrations' | 'analytics' | 'operations';
}

const featureFlags: FeatureFlagItem[] = [
  // Inventory
  {
    key: 'enable_inventory_storage_locations',
    label: 'Inventory Storage Locations',
    description: 'Track and manage wine storage locations (Cell A, Cell B, etc.)',
    icon: Package,
    category: 'inventory',
  },
  {
    key: 'enable_invoice_scanning',
    label: 'Invoice Scanning',
    description: 'Scan invoices with OCR to automatically update inventory',
    icon: FileText,
    category: 'inventory',
  },
  {
    key: 'enable_check_scanning',
    label: 'Check Scanning',
    description: 'Scan digital checks for profit margin analysis',
    icon: Receipt,
    category: 'inventory',
  },
  
  // Procurement
  {
    key: 'enable_auto_procurement',
    label: 'Auto Procurement',
    description: 'Automatically initiate orders when stock is low',
    icon: ShoppingCart,
    category: 'procurement',
  },
  {
    key: 'enable_recurring_orders',
    label: 'Recurring Orders',
    description: 'Schedule automatic recurring orders',
    icon: Calendar,
    category: 'procurement',
  },
  {
    key: 'enable_auction_purchases',
    label: 'Auction Purchases',
    description: 'Track wines purchased through auctions',
    icon: Gavel,
    category: 'procurement',
  },
  
  // AI Features
  {
    key: 'enable_ai_negotiation',
    label: 'AI Negotiation',
    description: 'AI-powered supplier negotiation',
    icon: MessageSquare,
    category: 'ai',
  },
  {
    key: 'enable_sommelier_ai',
    label: 'Sommelier AI',
    description: 'AI sommelier for wine recommendations',
    icon: Wine,
    category: 'ai',
  },
  {
    key: 'enable_voice_agent',
    label: 'Voice Agent',
    description: 'Hands-free voice commands for inventory updates',
    icon: Mic,
    category: 'ai',
  },
  {
    key: 'enable_menu_analyzer',
    label: 'Menu Analyzer',
    description: 'Analyze menu photos to add wines to inventory',
    icon: Image,
    category: 'ai',
  },
  {
    key: 'enable_wine_pairing_ai',
    label: 'Wine Pairing AI',
    description: 'AI-powered food and wine pairing recommendations',
    icon: Sparkles,
    category: 'ai',
  },
  
  // Integrations
  {
    key: 'enable_calendar_sync',
    label: 'Calendar Sync',
    description: 'Sync with Google Calendar for events and reminders',
    icon: Calendar,
    category: 'integrations',
  },
  {
    key: 'enable_whatsapp_business',
    label: 'WhatsApp Business',
    description: 'Communicate with suppliers via WhatsApp',
    icon: MessageSquare,
    category: 'integrations',
  },
  {
    key: 'enable_quickbooks_sync',
    label: 'QuickBooks Sync',
    description: 'Sync financial data with QuickBooks',
    icon: CreditCard,
    category: 'integrations',
  },
  
  // Analytics
  {
    key: 'enable_predictive_analytics',
    label: 'Predictive Analytics',
    description: 'Forecast demand and optimize inventory levels',
    icon: Brain,
    category: 'analytics',
  },
  {
    key: 'enable_profit_margin_tracking',
    label: 'Profit Margin Tracking',
    description: 'Track profit margins and financial performance',
    icon: DollarSign,
    category: 'analytics',
  },
  {
    key: 'enable_pour_cost_optimizer',
    label: 'Pour Cost Optimizer',
    description: 'Optimize pour costs and pricing',
    icon: Calculator,
    category: 'analytics',
  },
  
  // Operations
  {
    key: 'enable_visual_verification',
    label: 'Visual Verification',
    description: 'YOLOv8 label recognition and invoice OCR',
    icon: Eye,
    category: 'operations',
  },
  {
    key: 'enable_guest_crm',
    label: 'Guest CRM',
    description: 'Track guest preferences and wine history',
    icon: Users,
    category: 'operations',
  },
  {
    key: 'enable_compliance_autopilot',
    label: 'Compliance Autopilot',
    description: 'Automatic regulatory compliance tracking',
    icon: Shield,
    category: 'operations',
  },
  {
    key: 'enable_shrinkage_detective',
    label: 'Shrinkage Detective',
    description: 'AI-powered loss prevention and anomaly detection',
    icon: TrendingDown,
    category: 'operations',
  },
  {
    key: 'enable_staff_training_simulator',
    label: 'Staff Training Simulator',
    description: 'AI-powered wine education and training',
    icon: GraduationCap,
    category: 'operations',
  },
];

function MeasurementVolumeSection() {
  const {
    measurementUnit,
    defaultPourMl,
    setMeasurementUnit,
    setDefaultPourMl,
  } = useRestaurantSettingsStore();

  const isPreset = COMMON_POUR_SIZES.some((s) => s.ml === defaultPourMl);
  const [customMode, setCustomMode] = useState(!isPreset);
  const [customPourMl, setCustomPourMl] = useState(
    isPreset ? '' : String(defaultPourMl)
  );

  const handlePourSizeChange = (value: string) => {
    if (value === 'custom') {
      setCustomMode(true);
      setCustomPourMl(String(defaultPourMl));
      return;
    }
    const ml = parseInt(value, 10);
    if (Number.isFinite(ml) && isValidPourSize(ml)) {
      setDefaultPourMl(ml);
      setCustomMode(false);
      setCustomPourMl('');
    }
  };

  const handleCustomPourBlur = () => {
    const ml = parseInt(customPourMl, 10);
    if (Number.isFinite(ml) && isValidPourSize(ml)) {
      setDefaultPourMl(ml);
    } else if (customPourMl) {
      setCustomPourMl(String(defaultPourMl));
    }
  };

  const effectivePourMl = customMode
    ? (parseInt(customPourMl, 10) || defaultPourMl)
    : defaultPourMl;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <Ruler className="w-5 h-5 text-wine-600" />
          <h2 className="text-lg font-semibold text-slate-900">Measurement & Volume</h2>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Volume display and default pour preferences
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {/* Volume Display Unit */}
        <div className="px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            Volume Display Unit
          </h3>
          <p className="text-sm text-slate-500 mb-3">
            Choose how volumes are displayed across the app
          </p>
          <div className="flex gap-2">
            {(['ml', 'oz'] as const).map((unit) => (
              <button
                key={unit}
                onClick={() => setMeasurementUnit(unit)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  measurementUnit === unit
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {unit === 'ml' ? 'Metric (ml/L)' : 'US (oz)'}
              </button>
            ))}
          </div>
        </div>

        {/* Default Glass Pour Size */}
        <div className="px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">
            Default Glass Pour Size
          </h3>
          <p className="text-sm text-slate-500 mb-3">
            Standard pour size for by-the-glass wines. Can be overridden per wine.
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={customMode ? 'custom' : String(defaultPourMl)}
              onChange={(e) => handlePourSizeChange(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {COMMON_POUR_SIZES.map((s) => (
                <option key={s.ml} value={String(s.ml)}>
                  {s.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            {customMode && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={500}
                  value={customPourMl}
                  onChange={(e) => setCustomPourMl(e.target.value)}
                  onBlur={handleCustomPourBlur}
                  placeholder="ml"
                  className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <span className="text-sm text-slate-500">ml</span>
              </div>
            )}
            <span className="text-sm text-slate-600 font-medium">
              {formatVolumeWithBothUnits(effectivePourMl)}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const categoryLabels = {
  inventory: 'Inventory Management',
  procurement: 'Procurement & Orders',
  ai: 'AI Features',
  integrations: 'Integrations',
  analytics: 'Analytics & Reporting',
  operations: 'Operations',
};

export default function Settings() {
  const { user, activeRestaurantId, availableRestaurants, refreshBranches } = useAuth();
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [localFlags, setLocalFlags] = useState<FeatureFlags | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const teamInviteAnchorRef = useRef<HTMLButtonElement>(null);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const addLocationAnchorRef = useRef<HTMLButtonElement>(null);
  const [newChainName, setNewChainName] = useState('');
  const [isCreatingChain, setIsCreatingChain] = useState(false);
  const [assignCurrentToChain, setAssignCurrentToChain] = useState(false);
  const [locationsList, setLocationsList] = useState(availableRestaurants);
  const [editingBranch, setEditingBranch] = useState<RestaurantBranch | null>(null);
  const [chainsList, setChainsList] = useState<{ id: string; name: string }[]>([]);

  // Fetch existing chains so they appear even before any location is assigned to them
  useEffect(() => {
    if (user?.role !== 'owner') return;
    const token = localStorage.getItem('accessToken');
    const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';
    fetch(`${API_URL}/api/v1/organizations/chains`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setChainsList(Array.isArray(data) ? data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })) : []))
      .catch(() => {});
  }, [user?.role]);

  // Keep locationsList in sync with context
  useEffect(() => {
    setLocationsList(availableRestaurants);
  }, [availableRestaurants]);

  useEffect(() => {
    loadFeatureFlags();
  }, []);

  const loadFeatureFlags = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getFeatureFlags();
      setFlags(data);
      setLocalFlags(data);
      setHasChanges(false);
    } catch (error: any) {
      console.error('Failed to load feature flags:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (key: keyof FeatureFlags) => {
    if (!localFlags) return;
    
    const updated = {
      ...localFlags,
      [key]: !localFlags[key],
    };
    setLocalFlags(updated);
    setHasChanges(JSON.stringify(updated) !== JSON.stringify(flags));
  };

  const handleSave = async () => {
    if (!localFlags || !flags) return;

    try {
      setSaving(true);
      const updates: UpdateFeatureFlagsRequest = {};
      
      // Only send changed flags
      (Object.keys(localFlags) as Array<keyof FeatureFlags>).forEach((key) => {
        if (localFlags[key] !== flags[key]) {
          updates[key] = localFlags[key];
        }
      });

      const updated = await settingsApi.updateFeatureFlags(updates);
      setFlags(updated);
      setLocalFlags(updated);
      setHasChanges(false);
      toast.success('Settings saved successfully');
    } catch (error: any) {
      console.error('Failed to save feature flags:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (flags) {
      setLocalFlags({ ...flags });
      setHasChanges(false);
    }
  };

  const groupedFlags = featureFlags.reduce((acc, flag) => {
    if (!acc[flag.category]) {
      acc[flag.category] = [];
    }
    acc[flag.category].push(flag);
    return acc;
  }, {} as Record<string, FeatureFlagItem[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-wine-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Settings"
        subtitle="Manage feature flags and system preferences"
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Save Bar */}
        {hasChanges && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-white rounded-xl border border-wine-200 shadow-lg p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-wine-600 rounded-full animate-pulse" />
              <p className="text-sm font-medium text-slate-900">
                You have unsaved changes
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-wine-600 hover:bg-wine-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Team Section */}
        <div className="mb-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-wine-500" />
                Team Members
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">Invite colleagues to join your restaurant on WineOps</p>
            </div>
            {(user?.role === 'owner' || user?.role === 'manager') && (
              <button
                ref={teamInviteAnchorRef}
                type="button"
                onClick={() => setShowInviteDialog(true)}
                className="flex items-center gap-2 px-4 py-2 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Users className="w-4 h-4" />
                Invite Member
              </button>
            )}
          </div>

          <div className="px-6 py-5">
            <div className="text-center py-6 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium text-gray-500">Invite your team</p>
              <p className="text-xs text-gray-400 mt-1">
                Generate invite codes from the button above and share them with your colleagues.
              </p>
            </div>
          </div>
        </div>

        {/* Invite dialog */}
        {activeRestaurantId && (
          <InviteTeamDialog
            open={showInviteDialog}
            onClose={() => setShowInviteDialog(false)}
            restaurantId={activeRestaurantId}
            anchorRef={teamInviteAnchorRef}
          />
        )}

        {/* Locations Section — owner only */}
        {user?.role === 'owner' && (
          <div className="mb-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-wine-500" />
                  Locations &amp; Chains
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">Manage your restaurant locations and group them into chains</p>
              </div>
              <button
                ref={addLocationAnchorRef}
                type="button"
                onClick={() => setShowAddLocation(true)}
                className="flex items-center gap-2 px-4 py-2 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Building2 className="w-4 h-4" />
                Add Location
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {(locationsList.length > 0 || chainsList.length > 0) ? (
                <div className="space-y-3">
                  {/* Chains — sourced from chainsList so 0-location chains appear immediately after creation */}
                  {chainsList.map((chain) => {
                    const chainLocations = locationsList.filter((b) => b.chain_id === chain.id);
                    return (
                      <div key={chain.id} className="border border-gray-100 rounded-xl overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center justify-between">
                          <span>{chain.name}</span>
                          <span className="text-gray-300 font-normal normal-case">{chainLocations.length} location{chainLocations.length !== 1 ? 's' : ''}</span>
                        </div>
                        {chainLocations.length === 0 ? (
                          <div className="px-4 py-3 text-xs text-gray-400 italic">No locations assigned yet — use "Add Location" or edit an existing location.</div>
                        ) : chainLocations.map((branch) => (
                          <div key={branch.id} className="px-4 py-3 flex items-center justify-between border-t border-gray-100 first:border-0">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{branch.name}</p>
                              {branch.city && <p className="text-xs text-gray-400">{branch.city}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              {branch.id === activeRestaurantId && (
                                <span className="text-xs bg-wine-50 text-wine-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                              )}
                              <button onClick={() => setEditingBranch(branch)} className="text-gray-400 hover:text-wine-500 ml-2" title="Edit chain assignment">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {/* Standalone locations (no chain) */}
                  {locationsList.filter((b) => !b.chain_id).length > 0 && (
                    <div className="border border-gray-100 rounded-xl overflow-hidden">
                      {(chainsList.length > 0 || locationsList.filter((b) => !b.chain_id).length > 1) && (
                        <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Standalone Locations
                        </div>
                      )}
                      {locationsList.filter((b) => !b.chain_id).map((branch) => (
                        <div key={branch.id} className="px-4 py-3 flex items-center justify-between border-t border-gray-100 first:border-0">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{branch.name}</p>
                            {branch.city && <p className="text-xs text-gray-400">{branch.city}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            {branch.id === activeRestaurantId && (
                              <span className="text-xs bg-wine-50 text-wine-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                            )}
                            <button onClick={() => setEditingBranch(branch)} className="text-gray-400 hover:text-wine-500 ml-2" title="Edit chain assignment">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No locations yet. Add your first location above.</p>
              )}

              {/* Create Chain inline form */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Create a new chain / brand</p>
                <div className="flex items-center gap-2">
                  <input
                    value={newChainName}
                    onChange={(e) => setNewChainName(e.target.value)}
                    placeholder="e.g. Joe's Pizza"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:outline-none"
                  />
                  <button
                    disabled={!newChainName.trim() || isCreatingChain}
                    onClick={async () => {
                      setIsCreatingChain(true);
                      try {
                        const token = localStorage.getItem('accessToken');
                        const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';
                        const body: Record<string, unknown> = { name: newChainName.trim() };
                        if (assignCurrentToChain && activeRestaurantId) {
                          body.restaurantId = activeRestaurantId;
                        }
                        const resp = await fetch(`${API_URL}/api/v1/organizations/chains`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify(body),
                        });
                        if (!resp.ok) throw new Error('Failed to create chain');
                        const created = await resp.json();
                        toast.success(`Chain "${newChainName}" created!`);
                        setChainsList((prev) => [...prev, { id: created.id, name: created.name }]);
                        setNewChainName('');
                        setAssignCurrentToChain(false);
                        await refreshBranches();
                      } catch {
                        toast.error('Failed to create chain. Please try again.');
                      } finally {
                        setIsCreatingChain(false);
                      }
                    }}
                    className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreatingChain ? 'Creating...' : 'Create Chain'}
                  </button>
                </div>

                {/* "Assign current restaurant" checkbox — only shown when active restaurant is standalone */}
                {(() => {
                  const currentRestaurant = availableRestaurants.find((b) => b.id === activeRestaurantId);
                  if (!currentRestaurant || currentRestaurant.chain_id !== null) return null;
                  return (
                    <div className="mt-2">
                      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={assignCurrentToChain}
                          onChange={(e) => setAssignCurrentToChain(e.target.checked)}
                          className="rounded border-gray-300 text-wine-600"
                        />
                        Move <strong>{currentRestaurant.name}</strong> into this chain
                      </label>
                      {currentRestaurant.chain_name && assignCurrentToChain && (
                        <p className="text-xs text-amber-600 mt-1">
                          Warning: this will move it from &ldquo;{currentRestaurant.chain_name}&rdquo; to the new chain.
                        </p>
                      )}
                    </div>
                  );
                })()}

                <p className="text-xs text-gray-400 mt-1">
                  After creating a chain, new locations added via "Add Location" can be grouped under it.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Add Location dialog */}
        <AddLocationDialog
          open={showAddLocation}
          onClose={() => setShowAddLocation(false)}
          anchorRef={addLocationAnchorRef}
          onLocationAdded={async (location) => {
            toast.success(`${location.name} added!`);
            await refreshBranches();
            setShowAddLocation(false);
          }}
        />

        {/* Edit Location chain assignment dialog */}
        {editingBranch && (
          <EditLocationChainDialog
            branch={editingBranch}
            chains={chainsList}
            open={!!editingBranch}
            onClose={() => setEditingBranch(null)}
            onSaved={async () => {
              await refreshBranches();
              setEditingBranch(null);
            }}
          />
        )}

        {/* Measurement & Volume */}
        <MeasurementVolumeSection />

        {/* Feature Flags by Category */}
        <div className="space-y-6">
          {Object.entries(groupedFlags).map(([category, items]) => (
            <motion.div
              key={category}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                <h2 className="text-lg font-semibold text-slate-900">
                  {categoryLabels[category as keyof typeof categoryLabels]}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {items.length} feature{items.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="divide-y divide-slate-100">
                {items.map((item) => {
                  const Icon = item.icon;
                  const isEnabled = localFlags?.[item.key] ?? false;

                  return (
                    <div
                      key={item.key}
                      className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-start gap-4 flex-1">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          isEnabled ? 'bg-wine-100 text-wine-600' : 'bg-slate-100 text-slate-400'
                        }`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {item.label}
                          </h3>
                          <p className="text-sm text-slate-500 mt-1">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleToggle(item.key)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:ring-offset-2 ${
                          isEnabled ? 'bg-wine-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            isEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Info Box */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6"
        >
          <div className="flex items-start gap-3">
            <SettingsIcon className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-blue-900 mb-1">
                About Feature Flags
              </h3>
              <p className="text-sm text-blue-700">
                Feature flags allow you to enable or disable specific features for your restaurant.
                Disabled features will be hidden from the UI and their functionality will be inactive.
                Changes take effect immediately after saving.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
