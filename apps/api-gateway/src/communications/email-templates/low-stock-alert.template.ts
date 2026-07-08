/**
 * Low Stock Alert Email Template
 */

import {
  EMAIL_CONFIG,
  getSeverityColor,
  getSeverityLabel,
} from "./template-config";
import { baseTemplate, metricBox, alertBox } from "./base-template";

export interface LowStockAlertData {
  wineName: string;
  currentStock: number;
  threshold: number;
  avgDailySales?: number;
  recommendedQty?: number;
  preferredSupplier?: string;
  estimatedDelivery?: string;
}

/**
 * Generate low stock alert email HTML
 */
export function lowStockAlertTemplate(data: LowStockAlertData): string {
  const { colors } = EMAIL_CONFIG;
  const severity = getSeverityLabel(data.currentStock, data.threshold);
  const severityColor = getSeverityColor(data.currentStock, data.threshold);

  const daysUntilStockout = data.avgDailySales
    ? Math.ceil(data.currentStock / data.avgDailySales)
    : null;

  // Build the metrics section
  const metricsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${metricBox({
          value: data.currentStock,
          label: "Current Stock",
          backgroundColor: "#fef2f2",
          textColor: colors.danger,
        })}
        <td width="15px"></td>
        ${metricBox({
          value: data.threshold,
          label: "Min Threshold",
          backgroundColor: colors.gray[100],
          textColor: colors.gray[700],
        })}
      </tr>
    </table>
    ${
      data.avgDailySales || daysUntilStockout
        ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
      <tr>
        ${
          data.avgDailySales
            ? metricBox({
                value: data.avgDailySales.toFixed(1),
                label: "Avg Daily Sales",
                backgroundColor: colors.gray[100],
                textColor: colors.gray[700],
              })
            : '<td width="50%"></td>'
        }
        <td width="15px"></td>
        ${
          daysUntilStockout
            ? metricBox({
                value: `~${daysUntilStockout}`,
                label: "Days Until Stockout",
                backgroundColor: "#fef2f2",
                textColor: colors.danger,
              })
            : '<td width="50%"></td>'
        }
      </tr>
    </table>
    `
        : ""
    }
  `;

  // Build the recommendation section
  const recommendationHtml = data.recommendedQty
    ? alertBox({
        type: "warning",
        title: "Recommended Action",
        message: `Order ${data.recommendedQty} bottles from ${data.preferredSupplier || "your preferred supplier"}${data.estimatedDelivery ? `. Estimated delivery: ${data.estimatedDelivery}` : ""}`,
      })
    : "";

  // Main content
  const content = `
    <!-- Alert Header -->
    <div style="padding: 15px 20px; background-color: ${severityColor}; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: bold;">
        ${severity} ALERT
      </h2>
    </div>

    <!-- Wine Name -->
    <h3 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: 600;">
      ${data.wineName}
    </h3>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      Requires immediate attention
    </p>

    <!-- Metrics -->
    ${metricsHtml}

    <!-- Recommendation -->
    ${recommendationHtml}
  `;

  return baseTemplate({
    title: `${severity}: ${data.wineName}`,
    preheader: `Only ${data.currentStock} bottles remaining - ${data.wineName}`,
    content,
    ctaButton: {
      text: "View Inventory",
      url: "#", // Replace with actual URL
      color: colors.primary,
    },
  });
}
