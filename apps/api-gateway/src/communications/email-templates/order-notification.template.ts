/**
 * Order Notification Email Templates
 * Includes: Order Approval, Delivery Notification
 */

import { EMAIL_CONFIG, formatCurrency, formatDate } from './template-config';
import { baseTemplate, tableRow, alertBox } from './base-template';

// ============================================================================
// Order Approval Template
// ============================================================================

function wineNameWithFormat(name: string, bottleSizeMl?: number): string {
  if (!bottleSizeMl || bottleSizeMl <= 0) return name;
  const vol = bottleSizeMl >= 1000 && bottleSizeMl % 100 === 0 ? `${bottleSizeMl / 1000}L` : `${bottleSizeMl}ml`;
  return `${name} (${vol})`;
}

export interface OrderApprovalData {
  orderId: string;
  providerName: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    bottleSizeMl?: number;
  }>;
  totalAmount: number;
  requestedBy: string;
  requestedAt: Date | string;
  urgency?: 'normal' | 'high' | 'critical';
  notes?: string;
}

export function orderApprovalTemplate(data: OrderApprovalData): string {
  const { colors } = EMAIL_CONFIG;
  
  const urgencyColors = {
    normal: colors.info,
    high: colors.warning,
    critical: colors.danger,
  };
  
  const urgencyColor = urgencyColors[data.urgency || 'normal'];
  const urgencyLabel = data.urgency ? data.urgency.toUpperCase() : 'NORMAL';

  // Order items table
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
            <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${wineNameWithFormat(item.name, item.bottleSizeMl)}</td>
            <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${item.quantity}</td>
            <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[700]}; font-size: 14px;">${formatCurrency(item.unitPrice)}</td>
            <td style="padding: 12px 15px; text-align: right; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">${formatCurrency(item.quantity * item.unitPrice)}</td>
          </tr>
        `).join('')}
        <tr style="background-color: ${colors.gray[100]};">
          <td colspan="3" style="padding: 12px 15px; text-align: right; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600;">Total</td>
          <td style="padding: 12px 15px; text-align: right; color: ${colors.primary}; font-size: 16px; font-weight: bold;">${formatCurrency(data.totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  `;

  const content = `
    <!-- Urgency Badge -->
    <div style="display: inline-block; padding: 6px 12px; background-color: ${urgencyColor}; color: #ffffff; font-size: 12px; font-weight: 600; border-radius: 4px; margin-bottom: 15px;">
      ${urgencyLabel} PRIORITY
    </div>

    <!-- Header -->
    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Order Approval Required
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      Order #${data.orderId} from ${data.providerName}
    </p>

    <!-- Order Details -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow('Requested By', data.requestedBy)}
      ${tableRow('Requested At', formatDate(data.requestedAt))}
      ${tableRow('Provider', data.providerName)}
    </table>

    ${data.notes ? alertBox({
      type: 'info',
      title: 'Notes',
      message: data.notes,
    }) : ''}

    <!-- Items -->
    ${itemsHtml}
  `;

  return baseTemplate({
    title: `Order Approval: ${data.providerName}`,
    preheader: `Order #${data.orderId} requires approval - ${formatCurrency(data.totalAmount)}`,
    content,
    ctaButton: {
      text: 'Review Order',
      url: '#',
      color: colors.primary,
    },
  });
}

// ============================================================================
// Delivery Notification Template
// ============================================================================

export interface DeliveryNotificationData {
  orderId: string;
  providerName: string;
  deliveryDate: Date | string;
  items: Array<{
    name: string;
    quantity: number;
    received?: number;
    bottleSizeMl?: number;
  }>;
  status: 'scheduled' | 'in_transit' | 'delivered' | 'partial';
  trackingNumber?: string;
  notes?: string;
}

export function deliveryNotificationTemplate(data: DeliveryNotificationData): string {
  const { colors } = EMAIL_CONFIG;
  
  const statusConfig = {
    scheduled: { label: 'Scheduled', color: colors.info, bg: '#eff6ff' },
    in_transit: { label: 'In Transit', color: colors.warning, bg: '#fef3c7' },
    delivered: { label: 'Delivered', color: colors.success, bg: '#ecfdf5' },
    partial: { label: 'Partial Delivery', color: colors.warning, bg: '#fef3c7' },
  };
  
  const status = statusConfig[data.status];

  // Items table
  const itemsHtml = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid ${colors.gray[200]}; border-radius: 8px; overflow: hidden; margin: 20px 0;">
      <thead>
        <tr style="background-color: ${colors.gray[50]};">
          <th style="padding: 12px 15px; text-align: left; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Item</th>
          <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Ordered</th>
          ${data.status === 'delivered' || data.status === 'partial' ? `
          <th style="padding: 12px 15px; text-align: center; color: ${colors.gray[600]}; font-size: 12px; font-weight: 600;">Received</th>
          ` : ''}
        </tr>
      </thead>
      <tbody>
        ${data.items.map((item, index) => {
          const isShort = item.received !== undefined && item.received < item.quantity;
          return `
          <tr style="background-color: ${index % 2 === 0 ? '#ffffff' : colors.gray[50]};">
            <td style="padding: 12px 15px; color: ${colors.gray[900]}; font-size: 14px;">${wineNameWithFormat(item.name, item.bottleSizeMl)}</td>
            <td style="padding: 12px 15px; text-align: center; color: ${colors.gray[700]}; font-size: 14px;">${item.quantity}</td>
            ${data.status === 'delivered' || data.status === 'partial' ? `
            <td style="padding: 12px 15px; text-align: center; color: ${isShort ? colors.danger : colors.success}; font-size: 14px; font-weight: 600;">
              ${item.received ?? item.quantity}${isShort ? ' (SHORT)' : ''}
            </td>
            ` : ''}
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;

  const content = `
    <!-- Status Badge -->
    <div style="display: inline-block; padding: 8px 16px; background-color: ${status.bg}; color: ${status.color}; font-size: 14px; font-weight: 600; border-radius: 20px; margin-bottom: 15px;">
      ${status.label}
    </div>

    <!-- Header -->
    <h2 style="margin: 0 0 5px; color: ${colors.gray[900]}; font-size: 20px; font-weight: bold;">
      Delivery Update
    </h2>
    <p style="margin: 0 0 20px; color: ${colors.gray[500]}; font-size: 14px;">
      Order #${data.orderId} from ${data.providerName}
    </p>

    <!-- Delivery Details -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      ${tableRow('Delivery Date', formatDate(data.deliveryDate))}
      ${tableRow('Provider', data.providerName)}
      ${data.trackingNumber ? tableRow('Tracking #', data.trackingNumber) : ''}
    </table>

    ${data.notes ? alertBox({
      type: data.status === 'partial' ? 'warning' : 'info',
      title: 'Delivery Notes',
      message: data.notes,
    }) : ''}

    <!-- Items -->
    ${itemsHtml}
  `;

  return baseTemplate({
    title: `Delivery ${status.label}: Order #${data.orderId}`,
    preheader: `${status.label} - Order from ${data.providerName}`,
    content,
    ctaButton: {
      text: 'View Order Details',
      url: '#',
      color: colors.primary,
    },
  });
}
