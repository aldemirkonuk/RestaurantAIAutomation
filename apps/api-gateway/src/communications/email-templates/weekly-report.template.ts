/**
 * Weekly Report Email Template
 */

import {
  EMAIL_CONFIG,
  formatCurrency,
  formatShortDate,
} from "./template-config";
import { baseTemplate, metricBox, tableRow } from "./base-template";

export interface WeeklyReportData {
  restaurantName: string;
  reportPeriod: {
    start: Date | string;
    end: Date | string;
  };
  metrics: {
    totalBottles: number;
    lowStockCount: number;
    totalValue: number;
    ordersPlaced?: number;
    deliveriesReceived?: number;
  };
  topSellers: Array<{
    name: string;
    sold: number;
    revenue: number;
  }>;
  lowStockItems: Array<{
    name: string;
    current: number;
    threshold: number;
  }>;
}

/**
 * Generate weekly report email HTML
 */
export function weeklyReportTemplate(data: WeeklyReportData): string {
  const { colors } = EMAIL_CONFIG;

  const periodStart = formatShortDate(data.reportPeriod.start);
  const periodEnd = formatShortDate(data.reportPeriod.end);

  // Summary metrics
  const summaryHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${metricBox({
          value: data.metrics.totalBottles.toLocaleString(),
          label: "Total Bottles",
          backgroundColor: colors.gray[100],
          textColor: colors.primary,
        })}
        <td width="15px"></td>
        ${metricBox({
          value: formatCurrency(data.metrics.totalValue),
          label: "Inventory Value",
          backgroundColor: "#ecfdf5",
          textColor: colors.success,
        })}
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
      <tr>
        ${metricBox({
          value: data.metrics.lowStockCount,
          label: "Low Stock Items",
          backgroundColor:
            data.metrics.lowStockCount > 0 ? "#fef2f2" : colors.gray[100],
          textColor:
            data.metrics.lowStockCount > 0 ? colors.danger : colors.gray[700],
        })}
        <td width="15px"></td>
        ${metricBox({
          value: data.metrics.ordersPlaced || 0,
          label: "Orders Placed",
          backgroundColor: colors.gray[100],
          textColor: colors.gray[700],
        })}
      </tr>
    </table>
  `;

  // Top sellers table
  const topSellersHtml =
    data.topSellers.length > 0
      ? `
    <div style="margin: 30px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
        Top Sellers This Week
      </h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: ${colors.gray[50]};">
            <th style="padding: 12px 15px; text-align: left; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600; text-transform: uppercase;">Wine</th>
            <th style="padding: 12px 15px; text-align: right; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600; text-transform: uppercase;">Sold</th>
            <th style="padding: 12px 15px; text-align: right; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600; text-transform: uppercase;">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${data.topSellers
            .map(
              (wine, index) => `
            <tr style="background-color: ${index % 2 === 0 ? "#ffffff" : colors.gray[50]};">
              <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${wine.name}</td>
              <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[700]}; font-size: 14px;">${wine.sold}</td>
              <td style="padding: 12px 15px; text-align: right; color: ${colors.success}; font-size: 14px; font-weight: 600;">${formatCurrency(wine.revenue)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `
      : "";

  // Low stock alerts
  const lowStockHtml =
    data.lowStockItems.length > 0
      ? `
    <div style="margin: 30px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.danger}; font-size: 16px; font-weight: 600;">
        Items Requiring Attention
      </h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: #fef2f2;">
            <th style="padding: 12px 15px; text-align: left; color: ${colors.danger}; font-size: 12px; font-weight: 600; text-transform: uppercase;">Wine</th>
            <th style="padding: 12px 15px; text-align: right; color: ${colors.danger}; font-size: 12px; font-weight: 600; text-transform: uppercase;">Current</th>
            <th style="padding: 12px 15px; text-align: right; color: ${colors.danger}; font-size: 12px; font-weight: 600; text-transform: uppercase;">Threshold</th>
          </tr>
        </thead>
        <tbody>
          ${data.lowStockItems
            .map(
              (item, index) => `
            <tr style="background-color: ${index % 2 === 0 ? "#ffffff" : colors.gray[50]};">
              <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${item.name}</td>
              <td style="padding: 12px 15px; text-align: right; color: ${colors.danger}; font-size: 14px; font-weight: 600;">${item.current}</td>
              <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[500]}; font-size: 14px;">${item.threshold}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `
      : "";

  // Main content
  const content = `
    <!-- Report Header -->
    <div style="margin-bottom: 25px;">
      <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 22px; font-weight: bold;">
        Weekly Inventory Report
      </h2>
      <p style="margin: 0; color: ${colors.gray[500]}; font-size: 14px;">
        ${data.restaurantName} | ${periodStart} - ${periodEnd}
      </p>
    </div>

    <!-- Summary Metrics -->
    ${summaryHtml}

    <!-- Top Sellers -->
    ${topSellersHtml}

    <!-- Low Stock Items -->
    ${lowStockHtml}
  `;

  return baseTemplate({
    title: `Weekly Report - ${data.restaurantName}`,
    preheader: `Your weekly inventory summary: ${data.metrics.totalBottles} bottles, ${formatCurrency(data.metrics.totalValue)} value`,
    content,
    ctaButton: {
      text: "View Full Report",
      url: "#", // Replace with actual URL
      color: colors.primary,
    },
  });
}
