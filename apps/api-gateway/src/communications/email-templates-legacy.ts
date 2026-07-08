/**
 * Email Templates for WineOps AI Communications
 * ==============================================
 * Provides HTML email templates for various communication scenarios:
 * - Low stock alerts
 * - Weekly/daily reports
 * - Order lifecycle (approval, confirmation, delivery)
 * - Procurement (inquiry, counter-offer)
 * - Delivery reminders
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface LowStockAlertData {
  wineName: string;
  wineId: string;
  currentStock: number;
  threshold: number;
  restaurantName?: string;
  restaurantId: string;
  suggestedProvider?: string;
  estimatedStockoutDays?: number;
  bottleSizeMl?: number;
}

export interface WeeklyReportData {
  restaurantName: string;
  weekStartDate: string;
  weekEndDate: string;
  totalOrders: number;
  totalRevenue: number;
  totalBottlesOrdered: number;
  topWines: Array<{ name: string; bottles: number; revenue: number }>;
  lowStockItems: Array<{ name: string; stock: number; threshold: number }>;
  deliveriesCompleted: number;
  conversationSummaries?: Array<{
    provider: string;
    summary: string;
    status: string;
  }>;
}

export interface DailySummaryData {
  restaurantName: string;
  date: string;
  ordersCreated: number;
  ordersDelivered: number;
  lowStockAlerts: number;
  revenue: number;
  pendingApprovals: number;
}

export interface OrderApprovalData {
  orderNumber: string;
  orderId: string;
  wineName: string;
  quantity: number;
  providerName: string;
  totalCost: number;
  urgency?: string;
  approvalUrl?: string;
  bottleSizeMl?: number;
}

export interface DeliveryNotificationData {
  orderNumber: string;
  orderId: string;
  wineName: string;
  quantity: number;
  providerName: string;
  deliveredAt: string;
  quantityReceived?: number;
  discrepancy?: boolean;
  bottleSizeMl?: number;
}

export interface OrderInquiryData {
  orderNumber: string;
  wineName: string;
  quantity: number;
  targetPrice?: number;
  managerName: string;
  restaurantName: string;
  providerName: string;
  notes?: string;
  bottleSizeMl?: number;
}

export interface CounterOfferData {
  orderNumber: string;
  wineName: string;
  quantity: number;
  originalPrice: number;
  counterPrice: number;
  managerName: string;
  restaurantName: string;
  providerName: string;
  reason?: string;
  bottleSizeMl?: number;
}

export interface OrderConfirmationData {
  orderNumber: string;
  wineName: string;
  quantity: number;
  finalPrice: number;
  totalCost: number;
  managerName: string;
  restaurantName: string;
  providerName: string;
  expectedDeliveryDate?: string;
  bottleSizeMl?: number;
}

export interface DeliveryReminderData {
  orderNumber: string;
  wineName: string;
  quantity: number;
  providerName: string;
  expectedDeliveryDate: string;
  restaurantName: string;
  deliveryAddress?: string;
  bottleSizeMl?: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getSeverityLabel(
  currentStock: number,
  threshold: number,
): string {
  const ratio = currentStock / threshold;
  if (ratio <= 0.25) return "CRITICAL";
  if (ratio <= 0.5) return "HIGH";
  if (ratio <= 0.75) return "MEDIUM";
  return "LOW";
}

function baseLayout(title: string, content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #722F37 0%, #4A1A1F 100%); padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; }
    .header p { color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 13px; }
    .body { padding: 24px; }
    .footer { background: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { color: #9ca3af; font-size: 12px; margin: 4px 0; }
    .btn { display: inline-block; background: #722F37; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 500; font-size: 14px; }
    .btn:hover { background: #5a2530; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-critical { background: #fee2e2; color: #dc2626; }
    .badge-high { background: #fef3c7; color: #d97706; }
    .badge-medium { background: #dbeafe; color: #2563eb; }
    .badge-low { background: #d1fae5; color: #059669; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; font-size: 13px; }
    .info-value { color: #111827; font-size: 13px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f9fafb; padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #374151; }
  </style>
</head>
<body>
  <div style="padding: 20px;">
    <div class="container">
      <div class="header">
        <h1>WineOps AI</h1>
        <p>${title}</p>
      </div>
      <div class="body">
        ${content}
      </div>
      <div class="footer">
        <p>WineOps AI - Intelligent Wine Operations</p>
        <p>This is an automated message. Do not reply directly.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format bottle volume for display: 750 → "750ml", 1500 → "1.5L" */
function formatBottleVolume(ml: number | undefined): string {
  if (!ml || ml <= 0) return "";
  if (ml >= 1000 && ml % 100 === 0) return `${ml / 1000}L`;
  return `${ml}ml`;
}

/** Append bottle format to wine name when bottleSizeMl is provided */
function wineNameWithFormat(wineName: string, bottleSizeMl?: number): string {
  const vol = formatBottleVolume(bottleSizeMl);
  return vol ? `${wineName} (${vol})` : wineName;
}

// =============================================================================
// TEMPLATE FUNCTIONS
// =============================================================================

export function lowStockAlertTemplate(data: LowStockAlertData | any): string {
  const severity = getSeverityLabel(data.currentStock, data.threshold);
  const badgeClass = `badge-${severity.toLowerCase()}`;

  return baseLayout(
    "Low Stock Alert",
    `
    <h2 style="margin-top: 0; color: #111827;">Low Stock Alert</h2>
    <p style="color: #6b7280;">The following wine is running low and may need reordering:</p>
    
    <div style="background: #fef3c7; border-left: 4px solid #d97706; padding: 12px 16px; border-radius: 4px; margin: 16px 0;">
      <strong>${wineNameWithFormat(data.wineName, data.bottleSizeMl)}</strong>
      <span class="badge ${badgeClass}" style="margin-left: 8px;">${severity}</span>
    </div>

    <div style="margin: 16px 0;">
      <div class="info-row"><span class="info-label">Current Stock</span><span class="info-value">${data.currentStock} bottles</span></div>
      <div class="info-row"><span class="info-label">Threshold</span><span class="info-value">${data.threshold} bottles</span></div>
      ${data.estimatedStockoutDays ? `<div class="info-row"><span class="info-label">Est. Stockout</span><span class="info-value">${data.estimatedStockoutDays} days</span></div>` : ""}
      ${data.suggestedProvider ? `<div class="info-row"><span class="info-label">Suggested Provider</span><span class="info-value">${data.suggestedProvider}</span></div>` : ""}
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <a href="#" class="btn">Reorder Now</a>
    </div>
  `,
  );
}

export function weeklyReportTemplate(data: WeeklyReportData | any): string {
  const topWines = data.topWines || data.topSellers || [];
  const topWinesHtml = topWines
    .map(
      (w: any) => `
    <tr><td>${w.name}</td><td>${w.bottles || w.sold || 0}</td><td>${formatCurrency(w.revenue || 0)}</td></tr>
  `,
    )
    .join("");

  const lowStockItems = data.lowStockItems || [];
  const lowStockHtml = lowStockItems
    .map(
      (item: any) => `
    <tr><td>${item.name}</td><td>${item.stock || item.current || 0}</td><td>${item.threshold || 0}</td></tr>
  `,
    )
    .join("");

  const convoSummaryHtml = data.conversationSummaries?.length
    ? `
    <h3 style="color: #111827; margin-top: 24px;">Conversation Summaries</h3>
    ${data.conversationSummaries
      .map(
        (c) => `
      <div style="background: #f9fafb; padding: 12px; border-radius: 4px; margin: 8px 0;">
        <strong>${c.provider}</strong> <span class="badge badge-medium">${c.status}</span>
        <p style="color: #6b7280; margin: 4px 0 0; font-size: 13px;">${c.summary}</p>
      </div>
    `,
      )
      .join("")}
  `
    : "";

  return baseLayout(
    "Weekly Report",
    `
    <h2 style="margin-top: 0; color: #111827;">${data.restaurantName} - Weekly Report</h2>
    <p style="color: #6b7280;">${data.weekStartDate} — ${data.weekEndDate}</p>

    <div style="display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap;">
      <div style="flex: 1; background: #f9fafb; padding: 12px; border-radius: 6px; text-align: center; min-width: 100px;">
        <div style="font-size: 24px; font-weight: 700; color: #722F37;">${data.totalOrders || data.metrics?.ordersPlaced || 0}</div>
        <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Orders</div>
      </div>
      <div style="flex: 1; background: #f9fafb; padding: 12px; border-radius: 6px; text-align: center; min-width: 100px;">
        <div style="font-size: 24px; font-weight: 700; color: #059669;">${formatCurrency(data.totalRevenue || data.metrics?.totalValue || 0)}</div>
        <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Revenue</div>
      </div>
      <div style="flex: 1; background: #f9fafb; padding: 12px; border-radius: 6px; text-align: center; min-width: 100px;">
        <div style="font-size: 24px; font-weight: 700; color: #2563eb;">${data.totalBottlesOrdered || data.metrics?.totalBottles || 0}</div>
        <div style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Bottles</div>
      </div>
    </div>

    <h3 style="color: #111827;">Top Wines</h3>
    <table>
      <thead><tr><th>Wine</th><th>Bottles</th><th>Revenue</th></tr></thead>
      <tbody>${topWinesHtml}</tbody>
    </table>

    ${
      lowStockHtml
        ? `
    <h3 style="color: #111827; margin-top: 24px;">Low Stock Items</h3>
    <table>
      <thead><tr><th>Wine</th><th>Stock</th><th>Threshold</th></tr></thead>
      <tbody>${lowStockHtml}</tbody>
    </table>
    `
        : ""
    }

    ${convoSummaryHtml}
  `,
  );
}

export function dailySummaryTemplate(data: DailySummaryData | any): string {
  return baseLayout(
    "Daily Summary",
    `
    <h2 style="margin-top: 0; color: #111827;">${data.restaurantName} - Daily Summary</h2>
    <p style="color: #6b7280;">${data.date}</p>

    <div style="margin: 16px 0;">
      <div class="info-row"><span class="info-label">Orders Created</span><span class="info-value">${data.ordersCreated ?? data.metrics?.pendingOrders ?? 0}</span></div>
      <div class="info-row"><span class="info-label">Orders Delivered</span><span class="info-value">${data.ordersDelivered ?? data.metrics?.deliveriesToday ?? 0}</span></div>
      <div class="info-row"><span class="info-label">Low Stock Alerts</span><span class="info-value">${data.lowStockAlerts ?? data.metrics?.lowStockCount ?? 0}</span></div>
      <div class="info-row"><span class="info-label">Revenue</span><span class="info-value">${formatCurrency(data.revenue ?? data.metrics?.totalInventoryValue ?? 0)}</span></div>
      <div class="info-row"><span class="info-label">Pending Approvals</span><span class="info-value">${data.pendingApprovals ?? data.metrics?.pendingOrders ?? 0}</span></div>
    </div>
  `,
  );
}

export function orderApprovalTemplate(data: OrderApprovalData | any): string {
  const orderRef = data.orderNumber || data.orderId || "N/A";
  const wineName = data.wineName || data.items?.[0]?.name || "Wine Order";
  const quantity =
    data.quantity ||
    data.items?.reduce((s: number, i: any) => s + (i.quantity || 0), 0) ||
    0;
  const totalCost = data.totalCost || data.totalAmount || 0;
  const providerName = data.providerName || "Provider";
  const urgency = data.urgency;

  return baseLayout(
    "Order Approval Required",
    `
    <h2 style="margin-top: 0; color: #111827;">Order Awaiting Your Approval</h2>
    
    <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; border-radius: 4px; margin: 16px 0;">
      <strong>Order #${orderRef}</strong>
      ${urgency ? `<span class="badge badge-${urgency === "high" || urgency === "critical" ? "high" : "medium"}" style="margin-left: 8px;">${urgency.toUpperCase()}</span>` : ""}
    </div>

    <div style="margin: 16px 0;">
      <div class="info-row"><span class="info-label">Wine</span><span class="info-value">${wineNameWithFormat(wineName, data.bottleSizeMl)}</span></div>
      <div class="info-row"><span class="info-label">Quantity</span><span class="info-value">${quantity} bottles</span></div>
      <div class="info-row"><span class="info-label">Provider</span><span class="info-value">${providerName}</span></div>
      <div class="info-row"><span class="info-label">Total Cost</span><span class="info-value">${formatCurrency(totalCost)}</span></div>
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <a href="${data.approvalUrl || "#"}" class="btn">Review & Approve</a>
    </div>
  `,
  );
}

export function deliveryNotificationTemplate(
  data: DeliveryNotificationData | any,
): string {
  const orderRef = data.orderNumber || data.orderId || "N/A";
  const wineName = data.wineName || data.items?.[0]?.name || "Wine";
  const quantity =
    data.quantity ||
    data.items?.reduce((s: number, i: any) => s + (i.quantity || 0), 0) ||
    0;
  const providerName = data.providerName || "Provider";
  const deliveredAt =
    data.deliveredAt || data.deliveryDate || new Date().toISOString();
  const quantityReceived =
    data.quantityReceived ??
    data.items?.reduce((s: number, i: any) => s + (i.received || 0), 0);
  const status = data.status || "delivered";

  return baseLayout(
    "Delivery Notification",
    `
    <h2 style="margin-top: 0; color: #111827;">Delivery ${status === "delivered" ? "Completed" : status === "partial" ? "Partial" : "Update"}</h2>
    
    <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 12px 16px; border-radius: 4px; margin: 16px 0;">
      <strong>Order #${orderRef} has been delivered</strong>
    </div>

    <div style="margin: 16px 0;">
      <div class="info-row"><span class="info-label">Wine</span><span class="info-value">${wineNameWithFormat(wineName, data.bottleSizeMl)}</span></div>
      <div class="info-row"><span class="info-label">Ordered</span><span class="info-value">${quantity} bottles</span></div>
      ${quantityReceived !== undefined ? `<div class="info-row"><span class="info-label">Received</span><span class="info-value">${quantityReceived} bottles</span></div>` : ""}
      <div class="info-row"><span class="info-label">Provider</span><span class="info-value">${providerName}</span></div>
      <div class="info-row"><span class="info-label">Delivered At</span><span class="info-value">${deliveredAt}</span></div>
    </div>

    ${
      data.discrepancy ||
      (quantityReceived !== undefined && quantityReceived < quantity)
        ? `
    <div style="background: #fef3c7; border-left: 4px solid #d97706; padding: 12px 16px; border-radius: 4px; margin: 16px 0;">
      <strong>⚠️ Discrepancy Detected:</strong> Quantity received does not match order.
    </div>
    `
        : ""
    }
  `,
  );
}

// =============================================================================
// PROCUREMENT-SPECIFIC TEMPLATES
// =============================================================================

export function orderInquiryTemplate(data: OrderInquiryData): string {
  return baseLayout(
    "Wine Order Inquiry",
    `
    <h2 style="margin-top: 0; color: #111827;">Wine Order Inquiry</h2>
    
    <p style="color: #374151;">Dear ${data.providerName},</p>
    
    <p style="color: #374151;">
      I hope this message finds you well. We would like to inquire about placing an order 
      for the following wine:
    </p>

    <div style="background: #f9fafb; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <div class="info-row"><span class="info-label">Wine</span><span class="info-value">${wineNameWithFormat(data.wineName, data.bottleSizeMl)}</span></div>
      <div class="info-row"><span class="info-label">Quantity</span><span class="info-value">${data.quantity} bottles</span></div>
      ${data.targetPrice ? `<div class="info-row"><span class="info-label">Target Price</span><span class="info-value">${formatCurrency(data.targetPrice)}/bottle</span></div>` : ""}
      <div class="info-row"><span class="info-label">Reference</span><span class="info-value">${data.orderNumber}</span></div>
    </div>

    ${data.notes ? `<p style="color: #374151;"><strong>Notes:</strong> ${data.notes}</p>` : ""}

    <p style="color: #374151;">
      Could you please confirm availability and your best price for this order?
      We would appreciate a prompt response.
    </p>

    <p style="color: #374151;">
      Best regards,<br>
      ${data.managerName}<br>
      ${data.restaurantName}
    </p>
  `,
  );
}

export function counterOfferTemplate(data: CounterOfferData): string {
  return baseLayout(
    "Counter Offer",
    `
    <h2 style="margin-top: 0; color: #111827;">Counter Offer</h2>
    
    <p style="color: #374151;">Dear ${data.providerName},</p>
    
    <p style="color: #374151;">
      Thank you for your offer. After careful consideration, we would like to propose 
      a counter-offer for the following:
    </p>

    <div style="background: #f9fafb; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <div class="info-row"><span class="info-label">Wine</span><span class="info-value">${wineNameWithFormat(data.wineName, data.bottleSizeMl)}</span></div>
      <div class="info-row"><span class="info-label">Quantity</span><span class="info-value">${data.quantity} bottles</span></div>
      <div class="info-row"><span class="info-label">Your Price</span><span class="info-value">${formatCurrency(data.originalPrice)}/bottle</span></div>
      <div class="info-row"><span class="info-label">Our Counter</span><span class="info-value" style="color: #722F37; font-weight: 700;">${formatCurrency(data.counterPrice)}/bottle</span></div>
      <div class="info-row"><span class="info-label">Total</span><span class="info-value">${formatCurrency(data.counterPrice * data.quantity)}</span></div>
    </div>

    ${data.reason ? `<p style="color: #374151;"><strong>Reason:</strong> ${data.reason}</p>` : ""}

    <p style="color: #374151;">
      We value our partnership and hope we can reach a mutually beneficial agreement.
      Please let us know your thoughts.
    </p>

    <p style="color: #374151;">
      Best regards,<br>
      ${data.managerName}<br>
      ${data.restaurantName}
    </p>
  `,
  );
}

export function orderConfirmationTemplate(data: OrderConfirmationData): string {
  return baseLayout(
    "Order Confirmation",
    `
    <h2 style="margin-top: 0; color: #111827;">Order Confirmed</h2>
    
    <p style="color: #374151;">Dear ${data.providerName},</p>
    
    <p style="color: #374151;">
      We are pleased to confirm the following order:
    </p>

    <div style="background: #d1fae5; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <div class="info-row"><span class="info-label">Order Number</span><span class="info-value">${data.orderNumber}</span></div>
      <div class="info-row"><span class="info-label">Wine</span><span class="info-value">${wineNameWithFormat(data.wineName, data.bottleSizeMl)}</span></div>
      <div class="info-row"><span class="info-label">Quantity</span><span class="info-value">${data.quantity} bottles</span></div>
      <div class="info-row"><span class="info-label">Price</span><span class="info-value">${formatCurrency(data.finalPrice)}/bottle</span></div>
      <div class="info-row"><span class="info-label">Total</span><span class="info-value" style="font-weight: 700;">${formatCurrency(data.totalCost)}</span></div>
      ${data.expectedDeliveryDate ? `<div class="info-row"><span class="info-label">Expected Delivery</span><span class="info-value">${data.expectedDeliveryDate}</span></div>` : ""}
    </div>

    <p style="color: #374151;">
      Please send us the invoice at your earliest convenience. We look forward to receiving this order.
    </p>

    <p style="color: #374151;">
      Best regards,<br>
      ${data.managerName}<br>
      ${data.restaurantName}
    </p>
  `,
  );
}

export function deliveryReminderTemplate(data: DeliveryReminderData): string {
  return baseLayout(
    "Delivery Reminder",
    `
    <h2 style="margin-top: 0; color: #111827;">Delivery Reminder</h2>
    
    <p style="color: #374151;">Dear ${data.providerName},</p>
    
    <p style="color: #374151;">
      This is a friendly reminder about an upcoming delivery:
    </p>

    <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 4px; margin: 16px 0;">
      <div class="info-row"><span class="info-label">Order Number</span><span class="info-value">${data.orderNumber}</span></div>
      <div class="info-row"><span class="info-label">Wine</span><span class="info-value">${wineNameWithFormat(data.wineName, data.bottleSizeMl)}</span></div>
      <div class="info-row"><span class="info-label">Quantity</span><span class="info-value">${data.quantity} bottles</span></div>
      <div class="info-row"><span class="info-label">Expected Date</span><span class="info-value" style="font-weight: 700;">${data.expectedDeliveryDate}</span></div>
      ${data.deliveryAddress ? `<div class="info-row"><span class="info-label">Delivery Address</span><span class="info-value">${data.deliveryAddress}</span></div>` : ""}
    </div>

    <p style="color: #374151;">
      Please confirm if the delivery is on schedule. If there are any changes, 
      kindly let us know as soon as possible.
    </p>

    <p style="color: #374151;">
      Thank you,<br>
      ${data.restaurantName}
    </p>
  `,
  );
}
