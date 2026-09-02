import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface SmsOptions {
  to: string;
  message: string;
}

export interface SmsBulkOptions {
  recipients: string[];
  message: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private plivoClient: any;
  private fromNumber: string;
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const authId = this.configService.get<string>("PLIVO_AUTH_ID");
    const authToken = this.configService.get<string>("PLIVO_AUTH_TOKEN");
    this.fromNumber =
      this.configService.get<string>("PLIVO_PHONE_NUMBER") || "";

    if (!authId || !authToken || !this.fromNumber) {
      this.logger.warn(
        "Plivo credentials not configured. SMS sending will be mocked.",
      );
      return;
    }

    try {
      // Dynamic import for Plivo SDK
      const plivo = await import("plivo");
      this.plivoClient = new plivo.Client(authId, authToken);
      this.isConfigured = true;
      this.logger.log("Plivo SMS client initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Plivo client:", error);
      this.logger.warn("SMS sending will be mocked.");
    }
  }

  /**
   * Send an SMS message
   */
  async sendSms(options: SmsOptions): Promise<SmsResult> {
    this.logger.log(`Sending SMS to: ${options.to}`);

    if (!this.isConfigured) {
      return this.reportUnsentSms(options);
    }

    try {
      const response = await this.plivoClient.messages.create(
        this.fromNumber,
        options.to,
        options.message,
      );

      this.logger.log(
        `SMS sent successfully. Message UUID: ${response.messageUuid}`,
      );

      return {
        success: true,
        messageId: response.messageUuid,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to send SMS: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send SMS to multiple recipients
   */
  async sendBulkSms(options: SmsBulkOptions): Promise<SmsResult[]> {
    const results: SmsResult[] = [];

    for (const recipient of options.recipients) {
      const result = await this.sendSms({
        to: recipient,
        message: options.message,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Send a low stock alert SMS
   */
  async sendLowStockAlert(data: {
    to: string;
    wineName: string;
    currentStock: number;
    threshold: number;
  }): Promise<SmsResult> {
    const severity =
      data.currentStock <= data.threshold * 0.5 ? "CRITICAL" : "LOW STOCK";

    // "Reply REORDER to auto-order" was removed 2026-09-02. There is no
    // inbound SMS handler anywhere in this repository — no Plivo message
    // webhook, no route, no consumer. A manager who replied REORDER got
    // silence and had every reason to believe the wine was on its way. An
    // instruction the system cannot honour is worse than no instruction.
    const message = `🚨 ${severity}: ${data.wineName}
Stock: ${data.currentStock}/${data.threshold} bottles
Action needed — reorder in WineOps.
- WineOps AI`;

    return this.sendSms({
      to: data.to,
      message: message.substring(0, 160), // SMS character limit
    });
  }

  /**
   * Send a daily summary SMS.
   *
   * "Deliveries today" was removed 2026-09-02. The figure was never measured:
   * `scheduled-tasks.service.ts#getDailySummaryData` returned a literal `0`
   * with the comment "Would need to query deliveries table", and this method
   * texted it to the manager in the same list as two numbers that ARE read
   * from the database. A reader has no way to tell which of the three was
   * measured. The founder chose the honest subtraction over a new query: a
   * shorter true message beats a longer one with an invented line in it.
   * `lowStockCount` and `pendingOrders` are both real reads and stay.
   */
  async sendDailySummary(data: {
    to: string;
    restaurantName: string;
    lowStockCount: number;
    pendingOrders: number;
  }): Promise<SmsResult> {
    const message = `📊 ${data.restaurantName} Daily
Low stock: ${data.lowStockCount}
Pending orders: ${data.pendingOrders}
Check WineOps for details.`;

    return this.sendSms({
      to: data.to,
      message: message.substring(0, 160),
    });
  }

  /**
   * Send a delivery notification SMS
   */
  async sendDeliveryNotification(data: {
    to: string;
    providerName: string;
    itemCount: number;
    estimatedTime?: string;
  }): Promise<SmsResult> {
    const message = data.estimatedTime
      ? `📦 Delivery from ${data.providerName}: ${data.itemCount} items arriving at ${data.estimatedTime}. - WineOps AI`
      : `📦 Delivery from ${data.providerName}: ${data.itemCount} items on the way! - WineOps AI`;

    return this.sendSms({
      to: data.to,
      message: message.substring(0, 160),
    });
  }

  /**
   * Send an order approval request SMS
   */
  async sendOrderApprovalRequest(data: {
    to: string;
    wineName: string;
    quantity: number;
    totalPrice: number;
    orderId: string;
  }): Promise<SmsResult> {
    // "Reply YES to approve or NO to decline" was removed 2026-09-02, for the
    // same reason as the REORDER prompt above: nothing in this repository
    // receives an inbound SMS. This one was the more dangerous of the two —
    // a manager who replied YES believed they had approved a purchase.
    const message = `🍷 Order Request: ${data.quantity}x ${data.wineName} ($${data.totalPrice.toFixed(0)})
Approve or decline it in WineOps.
Order #${data.orderId.substring(0, 8)}`;

    return this.sendSms({
      to: data.to,
      message: message.substring(0, 160),
    });
  }

  /**
   * No SMS provider is configured, so nothing was sent. Print the message the
   * way the old mock did — that is genuinely useful in development — and then
   * say what happened.
   *
   * This used to return `{ success: true, messageId: "mock_sms_..." }`. Every
   * caller believed it: `MultiChannelResultDto.success` stayed true for the
   * low-stock alert, `sendDailySummary` reported a delivered summary, and the
   * per-tenant cron counted the tenant as succeeded. An unconfigured provider
   * is ABSENCE, and absence was being read as HEALTH — the fault recorded in
   * [[absence-reported-as-health]]. The log line is for the developer; the
   * return value is for the program, and it must not claim a delivery that
   * never left the building.
   *
   * There is deliberately no `messageId`: a fabricated id is worse than none,
   * because it is the thing a human would later try to trace with the carrier.
   */
  private reportUnsentSms(options: SmsOptions): SmsResult {
    this.logger.log("=".repeat(50));
    this.logger.log("SMS NOT SENT — no Plivo credentials configured");
    this.logger.log("=".repeat(50));
    this.logger.log(`Would have gone to: ${options.to}`);
    this.logger.log(`From: ${this.fromNumber || "(no PLIVO_PHONE_NUMBER)"}`);
    this.logger.log("-".repeat(50));
    this.logger.log(`Message (${options.message.length} chars):`);
    this.logger.log(options.message);
    this.logger.log("=".repeat(50));

    return {
      success: false,
      error: "SMS not configured",
    };
  }

  /**
   * Check if SMS is properly configured
   */
  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Validate phone number format
   */
  validatePhoneNumber(phone: string): boolean {
    // Basic E.164 format validation
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test(phone);
  }

  /**
   * Format phone number to E.164
   */
  formatToE164(phone: string, defaultCountryCode = "1"): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, "");

    // If already has country code (11+ digits starting with 1 for US)
    if (digits.length >= 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }

    // Add default country code
    if (digits.length === 10) {
      return `+${defaultCountryCode}${digits}`;
    }

    // Return as-is with + prefix
    return `+${digits}`;
  }
}
