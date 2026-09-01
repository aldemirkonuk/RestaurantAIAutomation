/**
 * Command registry + fuzzy matcher for the global command palette (⌘K).
 *
 * UX paths: NEW-001 (⌘K palette) · NEW-002 (run without navigating) ·
 * NEW-003 (↑/↓/Enter/Esc + last-used pinned) · NEW-004 (recents) ·
 * NEW-009 / NEW-677 / NEW-678 (g-then-key go-to nav) · NEW-028 / NEW-029 (New menu).
 *
 * Zero deps: the fuzzy matcher is a subsequence scorer tuned for prefix +
 * word-boundary + contiguous-run bonuses, so ranking feels instant and correct.
 */

import type { LucideIcon } from "lucide-react";
import {
  Home,
  Boxes,
  ShoppingCart,
  PackageCheck,
  Wine,
  Truck,
  Tag,
  BarChart3,
  Lightbulb,
  Layers,
  Calendar,
  Users,
  Mail,
  FileText,
  Bell,
  Sparkles,
  Settings as SettingsIcon,
  HelpCircle,
  User,
  Plus,
  CalendarPlus,
  UserPlus,
} from "lucide-react";

export type CommandSection = "Navigation" | "Create" | "Insights" | "Recent";

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  section: CommandSection;
  icon: LucideIcon;
  /** Extra terms the fuzzy matcher should consider (synonyms). */
  keywords?: string;
  /** Optional display hint, e.g. "g i". */
  shortcut?: string;
  /** Destination route (navigation/create commands). */
  href?: string;
  /** Or an imperative action (run without navigating — NEW-002). */
  action?: () => void;
}

/** Gmail-style "g then key" go-to map (NEW-009 / NEW-677 / NEW-678). */
export const GOTO_MAP: Record<string, { href: string; label: string }> = {
  d: { href: "/", label: "Dashboard" },
  i: { href: "/inventory", label: "Inventory" },
  o: { href: "/orders", label: "Orders" },
  w: { href: "/wines", label: "Wine Library" },
  r: { href: "/reports", label: "Reports" },
  p: { href: "/providers", label: "Providers" },
  c: { href: "/calendar", label: "Calendar" },
  t: { href: "/team", label: "Team" },
  n: { href: "/notifications", label: "Notifications" },
  s: { href: "/settings", label: "Settings" },
};

const NAVIGATION: Command[] = [
  { id: "nav-dashboard", title: "Dashboard", section: "Navigation", icon: Home, href: "/", shortcut: "g d", keywords: "home overview" },
  { id: "nav-inventory", title: "Inventory", section: "Navigation", icon: Boxes, href: "/inventory", shortcut: "g i", keywords: "stock cellar bottles par" },
  { id: "nav-orders", title: "Orders", section: "Navigation", icon: ShoppingCart, href: "/orders", shortcut: "g o", keywords: "procurement po purchase" },
  // No `g` shortcut: every free letter that reads as "receiving" is already bound
  // (r=Reports), and inventing a binding is a UX decision nobody made. Registering
  // it here also gives `/receiving` a ROUTE_LABELS entry, which is what stops the
  // breadcrumb rendering the raw segment.
  { id: "nav-receiving", title: "Receiving", section: "Navigation", icon: PackageCheck, href: "/receiving", keywords: "delivery deliveries door goods in receive truck arrived packing slip" },
  { id: "nav-wines", title: "Wine Library", section: "Navigation", icon: Wine, href: "/wines", shortcut: "g w", keywords: "catalog bottles list" },
  { id: "nav-providers", title: "Providers", section: "Navigation", icon: Truck, href: "/providers", shortcut: "g p", keywords: "vendors suppliers distributors" },
  { id: "nav-promotions", title: "Promotions", section: "Navigation", icon: Tag, href: "/promotions", keywords: "offers deals prospects" },
  { id: "nav-reports", title: "Reports", section: "Navigation", icon: BarChart3, href: "/reports", shortcut: "g r", keywords: "analytics charts dashboard kpi" },
  { id: "nav-recs", title: "Recommendations", section: "Navigation", icon: Lightbulb, href: "/recommendations", keywords: "actions insights suggestions" },
  { id: "nav-catalog", title: "Insight Catalog", section: "Navigation", icon: Layers, href: "/recommendations/catalog", keywords: "browse types dimension measure comparator" },
  { id: "nav-calendar", title: "Calendar", section: "Navigation", icon: Calendar, href: "/calendar", shortcut: "g c", keywords: "events schedule" },
  { id: "nav-team", title: "Team", section: "Navigation", icon: Users, href: "/team", shortcut: "g t", keywords: "staff shifts labor" },
  { id: "nav-comms", title: "Communications", section: "Navigation", icon: Mail, href: "/communications", keywords: "email sms templates" },
  { id: "nav-docs", title: "Documents & Reports", section: "Navigation", icon: FileText, href: "/documents-reports", keywords: "files pdf" },
  { id: "nav-notifications", title: "Notifications", section: "Navigation", icon: Bell, href: "/notifications", shortcut: "g n", keywords: "alerts" },
  { id: "nav-sommelier", title: "Sommelier AI", section: "Navigation", icon: Sparkles, href: "/sommelier", keywords: "assistant chat pairing" },
  { id: "nav-settings", title: "Settings", section: "Navigation", icon: SettingsIcon, href: "/settings", shortcut: "g s", keywords: "preferences config team locations" },
  { id: "nav-profile", title: "Profile", section: "Navigation", icon: User, href: "/profile", keywords: "account password email linked oauth theme" },
  { id: "nav-help", title: "Help & Support", section: "Navigation", icon: HelpCircle, href: "/help", keywords: "support docs slack email faq" },
];

const CREATE: Command[] = [
  { id: "new-order", title: "New order", section: "Create", icon: Plus, href: "/orders?new=1", keywords: "create purchase po add" },
  { id: "new-wine", title: "Add wine", section: "Create", icon: Wine, href: "/wines?add=1", keywords: "create bottle scan label" },
  { id: "new-event", title: "Add calendar event", section: "Create", icon: CalendarPlus, href: "/calendar?openModal=true", keywords: "create schedule meeting" },
  { id: "new-provider", title: "Add provider", section: "Create", icon: UserPlus, href: "/providers?add=1", keywords: "create vendor supplier" },
  { id: "new-report", title: "Generate report", section: "Create", icon: BarChart3, href: "/reports", keywords: "export pdf" },
];

const INSIGHTS: Command[] = [
  // No count in the title: the catalogue is generated, so any literal here goes
  // stale silently (this said 375 against a 573-type catalogue). ADR 0020.
  { id: "insight-browse", title: "Browse all insight types", section: "Insights", icon: Layers, href: "/recommendations/catalog", keywords: "catalog dimension measure comparator explorer" },
  { id: "insight-recs", title: "View recommendations", section: "Insights", icon: Lightbulb, href: "/recommendations", keywords: "actions what to do" },
];

/** The full static command set (dynamic insight suggestions are merged in the UI). */
export function staticCommands(): Command[] {
  return [...NAVIGATION, ...CREATE, ...INSIGHTS];
}

/** Human label for a route path — reused by recents + breadcrumbs. */
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/recommendations/catalog': 'Insight Catalog',
  '/documents-reports': 'Documents & Reports',
  ...Object.fromEntries(NAVIGATION.map((c) => [c.href!, c.title])),
};

export function routeLabel(path: string): string {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  if (ROUTE_LABELS[clean]) return ROUTE_LABELS[clean];
  // Longest known prefix wins (e.g. /inventory/... -> Inventory).
  const match = Object.keys(ROUTE_LABELS)
    .filter((h) => h !== '/' && clean.startsWith(h))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return ROUTE_LABELS[match];
  const last = clean.split('/').filter(Boolean).pop() ?? 'Home';
  return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Breadcrumb trail for a path (NEW-030), parent-aware for nested routes. */
export function breadcrumbTrail(path: string): { label: string; href: string }[] {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/') return [{ label: 'Dashboard', href: '/' }];
  const segments = clean.split('/').filter(Boolean);
  const trail: { label: string; href: string }[] = [{ label: 'Dashboard', href: '/' }];
  let acc = '';
  for (const seg of segments) {
    acc += `/${seg}`;
    trail.push({ label: routeLabel(acc), href: acc });
  }
  return trail;
}

/**
 * Subsequence fuzzy score. Returns null when `query` is not a subsequence of
 * `text`; higher is better. Bonuses: word-boundary start, contiguous run,
 * earlier first match, shorter text.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let run = 0;
  let lastMatch = -2;
  let firstMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      let bonus = 1;
      if (ti === lastMatch + 1) {
        run += 1;
        bonus += run * 2;
      } else {
        run = 0;
      }
      if (ti === 0 || /[\s\-_/]/.test(t[ti - 1])) bonus += 4; // word boundary
      score += bonus;
      lastMatch = ti;
      qi += 1;
    }
  }
  if (qi < q.length) return null;
  score -= firstMatch * 0.2; // prefer earlier matches
  score -= t.length * 0.03; // prefer shorter targets
  return score;
}

export interface ScoredCommand {
  cmd: Command;
  score: number;
}

/** Rank commands for a query across title + subtitle + keywords. */
export function rankCommands(commands: Command[], query: string): ScoredCommand[] {
  if (!query.trim()) return commands.map((cmd) => ({ cmd, score: 0 }));
  const out: ScoredCommand[] = [];
  for (const cmd of commands) {
    const hay = `${cmd.title} ${cmd.subtitle ?? ""} ${cmd.keywords ?? ""}`;
    const titleScore = fuzzyScore(query, cmd.title);
    const hayScore = fuzzyScore(query, hay);
    const best =
      titleScore != null && hayScore != null
        ? Math.max(titleScore + 3, hayScore) // title matches weigh more
        : (titleScore ?? hayScore);
    if (best != null) out.push({ cmd, score: best });
  }
  return out.sort((a, b) => b.score - a.score);
}
