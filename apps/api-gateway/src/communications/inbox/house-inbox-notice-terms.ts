/**
 * Whether a reading grant may ask Gmail for delivery notices (DD-r109-11,
 * narrowed by the selector; r110 mail-fix item 4).
 *
 * The rule: the second query, `from:(mailer-daemon OR postmaster)`, runs only
 * for a grant whose RECORDED consent names it. The record is the grant's own
 * consent receipt (`integration_oauth_connections.consent_receipt_id` ->
 * `integration_consent_receipts.disclosure_snapshot`, ADR 0144): the exact
 * words the person sealed. Those words name the notices when the snapshot's
 * `integration.dataHandling.notices` is a sentence. A grant consented to
 * before that sentence existed, a grant with no receipt, and a receipt for
 * another house, person or integration all read the vendor book alone. A
 * receipt that cannot be read is "not named": the read is never widened on a
 * failed read.
 *
 * Reading the words, not a version number, follows ADR 0224's rule for the
 * house data terms (`house_data_terms_gate.py`): what the person saw is what
 * is checked.
 */
import type { DatabaseService } from "../../database/database.service";

/** True when a sealed disclosure snapshot names the delivery-notice read for this integration. */
export function snapshotNamesNotices(snapshot: unknown, integrationId: string): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const integration = (snapshot as { integration?: unknown }).integration;
  if (!integration || typeof integration !== "object") return false;
  const { id, dataHandling } = integration as { id?: unknown; dataHandling?: unknown };
  if (id !== integrationId || !dataHandling || typeof dataHandling !== "object") return false;
  const notices = (dataHandling as { notices?: unknown }).notices;
  return typeof notices === "string" && notices.trim().length > 0;
}

export type NoticeTerms = { named: boolean; failed: string | null };

/**
 * The grant's own consent, read by its connection id: its receipt, which must
 * belong to the same person, house and integration.
 */
export async function grantNamesNotices(
  db: DatabaseService,
  grant: { connectionId: string; userId: string; restaurantId: string; integrationId: string },
): Promise<NoticeTerms> {
  const conn = await db.client
    .from("integration_oauth_connections")
    .select("consent_receipt_id")
    .eq("id", grant.connectionId)
    .maybeSingle();
  if (conn.error) return { named: false, failed: `the grant's consent could not be read (${conn.error.message})` };
  const receiptId = (conn.data as { consent_receipt_id?: unknown } | null)?.consent_receipt_id;
  if (typeof receiptId !== "string" || !receiptId) return { named: false, failed: null };
  const receipt = await db.client
    .from("integration_consent_receipts")
    .select("user_id, restaurant_id, integration_id, disclosure_snapshot")
    .eq("seal_id", receiptId)
    .maybeSingle();
  if (receipt.error) return { named: false, failed: `the grant's consent receipt could not be read (${receipt.error.message})` };
  const r = receipt.data as
    | { user_id?: unknown; restaurant_id?: unknown; integration_id?: unknown; disclosure_snapshot?: unknown }
    | null;
  if (!r || r.user_id !== grant.userId || r.restaurant_id !== grant.restaurantId || r.integration_id !== grant.integrationId) {
    return { named: false, failed: null };
  }
  return { named: snapshotNamesNotices(r.disclosure_snapshot, grant.integrationId), failed: null };
}
