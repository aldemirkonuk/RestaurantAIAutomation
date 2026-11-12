/**
 * The name a vendor sees in the From of an order letter (mail software, gap
 * G3, 2026-11-11): the house's display name, else its name.
 *
 * Undefined when neither can be read. The mail service then says "Mudavym",
 * as it always did: a failed read must not stop an order, and this never
 * invents a name. The template signature (`sender_identity`) is not used: it
 * is a sign-off line, often a person's name, not the house's.
 *
 * Shared by the procurement sender (which puts it in the envelope) and the
 * sender-identity route (which says it), so the page names exactly what a
 * vendor sees.
 */
export async function houseFromName(
  db: { from: (table: string) => any },
  restaurantId: string,
): Promise<string | undefined> {
  if (!restaurantId) return undefined;
  try {
    const { data: branding } = await db
      .from("restaurant_branding")
      .select("display_name")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    const display = String(branding?.display_name ?? "").trim();
    if (display) return display;
    const { data: house } = await db
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .maybeSingle();
    return String(house?.name ?? "").trim() || undefined;
  } catch {
    return undefined;
  }
}
