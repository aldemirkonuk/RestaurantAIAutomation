/**
 * GroundChoiceSync — the person's ground follows their account, ADR 0169.
 *
 * The founder, 2026-09-21, answering the two forks ADR 0169 left open:
 * **"Always paper, follows account."** Part one (first visit is paper, never
 * the device's light/dark setting) was already built. Part two is this file:
 * the choice is no longer a property of the browser it was made in.
 *
 * WHAT THIS IS, AND WHY IT IS A COMPONENT
 * ---------------------------------------
 * `lib/mudavym/groundChoice.ts` is a small synchronous store, deliberately
 * ignorant of the network — `styles/mudavym.css`, `shellGround.ts` and every
 * overlay read it during render and cannot await anything. This component is
 * the one place that joins that store to the account, and renders nothing.
 * It is mounted once, near the root of `App.tsx`, inside the
 * `QueryClientProvider`.
 *
 * NO SECOND PREFERENCES SYSTEM, NO MIGRATION
 * ------------------------------------------
 * The ground rides in the preferences blob this app already has:
 * `user_preferences.preferences` is a JSONB column with a `UNIQUE (user_id)`
 * key (`supabase/migrations/20260805000000_baseline_from_production.sql:5797`
 * and `:8135`), reached through `GET`/`PATCH /users/:userId/preferences`,
 * whose DTO takes an open `Record<string, any>` and whose service deep-merges
 * a partial. A `ground` key therefore needs no column, no migration, no DTO
 * change and no gateway change at all — see ADR 0169's 2026-09-21 entry. It
 * also keeps this lane clear of PR #411, which is rewriting that controller's
 * handler signatures at the same time.
 *
 * It reuses `useUserPreferences()` rather than issuing its own request: the
 * query key is the same, so react-query serves both from one round trip that
 * the app was making anyway.
 *
 * THE THREE STATES THAT ARE NOT "PAPER"
 * -------------------------------------
 * A page paints before the gateway answers. The store's `source` field keeps
 * the four different meanings of "paper" apart (see its doc), and this
 * component is what puts it in each of them:
 *
 *   - sign-in / sign-out / account switch → `setGroundOwner`, which applies
 *     this device's mirror for the NEW person (never the previous person's)
 *     or paper, marked `device-cache` / `unknown`;
 *   - the account answered → `applyAccountGround`, marked `account`, or
 *     `default` when the person has simply never chosen;
 *   - the account could NOT be read → `reportGroundReadFailure`. It is not
 *     reported as paper-by-default: `ThemeMenu` marks no option active and
 *     says the ground could not be read. A failed read is never an answer
 *     (CLAUDE.md §9).
 */

import { useEffect } from 'react';
import { useAuthStore } from '../../stores';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import {
  applyAccountGround,
  registerGroundWriter,
  reportGroundReadFailure,
  setGroundOwner,
  type GroundChoice,
} from './groundChoice';

export function GroundChoiceSync(): null {
  const userId = useAuthStore((s) => s.user?.userId) ?? null;
  const { preferences, isPlaceholderData, error, updatePreferencesAsync } =
    useUserPreferences();

  // Who the choice belongs to. Runs before the reconciliation below on the
  // same commit, so a new person never has the previous one's ground applied
  // for even one render.
  useEffect(() => {
    setGroundOwner(userId);
  }, [userId]);

  // How a choice reaches the account. Cleared on sign-out so that choosing a
  // ground with no session reports itself unsaved rather than silently
  // dropping the write.
  useEffect(() => {
    if (!userId) {
      registerGroundWriter(null);
      return;
    }
    const write = (choice: GroundChoice) => updatePreferencesAsync({ ground: choice });
    registerGroundWriter(write);
    return () => registerGroundWriter(null);
  }, [userId, updatePreferencesAsync]);

  // What the account says. Order matters: `error` is checked first, because
  // `placeholderData: {}` leaves `preferences` looking like an empty (and so
  // perfectly valid) answer even when the request failed.
  useEffect(() => {
    if (!userId) return;
    if (error) {
      reportGroundReadFailure(
        error instanceof Error && error.message
          ? error.message
          : 'the preferences request failed',
      );
      return;
    }
    if (isPlaceholderData) return; // still unknown — not "paper".
    applyAccountGround(preferences.ground);
  }, [userId, error, isPlaceholderData, preferences.ground]);

  return null;
}
