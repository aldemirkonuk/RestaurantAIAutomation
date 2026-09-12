import {
  Brain,
  DollarSign,
  Eye,
  FileText,
  Image,
  Package,
  Receipt,
  ShoppingCart,
  Calendar,
  Users,
  Wine,
} from 'lucide-react';

/**
 * Capabilities that exist in the codebase but have no per-restaurant switch
 * behind them.
 *
 * These are NOT feature flags. They are rendered without a control, because
 * there is nothing a control could do: no code branches on a per-restaurant
 * value for any of them (OD-86 audit, 2026-08-26 — see
 * `apps/api-gateway/src/settings/feature-flag-registry.ts` for the full
 * inventory and for the ten entries that were deleted outright because the
 * feature they named does not exist).
 *
 * Listing them is the point. ADR 0020 asks a surface with no data to say so
 * rather than invent one, and keeping the gap visible is what stops these
 * quietly becoming 22 lying switches again.
 */
export interface InactiveFeature {
  label: string;
  /** What the product does today — never what it might do. */
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'inventory' | 'procurement' | 'ai' | 'analytics' | 'operations';
}

export const INACTIVE_FEATURES: InactiveFeature[] = [
  {
    label: 'Inventory Storage Locations',
    description: 'Storage locations are always available on inventory items.',
    icon: Package,
    category: 'inventory',
  },
  {
    label: 'Invoice Scanning',
    description: 'Invoice and delivery-note intake always runs on uploaded documents.',
    icon: FileText,
    category: 'inventory',
  },
  {
    label: 'Check Scanning',
    description: 'The check scanner is always available from Reports.',
    icon: Receipt,
    category: 'inventory',
  },
  {
    label: 'Auto Procurement',
    description: 'Low-stock reordering is decided by the procurement agent, not by a switch here.',
    icon: ShoppingCart,
    category: 'procurement',
  },
  {
    label: 'Recurring Orders',
    description: 'Recurring orders are managed per schedule on the Recurring Orders page.',
    icon: Calendar,
    category: 'procurement',
  },
  {
    label: 'Sommelier AI',
    description: 'Enabled for the whole deployment, not per restaurant.',
    icon: Wine,
    category: 'ai',
  },
  {
    label: 'Menu Analyzer',
    description: 'Enabled for the whole deployment, not per restaurant.',
    icon: Image,
    category: 'ai',
  },
  {
    label: 'Visual Verification',
    description: 'Enabled for the whole deployment, not per restaurant.',
    icon: Eye,
    category: 'operations',
  },
  {
    label: 'Predictive Analytics',
    description: 'Forecasting always runs behind the analytics engine.',
    icon: Brain,
    category: 'analytics',
  },
  {
    label: 'Profit Margin Tracking',
    description: 'Margin analysis always runs behind the analytics engine.',
    icon: DollarSign,
    category: 'analytics',
  },
  {
    label: 'Guest CRM',
    description:
      'Guest records exist in the database but nothing captures or reads them yet. No guest data is being collected.',
    icon: Users,
    category: 'operations',
  },
];
