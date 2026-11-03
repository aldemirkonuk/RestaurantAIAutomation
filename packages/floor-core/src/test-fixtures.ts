/**
 * Shared fixtures for the floor-core specs, moved out of `time-logic.spec.ts`
 * when it was split by module (only `export` added). Not exported from the
 * package (`index.ts` does not list it) and not a spec (jest runs `*.spec.ts`).
 */
export const MIN = 60_000;
export const T0 = Date.parse("2026-07-22T12:00:00Z");
export const at = (m: number) => new Date(T0 + m * MIN).toISOString();

/** House settings the checker's scripts used: warn 10, late 15. */
export const WARN = 10;
export const LATE = 15;
