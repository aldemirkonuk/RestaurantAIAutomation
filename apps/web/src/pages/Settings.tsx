import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  Search,
  MoreHorizontal,
  Trash2,
  Link2,
  Check,
  Copy,
  ChefHat,
} from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '../components/layout/Header';
import { settingsApi, FeatureFlags, UpdateFeatureFlagsRequest } from '../services/api/settings';
import { useRestaurantSettingsStore } from '../stores';
import { InviteTeamDialog } from '../components/team/InviteTeamDialog';
import { TeamLaborSettings } from '../components/team/TeamLaborSettings';
import { TeamGoalsSettings } from '../components/team/TeamGoalsSettings';
import { EmailSenderSettings } from '../components/settings/EmailSenderSettings';
import { NotificationsSection } from '../components/settings/NotificationsSection';
import { IntegrationsAuth } from '../components/settings/IntegrationsAuth';
import { AddLocationDialog } from '../components/locations/AddLocationDialog';
import { EditLocationChainDialog } from '../components/locations/EditLocationChainDialog';
import { CreateChainDialog } from '../components/locations/CreateChainDialog';
import { AssignToChainDialog } from '../components/locations/AssignToChainDialog';
import { useAuth, type RestaurantBranch } from '../contexts/AuthContext';
import {
  COMMON_POUR_SIZES,
  formatVolumeWithBothUnits,
  isValidPourSize,
} from '../utils/volumeUtils';
import { cn } from '../lib/utils';
import { ServicesPermissions } from '../components/settings/ServicesPermissions';

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000';

interface TeamMemberRow {
  user_id: string;
  role: string;
  users: { name?: string; email?: string } | null;
}

interface PendingInviteRow {
  id: string;
  code: string;
  role: string;
  expires_at: string;
}

// ─── Section nav ─────────────────────────────────────────────────────────────

const SECTION_IDS = ['team', 'services', 'email', 'notifications', 'locations', 'measurement', 'features', 'calendar'] as const;
type SectionId = (typeof SECTION_IDS)[number];
const SECTION_LABELS: Record<SectionId, string> = {
  team: 'Team',
  services: 'Services',
  email: 'Email',
  notifications: 'Notifications',
  locations: 'Locations',
  measurement: 'Measurement',
  features: 'Features',
  calendar: 'Calendar',
};

// ─── Feature flag definitions ─────────────────────────────────────────────────

interface FeatureFlagItem {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'inventory' | 'procurement' | 'ai' | 'integrations' | 'analytics' | 'operations';
}

const featureFlags: FeatureFlagItem[] = [
  { key: 'enable_inventory_storage_locations', label: 'Inventory Storage Locations', description: 'Track and manage wine storage locations (Cell A, Cell B, etc.)', icon: Package, category: 'inventory' },
  { key: 'enable_invoice_scanning', label: 'Invoice Scanning', description: 'Scan invoices with OCR to automatically update inventory', icon: FileText, category: 'inventory' },
  { key: 'enable_check_scanning', label: 'Check Scanning', description: 'Scan digital checks for profit margin analysis', icon: Receipt, category: 'inventory' },
  { key: 'enable_auto_procurement', label: 'Auto Procurement', description: 'Automatically initiate orders when stock is low', icon: ShoppingCart, category: 'procurement' },
  { key: 'enable_recurring_orders', label: 'Recurring Orders', description: 'Schedule automatic recurring orders', icon: Calendar, category: 'procurement' },
  { key: 'enable_auction_purchases', label: 'Auction Purchases', description: 'Track wines purchased through auctions', icon: Gavel, category: 'procurement' },
  { key: 'enable_ai_negotiation', label: 'AI Negotiation', description: 'AI-powered supplier negotiation', icon: MessageSquare, category: 'ai' },
  { key: 'enable_sommelier_ai', label: 'Sommelier AI', description: 'AI sommelier for wine recommendations', icon: Wine, category: 'ai' },
  { key: 'enable_voice_agent', label: 'Voice Agent', description: 'Hands-free voice commands for inventory updates', icon: Mic, category: 'ai' },
  { key: 'enable_menu_analyzer', label: 'Menu Analyzer', description: 'Analyze menu photos to add wines to inventory', icon: Image, category: 'ai' },
  { key: 'enable_wine_pairing_ai', label: 'Wine Pairing AI', description: 'AI-powered food and wine pairing recommendations', icon: Sparkles, category: 'ai' },
  { key: 'enable_calendar_sync', label: 'Calendar Sync', description: 'Sync with Google Calendar for events and reminders', icon: Calendar, category: 'integrations' },
  { key: 'enable_whatsapp_business', label: 'WhatsApp Business', description: 'Communicate with suppliers via WhatsApp', icon: MessageSquare, category: 'integrations' },
  { key: 'enable_quickbooks_sync', label: 'QuickBooks Sync', description: 'Sync financial data with QuickBooks', icon: CreditCard, category: 'integrations' },
  { key: 'enable_predictive_analytics', label: 'Predictive Analytics', description: 'Forecast demand and optimize inventory levels', icon: Brain, category: 'analytics' },
  { key: 'enable_profit_margin_tracking', label: 'Profit Margin Tracking', description: 'Track profit margins and financial performance', icon: DollarSign, category: 'analytics' },
  { key: 'enable_pour_cost_optimizer', label: 'Pour Cost Optimizer', description: 'Optimize pour costs and pricing', icon: Calculator, category: 'analytics' },
  { key: 'enable_visual_verification', label: 'Visual Verification', description: 'YOLOv8 label recognition and invoice OCR', icon: Eye, category: 'operations' },
  { key: 'enable_guest_crm', label: 'Guest CRM', description: 'Track guest preferences and wine history', icon: Users, category: 'operations' },
  { key: 'enable_compliance_autopilot', label: 'Compliance Autopilot', description: 'Automatic regulatory compliance tracking', icon: Shield, category: 'operations' },
  { key: 'enable_shrinkage_detective', label: 'Shrinkage Detective', description: 'AI-powered loss prevention and anomaly detection', icon: TrendingDown, category: 'operations' },
  { key: 'enable_staff_training_simulator', label: 'Staff Training Simulator', description: 'AI-powered wine education and training', icon: GraduationCap, category: 'operations' },
];

const categoryLabels: Record<string, string> = {
  inventory: 'Inventory',
  procurement: 'Procurement',
  ai: 'AI Features',
  integrations: 'Integrations',
  analytics: 'Analytics',
  operations: 'Operations',
};

// ─── Calendar subscription section ───────────────────────────────────────────

function CalendarSubscriptionSection() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const fullFeedUrl = token
    ? `${window.location.origin}/api/v1/calendar/feed/${token}.ics`
    : null;

  useEffect(() => {
    fetchToken();
  }, []);

  async function fetchToken() {
    try {
      const accessToken = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/api/v1/calendar/ical-token`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch token');
      const data = await res.json();
      setToken(data.token);
    } catch {
      // silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    if (!confirm('Regenerating the token will break all existing calendar subscriptions. Continue?')) return;
    setRegenerating(true);
    try {
      const accessToken = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/api/v1/calendar/ical-token/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to regenerate token');
      const data = await res.json();
      setToken(data.token);
      toast.success('Token regenerated. Update your calendar subscription URL.');
    } catch {
      toast.error('Failed to regenerate token');
    } finally {
      setRegenerating(false);
    }
  }

  async function handleCopy() {
    if (!fullFeedUrl) return;
    try {
      await navigator.clipboard.writeText(fullFeedUrl);
      toast.success('Subscription URL copied to clipboard');
    } catch {
      toast.error('Failed to copy URL');
    }
  }

  if (loading) return <div className="py-4 text-sm text-gray-500">Loading subscription URL...</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Subscribe to your WineOps calendar in Outlook, Apple Calendar, or Google Calendar using the URL below. No login required — the URL includes a secure token.
      </p>
      {fullFeedUrl && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 font-mono truncate">
            {fullFeedUrl}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-3 py-2 text-xs bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors"
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
        </div>
      )}
      <div className="text-xs text-gray-500 space-y-1">
        <p><strong>Outlook:</strong> Add Calendar → Subscribe from web → paste URL</p>
        <p><strong>Apple Calendar:</strong> File → New Calendar Subscription → paste URL</p>
        <p><strong>Google Calendar:</strong> Other Calendars (+) → From URL → paste URL</p>
      </div>
      <div className="pt-2 border-t border-gray-100">
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="flex items-center gap-1 px-3 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Regenerating...' : 'Regenerate Token'}
        </button>
        <p className="mt-1 text-xs text-gray-400">Warning: regenerating invalidates all existing subscriptions.</p>
      </div>
    </div>
  );
}

// ─── Measurement section ──────────────────────────────────────────────────────

function MeasurementVolumeSection() {
  const { measurementUnit, defaultPourMl, setMeasurementUnit, setDefaultPourMl } =
    useRestaurantSettingsStore();

  const isPreset = COMMON_POUR_SIZES.some((s) => s.ml === defaultPourMl);
  const [customMode, setCustomMode] = useState(!isPreset);
  const [customPourMl, setCustomPourMl] = useState(isPreset ? '' : String(defaultPourMl));

  const handlePourSizeChange = (value: string) => {
    if (value === 'custom') { setCustomMode(true); setCustomPourMl(String(defaultPourMl)); return; }
    const ml = parseInt(value, 10);
    if (Number.isFinite(ml) && isValidPourSize(ml)) { setDefaultPourMl(ml); setCustomMode(false); setCustomPourMl(''); }
  };

  const handleCustomPourBlur = () => {
    const ml = parseInt(customPourMl, 10);
    if (Number.isFinite(ml) && isValidPourSize(ml)) setDefaultPourMl(ml);
    else if (customPourMl) setCustomPourMl(String(defaultPourMl));
  };

  const effectivePourMl = customMode ? (parseInt(customPourMl, 10) || defaultPourMl) : defaultPourMl;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 flex items-center gap-2 border-b border-gray-100">
        <Ruler className="w-4 h-4 text-wine-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Measurement &amp; Volume</h2>
          <p className="text-xs text-gray-400 mt-0.5">Volume display and default pour preferences</p>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        <div className="px-6 py-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Display unit</p>
          <div className="flex gap-2">
            {(['ml', 'oz'] as const).map((unit) => (
              <button
                key={unit}
                onClick={() => setMeasurementUnit(unit)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  measurementUnit === unit
                    ? 'bg-wine-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                )}
              >
                {unit === 'ml' ? 'Metric (ml/L)' : 'US (oz)'}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Default glass pour</p>
          <p className="text-xs text-gray-400 mb-3">Can be overridden per wine</p>
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={customMode ? 'custom' : String(defaultPourMl)}
              onChange={(e) => handlePourSizeChange(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
            >
              {COMMON_POUR_SIZES.map((s) => (
                <option key={s.ml} value={String(s.ml)}>{s.label}</option>
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
                  className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
                />
                <span className="text-xs text-gray-400">ml</span>
              </div>
            )}
            <span className="text-sm text-gray-500">{formatVolumeWithBothUnits(effectivePourMl)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipesSection() {
  const {
    recipesEnabled,
    recipeYieldUnit,
    measurementUnit,
    setRecipesEnabled,
    setRecipeYieldUnit,
  } = useRestaurantSettingsStore();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mt-3">
      <div className="px-6 py-4 flex items-center gap-2 border-b border-gray-100">
        <ChefHat className="w-4 h-4 text-wine-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Recipes</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Cocktail and by-the-glass recipes tied to bottle pours
          </p>
        </div>
      </div>
      <div className="divide-y divide-gray-50">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Enable recipes</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Track recipe yields and deduct pours from inventory
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={recipesEnabled}
            onClick={() => setRecipesEnabled(!recipesEnabled)}
            className={cn(
              'relative w-11 h-6 rounded-full transition-colors',
              recipesEnabled ? 'bg-wine-600' : 'bg-gray-200',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                recipesEnabled && 'translate-x-5',
              )}
            />
          </button>
        </div>
        {recipesEnabled && (
          <div className="px-6 py-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Default recipe yield unit</p>
            <div className="flex gap-2">
              {(['ml', 'oz'] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setRecipeYieldUnit(unit)}
                  className={cn(
                    'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    recipeYieldUnit === unit
                      ? 'bg-wine-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                  )}
                >
                  {unit === 'ml' ? 'Metric (ml)' : 'US (oz)'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Display unit is currently {measurementUnit}. Recipe yields can use a different unit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chain tree node (wine dot + inline rename + ⋯ menu) ─────────────────────

interface ChainTreeNodeProps {
  chain: { id: string; name: string };
  locationCount: number;
  onRenamed: (id: string, newName: string) => void;
  onDeleted: (id: string) => void;
}

function ChainTreeNode({ chain, locationCount, onRenamed, onDeleted }: ChainTreeNodeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState(chain.name);
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const handleRename = async () => {
    if (!draftName.trim() || draftName.trim() === chain.name) { setRenaming(false); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('accessToken');
      const resp = await fetch(`${API_URL}/api/v1/organizations/chains/${chain.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: draftName.trim() }),
      });
      if (!resp.ok) throw new Error();
      onRenamed(chain.id, draftName.trim());
      toast.success('Chain renamed');
    } catch {
      toast.error('Could not rename chain');
      setDraftName(chain.name);
    } finally {
      setSaving(false);
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('accessToken');
      const resp = await fetch(`${API_URL}/api/v1/organizations/chains/${chain.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error();
      onDeleted(chain.id);
      toast.success(`"${chain.name}" deleted`);
    } catch {
      toast.error('Could not delete chain');
    } finally {
      setSaving(false);
      setMenuOpen(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {/* Tree root dot */}
        <div className="w-2.5 h-2.5 rounded-full bg-wine-500 ring-2 ring-wine-100 shrink-0" />
        {renaming ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') { setRenaming(false); setDraftName(chain.name); }
              }}
              onBlur={handleRename}
              className="flex-1 px-2 py-1 text-sm font-semibold text-gray-700 border border-wine-300 rounded-lg focus:ring-2 focus:ring-wine-500 outline-none bg-white"
            />
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />}
          </div>
        ) : (
          <span className="text-sm font-semibold text-gray-700 truncate">{chain.name}</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-gray-300">
          {locationCount} {locationCount === 1 ? 'location' : 'locations'}
        </span>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => { setMenuOpen((o) => !o); setConfirmDelete(false); }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-7 z-20 bg-white border border-gray-100 rounded-xl shadow-md py-1 w-40"
              >
                {!confirmDelete ? (
                  <>
                    <button
                      onClick={() => { setRenaming(true); setMenuOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Pencil className="w-3.5 h-3.5 text-gray-400" />
                      Rename
                    </button>
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete chain
                    </button>
                  </>
                ) : (
                  <div className="px-3 py-2 space-y-2">
                    <p className="text-xs text-gray-500">
                      {locationCount > 0
                        ? `${locationCount} location${locationCount !== 1 ? 's' : ''} will become standalone.`
                        : 'Are you sure?'}
                    </p>
                    <button
                      onClick={handleDelete}
                      disabled={saving}
                      className="w-full py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="w-full py-1 text-xs text-gray-400 hover:text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── Tree location row (dot + connector + content) ────────────────────────────

function TreeLocationRow({
  branch,
  isActive,
  onEdit,
}: {
  branch: RestaurantBranch;
  isActive: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center group py-0.5">
      {/* Horizontal connector from vertical tree line */}
      <div className="w-5 border-t border-gray-200 shrink-0 -ml-px" />
      {/* Small leaf dot */}
      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
      {/* Content */}
      <div className="flex-1 ml-2.5 flex items-center justify-between rounded-xl px-2.5 py-1.5 hover:bg-gray-50/80 transition-colors">
        <div>
          <p className="text-sm font-medium text-gray-800">{branch.name}</p>
          {branch.city && <p className="text-xs text-gray-400 mt-0.5">{branch.city}</p>}
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="flex items-center gap-1 text-xs bg-wine-50 text-wine-600 px-2 py-0.5 rounded-full font-medium">
              <Check className="w-3 h-3" />
              Active
            </span>
          )}
          <button
            onClick={onEdit}
            className="text-gray-300 hover:text-wine-500 opacity-0 group-hover:opacity-100 transition-all"
            title="Edit location"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings page ───────────────────────────────────────────────────────

export default function Settings() {
  const { user, activeRestaurantId, activeRole, availableRestaurants, refreshBranches } = useAuth();
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [localFlags, setLocalFlags] = useState<FeatureFlags | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const teamInviteAnchorRef = useRef<HTMLButtonElement>(null);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showCreateChain, setShowCreateChain] = useState(false);
  const addLocationAnchorRef = useRef<HTMLButtonElement>(null);
  const [locationsList, setLocationsList] = useState(availableRestaurants);
  const [editingBranch, setEditingBranch] = useState<RestaurantBranch | null>(null);
  const [chainsList, setChainsList] = useState<{ id: string; name: string }[]>([]);
  const [assigningToChain, setAssigningToChain] = useState<{ id: string; name: string } | null>(null);
  const [flagSearch, setFlagSearch] = useState('');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialSection =
    tabParam && (SECTION_IDS as readonly string[]).includes(tabParam)
      ? (tabParam as SectionId)
      : 'team';
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  const effectiveRole = activeRole ?? user?.role ?? null;

  // Deep-link: /settings?tab=services|team|...
  useEffect(() => {
    if (tabParam && (SECTION_IDS as readonly string[]).includes(tabParam)) {
      const id = tabParam as SectionId;
      setActiveSection(id);
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [tabParam]);

  // Scrollspy: highlight whichever section's top is nearest the sticky bar
  useEffect(() => {
    const OFFSET = 120; // header (64px) + tab bar (~44px) + buffer
    const handleScroll = () => {
      const reversed = [...SECTION_IDS].reverse() as SectionId[];
      for (const id of reversed) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= OFFSET) {
          setActiveSection(id);
          return;
        }
      }
      setActiveSection('team');
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: SectionId) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loadTeam = useCallback(async () => {
    if (!activeRestaurantId) {
      setTeamMembers([]);
      setPendingInvites([]);
      return;
    }
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    setTeamLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const memRes = await fetch(
        `${API_URL}/api/v1/restaurants/${activeRestaurantId}/members`,
        { headers },
      );
      const members = memRes.ok ? await memRes.json() : [];
      setTeamMembers(Array.isArray(members) ? members : []);

      const canSeeInvites = effectiveRole === 'owner' || effectiveRole === 'manager';
      if (canSeeInvites) {
        const invRes = await fetch(
          `${API_URL}/api/v1/restaurants/${activeRestaurantId}/invites`,
          { headers },
        );
        const invites = invRes.ok ? await invRes.json() : [];
        setPendingInvites(Array.isArray(invites) ? invites : []);
      } else {
        setPendingInvites([]);
      }
    } catch {
      toast.error('Failed to load team');
    } finally {
      setTeamLoading(false);
    }
  }, [activeRestaurantId, effectiveRole]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const handleUpdateMemberRole = async (
    memberUserId: string,
    newRole: 'owner' | 'manager' | 'staff',
  ) => {
    if (!activeRestaurantId) return;
    try {
      const token = localStorage.getItem('accessToken');
      const resp = await fetch(
        `${API_URL}/api/v1/restaurants/${activeRestaurantId}/members/${memberUserId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ role: newRole }),
        },
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.message || 'Could not update role');
      }
      toast.success('Role updated');
      await loadTeam();
      await refreshBranches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update role');
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!activeRestaurantId) return;
    const isSelf = memberUserId === user?.userId;
    if (
      !confirm(
        isSelf
          ? 'Leave this restaurant? You will need a new invite to access it again.'
          : 'Remove this member from this restaurant?',
      )
    ) {
      return;
    }
    try {
      const token = localStorage.getItem('accessToken');
      const resp = await fetch(
        `${API_URL}/api/v1/restaurants/${activeRestaurantId}/members/${memberUserId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.message || 'Could not remove member');
      }
      toast.success(isSelf ? 'You left this restaurant' : 'Member removed');
      await loadTeam();
      await refreshBranches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove member');
    }
  };

  const handleRevokeInvite = async (code: string) => {
    if (!activeRestaurantId || !confirm('Revoke this invite link?')) return;
    try {
      const token = localStorage.getItem('accessToken');
      const resp = await fetch(
        `${API_URL}/api/v1/restaurants/${activeRestaurantId}/invites/${encodeURIComponent(code)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.message || 'Could not revoke invite');
      }
      toast.success('Invite revoked');
      await loadTeam();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not revoke invite');
    }
  };

  useEffect(() => {
    if (user?.role !== 'owner') return;
    const token = localStorage.getItem('accessToken');
    fetch(`${API_URL}/api/v1/organizations/chains`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setChainsList(Array.isArray(data) ? data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })) : []))
      .catch(() => {});
  }, [user?.role]);

  useEffect(() => { setLocationsList(availableRestaurants); }, [availableRestaurants]);
  useEffect(() => { loadFeatureFlags(); }, []);

  const loadFeatureFlags = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getFeatureFlags();
      setFlags(data);
      setLocalFlags(data);
      setHasChanges(false);
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (key: keyof FeatureFlags) => {
    if (!localFlags) return;
    const updated = { ...localFlags, [key]: !localFlags[key] };
    setLocalFlags(updated);
    setHasChanges(JSON.stringify(updated) !== JSON.stringify(flags));
  };

  const handleSave = async () => {
    if (!localFlags || !flags) return;
    try {
      setSaving(true);
      const updates: UpdateFeatureFlagsRequest = {};
      (Object.keys(localFlags) as Array<keyof FeatureFlags>).forEach((key) => {
        if (localFlags[key] !== flags[key]) updates[key] = localFlags[key];
      });
      const updated = await settingsApi.updateFeatureFlags(updates);
      setFlags(updated);
      setLocalFlags(updated);
      setHasChanges(false);
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (flags) { setLocalFlags({ ...flags }); setHasChanges(false); }
  };

  const q = flagSearch.toLowerCase();
  const groupedFlags = featureFlags
    .filter((f) => !q || f.label.toLowerCase().includes(q) || f.description.toLowerCase().includes(q))
    .reduce((acc, flag) => {
      if (!acc[flag.category]) acc[flag.category] = [];
      acc[flag.category].push(flag);
      return acc;
    }, {} as Record<string, FeatureFlagItem[]>);

  const chainsWithCounts = chainsList.map((chain) => ({
    ...chain,
    locationCount: locationsList.filter((b) => b.chain_id === chain.id).length,
  }));

  const editingChains = chainsList.map((c) => ({
    ...c,
    locationCount: locationsList.filter((b) => b.chain_id === c.id).length,
  }));

  const standaloneLocations = locationsList.filter((b) => !b.chain_id);

  const formatRoleLabel = (role: string) =>
    role ? role.charAt(0).toUpperCase() + role.slice(1) : '';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-6 h-6 animate-spin text-wine-500 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading settings…</p>
        </div>
      </div>
    );
  }

  // Staff (waiter) — restaurant ops Settings are manager/owner only
  const isStaffOnly = effectiveRole === 'staff';
  if (isStaffOnly) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header title="Settings" subtitle="Restaurant settings are managed by your manager" />
        <div className="max-w-lg mx-auto px-6 py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gray-100 flex items-center justify-center">
            <SettingsIcon className="w-7 h-7 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Ask a manager</h2>
          <p className="text-sm text-gray-500 mb-8">
            Team, locations, feature flags, and other restaurant settings can only be changed by
            managers or owners. You can still manage your personal account.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/profile"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-wine-600 text-white text-sm font-medium hover:bg-wine-700"
            >
              Open Profile
            </Link>
            <Link
              to="/help"
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-white"
            >
              Help & Support
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header title="Settings" subtitle="Manage features and preferences" />

      {/* ── Sticky section anchor tabs ── */}
      <div className="sticky top-16 z-20 bg-white/92 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex gap-0.5 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SECTION_IDS.map((id) => (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150',
                  activeSection === id
                    ? 'bg-wine-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
                )}
              >
                {SECTION_LABELS[id]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Unsaved changes bar */}
        <AnimatePresence>
          {hasChanges && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3.5 flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 bg-wine-500 rounded-full animate-pulse" />
                <p className="text-sm text-gray-700">Unsaved changes</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-wine-600 hover:bg-wine-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Team ── */}
        <div id="team" className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-50">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-wine-500" />
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Team</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Members at this branch
                  {effectiveRole ? (
                    <>
                      <span className="text-gray-300"> · Your role: </span>
                      <span className="text-wine-600 font-medium">{formatRoleLabel(effectiveRole)}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            {(effectiveRole === 'owner' || effectiveRole === 'manager') && (
              <button
                ref={teamInviteAnchorRef}
                type="button"
                onClick={() => setShowInviteDialog(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                Invite
              </button>
            )}
          </div>
          <div className="px-6 py-5">
            {activeRestaurantId && (effectiveRole === 'owner' || effectiveRole === 'manager') && (
              <>
                <TeamLaborSettings />
                <TeamGoalsSettings />
              </>
            )}
            {!activeRestaurantId ? (
              <p className="text-sm text-gray-500 text-center py-6">
                Select a branch from the header to view and manage team members.
              </p>
            ) : teamLoading ? (
              <div className="flex justify-center py-10">
                <RefreshCw className="w-6 h-6 animate-spin text-wine-500" />
              </div>
            ) : teamMembers.length === 0 && pendingInvites.length === 0 ? (
              <div className="flex flex-col items-center text-center py-6">
                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mb-3">
                  <Users className="w-5 h-5 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-500">No team members yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Invite colleagues using the button above.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Members</h3>
                  <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                    {teamMembers.map((m) => {
                      const displayName =
                        m.users?.name?.trim() || m.users?.email || 'Team member';
                      const subtitle =
                        m.users?.name?.trim() && m.users?.email ? m.users.email : null;
                      const isSelf = m.user_id === user?.userId;
                      const canEditRole = effectiveRole === 'owner';
                      const showRemove = isSelf || effectiveRole === 'owner';

                      return (
                        <li
                          key={m.user_id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-white hover:bg-gray-50/80"
                        >
                          <div className="min-w-0 text-left">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {displayName}
                              {isSelf && (
                                <span className="ml-2 text-xs font-normal text-wine-600">(you)</span>
                              )}
                            </p>
                            {subtitle && (
                              <p className="text-xs text-gray-500 truncate">{subtitle}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {canEditRole ? (
                              <select
                                value={m.role}
                                onChange={(e) =>
                                  void handleUpdateMemberRole(
                                    m.user_id,
                                    e.target.value as 'owner' | 'manager' | 'staff',
                                  )
                                }
                                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-800"
                              >
                                <option value="owner">Owner</option>
                                <option value="manager">Manager</option>
                                <option value="staff">Staff</option>
                              </select>
                            ) : (
                              <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-lg capitalize">
                                {m.role}
                              </span>
                            )}
                            {showRemove && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveMember(m.user_id)}
                                className={cn(
                                  'text-xs font-medium px-2 py-1.5 rounded-lg border transition-colors',
                                  isSelf
                                    ? 'border-gray-200 text-gray-600 hover:bg-gray-100'
                                    : 'border-rose-200 text-rose-600 hover:bg-rose-50',
                                )}
                              >
                                {isSelf ? 'Leave' : 'Remove'}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {pendingInvites.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Pending invites
                    </h3>
                    <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                      {pendingInvites.map((inv) => (
                        <li
                          key={inv.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 bg-white"
                        >
                          <div className="min-w-0 text-left">
                            <p className="text-sm font-mono text-gray-800 truncate">{inv.code}</p>
                            <p className="text-xs text-gray-500 capitalize">
                              {inv.role} · expires{' '}
                              {new Date(inv.expires_at).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRevokeInvite(inv.code)}
                            className="text-xs font-medium px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 self-start sm:self-center"
                          >
                            Revoke
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {activeRestaurantId && (
          <InviteTeamDialog
            open={showInviteDialog}
            onClose={() => {
              setShowInviteDialog(false);
              void loadTeam();
            }}
            restaurantId={activeRestaurantId}
            anchorRef={teamInviteAnchorRef}
          />
        )}

        {/* ── Services & permissions ── */}
        <div id="services" className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-6">
          <ServicesPermissions />
        </div>

        {/* ── Email sign-off ── */}
        <EmailSenderSettings />

        {/* ── Notifications ── */}
        <div id="notifications" className="scroll-mt-32">
          <NotificationsSection />
        </div>

        {/* ── Locations & Chains — owner only ── */}
        {user?.role === 'owner' && (
          <div id="locations" className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-50">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-wine-500" />
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Locations &amp; Chains</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Manage locations and group them into brands</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateChain(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-xl transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  New chain
                </button>
                <button
                  ref={addLocationAnchorRef}
                  type="button"
                  onClick={() => setShowAddLocation(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Add location
                </button>
              </div>
            </div>

            {/* Tree body */}
            <div className="py-2">
              {locationsList.length === 0 && chainsList.length === 0 ? (
                <div className="px-6 py-8 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mb-3">
                    <Building2 className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-500">No locations yet</p>
                  <p className="text-xs text-gray-400 mt-1">Add your first location to get started.</p>
                </div>
              ) : (
                <>
                  {/* Chain groups with tree connectors */}
                  {chainsWithCounts.map((chain, idx) => {
                    const chainLocations = locationsList.filter((b) => b.chain_id === chain.id);
                    return (
                      <div
                        key={chain.id}
                        className={cn('px-5 py-3', idx > 0 && 'border-t border-gray-50')}
                      >
                        <ChainTreeNode
                          chain={chain}
                          locationCount={chain.locationCount}
                          onRenamed={(id, name) =>
                            setChainsList((prev) => prev.map((c) => c.id === id ? { ...c, name } : c))
                          }
                          onDeleted={(id) => {
                            setChainsList((prev) => prev.filter((c) => c.id !== id));
                            refreshBranches();
                          }}
                        />
                        {/* Vertical tree line + children */}
                        <div className="ml-[5px] border-l-2 border-gray-100 mt-2 pb-0.5">
                          {chainLocations.length === 0 ? (
                            <div className="flex items-center py-1.5 -ml-px">
                              <div className="w-5 border-t border-gray-200 shrink-0" />
                              <span className="text-xs text-gray-400 italic ml-2">No locations yet.</span>
                              <button
                                onClick={() => setAssigningToChain({ id: chain.id, name: chain.name })}
                                className="text-xs text-wine-500 font-medium ml-1.5 hover:text-wine-700 transition-colors"
                              >
                                Add one →
                              </button>
                            </div>
                          ) : (
                            chainLocations.map((branch) => (
                              <TreeLocationRow
                                key={branch.id}
                                branch={branch}
                                isActive={branch.id === activeRestaurantId}
                                onEdit={() => setEditingBranch(branch)}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Standalone locations */}
                  {standaloneLocations.length > 0 && (
                    <div className={cn(chainsWithCounts.length > 0 && 'border-t border-gray-50')}>
                      {chainsList.length > 0 && (
                        <div className="px-5 py-2.5 flex items-center gap-3">
                          <div className="flex-1 h-px bg-gray-100" />
                          <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
                            Standalone
                          </span>
                          <div className="flex-1 h-px bg-gray-100" />
                        </div>
                      )}
                      {standaloneLocations.map((branch) => (
                        <div
                          key={branch.id}
                          className="px-5 py-2.5 flex items-center justify-between hover:bg-gray-50/60 group border-t border-gray-50 first:border-0 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-800">{branch.name}</p>
                            {branch.city && <p className="text-xs text-gray-400 mt-0.5">{branch.city}</p>}
                          </div>
                          <div className="flex items-center gap-2.5">
                            {branch.id === activeRestaurantId && (
                              <span className="flex items-center gap-1 text-xs bg-wine-50 text-wine-600 px-2 py-0.5 rounded-full font-medium">
                                <Check className="w-3 h-3" />
                                Active
                              </span>
                            )}
                            <button
                              onClick={() => setEditingBranch(branch)}
                              className="text-gray-300 hover:text-wine-500 opacity-0 group-hover:opacity-100 transition-all"
                              title="Edit location"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Dialogs */}
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

        <CreateChainDialog
          open={showCreateChain}
          onClose={() => setShowCreateChain(false)}
          onCreated={(chain) => {
            setChainsList((prev) => [...prev, chain]);
            refreshBranches();
          }}
          standaloneLocations={standaloneLocations.map((b) => ({ id: b.id, name: b.name, city: b.city ?? null }))}
        />

        {assigningToChain && (
          <AssignToChainDialog
            open={!!assigningToChain}
            chainId={assigningToChain.id}
            chainName={assigningToChain.name}
            standaloneLocations={standaloneLocations.map((b) => ({ id: b.id, name: b.name, city: b.city ?? null }))}
            onClose={() => setAssigningToChain(null)}
            onSaved={async () => { await refreshBranches(); setAssigningToChain(null); }}
            onCreateNew={() => { setAssigningToChain(null); setShowAddLocation(true); }}
          />
        )}

        {editingBranch && (
          <EditLocationChainDialog
            branch={editingBranch}
            chains={editingChains}
            open={!!editingBranch}
            onClose={() => setEditingBranch(null)}
            onSaved={async () => {
              await refreshBranches();
              setEditingBranch(null);
            }}
          />
        )}

        {/* ── Measurement ── */}
        <div id="measurement" className="scroll-mt-32">
          <MeasurementVolumeSection />
          <RecipesSection />
        </div>

        {/* ── Feature Flags ── */}
        <div id="features" className="scroll-mt-32 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
            <input
              value={flagSearch}
              onChange={(e) => setFlagSearch(e.target.value)}
              placeholder="Search features…"
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 rounded-2xl text-sm text-gray-700 shadow-sm placeholder-gray-300 focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all"
            />
            {flagSearch && (
              <button
                onClick={() => setFlagSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
              >
                ×
              </button>
            )}
          </div>

          {Object.keys(groupedFlags).length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-8 text-center">
              <p className="text-sm text-gray-400">No features match &ldquo;{flagSearch}&rdquo;</p>
            </div>
          )}

          {Object.entries(groupedFlags).map(([category, items]) => {
            const flagEnabled = items.filter((f) => localFlags?.[f.key]).length;
            const authExtra = category === 'integrations' ? 2 : 0;
            const enabledCount = flagEnabled; // auth rows tracked separately in IntegrationsAuth
            const totalCount = items.length + authExtra;
            return (
              <motion.div
                key={category}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="px-6 py-3.5 border-b border-gray-50 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-800">
                    {categoryLabels[category as keyof typeof categoryLabels]}
                  </h2>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    enabledCount > 0 ? 'bg-wine-50 text-wine-600' : 'bg-gray-100 text-gray-400',
                  )}>
                    {enabledCount}/{totalCount} on
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isEnabled = localFlags?.[item.key] ?? false;
                    return (
                      <div
                        key={item.key}
                        className="px-6 py-3.5 flex items-center gap-4 hover:bg-gray-50/60 transition-colors cursor-pointer"
                        onClick={() => handleToggle(item.key)}
                      >
                        <div className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                          isEnabled ? 'bg-wine-50 text-wine-500' : 'bg-gray-50 text-gray-300',
                        )}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{item.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{item.description}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggle(item.key); }}
                          aria-label={isEnabled ? 'Disable' : 'Enable'}
                          className={cn(
                            'relative inline-flex h-5 w-9 items-center rounded-full shrink-0 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-wine-500 focus:ring-offset-2',
                            isEnabled ? 'bg-wine-500' : 'bg-gray-200',
                          )}
                        >
                          <span className={cn(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
                            isEnabled ? 'translate-x-4' : 'translate-x-0.5',
                          )} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {category === 'integrations' && <IntegrationsAuth />}
              </motion.div>
            );
          })}
        </div>

        {/* ── Calendar Subscription ── */}
        <div id="calendar" className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 flex items-center gap-2 border-b border-gray-100">
            <Calendar className="w-4 h-4 text-wine-500" />
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Calendar</h2>
              <p className="text-xs text-gray-400 mt-0.5">Subscribe to your restaurant calendar from Outlook, Apple, or Google Calendar.</p>
            </div>
          </div>
          <div className="px-6 py-5">
            <CalendarSubscriptionSection />
          </div>
        </div>

        {/* Info note */}
        <div className="flex items-start gap-3 px-4 py-3.5 bg-blue-50 rounded-2xl border border-blue-100">
          <SettingsIcon className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-600">
            Feature flags take effect immediately after saving. Disabled features are hidden from the UI.
          </p>
        </div>

      </div>
    </div>
  );
}
