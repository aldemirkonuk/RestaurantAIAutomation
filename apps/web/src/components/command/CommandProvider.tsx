/**
 * CommandProvider — mounts the command palette + shortcuts sheet and owns the
 * global keyboard system. Rendered once inside the authenticated layout.
 *
 *  ⌘K / Ctrl+K   toggle the command palette (NEW-001)
 *  ⌘⇧K          toggle the Ask AI bar (P3.C, FUTURES §8) — dispatched as an
 *               event so this file owns the binding without owning the surface
 *  ?             open the shortcut sheet (NEW-008)
 *  g then <key>  Gmail-style go-to nav (NEW-009 / NEW-677 / NEW-678)
 *
 * The ⌘K handler runs in the capture phase and stops propagation so the palette
 * is the single, consistent ⌘K surface across every page. Any component can
 * also open the palette by dispatching `window` event "wineops:command-open"
 * or via the `useCommandPalette()` hook (used by the header search button).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { RecentlyViewed } from "./RecentlyViewed";
import { GOTO_MAP, routeLabel } from "./commands";
import { ASK_AI_OPEN_EVENT } from "../askai/events";
import { recordView } from "./recents-store";
import { AuthContext } from "../../contexts/AuthContext";

/**
 * localStorage key for the default landing route (NEW-518 / NEW-681). Held
 * bare, it was one value per device, so on a shared tablet the next person was
 * sent to whatever the last one chose (F-438). It is only a prefix now; the
 * bare key is removed wherever it is still found.
 */
export const LANDING_KEY = "wineops.defaultLanding";

/** The landing page is one person's choice, kept per user on this device. */
export function landingKeyFor(userId: string | null | undefined): string | null {
  return userId ? `${LANDING_KEY}.${userId}` : null;
}

interface CommandContextValue {
  openPalette: () => void;
  openShortcuts: () => void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

/** Read the palette controls (e.g. to wire the header search button). */
export function useCommandPalette(): CommandContextValue {
  return (
    useContext(CommandContext) ?? { openPalette: () => {}, openShortcuts: () => {} }
  );
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable === true
  );
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Read without `useAuth` so the provider still mounts where no AuthProvider
  // is (its own tests); no signed-in person means no landing page to honour.
  const userId = useContext(AuthContext)?.user?.userId ?? null;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const gPending = useRef<number | null>(null);
  const overlayOpen = paletteOpen || shortcutsOpen || recentOpen;

  // Track visited routes for the recently-viewed switcher (NEW-034).
  useEffect(() => {
    recordView(location.pathname, routeLabel(location.pathname));
  }, [location.pathname]);

  /**
   * NEW-518 / NEW-681: default landing page. Fires exactly once per app boot,
   * and only when the app was ENTERED at "/" — a later deliberate visit to the
   * dashboard is never hijacked (the ref is already consumed). Stored in
   * localStorage per signed-in person (F-438); set/cleared from the ⌘K palette.
   */
  const bootRedirected = useRef(false);
  useEffect(() => {
    if (bootRedirected.current) return;
    bootRedirected.current = true;
    try {
      // The old device-wide value belongs to no one we can name.
      localStorage.removeItem(LANDING_KEY);
      const key = landingKeyFor(userId);
      const dest = key ? localStorage.getItem(key) : null;
      if (dest && dest !== "/" && location.pathname === "/") {
        navigate(dest, { replace: true });
      }
    } catch {
      /* storage unavailable — land on the dashboard as before */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPalette = useCallback(() => {
    setShortcutsOpen(false);
    setPaletteOpen(true);
  }, []);
  const openShortcuts = useCallback(() => {
    setPaletteOpen(false);
    setShortcutsOpen(true);
  }, []);

  // ⌘K / ⌘⇧O in capture phase → authoritative global shortcuts.
  useEffect(() => {
    const onCapture = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k" && e.shiftKey) {
        // ⌘⇧K — Ask AI (P3.C, FUTURES §8). Registered HERE, in the same switch
        // as ⌘K, because this file owns the global keyboard system: a second
        // capture listener elsewhere would race this one and the winner would
        // depend on mount order. The bar itself lives behind an event so this
        // file does not have to import it.
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        setShortcutsOpen(false);
        setRecentOpen(false);
        window.dispatchEvent(new CustomEvent(ASK_AI_OPEN_EVENT));
      } else if (key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((o) => !o);
      } else if (key === "o" && e.shiftKey) {
        // ⌘⇧O — recently-viewed switcher (NEW-034).
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        setShortcutsOpen(false);
        setRecentOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onCapture, { capture: true });
    return () => window.removeEventListener("keydown", onCapture, { capture: true } as any);
  }, []);

  // `?` and the `g`-then-key sequence (bubble phase; ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // g-then-key nav
      if (gPending.current) {
        const dest = GOTO_MAP[e.key.toLowerCase()];
        window.clearTimeout(gPending.current);
        gPending.current = null;
        if (dest) {
          e.preventDefault();
          navigate(dest.href);
          return;
        }
      }

      if (overlayOpen) return; // don't start new sequences over an overlay

      if (e.key === "?") {
        e.preventDefault();
        openShortcuts();
      } else if (e.key === "g" || e.key === "G") {
        gPending.current = window.setTimeout(() => {
          gPending.current = null;
        }, 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, overlayOpen, openShortcuts]);

  // Allow decoupled components (e.g. the header search button) to open it.
  useEffect(() => {
    const onOpen = () => openPalette();
    window.addEventListener("wineops:command-open", onOpen);
    return () => window.removeEventListener("wineops:command-open", onOpen);
  }, [openPalette]);

  // Lock background scroll while an overlay is open.
  useEffect(() => {
    if (!overlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlayOpen]);

  return (
    <CommandContext.Provider value={{ openPalette, openShortcuts }}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShortcuts={openShortcuts}
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <RecentlyViewed open={recentOpen} onClose={() => setRecentOpen(false)} />
    </CommandContext.Provider>
  );
}
