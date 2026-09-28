import { HouseShell } from '../mudavym/HouseShell'
import { DataTermsSignInGate } from '../settings/DataTermsSignInGate'
import '../mudavym/sheet.css'

interface DashboardLayoutProps {
  children?: React.ReactNode
}

/**
 * The layout every signed-in route renders inside: the Mudavym app shell
 * (`HouseShell`: the rooms rail, the house header, the counter, the phone's
 * four doors), for every house.
 *
 * [ADR 0149 cutover trial, 2026-09-28: the `shell` gate and the legacy
 * Sidebar layout are gone; the history below is kept for the record.]
 *
 *
 * Gated (the founder's pick of 2026-09-21, sketch 119 direction D): with the
 * `shell` gate on — the browser override `mudavym.design.shell`, else the
 * house flag `mudavym_design_shell`, else off — the Mudavym app shell renders
 * (`HouseShell`: the rooms rail, the house header, the counter, the phone's
 * four doors). Off, the legacy layout below renders exactly as it always has,
 * including while the flag check is in flight: the gate never flashes the new
 * shell at someone who is not meant to see it (useMudavymDesign.ts).
 * [2026-09-25: `shell` is in `LIVE_PAGES` (ADR 0149 row 36's bracket, founder
 * Q2/Q4 of 2026-09-22), so the gate is on for every house on the first render
 * with no flag read; the legacy layout stays mounted below, reachable only
 * through the browser override `mudavym.design.shell = 0`.]
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <>
      <HouseShell>{children}</HouseShell>
      {/* ADR 0207 round 5 (question 19) — every owner, at their next
          sign-in, meets the house's data-and-privacy terms. The sheet is
          portalled (Panel), so its position is only about mounting once per
          authenticated layout. */}
      <DataTermsSignInGate />
    </>
  )
}
