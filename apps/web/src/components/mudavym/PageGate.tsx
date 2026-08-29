/**
 * Per-page gate between the legacy page and its Mudavym redesign.
 *
 * `legacy` renders exactly as it always has — no wrapper, no class, byte-for-
 * byte the old tree. `next` is wrapped in a `display: contents` element
 * carrying the `.mudavym` class, so the ADR-0042 tokens (styles/mudavym.css)
 * and the seal/paper/inkm Tailwind utilities resolve inside it without adding
 * a layout box.
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
  /** The Mudavym redesign — rendered inside a `.mudavym` token scope. */
  next: ReactNode;
  /**
   * Force the dark Warm Charcoal ground regardless of app theme (receiving
   * door, POS, cellar surfaces — ADR 0042 "both grounds ship"). Omitted, the
   * ground follows the app's light/dark theme class.
   */
  ground?: 'charcoal';
}

export function PageGate({ page, legacy, next, ground }: PageGateProps) {
  const showNext = useMudavymDesign(page);
  if (!showNext) return <>{legacy}</>;
  return (
    <div className="mudavym" data-ground={ground} style={{ display: 'contents' }}>
      {next}
    </div>
  );
}

export default PageGate;
