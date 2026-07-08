/**
 * Daily Summary Email Template
 */

import { EMAIL_CONFIG, formatCurrency, formatDate } from "./template-config";
import { baseTemplate, metricBox, alertBox } from "./base-template";

export interface DailySummaryData {
  restaurantName: string;
  date: Date | string;
  metrics: {
    lowStockCount: number;
    pendingOrders: number;
    deliveriesToday: number;
    totalInventoryValue?: number;
  };
  alerts: Array<{
    type: "low_stock" | "delivery" | "order" | "expiring";
    title: string;
    message: string;
  }>;
  actionItems?: Array<{
    priority: "high" | "medium" | "low";
    description: string;
  }>;
}

/**
 * Generate daily summary email HTML
 */
export function dailySummaryTemplate(data: DailySummaryData): string {
  const { colors } = EMAIL_CONFIG;

  // Summary metrics
  const metricsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${metricBox({
          value: data.metrics.lowStockCount,
          label: "Low Stock Items",
          backgroundColor:
            data.metrics.lowStockCount > 0 ? "#fef2f2" : "#ecfdf5",
          textColor:
            data.metrics.lowStockCount > 0 ? colors.danger : colors.success,
        })}
        <td width="10px"></td>
        ${metricBox({
          value: data.metrics.pendingOrders,
          label: "Pending Orders",
          backgroundColor:
            data.metrics.pendingOrders > 0 ? "#fef3c7" : colors.gray[100],
          textColor:
            data.metrics.pendingOrders > 0 ? colors.warning : colors.gray[700],
        })}
        <td width="10px"></td>
        ${metricBox({
          value: data.metrics.deliveriesToday,
          label: "Deliveries Today",
          backgroundColor:
            data.metrics.deliveriesToday > 0 ? "#eff6ff" : colors.gray[100],
          textColor:
            data.metrics.deliveriesToday > 0 ? colors.info : colors.gray[700],
        })}
      </tr>
    </table>
  `;

  // Alerts section
  const alertTypeMap = {
    low_stock: "danger" as const,
    delivery: "info" as const,
    order: "warning" as const,
    expiring: "warning" as const,
  };

  const alertsHtml =
    data.alerts.length > 0
      ? `
    <div style="margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
        Today's Alerts
      </h3>
      ${data.alerts
        .map((alert) =>
          alertBox({
            type: alertTypeMap[alert.type],
            title: alert.title,
            message: alert.message,
          }),
        )
        .join("")}
    </div>
  `
      : "";

  // Action items
  const priorityColors = {
    high: colors.danger,
    medium: colors.warning,
    low: colors.info,
  };

  const actionItemsHtml =
    data.actionItems && data.actionItems.length > 0
      ? `
    <div style="margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
        Action Items
      </h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${data.actionItems
          .map(
            (item, index) => `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid ${colors.gray[200]};">
              <div style="display: flex; align-items: center;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${priorityColors[item.priority]}; margin-right: 12px;"></span>
                <span style="color: ${colors.gray[700]}; font-size: 14px;">${item.description}</span>
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

  // Main content
  const content = `
    <!-- Header -->
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 22px; font-weight: bold;">
        Good Morning!
      </h2>
      <p style="margin: 0; color: ${colors.gray[500]}; font-size: 14px;">
        Daily Summary for ${data.restaurantName} | ${formatDate(data.date)}
      </p>
    </div>

    <!-- Quick Stats -->
    <p style="margin: 0 0 10px; color: ${colors.gray[700]}; font-size: 14px;">
      Here's your daily operations overview:
    </p>
    ${metricsHtml}

    ${
      data.metrics.totalInventoryValue
        ? `
    <p style="margin: 15px 0; padding: 15px; background-color: ${colors.gray[50]}; border-radius: 8px; text-align: center;">
      <span style="color: ${colors.gray[500]}; font-size: 14px;">Total Inventory Value: </span>
      <span style="color: ${colors.success}; font-size: 18px; font-weight: bold;">${formatCurrency(data.metrics.totalInventoryValue)}</span>
    </p>
    `
        : ""
    }

    <!-- Alerts -->
    ${alertsHtml}

    <!-- Action Items -->
    ${actionItemsHtml}
  `;

  return baseTemplate({
    title: `Daily Summary - ${data.restaurantName}`,
    preheader: `${data.metrics.lowStockCount} low stock items, ${data.metrics.pendingOrders} pending orders, ${data.metrics.deliveriesToday} deliveries today`,
    content,
    ctaButton: {
      text: "Open Dashboard",
      url: "#",
      color: colors.primary,
    },
  });
}
