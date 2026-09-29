/**
 * Zone nesting for the storage-location editor (founder answer 2026-09-29,
 * "Add parent column (Recommended)": Cellar → Rack A → Shelf 2).
 *
 * The gateway stores `parent_id` and refuses another restaurant's zone, the
 * zone itself, and a cycle; the database refuses the same (migration
 * 20261202110000_a_zone_can_sit_inside_another_zone). These helpers keep the
 * picker from offering what would be refused, and draw the list as a tree.
 *
 * Depth is not capped here or anywhere: whether it should be is an open
 * founder fork.
 */

export interface NestableZone {
  id: string
  name: string
  parentId?: string
}

export interface NestedZone<T extends NestableZone> {
  zone: T
  depth: number
  /** The name of the zone this one sits inside, when it is in the list. */
  parentName?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * The zones in tree order: each zone followed by the zones inside it,
 * depth-first, siblings in the order the list gave them. A zone whose parent
 * is not in the list (deleted, or not loaded) is drawn at the top level, never
 * dropped; so is any zone a loop in the data would otherwise hide.
 */
export function nestZones<T extends NestableZone>(zones: T[]): NestedZone<T>[] {
  const ids = new Set(zones.map((z) => z.id))
  const byName = new Map(zones.map((z) => [z.id, z.name]))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const z of zones) {
    if (z.parentId && ids.has(z.parentId) && z.parentId !== z.id) {
      const list = children.get(z.parentId) ?? []
      list.push(z)
      children.set(z.parentId, list)
    } else {
      roots.push(z)
    }
  }
  const out: NestedZone<T>[] = []
  const seen = new Set<string>()
  const visit = (z: T, depth: number) => {
    if (seen.has(z.id)) return
    seen.add(z.id)
    out.push({
      zone: z,
      depth,
      parentName: depth > 0 && z.parentId ? byName.get(z.parentId) : undefined,
    })
    for (const c of children.get(z.id) ?? []) visit(c, depth + 1)
  }
  roots.forEach((r) => visit(r, 0))
  // Anything left sits on a loop with no root; show it rather than hide it.
  for (const z of zones) if (!seen.has(z.id)) visit(z, 0)
  return out
}

/**
 * What the parent picker may offer for the zone being edited (undefined when
 * creating): every saved zone except the zone itself and the zones inside it,
 * in tree order. A zone still on its temporary `loc-…` id is left out: the
 * gateway checks `parent_id` is a UUID and would refuse it.
 */
export function parentChoices<T extends NestableZone>(
  zones: T[],
  editingId: string | undefined,
): NestedZone<T>[] {
  const excluded = new Set<string>()
  if (editingId) {
    excluded.add(editingId)
    let grew = true
    while (grew) {
      grew = false
      for (const z of zones) {
        if (z.parentId && excluded.has(z.parentId) && !excluded.has(z.id)) {
          excluded.add(z.id)
          grew = true
        }
      }
    }
  }
  return nestZones(zones).filter((n) => !excluded.has(n.zone.id) && UUID_RE.test(n.zone.id))
}

/**
 * A parent zone's total for itself plus every zone below it, at any depth.
 *
 * Founder answer 2026-09-29, verbatim pick "Show both (Recommended)": "Parent
 * shows its own bottles plus a rolled-up total for everything inside, clearly
 * labelled. Nothing hidden, no double counting in reports." So this is shown
 * NEXT TO a zone's own count, never instead of it, and nothing that totals the
 * house may add these up: the own counts already hold every bottle once.
 */
export interface ZoneRollup {
  /** Bottles in the zone itself and every zone below it. */
  bottles: number
  /** The recorded capacities in that subtree, summed; null if none is recorded. */
  capacity: number | null
  /** Zones in the subtree (the parent included) with no capacity recorded. */
  capacityUnknown: number
  /** Zones below the parent, at any depth. */
  zonesInside: number
}

/**
 * Roll-ups for every zone that has at least one zone inside it; a zone with
 * nothing inside gets no entry. `ownBottles` is the caller's own per-zone
 * count (the zone manager counts from mappings, the cellar map from inventory
 * rows), so both surfaces roll up the same number they already show. A
 * capacity nobody recorded is not summed as 0 or 100: it is counted, the same
 * rule as `getLocationStats`. A loop in the data counts each zone once.
 */
export function rolledUpTotals<T extends NestableZone & { capacity: number | null }>(
  zones: T[],
  ownBottles: (zone: T) => number,
): Map<string, ZoneRollup> {
  const children = new Map<string, T[]>()
  for (const z of zones) {
    if (!z.parentId || z.parentId === z.id) continue
    const list = children.get(z.parentId) ?? []
    list.push(z)
    children.set(z.parentId, list)
  }
  const out = new Map<string, ZoneRollup>()
  for (const root of zones) {
    if (!children.get(root.id)?.length) continue
    const seen = new Set<string>([root.id])
    const stack = [...(children.get(root.id) ?? [])]
    const subtree: T[] = [root]
    while (stack.length) {
      const z = stack.pop() as T
      if (seen.has(z.id)) continue
      seen.add(z.id)
      subtree.push(z)
      stack.push(...(children.get(z.id) ?? []))
    }
    const recorded = subtree.filter((z) => z.capacity != null)
    out.set(root.id, {
      bottles: subtree.reduce((s, z) => s + ownBottles(z), 0),
      capacity: recorded.length ? recorded.reduce((s, z) => s + (z.capacity as number), 0) : null,
      capacityUnknown: subtree.length - recorded.length,
      zonesInside: subtree.length - 1,
    })
  }
  return out
}

/** The label a roll-up is drawn with: it always says what it adds up. */
export function rollupLabel(r: ZoneRollup): string {
  const scope = r.zonesInside === 1 ? 'With the zone inside' : `With the ${r.zonesInside} zones inside`
  if (r.capacity == null) return `${scope}: ${r.bottles} bottles (no capacity recorded)`
  const gap =
    r.capacityUnknown === 0
      ? ''
      : r.capacityUnknown === 1
        ? ' (1 zone has no capacity recorded)'
        : ` (${r.capacityUnknown} zones have no capacity recorded)`
  return `${scope}: ${r.bottles}/${r.capacity}${gap}`
}

/** How many zones sit directly inside `id`. */
export function zonesInside<T extends NestableZone>(zones: T[], id: string): number {
  return zones.filter((z) => z.parentId === id && z.id !== id).length
}
