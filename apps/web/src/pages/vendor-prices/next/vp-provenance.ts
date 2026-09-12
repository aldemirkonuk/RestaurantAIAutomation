/**
 * Where a price came from — the exponential idea of the /vendor-prices brief:
 * provenance clickable through to the source sentence.
 *
 * Every observed price opens its source. This module turns one register row
 * into the words and the ONE link the source sheet draws, and it is pure so
 * that every branch can be asserted without a browser:
 *
 *   invoice / confirmed order  → the order the paper belongs to
 *                                (`raw.orderId`, written by own-paper-sighting.ts)
 *   vendor feed                → the feed line's own reference (`sourceRef`),
 *                                plus the page it came from when one was kept
 *   public page                → the vendor's page (`sourceUrl`), with the
 *                                product anchor the sweep wrote
 *   rep message / social       → the URL the person pasted, if any; otherwise
 *                                the sentence saying no thread is linked —
 *                                no writer files a message thread yet
 *   told to us                 → who recorded it, when, and their note
 *
 * A row that names none of those still opens a sheet — with the sentence
 * saying what it could not link — because a rung that opens nothing is a
 * dead button and a row that hides its own thinness is a lie.
 */

import { ageWords, dateWords, isSourceType, money, packWords, SOURCE_META, sourceLabel } from './vp-format';

export interface RegisterObservation {
  id: string;
  scope: 'house' | 'market';
  providerId: string | null;
  vendorCatalogueId: string | null;
  vendorName: string | null;
  productName: string | null;
  masterWineId: string | null;
  identityId: string | null;
  sourceType: string;
  trustTier: number | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  rawPrice: number;
  currency: string;
  packSize: number;
  unitVolumeMl: number | null;
  observedAt: string;
  effectiveDate: string | null;
  parseConfidence: number | null;
  isOutlier: boolean;
  outlierReason: string | null;
  outlierBasis: string | null;
  outlierJudgedAt: string | null;
  raw: Record<string, unknown>;
}

export type ProvenanceKind = 'invoice' | 'order' | 'feed' | 'page' | 'message' | 'social' | 'hand' | 'unknown';

export interface ProvenanceLink {
  /** An in-app route (react-router `to`) … */
  to?: string;
  /** … or an outside page, opened in a new tab. Exactly one is set. */
  href?: string;
  label: string;
}

export interface Provenance {
  kind: ProvenanceKind;
  /** The sheet's eyebrow: the source word and its tier. */
  eyebrow: string;
  /** The sheet's title: what the row is a price of. */
  title: string;
  /** One sentence: what this row is, as the writer recorded it. */
  what: string;
  /** The link through, or null with `unlinked` saying why. */
  link: ProvenanceLink | null;
  unlinked: string | null;
  /** Who put it on the register, in words. */
  recordedBy: string;
  /** The person's own note, verbatim, or null. */
  note: string | null;
  /** The figure as quoted, with its pack, in its own currency. */
  asQuoted: string;
  /** When it was seen, and when it applies if the source said. */
  when: string;
  /** The stored write-time verdict, in the writer's own sentence. */
  verdict: string;
  /** Whose row: this house's own paper, or the openly posted market. */
  scopeWords: string;
  /** Which bottle the row names, or "unidentified" (ADR 0124). */
  identityWords: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function safeHttpUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The order id an own-paper row names — `raw.orderId`, or the `source:orderId` ref. */
export function orderIdOf(obs: Pick<RegisterObservation, 'raw' | 'sourceRef'>): string | null {
  const fromRaw = str(obs.raw?.orderId);
  if (fromRaw) return fromRaw;
  const ref = obs.sourceRef ?? '';
  const m = /^(receipt_verified|order_confirmed):(.+)$/.exec(ref);
  return m ? m[2] : null;
}

export function provenanceOf(obs: RegisterObservation): Provenance {
  const type = obs.sourceType;
  const meta = isSourceType(type) ? SOURCE_META[type] : null;
  const tier = obs.trustTier ?? meta?.tier ?? null;
  const eyebrow = `${sourceLabel(type)}${tier !== null ? ` · tier ${tier}` : ''}`;
  const title = obs.productName ?? 'Product not named on the row';
  const vendor = obs.vendorName ?? 'a vendor the row does not name';

  const asQuoted = `${money(obs.rawPrice, obs.currency)} for ${packWords(obs.packSize, obs.unitVolumeMl)}`;
  const when = obs.effectiveDate
    ? `seen ${ageWords(obs.observedAt)} (${dateWords(obs.observedAt)}); the source dates it ${dateWords(obs.effectiveDate)}`
    : `seen ${ageWords(obs.observedAt)} (${dateWords(obs.observedAt)}); the source gave no date of its own`;

  const verdict = obs.outlierReason
    ? `${obs.isOutlier ? 'Set aside' : 'Admitted'} — ${obs.outlierReason}`
    : 'No judge has looked at this row. That is not the same as judged clean.';

  const scopeWords =
    obs.scope === 'house'
      ? 'This house’s own row. No other house can read it.'
      : 'An openly posted row. Every house may read it; it names nobody’s terms.';

  const identityWords = obs.identityId
    ? `Names bottle identity ${obs.identityId}.`
    : 'Unidentified — no confirmed bottle identity names this row yet (ADR 0124). It is ranked by name and vintage alone, so a 375 ml and a 750 ml of one wine could share a rung.';

  const enteredByLabel = str(obs.raw?.enteredByLabel);
  const enteredBy = str(obs.raw?.enteredBy);
  const note = str(obs.raw?.note);
  const pastedUrl = safeHttpUrl(obs.sourceUrl);

  const origin = str(obs.raw?.origin);
  const priceHistorySource = str(obs.raw?.priceHistorySource);
  const orderId = orderIdOf(obs);

  // Own paper: a verified receipt (invoice, tier 1) or a confirmed order
  // (quote, tier 2). The document is the ORDER's paper; /orders opens it.
  if (origin === 'own_paper' || /^(receipt_verified|order_confirmed):/.test(obs.sourceRef ?? '')) {
    const isReceipt = type === 'invoice' || priceHistorySource === 'receipt_verified';
    const statedUnit = str(obs.raw?.statedUnit);
    return {
      kind: isReceipt ? 'invoice' : 'order',
      eyebrow,
      title,
      what: isReceipt
        ? `A line on a receipt from ${vendor} that this house verified. The gateway mirrored it into the register at verification; nobody typed it.`
        : `A line on an order to ${vendor} that the vendor confirmed. Mirrored at confirmation; not yet a bill.`,
      link: orderId
        ? { to: `/orders?highlight=${encodeURIComponent(orderId)}`, label: `Open order ${orderId.slice(0, 8)} on the orders book` }
        : null,
      unlinked: orderId ? null : 'The row names no order id, so there is no document to open. The reference it carries is printed below.',
      recordedBy: 'The gateway, from the house’s own paper (procurement/own-paper-sighting.ts).',
      note: statedUnit ? `The paper said "${statedUnit}" for the unit.` : note,
      asQuoted,
      when,
      verdict,
      scopeWords,
      identityWords,
    };
  }

  if (type === 'api_catalog') {
    return {
      kind: 'feed',
      eyebrow,
      title,
      what: `A line from a price file ${vendor} handed over, ingested as written (distributor-feed/catalog-ingest.service.ts).`,
      link: pastedUrl ? { href: pastedUrl, label: 'Open the file’s source page' } : null,
      unlinked: pastedUrl
        ? null
        : `The feed line carries its own reference — ${obs.sourceRef ?? 'none recorded'} — and no page to open.`,
      recordedBy: 'The gateway, from the vendor’s own price file.',
      note,
      asQuoted,
      when,
      verdict,
      scopeWords,
      identityWords,
    };
  }

  if (type === 'website_scrape') {
    return {
      kind: 'page',
      eyebrow,
      title,
      what: `A list price read off ${vendor}’s public page by the vendor-site sweep. Signed by nobody; compared only with other public-page prices.`,
      link: pastedUrl ? { href: pastedUrl, label: 'Open the vendor’s page' } : null,
      unlinked: pastedUrl ? null : 'The sweep kept no readable page URL on this row, so the page cannot be opened from here.',
      recordedBy: `The sweep, on ${dateWords(obs.observedAt)}${obs.parseConfidence !== null ? `, parse confidence ${Math.round(obs.parseConfidence * 100)}%` : ''}.`,
      note,
      asQuoted,
      when,
      verdict,
      scopeWords,
      identityWords,
    };
  }

  const who = enteredByLabel
    ? `Recorded by ${enteredByLabel}`
    : enteredBy
      ? `Recorded by a person whose name was not kept on the row (id ${enteredBy.slice(0, 8)}…)`
      : 'Recorded by a person the row does not name';

  if (type === 'chat') {
    return {
      kind: 'message',
      eyebrow,
      title,
      what: `A price a rep at ${vendor} sent by message, written down by the person who read it.`,
      link: pastedUrl ? { href: pastedUrl, label: 'Open the link the person kept' } : null,
      unlinked: pastedUrl
        ? null
        : 'No message thread is linked: the house inbox does not write price sightings yet, so this row holds only what the person typed. When it does, this sheet will open the thread.',
      recordedBy: `${who}, ${ageWords(obs.observedAt)}.`,
      note,
      asQuoted,
      when,
      verdict,
      scopeWords,
      identityWords,
    };
  }

  if (type === 'social') {
    return {
      kind: 'social',
      eyebrow,
      title,
      what: `A public post by ${vendor}, written down by a person. Often promotional.`,
      link: pastedUrl ? { href: pastedUrl, label: 'Open the post' } : null,
      unlinked: pastedUrl ? null : 'No post URL was kept with the row.',
      recordedBy: `${who}, ${ageWords(obs.observedAt)}.`,
      note,
      asQuoted,
      when,
      verdict,
      scopeWords,
      identityWords,
    };
  }

  if (type === 'manual' || type === 'quote') {
    return {
      kind: 'hand',
      eyebrow,
      title,
      what:
        type === 'quote'
          ? `A written quote from ${vendor}, recorded by a person.`
          : `A price from ${vendor} somebody was told and wrote down. The least-provenanced row the register holds.`,
      link: pastedUrl ? { href: pastedUrl, label: 'Open the link the person kept' } : null,
      unlinked: pastedUrl ? null : 'Nothing to open: the row is the record. Who wrote it and when is below.',
      recordedBy: `${who}, ${ageWords(obs.observedAt)}.`,
      note,
      asQuoted,
      when,
      verdict,
      scopeWords,
      identityWords,
    };
  }

  return {
    kind: 'unknown',
    eyebrow,
    title,
    what: `A row with a source this page has no words for (${type}). It is shown, not folded into another kind.`,
    link: pastedUrl ? { href: pastedUrl, label: 'Open the page the row names' } : null,
    unlinked: pastedUrl ? null : 'The row names nothing this page knows how to open.',
    recordedBy: who,
    note,
    asQuoted,
    when,
    verdict,
    scopeWords,
    identityWords,
  };
}
