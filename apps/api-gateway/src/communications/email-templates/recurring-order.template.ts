/**
 * Recurring Order Reminder Email Template
 */

import { EMAIL_CONFIG, formatCurrency, formatDate } from './template-config';
import { baseTemplate, tableRow, alertBox } from './base-template';

export interface RecurringOrderReminderData {
  restaurantName: string;
  orderName: string;
  providerName: string;
  scheduledDate: Date | string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  totalAmount: number;
  frequency: string; // 'weekly', 'biweekly', 'monthly'
  lastOrderDate?: Date | string;
  notes?: string;
}

export function recurringOrderReminderTemplate(data: RecurringOrderReminderData): string {
  const { colors } = EMAIL_CONFIG;

  const frequencyLabels: Record<string, string> = {
    weekly: 'Weekly',
    biweekly: 'Every 2 Weeks',
    monthly: 'Monthly',
  };

  const itemsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden; margin: 20px 0;">
      <thead>
        <tr style="background-color: ${colors.gray[50]};">
          <th style="padding: 12px 15px; text-align: left; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Item</th>
          <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Qty</th>
          <th style="padding: 12px 15px; text-align: right; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Unit Price</th>
          <th style="padding: 12px 15px; text-align: right; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${data.items.map((item, index) => `
          <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : colors.gray[50]};">
            <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${item.name}</td>
            <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${item.quantity}</td>
            <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[700]}; font-size: 14px;">${formatCurrency(item.unitPrice)}</td>
            <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">${formatCurrency(item.quantity * item.unitPrice)}</td>
          </tr>
        `).join('')}
        <tr style="background-color: ${colors.gray[100]};">
          <td colspan="3" style="padding: 12px 15px; text-align: right; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">Estimated Total</td>
          <td style="padding: 12px 15px; text-align: right; color: ${colors.primary}; font-size: 16px; font-weight: bold;">${formatCurrency(data.totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  `;

  const content = `
    <!-- Reminder Badge -->
    <div style="display: inline-block; padding: 6px 12px; background-color: ${colors.info}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 15px;">
      ${frequencyLabels[data.frequency] || data.frequency} ORDER
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Recurring Order Reminder
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      ${data.restaurantName} | ${data.orderName}
    </p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow('Provider', data.providerName)}
      ${tableRow('Scheduled Date', formatDate(data.scheduledDate))}
      ${tableRow('Frequency', frequencyLabels[data.frequency] || data.frequency)}
      ${data.lastOrderDate ? tableRow('Last Order', formatDate(data.lastOrderDate)) : ''}
    </table>

    ${data.notes ? alertBox({
      type: 'info',
      title: 'Order Notes',
      message: data.notes,
    }) : ''}

    ${itemsHtml}

    ${alertBox({
      type: 'warning',
      title: 'Action Required',
      message: 'This recurring order is scheduled to be placed in 2 days. Review the items and approve or modify the order.',
    })}
  `;

  return baseTemplate({
    title: `Recurring Order Reminder - ${data.providerName}`,
    preheader: `Your ${data.frequency} order from ${data.providerName} is scheduled for ${formatDate(data.scheduledDate)}`,
    content,
    ctaButton: {
      text: 'Review Order',
      url: '#',
      color: colors.primary,
    },
  });
}
