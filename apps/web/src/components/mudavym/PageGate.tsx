/**
 * Per-page gate between the legacy page and its Mudavym redesign.
 *
 * `legacy` renders exactly as it always has — no wrapper, no class, byte-for-
 * byte the old tree. `next` renders as-is: every Mudavym page already carries
 * its own `.mudavym` root so it can stand alone in tests and sandboxes (see
 * DashboardNext's header note) — PageGate does not add a second one.
 *
 * A prior version wrapped `next` in its own `.mudavym[data-ground]` div. That
 * put TWO `.mudavym` nodes on the path to any page — harmless in plain
 * light/dark, but fatal for a charcoal ground: `.mudavym[data-ground=
 * "charcoal"]` only matched the OUTER wrapper, while the inner page root's
 * bare `.mudavym` re-declared the light token column on itself. A custom
 * property declared directly on a descendant always wins over one inherited
 * from an ancestor, independent of selector specificity — so the charcoal
 * tokens never reached the subtree that needed them. Force a ground the way
 * DashboardNext does instead: the page component takes its own `ground`
 * prop and sets `data-ground` on the SAME element that carries `.mudavym`,
 * e.g. `next={<DashboardNext ground="charcoal" />}`.
 *
 * Usage (in the router):
 *   <PageGate page="dashboard" legacy={<Dashboard/>} next={<DashboardNext/>}/>
 *
 * ── The gate also tells the SHELL ─────────────────────────────────────────
 * The app shell renders nine overlays over every page and they are shared with
 * the legacy pages, so they may not be restyled globally without breaking ADR
 * 0042's byte-for-byte promise. While a `next` tree is mounted this gate claims
 * a slot in `lib/mudavym/shellGround`, and each shell overlay reads it: on ⇒
 * the house shape, off ⇒ exactly the markup it always had. The ground is
 * measured off the DOM the page rendered, because the page — not the gate —
 * owns `data-ground` (see above).
 *
 * ── The gate also carries the HEADER ──────────────────────────────────────
 * Measured 2026-09-04: `DashboardLayout.tsx:110` only re-exports `Header`, and
 * no `pages/<page>/next` tree renders one — so a rebuilt page had no bell, no
 * account menu, no theme switch and no way to change house. The founder's
 * call was to build one, and this is the single place it can mount without
 * editing seventeen pages: above `next`, on the branch that is already showing
 * the redesign, so a legacy page can never see it. `HouseHeader` declines to
 * render for `receiving_door` (chrome-free by decision, App.tsx:227-240) and
 * outside an AuthProvider.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { HouseHeader } from './HouseHeader';
import { SheetStackProvider } from './SheetStack';
import { MudavymPage, useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';
import {
  MudavymGroundContext,
  claimMudavymShell,
  readShellGroundFromDom,
  releaseMudavymShell,
  type MudavymGround,
} from '../../lib/mudavym/shellGround';

export interface PageGateProps {
  page: MudavymPage;
  /** The shipping page — rendered untouched while the flag is off. */
  legacy: ReactNode;
  /**
   * The Mudavym redesign, rendered as-is. The page itself owns the
   * `.mudavym` scope on its root — and, per ADR 0042 ("both grounds ship"),
   * its own `ground` prop when a surface must force Warm Charcoal. See the
   * file header for why that has to live on the page, not here.
   */
  next: ReactNode;
}

export function PageGate({ page, legacy, next }: PageGateProps) {
  const showNext = useMudavymDesign(page);
  const token = useRef<symbol>(Symbol('mudavym-page-gate'));
  const [ground, setGround] = useState<MudavymGround | undefined>(undefined);

  useEffect(() => {
    if (!showNext) {
      setGround(undefined);
      return;
    }
    const id = token.current;
    // Runs after the child has mounted, so its `.mudavym[data-ground]` root is
    // in the document and can be read back.
    const measured = readShellGroundFromDom();
    setGround(measured);
    claimMudavymShell(id, measured);
    return () => releaseMudavymShell(id);
  }, [showNext, page]);

  if (!showNext) return <>{legacy}</>;
  // Before the measurement lands the value is `undefined` — "nobody has
  // declared a ground yet", which sends an overlay to the DOM rather than
  // handing it a paper default the gate cannot actually vouch for. The header
  // takes the same value for the same reason.
  return (
    <MudavymGroundContext.Provider value={ground}>
      {/* ── The gate also holds the SPINDLE (2026-09-06, sketch 103 · 1c) ──
          Depth is a fact about a PAGE, not about the document: a test or a
          sandbox that mounts one Sheet is not three levels deep in anything.
          This is the one place that knows a real page is on screen, so the cap,
          the named spine and the phone's breadcrumb live here — and a Sheet
          mounted anywhere else behaves exactly as it always did. */}
      <SheetStackProvider>
        <HouseHeader page={page} ground={ground} />
        {next}
      </SheetStackProvider>
    </MudavymGroundContext.Provider>
  );
}

export default PageGate;
