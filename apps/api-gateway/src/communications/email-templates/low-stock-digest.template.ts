/**
 * Low Stock DIGEST Email Template
 *
 * The batched counterpart to `low-stock-alert.template.ts` (which is single-wine).
 * Renders MANY wines in one email so a manager gets a single digest instead of
 * one email per wine. Used for:
 *   - `instant`  → a burst of wines that JUST crossed below par (grouped so a
 *                  simultaneous crossing of several wines is one email).
 *   - `digest`   → the periodic reminder of every wine that REMAINS low.
 */

import { EMAIL_CONFIG } from "./template-config";
import { baseTemplate, tableRow, alertBox } from "./base-template";

export type LowStockSeverity = "critical" | "low";

export interface LowStockDigestWine {
  wineName: string;
  currentStock: number;
  threshold: number;
  severity: LowStockSeverity;
  wineId?: string;
  recommendedQty?: number;
}

export interface LowStockDigestData {
  restaurantName?: string;
  wines: LowStockDigestWine[];
  mode: "instant" | "digest";
  inventoryUrl?: string;
}

function wineTable(title: string, wines: LowStockDigestWine[]): string {
  const { colors } = EMAIL_CONFIG;
  if (wines.length === 0) return "";

  const rows = wines
    .map((w) =>
      tableRow(
        w.wineName,
        `${w.currentStock} / ${w.threshold} bottles${
          w.recommendedQty ? ` &middot; reorder ~${w.recommendedQty}` : ""
        }`,
      ),
    )
    .join("");

  return `
    <h3 style="margin: 24px 0 8px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
      ${title}
    </h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden;">
      <tr style="background-color: ${colors.gray[50]};">
        <td style="padding: 10px 15px; color: ${colors.gray[500]}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Wine</td>
        <td style="padding: 10px 15px; color: ${colors.gray[500]}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right;">Stock / Par</td>
      </tr>
      ${rows}
    </table>
  `;
}

/**
 * Generate a batched low-stock digest email.
 */
export function lowStockDigestTemplate(data: LowStockDigestData): string {
  const { colors } = EMAIL_CONFIG;
  const critical = data.wines.filter((w) => w.severity === "critical");
  const low = data.wines.filter((w) => w.severity === "low");
  const total = data.wines.length;

  const isInstant = data.mode === "instant";
  const heading = isInstant
    ? `${total} wine${total === 1 ? "" : "s"} just dropped below par`
    : `${total} wine${total === 1 ? "" : "s"} below par`;

  const summary = alertBox({
    type: critical.length > 0 ? "danger" : "warning",
    title: isInstant ? "Action needed" : "Low-stock digest",
    message:
      critical.length > 0
        ? `${critical.length} critical &middot; ${low.length} low. Review and reorder to avoid a stockout.`
        : `${low.length} ${low.length === 1 ? "wine is" : "wines are"} running low. Consider reordering.`,
  });

  const content = `
    <div style="padding: 15px 20px; background-color: ${
      critical.length > 0 ? colors.danger : colors.warning
    }; border-radius: 8px; margin-bottom: 8px;">
      <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: bold;">
        ${critical.length > 0 ? "🚨" : "⚠️"} ${heading}
      </h2>
    </div>
    ${
      data.restaurantName
        ? `<p style="margin: 0 0 12px; color: ${colors.gray[500]}; font-size: 14px;">${data.restaurantName}</p>`
        : ""
    }
    ${summary}
    ${wineTable("🚨 Critical (≤50% of par)", critical)}
    ${wineTable("⚠️ Running low", low)}
  `;

  return baseTemplate({
    title: `${heading} — WineOps`,
    preheader: `${critical.length} critical, ${low.length} low`,
    content,
    ctaButton: {
      text: "View Inventory",
      url: data.inventoryUrl || "#",
      color: colors.primary,
    },
  });
}
