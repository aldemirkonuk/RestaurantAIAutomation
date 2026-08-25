import type { Notification } from '../services/api/notifications'

/** Extract a wine count from title/metadata for low-stock stack ranking. */
export function extractLowStockCount(n: Notification): number {
  const fromMeta = n.metadata?.count
  if (typeof fromMeta === 'number' && fromMeta > 0) return fromMeta
  const burst = n.title.match(/(\d+)\s+wines?\s+dropped below par/i)
  if (burst) return Number.parseInt(burst[1], 10)
  const digest = n.title.match(/digest:\s*(\d+)\s+wine/i)
  if (digest) return Number.parseInt(digest[1], 10)
  return 1
}

type StackMode = 'max_count' | 'newest'

function normalizeNotificationTitle(title: string): string {
  // Keep emoji as alternates (not a char class) — multi-codepoint emoji inside
  // [] trips no-misleading-character-class and matches incorrectly.
  return title
    .replace(/^(?:[\s\uFE0F\u200D]|⚠️|🚨|📦|🔔)+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Digest titles differ only by count — treat as the same recurring alert. */
function normalizeDigestTitle(title: string): string {
  return normalizeNotificationTitle(title).replace(
    /digest:\s*\d+\s+wines? below par/,
    'digest: wines below par',
  )
}

function stackKey(n: Notification): { key: string; mode: StackMode } | null {
  if (n.type === 'inventory_low_stock') {
    if (/dropped below par/i.test(n.title) || n.metadata?.mode === 'instant') {
      return { key: 'inventory_low_stock:below_par_burst', mode: 'max_count' }
    }
    if (/digest/i.test(n.title) || n.metadata?.mode === 'digest') {
      return {
        key: `inventory_low_stock:digest:${normalizeDigestTitle(n.title)}`,
        mode: 'newest',
      }
    }
  }

  const normalized = normalizeNotificationTitle(n.title)
  if (!normalized) return null
  return { key: `${n.type}:${normalized}`, mode: 'newest' }
}

function pickStackWinner(group: Notification[], mode: StackMode): Notification {
  if (mode === 'newest') {
    return group.reduce((best, cur) =>
      new Date(cur.timestamp).getTime() >= new Date(best.timestamp).getTime() ? cur : best,
    )
  }

  return group.reduce((best, cur) => {
    const bc = extractLowStockCount(best)
    const cc = extractLowStockCount(cur)
    if (cc > bc) return cur
    if (cc < bc) return best
    return new Date(cur.timestamp).getTime() >= new Date(best.timestamp).getTime() ? cur : best
  })
}

/**
 * Collapse repetitive notifications:
 * - Below-par bursts → one row, highest count wins
 * - Recurring digests / identical titles → one row, most recent wins
 */
export function collapseStackedNotifications(notifications: Notification[]): {
  items: Notification[]
  foldedCount: number
  foldedById: Record<string, number>
} {
  const passthrough: Notification[] = []
  const stacks = new Map<string, { group: Notification[]; mode: StackMode }>()

  for (const n of notifications) {
    const entry = stackKey(n)
    if (!entry) {
      passthrough.push(n)
      continue
    }
    const existing = stacks.get(entry.key)
    if (existing) {
      existing.group.push(n)
    } else {
      stacks.set(entry.key, { group: [n], mode: entry.mode })
    }
  }

  const collapsed: Notification[] = []
  let foldedCount = 0
  const foldedById: Record<string, number> = {}

  for (const { group, mode } of stacks.values()) {
    if (group.length === 1) {
      collapsed.push(group[0])
      continue
    }
    const winner = pickStackWinner(group, mode)
    collapsed.push(winner)
    const folded = group.length - 1
    foldedCount += folded
    foldedById[winner.id] = folded
  }

  const items = [...passthrough, ...collapsed].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )

  return { items, foldedCount, foldedById }
}

export function stackedNotificationLabel(n: Notification, foldedInto?: number): string | null {
  if (foldedInto && foldedInto > 0) {
    return `${foldedInto} earlier duplicate${foldedInto === 1 ? '' : 's'} grouped`
  }
  const count = extractLowStockCount(n)
  if (n.type === 'inventory_low_stock' && count > 1 && /dropped below par/i.test(n.title)) {
    return `${count} wines below par`
  }
  return null
}
