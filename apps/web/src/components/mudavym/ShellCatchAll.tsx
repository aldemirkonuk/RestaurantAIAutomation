/**
 * The `*` route, nested under `DashboardLayout` (App.tsx) rather than at the
 * top level — the defect the first pass left behind: "the catch-all sits
 * outside the layout route and `useMudavymDesign` has no 'still deciding'
 * state, so a gated 404 would redirect before the house flag answers."
 *
 * Nested here, `DashboardLayout` has ALREADY made the shell/legacy choice
 * for the whole page (chrome included) before this ever renders, so there is
 * no separate race to get wrong: with the shell on, this reads the identical
 * `useMudavymDesign('shell')` value DashboardLayout used (the flag cache is
 * shared) and renders the in-app 404 inside the shell's own outlet; with it
 * off — including while the flag check is in flight, same as every other
 * gated page — today's behaviour is unchanged: silently `Navigate` home.
 */

import { useShellRoleFlags } from '../../lib/mudavym/shellRoleFlags';
import { HouseNotFound } from './HouseNotFound';

export function ShellCatchAll() {
  // [ADR 0149 cutover trial, 2026-09-28: the `shell` gate is gone.]
  const { role, flags } = useShellRoleFlags();
  return <HouseNotFound role={role} flags={flags} />;
}

export default ShellCatchAll;
