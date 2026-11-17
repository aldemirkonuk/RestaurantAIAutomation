import { baseTemplate } from "./base-template";

interface FirstHouseEmailData {
  ownerName: string;
  restaurantName: string;
  frontendBaseUrl: string;
}

/**
 * The letter an owner gets when their first house opens (the new road:
 * Register, verify, choose a house). Its five steps are the pages that take a
 * house from "opened" to "its first invoice is checked", in the order the
 * product asks for them. It promises nothing the product does not do: no
 * response time, no automatic negotiation, no point-of-sale link.
 */
export function firstHouseEmailTemplate(data: FirstHouseEmailData): string {
  const first = (data.ownerName ?? "").trim().split(/\s+/)[0];
  const hello = first
    ? `Welcome to Mudavym, ${escapeHtml(first)}.`
    : "Welcome to Mudavym.";
  const base = data.frontendBaseUrl.replace(/\/+$/, "");
  const steps: { title: string; body: string; path: string }[] = [
    {
      title: "Make your menu the current one",
      body: "Read it from a photo, a file, or type it. Your dishes and drinks come from it.",
      path: "/menu",
    },
    {
      title: "Count the goods on your list",
      body: "Say how much of each good you hold, so a cost and a shortage can be said.",
      path: "/inventory",
    },
    {
      title: "Add your first vendor, with an email",
      body: "A vendor with an email can be written to from Mudavym.",
      path: "/vendors",
    },
    {
      title: "Connect the house's Gmail",
      body: "Letters to and from your vendors go through your own mailbox.",
      path: "/communications?tab=mail&setup=1",
    },
    {
      title: "Check your first invoice",
      body: "Scan or forward one, and see what it says each good cost.",
      path: "/receipts",
    },
  ];
  const rows = steps
    .map(
      (s, i) => `
      <tr>
        <td style="padding: 12px 0; border-top: 1px solid #f3f4f6;">
          <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 700;">
            ${i + 1}. <a href="${escapeHtml(base + s.path)}" style="color: #7c2d12; text-decoration: none;">${escapeHtml(s.title)}</a>
          </p>
          <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">${escapeHtml(s.body)}</p>
        </td>
      </tr>`,
    )
    .join("");

  const content = `
    <p style="margin: 0 0 8px; color: #111827; font-size: 18px; font-weight: 700;">${hello}</p>
    <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
      <strong>${escapeHtml(data.restaurantName)}</strong> is open on Mudavym. These are the five things to do first, in order.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 8px;">${rows}
    </table>
  `;

  return baseTemplate({
    title: `${escapeHtml(data.restaurantName)} is open on Mudavym`,
    preheader: "Five things to do first.",
    content,
    ctaButton: { text: "Open your menu", url: `${base}/menu` },
    showFooter: true,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
