import {
  encodeSubject,
  escapeHtml,
  MUDAVYM_SUPPORT_ADDRESS,
} from "../analytics/digest/recommendation-digest.template";

/** The one setup letter (DD-r108-57). Every house value is escaped. */
export interface SetupReminderInput {
  houseName: string;
  /** The owner's own name, or null: the letter then greets nobody by name. */
  ownerName: string | null;
  getStartedUrl: string;
  unsubscribeUrl: string;
}

export interface SetupReminderLetter {
  subject: string;
  html: string;
  text: string;
}

/** The first step a stalled house has not done. Only the menu stalls an opening today. */
export const FIRST_MISSING_STEP = "Your menu is not read yet";

export function buildSetupReminderLetter(
  i: SetupReminderInput,
): SetupReminderLetter {
  const house = i.houseName.trim() || "Your house";
  const first = i.ownerName?.trim().split(/\s+/)[0] ?? "";
  const hello = first ? `${first}, ` : "";
  const lead = `${hello}${house} is open in Mudavym and waiting at one step. ${FIRST_MISSING_STEP}: a photo, a PDF or a few typed lines is enough, and you check it on the next page.`;
  const once =
    "This is the only letter we send about it. If you would rather not have letters like this, stop them here:";
  const subject = encodeSubject(`${house} is waiting at its menu`);
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(`Mudavym · ${house}`)}</title></head>
<body style="margin:0;padding:24px;font-family:Georgia,serif;color:#1f1b16;background:#f6f1e7;">
  <main style="max-width:520px;margin:0 auto;padding:28px;background:#fffdf8;">
    <div style="font-size:12px;color:#8a3b1f;">MUDAVYM</div>
    <h1 style="font-size:22px;font-weight:normal;">${escapeHtml(FIRST_MISSING_STEP)}</h1>
    <p style="font-size:15px;line-height:1.55;">${escapeHtml(lead)}</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(i.getStartedUrl)}" style="display:inline-block;padding:12px 20px;background:#8a3b1f;color:#fffdf8;">Read the menu</a></p>
    <p style="font-size:12px;color:#6b6257;">${escapeHtml(once)} <a href="${escapeHtml(i.unsubscribeUrl)}" style="color:#8a3b1f;">Unsubscribe</a>. Questions: <a href="mailto:${MUDAVYM_SUPPORT_ADDRESS}" style="color:#8a3b1f;">${MUDAVYM_SUPPORT_ADDRESS}</a></p>
  </main>
</body>
</html>`;
  const text = [
    FIRST_MISSING_STEP,
    "",
    lead,
    "",
    `Read the menu: ${i.getStartedUrl}`,
    "",
    `${once} ${i.unsubscribeUrl}`,
  ].join("\n");
  return { subject, html, text };
}
