/**
 * ShortcutsSheet — global keyboard cheat sheet (NEW-008). Opened with `?`.
 *
 * Two branches, one content model. While a Mudavym page is on screen this wears
 * the house `Panel` (ADR 0112); otherwise it renders exactly the markup it
 * always did, byte for byte — that is ADR 0042's promise and the test at
 * ShortcutsSheet.test.tsx pins the class strings.
 */

import { X } from "lucide-react";
import { Panel } from "../mudavym/Sheet";
import { useMudavymShell } from "../../lib/mudavym/shellGround";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Global",
    items: [
      ["⌘ K", "Open the command palette"],
      ["⌘ ⇧ K", "Ask AI for an action (you confirm before anything runs)"],
      ["⌘ ⇧ O", "Jump back to a recently-viewed page"],
      ["?", "Show this shortcut sheet"],
      ["g then d / i / o", "Go to Dashboard / Inventory / Orders"],
      ["g then w / r / p", "Go to Wines / Reports / Providers"],
      ["g then c / t / n / s", "Go to Calendar / Team / Notifications / Settings"],
      ["Esc", "Close the topmost overlay"],
    ],
  },
  {
    title: "Palette",
    items: [
      ["↑ / ↓", "Move selection"],
      ["Enter", "Run the selected command"],
      ["Home / End", "Jump to first / last"],
    ],
  },
  {
    title: "Recommendations",
    items: [
      ["j / k", "Move between cards"],
      ["a / d / s", "Act / Dismiss / Snooze focused card"],
      ["e / x", "Explain / Select focused card"],
    ],
  },
  {
    title: "Calendar",
    items: [
      ["t", "Jump to today"],
      ["m / w / d / a", "Month / Week / Day / Agenda view"],
      ["n", "New event"],
      ["← / →", "Previous / next period"],
    ],
  },
];

export function ShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const shell = useMudavymShell();
  if (!open) return null;

  if (shell.on) {
    return (
      <Panel
        open={open}
        onClose={onClose}
        label="Keyboard shortcuts"
        eyebrow="The house"
        title="Keyboard shortcuts"
        footer="Page-specific shortcuts appear in each page's toolbar."
      >
        {GROUPS.map((group) => (
          <div key={group.title}>
            <span className="mdv-sect">{group.title}</span>
            <ul style={{ listStyle: "none", margin: 0, padding: "0 0 6px" }}>
              {group.items.map(([keys, desc]) => (
                <li key={keys} className="mdv-item" style={{ cursor: "default" }}>
                  <span className="mdv-item__text">
                    <span className="mdv-item__label" style={{ whiteSpace: "normal" }}>
                      {desc}
                    </span>
                  </span>
                  <kbd className="mdv-kbd">{keys}</kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-gray-900/40" aria-hidden />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {group.title}
              </div>
              <ul className="space-y-2">
                {group.items.map(([keys, desc]) => (
                  <li key={keys} className="flex items-start justify-between gap-3">
                    <span className="text-xs text-gray-600 leading-snug">{desc}</span>
                    <kbd className="shrink-0 text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="px-5 py-2.5 border-t border-gray-100 text-[11px] text-gray-400">
          Page-specific shortcuts appear in each page's toolbar.
        </div>
      </div>
    </div>
  );
}
