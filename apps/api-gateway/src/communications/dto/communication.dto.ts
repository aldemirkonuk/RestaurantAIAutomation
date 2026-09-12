import {
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
  IsEmail,
  Min,
  IsBoolean,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SendEmailDto {
  @ApiProperty({
    description: "Email recipients",
    example: ["ops@your-restaurant.com"],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  to: string[];

  @ApiProperty({
    description: "Email subject",
    example: "Low Stock Alert: Chateau Margaux 2015",
  })
  @IsString()
  subject: string;

  @ApiProperty({ description: "HTML body content" })
  @IsString()
  bodyHtml: string;

  @ApiPropertyOptional({ description: "Plain text body content" })
  @IsOptional()
  @IsString()
  bodyText?: string;

  @ApiPropertyOptional({ description: "CC recipients" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiPropertyOptional({ description: "BCC recipients" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  bcc?: string[];

  // ADR 0099 — the four threading fields.
  //
  // These are not new capability. `EmailOptions` (gmail.service.ts:36-48) has
  // always carried them, `createMimeMessage` has always emitted `Reply-To`,
  // `In-Reply-To` and `References`, and `users.messages.send` has always taken
  // `threadId`. Only this DTO was missing them — and with
  // `forbidNonWhitelisted: true` (main.ts:51-57) an undeclared field is not
  // ignored, it is a 400. So every THREADED vendor reply from the orchestrator
  // (`email_composer_service.py:345-352`) was rejected on validation, on top of
  // being rejected on auth. The caller was not inventing fields.

  @ApiPropertyOptional({ description: "Reply-To header" })
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiPropertyOptional({
    description: "Gmail thread id — appends this message to an existing thread",
  })
  @IsOptional()
  @IsString()
  threadId?: string;

  @ApiPropertyOptional({ description: "RFC 5322 In-Reply-To message id" })
  @IsOptional()
  @IsString()
  inReplyTo?: string;

  @ApiPropertyOptional({ description: "RFC 5322 References chain" })
  @IsOptional()
  @IsString()
  references?: string;
}

// SendSmsDto was deleted with POST /communications/sms on 2026-09-02
// (ADR 0084). It was the whole of the validation on an open SMS relay: `to` is
// a string, `message` is a string. Nothing else references it.

export class LowStockAlertDto {
  @ApiProperty({
    description: "Recipient email address",
    example: "ops@your-restaurant.com",
  })
  @IsEmail()
  recipientEmail: string;

  @ApiPropertyOptional({ description: "Recipient phone number for SMS" })
  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @ApiProperty({ description: "Wine name", example: "Chateau Margaux 2015" })
  @IsString()
  wineName: string;

  @ApiProperty({ description: "Current stock level", example: 2 })
  @IsNumber()
  @Min(0)
  currentStock: number;

  @ApiProperty({ description: "Threshold level", example: 12 })
  @IsNumber()
  @Min(1)
  threshold: number;

  @ApiPropertyOptional({ description: "Average daily sales", example: 1.5 })
  @IsOptional()
  @IsNumber()
  avgDailySales?: number;

  @ApiPropertyOptional({
    description: "Recommended order quantity",
    example: 24,
  })
  @IsOptional()
  @IsNumber()
  recommendedQty?: number;

  @ApiPropertyOptional({
    description: "Preferred supplier name",
    example: "Premium Wine Distributors",
  })
  @IsOptional()
  @IsString()
  preferredSupplier?: string;

  @ApiPropertyOptional({
    description: "Estimated delivery time",
    example: "2-3 business days",
  })
  @IsOptional()
  @IsString()
  estimatedDelivery?: string;

  @ApiPropertyOptional({ description: "Wine ID for linking" })
  @IsOptional()
  @IsString()
  wineId?: string;

  @ApiPropertyOptional({ description: "Restaurant ID" })
  @IsOptional()
  @IsString()
  restaurantId?: string;
}

export class DailySummaryDto {
  @ApiProperty({ description: "Recipient phone number" })
  @IsString()
  recipientPhone: string;

  @ApiProperty({ description: "Restaurant name" })
  @IsString()
  restaurantName: string;

  @ApiProperty({ description: "Number of low stock items" })
  @IsNumber()
  lowStockCount: number;

  @ApiProperty({ description: "Number of pending orders" })
  @IsNumber()
  pendingOrders: number;

  // `deliveriesToday` was removed 2026-09-02 (ADR 0084). The scheduled sender
  // fed it a hardcoded 0 and the SMS printed it beside two measured figures.
  // The field is gone rather than made optional: an accepted-and-ignored
  // parameter is the next reader's false lead.
}

export class WeeklyReportDto {
  @ApiProperty({ description: "Recipient email addresses" })
  @IsArray()
  @IsEmail({}, { each: true })
  recipientEmails: string[];

  @ApiProperty({ description: "Restaurant ID" })
  @IsString()
  restaurantId: string;

  @ApiPropertyOptional({ description: "Include financial data" })
  @IsOptional()
  @IsBoolean()
  includeFinancials?: boolean;
}

export class CommunicationResultDto {
  @ApiProperty({ description: "Whether the operation was successful" })
  success: boolean;

  @ApiPropertyOptional({ description: "Message ID if available" })
  messageId?: string;

  // ADR 0099 — the caller persists this as `procurement_conversations.
  // gmail_thread_id` and feeds it back as `threadId` on the next reply
  // (provider_conversation_agent.py:3090). `EmailResult.threadId` was always
  // populated; the handler dropped it on the way out, so every reply would have
  // started a new Gmail thread even once F1 and F2 were fixed.
  @ApiPropertyOptional({ description: "Gmail thread id of the sent message" })
  threadId?: string;

  @ApiPropertyOptional({ description: "Error message if failed" })
  error?: string;

  @ApiPropertyOptional({ description: "Channel used (email, sms, websocket)" })
  channel?: "email" | "sms" | "websocket";
}

export class MultiChannelResultDto {
  @ApiProperty({ description: "Email result" })
  email?: CommunicationResultDto;

  @ApiProperty({ description: "SMS result" })
  sms?: CommunicationResultDto;

  @ApiProperty({ description: "WebSocket result" })
  websocket?: CommunicationResultDto;

  @ApiProperty({ description: "Overall success status" })
  success: boolean;

  @ApiProperty({ description: "Timestamp of the operation" })
  timestamp: string;
}

export class SendTemplateTestDto {
  @ApiProperty({
    description: "Recipient email addresses",
    example: ["suley1742@gmail.com"],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  to: string[];

  @ApiProperty({
    description: "Template to use",
    enum: ["test", "low-stock"],
    example: "test",
  })
  @IsString()
  template: "test" | "low-stock";
}

export class CommunicationStatusDto {
  @ApiProperty({ description: "Whether Gmail is configured and ready" })
  gmailReady: boolean;

  @ApiProperty({ description: "Whether SMS (Plivo) is configured and ready" })
  smsReady: boolean;

  @ApiProperty({ description: "Whether WebSocket is available" })
  websocketReady: boolean;
}
