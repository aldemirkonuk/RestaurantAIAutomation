/**
 * Inventory Audit Reminder Email Template
 */

import { EMAIL_CONFIG, formatDate, formatCurrency } from './template-config';
import { baseTemplate, metricBox, alertBox } from './base-template';

export interface InventoryAuditData {
  restaurantName: string;
  scheduledDate: Date | string;
  scheduledTime?: string;
  lastAuditDate?: Date | string;
  daysSinceLastAudit?: number;
  totalBottles: number;
  totalValue: number;
  discrepancyCount?: number;
  focusAreas?: Array<{
    area: string;
    reason: string;
  }>;
  assignedStaff?: string[];
  notes?: string;
}

export function inventoryAuditTemplate(data: InventoryAuditData): string {
  const { colors } = EMAIL_CONFIG;

  const metricsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${metricBox({
          value: data.totalBottles.toLocaleString(),
          label: 'Total Bottles',
          backgroundColor: colors.gray[100],
          textColor: colors.primary,
        })}
        <td width="15px"></td>
        ${metricBox({
          value: formatCurrency(data.totalValue),
          label: 'Inventory Value',
          backgroundColor: '#ecfdf5',
          textColor: colors.success,
        })}
      </tr>
    </table>
    ${data.discrepancyCount !== undefined ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
      <tr>
        ${metricBox({
          value: data.discrepancyCount,
          label: 'Known Discrepancies',
          backgroundColor: data.discrepancyCount > 0 ? '#fef2f2' : '#ecfdf5',
          textColor: data.discrepancyCount > 0 ? colors.danger : colors.success,
        })}
        <td width="15px"></td>
        ${metricBox({
          value: data.daysSinceLastAudit ? `${data.daysSinceLastAudit}d` : 'N/A',
          label: 'Since Last Audit',
          backgroundColor: colors.gray[100],
          textColor: colors.gray[700],
        })}
      </tr>
    </table>
    ` : ''}
  `;

  const focusAreasHtml = data.focusAreas && data.focusAreas.length > 0 ? `
    <div style="margin: 25px 0;">
      <h3 style="margin: 0 0 15px; color: ${colors.gray[900]}; font-size: 16px; font-weight: 600;">
        Focus Areas
      </h3>
      ${data.focusAreas.map(area => alertBox({
        type: 'warning',
        title: area.area,
        message: area.reason,
      })).join('')}
    </div>
  ` : '';

  const staffHtml = data.assignedStaff && data.assignedStaff.length > 0 ? `
    <div style="margin: 20px 0; padding: 15px; background-color: ${colors.gray[50]}; border-radius: 8px;">
      <h4 style="margin: 0 0 10px; color: ${colors.gray[700]}; font-size: 14px; font-weight: 600;">Assigned Staff</h4>
      <p style="margin: 0; color: ${colors.gray[600]}; font-size: 14px;">
        ${data.assignedStaff.join(', ')}
      </p>
    </div>
  ` : '';

  const content = `
    <!-- Audit Badge -->
    <div style="display: inline-block; padding: 6px 12px; background-color: ${colors.primary}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 15px;">
      INVENTORY AUDIT
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Inventory Audit Reminder
    </h2>
    <p style="margin: 0 0 5px; color: ${colors.gray[500]}; font-size: 14px;">
      ${data.restaurantName} | Scheduled for ${formatDate(data.scheduledDate)}${data.scheduledTime ? ` at ${data.scheduledTime}` : ''}
    </p>
    ${data.lastAuditDate ? `
    <p style="margin: 0 0 20px; color: ${colors.gray[400]}; font-size: 13px;">
      Last audit: ${formatDate(data.lastAuditDate)}
    </p>
    ` : '<div style="margin-bottom: 20px;"></div>'}

    ${metricsHtml}
    ${focusAreasHtml}
    ${staffHtml}

    ${data.notes ? alertBox({
      type: 'info',
      title: 'Audit Notes',
      message: data.notes,
    }) : ''}

    ${alertBox({
      type: 'info',
      title: 'Audit Checklist',
      message: 'Count all bottles by location. Compare physical counts with system records. Report any discrepancies. Check wine condition and storage temperatures.',
    })}
  `;

  return baseTemplate({
    title: `Inventory Audit - ${data.restaurantName}`,
    preheader: `Inventory audit scheduled for ${formatDate(data.scheduledDate)} - ${data.totalBottles} bottles to verify`,
    content,
    ctaButton: {
      text: 'Start Audit',
      url: '#',
      color: colors.primary,
    },
  });
}
