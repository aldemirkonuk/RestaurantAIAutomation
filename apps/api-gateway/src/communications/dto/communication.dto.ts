import {
  IsString,
  IsArray,
  IsOptional,
  IsNumber,
  IsEmail,
  Min,
  IsBoolean,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * ADR 0147 / 0149 #19 — no CR or LF in any value that becomes a MIME header.
 *
 * `GmailService.createMimeMessage` joins `Subject`, `In-Reply-To` and
 * `References` into the header block with `\r\n` and no escaping. A subject of
 * `"hi\r\nBcc: someone@elsewhere"` therefore ADDS A RECIPIENT that no
 * recipient check ever saw — the relay's allow-list would be bypassed by the
 * one field nobody treats as an address. The orchestrator's subject carries a
 * wine name read from the database, which a vendor can influence, so this is
 * not a browser-only concern.
 */
const SINGLE_HEADER_LINE = /^[^\r\n]*$/;
const HEADER_LINE_MESSAGE =
  "must be a single line: a line break in a mail header would let it add a recipient nobody checked";

/** Characters. See the note on `bodyHtml` below. */
export const SEND_EMAIL_BODY_HTML_MAX = 500_000;
export const SEND_EMAIL_BODY_TEXT_MAX = 100_000;

export class SendEmailDto {
  @ApiProperty({
    description: "Email recipients",
    example: ["ops@your-restaurant.com"],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  to: string[];

  @ApiProperty({
    description: "Email subject",
    example: "Low Stock Alert: Chateau Margaux 2015",
  })
  @IsString()
  @MaxLength(500)
  @Matches(SINGLE_HEADER_LINE, { message: `subject ${HEADER_LINE_MESSAGE}` })
  subject: string;

  // Optional in the CONTRACT since 2026-09-17 (ADR 0149 #19): the orchestrator's
  // door still requires it, and the person door refuses it — a person's mail is
  // never taken as raw HTML. (Nor, since the same day's review, does a person's
  // mail leave this route at all: its sender is undecided and the door answers
  // 409 — relay-email.service.ts.) Each door states its own refusal.
  // [SUPERSEDED 2026-09-17: the founder answered which mailbox; the person
  // door sends through the house's own connected gmail_send grant, naming
  // the acting person as author, and refuses with house_mailbox_not_connected
  // only when the house has none.]
  //
  // Both bodies are bounded (2026-09-17, ADR 0149 #19 review). The JSON body
  // limit is 15 MB (main.ts), and an unbounded body is what made guessing the
  // old time-based MIME boundary cheap: a 10-second window of guesses was
  // 1.58 MB. The boundary is random and both parts are base64 now
  // (gmail.service.ts createMimeMessage), which closes the injection on its
  // own; these limits bound what one request may cost. A vendor email the
  // orchestrator writes is a few kilobytes, so both sit far above any real one.
  @ApiPropertyOptional({
    description:
      "HTML body — service door only. A person's mail is never taken as HTML.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(SEND_EMAIL_BODY_HTML_MAX)
  bodyHtml?: string;

  @ApiPropertyOptional({ description: "Plain text body content" })
  @IsOptional()
  @IsString()
  @MaxLength(SEND_EMAIL_BODY_TEXT_MAX)
  bodyText?: string;

  @ApiPropertyOptional({ description: "CC recipients" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiPropertyOptional({ description: "BCC recipients" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  bcc?: string[];

  // ADR 0149 #19 — what the send is FOR. The orchestrator's door must name the
  // house, the vendor, and the conversation or order; the gateway checks every
  // one against the rows before anything leaves. On the person door the house
  // comes from the token (a body `restaurantId` naming another house is refused
  // by JwtAuthGuard's tenant match), and the rest is optional but checked when
  // given.

  @ApiPropertyOptional({
    description:
      "The house this mail is sent for. Required on the service door; on the person door it must equal the session's house.",
  })
  @IsOptional()
  @IsUUID("all")
  restaurantId?: string;

  @ApiPropertyOptional({
    description:
      "The vendor this mail is sent to. Required on the service door; every recipient must be one of this vendor's addresses in the house's book.",
  })
  @IsOptional()
  @IsUUID("all")
  providerId?: string;

  @ApiPropertyOptional({
    description: "The procurement conversation this mail sends.",
  })
  @IsOptional()
  @IsUUID("all")
  conversationId?: string;

  @ApiPropertyOptional({ description: "The procurement order this mail is about." })
  @IsOptional()
  @IsUUID("all")
  orderId?: string;

  @ApiPropertyOptional({
    description:
      "A house letter template (communication_templates, type 'letter') this mail was written from. Recorded on the audit row.",
  })
  @IsOptional()
  @IsUUID("all")
  templateId?: string;

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
  @MaxLength(200)
  @Matches(SINGLE_HEADER_LINE, { message: `threadId ${HEADER_LINE_MESSAGE}` })
  threadId?: string;

  @ApiPropertyOptional({ description: "RFC 5322 In-Reply-To message id" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Matches(SINGLE_HEADER_LINE, { message: `inReplyTo ${HEADER_LINE_MESSAGE}` })
  inReplyTo?: string;

  @ApiPropertyOptional({ description: "RFC 5322 References chain" })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  @Matches(SINGLE_HEADER_LINE, { message: `references ${HEADER_LINE_MESSAGE}` })
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
