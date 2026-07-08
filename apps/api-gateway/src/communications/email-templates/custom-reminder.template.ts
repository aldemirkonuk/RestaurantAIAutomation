/**
 * Custom/Ad-hoc Reminder Email Template
 * Supports: custom free-text, wine tasting, license renewal, and general reminders
 */

import { EMAIL_CONFIG, formatDate } from "./template-config";
import { baseTemplate, tableRow, alertBox } from "./base-template";

export interface CustomReminderData {
  restaurantName: string;
  title: string;
  description: string;
  reminderType: string; // 'custom', 'wine_tasting', 'license_renewal', 'staff_task', etc.
  scheduledDate?: Date | string;
  scheduledTime?: string;
  createdBy?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  actionItems?: string[];
  relatedLinks?: Array<{
    label: string;
    url: string;
  }>;
  isRecurring?: boolean;
  recurrencePattern?: string;
  notes?: string;
}

export function customReminderTemplate(data: CustomReminderData): string {
  const { colors } = EMAIL_CONFIG;

  const typeLabels: Record<string, string> = {
    custom: "Reminder",
    wine_tasting: "Wine Tasting",
    license_renewal: "License Renewal",
    staff_task: "Staff Task",
    training: "Training Session",
    maintenance: "Maintenance",
  };

  const priorityConfig = {
    low: { color: colors.info, bg: "#eff6ff", label: "LOW" },
    medium: { color: colors.warning, bg: "#fef3c7", label: "MEDIUM" },
    high: { color: colors.danger, bg: "#fef2f2", label: "HIGH" },
    urgent: { color: colors.danger, bg: "#fef2f2", label: "URGENT" },
  };

  const priority = priorityConfig[data.priority || "medium"];

  const actionItemsHtml =
    data.actionItems && data.actionItems.length > 0
      ? `
    <div style="margin: 20px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
        Action Items
      </h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${data.actionItems
          .map(
            (item, index) => `
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid ${colors.gray[200]};">
              <div style="display: flex; align-items: center;">
                <span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background-color: ${colors.gray[200]}; text-align: center; line-height: 24px; font-size: 12px; font-weight: 600; color: ${colors.gray[600]}; margin-right: 12px;">${index + 1}</span>
                <span style="color: ${colors.gray[700]}; font-size: 14px;">${item}</span>
              </div>
            </td>
          </tr>
        `,
          )
          .join("")}
      </table>
    </div>
  `
      : "";

  const content = `
    <!-- Type + Priority Badge -->
    <div style="margin-bottom: 15px;">
      <span style="display: inline-block; padding: 6px 12px; background-color: ${colors.primary}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-right: 8px;">
        ${typeLabels[data.reminderType] || data.reminderType.toUpperCase()}
      </span>
      <span style="display: inline-block; padding: 6px 12px; background-color: ${priority.bg}; color: ${priority.color}; font-size: 12px; font-weight: 600; border-radius: 4px;">
        ${priority.label} PRIORITY
      </span>
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      ${data.title}
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      ${data.restaurantName}${data.isRecurring ? ` | Recurring: ${data.recurrencePattern || "Yes"}` : ""}
    </p>

    <!-- Description -->
    <div style="padding: 20px; background-color: ${colors.gray[50]}; border-radius: 8px; margin-bottom: 20px;">
      <p style="margin: 0; color: ${colors.gray[700]}; font-size: 14px; line-height: 1.6;">
        ${data.description}
      </p>
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${data.scheduledDate ? tableRow("Date", formatDate(data.scheduledDate)) : ""}
      ${data.scheduledTime ? tableRow("Time", data.scheduledTime) : ""}
      ${data.createdBy ? tableRow("Created By", data.createdBy) : ""}
    </table>

    ${actionItemsHtml}

    ${
      data.notes
        ? alertBox({
            type: "info",
            title: "Additional Notes",
            message: data.notes,
          })
        : ""
    }
  `;

  return baseTemplate({
    title: `${typeLabels[data.reminderType] || "Reminder"}: ${data.title}`,
    preheader: `${data.title}${data.scheduledDate ? ` - ${formatDate(data.scheduledDate)}` : ""} | ${data.restaurantName}`,
    content,
    ctaButton: {
      text: "View Details",
      url: "#",
      color: colors.primary,
    },
  });
}
