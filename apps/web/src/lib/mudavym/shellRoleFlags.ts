/**
 * The shell's role + room-visibility flags — one place, so `HouseShell` and
 * anything mounted inside its `<Outlet/>` (the in-app 404, `ShellCatchAll`)
 * read the identical values rather than two copies drifting apart.
 *
 * Role is the person's role IN THIS HOUSE (ADR 0162): the branch role first,
 * the account-level role only while the branch role is still resolving.
 * Hiding a room from a role here is cosmetic — the gateway refuses
 * regardless (rooms.ts's own doc).
 */

import { useContext, useMemo } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { useMudavymDesign } from './useMudavymDesign';
import type { RoomFlags, ShellRole } from './rooms';

export function normalRole(r: unknown): ShellRole {
  return r === 'owner' || r === 'manager' || r === 'staff' ? r : null;
}

export function useShellRoleFlags(): { role: ShellRole; flags: RoomFlags } {
  const auth = useContext(AuthContext);
  const role = normalRole(auth?.activeRole ?? auth?.user?.role ?? null);
  const connectionsOn = useMudavymDesign('connections');
  const flags = useMemo(() => ({ connections: connectionsOn }), [connectionsOn]);
  return { role, flags };
}
