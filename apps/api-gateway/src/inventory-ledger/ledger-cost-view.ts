/**
 * Cost on a ledger row is an owner's and a manager's (r39 walk-w5 F3). A
 * purchase row carries its `unitCost` and `totalCost`; the route answered
 * staff 200 with both, so a figure the page hid still travelled to the
 * browser. The role is the one in the house the token names (`user.role`,
 * set by the JWT strategy); a role that is absent or unknown is staff, never
 * a manager by default.
 */
import type { InventoryTransactionResponseDto } from "./dto/inventory-ledger.dto";

export function seesLedgerCost(user: { role?: string | null } | undefined): boolean {
  const role = typeof user?.role === "string" ? user.role.trim().toLowerCase() : "";
  return role === "owner" || role === "manager";
}

export function withoutCost<T extends InventoryTransactionResponseDto | null | undefined>(
  row: T,
  user: { role?: string | null } | undefined,
): T {
  if (!row || seesLedgerCost(user)) return row;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { unitCost: _u, totalCost: _t, ...rest } = row as InventoryTransactionResponseDto;
  return rest as T;
}
