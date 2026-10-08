import { HttpException, HttpStatus } from "@nestjs/common";
import { roleSatisfies } from "../procurement/order-approval-gate";
import type { OrganizationsService } from "../organizations/organizations.service";

/**
 * Who may change the vendor book (VEN-W30, founder 2026-10-08: "Staff read
 * only"). Staff read the book, the sheets and the scorecard; adding, editing
 * or removing a vendor, its terms, contacts, branches or rating, and starting
 * a conversation with it, is a manager's or an owner's act — and the server is
 * where that holds, because a hidden button is not a rule.
 *
 * The same `resolveRestaurantRole` + `roleSatisfies` pair the usual-currency
 * write and the knowledge confirm already ask, never a second implementation.
 * `null` means "not proven to hold any role": a failed read and a person with
 * no row look the same here, and neither may pass.
 *
 * `act` names what was refused, in the house's words, as the start of a
 * sentence ("Adding a vendor").
 */
export async function assertVendorWriter(
  organizations: Pick<OrganizationsService, "resolveRestaurantRole">,
  userId: string,
  restaurantId: string,
  act: string,
): Promise<void> {
  const role = await organizations.resolveRestaurantRole(userId, restaurantId);
  if (roleSatisfies(role, "manager")) return;
  throw new HttpException(
    `${act} changes this house's vendor book, so it is a manager's or an owner's act — staff can read the book but not change it. ` +
      `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was changed. Ask a manager or an owner.`,
    HttpStatus.FORBIDDEN,
  );
}
