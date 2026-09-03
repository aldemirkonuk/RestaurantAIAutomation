/**
 * NotificationsNext formatting — the day-book's vocabulary.
 *
 * House honesty rule: an unknown is an em dash, never a zero and never a
 * guess. Nothing here invents a fact; every value returned is read off the
 * notification row the gateway sent.
 */

import {
  Boxes,
  CalendarDays,
  CreditCard,
  FileText,
  Inbox,
  Lightbulb,
  Mail,
  Package,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Notification } from '@/services/api/notifications';

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Fraunces, injected once — index.html loads the sans and the mono but not the
 * serif, and index.html is a shared file this page may not touch. Georgia
 * carries the voice until (or if) the webfont lands. Copied from the
 * dashboard's `fonts.ts` deliberately: pages do not import across pages.
 */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/** A finite number, or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Relative age. An absent or unparseable stamp is an em dash, never "now". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Absolute stamp for the detail — the book's own hand. */
export function stampOf(iso: string | null | undefined): string {
  if (!iso) return EM;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return EM;
  return t.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The register a row belongs to. This is a RE-LABELLING of the row's own
 * `type` column and nothing more — it does not claim which service wrote the
 * row (that mapping lives in the page note §11 and is not derivable here).
 */
const KIND_BY_TYPE: Record<string, string> = {
  inventory_low_stock: 'Stock',
  low_stock: 'Stock',
  order_pending: 'Orders',
  order_delivered: 'Orders',
  delivery_scheduled: 'Orders',
  overdue_order: 'Orders',
  order_inquiry: 'Orders',
  price_change: 'Orders',
  draft_ready: 'Vendor mail',
  unknown_sender: 'Vendor mail',
  invoice_received: 'Vendor mail',
  vendor_reply: 'Vendor mail',
  email_classified_operational: 'Vendor mail',
  email_classified_promo: 'Vendor mail',
  calendar_reminder: 'Calendar',
  custom_reminder: 'Calendar',
  report: 'Reports',
  generated_report: 'Reports',
  ai_suggestion: 'Advice',
  constraint_triggered: 'Advice',
  payment_due: 'Payments',
  system: 'System',
  system_alert: 'System',
};

export function kindOf(type: string | null | undefined): string {
  if (!type) return 'Other';
  return KIND_BY_TYPE[type] ?? 'Other';
}

/**
 * THE ICON A ROW EARNS — a drawn mark for the register the row is in, never
 * a decoration and never a mood.
 *
 * Why this exists at all: the producers wrote emoji INTO the stored title — a
 * siren in front of "50 wines dropped below par", a bar chart in front of
 * "Weekly report ready", a warning triangle in front of "Low-stock digest: …".
 * The emoji was doing real work — it was the only severity/register mark the
 * line carried — but it was carried in the data,
 * rendered in whatever the reader's OS ships, and unstylable. The producers
 * have been cleaned (see the page note §1b, second pass) and the funnel is
 * guarded by a spec, but rows already written keep their emoji forever. So the
 * page strips it and draws the mark itself, in ink, from the row's own `type`.
 *
 * The map is keyed by REGISTER, not by type, so it can never disagree with the
 * chip beside it or with the rail's tally.
 */
const ICON_BY_KIND: Record<string, LucideIcon> = {
  Stock: Boxes,
  Orders: Package,
  'Vendor mail': Mail,
  Calendar: CalendarDays,
  Reports: FileText,
  Advice: Lightbulb,
  Payments: CreditCard,
  System: Settings,
  Other: Inbox,
};

/** The icon for a register. An unknown register still gets a real mark. */
export function iconForKind(kind: string): LucideIcon {
  return ICON_BY_KIND[kind] ?? Inbox;
}

/** The icon a row earns, by way of its register. */
export function iconForType(type: string | null | undefined): LucideIcon {
  return iconForKind(kindOf(type));
}

/**
 * Every emoji code point this page will strip out of stored text.
 *
 * Deliberately the SAME two ranges the house-wide emoji grep uses
 * (`[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]`), plus the joiners and
 * miscellaneous-symbol block that carry the rest of a sequence:
 * U+FE0F (variation selector-16), U+200D (zero-width joiner), U+20E3
 * (combining keycap) and U+2B00–U+2BFF (⭐ and friends).
 *
 * What is deliberately NOT in the range: U+00A9 ©, U+00AE ® and U+2122 ™.
 * They are `Extended_Pictographic` — a naive `\p{Extended_Pictographic}` sweep
 * would silently delete the ™ out of a wine name, which is a house that edits
 * its own records. The guard's range is the contract; this is that range.
 */
// The three sequence carriers (VS16, ZWJ, keycap) are alternated, not put in the
// character class: eslint's no-misleading-character-class reads a combining mark
// inside [...] as an accident. Each branch still matches one code point.
const EMOJI_RE =
  /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D}|\u{20E3})/gu;

/**
 * A stored title or message with the producer's emoji taken out, so a row
 * written before the producers were cleaned reads like one written after.
 *
 * It removes, it never rewrites: nothing is added, no word is changed, and a
 * string that was only an emoji comes back empty rather than invented — the
 * caller's own fallback ("Untitled entry") then applies, which is the honest
 * answer for a line whose title was a picture.
 */
export function plainText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(EMOJI_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·]+/, '')
    .trim();
}

/** True when the stored string carries an emoji — the pin for the producers. */
export function hasEmoji(s: string | null | undefined): boolean {
  if (!s) return false;
  EMOJI_RE.lastIndex = 0;
  return EMOJI_RE.test(s);
}

/** The registers, in book order. Used for the rail's tally. */
export const KIND_ORDER = [
  'Stock',
  'Orders',
  'Vendor mail',
  'Calendar',
  'Reports',
  'Advice',
  'Payments',
  'System',
  'Other',
] as const;

/**
 * THE autonomy discriminator, and the reason it is exactly this narrow.
 *
 * `draft_ready` rows are written by the inbound autonomous responder after it
 * has understood a vendor's mail and DRAFTED a reply that it deliberately did
 * not send (`common/orchestrator/inbound-responder.service.ts:1287`; memory:
 * autonomous-email-replies — "never auto-send"). That is the one notification
 * kind whose existence proves the house acted on its own, so it is the only
 * one this page marks `--calm`. Every other kind is the house *telling* you
 * something, which is not the same claim.
 */
export function isHouseActed(n: Notification): boolean {
  return n.type === 'draft_ready';
}

export interface Fact {
  label: string;
  value: string;
}

/** A wine the row itself says is below par. Absent numbers stay null. */
export interface BelowPar {
  wineName: string;
  currentStock: number | null;
  threshold: number | null;
  severity: string | null;
}

export function belowParFrom(n: Notification): BelowPar[] {
  const raw = n.metadata?.wines;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).map((w: Record<string, unknown>) => ({
    wineName: String(w.wineName ?? w.name ?? 'Unnamed wine'),
    currentStock: num(w.currentStock ?? w.stock),
    threshold: num(w.threshold ?? w.par),
    severity: typeof w.severity === 'string' ? w.severity : null,
  }));
}

/**
 * Every fact the row actually carries, in the row's own words. A key the
 * metadata does not hold is omitted rather than rendered as zero — the em
 * dash is for a value the page PROMISED and could not get, not for a field
 * this kind of notification never had.
 */
export function factsFrom(n: Notification): Fact[] {
  const meta = n.metadata ?? {};
  const facts: Fact[] = [];
  const push = (label: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return;
    facts.push({ label, value: String(v) });
  };
  push('Below par', meta.count);
  push('Critical', meta.criticalCount);
  push('Alert mode', meta.mode);
  push('Wine', meta.wineName);
  push('Vendor', meta.provider ?? meta.provider_name);
  push('Quantity', meta.quantity);
  push('Order', typeof meta.orderId === 'string' ? meta.orderId.slice(0, 8) : undefined);
  push('Priority', n.priority);
  push('Written', stampOf(n.createdAt ?? n.timestamp));
  if (n.readAt) push('Ruled off', stampOf(n.readAt));
  return facts;
}

/** Where a row's own `actionUrl` points. Null when the row carries none. */
export function actionTargetOf(n: Notification): { to: string; label: string } | null {
  if (!n.actionUrl) return null;
  const to = n.actionUrl.startsWith('/') ? n.actionUrl : `/${n.actionUrl}`;
  return { to, label: n.actionLabel || 'Open where this happened' };
}
