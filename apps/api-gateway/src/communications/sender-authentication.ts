/**
 * Did the receiving mail server say a letter did not come from the domain in
 * its From? (QA round 24, item 2; claim MAIL-ATTRIBUTION-IGNORES-AUTHENTICATION.)
 *
 * WHOSE VERDICT IS BELIEVED. Only the receiving server's own: the TOPMOST
 * `Authentication-Results` header of the message as the ingress hands it over,
 * and only when its authserv-id is that ingress's (`mx.google.com` for the
 * Gmail paths). A receiving server prepends its verdict (RFC 8601 §5); any
 * `Authentication-Results` the sender wrote sits further down. The header MAP
 * the publishers also send keeps the LAST value of a repeated header, i.e. the
 * sender's, so it is never read for this. The publisher picks the verdict out
 * of the ordered list (`ingressAuthenticationResults`) and sends it as
 * `ingress_authentication_results`; an ingress that gives no verdict of its
 * own (the dedicated-domain webhook today) sends none.
 *
 * WHAT COUNTS AS "COULD NOT CONFIRM" (`senderUnconfirmed`). The server said:
 *   - `dmarc=fail`, or
 *   - `spf=fail` for an envelope domain aligned with the From's domain, and no
 *     `dkim=pass` for a domain aligned with the From's domain.
 * A DKIM pass for another domain (the sender signing with its own) does not
 * confirm the From. `softfail`, `neutral`, `none`, `temperror`, `permerror`
 * and an absent verdict decide nothing: a vendor that publishes no SPF or
 * DMARC can still be imitated, and that residue is stated, not hidden.
 *
 * Mirrored in Python (`email_parsing_agent.py sender_unconfirmed`); the two
 * share their test tables by hand.
 */
import { senderDomain } from "./inbound-headers";

/** The Gmail paths' own authserv-id. */
export const GMAIL_AUTHSERV_ID = "mx.google.com";

/** Comments and quoted strings out, so `(dmarc=fail)` in a comment is not a result. */
function stripCommentsAndQuotes(value: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && (quoted || depth > 0)) {
      i++;
      continue;
    }
    if (quoted) {
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (ch === '"') {
      quoted = true;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The topmost `Authentication-Results` value in an ordered header list, when
 * its authserv-id is `authservId`; else null. Only the first such header is
 * looked at: a lower one is not the receiving server's.
 */
export function ingressAuthenticationResults(
  headers: ReadonlyArray<{ name?: string | null; value?: string | null }>,
  authservId: string = GMAIL_AUTHSERV_ID,
): string | null {
  const top = (headers ?? []).find(
    (h) => (h?.name ?? "").trim().toLowerCase() === "authentication-results",
  );
  const value = (top?.value ?? "").toString();
  const id = stripCommentsAndQuotes(value)
    .split(";")[0]
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase();
  return id && id === authservId.toLowerCase() ? value : null;
}

interface ResInfo {
  method: string;
  result: string;
  props: Record<string, string>;
}

function results(value: string): ResInfo[] {
  const parts = stripCommentsAndQuotes(value).split(";").slice(1);
  const out: ResInfo[] = [];
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const head = tokens.shift() ?? "";
    const m = head.toLowerCase().match(/^([a-z0-9-]+)=([a-z]+)$/);
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const t of tokens) {
      const eq = t.indexOf("=");
      if (eq > 0) props[t.slice(0, eq).toLowerCase()] = t.slice(eq + 1);
    }
    out.push({ method: m[1], result: m[2], props });
  }
  return out;
}

/** The domain a `header.d=`, `header.i=@x` or `smtp.mailfrom=a@x` names. */
function domainOfProp(v: string | undefined): string {
  const s = (v ?? "").trim().toLowerCase().replace(/^.*@/, "");
  return s.replace(/\.$/, "");
}

/** Relaxed alignment: one domain is the other or a subdomain of it. */
function aligned(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * True when the receiving server's verdict says the letter did not come from
 * `senderAddress`'s domain. False when it says nothing that decides it,
 * including when there is no verdict at all.
 */
export function senderUnconfirmed(
  ingressVerdict: string | null | undefined,
  senderAddress: string | null | undefined,
): boolean {
  const verdict = (ingressVerdict ?? "").toString();
  if (!verdict.trim()) return false;
  const fromDomain = senderDomain(senderAddress ?? "");
  const rs = results(verdict);
  if (rs.some((r) => r.method === "dmarc" && r.result === "fail")) return true;
  const spfFail = rs.some(
    (r) =>
      r.method === "spf" &&
      r.result === "fail" &&
      (r.props["smtp.mailfrom"] === undefined ||
        aligned(domainOfProp(r.props["smtp.mailfrom"]), fromDomain)),
  );
  if (!spfFail) return false;
  const dkimAligned = rs.some(
    (r) =>
      r.method === "dkim" &&
      r.result === "pass" &&
      aligned(domainOfProp(r.props["header.d"] ?? r.props["header.i"]), fromDomain),
  );
  return !dkimAligned;
}
