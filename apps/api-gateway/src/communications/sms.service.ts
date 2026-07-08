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
      return this.mockSendSms(options);
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

    const message = `🚨 ${severity}: ${data.wineName}
Stock: ${data.currentStock}/${data.threshold} bottles
Action needed! Reply REORDER to auto-order.
- WineOps AI`;

    return this.sendSms({
      to: data.to,
      message: message.substring(0, 160), // SMS character limit
    });
  }

  /**
   * Send a daily summary SMS
   */
  async sendDailySummary(data: {
    to: string;
    restaurantName: string;
    lowStockCount: number;
    pendingOrders: number;
    deliveriesToday: number;
  }): Promise<SmsResult> {
    const message = `📊 ${data.restaurantName} Daily
Low stock: ${data.lowStockCount}
Pending orders: ${data.pendingOrders}
Deliveries today: ${data.deliveriesToday}
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
    const message = `🍷 Order Request: ${data.quantity}x ${data.wineName} ($${data.totalPrice.toFixed(0)})
Reply YES to approve or NO to decline.
Order #${data.orderId.substring(0, 8)}`;

    return this.sendSms({
      to: data.to,
      message: message.substring(0, 160),
    });
  }

  /**
   * Mock SMS sending for development/testing
   */
  private mockSendSms(options: SmsOptions): SmsResult {
    const mockId = `mock_sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.logger.log("=".repeat(50));
    this.logger.log("MOCK SMS SENT");
    this.logger.log("=".repeat(50));
    this.logger.log(`To: ${options.to}`);
    this.logger.log(`From: ${this.fromNumber || "+1234567890"}`);
    this.logger.log("-".repeat(50));
    this.logger.log(`Message (${options.message.length} chars):`);
    this.logger.log(options.message);
    this.logger.log("-".repeat(50));
    this.logger.log(`Mock Message ID: ${mockId}`);
    this.logger.log("=".repeat(50));

    return {
      success: true,
      messageId: mockId,
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
