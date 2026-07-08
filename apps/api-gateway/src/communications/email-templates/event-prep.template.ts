/**
 * Event Preparation Reminder Email Template
 */

import { EMAIL_CONFIG, formatDate, formatCurrency } from "./template-config";
import { baseTemplate, metricBox, tableRow, alertBox } from "./base-template";

export interface EventPrepData {
  restaurantName: string;
  eventName: string;
  eventDate: Date | string;
  eventTime?: string;
  guestCount?: number;
  eventType?: string; // 'wine_tasting', 'private_dining', 'special_event', 'holiday', etc.
  wineRequirements?: Array<{
    name: string;
    quantityNeeded: number;
    currentStock: number;
    shortfall: number;
  }>;
  totalBottlesNeeded?: number;
  estimatedCost?: number;
  organizer?: string;
  specialRequests?: string;
  notes?: string;
}

export function eventPrepTemplate(data: EventPrepData): string {
  const { colors } = EMAIL_CONFIG;

  const eventTypeLabels: Record<string, string> = {
    wine_tasting: "Wine Tasting",
    private_dining: "Private Dining",
    special_event: "Special Event",
    holiday: "Holiday Event",
  };

  const hasShortfalls =
    data.wineRequirements?.some((w) => w.shortfall > 0) ?? false;

  const metricsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${
          data.guestCount
            ? metricBox({
                value: data.guestCount,
                label: "Expected Guests",
                backgroundColor: "#eff6ff",
                textColor: colors.info,
              })
            : metricBox({
                value: "TBD",
                label: "Expected Guests",
                backgroundColor: colors.gray[100],
                textColor: colors.gray[500],
              })
        }
        <td width="15px"></td>
        ${metricBox({
          value:
            data.totalBottlesNeeded ||
            data.wineRequirements?.reduce(
              (sum, w) => sum + w.quantityNeeded,
              0,
            ) ||
            0,
          label: "Bottles Needed",
          backgroundColor: hasShortfalls ? "#fef2f2" : "#ecfdf5",
          textColor: hasShortfalls ? colors.danger : colors.success,
        })}
      </tr>
    </table>
  `;

  const wineTableHtml =
    data.wineRequirements && data.wineRequirements.length > 0
      ? `
    <div style="margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
        Wine Requirements
      </h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: ${colors.gray[50]};">
            <th style="padding: 12px 15px; text-align: left; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Wine</th>
            <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Needed</th>
            <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">In Stock</th>
            <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Shortfall</th>
          </tr>
        </thead>
        <tbody>
          ${data.wineRequirements
            .map(
              (wine, index) => `
            <tr style="background-color: ${index % 2 === 0 ? "#ffffff" : colors.gray[50]};">
              <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${wine.name}</td>
              <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${wine.quantityNeeded}</td>
              <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${wine.currentStock}</td>
              <td style="padding: 12px 15px; text-align: center; color: ${wine.shortfall > 0 ? colors.danger : colors.success}; font-size: 14px; font-weight: 600;">
                ${wine.shortfall > 0 ? `-${wine.shortfall}` : "OK"}
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `
      : "";

  const content = `
    <!-- Event Type Badge -->
    <div style="display: inline-block; padding: 6px 12px; background-color: ${colors.primary}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 15px;">
      ${eventTypeLabels[data.eventType || ""] || data.eventType || "EVENT"}
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Event Preparation Reminder
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      ${data.restaurantName} | ${data.eventName}
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow("Event Date", formatDate(data.eventDate))}
      ${data.eventTime ? tableRow("Time", data.eventTime) : ""}
      ${data.organizer ? tableRow("Organizer", data.organizer) : ""}
      ${data.estimatedCost ? tableRow("Estimated Wine Cost", formatCurrency(data.estimatedCost)) : ""}
    </table>

    ${metricsHtml}
    ${wineTableHtml}

    ${
      hasShortfalls
        ? alertBox({
            type: "danger",
            title: "Stock Shortfall Detected",
            message:
              "Some wines needed for this event are not in stock. Place orders immediately to ensure delivery before the event.",
          })
        : ""
    }

    ${
      data.specialRequests
        ? alertBox({
            type: "info",
            title: "Special Requests",
            message: data.specialRequests,
          })
        : ""
    }

    ${
      data.notes
        ? alertBox({
            type: "info",
            title: "Notes",
            message: data.notes,
          })
        : ""
    }
  `;

  return baseTemplate({
    title: `Event Prep: ${data.eventName}`,
    preheader: `${data.eventName} on ${formatDate(data.eventDate)} - ${hasShortfalls ? "Stock shortfall detected!" : "Wine requirements ready"}`,
    content,
    ctaButton: {
      text: "View Event Details",
      url: "#",
      color: hasShortfalls ? colors.danger : colors.primary,
    },
  });
}
