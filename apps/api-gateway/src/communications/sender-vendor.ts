import { likeExactly } from "./inbound-headers";

/** A live vendor of one house, as the inbound-mail match reads it. */
export interface SenderVendor {
  id: string;
  restaurant_id: string;
  name: string;
}

/**
 * The vendor a letter is from: a vendor of the receiving house, not
 * removed, that lists the sender's address (r28 mail audit, gaps 5 and 7).
 *
 * The house reader reads mail from every address in the vendor book
 * (`HouseLettersService.book`: `contact_email`, `primary_contact.email`
 * and `provider_contacts.email`), but the bridge used to match
 * `contact_email` alone. A letter from a vendor's accounts address was read
 * and then filed as a stranger's, or not kept. It also read removed vendors:
 * the house's unique address index holds among live rows only, so after a
 * vendor was removed and added again with the same address, `.limit(1)`
 * could file the letter under the removed one.
 *
 * The addresses are read in the book's order of strength, and the first
 * that names a vendor decides: `contact_email` (unique among a house's
 * live vendors), then `primary_contact.email`, then a contact row. An
 * address that two live vendors list at the same strength names neither:
 * the letter goes the way an unknown sender's does rather than under a
 * vendor it may not be from. Exact, never a pattern: a From of `%@%` must
 * not reach a vendor.
 *
 * A failed read THROWS: an unreadable book is not "nobody".
 *
 * One definition for two callers (r35 mail, gap 9): the inbound bridge,
 * which files a letter, and "Who is writing", which files a held letter
 * under the vendor a person vouches for. Both must name the same vendor.
 */
export async function findSenderVendor(
  db: { from: (table: string) => any },
  restaurantId: string,
  senderEmail: string,
  warn: (message: string) => void = () => undefined,
): Promise<SenderVendor | null> {
  const exact = likeExactly(senderEmail);
  const one = (rows: any[] | null, where: string) => {
    const ids = [...new Set((rows ?? []).map((r) => r.id))];
    if (ids.length > 1) {
      warn(
        `${ids.length} vendors of house ${restaurantId} list the sender in ${where}; filed under none`,
      );
      return "ambiguous" as const;
    }
    return (rows?.[0] as SenderVendor | undefined) ?? null;
  };

  for (const column of ["contact_email", "primary_contact->>email"]) {
    const { data, error } = await db
      .from("providers")
      .select("id, restaurant_id, name")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .ilike(column, exact)
      .limit(2);
    if (error) {
      throw new Error(`the vendor book could not be read (${error.message})`);
    }
    const hit = one(data, column);
    if (hit === "ambiguous") return null;
    if (hit) return hit;
  }

  const { data: contacts, error: contactError } = await db
    .from("provider_contacts")
    .select("provider_id")
    .ilike("email", exact)
    .limit(50);
  if (contactError) {
    throw new Error(
      `the vendor book's contact list could not be read (${contactError.message})`,
    );
  }
  const contactVendorIds = [
    ...new Set(
      (contacts ?? []).map((c: any) => c.provider_id).filter(Boolean),
    ),
  ];
  if (!contactVendorIds.length) return null;
  const { data: listed, error: listedError } = await db
    .from("providers")
    .select("id, restaurant_id, name")
    .in("id", contactVendorIds)
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null)
    .limit(2);
  if (listedError) {
    throw new Error(
      `the vendor book could not be read (${listedError.message})`,
    );
  }
  const hit = one(listed, "provider_contacts");
  return hit === "ambiguous" ? null : hit;
}
