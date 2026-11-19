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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, Lightbulb, ArrowRight, Home, Sparkles, Inbox, RotateCw } from "lucide-react";
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
import { apiClient } from "../../services/api/client";
import { ASK_AI_OPEN_EVENT } from "../askai/events";
import { Panel } from "../mudavym/Sheet";
import { useMudavymShell } from "../../lib/mudavym/shellGround";
import { useShellPalette } from "../mudavym/shellPalette";
import { tuck, useReducedMotion } from "../../lib/mudavym/motion";
import "./command-palette.css";

const RECENTS_KEY = "wineops.command.recents";
const MAX_RECENTS = 5;

// "On the counter" and "Rooms" exist only under the app shell (sketch 119 D:
// the counter is the palette's first section, then the rooms); outside it the
// order is the original four, unchanged.
const SECTION_ORDER: CommandSection[] = [
  "On the counter",
  "Recent",
  "Rooms",
  "Insights",
  "Create",
  "Navigation",
];

/** The preview pane is behind a flag: a build flag, or this device's own switch. */
export const PREVIEW_STORAGE_KEY = "mudavym.palette.preview";
function previewOn(): boolean {
  if (import.meta.env.VITE_PALETTE_PREVIEW === "true") return true;
  try {
    return localStorage.getItem(PREVIEW_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** What Tab opens on a row that goes somewhere. */
type RowAction = "tab" | "copy";
const ROW_ACTIONS: ReadonlyArray<{ id: RowAction; label: string }> = [
  { id: "tab", label: "Open in a new tab" },
  { id: "copy", label: "Copy link" },
];

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
  const shell = useMudavymShell();
  const shellPalette = useShellPalette();
  const restaurantId = user?.restaurantId;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [topRec, setTopRec] = useState<Command | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  // Tab on a row that goes somewhere opens its actions in the foot.
  const [actions, setActions] = useState<{ index: number } | null>(null);
  // The one highlight pill: where it sits, and whether it may glide there yet.
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  const [pillLive, setPillLive] = useState(false);

  // Fetch the top recommendation once per open (insight-aware suggestion).
  useEffect(() => {
    if (!open || !restaurantId) return;
    let cancelled = false;
    apiClient
      .get<any>(`/analytics/recommendations/${restaurantId}`)
      .then(({ data: body }) => {
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
    // Under the app shell the rooms come from the ONE rooms table the rail
    // reads (so the palette can never offer a room the rail hides, or an
    // internal tool), and the counter's acts come first. Outside the shell
    // `shellPalette` is null and this is the original list.
    const statics = staticCommands();
    const base: Command[] = shellPalette
      ? [
          ...shellPalette.counter.map<Command>((row) => ({
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            section: "On the counter",
            icon: row.kind === "read" ? RotateCw : Inbox,
            keywords: row.keywords,
            action: row.run,
          })),
          ...shellPalette.rooms.map<Command>((room) => ({
            id: room.id,
            title: room.title,
            subtitle: room.subtitle,
            section: "Rooms",
            icon: statics.find((c) => c.section === "Navigation" && c.href === room.href)?.icon ?? ArrowRight,
            href: room.href,
          })),
          ...statics.filter((c) => c.section !== "Navigation"),
        ]
      : statics;

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

    // The Ask panel is reachable by ⌘⇧K, but a shortcut nobody is told about
    // is not a feature. It appears here too, and hands off to the same event.
    // One panel, two modes (ADR 0145, founder, 2026-09-26): ask the books, or
    // propose an action that only a seal applies.
    const askAi: Command = {
      id: "askai-open",
      title: "Ask Mudavym",
      subtitle: "Ask the books, or propose a reorder or a vendor reply — nothing runs without your seal",
      section: "Create",
      icon: Sparkles,
      keywords: "ask ai mudavym question books action propose reorder draft vendor natural language command",
      shortcut: "⌘ ⇧ K",
      action: () => window.dispatchEvent(new CustomEvent(ASK_AI_OPEN_EVENT)),
    };

    const merged = [...base, askAi, ...landing];
    return topRec ? [topRec, ...merged] : merged;
  }, [topRec, location.pathname, toast, shellPalette]);

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
  const found = useMemo(() => {
    const out: Command[] = [];
    for (const section of SECTION_ORDER) {
      for (const cmd of groups[section] ?? []) out.push(cmd);
    }
    return out;
  }, [groups]);

  // When a search finds nothing, the last row is the way on: ask the books.
  // (Only under the app shell, where it is drawn.)
  const askFallback = useMemo<Command>(
    () => ({
      id: "askai-nomatch",
      title: "Ask Mudavym",
      subtitle: "Nothing on the list matches. Ask the books in your own words.",
      section: "Create",
      icon: Sparkles,
      action: () => window.dispatchEvent(new CustomEvent(ASK_AI_OPEN_EVENT)),
    }),
    [],
  );
  const noMatch = shell.on && found.length === 0 && query.trim() !== "";
  const flat = useMemo(() => (noMatch ? [askFallback] : found), [noMatch, askFallback, found]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const run = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      // An act on the counter is not a place to return to: its id names one
      // record that is gone once it is sealed, so it is never a "recent".
      if (cmd.section !== "On the counter") pushRecent(cmd.id);
      onClose();
      if (cmd.action) cmd.action();
      else if (cmd.href) navigate(cmd.href);
    },
    [navigate, onClose],
  );

  const runAction = useCallback(
    (action: RowAction, cmd?: Command) => {
      const href = cmd?.href;
      if (!href) return;
      onClose();
      if (action === "tab") {
        window.open(href, "_blank", "noopener");
        return;
      }
      const link = `${window.location.origin}${href}`;
      const write = navigator.clipboard?.writeText(link);
      if (!write) {
        toast.error("This browser would not copy the link", { description: link });
        return;
      }
      write
        .then(() => toast.success("Link copied"))
        .catch(() => toast.error("The link was not copied", { description: link }));
    },
    [onClose, toast],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (shell.on && actions) {
      // The foot is showing this row's actions; the keys belong to it.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setActions({ index: (actions.index + 1) % ROW_ACTIONS.length });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runAction(ROW_ACTIONS[actions.index].id, flat[active]);
        return;
      }
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        // Esc backs out of the actions first; the Panel must not take it as "close".
        e.stopPropagation();
        setActions(null);
        return;
      }
      setActions(null);
    }
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
      // Keep focus inside the input (single focusable) — trap. Under the shell,
      // a row that goes somewhere answers Tab with its actions.
      e.preventDefault();
      if (shell.on && flat[active]?.href) setActions({ index: 0 });
    }
  };

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // Where the highlight pill goes: the active row's top and height inside the list.
  useLayoutEffect(() => {
    if (!open || !shell.on) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    if (!el) {
      setPill(null);
      return;
    }
    const next = { top: el.offsetTop, height: el.offsetHeight };
    setPill((p) => (p && p.top === next.top && p.height === next.height ? p : next));
  }, [open, shell.on, active, flat, query]);
  // It may glide only after it has been placed once: the first paint must not
  // slide in from the top of the list.
  useEffect(() => {
    if (!open) {
      setPillLive(false);
      return;
    }
    if (!pill) return;
    const id = requestAnimationFrame(() => setPillLive(true));
    return () => cancelAnimationFrame(id);
  }, [open, pill !== null]);
  useEffect(() => {
    setActions(null);
  }, [active, query, open]);

  if (!open) return null;

  if (shell.on) {
    let houseIdx = -1;
    const preview = previewOn();
    const current = flat[active];
    const renderRow = (cmd: Command, idx: number, recent: boolean) => {
      const Icon = cmd.icon;
      const isActive = idx === active;
      const glyph = (
        <Icon
          size={15}
          aria-hidden
          className="mdv-item__icon"
          style={isActive ? { color: "var(--seal)" } : undefined}
        />
      );
      return (
        <button
          key={cmd.id}
          type="button"
          id={`cmd-${cmd.id}`}
          data-idx={idx}
          role="option"
          aria-selected={isActive}
          className="mdv-item"
          style={{ ["--i" as string]: Math.min(idx, 10) }}
          onMouseMove={() => setActive(idx)}
          onClick={() => run(cmd)}
        >
          {recent ? <span className="mdv-palette__thumb">{glyph}</span> : glyph}
          <span className="mdv-item__text">
            <span className="mdv-item__label">{cmd.title}</span>
            {cmd.subtitle && <span className="mdv-item__sub">{cmd.subtitle}</span>}
          </span>
          {cmd.shortcut
            ? cmd.shortcut
                .split(" ")
                .map((k, i) => (
                  <kbd key={i} className="mdv-kbd">
                    {k}
                  </kbd>
                ))
            : isActive && (
                <span className="mdv-item__icon" aria-hidden>
                  {cmd.section === "Insights" && cmd.id.startsWith("rec-") ? (
                    <ArrowRight size={13} />
                  ) : (
                    <CornerDownLeft size={13} />
                  )}
                </span>
              )}
        </button>
      );
    };
    return (
      <Panel
        open={open}
        onClose={onClose}
        label="Command palette"
        showClose={false}
        className={`mdv-palette${preview ? " mdv-palette--preview" : ""}`}
        enter="lift"
        bodyClassName="mdv-ovl__body--flush"
        footer={
          <span className="mdv-palette__foot">
            {actions && current?.href ? (
              <span className="mdv-palette__foot-acts" role="group" aria-label="Actions for this row">
                {ROW_ACTIONS.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    className="mdv-palette__act"
                    aria-pressed={i === actions.index}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => runAction(a.id, current)}
                  >
                    {a.label}
                  </button>
                ))}
                <span>
                  <kbd className="mdv-kbd">←</kbd> <kbd className="mdv-kbd">→</kbd> to choose,{" "}
                  <kbd className="mdv-kbd">Enter</kbd> to do it
                </span>
              </span>
            ) : (
              <span>
                <kbd className="mdv-kbd">Enter</kbd> to {current?.href ? "open" : "run"}
                {current?.href ? (
                  <>
                    {" "}
                    · <kbd className="mdv-kbd">Tab</kbd> for actions
                  </>
                ) : null}
              </span>
            )}
            <span>
              <kbd className="mdv-kbd">?</kbd> for all shortcuts
            </span>
          </span>
        }
      >
        <div className="mdv-field">
          <Search size={15} aria-hidden style={{ color: "var(--ink-4)", flex: "none" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions, insights…"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-label="Search pages, actions, insights"
            aria-activedescendant={flat[active] ? `cmd-${flat[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="mdv-kbd">esc</kbd>
        </div>
        <div className="mdv-palette__split">
          <div id="command-list" ref={listRef} role="listbox" className="mdv-palette__list">
            {pill && (
              <span
                className="mdv-palette__pill"
                aria-hidden
                data-live={pillLive && !reduced ? "true" : undefined}
                style={{
                  clipPath: `inset(${pill.top}px 8px calc(100% - ${pill.top + pill.height}px) 8px round 8px)`,
                  transition: pillLive && !reduced ? `clip-path ${tuck.ms}ms ${tuck.easing}` : "none",
                }}
              />
            )}
            {noMatch ? (
              <>
                <p className="mdv-quiet">Nothing here matches “{query}”.</p>
                {renderRow(askFallback, 0, false)}
              </>
            ) : flat.length === 0 ? (
              <p className="mdv-quiet">Nothing here matches “{query}”.</p>
            ) : (
              SECTION_ORDER.filter((sec) => groups[sec]?.length).map((section) => (
                <div key={section}>
                  <span className="mdv-sect">{section}</span>
                  {groups[section].map((cmd) => {
                    houseIdx += 1;
                    return renderRow(cmd, houseIdx, section === "Recent");
                  })}
                </div>
              ))
            )}
          </div>
          {preview && (
            <aside className="mdv-palette__preview" aria-label="Preview of the highlighted row">
              {current && (
                <div key={current.id} className="mdv-palette__preview-body">
                  <span className="mdv-palette__preview-eyebrow">{current.section}</span>
                  <h3 className="mdv-palette__preview-title">{current.title}</h3>
                  {current.subtitle && <p className="mdv-palette__preview-sub">{current.subtitle}</p>}
                  {current.href && (
                    <span className="mdv-palette__preview-path">Opens {current.href}</span>
                  )}
                </div>
              )}
            </aside>
          )}
        </div>
      </Panel>
    );
  }

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
      <div className="mdv-palette-card relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden motion-safe:animate-[popIn_120ms_ease-out]">
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
