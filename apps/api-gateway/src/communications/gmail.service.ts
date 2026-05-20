import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as nodemailer from 'nodemailer';
import {
  lowStockAlertTemplate,
  weeklyReportTemplate,
  dailySummaryTemplate,
  orderApprovalTemplate,
  deliveryNotificationTemplate,
  recurringOrderReminderTemplate,
  deliveryETATemplate,
  paymentDueTemplate,
  inventoryAuditTemplate,
  eventPrepTemplate,
  customReminderTemplate,
  onboardingEmailTemplate,
  type LowStockAlertData,
  type WeeklyReportData,
  type DailySummaryData,
  type OrderApprovalData,
  type DeliveryNotificationData,
  type RecurringOrderReminderData,
  type DeliveryETAData,
  type PaymentDueData,
  type InventoryAuditData,
  type EventPrepData,
  type CustomReminderData,
  getSeverityLabel,
} from './email-templates';

export interface EmailOptions {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  messageIdHeader?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

@Injectable()
export class GmailService implements OnModuleInit {
  private readonly logger = new Logger(GmailService.name);
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private senderEmail: string;
  private isConfigured = false;
  private gmailCredentials: { clientId: string; clientSecret: string; refreshToken: string } | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const clientId = this.configService.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.configService.get<string>('GMAIL_REFRESH_TOKEN');
    this.senderEmail = this.configService.get<string>('GMAIL_SENDER_EMAIL') || 'notifications@wineops.ai';

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn('Gmail credentials not configured. Email sending will be mocked.');
      return;
    }

    // Defer googleapis loading to first sendEmail() — the 187MB package blocks the event loop for 60-90s
    this.gmailCredentials = { clientId, clientSecret, refreshToken };
    this.logger.log('Gmail API deferred — will initialize on first send (fast startup).');
  }

  private async ensureGmailReady(): Promise<boolean> {
    if (this.isConfigured) return true;
    if (!this.gmailCredentials) return false;
    try {
      const { clientId, clientSecret, refreshToken } = this.gmailCredentials;
      // Supply the short-lived access token alongside the refresh token so the
      // OAuth2 client uses it immediately (if not yet expired) and only hits
      // Google's token endpoint when the access token is stale.
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      const tokenTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getAccessToken timed out after 10s')), 10000),
      );
      const { token } = await Promise.race([
        this.oauth2Client.getAccessToken(),
        tokenTimeout,
      ]);
      if (!token) throw new Error('No access token returned from Google');

      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      // Resolve the actual sender address from the Gmail profile so the From
      // header matches the OAuth2-authorized account. Using a mismatched From
      // (e.g. notifications@wineops.ai when the account is a @gmail.com address)
      // fails SPF/DKIM alignment and lands in spam.
      try {
        const profile = await this.gmail.users.getProfile({ userId: 'me' });
        if (profile.data.emailAddress) {
          this.senderEmail = profile.data.emailAddress;
          this.logger.log(`Gmail sender resolved to: ${this.senderEmail}`);
        }
      } catch {
        this.logger.warn(`Could not resolve Gmail sender email — using configured value: ${this.senderEmail}`);
      }

      this.isConfigured = true;
      this.logger.log('Gmail API initialized via OAuth2');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const responseData = (error as any)?.response?.data;
      this.logger.error(
        `Gmail OAuth2 failed: ${msg}` +
        (responseData ? ` | Response: ${JSON.stringify(responseData)}` : ''),
      );
      this.gmailCredentials = null;
      return false;
    }
  }

  /**
   * Send an email via Gmail API
   */
  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    this.logger.log(`Sending email to: ${options.to.join(', ')}`);
    this.logger.log(`Subject: ${options.subject}`);

    if (!await this.ensureGmailReady()) {
      try {
        return await this.smtpSendEmail(options);
      } catch (smtpError) {
        const smtpMsg = smtpError instanceof Error ? smtpError.message : String(smtpError);
        this.logger.error(
          `SMTP fallback also failed: ${smtpMsg}. ` +
          'Fix GMAIL_REFRESH_TOKEN (run scripts/gmail-reauth.js) ' +
          'or set a valid GMAIL_APP_PASSWORD (Google App Password).',
        );
        return { success: false, error: `Email delivery failed: ${smtpMsg}` };
      }
    }

    try {
      const message = this.createMimeMessage(options);
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const requestBody: any = { raw: encodedMessage };
      if (options.threadId) {
        requestBody.threadId = options.threadId;
      }

      const result = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody,
      });

      this.logger.log(`Email sent successfully. Message ID: ${result.data.id}, Thread ID: ${result.data.threadId}`);

      return {
        success: true,
        messageId: result.data.id || undefined,
        threadId: result.data.threadId || undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const httpStatus = (error as any)?.status ?? (error as any)?.code;
      const responseData = (error as any)?.response?.data;
      this.logger.error(
        `Failed to send email via Gmail API: ${errorMessage}` +
        (httpStatus ? ` [HTTP ${httpStatus}]` : '') +
        (responseData ? ` | Response: ${JSON.stringify(responseData)}` : ''),
      );

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send a low stock alert email using the template system
   */
  async sendLowStockAlert(data: {
    to: string[];
    wineName: string;
    currentStock: number;
    threshold: number;
    avgDailySales?: number;
    recommendedQty?: number;
    preferredSupplier?: string;
    estimatedDelivery?: string;
  }): Promise<EmailResult> {
    const severity = getSeverityLabel(data.currentStock, data.threshold);
    
    // Use the new template system
    const html = lowStockAlertTemplate(data);

    const daysUntilStockout = data.avgDailySales 
      ? Math.ceil(data.currentStock / data.avgDailySales)
      : null;

    const text = `
${severity} ALERT: ${data.wineName}

Current Stock: ${data.currentStock} bottles
Threshold: ${data.threshold} bottles
${daysUntilStockout ? `Days Until Stockout: ~${daysUntilStockout} days` : ''}

${data.recommendedQty ? `Recommended Action: Order ${data.recommendedQty} bottles from ${data.preferredSupplier || 'preferred supplier'}` : ''}
${data.estimatedDelivery ? `Estimated Delivery: ${data.estimatedDelivery}` : ''}

This is an automated alert from WineOps AI.
    `.trim();

    return this.sendEmail({
      to: data.to,
      subject: `${severity}: ${data.wineName} - Only ${data.currentStock} bottles remaining`,
      html,
      text,
    });
  }

  /**
   * Send a weekly report email using the template system
   */
  async sendWeeklyReport(data: {
    to: string[];
    restaurantName: string;
    reportPeriod: { start: Date | string; end: Date | string };
    metrics: {
      totalBottles: number;
      lowStockCount: number;
      totalValue: number;
      ordersPlaced?: number;
      deliveriesReceived?: number;
    };
    topSellers: Array<{ name: string; sold: number; revenue: number }>;
    lowStockItems: Array<{ name: string; current: number; threshold: number }>;
  }): Promise<EmailResult> {
    const html = weeklyReportTemplate(data);

    return this.sendEmail({
      to: data.to,
      subject: `Weekly Inventory Report - ${data.restaurantName}`,
      html,
    });
  }

  /**
   * Send a daily summary email using the template system
   */
  async sendDailySummaryEmail(data: {
    to: string[];
    restaurantName: string;
    date: Date | string;
    metrics: {
      lowStockCount: number;
      pendingOrders: number;
      deliveriesToday: number;
      totalInventoryValue?: number;
    };
    alerts: Array<{
      type: 'low_stock' | 'delivery' | 'order' | 'expiring';
      title: string;
      message: string;
    }>;
    actionItems?: Array<{
      priority: 'high' | 'medium' | 'low';
      description: string;
    }>;
  }): Promise<EmailResult> {
    const html = dailySummaryTemplate(data);

    return this.sendEmail({
      to: data.to,
      subject: `Daily Summary - ${data.restaurantName}`,
      html,
    });
  }

  /**
   * Send an order approval request email
   */
  async sendOrderApprovalEmail(data: {
    to: string[];
    orderId: string;
    providerName: string;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
    totalAmount: number;
    requestedBy: string;
    requestedAt: Date | string;
    urgency?: 'normal' | 'high' | 'critical';
    notes?: string;
  }): Promise<EmailResult> {
    const html = orderApprovalTemplate(data);

    const urgencyPrefix = data.urgency === 'critical' ? 'URGENT: ' : data.urgency === 'high' ? 'Action Required: ' : '';

    return this.sendEmail({
      to: data.to,
      subject: `${urgencyPrefix}Order Approval Required - ${data.providerName}`,
      html,
    });
  }

  /**
   * Send a delivery notification email
   */
  async sendDeliveryNotificationEmail(data: {
    to: string[];
    orderId: string;
    providerName: string;
    deliveryDate: Date | string;
    items: Array<{ name: string; quantity: number; received?: number }>;
    status: 'scheduled' | 'in_transit' | 'delivered' | 'partial';
    trackingNumber?: string;
    notes?: string;
  }): Promise<EmailResult> {
    const html = deliveryNotificationTemplate(data);

    const statusLabels = {
      scheduled: 'Delivery Scheduled',
      in_transit: 'Delivery In Transit',
      delivered: 'Delivery Complete',
      partial: 'Partial Delivery',
    };

    return this.sendEmail({
      to: data.to,
      subject: `${statusLabels[data.status]} - Order #${data.orderId}`,
      html,
    });
  }

  /**
   * Send a recurring order reminder email
   */
  async sendRecurringOrderReminder(data: {
    to: string[];
    restaurantName: string;
    orderName: string;
    providerName: string;
    scheduledDate: Date | string;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
    totalAmount: number;
    frequency: string;
    lastOrderDate?: Date | string;
    notes?: string;
  }): Promise<EmailResult> {
    const html = recurringOrderReminderTemplate(data);

    return this.sendEmail({
      to: data.to,
      subject: `Recurring Order Reminder: ${data.providerName} - ${data.orderName}`,
      html,
    });
  }

  /**
   * Send a delivery ETA notification email
   */
  async sendDeliveryETANotification(data: {
    to: string[];
    restaurantName: string;
    orderId: string;
    providerName: string;
    expectedDate: Date | string;
    expectedTimeWindow?: string;
    items: Array<{ name: string; quantity: number }>;
    totalItems: number;
    trackingNumber?: string;
    driverName?: string;
    driverPhone?: string;
    specialInstructions?: string;
  }): Promise<EmailResult> {
    const html = deliveryETATemplate(data);

    return this.sendEmail({
      to: data.to,
      subject: `Delivery Arriving: Order #${data.orderId} from ${data.providerName}`,
      html,
    });
  }

  /**
   * Send a payment due reminder email
   */
  async sendPaymentDueReminder(data: {
    to: string[];
    restaurantName: string;
    invoiceNumber: string;
    providerName: string;
    dueDate: Date | string;
    amount: number;
    items?: Array<{ name: string; quantity: number; amount: number }>;
    paymentTerms?: string;
    daysUntilDue: number;
    paymentMethod?: string;
    notes?: string;
  }): Promise<EmailResult> {
    const html = paymentDueTemplate(data);
    const urgencyPrefix = data.daysUntilDue <= 1 ? 'URGENT: ' : data.daysUntilDue <= 3 ? 'Reminder: ' : '';

    return this.sendEmail({
      to: data.to,
      subject: `${urgencyPrefix}Payment Due - Invoice #${data.invoiceNumber} (${data.providerName})`,
      html,
    });
  }

  /**
   * Send an inventory audit reminder email
   */
  async sendInventoryAuditReminder(data: {
    to: string[];
    restaurantName: string;
    scheduledDate: Date | string;
    scheduledTime?: string;
    lastAuditDate?: Date | string;
    daysSinceLastAudit?: number;
    totalBottles: number;
    totalValue: number;
    discrepancyCount?: number;
    focusAreas?: Array<{ area: string; reason: string }>;
    assignedStaff?: string[];
    notes?: string;
  }): Promise<EmailResult> {
    const html = inventoryAuditTemplate(data);

    return this.sendEmail({
      to: data.to,
      subject: `Inventory Audit Reminder - ${data.restaurantName}`,
      html,
    });
  }

  /**
   * Send an event preparation reminder email
   */
  async sendEventPrepReminder(data: {
    to: string[];
    restaurantName: string;
    eventName: string;
    eventDate: Date | string;
    eventTime?: string;
    guestCount?: number;
    eventType?: string;
    wineRequirements?: Array<{ name: string; quantityNeeded: number; currentStock: number; shortfall: number }>;
    totalBottlesNeeded?: number;
    estimatedCost?: number;
    organizer?: string;
    specialRequests?: string;
    notes?: string;
  }): Promise<EmailResult> {
    const html = eventPrepTemplate(data);
    const hasShortfalls = data.wineRequirements?.some(w => w.shortfall > 0) ?? false;

    return this.sendEmail({
      to: data.to,
      subject: `${hasShortfalls ? 'ACTION NEEDED: ' : ''}Event Prep - ${data.eventName}`,
      html,
    });
  }

  /**
   * Send a custom/ad-hoc reminder email
   */
  async sendCustomReminder(data: {
    to: string[];
    restaurantName: string;
    title: string;
    description: string;
    reminderType: string;
    scheduledDate?: Date | string;
    scheduledTime?: string;
    createdBy?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    actionItems?: string[];
    relatedLinks?: Array<{ label: string; url: string }>;
    isRecurring?: boolean;
    recurrencePattern?: string;
    notes?: string;
  }): Promise<EmailResult> {
    const html = customReminderTemplate(data);
    const priorityPrefix = data.priority === 'urgent' ? 'URGENT: ' : data.priority === 'high' ? 'Important: ' : '';

    return this.sendEmail({
      to: data.to,
      subject: `${priorityPrefix}${data.title} - ${data.restaurantName}`,
      html,
    });
  }

  /**
   * Create a MIME message for Gmail API
   */
  private createMimeMessage(options: EmailOptions): string {
    const boundary = `boundary_${Date.now()}`;
    const generatedMessageId = options.messageIdHeader || `<wineops-${Date.now()}-${Math.random().toString(36).slice(2)}@wineops.ai>`;
    
    const headers = [
      `From: WineOps AI <${this.senderEmail}>`,
      `To: ${options.to.join(', ')}`,
      options.cc?.length ? `Cc: ${options.cc.join(', ')}` : '',
      options.bcc?.length ? `Bcc: ${options.bcc.join(', ')}` : '',
      options.replyTo ? `Reply-To: ${options.replyTo}` : '',
      `Message-ID: ${generatedMessageId}`,
      options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : '',
      options.references ? `References: ${options.references}` : '',
      `Subject: ${options.subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean).join('\r\n');

    const textPart = options.text || this.htmlToPlainText(options.html);
    
    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      textPart,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      options.html,
      `--${boundary}--`,
    ].join('\r\n');

    return `${headers}\r\n\r\n${body}`;
  }

  /**
   * Convert HTML to plain text (simple implementation)
   */
  private htmlToPlainText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Real SMTP fallback via Nodemailer + GMAIL_APP_PASSWORD.
   * Used when the Gmail API OAuth2 flow fails (e.g. expired token).
   * Never returns a mock ID — throws if SMTP credentials are missing.
   */
  private async smtpSendEmail(options: EmailOptions): Promise<EmailResult> {
    // Fall back to process.env directly — ConfigService may not inherit it in all
    // NestJS test module contexts (same issue as GMAIL_ACCESS_TOKEN for OAuth2).
    const user =
      this.configService.get<string>('GMAIL_USER') ||
      process.env.GMAIL_USER;
    const pass =
      this.configService.get<string>('GMAIL_APP_PASSWORD') ||
      process.env.GMAIL_APP_PASSWORD;

    if (!user || !pass) {
      this.logger.error(
        'Gmail OAuth2 failed and no SMTP fallback configured ' +
        '(set GMAIL_USER + GMAIL_APP_PASSWORD). Email NOT sent.',
      );
      return { success: false, error: 'No email delivery method available — OAuth failed and SMTP not configured' };
    }

    this.logger.log(`Gmail OAuth2 unavailable — sending via SMTP (${user})`);

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass },
    });

    const info = await transporter.sendMail({
      from: `"WineOps AI" <${this.senderEmail}>`,
      to: options.to.join(', '),
      cc: options.cc?.length ? options.cc.join(', ') : undefined,
      bcc: options.bcc?.length ? options.bcc.join(', ') : undefined,
      subject: options.subject,
      html: options.html,
      text: options.text || this.htmlToPlainText(options.html),
    });

    this.logger.log(`Email delivered via SMTP. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  }

  /**
   * Send a welcome / onboarding email immediately after first registration
   */
  async sendOnboardingEmail(data: {
    to: string;
    ownerName: string;
    restaurantName: string;
    restaurantCity?: string;
    frontendBaseUrl?: string;
  }): Promise<EmailResult> {
    const base = data.frontendBaseUrl || 'https://restaurant-ai-automation-web.vercel.app';
    const html = onboardingEmailTemplate({
      ownerName: data.ownerName,
      restaurantName: data.restaurantName,
      restaurantCity: data.restaurantCity || '',
      dashboardUrl: `${base}/dashboard`,
      settingsUrl: `${base}/settings`,
      inviteUrl: `${base}/settings?tab=team`,
    });

    return this.sendEmail({
      to: [data.to],
      subject: `Welcome to WineOps AI — ${data.restaurantName} is ready 🍷`,
      html,
    });
  }

  /**
   * Check if Gmail is properly configured
   */
  isReady(): boolean {
    return this.isConfigured;
  }
}
