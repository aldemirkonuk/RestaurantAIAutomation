/**
 * Vendor Action Email Templates
 * Includes: Manager Review (with confirm/edit/reject/ask-more actions),
 *           Vendor Outbound (AI-composed, style-adapted)
 */

import { EMAIL_CONFIG, formatCurrency, formatDate } from "./template-config";
import { baseTemplate, tableRow, alertBox } from "./base-template";

// ============================================================================
// Manager Review Template (internal — shown to manager before sending)
// ============================================================================

export interface ManagerReviewEmailData {
  orderId: string;
  conversationId: string;
  providerName: string;
  vendorContactName?: string;
  wineName: string;
  quantity: number;
  pricePerBottle?: number;
  totalAmount?: number;
  aiDraftedMessage: string;
  sessionType?: string;
  urgency?: "normal" | "high" | "critical";
  dashboardBaseUrl?: string;
}

export function managerReviewTemplate(data: ManagerReviewEmailData): string {
  const { colors } = EMAIL_CONFIG;
  const baseUrl = data.dashboardBaseUrl || "https://app.wineops.ai";

  const urgencyColors = {
    normal: colors.info,
    high: colors.warning,
    critical: colors.danger,
  };
  const urgencyColor = urgencyColors[data.urgency || "normal"];

  const actionButtons = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 25px 0;">
      <tr>
        <td width="25%" style="padding: 5px; text-align: center;">
          <a href="${baseUrl}/orders/${data.orderId}?action=approve_send&cid=${data.conversationId}"
             style="display: block; padding: 12px 8px; background-color: ${colors.success}; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px; font-size: 13px;">
            Approve &amp; Send
          </a>
        </td>
        <td width="25%" style="padding: 5px; text-align: center;">
          <a href="${baseUrl}/orders/${data.orderId}?action=edit&cid=${data.conversationId}"
             style="display: block; padding: 12px 8px; background-color: ${colors.info}; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px; font-size: 13px;">
            Edit Message
          </a>
        </td>
        <td width="25%" style="padding: 5px; text-align: center;">
          <a href="${baseUrl}/orders/${data.orderId}?action=reject&cid=${data.conversationId}"
             style="display: block; padding: 12px 8px; background-color: ${colors.danger}; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px; font-size: 13px;">
            Reject
          </a>
        </td>
        <td width="25%" style="padding: 5px; text-align: center;">
          <a href="${baseUrl}/orders/${data.orderId}?action=ask_more&cid=${data.conversationId}"
             style="display: block; padding: 12px 8px; background-color: ${colors.gray[600]}; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px; font-size: 13px;">
            Ask for More
          </a>
        </td>
      </tr>
    </table>
  `;

  const content = `
    <div style="display: inline-block; padding: 6px 12px; background-color: ${urgencyColor}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 15px;">
      AI DRAFT — ${(data.urgency || "normal").toUpperCase()} PRIORITY
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Review AI-Drafted Vendor Email
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      ${data.wineName} x${data.quantity} — ${data.providerName}
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow("Provider", data.providerName)}
      ${tableRow("Contact", data.vendorContactName || "N/A")}
      ${tableRow("Wine", `${data.wineName} x${data.quantity}`)}
      ${data.pricePerBottle ? tableRow("Target Price", `${formatCurrency(data.pricePerBottle)}/bottle`) : ""}
      ${data.totalAmount ? tableRow("Est. Total", formatCurrency(data.totalAmount)) : ""}
    </table>

    <div style="margin: 20px 0; padding: 20px; background-color: ${colors.gray[50]}; border: 1px solid ${colors.gray[200]}; border-radius: 8px;">
      <p style="margin: 0 0 8px; color: ${colors.gray[500]}; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
        AI-DRAFTED MESSAGE (will be sent to vendor)
      </p>
      <div style="color: ${colors.gray[800]}; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">
${data.aiDraftedMessage}
      </div>
    </div>

    ${actionButtons}
  `;

  return baseTemplate({
    title: `Review: Email to ${data.providerName}`,
    preheader: `AI drafted an email to ${data.providerName} for ${data.wineName} — review and approve`,
    content,
  });
}

// ============================================================================
// Vendor Outbound Template (sent to the actual vendor)
// ============================================================================

export interface VendorOutboundEmailData {
  recipientName: string;
  bodyHtml: string;
  orderId?: string;
  orderNumber?: string;
  wineName?: string;
  quantity?: number;
  restaurantName?: string;
  senderName?: string;
  senderTitle?: string;
  senderEmail?: string;
  senderPhone?: string;
}

export function vendorOutboundTemplate(data: VendorOutboundEmailData): string {
  const { colors, styles } = EMAIL_CONFIG;
  const restaurantName = data.restaurantName || "WineOps AI";
  const senderName = data.senderName || "Restaurant Manager";

  const signatureBlock = `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top: 30px; border-top: 1px solid ${colors.gray[200]}; padding-top: 15px;">
      <tr>
        <td>
          <p style="margin: 0; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">
            ${senderName}
          </p>
          ${data.senderTitle ? `<p style="margin: 2px 0 0; color: ${colors.gray[500]}; font-size: 13px;">${data.senderTitle}</p>` : ""}
          <p style="margin: 2px 0 0; color: ${colors.primary}; font-size: 13px; font-weight: 500;">
            ${restaurantName}
          </p>
          ${data.senderEmail ? `<p style="margin: 2px 0 0; color: ${colors.gray[500]}; font-size: 12px;">${data.senderEmail}</p>` : ""}
          ${data.senderPhone ? `<p style="margin: 2px 0 0; color: ${colors.gray[500]}; font-size: 12px;">${data.senderPhone}</p>` : ""}
        </td>
      </tr>
    </table>
  `;

  const orderRef =
    data.orderNumber || data.orderId
      ? `<p style="margin: 0 0 15px; color: ${colors.gray[400]}; font-size: 11px;">Ref: ${data.orderNumber || data.orderId}</p>`
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Inquiry — ${restaurantName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: ${styles.fontFamily}; background-color: #ffffff;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td style="padding: 30px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto;">
          <tr>
            <td>
              <div style="color: ${colors.gray[800]}; font-size: 15px; line-height: 1.7;">
                ${data.bodyHtml}
              </div>
              ${signatureBlock}
              ${orderRef}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// ============================================================================
// Conversation Summary Template (sent to manager after vendor replies)
// ============================================================================

export interface ConversationSummaryEmailData {
  orderId: string;
  providerName: string;
  wineName: string;
  threadSummary: string;
  latestMessage: string;
  detectedIntent: string;
  sentiment: string;
  messageCount: number;
  dashboardBaseUrl?: string;
}

export function conversationSummaryTemplate(
  data: ConversationSummaryEmailData,
): string {
  const { colors } = EMAIL_CONFIG;
  const baseUrl = data.dashboardBaseUrl || "https://app.wineops.ai";

  const sentimentColors: Record<string, string> = {
    positive: colors.success,
    neutral: colors.info,
    negative: colors.danger,
  };
  const sentimentColor = sentimentColors[data.sentiment] || colors.info;

  const content = `
    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Vendor Reply — ${data.providerName}
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      ${data.wineName} — ${data.messageCount} messages in thread
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 15px;">
      <tr>
        <td width="50%" style="padding: 5px;">
          <div style="padding: 8px 12px; background-color: ${colors.gray[50]}; border-radius: 6px; text-align: center;">
            <span style="color: ${colors.gray[500]}; font-size: 11px; text-transform: uppercase;">Intent</span><br/>
            <span style="color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">${data.detectedIntent}</span>
          </div>
        </td>
        <td width="50%" style="padding: 5px;">
          <div style="padding: 8px 12px; background-color: ${colors.gray[50]}; border-radius: 6px; text-align: center;">
            <span style="color: ${colors.gray[500]}; font-size: 11px; text-transform: uppercase;">Sentiment</span><br/>
            <span style="color: ${sentimentColor}; font-size: 14px; font-weight: 600;">${data.sentiment}</span>
          </div>
        </td>
      </tr>
    </table>

    <div style="margin: 15px 0; padding: 15px; background-color: ${colors.gray[50]}; border-left: 3px solid ${colors.primary}; border-radius: 0 8px 8px 0;">
      <p style="margin: 0 0 5px; color: ${colors.gray[500]}; font-size: 11px; font-weight: 600; text-transform: uppercase;">Latest from vendor</p>
      <div style="color: ${colors.gray[800]}; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${data.latestMessage}</div>
    </div>

    ${
      data.threadSummary
        ? `
    ${alertBox({ type: "info", title: "AI Thread Summary", message: data.threadSummary })}
    `
        : ""
    }
  `;

  return baseTemplate({
    title: `Vendor Reply: ${data.providerName}`,
    preheader: `${data.providerName} replied about ${data.wineName} — ${data.detectedIntent}`,
    content,
    ctaButton: {
      text: "View Full Conversation",
      url: `${baseUrl}/orders/${data.orderId}?tab=conversation`,
      color: EMAIL_CONFIG.colors.primary,
    },
  });
}
