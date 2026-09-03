import {
  Injectable,
  Logger,
  Inject,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { GmailService } from "./gmail.service";
import { SmsService } from "./sms.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { DatabaseService } from "../database/database.service";
import {
  LowStockAlertDto,
  MultiChannelResultDto,
  CommunicationResultDto,
} from "./dto/communication.dto";

export interface LowStockAlertPayload {
  wineName: string;
  wineId?: string;
  currentStock: number;
  threshold: number;
  avgDailySales?: number;
  recommendedQty?: number;
  preferredSupplier?: string;
  estimatedDelivery?: string;
  restaurantId?: string;
}

export interface AlertRecipients {
  emails: string[];
  phones?: string[];
}

/**
 * Result of a conversation-log write.
 *
 * `stored` exists so that "the call returned" cannot be mistaken for "the row
 * landed". The previous shape was `{ data, error }`, and the one call site read
 * a null `data` as merely uninteresting; the write had in fact never once
 * succeeded. A caller that ignores `error` still cannot ignore `stored`.
 */
export interface StoredConversationResult {
  /** True only if a row exists in procurement_conversations because of this call. */
  stored: boolean;
  data: { id: string } | null;
  error: { message: string; code?: string } | null;
}

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly gmailService: GmailService,
    private readonly smsService: SmsService,
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway?: WebsocketGateway,
  ) {}

  /**
   * Send a low stock alert via all channels (email, SMS, websocket)
   */
  async sendLowStockAlert(
    payload: LowStockAlertPayload,
    recipients: AlertRecipients,
  ): Promise<MultiChannelResultDto> {
    this.logger.log(`Sending low stock alert for: ${payload.wineName}`);
    this.logger.log(
      `Recipients - Emails: ${recipients.emails.join(", ")}, Phones: ${recipients.phones?.join(", ") || "none"}`,
    );

    const results: MultiChannelResultDto = {
      success: true,
      timestamp: new Date().toISOString(),
    };

    // Send email
    if (recipients.emails.length > 0) {
      try {
        const emailResult = await this.gmailService.sendLowStockAlert({
          to: recipients.emails,
          wineName: payload.wineName,
          currentStock: payload.currentStock,
          threshold: payload.threshold,
          avgDailySales: payload.avgDailySales,
          recommendedQty: payload.recommendedQty,
          preferredSupplier: payload.preferredSupplier,
          estimatedDelivery: payload.estimatedDelivery,
        });

        results.email = {
          success: emailResult.success,
          messageId: emailResult.messageId,
          error: emailResult.error,
          channel: "email",
        };

        if (!emailResult.success) {
          results.success = false;
        }
      } catch (error) {
        results.email = {
          success: false,
          error: error instanceof Error ? error.message : "Email send failed",
          channel: "email",
        };
        results.success = false;
      }
    }

    // Send SMS
    if (recipients.phones && recipients.phones.length > 0) {
      try {
        for (const phone of recipients.phones) {
          const smsResult = await this.smsService.sendLowStockAlert({
            to: phone,
            wineName: payload.wineName,
            currentStock: payload.currentStock,
            threshold: payload.threshold,
          });

          results.sms = {
            success: smsResult.success,
            messageId: smsResult.messageId,
            error: smsResult.error,
            channel: "sms",
          };

          if (!smsResult.success) {
            results.success = false;
          }
        }
      } catch (error) {
        results.sms = {
          success: false,
          error: error instanceof Error ? error.message : "SMS send failed",
          channel: "sms",
        };
        results.success = false;
      }
    }

    // Send WebSocket notification
    if (payload.restaurantId && this.websocketGateway) {
      try {
        const severity =
          payload.currentStock <= payload.threshold * 0.5
            ? "Critical"
            : "Low Stock";
        const emoji =
          payload.currentStock <= payload.threshold * 0.5 ? "🚨" : "⚠️";

        this.websocketGateway.server
          .to(`restaurant:${payload.restaurantId}`)
          .emit("notification:new", {
            type: "low_stock",
            title: `${emoji} ${severity}: ${payload.wineName}`,
            body: `Only ${payload.currentStock} bottles remaining (threshold: ${payload.threshold})`,
            data: {
              wineId: payload.wineId,
              wineName: payload.wineName,
              currentStock: payload.currentStock,
              threshold: payload.threshold,
              restaurantId: payload.restaurantId,
            },
            requireInteraction: payload.currentStock <= payload.threshold * 0.5,
            actions: [
              { action: "reorder", title: "🛒 Reorder Now" },
              { action: "view", title: "📊 View Inventory" },
            ],
          });

        results.websocket = {
          success: true,
          channel: "websocket",
        };

        this.logger.log(
          `WebSocket notification sent to restaurant:${payload.restaurantId}`,
        );
      } catch (error) {
        results.websocket = {
          success: false,
          error:
            error instanceof Error ? error.message : "WebSocket send failed",
          channel: "websocket",
        };
      }
    }

    this.logger.log(`Low stock alert completed. Success: ${results.success}`);
    return results;
  }

  /**
   * Send a daily summary SMS to manager.
   *
   * `deliveriesToday` was dropped from this signature on 2026-09-02 — see
   * `SmsService.sendDailySummary`. It was a hardcoded `0` all the way down.
   */
  async sendDailySummary(data: {
    recipientPhone: string;
    restaurantName: string;
    lowStockCount: number;
    pendingOrders: number;
  }): Promise<CommunicationResultDto> {
    this.logger.log(`Sending daily summary SMS to: ${data.recipientPhone}`);

    const result = await this.smsService.sendDailySummary({
      to: data.recipientPhone,
      restaurantName: data.restaurantName,
      lowStockCount: data.lowStockCount,
      pendingOrders: data.pendingOrders,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      channel: "sms",
    };
  }

  /**
   * Send weekly inventory report via email
   */
  async sendWeeklyReport(data: {
    recipientEmails: string[];
    restaurantId: string;
    reportData: {
      totalBottles: number;
      lowStockCount: number;
      totalValue: number;
      topSellers: Array<{ name: string; sold: number; revenue: number }>;
      lowStockItems: Array<{
        name: string;
        current: number;
        threshold: number;
      }>;
      conversationSummaries?: Array<{
        provider: string;
        summary: string;
        status: string;
        messageCount: number;
      }>;
    };
  }): Promise<CommunicationResultDto> {
    this.logger.log(
      `Sending weekly report to: ${data.recipientEmails.join(", ")}`,
    );

    const html = this.generateWeeklyReportHtml(data.reportData);

    const result = await this.gmailService.sendEmail({
      to: data.recipientEmails,
      subject: `📊 Weekly Wine Inventory Report - ${new Date().toLocaleDateString()}`,
      html,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      channel: "email",
    };
  }

  /**
   * Generate HTML for weekly report
   */
  private generateWeeklyReportHtml(data: {
    totalBottles: number;
    lowStockCount: number;
    totalValue: number;
    topSellers: Array<{ name: string; sold: number; revenue: number }>;
    lowStockItems: Array<{ name: string; current: number; threshold: number }>;
    conversationSummaries?: Array<{
      provider: string;
      summary: string;
      status: string;
      messageCount: number;
    }>;
  }): string {
    const topSellersRows = data.topSellers
      .map(
        (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.sold}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${item.revenue.toLocaleString()}</td>
      </tr>
    `,
      )
      .join("");

    const lowStockRows = data.lowStockItems
      .map(
        (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: bold;">${item.current}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.threshold}</td>
      </tr>
    `,
      )
      .join("");

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Weekly Wine Inventory Report</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width: 700px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden;">
    <!-- Header -->
    <tr>
      <td style="padding: 30px; background: linear-gradient(135deg, #7c2d12 0%, #991b1b 100%); text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px;">📊 Weekly Wine Report</h1>
        <p style="margin: 10px 0 0; color: rgba(255,255,255,0.8);">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </td>
    </tr>
    
    <!-- Summary Metrics -->
    <tr>
      <td style="padding: 30px;">
        <table width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td width="33%" style="padding: 15px; text-align: center; background-color: #f0fdf4; border-radius: 8px;">
              <p style="margin: 0; color: #166534; font-size: 32px; font-weight: bold;">${data.totalBottles.toLocaleString()}</p>
              <p style="margin: 5px 0 0; color: #15803d; font-size: 14px;">Total Bottles</p>
            </td>
            <td width="5px"></td>
            <td width="33%" style="padding: 15px; text-align: center; background-color: #fef2f2; border-radius: 8px;">
              <p style="margin: 0; color: #dc2626; font-size: 32px; font-weight: bold;">${data.lowStockCount}</p>
              <p style="margin: 5px 0 0; color: #991b1b; font-size: 14px;">Low Stock Items</p>
            </td>
            <td width="5px"></td>
            <td width="33%" style="padding: 15px; text-align: center; background-color: #f0f9ff; border-radius: 8px;">
              <p style="margin: 0; color: #0369a1; font-size: 32px; font-weight: bold;">$${(data.totalValue / 1000).toFixed(1)}K</p>
              <p style="margin: 5px 0 0; color: #0c4a6e; font-size: 14px;">Total Value</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    
    <!-- Top Sellers -->
    <tr>
      <td style="padding: 0 30px 30px;">
        <h2 style="margin: 0 0 15px; color: #111827; font-size: 18px;">🏆 Top Sellers This Week</h2>
        <table width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <tr style="background-color: #f9fafb;">
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Wine</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Units Sold</th>
            <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151;">Revenue</th>
          </tr>
          ${topSellersRows}
        </table>
      </td>
    </tr>
    
    <!-- Low Stock Items -->
    ${
      data.lowStockItems.length > 0
        ? `
    <tr>
      <td style="padding: 0 30px 30px;">
        <h2 style="margin: 0 0 15px; color: #111827; font-size: 18px;">⚠️ Low Stock Alert</h2>
        <table width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #fecaca; border-radius: 8px; overflow: hidden;">
          <tr style="background-color: #fef2f2;">
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #991b1b;">Wine</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #991b1b;">Current</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #991b1b;">Threshold</th>
          </tr>
          ${lowStockRows}
        </table>
      </td>
    </tr>
    `
        : ""
    }

    <!-- Conversation Summaries -->
    ${
      data.conversationSummaries && data.conversationSummaries.length > 0
        ? `
    <tr>
      <td style="padding: 0 30px 30px;">
        <h2 style="margin: 0 0 15px; color: #111827; font-size: 18px;">💬 Vendor Communication Summary</h2>
        <table width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #dbeafe; border-radius: 8px; overflow: hidden;">
          <tr style="background-color: #eff6ff;">
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #1e40af;">Provider</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; color: #1e40af;">Summary</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #1e40af;">Messages</th>
            <th style="padding: 12px; text-align: center; font-weight: 600; color: #1e40af;">Status</th>
          </tr>
          ${data.conversationSummaries
            .map(
              (c) => `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${c.provider}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px;">${c.summary}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${c.messageCount}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">
              <span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; background: ${c.status === "sent" || c.status === "active" ? "#d1fae5" : "#dbeafe"}; color: ${c.status === "sent" || c.status === "active" ? "#059669" : "#2563eb"};">
                ${c.status}
              </span>
            </td>
          </tr>
          `,
            )
            .join("")}
        </table>
      </td>
    </tr>
    `
        : ""
    }
    
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 30px; background-color: #f9fafb; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #6b7280; font-size: 12px;">
          This report was automatically generated by WineOps AI.<br>
          <a href="#" style="color: #7c2d12;">View full dashboard</a> | <a href="#" style="color: #7c2d12;">Manage preferences</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  /**
   * Find a provider by contact email
   */
  async findProviderByEmail(email: string, restaurantId: string) {
    try {
      const { data, error } = await this.databaseService.supabase
        .from("providers")
        .select("id, name, contact_name, contact_email")
        .eq("restaurant_id", restaurantId)
        .ilike("contact_email", `%${email}%`)
        .limit(1)
        .maybeSingle();

      if (error) {
        this.logger.warn(`Provider lookup by email failed: ${error.message}`);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (e: any) {
      this.logger.warn(`findProviderByEmail failed: ${e?.message}`);
      return { data: null, error: e };
    }
  }

  /**
   * Store an outbound conversation record in procurement_conversations.
   *
   * ADR 0065. This wrote `sender_email`, `recipient_email`, `subject` and
   * `message_body`. `procurement_conversations` has never had any of them, so
   * every call answered 42703/PGRST204 and returned an error that the caller
   * logged at warn level and stepped over. The table held 27 rows on
   * 2026-09-02 and not one came from here.
   *
   * The parameter names are deliberately camelCase now: the four snake_case
   * ones read like column names and were treated as such. They are inputs. The
   * mapping onto the real columns is the whole point of this method:
   *
   *   body          -> message_text        (text, NOT NULL)
   *   subject       -> email_headers.subject
   *   senderEmail   -> email_headers.from
   *   recipientEmail-> email_headers.to
   *
   * `email_headers` is jsonb and already has one convention, set by the live
   * inbound path (`rabbitmq-bridge.service.ts` handleInboundEmail): lowercase
   * RFC-822 header names — `from`, `subject`, `message_id`, `in_reply_to`,
   * `references` — alongside `gmail_thread_id`. `to` is the RFC name for the
   * recipient and follows the same rule; inbound rows omit it only because the
   * recipient there is us. Verified against production: of 27 rows, 13 carry
   * email_headers and their key set is exactly {subject, in_reply_to,
   * references, message_id, from, gmail_thread_id}. Writing a second shape here
   * would break `procurement.service.ts` and `conversationGrouping.ts`, which
   * both thread on `email_headers.subject`.
   *
   * NOT NULL columns are refused, never defaulted. `message_text`,
   * `restaurant_id`, `provider_id`, `direction` and `channel` have no defaults;
   * a placeholder body would be indistinguishable from a real short message in
   * /communications and in the weekly manager email, which is exactly what
   * ADR 0020 and ADR 0051 forbid. A conversation with no body is not a
   * conversation record, so we decline and say which field was missing.
   *
   * This never throws. The email it accompanies has already been sent, and
   * failing the caller would misreport that. It also never reports success it
   * did not have: `stored` is false and the failure is logged at error level
   * with the table and the key set that was attempted.
   */
  async storeOutboundConversation(params: {
    restaurantId: string;
    providerId?: string;
    orderId?: string | null;
    direction: string;
    channel: string;
    senderEmail: string;
    recipientEmail: string;
    subject: string;
    body: string;
    detected_intent?: string;
    detected_sentiment?: string;
    status: string;
  }): Promise<StoredConversationResult> {
    // Every NOT NULL column of procurement_conversations that has no default.
    // `id` and `created_at` default; everything else here must be supplied.
    const missing = (
      [
        ["restaurantId", params.restaurantId],
        ["providerId", params.providerId],
        ["direction", params.direction],
        ["channel", params.channel],
        ["body", params.body],
      ] as const
    )
      .filter(([, value]) => !value || !String(value).trim())
      .map(([name]) => name);

    if (missing.length > 0) {
      const message =
        `Refusing to store a conversation: ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} empty, and the matching ` +
        `procurement_conversations column is NOT NULL with no default. ` +
        `Storing a placeholder would put an invented message body in front of ` +
        `a manager (ADR 0020, ADR 0051), so the row is not written.`;
      this.logger.error(message);
      return { stored: false, data: null, error: { message, code: "MISSING" } };
    }

    const payload = {
      restaurant_id: params.restaurantId,
      provider_id: params.providerId,
      order_id: params.orderId || null,
      direction: params.direction,
      channel: params.channel,
      message_text: params.body,
      email_headers: {
        from: params.senderEmail || null,
        to: params.recipientEmail || null,
        subject: params.subject || null,
      },
      detected_intent: params.detected_intent || null,
      detected_sentiment: params.detected_sentiment || null,
      delivery_status: params.status,
    };

    try {
      const { data, error } = await this.databaseService.supabase
        .from("procurement_conversations")
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        this.logger.error(
          `procurement_conversations insert FAILED — the outbound message was ` +
            `not recorded. code=${(error as any).code ?? "none"} ` +
            `message=${error.message} keys=[${Object.keys(payload).join(", ")}]`,
        );
        return {
          stored: false,
          data: null,
          error: { message: error.message, code: (error as any).code },
        };
      }

      return { stored: true, data, error: null };
    } catch (e: any) {
      this.logger.error(
        `procurement_conversations insert THREW — the outbound message was ` +
          `not recorded: ${e?.message} keys=[${Object.keys(payload).join(", ")}]`,
      );
      return {
        stored: false,
        data: null,
        error: { message: e?.message ?? String(e), code: e?.code },
      };
    }
  }

  /**
   * Get communication service status
   */
  getStatus() {
    return {
      gmailReady: this.gmailService.isReady(),
      smsReady: this.smsService.isReady(),
      websocketReady: !!this.websocketGateway,
    };
  }
}
