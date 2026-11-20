/**
 * How long the Menus kept list waits before it looks again while a menu is
 * being read in the background. Each look runs the whole list on the gateway
 * (the stale-read sweep, the versions, their names), and the page that sent
 * the file is already asking after that one read on its own, so the list
 * eases off: quick in the first minute, slower after. `false` = no read is
 * going on, so do not look again.
 */
export function versionsPollMs(
  versions: ReadonlyArray<{ readState?: 'reading' | 'done' | 'failed'; createdAt: string | null }> | undefined,
  now: number = Date.now(),
): number | false {
  const reading = (versions ?? []).filter((v) => v.readState === 'reading')
  if (reading.length === 0) return false
  // The newest read decides: an old stuck one must not slow a fresh one's look.
  let youngest = Number.POSITIVE_INFINITY
  for (const v of reading) {
    const started = v.createdAt ? Date.parse(v.createdAt) : Number.NaN
    if (Number.isFinite(started)) youngest = Math.min(youngest, now - started)
  }
  if (youngest < 60_000) return 5_000
  if (youngest < 300_000) return 15_000
  return 30_000
}
