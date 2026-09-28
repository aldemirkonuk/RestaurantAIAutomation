/**
 * OneTapSheet — "A one-tap action of your own", the owed act on `/`.
 *
 * WHAT WAS OWED. The rebuilt rail (`OneTapPanel`) could raise a person's action
 * from a four-field expander: title, a line of context, a URL and a priority.
 * The two legacy surfaces it replaced could do more — `QuickActionsPanel.tsx:332`
 * let a person pick an ICON and a colour theme and then EDIT or DELETE the
 * action afterwards, and `pages/Notifications.tsx:1705` added templates and a
 * live preview. Census 102 gives the act a SHEET: a person's own act is one
 * object, and writing one is not scanning a list — the reader leaves the rail
 * behind while they compose it.
 *
 * WHAT CARRIES OVER, AND THE ONE THING THAT DOES NOT
 * --------------------------------------------------
 * Carried: title, description, where it is done (with the legacy's own href
 * rule — `data/quickActions.ts:206`), how much it presses, the MARK it wears,
 * editing an action already on the rail, and taking one off it.
 *
 * NOT carried, deliberately: the six-colour theme picker (wine · emerald ·
 * blue · amber · rose · purple). ADR 0112 rule 8 gives this house ONE chromatic
 * colour — İznik teal, `--seal` — on paper or warm charcoal. A per-action
 * colour is the thing that rule exists to refuse, so the field is dropped
 * rather than re-skinned; the gateway keeps its `color` column and simply never
 * hears from this sheet. The MARK replaces it: a small lucide glyph the card
 * actually renders, so the field means something on the rail rather than being
 * a value only the database sees.
 *
 * WHAT IT WRITES, AND WHERE
 * -------------------------
 *   create  POST   /one-tap-actions              one-tap-actions.controller.ts:146
 *   edit    PUT    /one-tap-actions/:actionId    one-tap-actions.controller.ts:195
 *   remove  DELETE /one-tap-actions/:actionId    one-tap-actions.controller.ts:333
 *
 * Every one of them takes `restaurant_id` and the author from the token
 * (`createAction` stamps `user.userId`, the `public.users` id the JWT carries),
 * never from this body. The sheet sends no restaurant and no author at all.
 *
 * THE THREE TRIGGERS THE CENSUS DREW. The drawing offers "When I tap it", "On a
 * threshold" and "On a schedule". Only the first exists: `one_tap_actions` has
 * no trigger column and no scheduler reads it. The other two are rendered
 * DISABLED with the sentence that says what is not built — ADR 0083, and the
 * same treatment `one-tap-acts.ts` already gives an unbuilt workflow. A chip
 * that silently did nothing would be exactly the "absence reported as health"
 * fault this layer is being built to end.
 *
 * THE STUB (sketch 103, 1b). Esc does not destroy what was typed: the form
 * state lives on the panel, so closing the sheet leaves a stub on the rail's
 * opener and re-opening finds the words where they were left. Nothing in a
 * kitchen is thrown away because someone walked past it.
 */

import { useMemo, useRef, type CSSProperties, type FormEvent } from 'react';
import {
  Bell,
  BookOpen,
  Boxes,
  ClipboardList,
  Hand,
  Lock,
  Mail,
  Truck,
  Wine,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Sheet } from '@/components/mudavym';
import type { OneTapAction, Register } from './OneTapPanel';

/**
 * The marks an action may wear.
 *
 * A closed set, not free text: the card renders the glyph, so a name the map
 * does not hold would draw nothing and the person who chose it would never know
 * why. `Zap` is the gateway's own default (`one-tap-actions.service.ts:227`), so
 * it is first and an action written before this sheet existed still draws.
 */
export const ONE_TAP_MARKS: { name: string; icon: LucideIcon; label: string }[] = [
  { name: 'Zap', icon: Zap, label: 'A standing act' },
  { name: 'Wine', icon: Wine, label: 'A bottle' },
  { name: 'Boxes', icon: Boxes, label: 'Stock' },
  { name: 'Truck', icon: Truck, label: 'A delivery' },
  { name: 'Mail', icon: Mail, label: 'A letter' },
  { name: 'ClipboardList', icon: ClipboardList, label: 'A list' },
  { name: 'BookOpen', icon: BookOpen, label: 'The book' },
  { name: 'Bell', icon: Bell, label: 'A reminder' },
];

const MARK_BY_NAME = new Map(ONE_TAP_MARKS.map((m) => [m.name, m.icon]));

/** The glyph an action wears, or `Zap` — never nothing, never an invented one. */
export function markFor(name: string | null | undefined): LucideIcon {
  return (name && MARK_BY_NAME.get(name)) || Zap;
}

/**
 * The legacy rule for where an action goes, verbatim from
 * `data/quickActions.ts:206-208`. Restated rather than imported because a page
 * under `pages/<page>/next` does not depend on the legacy data module it replaces;
 * the citation is the contract, and `OneTapSheet.test.tsx` pins all four cases.
 */
export function isPlaceAnActionCanGo(href: string): boolean {
  const h = href.trim();
  return h.startsWith('/') || h.startsWith('https://') || h.startsWith('http://');
}

export interface OneTapDraft {
  title: string;
  description: string;
  actionUrl: string;
  priority: 'low' | 'medium' | 'high';
  mark: string;
}

export const EMPTY_DRAFT: OneTapDraft = {
  title: '',
  description: '',
  actionUrl: '',
  priority: 'medium',
  mark: 'Zap',
};

/** Whether the draft holds anything a person would mind losing. */
export function draftHasWords(d: OneTapDraft): boolean {
  return (
    d.title.trim() !== '' ||
    d.description.trim() !== '' ||
    d.actionUrl.trim() !== '' ||
    d.mark !== EMPTY_DRAFT.mark ||
    d.priority !== EMPTY_DRAFT.priority
  );
}

/** The draft an action already on the rail reads back as. */
export function draftOf(a: OneTapAction & { icon?: string | null }): OneTapDraft {
  const p = a.priority === 'low' || a.priority === 'high' ? a.priority : 'medium';
  return {
    title: a.title ?? '',
    description: a.description ?? '',
    actionUrl: a.actionUrl ?? '',
    priority: p,
    mark: a.icon ?? 'Zap',
  };
}

const PRESSES: { value: OneTapDraft['priority']; label: string }[] = [
  { value: 'low', label: 'When there is time' },
  { value: 'medium', label: 'Today' },
  { value: 'high', label: 'Before service' },
];

export interface OneTapSheetProps {
  open: boolean;
  onClose: () => void;
  /** The draft, owned by the rail so Esc leaves a stub rather than a bin. */
  draft: OneTapDraft;
  onDraft: (next: OneTapDraft) => void;
  /** The action being edited, or null when this is a new one. */
  editing: OneTapAction | null;
  /** Write it. Resolves when the gateway accepted it; throws otherwise. */
  onSave: (draft: OneTapDraft, editingId: string | null) => Promise<void>;
  /** Take an action off the rail. Only offered while editing one. */
  onRemove: (id: string) => Promise<void>;
  busy: boolean;
  /** The last thing that did NOT happen, in the gateway's own words. */
  failureNote: string | null;
  /** The rail's own read — so an unreadable rail is never drawn as an empty one. */
  register: Register;
}

export function OneTapSheet({
  open,
  onClose,
  draft,
  onDraft,
  editing,
  onSave,
  onRemove,
  busy,
  failureNote,
  register,
}: OneTapSheetProps) {
  const titleRef = useRef<HTMLInputElement | null>(null);

  const urlProblem = useMemo(() => {
    const h = draft.actionUrl.trim();
    if (h === '') return null;
    return isPlaceAnActionCanGo(h)
      ? null
      : 'Where it is done has to start with / for a page in this house, or with https:// for somewhere outside it. Nothing is saved until it does.';
  }, [draft.actionUrl]);

  const canSave = draft.title.trim() !== '' && !urlProblem && !busy;

  const set = (patch: Partial<OneTapDraft>) => onDraft({ ...draft, ...patch });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    void onSave(draft, editing?.id ?? null).catch(() => undefined);
  };

  const field: CSSProperties = {
    fontSize: 12.5,
    width: '100%',
    marginTop: 4,
    padding: '7px 9px',
    borderRadius: 4,
    border: '1px solid var(--paper-2)',
    background: 'var(--paper-0)',
    color: 'var(--ink-1)',
  };

  /* The rail's own count, and — when it could not be read — the fact that it
     could not be read. An action written against a rail nobody could count is
     still written; it is the COUNT that is unknown, and it says so. */
  const railLine =
    register.state === 'ready'
      ? `${register.rows.length} ${register.rows.length === 1 ? 'action stands' : 'actions stand'} on this rail, read just now.`
      : register.state === 'loading'
        ? 'The rail is still being read, so how many actions stand on it is not known yet.'
        : register.failure.forbidden
          ? `The rail refused this account (${register.failure.status ?? 'refused'}), so how many actions stand on it is unknown — this is not an empty rail.`
          : `The rail could not be read (${register.failure.message}), so how many actions stand on it is unknown — this is not an empty rail.`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* THE CONTRACT IS THE NAME (sketch 103, 1e). What it asks, what it
         writes, what leaving costs — one sentence, and the ear gets the same
         thing the eye does. */
      label={
        editing
          ? 'Change an action on the rail. Saving writes it to this house’s rail under your name. Leaving writes nothing and keeps your words.'
          : 'Write a one-tap action of your own. Saving puts it on this house’s rail under your name. Leaving writes nothing and keeps your words.'
      }
      eyebrow="The rail"
      title={editing ? 'Change this action' : 'A one-tap action of your own'}
      closeLabel="Leave it"
      initialFocusRef={titleRef}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-inkm-4">
            An action names what it will do before it does it.
          </span>
          <div className="flex items-center gap-2">
            {editing && (
              <button
                type="button"
                disabled={busy}
                data-testid="one-tap-remove"
                onClick={() => void onRemove(editing.id).catch(() => undefined)}
                className="rounded border border-paper-2 px-2.5 py-1.5 text-[11.5px] text-inkm-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
              >
                Take it off the rail
              </button>
            )}
            <button
              type="submit"
              form="one-tap-form"
              disabled={!canSave}
              data-testid="one-tap-save"
              className="dn-ink rounded border border-seal-ring bg-seal-tint px-3 py-1.5 text-[11.5px] font-semibold text-seal disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            >
              {busy
                ? 'Writing it down…'
                : editing
                  ? 'Save the change'
                  : 'Put it on the rail'}
            </button>
          </div>
        </div>
      }
    >
      <form id="one-tap-form" onSubmit={submit} className="flex flex-col gap-3.5">
        <label className="block text-[11px] text-inkm-4">
          What it does
          <input
            ref={titleRef}
            style={field}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Reorder Öküzgözü to par"
            data-testid="one-tap-title"
            required
          />
        </label>

        <label className="block text-[11px] text-inkm-4">
          A line of context (optional)
          <input
            style={field}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Two bottles left against a par of six"
            data-testid="one-tap-description"
          />
        </label>

        <label className="block text-[11px] text-inkm-4">
          Where it is done (optional)
          <input
            style={field}
            value={draft.actionUrl}
            onChange={(e) => set({ actionUrl: e.target.value })}
            placeholder="/inventory"
            aria-invalid={urlProblem ? true : undefined}
            data-testid="one-tap-url"
          />
        </label>
        {urlProblem && (
          <p role="status" data-testid="one-tap-url-problem" className="-mt-2 text-[11px] text-inkm-2">
            {urlProblem}
          </p>
        )}

        <fieldset className="border-0 p-0">
          <legend className="text-[11px] text-inkm-4">How much it presses</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PRESSES.map((p) => {
              const on = draft.priority === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ priority: p.value })}
                  className={`rounded border px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal ${
                    on
                      ? 'border-seal-ring bg-seal-tint font-semibold text-seal'
                      : 'border-paper-2 text-inkm-2'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0">
          <legend className="text-[11px] text-inkm-4">The mark it wears</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ONE_TAP_MARKS.map((m) => {
              const on = draft.mark === m.name;
              const Icon = m.icon;
              return (
                <button
                  key={m.name}
                  type="button"
                  aria-pressed={on}
                  aria-label={m.label}
                  title={m.label}
                  onClick={() => set({ mark: m.name })}
                  className={`rounded border p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal ${
                    on ? 'border-seal-ring bg-seal-tint text-seal' : 'border-paper-2 text-inkm-2'
                  }`}
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden />
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* ── Runs ──────────────────────────────────────────────────────────
            One of these three exists. The other two say so rather than
            pretending: `one_tap_actions` carries no trigger, and nothing reads
            this table on a threshold or a clock. ADR 0083. */}
        <fieldset className="border-0 p-0">
          <legend className="text-[11px] text-inkm-4">Runs</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span
              data-testid="one-tap-trigger-tap"
              className="inline-flex items-center gap-1.5 rounded border border-seal-ring bg-seal-tint px-2 py-1 text-[11px] font-semibold text-seal"
            >
              <Hand size={11} strokeWidth={1.75} aria-hidden />
              When I tap it
            </span>
            {['On a threshold', 'On a schedule'].map((label) => (
              <button
                key={label}
                type="button"
                disabled
                aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded border border-paper-2 px-2 py-1 text-[11px] text-inkm-4 opacity-60"
              >
                <Lock size={11} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-inkm-4" data-testid="one-tap-trigger-note">
            An action on this rail runs when a person taps it. Running on a threshold or on a
            clock is not built — the book of actions holds no trigger and nothing watches it — so
            those two are shut rather than saved and ignored.
          </p>
        </fieldset>

        <p className="border-t border-paper-2 pt-2.5 text-[11px] text-inkm-4">
          {railLine} An action you write is recorded against your name, and the seal still sits on
          any write it leads to — putting it on the rail buys nothing and sends nothing.
        </p>

        {failureNote && (
          <p role="status" data-testid="one-tap-failure" className="text-[11.5px] text-inkm-2">
            {failureNote}
          </p>
        )}
      </form>
    </Sheet>
  );
}

export default OneTapSheet;
