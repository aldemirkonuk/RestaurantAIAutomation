/**
 * Email Template Categories
 * Default categories and example templates for the GmailTemplateBuilder
 */

import type {
  TemplateCategoryConfig,
  EmailTemplate,
  TemplatePanel,
} from '../types/emailTemplates'

// Default Template Categories
export const templateCategories: TemplateCategoryConfig[] = [
  {
    name: 'Inventory',
    icon: 'Package',
    color: '#8B5CF6', // purple
    description: 'Reports about stock levels, inventory counts, and wine availability',
    defaultSubject: 'Inventory Report - {{date}}',
    suggestedRecipients: ['inventory@restaurant.com', 'manager@restaurant.com'],
  },
  {
    name: 'Financial',
    icon: 'DollarSign',
    color: '#10B981', // green
    description: 'Financial summaries, cost analysis, and revenue reports',
    defaultSubject: 'Financial Summary - {{period}}',
    suggestedRecipients: ['finance@restaurant.com', 'owner@restaurant.com'],
  },
  {
    name: 'Order',
    icon: 'TrendingUp',
    color: '#F59E0B', // amber
    description: 'Order confirmations, procurement updates, and supplier communications',
    defaultSubject: 'Order Update - {{orderNumber}}',
    suggestedRecipients: ['orders@restaurant.com', 'suppliers@winedistributor.com'],
  },
  {
    name: 'Custom',
    icon: 'Edit3',
    color: '#6366F1', // indigo
    description: 'Custom templates for specific needs and ad-hoc communications',
    defaultSubject: 'Wine Operations Update',
    suggestedRecipients: [],
  },
]

// Helper function to create a common header panel
const createHeaderPanel = (title: string): TemplatePanel => ({
  id: `header-${Date.now()}`,
  type: 'text',
  position: { x: 0, y: 0 },
  size: { width: 100, height: 10 },
  config: {
    content: title,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#111827',
    backgroundColor: '#F3F4F6',
    padding: 20,
  },
})

// Helper function to create a metric panel
const createMetricPanel = (
  id: string,
  label: string,
  value: number | string,
  change?: number,
  position?: { x: number; y: number }
): TemplatePanel => ({
  id,
  type: 'metric',
  position: position || { x: 0, y: 15 },
  size: { width: 25, height: 15 },
  config: {
    id,
    label,
    value,
    change,
    changeType: change && change > 0 ? 'positive' : change && change < 0 ? 'negative' : 'neutral',
    trend: change && change > 0 ? 'up' : change && change < 0 ? 'down' : 'flat',
    format: typeof value === 'number' ? 'currency' : 'number',
  },
})

// Example Templates
export const defaultTemplates: EmailTemplate[] = [
  // 1. Inventory Template
  {
    id: 'template-inventory-1',
    name: 'Weekly Inventory Summary',
    category: 'Inventory',
    description: 'Comprehensive weekly inventory status with stock levels and alerts',
    subject: 'Weekly Wine Inventory Report - {{date}}',
    to: ['inventory@restaurant.com'],
    cc: ['manager@restaurant.com'],
    panels: [
      createHeaderPanel('Weekly Inventory Summary'),
      {
        id: 'inv-summary-text',
        type: 'text',
        position: { x: 0, y: 12 },
        size: { width: 100, height: 8 },
        config: {
          content: 'Here is your weekly wine inventory summary for the period ending {{date}}.',
          fontSize: 14,
          textAlign: 'left',
          color: '#374151',
          padding: 15,
        },
      },
      createMetricPanel('inv-total-bottles', 'Total Bottles', 1247, undefined, { x: 0, y: 22 }),
      createMetricPanel('inv-low-stock', 'Low Stock Items', 12, undefined, { x: 25, y: 22 }),
      createMetricPanel('inv-out-of-stock', 'Out of Stock', 3, undefined, { x: 50, y: 22 }),
      createMetricPanel('inv-total-value', 'Total Value', 42850, undefined, { x: 75, y: 22 }),
      {
        id: 'inv-chart',
        type: 'chart',
        position: { x: 0, y: 40 },
        size: { width: 100, height: 30 },
        config: {
          type: 'bar',
          title: 'Stock by Wine Type',
          data: [
            { category: 'Red', value: 520 },
            { category: 'White', value: 385 },
            { category: 'Sparkling', value: 210 },
            { category: 'Rosé', value: 132 },
          ],
          xAxis: 'category',
          yAxis: 'value',
          colors: ['#DC2626', '#FBBF24', '#F59E0B', '#EC4899'],
          legend: true,
        },
      },
      {
        id: 'inv-low-stock-table',
        type: 'table',
        position: { x: 0, y: 72 },
        size: { width: 100, height: 25 },
        config: {
          headers: ['Wine Name', 'Current Stock', 'Threshold', 'Status'],
          rows: [
            ['Château Margaux 2015', '2 bottles', '12 bottles', 'Critical'],
            ['Opus One 2019', '5 bottles', '8 bottles', 'Low'],
            ['Caymus Cabernet', '7 bottles', '10 bottles', 'Low'],
          ],
          striped: true,
          bordered: true,
          hoverable: true,
        },
      },
    ],
    backgroundColor: '#FFFFFF',
    padding: 20,
    maxWidth: 800,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault: true,
    scheduleRecurring: {
      enabled: true,
      frequency: 'weekly',
      dayOfWeek: 1, // Monday
      time: '09:00',
    },
  },

  // 2. Financial Template
  {
    id: 'template-financial-1',
    name: 'Monthly Financial Report',
    category: 'Financial',
    description: 'Monthly wine program financial performance and cost analysis',
    subject: 'Monthly Wine Financial Report - {{month}} {{year}}',
    to: ['finance@restaurant.com'],
    cc: ['owner@restaurant.com'],
    bcc: ['accounting@restaurant.com'],
    panels: [
      createHeaderPanel('Monthly Wine Financial Report'),
      {
        id: 'fin-summary-text',
        type: 'text',
        position: { x: 0, y: 12 },
        size: { width: 100, height: 8 },
        config: {
          content: 'Financial performance summary for your wine program in {{month}}.',
          fontSize: 14,
          textAlign: 'left',
          color: '#374151',
          padding: 15,
        },
      },
      createMetricPanel('fin-revenue', 'Total Revenue', 58420, 12.5, { x: 0, y: 22 }),
      createMetricPanel('fin-cogs', 'Cost of Goods Sold', 23170, -5.2, { x: 25, y: 22 }),
      createMetricPanel('fin-profit', 'Gross Profit', 35250, 18.3, { x: 50, y: 22 }),
      createMetricPanel('fin-margin', 'Profit Margin', '60.3%', 4.1, { x: 75, y: 22 }),
      {
        id: 'fin-revenue-chart',
        type: 'chart',
        position: { x: 0, y: 40 },
        size: { width: 60, height: 30 },
        config: {
          type: 'line',
          title: 'Revenue Trend',
          data: [
            { month: 'Jan', revenue: 52000 },
            { month: 'Feb', revenue: 48500 },
            { month: 'Mar', revenue: 55200 },
            { month: 'Apr', revenue: 58420 },
          ],
          xAxis: 'month',
          yAxis: 'revenue',
          colors: ['#10B981'],
          legend: false,
        },
      },
      {
        id: 'fin-category-pie',
        type: 'chart',
        position: { x: 62, y: 40 },
        size: { width: 38, height: 30 },
        config: {
          type: 'pie',
          title: 'Sales by Category',
          data: [
            { name: 'Red', value: 35200 },
            { name: 'White', value: 15800 },
            { name: 'Sparkling', value: 7420 },
          ],
          colors: ['#DC2626', '#FBBF24', '#F59E0B'],
          legend: true,
        },
      },
      {
        id: 'fin-top-sellers',
        type: 'table',
        position: { x: 0, y: 72 },
        size: { width: 100, height: 25 },
        config: {
          headers: ['Wine', 'Units Sold', 'Revenue', 'Profit Margin'],
          rows: [
            ['Opus One 2019', '42 bottles', '$12,600', '62%'],
            ['Château Margaux 2015', '18 bottles', '$8,100', '58%'],
            ['Dom Pérignon 2012', '24 bottles', '$7,200', '55%'],
          ],
          striped: true,
          bordered: true,
        },
      },
    ],
    backgroundColor: '#FFFFFF',
    padding: 20,
    maxWidth: 800,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault: true,
    scheduleRecurring: {
      enabled: true,
      frequency: 'monthly',
      dayOfMonth: 1,
      time: '08:00',
    },
  },

  // 3. Order Template
  {
    id: 'template-order-1',
    name: 'Order Confirmation',
    category: 'Order',
    description: 'Confirmation email for wine order placed with supplier',
    subject: 'Order Confirmation - #{{orderNumber}}',
    to: ['supplier@winedistributor.com'],
    cc: ['orders@restaurant.com'],
    panels: [
      createHeaderPanel('Wine Order Confirmation'),
      {
        id: 'order-intro-text',
        type: 'text',
        position: { x: 0, y: 12 },
        size: { width: 100, height: 10 },
        config: {
          content:
            'Thank you for your quote. We would like to proceed with the following wine order. Please confirm receipt and estimated delivery date.',
          fontSize: 14,
          textAlign: 'left',
          color: '#374151',
          padding: 15,
        },
      },
      {
        id: 'order-details-shape',
        type: 'shape',
        position: { x: 0, y: 24 },
        size: { width: 100, height: 20 },
        config: {
          type: 'rectangle',
          color: '#F3F4F6',
          borderColor: '#D1D5DB',
          borderWidth: 1,
          borderRadius: 8,
        },
      },
      {
        id: 'order-details-text',
        type: 'text',
        position: { x: 2, y: 26 },
        size: { width: 96, height: 16 },
        config: {
          content: `Order Number: #{{orderNumber}}
Date: {{date}}
Expected Delivery: {{deliveryDate}}
Payment Terms: Net 30`,
          fontSize: 13,
          textAlign: 'left',
          color: '#111827',
          padding: 10,
        },
      },
      {
        id: 'order-items-table',
        type: 'table',
        position: { x: 0, y: 46 },
        size: { width: 100, height: 30 },
        config: {
          headers: ['Wine Name', 'Vintage', 'Quantity', 'Unit Price', 'Total'],
          rows: [
            ['Dom Pérignon Champagne', '2012', '24 bottles', '$185', '$4,440'],
            ['Opus One Napa Valley', '2019', '12 bottles', '$295', '$3,540'],
            ['Château Margaux', '2015', '6 bottles', '$450', '$2,700'],
          ],
          striped: true,
          bordered: true,
          hoverable: true,
        },
      },
      {
        id: 'order-total-metric',
        type: 'metric',
        position: { x: 70, y: 78 },
        size: { width: 30, height: 12 },
        config: {
          id: 'order-total',
          label: 'Order Total',
          value: 10680,
          format: 'currency',
        },
      },
      {
        id: 'order-footer-text',
        type: 'text',
        position: { x: 0, y: 92 },
        size: { width: 100, height: 8 },
        config: {
          content: 'Please confirm this order and provide an estimated delivery timeframe. Thank you!',
          fontSize: 12,
          textAlign: 'center',
          color: '#6B7280',
          padding: 15,
        },
      },
    ],
    backgroundColor: '#FFFFFF',
    padding: 20,
    maxWidth: 800,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault: true,
  },

  // 4. Custom Template - Event Invitation
  {
    id: 'template-custom-1',
    name: 'Wine Tasting Invitation',
    category: 'Custom',
    description: 'Invitation for special wine tasting event',
    subject: 'You\'re Invited: Exclusive Wine Tasting Event',
    to: [],
    panels: [
      {
        id: 'event-header-shape',
        type: 'shape',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 25 },
        config: {
          type: 'rectangle',
          color: '#7C2D12', // wine color
          borderRadius: 0,
        },
      },
      {
        id: 'event-title',
        type: 'text',
        position: { x: 0, y: 5 },
        size: { width: 100, height: 15 },
        config: {
          content: 'Exclusive Wine Tasting\nBordeaux Collection 2019',
          fontSize: 28,
          fontWeight: 'bold',
          textAlign: 'center',
          color: '#FFFFFF',
          padding: 10,
        },
      },
      {
        id: 'event-details',
        type: 'text',
        position: { x: 10, y: 30 },
        size: { width: 80, height: 40 },
        config: {
          content: `Join us for an intimate evening exploring exceptional wines from Bordeaux's renowned 2019 vintage.

Date: {{date}}
Time: {{time}}
Location: {{location}}
Dress Code: Smart Casual

Featured Wines:
• Château Margaux 2019
• Château Lafite Rothschild 2019
• Château Latour 2019
• Pomerol Selection 2019

Paired with artisanal cheeses and gourmet appetizers.`,
          fontSize: 14,
          textAlign: 'left',
          color: '#111827',
          padding: 20,
        },
      },
      {
        id: 'event-rsvp-shape',
        type: 'shape',
        position: { x: 25, y: 75 },
        size: { width: 50, height: 12 },
        config: {
          type: 'rectangle',
          color: '#DC2626',
          borderRadius: 8,
        },
      },
      {
        id: 'event-rsvp-text',
        type: 'text',
        position: { x: 25, y: 75 },
        size: { width: 50, height: 12 },
        config: {
          content: 'RSVP by {{rsvpDate}}',
          fontSize: 16,
          fontWeight: 'bold',
          textAlign: 'center',
          color: '#FFFFFF',
        },
      },
      {
        id: 'event-contact',
        type: 'text',
        position: { x: 0, y: 90 },
        size: { width: 100, height: 10 },
        config: {
          content: 'Contact: events@restaurant.com | (555) 123-4567',
          fontSize: 12,
          textAlign: 'center',
          color: '#6B7280',
          padding: 10,
        },
      },
    ],
    backgroundColor: '#F9FAFB',
    padding: 0,
    maxWidth: 700,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault: false,
  },

  // 5. Custom Template - Low Stock Alert
  {
    id: 'template-custom-2',
    name: 'Urgent Low Stock Alert',
    category: 'Custom',
    description: 'Alert template for critical low stock situations',
    subject: '🚨 URGENT: Critical Stock Alert - {{wineName}}',
    to: ['manager@restaurant.com'],
    cc: ['owner@restaurant.com'],
    panels: [
      {
        id: 'alert-header',
        type: 'shape',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 15 },
        config: {
          type: 'rectangle',
          color: '#FEE2E2',
          borderColor: '#DC2626',
          borderWidth: 2,
        },
      },
      {
        id: 'alert-title',
        type: 'text',
        position: { x: 0, y: 2 },
        size: { width: 100, height: 11 },
        config: {
          content: '⚠️ CRITICAL STOCK ALERT',
          fontSize: 24,
          fontWeight: 'bold',
          textAlign: 'center',
          color: '#DC2626',
        },
      },
      {
        id: 'alert-message',
        type: 'text',
        position: { x: 5, y: 18 },
        size: { width: 90, height: 25 },
        config: {
          content: `The following wine has reached critically low stock levels and requires immediate attention:

Wine: {{wineName}}
Current Stock: {{currentStock}} bottles
Threshold: {{threshold}} bottles
Last Sale: {{lastSale}}

This wine is a {{frequency}} seller and should be reordered immediately to avoid stockouts during peak service times.`,
          fontSize: 14,
          textAlign: 'left',
          color: '#111827',
          padding: 15,
        },
      },
      createMetricPanel('alert-current-stock', 'Current Stock', 2, undefined, { x: 0, y: 46 }),
      createMetricPanel('alert-threshold', 'Min Threshold', 12, undefined, { x: 25, y: 46 }),
      createMetricPanel('alert-avg-daily', 'Avg Daily Sales', 1.5, undefined, { x: 50, y: 46 }),
      createMetricPanel('alert-days-left', 'Days Until Stockout', 1, undefined, { x: 75, y: 46 }),
      {
        id: 'alert-action-shape',
        type: 'shape',
        position: { x: 10, y: 65 },
        size: { width: 80, height: 20 },
        config: {
          type: 'rectangle',
          color: '#FBBF24',
          borderRadius: 8,
        },
      },
      {
        id: 'alert-action-text',
        type: 'text',
        position: { x: 10, y: 67 },
        size: { width: 80, height: 16 },
        config: {
          content: `Recommended Action:
Order {{recommendedQty}} bottles immediately from {{preferredSupplier}}
Estimated delivery: {{estimatedDelivery}}`,
          fontSize: 14,
          fontWeight: 'bold',
          textAlign: 'center',
          color: '#FFFFFF',
        },
      },
      {
        id: 'alert-footer',
        type: 'text',
        position: { x: 0, y: 88 },
        size: { width: 100, height: 12 },
        config: {
          content: 'This is an automated alert from Mudavym. Please take action as soon as possible.',
          fontSize: 11,
          textAlign: 'center',
          color: '#6B7280',
          fontStyle: 'italic',
          padding: 10,
        },
      },
    ],
    backgroundColor: '#FFFFFF',
    padding: 20,
    maxWidth: 700,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault: false,
  },
]

