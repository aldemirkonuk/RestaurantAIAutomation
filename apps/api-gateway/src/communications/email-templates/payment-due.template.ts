/**
 * Payment Due Reminder Email Template
 */

import { EMAIL_CONFIG, formatCurrency, formatDate } from './template-config';
import { baseTemplate, metricBox, tableRow, alertBox } from './base-template';

export interface PaymentDueData {
  restaurantName: string;
  invoiceNumber: string;
  providerName: string;
  dueDate: Date | string;
  amount: number;
  items?: Array<{
    name: string;
    quantity: number;
    amount: number;
  }>;
  paymentTerms?: string;
  daysUntilDue: number;
  paymentMethod?: string;
  notes?: string;
}

export function paymentDueTemplate(data: PaymentDueData): string {
  const { colors } = EMAIL_CONFIG;

  const isUrgent = data.daysUntilDue <= 1;
  const isWarning = data.daysUntilDue <= 3;
  const urgencyColor = isUrgent ? colors.danger : isWarning ? colors.warning : colors.info;
  const urgencyBg = isUrgent ? '#fef2f2' : isWarning ? '#fef3c7' : '#eff6ff';
  const urgencyLabel = isUrgent ? 'DUE TODAY' : isWarning ? 'DUE SOON' : 'UPCOMING';

  const metricsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
      <tr>
        ${metricBox({
          value: formatCurrency(data.amount),
          label: 'Amount Due',
          backgroundColor: urgencyBg,
          textColor: urgencyColor,
        })}
        <td width="15px"></td>
        ${metricBox({
          value: data.daysUntilDue <= 0 ? 'TODAY' : `${data.daysUntilDue} days`,
          label: 'Until Due Date',
          backgroundColor: urgencyBg,
          textColor: urgencyColor,
        })}
      </tr>
    </table>
  `;

  const itemsHtml = data.items && data.items.length > 0 ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden; margin: 20px 0;">
      <thead>
        <tr style="background-color: ${colors.gray[50]};">
          <th style="padding: 12px 15px; text-align: left; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Item</th>
          <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Qty</th>
          <th style="padding: 12px 15px; text-align: right; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${data.items.map((item, index) => `
          <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : colors.gray[50]};">
            <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${item.name}</td>
            <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${item.quantity}</td>
            <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">${formatCurrency(item.amount)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const content = `
    <!-- Urgency Badge -->
    <div style="display: inline-block; padding: 6px 12px; background-color: ${urgencyColor}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 15px;">
      ${urgencyLabel}
    </div>

    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Payment Reminder
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      Invoice #${data.invoiceNumber} | ${data.providerName}
    </p>

    ${metricsHtml}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow('Provider', data.providerName)}
      ${tableRow('Due Date', formatDate(data.dueDate))}
      ${data.paymentTerms ? tableRow('Payment Terms', data.paymentTerms) : ''}
      ${data.paymentMethod ? tableRow('Payment Method', data.paymentMethod) : ''}
    </table>

    ${itemsHtml}

    ${data.notes ? alertBox({
      type: 'info',
      title: 'Notes',
      message: data.notes,
    }) : ''}

    ${isUrgent ? alertBox({
      type: 'danger',
      title: 'Payment Due Today',
      message: 'This payment is due today. Please process it immediately to avoid late fees and maintain your relationship with the provider.',
    }) : ''}
  `;

  return baseTemplate({
    title: `Payment ${urgencyLabel}: ${data.providerName}`,
    preheader: `Invoice #${data.invoiceNumber} - ${formatCurrency(data.amount)} due ${formatDate(data.dueDate)}`,
    content,
    ctaButton: {
      text: 'Process Payment',
      url: '#',
      color: urgencyColor,
    },
  });
}
