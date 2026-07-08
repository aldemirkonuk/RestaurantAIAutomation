/**
 * Delivery ETA Notification Email Template
 */

import { EMAIL_CONFIG, formatDate } from "./template-config";
import { baseTemplate, metricBox, tableRow, alertBox } from "./base-template";

export interface DeliveryETAData {
  restaurantName: string;
  orderId: string;
  providerName: string;
  expectedDate: Date | string;
  expectedTimeWindow?: string; // e.g., '10:00 AM - 12:00 PM'
  items: Array<{
    name: string;
    quantity: number;
  }>;
  totalItems: number;
  trackingNumber?: string;
  driverName?: string;
  driverPhone?: string;
  specialInstructions?: string;
}

export function deliveryETATemplate(data: DeliveryETAData): string {
  const { colors } = EMAIL_CONFIG;

  const itemsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden; margin: 20px 0;">
      <thead>
        <tr style="background-color: ${colors.gray[50]};">
          <th style="padding: 12px 15px; text-align: left; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Item</th>
          <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Quantity</th>
        </tr>
      </thead>
      <tbody>
        ${data.items
          .map(
            (item, index) => `
          <tr style="background-color: ${index % 2 === 0 ? "#ffffff" : colors.gray[50]};">
            <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${item.name}</td>
            <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${item.quantity}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  const metricsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${metricBox({
          value: data.totalItems,
          label: "Total Items",
          backgroundColor: "#eff6ff",
          textColor: colors.info,
        })}
        <td width="15px"></td>
        ${metricBox({
          value: data.items.length,
          label: "Wine Types",
          backgroundColor: colors.gray[100],
          textColor: colors.gray[700],
        })}
      </tr>
    </table>
  `;

  const content = `
    <!-- Status Badge -->
    <div style="display: inline-block; padding: 8px 16px; background-color: #eff6ff; color: ${colors.info}; font-size: 14px; font-weight: 600; border-radius: 20px; margin-bottom: 15px;">
      Delivery Arriving Soon
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Delivery ETA Notification
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      Order #${data.orderId} from ${data.providerName}
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow("Expected Date", formatDate(data.expectedDate))}
      ${data.expectedTimeWindow ? tableRow("Time Window", data.expectedTimeWindow) : ""}
      ${tableRow("Provider", data.providerName)}
      ${data.trackingNumber ? tableRow("Tracking #", data.trackingNumber) : ""}
      ${data.driverName ? tableRow("Driver", data.driverName) : ""}
      ${data.driverPhone ? tableRow("Driver Phone", data.driverPhone) : ""}
    </table>

    ${metricsHtml}
    ${itemsHtml}

    ${
      data.specialInstructions
        ? alertBox({
            type: "info",
            title: "Special Instructions",
            message: data.specialInstructions,
          })
        : ""
    }

    ${alertBox({
      type: "warning",
      title: "Preparation Needed",
      message:
        "Ensure receiving area is clear and staff is available to check delivery against the order.",
    })}
  `;

  return baseTemplate({
    title: `Delivery ETA - Order #${data.orderId}`,
    preheader: `Delivery from ${data.providerName} expected ${formatDate(data.expectedDate)}${data.expectedTimeWindow ? ` (${data.expectedTimeWindow})` : ""}`,
    content,
    ctaButton: {
      text: "View Order Details",
      url: "#",
      color: colors.info,
    },
  });
}
