/**
 * WHAT PUTS THIS PAPER'S PRICES ON ITS GOODS' COST (r28 invoices audit, G4).
 *
 * The swipe on /receipts confirms the transcription and nothing else. It was
 * the owner's natural "done": the card closed, and the paper's prices never
 * reached the goods' cost, because that happens in two other places. The door
 * count puts the goods on the shelf, provisionally costed, and verifying the
 * delivery (after agreeing it) writes the agreed price onto those lots. Nothing
 * on the card said so.
 *
 * This reads the deliveries the paper sits on (the same canonical read the
 * sheet above the card makes) and says the ONE next step, with where to take
 * it. It never takes the step: agreeing and verifying stay on the document's
 * gates, where the gateway explains a refusal in its own words.
 *
 * Pure: no React, no fetch.
 */

/** The fields of the gateway's delivery spine this reads. */
export interface SpineState {
  deliveryId: string;
  state: string;
  agreedAt: string | null;
  verifiedAt: string | null;
}

export type CostStepKind =
  | 'unread'
  | 'no_delivery'
  | 'agree'
  | 'verify'
  | 'settled'
  | 'closed'
  | 'several';

export interface CostNextStep {
  kind: CostStepKind;
  /** One sentence about the paper's prices and the goods' cost. */
  sentence: string;
  /** Where the step is taken, when it can be taken from a link. */
  link: { to: string; label: string } | null;
}

/**
 * `deliveries`: `undefined` while the read is in flight (nothing to say yet),
 * `null` when it failed (said, never read as "on no delivery"), `[]` when the
 * paper is on no delivery.
 */
export function costNextStep(
  documentId: string,
  deliveries: readonly SpineState[] | null | undefined,
): CostNextStep | null {
  if (deliveries === undefined) return null;
  const page = `/documents/${documentId}`;
  if (deliveries === null)
    return {
      kind: 'unread',
      sentence:
        'Whether this paper’s goods are on the shelf could not be read, so what puts its prices on their cost is not shown.',
      link: { to: page, label: 'Open the document' },
    };
  if (deliveries.length === 0)
    return {
      kind: 'no_delivery',
      sentence:
        'Its goods are not on the shelf yet. Count them at the door; agreeing and verifying that delivery then makes these prices their cost.',
      link: { to: `${page}?view=door`, label: 'Count them at the door' },
    };
  if (deliveries.length > 1)
    return {
      kind: 'several',
      sentence: `This paper is on ${deliveries.length} deliveries. Each delivery’s cost is settled on its own page, not from this paper.`,
      link: { to: page, label: 'See its deliveries' },
    };
  const d = deliveries[0];
  if (d.state === 'REJECTED' || d.state === 'CANCELLED')
    return {
      kind: 'closed',
      sentence: `Its delivery was ${d.state === 'REJECTED' ? 'rejected' : 'cancelled'}, so these prices settle no cost.`,
      link: null,
    };
  if (d.verifiedAt)
    return {
      kind: 'settled',
      sentence: 'Its delivery is verified, so these prices are the cost of what it put on the shelf.',
      link: null,
    };
  if (d.agreedAt)
    return {
      kind: 'verify',
      sentence:
        'Its delivery is agreed. These prices become the goods’ cost when the delivery is verified.',
      link: { to: page, label: 'Verify the delivery' },
    };
  return {
    kind: 'agree',
    sentence:
      'Its goods are on the shelf at a provisional cost. These prices become their cost when the delivery is agreed and then verified.',
    link: { to: page, label: 'Agree and verify the delivery' },
  };
}
