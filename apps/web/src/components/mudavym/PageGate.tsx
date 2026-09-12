/**
 * Per-page gate between the legacy page and its Mudavym redesign.
 *
 * `legacy` renders exactly as it always has — no wrapper, no class, byte-for-
 * byte the old tree. `next` renders as-is: every Mudavym page already carries
 * its own `.mudavym` root so it can stand alone in tests and sandboxes (see
 * DashboardNext's header note) — PageGate does not add a second one.
 *
 * A prior version wrapped `next` in its own `.mudavym[data-ground]` div. That
 * put TWO `.mudavym` nodes on the path to any page, and a custom property
 * declared directly on a descendant always wins over one inherited from an
 * ancestor, independent of selector specificity — so whatever the outer
 * wrapper declared, the inner page root's own `.mudavym` declaration
 * overwrote it. Any `data-ground` set here is therefore invisible to the
 * page. Set it on the SAME element that carries `.mudavym`: the page
 * component takes its own `ground` prop, e.g.
 * `next={<DashboardNext ground="charcoal" />}`.
 *
 * That rule is why the decided ground lives on the bare `.mudavym` selector
 * in styles/mudavym.css rather than on an ancestor-qualified override — see
 * that file's header. Since 2026-09-12 the scope paints Warm Charcoal in
 * every app theme, so a Mudavym page does NOT follow the user's light/dark
 * choice; `legacy` still does, untouched.
 *
 * Usage (in the router):
 *   <PageGate page="dashboard" legacy={<Dashboard/>} next={<DashboardNext/>}/>
 */

import { ReactNode } from 'react';
import { MudavymPage, useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';

export interface PageGateProps {
  page: MudavymPage;
  /** The shipping page — rendered untouched while the flag is off. */
  legacy: ReactNode;
  /**
   * The Mudavym redesign, rendered as-is. The page itself owns the
   * `.mudavym` scope on its root — and its own `ground` prop when it wants to
   * state that ground out loud. See the file header for why that has to live
   * on the page, not here.
   */
  next: ReactNode;
}

export function PageGate({ page, legacy, next }: PageGateProps) {
  const showNext = useMudavymDesign(page);
  return <>{showNext ? next : legacy}</>;
}

export default PageGate;
