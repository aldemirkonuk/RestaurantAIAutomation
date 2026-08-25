import {
  Controller,
  Post,
  Get,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  Query,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { CommunicationsService } from "./communications.service";
import { GmailService } from "./gmail.service";
import { SmsService } from "./sms.service";
import { GmailWatchService } from "./gmail-watch.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { DatabaseService } from "../database/database.service";
import {
  SendEmailDto,
  SendSmsDto,
  LowStockAlertDto,
  DailySummaryDto,
  SendTemplateTestDto,
  MultiChannelResultDto,
  CommunicationResultDto,
  CommunicationStatusDto,
} from "./dto/communication.dto";
import { Public } from "../auth/decorators/public.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Communications")
/**
 * OD-20 — guarded at class level 2026-08-25.
 *
 * This controller had no guard and no @Public(). It was not protected by
 * TenantGuard either: that guard fails OPEN by design —
 * "If no authenticated user, allow through — JwtAuthGuard should enforce where
 * required" (tenant.guard.ts) — and nothing here required it.
 *
 * Verified live before the fix: GET /api/v1/dashboard/stats/<uuid> returned 200
 * with JSON to an unauthenticated caller.
 *
 * Routes that are genuinely public must now say so with @Public(), so intent is
 * recorded rather than inferred from an absent decorator.
 */
@UseGuards(JwtAuthGuard)
@Controller("communications")
export class CommunicationsController {
  private readonly logger = new Logger(CommunicationsController.name);
  private readonly managerEmails: string[];

  constructor(
    private readonly communicationsService: CommunicationsService,
    private readonly gmailService: GmailService,
    private readonly smsService: SmsService,
    private readonly gmailWatchService: GmailWatchService,
    private readonly orchestratorService: OrchestratorService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    // Parse comma-separated emails from MANAGER_EMAIL
    const emailConfig = this.configService.get<string>("MANAGER_EMAIL") || "";
    this.managerEmails = emailConfig
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e);
    this.logger.log(
      `Configured manager emails: ${this.managerEmails.join(", ")}`,
    );
  }

  /**
   * Get communication service status
   */
  @Get("status")
  @ApiOperation({ summary: "Get communication services status" })
  @ApiResponse({ status: 200, type: CommunicationStatusDto })
  getStatus(): CommunicationStatusDto {
    return this.communicationsService.getStatus();
  }

  /**
   * Send a raw email
   */
  @Post("email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send an email via Gmail API" })
  @ApiResponse({ status: 200, type: CommunicationResultDto })
  async sendEmail(@Body() dto: SendEmailDto): Promise<CommunicationResultDto> {
    this.logger.log(`Sending email to: ${dto.to.join(", ")}`);

    const result = await this.gmailService.sendEmail({
      to: dto.to,
      subject: dto.subject,
      html: dto.bodyHtml,
      text: dto.bodyText,
      cc: dto.cc,
      bcc: dto.bcc,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      channel: "email",
    };
  }

  /**
   * Send a raw SMS
   */
  @Post("sms")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send an SMS via Plivo" })
  @ApiResponse({ status: 200, type: CommunicationResultDto })
  async sendSms(@Body() dto: SendSmsDto): Promise<CommunicationResultDto> {
    this.logger.log(`Sending SMS to: ${dto.to}`);

    const result = await this.smsService.sendSms({
      to: dto.to,
      message: dto.message,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      channel: "sms",
    };
  }

  /**
   * Send a low stock alert via all channels
   */
  @Post("alerts/low-stock")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Send low stock alert via email, SMS, and websocket",
  })
  @ApiResponse({ status: 200, type: MultiChannelResultDto })
  async sendLowStockAlert(
    @Body() dto: LowStockAlertDto,
  ): Promise<MultiChannelResultDto> {
    this.logger.log(`Sending low stock alert for: ${dto.wineName}`);

    const recipients = {
      emails: [dto.recipientEmail],
      phones: dto.recipientPhone ? [dto.recipientPhone] : undefined,
    };

    return this.communicationsService.sendLowStockAlert(
      {
        wineName: dto.wineName,
        wineId: dto.wineId,
        currentStock: dto.currentStock,
        threshold: dto.threshold,
        avgDailySales: dto.avgDailySales,
        recommendedQty: dto.recommendedQty,
        preferredSupplier: dto.preferredSupplier,
        estimatedDelivery: dto.estimatedDelivery,
        restaurantId: dto.restaurantId,
      },
      recipients,
    );
  }

  /**
   * Send a daily summary SMS
   */
  @Post("alerts/daily-summary")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send daily summary SMS to manager" })
  @ApiResponse({ status: 200, type: CommunicationResultDto })
  async sendDailySummary(
    @Body() dto: DailySummaryDto,
  ): Promise<CommunicationResultDto> {
    this.logger.log(`Sending daily summary to: ${dto.recipientPhone}`);

    return this.communicationsService.sendDailySummary({
      recipientPhone: dto.recipientPhone,
      restaurantName: dto.restaurantName,
      lowStockCount: dto.lowStockCount,
      pendingOrders: dto.pendingOrders,
      deliveriesToday: dto.deliveriesToday,
    });
  }

  /**
   * TEST ENDPOINT: Simulate low stock alert scenario — sends to MANAGER_EMAIL recipients only.
   */
  @Post("test/low-stock-alert")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "TEST: Simulate low stock alert to configured manager emails",
    description:
      "This endpoint simulates a wine reaching its threshold level and triggers an email alert to all MANAGER_EMAIL recipients.",
  })
  @ApiResponse({ status: 200, type: MultiChannelResultDto })
  async testLowStockAlert(): Promise<MultiChannelResultDto> {
    if (this.managerEmails.length === 0) {
      throw new BadRequestException(
        "MANAGER_EMAIL is not set — configure it to receive test alerts, or use POST /communications/email with explicit recipients.",
      );
    }
    this.logger.log("=".repeat(60));
    this.logger.log("TEST SCENARIO: Low Stock Alert");
    this.logger.log("=".repeat(60));
    this.logger.log("Wine: Chateau Margaux 2015");
    this.logger.log("Current Stock: 2 bottles");
    this.logger.log("Threshold: 12 bottles");
    this.logger.log(`Recipients: ${this.managerEmails.join(", ")}`);
    this.logger.log("=".repeat(60));

    const testPayload: LowStockAlertDto = {
      recipientEmail: this.managerEmails[0], // Primary for DTO (actual send uses all emails)
      wineName: "Chateau Margaux 2015",
      currentStock: 2,
      threshold: 12,
      avgDailySales: 1.5,
      recommendedQty: 24,
      preferredSupplier: "Premium Wine Distributors",
      estimatedDelivery: "2-3 business days",
      wineId: "test-wine-001",
      restaurantId: "test-restaurant-001",
    };

    // Send to ALL configured manager emails via the full alert system
    const result = await this.communicationsService.sendLowStockAlert(
      {
        wineName: testPayload.wineName,
        wineId: testPayload.wineId,
        currentStock: testPayload.currentStock,
        threshold: testPayload.threshold,
        avgDailySales: testPayload.avgDailySales,
        recommendedQty: testPayload.recommendedQty,
        preferredSupplier: testPayload.preferredSupplier,
        estimatedDelivery: testPayload.estimatedDelivery,
        restaurantId: testPayload.restaurantId,
      },
      {
        emails: this.managerEmails,
      },
    );

    this.logger.log("=".repeat(60));
    this.logger.log(
      `Test completed. Email sent to: ${this.managerEmails.join(", ")}`,
    );
    if (result.email?.messageId) {
      this.logger.log(`Email Message ID: ${result.email.messageId}`);
    }
    this.logger.log("=".repeat(60));

    return result;
  }

  /**
   * TEST ENDPOINT: Send a simple test email
   */
  @Post("test/email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "TEST: Send a simple test email to all configured recipients",
  })
  @ApiResponse({ status: 200, type: CommunicationResultDto })
  async testEmail(): Promise<CommunicationResultDto> {
    this.logger.log(`Sending test email to: ${this.managerEmails.join(", ")}`);

    const result = await this.gmailService.sendEmail({
      to: this.managerEmails,
      subject: "🍷 WineOps Test Email - Connection Successful!",
      html: `
<!DOCTYPE html>
<html>
<head><title>Test Email</title></head>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <h1 style="color: #7c2d12;">WineOps AI - Test Email</h1>
  <p>Congratulations! Your Gmail API integration is working correctly.</p>
  <p><strong>Recipients:</strong> ${this.managerEmails.join(", ")}</p>
  <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
  <hr>
  <p style="color: #666;">This is an automated test from WineOps AI.</p>
</body>
</html>
      `,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      channel: "email",
    };
  }

  /**
   * TEST ENDPOINT: Send a template email to specified recipients
   * Uses ready-made templates: "test" (simple WineOps test) or "low-stock" (low stock alert with sample data)
   */
  @Public()
  @Post("test/send-template")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "TEST: Send template email to specified recipients",
    description:
      'Send an email using a ready template ("test" or "low-stock") to the given addresses.',
  })
  @ApiResponse({ status: 200, type: CommunicationResultDto })
  async sendTemplateEmail(
    @Body() dto: SendTemplateTestDto,
  ): Promise<CommunicationResultDto> {
    this.logger.log(
      `Sending ${dto.template} template email to: ${dto.to.join(", ")}`,
    );

    if (dto.template === "test") {
      const result = await this.gmailService.sendEmail({
        to: dto.to,
        subject: "🍷 WineOps AI - Test Email",
        html: `
<!DOCTYPE html>
<html>
<head><title>Test Email</title></head>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <h1 style="color: #7c2d12;">WineOps AI - Test Email</h1>
  <p>This email was sent using the WineOps AI ready-made test template.</p>
  <p><strong>Recipients:</strong> ${dto.to.join(", ")}</p>
  <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
  <hr>
  <p style="color: #666;">This is an automated message from WineOps AI.</p>
</body>
</html>
        `,
      });
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
        channel: "email",
      };
    }

    if (dto.template === "low-stock") {
      const result = await this.gmailService.sendLowStockAlert({
        to: dto.to,
        wineName: "Chateau Margaux 2015",
        currentStock: 2,
        threshold: 12,
        avgDailySales: 1.5,
        recommendedQty: 24,
        preferredSupplier: "Premium Wine Distributors",
        estimatedDelivery: "2-3 business days",
      });
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
        channel: "email",
      };
    }

    return {
      success: false,
      error: `Unknown template: ${dto.template}`,
      channel: "email",
    };
  }

  /**
   * TEST ENDPOINT: Full messaging scenario between Manager and Vendor.
   *
   * Flow:
   * 1. Manager sends order inquiry email to vendor
   * 2. Stores outbound message in procurement_conversations
   * 3. Returns the scenario state for monitoring the inbound reply flow
   */
  @Post("test/scenario")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "TEST: Execute full messaging scenario (Manager <-> Vendor)",
    description:
      "Simulates order inquiry → vendor response → AI summarization. Pass managerEmail or set MANAGER_EMAIL.",
  })
  async testMessagingScenario(
    @Body()
    body?: {
      managerEmail?: string;
      vendorEmail?: string;
      restaurantId?: string;
      wineName?: string;
      quantity?: number;
      targetPrice?: number;
    },
  ) {
    const managerEmail = body?.managerEmail ?? this.managerEmails[0];
    if (!managerEmail) {
      throw new BadRequestException(
        "Pass managerEmail in the body or set MANAGER_EMAIL for the default manager address.",
      );
    }
    const vendorEmail = body?.vendorEmail || "konukald@msu.edu";
    const restaurantId =
      body?.restaurantId ||
      this.configService.get<string>(
        "DEFAULT_RESTAURANT_ID",
        "00000000-0000-0000-0000-000000000001",
      );
    const wineName = body?.wineName || "Opus One 2019";
    const quantity = body?.quantity || 12;
    const targetPrice = body?.targetPrice || 350;

    this.logger.log("=".repeat(60));
    this.logger.log("TEST SCENARIO: Full Messaging Flow");
    this.logger.log(`Manager: ${managerEmail}`);
    this.logger.log(`Vendor: ${vendorEmail}`);
    this.logger.log(`Wine: ${wineName} x${quantity} @ $${targetPrice}/bottle`);
    this.logger.log("=".repeat(60));

    const steps: any[] = [];

    try {
      // Step 1: Find or create relevant provider and order
      const { data: provider } =
        await this.communicationsService.findProviderByEmail(
          vendorEmail,
          restaurantId,
        );

      // Step 2: Generate order inquiry email using template
      const { orderInquiryTemplate } = await import("./email-templates");
      const orderNumber = `ORD-${new Date().getFullYear()}-TEST${Math.floor(Math.random() * 10000)}`;

      const emailHtml = orderInquiryTemplate({
        orderNumber,
        wineName,
        quantity,
        targetPrice,
        managerName: "Restaurant Manager",
        restaurantName: "Meyhouse Palo Alto",
        providerName: provider?.name || "Wine Distributor",
        notes: "This is a test scenario order inquiry.",
      });

      // Step 3: Send email to vendor
      const emailResult = await this.gmailService.sendEmail({
        to: [vendorEmail],
        subject: `Wine Order Inquiry: ${wineName} x${quantity} - ${orderNumber}`,
        html: emailHtml,
        replyTo: managerEmail,
      });

      steps.push({
        step: 1,
        action: "email_sent",
        to: vendorEmail,
        subject: `Wine Order Inquiry: ${wineName} x${quantity} - ${orderNumber}`,
        success: emailResult.success,
        messageId: emailResult.messageId,
      });

      // Step 4: Store outbound conversation record
      const { data: convoData, error: convoError } =
        await this.communicationsService.storeOutboundConversation({
          restaurantId,
          providerId: provider?.id,
          orderId: null,
          direction: "outbound",
          channel: "email",
          sender_email: managerEmail,
          recipient_email: vendorEmail,
          subject: `Wine Order Inquiry: ${wineName} x${quantity} - ${orderNumber}`,
          message_body: emailHtml,
          detected_intent: "order_inquiry",
          detected_sentiment: "professional",
          status: "sent",
        });

      steps.push({
        step: 2,
        action: "conversation_stored",
        conversationId: convoData?.id,
        success: !convoError,
        error: convoError?.message,
      });

      // Step 5: Publish event for tracking
      try {
        await this.orchestratorService.publishEvent(
          "procurement.events",
          "procurement.order.created",
          {
            restaurant_id: restaurantId,
            order_number: orderNumber,
            wine_name: wineName,
            quantity,
            target_price: targetPrice,
            vendor_email: vendorEmail,
            manager_email: managerEmail,
            status: "INQUIRY_SENT",
          },
        );
        steps.push({
          step: 3,
          action: "event_published",
          routing_key: "procurement.order.created",
          success: true,
        });
      } catch (pubErr: any) {
        steps.push({
          step: 3,
          action: "event_published",
          success: false,
          error: pubErr?.message,
        });
      }

      this.logger.log("=".repeat(60));
      this.logger.log("Messaging scenario completed successfully");
      this.logger.log(
        `Next: Vendor (${vendorEmail}) should reply to the email.`,
      );
      this.logger.log(
        "The EmailParsingAgent will process the reply, thread it, and generate a summary.",
      );
      this.logger.log("=".repeat(60));

      return {
        status: "scenario_executed",
        manager: managerEmail,
        vendor: vendorEmail,
        orderNumber,
        wine: wineName,
        quantity,
        targetPrice,
        steps,
        nextAction: `Vendor (${vendorEmail}) should reply to the email. The system will auto-process the response via Gmail webhook → EmailParsingAgent → conversation summary.`,
      };
    } catch (error: any) {
      this.logger.error(`Messaging scenario failed: ${error?.message}`);
      return {
        status: "error",
        error: error?.message,
        steps,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // E2E TEST SCENARIO: Manual Override → Threshold → Notification
  //   → Approve → Vendor Email → Vendor Reply → Order Confirmed
  // ══════════════════════════════════════════════════════════════════

  /**
   * STEP 1: Trigger a manual stock override that breaches the threshold.
   * This simulates a manager adjusting stock in the inventory page.
   */
  @Public()
  @Post("test/e2e/step1-trigger-threshold")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "E2E Step 1: Manual override that triggers low-stock threshold",
    description:
      "Overrides a wine stock below threshold, publishes stock.manual_override to RabbitMQ. Expects push + email notification at configured manager email.",
  })
  async e2eStep1TriggerThreshold(
    @Body()
    body?: {
      restaurantId?: string;
      wineId?: string;
      wineName?: string;
      newStock?: number;
      threshold?: number;
    },
  ) {
    const restaurantId =
      body?.restaurantId ||
      this.configService.get(
        "DEFAULT_RESTAURANT_ID",
        "00000000-0000-0000-0000-000000000001",
      );
    const wineName = body?.wineName || "Opus One 2019";
    const newStock = body?.newStock ?? 2;
    const threshold = body?.threshold ?? 12;

    this.logger.log("═".repeat(60));
    this.logger.log("E2E STEP 1: Trigger Manual Override → Threshold Breach");
    this.logger.log(
      `Wine: ${wineName}, New Stock: ${newStock}, Threshold: ${threshold}`,
    );
    this.logger.log("═".repeat(60));

    let inventoryId = body?.wineId;

    // Find or create test inventory item
    if (!inventoryId) {
      const { data: existing } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .ilike("wine_name", `%${wineName}%`)
        .limit(1);

      if (existing?.length) {
        inventoryId = existing[0].id;
      }
    }

    // Update stock via the ledger RPC — restaurant_inventory.stock_live is a
    // projection of inventory_lots (owned by project_stock_from_lots) and is
    // never written directly (SimPOS testbed plan, decision A8).
    if (inventoryId) {
      const { data: current } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("stock_live")
        .eq("id", inventoryId)
        .maybeSingle();
      const delta = newStock - Number(current?.stock_live ?? 0);
      if (delta !== 0) {
        await this.databaseService.supabase.rpc("apply_stock_movement", {
          p_inventory_id: inventoryId,
          p_stock_state: "live",
          p_delta: delta,
          p_transaction_type: "adjustment",
          p_source: "system",
          p_reason: "E2E test — manual spillage scenario",
          p_idempotency_key: `e2e-step1:${inventoryId}:${Date.now()}`,
        });
      }
      await this.databaseService.supabase
        .from("restaurant_inventory")
        .update({ threshold_min: threshold })
        .eq("id", inventoryId);
    }

    // Publish stock.manual_override event to RabbitMQ
    try {
      await this.orchestratorService.publishEvent(
        "stock.events",
        "stock.manual_override",
        {
          restaurant_id: restaurantId,
          inventory_id: inventoryId || "test-inv-001",
          wine_id: inventoryId || "test-inv-001",
          wine_name: wineName,
          old_stock_live: 15,
          new_stock_live: newStock,
          threshold_min: threshold,
          override_reason: "E2E test — manual spillage scenario",
        },
      );
    } catch (err: any) {
      return { status: "error", error: err?.message, step: 1 };
    }

    return {
      status: "step1_complete",
      step: 1,
      inventoryId,
      wineName,
      newStock,
      threshold,
      nextAction: `Manager should receive push notification + email at ${this.managerEmails.join(", ")}. Use the notification to approve the reorder, then call step2.`,
    };
  }

  /**
   * STEP 2: Approve the reorder (simulates manager clicking "Approve" on an order).
   * Triggers AI to draft a vendor email.
   */
  @Public()
  @Post("test/e2e/step2-approve-reorder")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "E2E Step 2: Approve order → triggers AI vendor email draft",
    description:
      "Approves a pending procurement order, publishes conversation intent so AI drafts an email to the vendor.",
  })
  async e2eStep2ApproveReorder(
    @Body() body: { orderId: string; restaurantId?: string },
  ) {
    const restaurantId =
      body.restaurantId ||
      this.configService.get(
        "DEFAULT_RESTAURANT_ID",
        "00000000-0000-0000-0000-000000000001",
      );

    this.logger.log("═".repeat(60));
    this.logger.log(`E2E STEP 2: Approve Order ${body.orderId}`);
    this.logger.log("═".repeat(60));

    // Update order status to APPROVED
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        approved_by: "e2e-test-manager",
      })
      .eq("id", body.orderId)
      .select("*")
      .single();

    if (error) {
      return { status: "error", error: error.message, step: 2 };
    }

    // Publish conversation intent for AI to draft vendor email
    try {
      await this.orchestratorService.publishEvent(
        "procurement.events",
        "procurement.conversation_request",
        {
          intent_type: "order_inquiry",
          order_id: body.orderId,
          provider_id: data.provider_id,
          restaurant_id: restaurantId,
          wine_name: data.wine_name || "",
          quantity: data.quantity,
          target_price:
            data.negotiated_price_per_bottle ||
            data.target_price_per_bottle ||
            0,
          max_acceptable_price:
            (data.negotiated_price_per_bottle ||
              data.target_price_per_bottle ||
              0) * 1.1,
          urgency: data.is_emergency ? "high" : "normal",
          channel_preference: "email",
        },
      );
    } catch (err: any) {
      return { status: "error", error: err?.message, step: 2 };
    }

    return {
      status: "step2_complete",
      step: 2,
      orderId: body.orderId,
      orderStatus: "APPROVED",
      providerId: data.provider_id,
      nextAction:
        "AI will draft a vendor email and send a push notification for approval. Check notifications, then call step3 with the conversationId.",
    };
  }

  /**
   * STEP 3: Approve the AI-drafted email and send it to the vendor.
   */
  @Public()
  @Post("test/e2e/step3-send-vendor-email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "E2E Step 3: Approve AI draft → send email to vendor",
    description:
      "Approves the AI-drafted conversation and sends the email to the vendor (konukald@msu.edu by default).",
  })
  async e2eStep3SendVendorEmail(
    @Body() body: { conversationId: string; modifiedMessage?: string },
  ) {
    this.logger.log("═".repeat(60));
    this.logger.log(
      `E2E STEP 3: Send Vendor Email (conversation: ${body.conversationId})`,
    );
    this.logger.log("═".repeat(60));

    const routingKey = body.modifiedMessage
      ? "conversation.modified"
      : "conversation.approved";

    const payload: any = { conversation_id: body.conversationId };
    if (body.modifiedMessage) {
      payload.modified_message = body.modifiedMessage;
    }

    try {
      await this.orchestratorService.publishEvent(
        "conversation.events",
        routingKey,
        payload,
      );
    } catch (err: any) {
      return { status: "error", error: err?.message, step: 3 };
    }

    return {
      status: "step3_complete",
      step: 3,
      conversationId: body.conversationId,
      action: body.modifiedMessage ? "modified_and_sent" : "approved_and_sent",
      nextAction:
        "Vendor should receive the email. Reply from konukald@msu.edu, then call step4 to check the inbound.",
    };
  }

  /**
   * STEP 4: Check inbound emails and thread summary.
   */
  @Public()
  @Get("test/e2e/step4-check-inbound")
  @ApiOperation({
    summary: "E2E Step 4: Check inbound vendor replies",
    description:
      "Lists recent inbound emails from the vendor, shows thread summary and detected intent.",
  })
  async e2eStep4CheckInbound(
    @Query("orderId") orderId?: string,
    @Query("providerId") providerId?: string,
  ) {
    this.logger.log("═".repeat(60));
    this.logger.log("E2E STEP 4: Check Inbound Vendor Replies");
    this.logger.log("═".repeat(60));

    let query = this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        "id, order_id, provider_id, direction, channel, message_text, detected_intent, detected_sentiment, conversation_summary, confidence_score, created_at, delivery_status, email_headers, manager_approval_status",
      )
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(10);

    if (orderId) query = query.eq("order_id", orderId);
    if (providerId) query = query.eq("provider_id", providerId);

    const { data, error } = await query;

    if (error) {
      return { status: "error", error: error.message, step: 4 };
    }

    return {
      status: "step4_complete",
      step: 4,
      inboundMessages: (data || []).map((m: any) => ({
        id: m.id,
        orderId: m.order_id,
        intent: m.detected_intent,
        sentiment: m.detected_sentiment,
        summary: m.conversation_summary,
        confidence: m.confidence_score,
        preview: (m.message_text || "").substring(0, 200),
        createdAt: m.created_at,
      })),
      count: data?.length || 0,
      nextAction:
        "If vendor replied, you should see their message above. Call step5 to approve the order confirmation.",
    };
  }

  /**
   * STEP 5: Approve order confirmation → AI sends "confirmed, send invoice" email.
   */
  @Public()
  @Post("test/e2e/step5-approve-confirmation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "E2E Step 5: Approve order confirmation to vendor",
    description:
      "Manager confirms the order. AI sends a confirmation + invoice request email to the vendor.",
  })
  async e2eStep5ApproveConfirmation(
    @Body()
    body: {
      orderId: string;
      providerId: string;
      restaurantId?: string;
    },
  ) {
    const restaurantId =
      body.restaurantId ||
      this.configService.get(
        "DEFAULT_RESTAURANT_ID",
        "00000000-0000-0000-0000-000000000001",
      );

    this.logger.log("═".repeat(60));
    this.logger.log(`E2E STEP 5: Approve Order Confirmation (${body.orderId})`);
    this.logger.log("═".repeat(60));

    // Publish conversation request with order_confirmation intent
    try {
      const { data: order } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("wine_name, quantity, negotiated_price_per_bottle")
        .eq("id", body.orderId)
        .single();

      await this.orchestratorService.publishEvent(
        "procurement.events",
        "procurement.conversation_request",
        {
          intent_type: "order_confirmation",
          order_id: body.orderId,
          provider_id: body.providerId,
          restaurant_id: restaurantId,
          wine_name: order?.wine_name || "",
          quantity: order?.quantity || 0,
          target_price: order?.negotiated_price_per_bottle || 0,
          channel_preference: "email",
        },
      );
    } catch (err: any) {
      return { status: "error", error: err?.message, step: 5 };
    }

    return {
      status: "step5_complete",
      step: 5,
      orderId: body.orderId,
      nextAction:
        "AI will draft a confirmation + invoice request email. Approve it via notifications or call step3 again with the new conversationId. When vendor confirms, order auto-transitions to ORDERED.",
    };
  }

  /**
   * STEP 6: Check final order status.
   */
  @Public()
  @Get("test/e2e/step6-check-status")
  @ApiOperation({
    summary: "E2E Step 6: Check order status (should be CONFIRMED/ORDERED)",
    description:
      "Returns the current status of the order and its conversation history.",
  })
  async e2eStep6CheckStatus(@Query("orderId") orderId: string) {
    this.logger.log("═".repeat(60));
    this.logger.log(`E2E STEP 6: Check Order Status (${orderId})`);
    this.logger.log("═".repeat(60));

    const { data: order, error: orderErr } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(
        "id, order_number, wine_name, quantity, status, negotiated_price_per_bottle, target_price_per_bottle, approved_at, created_at, updated_at, provider_id",
      )
      .eq("id", orderId)
      .single();

    if (orderErr) {
      return { status: "error", error: orderErr.message, step: 6 };
    }

    const { data: conversations } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        "id, direction, detected_intent, conversation_summary, delivery_status, created_at",
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    return {
      status: "step6_complete",
      step: 6,
      order: {
        id: order?.id,
        orderNumber: order?.order_number,
        wineName: order?.wine_name,
        quantity: order?.quantity,
        currentStatus: order?.status,
        negotiatedPrice: order?.negotiated_price_per_bottle,
        approvedAt: order?.approved_at,
        updatedAt: order?.updated_at,
      },
      conversationCount: conversations?.length || 0,
      conversations: (conversations || []).map((c: any) => ({
        id: c.id,
        direction: c.direction,
        intent: c.detected_intent,
        summary: c.conversation_summary,
        deliveryStatus: c.delivery_status,
        createdAt: c.created_at,
      })),
      scenarioComplete:
        order?.status === "CONFIRMED" || order?.status === "ORDERED",
    };
  }

  // ── Gmail Inbound Webhook ─────────────────────────────────────────

  /**
   * Receive Gmail push notifications from Google Pub/Sub.
   * Called when new emails arrive in the monitored inbox.
   * Fetches new messages and publishes them to RabbitMQ for the EmailParsingAgent.
   */
  @Public()
  @Post("/webhooks/gmail")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Gmail Pub/Sub push notification webhook",
    description:
      "Receives push notifications from Google Pub/Sub when new emails arrive. Fetches new messages and routes them to the email parsing agent.",
  })
  async handleGmailWebhook(@Body() body: any): Promise<{ status: string }> {
    this.logger.log("Received Gmail push notification");

    if (!this.gmailWatchService.isReady()) {
      this.logger.warn(
        "Gmail Watch not configured — ignoring push notification",
      );
      return { status: "ignored" };
    }

    try {
      // Decode Pub/Sub message
      const message = body?.message;
      if (!message?.data) {
        this.logger.warn("No message data in push notification");
        return { status: "no_data" };
      }

      const decoded = JSON.parse(
        Buffer.from(message.data, "base64").toString("utf-8"),
      );
      const emailAddress = decoded.emailAddress;
      const newHistoryId = decoded.historyId?.toString();

      this.logger.log(
        `Gmail push: email=${emailAddress}, historyId=${newHistoryId}`,
      );

      // Get the last known historyId
      const lastHistoryId = await this.gmailWatchService.getLastHistoryId();
      if (!lastHistoryId) {
        this.logger.warn("No stored historyId — updating and skipping");
        if (newHistoryId) {
          await this.gmailWatchService.updateHistoryId(newHistoryId);
        }
        return { status: "initialized" };
      }

      // Fetch new messages since last historyId
      const newMessages =
        await this.gmailWatchService.fetchNewMessages(lastHistoryId);

      this.logger.log(`Fetched ${newMessages.length} new messages`);

      // Filter for inbound messages (not sent by us).
      // Use the resolved Gmail sender (set from profile on init) so this works
      // regardless of what GMAIL_SENDER_EMAIL is set to in env vars.
      const senderEmail =
        this.gmailService.getSenderEmail() ||
        this.configService.get<string>("GMAIL_SENDER_EMAIL") ||
        "wineops.ai@gmail.com";

      for (const msg of newMessages) {
        const headers = msg.payload?.headers || [];
        const from =
          headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        const subject =
          headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
        const messageId =
          headers.find((h) => h.name?.toLowerCase() === "message-id")?.value ||
          "";
        const inReplyTo =
          headers.find((h) => h.name?.toLowerCase() === "in-reply-to")?.value ||
          "";
        const references =
          headers.find((h) => h.name?.toLowerCase() === "references")?.value ||
          "";

        // Skip our own outbound emails
        if (from.includes(senderEmail)) {
          continue;
        }

        this.logger.log(
          `Inbound email: from=${from}, subject=${subject}, gmailId=${msg.id}`,
        );

        // Extract body (recursively — the text nests under multipart when an
        // attachment is present) plus any image/PDF attachments (e.g. a receipt).
        const { text: extractedText, attachmentRefs } =
          this.extractEmailContent(msg.payload);
        let bodyText = extractedText;
        if (!bodyText && msg.payload?.body?.data) {
          bodyText = Buffer.from(msg.payload.body.data, "base64url").toString(
            "utf-8",
          );
        }
        const attachments = attachmentRefs.length
          ? await this.collectAttachments(msg.id!, attachmentRefs)
          : [];
        if (attachments.length) {
          bodyText =
            `${bodyText}\n\n[Attachments: ${attachments.map((a) => a.filename).join(", ")}]`.trim();
        }

        // Publish to RabbitMQ for EmailParsingAgent to process
        try {
          await this.orchestratorService.publishEvent(
            "email.events",
            "email.inbound.received",
            {
              gmail_message_id: msg.id,
              gmail_thread_id: msg.threadId,
              from,
              subject,
              body: bodyText,
              attachments,
              message_id_header: messageId,
              in_reply_to: inReplyTo,
              references,
              received_at: new Date().toISOString(),
              headers: Object.fromEntries(
                headers
                  .filter((h) => h.name && h.value)
                  .map((h) => [h.name!.toLowerCase(), h.value]),
              ),
            },
          );
        } catch (pubErr) {
          this.logger.error(
            `Failed to publish inbound email to RabbitMQ: ${pubErr}`,
          );
        }
      }

      return { status: "processed", messages: newMessages.length } as any;
    } catch (error) {
      this.logger.error(`Error processing Gmail webhook: ${error}`);
      return { status: "error" };
    }
  }

  /**
   * Gmail Watch status endpoint
   */
  @Get("/webhooks/gmail/status")
  @ApiOperation({ summary: "Get Gmail Watch subscription status" })
  getGmailWatchStatus() {
    return {
      configured: this.gmailWatchService.isReady(),
      service: "gmail-watch",
    };
  }

  /**
   * Force-fetch recent Gmail messages and route them through the inbound pipeline.
   * Bypasses Pub/Sub — directly lists INBOX messages from the last N minutes.
   * Use this to recover missed replies (e.g. after a redeploy reset the historyId).
   */
  @Public()
  @Post("/webhooks/gmail/force-fetch")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Force-fetch recent inbound Gmail messages",
    description:
      "Directly queries Gmail INBOX for messages in the last N minutes and routes them through the email parsing pipeline. Use after missed pushes.",
  })
  async forceGmailFetch(@Body() body?: { minutesBack?: number }): Promise<any> {
    if (!this.gmailWatchService.isReady()) {
      return { status: "error", error: "Gmail Watch not configured" };
    }

    const minutesBack = body?.minutesBack ?? 60;
    const afterEpoch = Math.floor(
      (Date.now() - minutesBack * 60 * 1000) / 1000,
    );

    this.logger.log(
      `Force-fetching Gmail messages from last ${minutesBack} minutes`,
    );

    try {
      const messages = await (
        this.gmailWatchService as any
      ).gmail?.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        q: `after:${afterEpoch}`,
        maxResults: 20,
      });

      const ids: string[] = (messages?.data?.messages || []).map(
        (m: any) => m.id,
      );
      if (!ids.length) {
        return { status: "ok", fetched: 0, processed: 0 };
      }

      const senderEmail =
        this.gmailService.getSenderEmail() ||
        this.configService.get<string>("GMAIL_SENDER_EMAIL") ||
        "";

      let processed = 0;
      for (const id of ids) {
        const fullMsg = await this.gmailWatchService.getMessage(id);
        if (!fullMsg) continue;

        const headers = fullMsg.payload?.headers || [];
        const from =
          headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        const subject =
          headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
        const messageIdHeader =
          headers.find((h) => h.name?.toLowerCase() === "message-id")?.value ||
          "";
        const inReplyTo =
          headers.find((h) => h.name?.toLowerCase() === "in-reply-to")?.value ||
          "";
        const references =
          headers.find((h) => h.name?.toLowerCase() === "references")?.value ||
          "";

        if (senderEmail && from.includes(senderEmail)) continue;

        const { text: extractedText, attachmentRefs } =
          this.extractEmailContent(fullMsg.payload);
        let bodyText = extractedText;
        if (!bodyText && fullMsg.payload?.body?.data) {
          bodyText = Buffer.from(
            fullMsg.payload.body.data,
            "base64url",
          ).toString("utf-8");
        }
        const attachments = attachmentRefs.length
          ? await this.collectAttachments(fullMsg.id!, attachmentRefs)
          : [];
        if (attachments.length) {
          bodyText =
            `${bodyText}\n\n[Attachments: ${attachments.map((a) => a.filename).join(", ")}]`.trim();
        }

        try {
          await this.orchestratorService.publishEvent(
            "email.events",
            "email.inbound.received",
            {
              gmail_message_id: fullMsg.id,
              gmail_thread_id: fullMsg.threadId,
              from,
              subject,
              body: bodyText,
              attachments,
              message_id_header: messageIdHeader,
              in_reply_to: inReplyTo,
              references,
              received_at: new Date().toISOString(),
              headers: Object.fromEntries(
                headers
                  .filter((h) => h.name && h.value)
                  .map((h) => [h.name!.toLowerCase(), h.value]),
              ),
            },
          );
          processed++;
          this.logger.log(
            `Force-fetched inbound email: from=${from}, subject=${subject}, gmail_id=${fullMsg.id}`,
          );
        } catch (pubErr) {
          this.logger.error(`Failed to publish force-fetched email: ${pubErr}`);
        }
      }

      // Update historyId to current so next push notification works correctly
      await this.gmailWatchService.startWatch();

      return { status: "ok", fetched: ids.length, processed };
    } catch (err: any) {
      this.logger.error(`Force-fetch failed: ${err?.message}`);
      return { status: "error", error: err?.message };
    }
  }

  /**
   * Recursively walk a Gmail MIME tree to pull the best text body and list any
   * image/PDF attachments. When an email carries an attachment the text nests one
   * or more levels deep (multipart/mixed → multipart/alternative → text/plain), so
   * a flat scan of the top-level parts misses it and yields an empty body — which
   * is what broke inbound emails that included a confirmation/receipt image.
   */
  private extractEmailContent(payload: any): {
    text: string;
    attachmentRefs: Array<{
      filename: string;
      mimeType: string;
      attachmentId: string;
    }>;
  } {
    let text = "";
    let html = "";
    const attachmentRefs: Array<{
      filename: string;
      mimeType: string;
      attachmentId: string;
    }> = [];

    const walk = (part: any): void => {
      if (!part) return;
      const mimeType: string = part.mimeType || "";
      const data = part.body?.data;
      if (mimeType === "text/plain" && data && !text) {
        text = Buffer.from(data, "base64url").toString("utf-8");
      } else if (mimeType === "text/html" && data && !html) {
        html = Buffer.from(data, "base64url").toString("utf-8");
      } else if (
        (mimeType.startsWith("image/") || mimeType === "application/pdf") &&
        part.body?.attachmentId
      ) {
        attachmentRefs.push({
          filename: part.filename || "attachment",
          mimeType,
          attachmentId: part.body.attachmentId,
        });
      }
      for (const child of part.parts || []) walk(child);
    };
    walk(payload);

    // No text/plain anywhere → render the HTML part down to text so we never
    // hand the AI an empty body.
    if (!text && html) {
      text = html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return { text, attachmentRefs };
  }

  /**
   * Fetch bytes for image/PDF attachments and return them base64-encoded for the
   * vision model. Caps count and per-file size to keep the RabbitMQ event lean.
   */
  private async collectAttachments(
    messageId: string,
    refs: Array<{ filename: string; mimeType: string; attachmentId: string }>,
  ): Promise<Array<{ filename: string; mime_type: string; data: string }>> {
    const MAX_ATTACHMENTS = 3;
    const MAX_B64_LEN = 7_000_000; // ~5 MB raw
    const out: Array<{ filename: string; mime_type: string; data: string }> =
      [];
    for (const ref of refs.slice(0, MAX_ATTACHMENTS)) {
      const b64url = await this.gmailWatchService.getAttachment(
        messageId,
        ref.attachmentId,
      );
      if (!b64url) continue;
      if (b64url.length > MAX_B64_LEN) {
        this.logger.warn(
          `Skipping oversized attachment ${ref.filename} (${b64url.length} b64 chars)`,
        );
        continue;
      }
      // Gmail returns base64url; the Anthropic API expects standard base64.
      const data = b64url.replace(/-/g, "+").replace(/_/g, "/");
      out.push({ filename: ref.filename, mime_type: ref.mimeType, data });
    }
    return out;
  }
}
