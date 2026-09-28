/**
 * Is this tree rendering inside the Mudavym app shell (sketch 119 D)?
 *
 * The shell owns the house header, so two things below it must stand down:
 *   - `PageGate`, which mounts a `HouseHeader` above every rebuilt page when
 *     there is no shell (PageGate.tsx) — under the shell that would be a
 *     second banner;
 *   - the legacy `Header` a legacy page renders for itself — under the shell
 *     its search, bell, theme and account controls are the shell's, so it
 *     keeps only its title and subtitle.
 *
 * `false` outside the shell, which is every tree while the `shell` gate is off:
 * both components then render exactly as they always have (ADR 0042's promise).
 */

import { createContext, useContext } from 'react';

export const HouseShellContext = createContext<boolean>(false);

export function useInHouseShell(): boolean {
  return useContext(HouseShellContext);
}
