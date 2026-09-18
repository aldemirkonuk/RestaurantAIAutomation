/**
 * The recommendations digest as a letter: subject, HTML and plain text.
 *
 * WHAT IT MAY SAY
 * ---------------
 * Only what the engine said. Each entry is the engine's own three sentences —
 * `observation`, `recommendation`, `rationale` — copied, never rephrased and
 * never recomputed: a digest that re-derived "12% below average Tuesdays" from
 * its own query would be a second engine, and the first time the two disagreed
 * the mail would be the one that was wrong. Beside each entry goes where it came
 * from — the rule that fired, its category, when it first stood — and at the top,
 * when the engine read and how many rules it evaluated.
 *
 * WHAT IT LOOKS LIKE
 * ------------------
 * Branded Mudavym and set as a DECLARED PAPER SURFACE (ADR 0138: charcoal is the
 * ground, paper only where declared). Mail is the case for declaring it: most
 * clients repaint or strip a dark body, and a letter that renders as black text
 * on a black ground in somebody's inbox is not a letter. The colours are the
 * paper tokens of `apps/web/src/styles/mudavym.css`. Inline styles only; no
 * external fonts, images or trackers.
 */

import {
  ISO_WEEKDAY_WORDS,
  URGENCY_WORDS,
  hourWords,
  isDigestUrgency,
  sourcesUnreadWords,
  type DigestFrequency,
  type DigestUrgency,
} from "./digest-schedule";

/** The paper tokens (mudavym.css, `[data-ground="paper"]`). */
const PAPER = {
  ground: "#fffdf8",
  panel: "#f3efe6",
  rule: "#eae4d8",
  ink1: "#211c16",
  ink2: "#4f473c",
  ink3: "#7c7365",
  seal: "#1a5e6b",
} as const;

export const MUDAVYM_SUPPORT_ADDRESS = "support@mudavym.com";

export interface DigestEntry {
  ruleKey: string;
  category: string;
  urgency: string;
  observation: string;
  recommendation: string;
  rationale: string;
  firstSeenAt: string | null;
}

export interface DigestLetterInput {
  houseName: string;
  recipientName: string | null;
  frequency: DigestFrequency;
  weekday: number | null;
  hour: number;
  timeZone: string;
  /** True when the house has no zone and `timeZone` is the UTC stand-in. */
  timeZoneIsFallback: boolean;
  urgencyFloor: DigestUrgency;
  /** The entries this letter carries, already capped. */
  entries: DigestEntry[];
  /** How many stood at or above the floor — may exceed `entries.length`. */
  standing: number;
  rulesEvaluated: number;
  engineGeneratedAt: string;
  /**
   * Engine sources that did not answer on this read. Absent or empty = all
   * answered. When present the letter says so above the entries: a digest
   * built on a partial reading must not read as the whole book.
   */
  sourcesUnread?: string[];
  subscribedAt: string;
  unsubscribeUrl: string;
  /** Origin of the web app, or null when none is configured (links are then omitted). */
  appOrigin: string | null;
}

export interface DigestLetter {
  subject: string;
  html: string;
  text: string;
}

// The quotes are written \x22 and \x27: check_analytics_cost_honesty's scrubber
// does not know regex literals and would read a bare quote as an open string.
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\x22/g, "&quot;")
    .replace(/\x27/g, "&#39;");
}

/** No header can be split by a value we did not write. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * RFC 2047 for a subject that is not plain ASCII. House names are not ("Sim
 * Vanilla Kaleiçi"), and neither the Gmail raw path nor every client agrees on
 * what an 8-bit header means. An ASCII subject is passed through untouched.
 */
export function encodeSubject(subject: string): string {
  const flat = oneLine(subject);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(flat)) return flat;
  return `=?UTF-8?B?${Buffer.from(flat, "utf8").toString("base64")}?=`;
}

function dateIn(iso: string, timeZone: string, withTime: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unreadable date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
      : {}),
  }).format(d);
}

function cadenceWords(i: DigestLetterInput): string {
  const at = `${hourWords(i.hour)} ${i.timeZone}`;
  return i.frequency === "weekly"
    ? `every ${ISO_WEEKDAY_WORDS[i.weekday ?? 0] || "week"} at ${at}`
    : `every day at ${at}`;
}

function entryLink(appOrigin: string | null, ruleKey: string): string | null {
  if (!appOrigin) return null;
  return `${appOrigin}/recommendations?insight=${encodeURIComponent(ruleKey)}`;
}

export function buildDigestLetter(i: DigestLetterInput): DigestLetter {
  const n = i.entries.length;
  const house = oneLine(i.houseName) || "your house";
  const floorWords = URGENCY_WORDS[i.urgencyFloor];
  const readAt = dateIn(i.engineGeneratedAt, i.timeZone, true);

  const subject = encodeSubject(
    `Mudavym: ${i.standing} recommendation${i.standing === 1 ? "" : "s"} standing at ${house}`,
  );

  const lead =
    `${i.standing} ${i.standing === 1 ? "entry stands" : "entries stand"} in ${house}'s recommendations at or above "${floorWords}", ` +
    `as the engine read them on ${readAt} (${i.rulesEvaluated} rules evaluated). ` +
    `The sentences below are the engine's own; nothing in this letter was recomputed for it.`;
  const partial = sourcesUnreadWords(i.sourcesUnread ?? []);
  const more =
    i.standing > n
      ? `${i.standing - n} more ${i.standing - n === 1 ? "stands" : "stand"} on the page; this letter carries the first ${n}, pinned entries first.`
      : null;
  const zoneNote = i.timeZoneIsFallback
    ? `This house has not set its time zone, so ${hourWords(i.hour)} is read in UTC. Setting the zone moves the digest to the house's own morning.`
    : null;
  const why = `You get this ${cadenceWords(i)} because you asked for it on ${dateIn(i.subscribedAt, i.timeZone, false)}.`;
  const stop =
    "Stopping it takes one click and no sign-in, and stops only this digest from this house.";

  // ── plain text ────────────────────────────────────────────────────────────
  const textLines: string[] = [
    "MUDAVYM",
    `Recommendations digest: ${house}`,
    "",
    lead,
  ];
  if (more) textLines.push(more);
  if (partial) textLines.push(partial);
  textLines.push("");
  i.entries.forEach((e, idx) => {
    const urgency = isDigestUrgency(e.urgency)
      ? URGENCY_WORDS[e.urgency]
      : e.urgency;
    const standing = e.firstSeenAt
      ? `standing since ${dateIn(e.firstSeenAt, i.timeZone, false)}`
      : "first sighting not recorded";
    textLines.push(`${idx + 1}. [${urgency}] ${oneLine(e.observation)}`);
    textLines.push(`   Do: ${oneLine(e.recommendation)}`);
    textLines.push(`   Why: ${oneLine(e.rationale)}`);
    textLines.push(`   From rule ${e.ruleKey} · ${e.category} · ${standing}`);
    const link = entryLink(i.appOrigin, e.ruleKey);
    if (link) textLines.push(`   Open it: ${link}`);
    textLines.push("");
  });
  textLines.push(why);
  if (zoneNote) textLines.push(zoneNote);
  textLines.push(`${stop} ${i.unsubscribeUrl}`);
  textLines.push(`Questions: ${MUDAVYM_SUPPORT_ADDRESS}`);
  const text = textLines.join("\n");

  // ── html ──────────────────────────────────────────────────────────────────
  const entryHtml = i.entries
    .map((e) => {
      const urgency = isDigestUrgency(e.urgency)
        ? URGENCY_WORDS[e.urgency]
        : e.urgency;
      const standing = e.firstSeenAt
        ? `standing since ${escapeHtml(dateIn(e.firstSeenAt, i.timeZone, false))}`
        : "first sighting not recorded";
      const link = entryLink(i.appOrigin, e.ruleKey);
      return `
      <tr><td style="padding:18px 0;border-top:1px solid ${PAPER.rule};">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PAPER.seal};margin:0 0 6px;">${escapeHtml(urgency)}</div>
        <div style="font-size:16px;line-height:1.45;color:${PAPER.ink1};margin:0 0 8px;">${escapeHtml(e.observation)}</div>
        <div style="font-size:14px;line-height:1.5;color:${PAPER.ink1};margin:0 0 6px;"><strong>Do:</strong> ${escapeHtml(e.recommendation)}</div>
        <div style="font-size:14px;line-height:1.5;color:${PAPER.ink2};margin:0 0 8px;"><strong>Why:</strong> ${escapeHtml(e.rationale)}</div>
        <div style="font-size:12px;line-height:1.5;color:${PAPER.ink3};">From rule <code style="font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(e.ruleKey)}</code> · ${escapeHtml(e.category)} · ${standing}${
          link
            ? ` · <a href="${escapeHtml(link)}" style="color:${PAPER.seal};">Open it in Mudavym</a>`
            : ""
        }</div>
      </td></tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(`Mudavym · ${house}`)}</title></head>
<body style="margin:0;padding:0;background:${PAPER.panel};font-family:Georgia,'Times New Roman',serif;color:${PAPER.ink1};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER.panel};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${PAPER.ground};border:1px solid ${PAPER.rule};">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:${PAPER.seal};">Mudavym</div>
          <h1 style="font-size:22px;font-weight:normal;line-height:1.3;margin:10px 0 0;color:${PAPER.ink1};">Recommendations digest — ${escapeHtml(house)}</h1>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <p style="font-size:14px;line-height:1.55;color:${PAPER.ink2};margin:0 0 6px;">${escapeHtml(lead)}</p>
          ${more ? `<p style="font-size:14px;line-height:1.55;color:${PAPER.ink2};margin:0 0 6px;">${escapeHtml(more)}</p>` : ""}
          ${partial ? `<p style="font-size:14px;line-height:1.55;color:${PAPER.ink1};margin:0;"><strong>Partial reading.</strong> ${escapeHtml(partial)}</p>` : ""}
        </td></tr>
        <tr><td style="padding:8px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${entryHtml}
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid ${PAPER.rule};">
          <p style="font-size:12px;line-height:1.6;color:${PAPER.ink3};margin:0 0 6px;">${escapeHtml(why)}</p>
          ${zoneNote ? `<p style="font-size:12px;line-height:1.6;color:${PAPER.ink3};margin:0 0 6px;">${escapeHtml(zoneNote)}</p>` : ""}
          <p style="font-size:12px;line-height:1.6;color:${PAPER.ink3};margin:0 0 6px;">${escapeHtml(stop)} <a href="${escapeHtml(i.unsubscribeUrl)}" style="color:${PAPER.seal};">Stop this digest</a></p>
          <p style="font-size:12px;line-height:1.6;color:${PAPER.ink3};margin:0;">Questions: <a href="mailto:${MUDAVYM_SUPPORT_ADDRESS}" style="color:${PAPER.seal};">${MUDAVYM_SUPPORT_ADDRESS}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

/**
 * The page a person lands on from the unsubscribe link, and the page the stop
 * returns. Rendered by the gateway, not the web app, so that it works with no
 * session, no bundle and no flag — the link in a mail has to keep working when
 * everything else about the product has changed. Same paper surface as the mail.
 *
 * GET never stops anything: mail scanners follow links. The stop is a POST —
 * the button on this page, or a client's RFC 8058 one-click.
 */
export function unsubscribePage(p: {
  title: string;
  body: string;
  /** When present, a button that POSTs back to the same URL. */
  confirmLabel?: string | null;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(`Mudavym · ${p.title}`)}</title></head>
<body style="margin:0;padding:0;background:${PAPER.panel};font-family:Georgia,'Times New Roman',serif;color:${PAPER.ink1};">
  <main style="max-width:520px;margin:48px auto;padding:28px 32px;background:${PAPER.ground};border:1px solid ${PAPER.rule};">
    <div style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:${PAPER.seal};">Mudavym</div>
    <h1 style="font-size:22px;font-weight:normal;line-height:1.3;margin:10px 0 14px;">${escapeHtml(p.title)}</h1>
    <p style="font-size:15px;line-height:1.55;color:${PAPER.ink2};margin:0 0 20px;">${escapeHtml(p.body)}</p>
    ${
      p.confirmLabel
        ? `<form method="post" action=""><button type="submit" style="font:inherit;font-size:15px;padding:10px 18px;background:${PAPER.seal};color:${PAPER.ground};border:0;cursor:pointer;">${escapeHtml(p.confirmLabel)}</button></form>`
        : ""
    }
    <p style="font-size:12px;line-height:1.6;color:${PAPER.ink3};margin:24px 0 0;">Questions: <a href="mailto:${MUDAVYM_SUPPORT_ADDRESS}" style="color:${PAPER.seal};">${MUDAVYM_SUPPORT_ADDRESS}</a></p>
  </main>
</body>
</html>`;
}
