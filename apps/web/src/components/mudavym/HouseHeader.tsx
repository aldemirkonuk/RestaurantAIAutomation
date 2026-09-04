/**
 * The house header — the chrome every rebuilt page was missing.
 *
 * WHAT WAS MEASURED (2026-09-04)
 * ------------------------------
 * `DashboardLayout.tsx:110` only re-exports `Header`; every legacy page renders
 * its own, and NO rebuilt page renders one — `grep '<Header' apps/web/src/pages/
 * (star)/next` returns nothing. So a Mudavym page had no bell, no account menu,
 * no theme switch and no way to change house: those four controls existed only
 * on the pages the wave had not reached yet. The founder's call, asked directly:
 * "Build a Mudavym header this wave."
 *
 * WHERE IT MOUNTS
 * ---------------
 * `PageGate`, above every `next` tree — one place, no page edits, and it can
 * never appear over a legacy page because the gate only renders it on the
 * branch that is already showing the redesign. `receiving_door` is excluded
 * (`lib/mudavym/pageNames.ts` NO_CHROME): that route is deliberately outside
 * `DashboardLayout` because it is used one-handed at a loading dock
 * (App.tsx:227-240).
 *
 * THE MARK, NOT A THIRD PRINTING OF THE NAME
 * ------------------------------------------
 * The brief asked for "the wordmark (small)". Measured first: sixteen rebuilt
 * pages already print `<Wordmark size={13}/>` as the first line of their own
 * masthead (ProvidersNext.tsx:119, TeamNext.tsx:443, CellarNext.tsx:136, …),
 * and the sidebar prints the full lockup above the navigation
 * (Sidebar.tsx:547). A wordmark here would be the house's name three times in
 * one viewport, twice within 40px of each other. So the header wears the MARK —
 * the trued A+M interlock, `BrandMark variant="mark"` at the 24px floor ADR
 * 0047 sets — and the pages keep the typographic signature that
 * `Wordmark.tsx:9-12` reserves for them ("the in-page typographic signature …
 * where a page wants mark + name, compose BrandMark instead"). The substitution
 * is deliberate and the alternative — header keeps the wordmark, all sixteen
 * pages drop their masthead one — is written up for the founder in
 * DESIGN-FOUNDATION §3 item 2.
 *
 * THE GROUND
 * ----------
 * ADR 0042 scopes every token under `.mudavym`, so this element carries the
 * class itself. It sits ABOVE the page's own root, so it cannot inherit the
 * page's `data-ground`; PageGate hands it the ground it measured off the DOM
 * (see PageGate's header comment for why a second `.mudavym` node must carry
 * the ground on the SAME element). Under the app's own dark theme neither
 * needs to declare anything — `.dark .mudavym` turns both.
 */

import { useContext, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { BrandMark } from '../brand/BrandMark';
import { ThemeMenu } from '../layout/ThemeMenu';
import { RestaurantBranchSwitcher } from '../layout/RestaurantBranchSwitcher';
import { AuthContext } from '../../contexts/AuthContext';
import type { MudavymGround } from '../../lib/mudavym/shellGround';
import type { MudavymPage } from '../../lib/mudavym/useMudavymDesign';
import { NO_CHROME, pageNameFor } from '../../lib/mudavym/pageNames';
import { HouseBell } from './HouseBell';
import { HouseUserMenu } from './HouseUserMenu';
// `.mdv-kbd`, `.mdv-item`, `.mdv-link`, `.mdv-quiet` and `.mdv-note` are the
// primitive's vocabulary; the header borrows them rather than re-deriving a
// second one. DashboardLayout already loads this file — the import makes the
// component self-sufficient in a sandbox and is deduped by the bundler.
import './sheet.css';
import './house-header.css';

const EM = '—';

/* ── Fraunces ─────────────────────────────────────────────────────────────
   index.html loads DM Sans / Plus Jakarta Sans / JetBrains Mono but not the
   house serif, and the page's name is set in it. The id is the one
   `Sheet.tsx:71` and `pages/dashboard/next/fonts.ts:10` use, so all three
   injectors add at most one link between them. */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/**
 * The palette is opened by the same window event the legacy header dispatches
 * (`Header.tsx:114`), which `CommandProvider.tsx:178` listens for. The keyboard
 * route is untouched: `CommandProvider.tsx:110-129` accepts meta OR ctrl, in
 * the capture phase, so ⌘K still works whether or not this header exists.
 */
function openPalette(): void {
  window.dispatchEvent(new CustomEvent('wineops:command-open'));
}

/** ⌘ on a Mac, Ctrl everywhere else. Read once — the platform does not change. */
function chord(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  const p = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(p) ? '⌘K' : 'Ctrl K';
}

/**
 * Which house you are in.
 *
 * One house ⇒ its name, printed, with no control: a switcher that switches
 * between one thing is a button that does nothing.
 * More than one ⇒ the existing `RestaurantBranchSwitcher`, which already opens
 * the house `Popover` while the shell is on (RestaurantBranchSwitcher.tsx:79)
 * and returns null on its own below two branches (:37). It is reused whole
 * rather than forked; only its trigger is re-dressed, by CSS scoped to this
 * header, so the legacy header keeps the button it has always had.
 */
function HouseOfRecord() {
  const auth = useContext(AuthContext);
  const branches = auth?.availableRestaurants ?? [];
  const activeId = auth?.activeRestaurantId ?? null;

  if (branches.length > 1) {
    return <RestaurantBranchSwitcher compact className="relative mdv-hdr__branch" />;
  }
  const here = branches.find((b) => b.id === activeId) ?? branches[0] ?? null;
  if (here) {
    return (
      <span className="mdv-hdr__house" title={here.city ?? undefined}>
        {here.name}
      </span>
    );
  }
  // An id with no name attached: the house is real, its name was not read.
  if (activeId) {
    return (
      <span className="mdv-hdr__house mdv-hdr__house--unknown" title="The house's name could not be read">
        {EM}
      </span>
    );
  }
  return null; // identity still resolving — no claim to make yet
}

export interface HouseHeaderProps {
  page: MudavymPage;
  /** The ground PageGate measured. `undefined` = nobody has declared one. */
  ground?: MudavymGround;
}

export function HouseHeader({ page, ground }: HouseHeaderProps) {
  const { pathname } = useLocation();
  const auth = useContext(AuthContext);
  const [keys] = useState(chord);
  const [stuck, setStuck] = useState(false);

  /* The hairline hardens once the page has scrolled under the header — the
     only state this bar has, and it is a fact about the page, not a flourish. */
  useEffect(() => {
    ensureFraunces();
  }, []);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // No identity ⇒ no chrome. Every control here speaks for a person and a
  // house; outside an AuthProvider (an isolated mount, a sandbox) there is
  // nobody to speak for, and a header full of dead controls is worse than none.
  if (!auth) return null;
  if (NO_CHROME.has(page)) return null;

  return (
    <header
      className="mudavym mdv-hdr"
      data-ground={ground === 'charcoal' ? 'charcoal' : undefined}
      data-stuck={stuck ? 'true' : undefined}
      /* `<header>` only maps to the banner landmark when it is scoped to
         <body>; nested inside <main> it is generic, and an aria-label on a
         generic element is dropped. Declaring the role makes the chrome a
         landmark a screen reader can jump to — and there can only ever be one,
         because the legacy header never renders on a page this one is on. */
      role="banner"
      aria-label="House header"
    >
      <div className="mdv-hdr__in">
        <div className="mdv-hdr__left">
          <Link to="/" className="mdv-hdr__mark" aria-label="Mudavym — dashboard">
            <BrandMark variant="mark" size={24} mark="mono" alt="" />
          </Link>
          <span className="mdv-hdr__rule" aria-hidden />
          <span className="mdv-hdr__page">{pageNameFor(page, pathname)}</span>
        </div>

        {/* Below 900px the words are hidden and below 640px the chord is too,
            which would leave a button whose only content is an aria-hidden
            icon — nameless. The label carries the name at every width. */}
        <button
          type="button"
          className="mdv-hdr__search"
          onClick={openPalette}
          aria-label="Search or act — open the command palette"
        >
          <Search size={15} strokeWidth={1.75} aria-hidden />
          <span className="mdv-hdr__searchtext">Search or act</span>
          <kbd className="mdv-kbd mdv-hdr__chord">{keys}</kbd>
        </button>

        <div className="mdv-hdr__right">
          <HouseOfRecord />
          <HouseBell />
          <ThemeMenu className="mdv-hdr__theme" />
          <HouseUserMenu />
        </div>
      </div>
    </header>
  );
}

export default HouseHeader;
