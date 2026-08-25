/**
 * CommandPalette — the global ⌘K command palette (NEW-001…NEW-004).
 *
 * Bulletproofing:
 *  • a11y: role=dialog/aria-modal, listbox+option roles, aria-activedescendant,
 *    focus trap, focus restore on close, reduced-motion aware.
 *  • Keyboard: ↑/↓ move, Enter run, Esc close, Home/End, wrap-around.
 *  • Recents (NEW-004): last-used commands persisted to localStorage, pinned top.
 *  • Instant local fuzzy ranking; no network on keystroke.
 *  • Unique edge: surfaces the engine's top recommendation as a live "Act"
 *    suggestion (fetched once per open, fails quiet) — the palette is
 *    insight-aware, not just a nav switcher.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, Lightbulb, ArrowRight, Home } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { LANDING_KEY } from "./CommandProvider";
import {
  Command,
  CommandSection,
  rankCommands,
  routeLabel,
  staticCommands,
} from "./commands";

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || "http://localhost:4000";
const RECENTS_KEY = "wineops.command.recents";
const MAX_RECENTS = 5;

const SECTION_ORDER: CommandSection[] = ["Recent", "Insights", "Create", "Navigation"];

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [topRec, setTopRec] = useState<Command | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Fetch the top recommendation once per open (insight-aware suggestion).
  useEffect(() => {
    if (!open || !restaurantId) return;
    let cancelled = false;
    fetch(`${API_URL}/api/v1/analytics/recommendations/${restaurantId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const rec = body?.recommendations?.[0];
        if (rec)
          setTopRec({
            id: `rec-${rec.ruleKey}`,
            title: rec.recommendation,
            subtitle: `Top recommendation · ${rec.category}`,
            section: "Insights",
            icon: Lightbulb,
            href: `/recommendations?insight=${encodeURIComponent(rec.ruleKey)}`,
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, restaurantId]);

  // Reset + focus management on open/close.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement;
      setQuery("");
      setActive(0);
      // Focus after paint so the dialog is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      restoreFocusRef.current?.focus?.();
    }
  }, [open]);

  const recentIds = useMemo(() => (open ? loadRecents() : []), [open]);

  const allCommands = useMemo(() => {
    const base = staticCommands();

    // NEW-518 / NEW-681: default landing page, set from wherever you are.
    // Per-device (localStorage); CommandProvider honors it once per app boot.
    const here = location.pathname;
    const stored = (() => {
      try { return localStorage.getItem(LANDING_KEY); } catch { return null; }
    })();
    const landing: Command[] = [];
    if (here !== "/" && here !== stored) {
      landing.push({
        id: "landing-set",
        title: `Set "${routeLabel(here)}" as default landing page`,
        subtitle: "Opens this page after sign-in on this device",
        section: "Navigation",
        icon: Home,
        keywords: "default landing homepage start page after login",
        action: () => {
          try { localStorage.setItem(LANDING_KEY, here); } catch { /* ignore */ }
          toast.success(`${routeLabel(here)} is now your landing page`, {
            description: "Applies on this device, next time you open the app.",
          });
        },
      });
    }
    if (stored && stored !== "/") {
      landing.push({
        id: "landing-clear",
        title: `Clear default landing page (currently ${routeLabel(stored)})`,
        section: "Navigation",
        icon: Home,
        keywords: "default landing homepage reset dashboard",
        action: () => {
          try { localStorage.removeItem(LANDING_KEY); } catch { /* ignore */ }
          toast.success("Landing page reset to Dashboard");
        },
      });
    }

    const merged = [...base, ...landing];
    return topRec ? [topRec, ...merged] : merged;
  }, [topRec, location.pathname, toast]);

  // Ranked + grouped result set.
  const groups = useMemo(() => {
    const ranked = rankCommands(allCommands, query);
    const byId = new Map(allCommands.map((c) => [c.id, c]));
    const g: Record<string, Command[]> = {};

    if (!query.trim()) {
      // Recents first (NEW-004), then the natural sections.
      const recents = recentIds
        .map((id) => byId.get(id))
        .filter((c): c is Command => !!c);
      if (recents.length) g.Recent = recents;
      for (const { cmd } of ranked) {
        if (recentIds.includes(cmd.id)) continue;
        (g[cmd.section] ||= []).push(cmd);
      }
    } else {
      for (const { cmd } of ranked) (g[cmd.section] ||= []).push(cmd);
    }
    return g;
  }, [allCommands, query, recentIds]);

  // Flatten in display order for keyboard navigation.
  const flat = useMemo(() => {
    const out: Command[] = [];
    for (const section of SECTION_ORDER) {
      for (const cmd of groups[section] ?? []) out.push(cmd);
    }
    return out;
  }, [groups]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const run = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      pushRecent(cmd.id);
      onClose();
      if (cmd.action) cmd.action();
      else if (cmd.href) navigate(cmd.href);
    },
    [navigate, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      // Keep focus inside the input (single focusable) — trap.
      e.preventDefault();
    }
  };

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  let renderIdx = -1;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-gray-900/40 motion-safe:animate-[fadeIn_120ms_ease-out]"
        aria-hidden
      />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden motion-safe:animate-[popIn_120ms_ease-out]">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions, insights…"
            className="flex-1 py-3.5 text-sm bg-transparent outline-none placeholder:text-gray-400"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={flat[active] ? `cmd-${flat[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline text-[10px] font-medium text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div
          id="command-list"
          ref={listRef}
          role="listbox"
          className="max-h-[52vh] overflow-y-auto py-2"
        >
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No matches for “{query}”.
            </div>
          ) : (
            SECTION_ORDER.filter((s) => groups[s]?.length).map((section) => (
              <div key={section} className="mb-1">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {section}
                </div>
                {groups[section].map((cmd) => {
                  renderIdx += 1;
                  const idx = renderIdx;
                  const Icon = cmd.icon;
                  const isActive = idx === active;
                  return (
                    <button
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      data-idx={idx}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => run(cmd)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left ${
                        isActive ? "bg-wine-50" : ""
                      }`}
                    >
                      <span
                        className={`shrink-0 p-1.5 rounded-lg ${
                          isActive ? "bg-wine-100 text-wine-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-gray-900 truncate">
                          {cmd.title}
                        </span>
                        {cmd.subtitle && (
                          <span className="block text-xs text-gray-400 truncate">
                            {cmd.subtitle}
                          </span>
                        )}
                      </span>
                      {cmd.shortcut && (
                        <span className="shrink-0 flex items-center gap-0.5">
                          {cmd.shortcut.split(" ").map((k, i) => (
                            <kbd
                              key={i}
                              className="text-[10px] font-medium text-gray-400 border border-gray-200 rounded px-1.5 py-0.5"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      )}
                      {isActive && !cmd.shortcut && (
                        <span className="shrink-0 flex items-center text-gray-300">
                          {cmd.section === "Insights" && cmd.id.startsWith("rec-") ? (
                            <ArrowRight className="w-3.5 h-3.5" />
                          ) : (
                            <CornerDownLeft className="w-3.5 h-3.5" />
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <kbd className="border border-gray-200 rounded px-1">↑</kbd>
            <kbd className="border border-gray-200 rounded px-1">↓</kbd>
            to navigate
          </span>
          <span className="flex items-center gap-1.5">
            Press <kbd className="border border-gray-200 rounded px-1">?</kbd> for all shortcuts
          </span>
        </div>
      </div>

      {/* Local keyframes (respect reduced motion via motion-safe classes above). */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn { from { opacity: 0; transform: translateY(-6px) scale(.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  );
}
