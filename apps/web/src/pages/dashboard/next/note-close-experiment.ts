/**
 * `note_close_control` — the browser half of the experiment on how a written
 * one-tap note is closed.
 *
 * THE FOUNDER'S WORDS (2026-09-05), which are the whole reason this exists:
 *
 *     "lets try both, 80 percent simple 20 percent signature"
 *
 * asked whether the note keeps the plain button it got on 2026-09-05 (commit
 * be80f8b5 — the wax rationed to acts that move stock or money) or gets the
 * hold-to-approve die back. The answer was neither: try both and count.
 *
 * WHY A COPY OF THE CONSTANTS AND NOT AN IMPORT. Same reason as
 * `one-tap-acts.ts`: pages do not import from the gateway, and a shared package
 * for four numbers would be a build dependency for a sentence. The gateway is
 * the authority — it is what assigns, and the arm ALWAYS comes off the wire.
 * The constants here are for the report line's wording and for the fallback,
 * and `note-close-experiment.test.tsx` pins them against the gateway's file.
 *
 * WHAT THE BROWSER MAY NOT DO. It may not choose an arm, and it may not name
 * one when recording. `useNoteCloseArm` renders nothing until the gateway
 * answers; a failed read renders the PLAIN arm and says the experiment could
 * not be read, which is a different sentence from an assignment. And
 * `recordNoteCloseEvent` sends only the event — the server stamps the arm from
 * the stored assignment, because a measurement the measured party labels is not
 * a measurement.
 */

import { useEffect, useRef, useState } from 'react';
import { apiClient, getErrorMessage } from '@/services/api/client';

export const NOTE_CLOSE_KEY = 'note_close_control';

/** The split the founder set. Mirrors `ux-optimizer/experiments.ts`. */
export const NOTE_CLOSE_RATIO: Readonly<Record<NoteCloseArm, number>> = {
  plain: 80,
  die: 20,
};

export const NOTE_CLOSE_FOUNDER_WORDS =
  'lets try both, 80 percent simple 20 percent signature';

export const NOTE_CLOSE_DECIDED_ON = '2026-09-05';

export type NoteCloseArm = 'plain' | 'die';

/**
 * The arm served when the experiment cannot be read. It is `plain` because
 * `plain` is the product as built: an unreadable experiment must fall back to
 * what the house would have seen anyway, never to the variant.
 */
export const NOTE_CLOSE_FALLBACK_ARM: NoteCloseArm = 'plain';

function isArm(value: unknown): value is NoteCloseArm {
  return value === 'plain' || value === 'die';
}

/**
 * reading — the gateway has not answered yet; the card shows no control
 * unreadable — it refused or broke; the card falls back to plain AND SAYS SO
 * assigned — a real arm, from the gateway's stored assignment
 */
export type ArmRegister =
  | { state: 'reading' }
  | { state: 'unreadable'; message: string }
  | { state: 'assigned'; arm: NoteCloseArm; recorded: boolean };

/**
 * Which arm this house is on.
 *
 * Keyed by restaurant like every other read on this page: a response that lands
 * after the restaurant was switched is discarded, because showing the previous
 * house's arm would put wax on a card that should not have it and file the
 * outcome against the wrong denominator.
 */
export function useNoteCloseArm(restaurantId: string | null): ArmRegister {
  const [register, setRegister] = useState<ArmRegister>({ state: 'reading' });
  const tenant = useRef<string | null>(restaurantId);
  const alive = useRef(true);

  useEffect(() => {
    tenant.current = restaurantId;
    setRegister({ state: 'reading' });
  }, [restaurantId]);

  useEffect(() => {
    alive.current = true;
    if (!restaurantId) return () => { alive.current = false; };
    const forTenant = restaurantId;
    void (async () => {
      try {
        const res = await apiClient.get<{ arm?: unknown; recorded?: unknown }>(
          `/ux/experiments/${NOTE_CLOSE_KEY}`,
        );
        if (!alive.current || tenant.current !== forTenant) return;
        const arm = res.data?.arm;
        if (!isArm(arm)) {
          // An answer whose arm is not one of the two declared arms is not an
          // assignment, and rendering the fallback silently would turn a
          // deployment mismatch into a permanent, invisible re-weighting.
          setRegister({
            state: 'unreadable',
            message: `the gateway answered with an arm this page does not know (${String(arm)})`,
          });
          return;
        }
        setRegister({ state: 'assigned', arm, recorded: res.data?.recorded === true });
      } catch (err) {
        if (!alive.current || tenant.current !== forTenant) return;
        setRegister({ state: 'unreadable', message: getErrorMessage(err) });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [restaurantId]);

  return register;
}

/** What the card actually draws, and whether it must say why. */
export function armToDraw(register: ArmRegister): NoteCloseArm | null {
  if (register.state === 'assigned') return register.arm;
  if (register.state === 'unreadable') return NOTE_CLOSE_FALLBACK_ARM;
  return null;
}

export interface NoteCloseEvent {
  event: 'exposed' | 'completed' | 'abandoned';
  actionId?: string;
  /** Milliseconds from exposure to completion. Only read on a completion. */
  durationMs?: number;
}

/**
 * Record one exposure or outcome.
 *
 * Fire-and-forget, and it never throws into the UI: a note that was written
 * down must not appear to have failed because a measurement did not land. The
 * cost of that is stated where the counts are read — an unrecorded event makes
 * every count a FLOOR, and both arms lose the same cases.
 *
 * There is deliberately no `arm` field. The gateway stamps it.
 */
export function recordNoteCloseEvent(input: NoteCloseEvent): void {
  void apiClient
    .post(`/ux/experiments/${NOTE_CLOSE_KEY}/events`, {
      event: input.event,
      ...(input.actionId ? { actionId: input.actionId } : {}),
      ...(input.event === 'completed' && typeof input.durationMs === 'number'
        ? { durationMs: Math.max(0, Math.round(input.durationMs)) }
        : {}),
    })
    .catch(() => undefined);
}

/* ── the report line ─────────────────────────────────────────────────────── */

export interface NoteCloseCounts {
  arm: NoteCloseArm | null;
  exposures: number;
  completed: number;
  abandoned: number;
  since: string | null;
  /**
   * Whether the experiment is still running.
   *
   * NULL means the gateway did not say — an older build, or a field that did
   * not arrive. It is deliberately not `true`: an experiment that has ENDED and
   * is reported as running is a page claiming a measurement that stopped, which
   * is the same absence-as-health shape as a failed count printed as zero. The
   * line says nothing about the window in that case rather than guessing.
   */
  running: boolean | null;
  /**
   * The arm a person named after the end. Null while running, and after the end
   * until somebody names one — never the plain arm by default.
   */
  winnerArm: NoteCloseArm | null;
}

export type ReportRegister =
  | { state: 'reading' }
  | { state: 'unreadable'; message: string }
  | { state: 'ready'; counts: NoteCloseCounts };

export function useNoteCloseReport(restaurantId: string | null): ReportRegister {
  const [register, setRegister] = useState<ReportRegister>({ state: 'reading' });
  const tenant = useRef<string | null>(restaurantId);
  const alive = useRef(true);

  useEffect(() => {
    tenant.current = restaurantId;
    setRegister({ state: 'reading' });
  }, [restaurantId]);

  useEffect(() => {
    alive.current = true;
    if (!restaurantId) return () => { alive.current = false; };
    const forTenant = restaurantId;
    void (async () => {
      try {
        const res = await apiClient.get<Record<string, unknown>>(
          `/ux/experiments/${NOTE_CLOSE_KEY}/report`,
        );
        if (!alive.current || tenant.current !== forTenant) return;
        const d = res.data ?? {};
        setRegister({
          state: 'ready',
          counts: {
            arm: isArm(d.arm) ? d.arm : null,
            exposures: numberOr0(d.exposures),
            completed: numberOr0(d.completed),
            abandoned: numberOr0(d.abandoned),
            since: typeof d.since === 'string' ? d.since : null,
            running: typeof d.running === 'boolean' ? d.running : null,
            winnerArm: isArm(d.winnerArm) ? d.winnerArm : null,
          },
        });
      } catch (err) {
        if (!alive.current || tenant.current !== forTenant) return;
        setRegister({ state: 'unreadable', message: getErrorMessage(err) });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [restaurantId]);

  return register;
}

function numberOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const ARM_WORDS: Record<NoteCloseArm, string> = {
  plain: 'the plain button',
  die: 'the die',
};

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The line itself. COUNTS, NEVER A VERDICT — no percentage of one arm is set
 * beside another's, no arrow, no "winning". It also says the one thing that
 * would otherwise be read wrongly: assignment is per HOUSE, so a house sees one
 * arm, and the other arm's figures are other houses' and are not shown here.
 */
export function noteCloseReportLine(register: ReportRegister): string | null {
  const ratio = `plain ${NOTE_CLOSE_RATIO.plain}% / die ${NOTE_CLOSE_RATIO.die}%`;
  const stem = `Note control — ${ratio}, set by the founder on ${shortDate(`${NOTE_CLOSE_DECIDED_ON}T12:00:00Z`) ?? NOTE_CLOSE_DECIDED_ON}.`;

  if (register.state === 'reading') return null;

  if (register.state === 'unreadable')
    return `${stem} The counts could not be read (${register.message}), so none are shown — this is not a zero.`;

  const { arm, exposures, completed, abandoned, since, running, winnerArm } = register.counts;

  /**
   * What the end adds, and only when the gateway actually said the window
   * closed. `running === null` means it did not say, so nothing is claimed
   * either way. There is deliberately no branch that names an arm when
   * `winnerArm` is null: an ended experiment with no winner says exactly that.
   */
  const ending =
    running === false
      ? winnerArm
        ? ` This experiment has ended, and the founder named ${ARM_WORDS[winnerArm]} — every house sees it now.`
        : ' This experiment has ended. No winner is recorded, and none is assumed until the founder names one.'
      : '';

  if (!arm)
    return `${stem} This house has not been assigned an arm yet, so nothing has been counted.${ending}`;

  if (exposures === 0)
    return `${stem} This house is on ${ARM_WORDS[arm]}; no note has been put in front of anyone here yet.${ending}`;

  const when = shortDate(since);
  return (
    `${stem} This house is on ${ARM_WORDS[arm]}: ${exposures} shown, ${completed} closed, ` +
    `${abandoned} left standing${when ? `, since ${when}` : ''}. ` +
    `Counts, not a verdict — and a house sees one arm, so the other arm's figures belong to other houses ` +
    `and are not shown here. A note left by closing the tab is not counted, in either arm.${ending}`
  );
}
