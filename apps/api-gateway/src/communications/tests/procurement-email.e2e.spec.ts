/**
 * E2E Procurement & Onboarding Email Tests
 *
 * Covers the templates NOT exercised by email-e2e.spec.ts:
 *   – managerReviewTemplate      (internal AI-draft review sent to manager)
 *   – vendorOutboundTemplate      (outbound plain-letter sent to vendor)
 *   – conversationSummaryTemplate (vendor-reply digest for manager)
 *   – orderInquiryTemplate        (legacy — initial inquiry to vendor)
 *   – counterOfferTemplate        (legacy — negotiation counter-offer)
 *   – orderConfirmationTemplate   (legacy — PO confirmation)
 *   – deliveryReminderTemplate    (legacy — delivery follow-up)
 *   – sendOnboardingEmail()       (welcome email after registration)
 *
 * Run:
 *   cd apps/api-gateway && npx jest --config jest.config.js --testPathPattern procurement-email --runInBand
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { GmailService, EmailResult } from '../gmail.service';
import {
  managerReviewTemplate,
  vendorOutboundTemplate,
  conversationSummaryTemplate,
} from '../email-templates/vendor-action.template';
import {
  orderInquiryTemplate,
  counterOfferTemplate,
  orderConfirmationTemplate,
  deliveryReminderTemplate,
} from '../email-templates-legacy';

const TEST_EMAIL = 'aldemirkonuk2004@gmail.com';
const RESTAURANT_NAME = 'WineOps Restaurant';
const DASHBOARD_BASE = 'https://app.wineops.ai';

describe('Procurement & Onboarding Email Templates E2E', () => {
  let gmailService: GmailService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '.env.local', '../../.env'],
        }),
      ],
      providers: [GmailService],
    }).compile();

    gmailService = module.get<GmailService>(GmailService);
    await module.init();
  }, 30000);

  afterAll(async () => {
    await module?.close();
  });

  // ========================================================================
  // 1. MANAGER REVIEW (internal — AI-draft with Approve/Edit/Reject/Ask-More)
  // ========================================================================
  it('should send Manager Review email (AI draft pending approval)', async () => {
    const html = managerReviewTemplate({
      orderId: 'ORD-2026-0055',
      conversationId: 'CONV-2026-0055',
      providerName: 'Premium Wine Distributors',
      vendorContactName: 'James Wilson',
      wineName: 'Chateau Margaux 2015',
      quantity: 12,
      pricePerBottle: 285,
      totalAmount: 3420,
      aiDraftedMessage: `Dear James,

I hope this message finds you well. We would like to inquire about placing an order for Chateau Margaux 2015 (12 bottles). Our current stock has dropped below the reorder threshold and we need a prompt delivery.

Could you please confirm availability and pricing? Our target price is $285/bottle. We look forward to hearing from you.

Best regards,
WineOps AI`,
      sessionType: 'order_inquiry',
      urgency: 'high',
      dashboardBaseUrl: DASHBOARD_BASE,
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Action Required: Review AI Email to Premium Wine Distributors',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[1/8] Manager Review sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 2. VENDOR OUTBOUND (plain business-letter sent to vendor)
  // ========================================================================
  it('should send Vendor Outbound email (to vendor, no WineOps branding)', async () => {
    const html = vendorOutboundTemplate({
      recipientName: 'James Wilson',
      bodyHtml: `<p>Dear James,</p>
<p>I hope this message finds you well. We would like to place an order for <strong>Chateau Margaux 2015 — 12 bottles</strong> at $285/bottle.</p>
<p>Could you please confirm availability and estimated delivery timeline? Our preferred delivery window is within the next 5–7 business days.</p>
<p>Please send the invoice at your convenience.</p>
<p>Thank you,</p>`,
      orderId: 'ORD-2026-0055',
      orderNumber: 'WO-2026-0055',
      wineName: 'Chateau Margaux 2015',
      quantity: 12,
      restaurantName: RESTAURANT_NAME,
      senderName: 'Alex Chen',
      senderTitle: 'Beverage Manager',
      senderEmail: 'manager@wineops-restaurant.com',
      senderPhone: '+1 (555) 987-6543',
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Order Inquiry — Chateau Margaux 2015 (Ref: WO-2026-0055)',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[2/8] Vendor Outbound sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 3. CONVERSATION SUMMARY (vendor replied — AI-summarised digest to manager)
  // ========================================================================
  it('should send Conversation Summary email (vendor reply digest)', async () => {
    const html = conversationSummaryTemplate({
      orderId: 'ORD-2026-0055',
      providerName: 'Premium Wine Distributors',
      wineName: 'Chateau Margaux 2015',
      threadSummary:
        'Vendor confirmed 10 of 12 bottles available at $285/bottle, expects to source remaining 2 within 3 days. Offered 2% early-payment discount.',
      latestMessage:
        'Hi, we can confirm 10 bottles in stock at your target price. We should have the remaining 2 by Thursday. Let me know if you would like to proceed with a partial shipment.',
      detectedIntent: 'Partial Availability',
      sentiment: 'positive',
      messageCount: 3,
      dashboardBaseUrl: DASHBOARD_BASE,
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Vendor Reply: Premium Wine Distributors — Chateau Margaux 2015',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[3/8] Conversation Summary sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 4. ORDER INQUIRY (legacy — initial outbound to vendor)
  // ========================================================================
  it('should send Order Inquiry email (legacy template)', async () => {
    const html = orderInquiryTemplate({
      orderNumber: 'WO-2026-0060',
      wineName: 'Opus One 2019',
      quantity: 6,
      targetPrice: 295,
      managerName: 'Alex Chen',
      restaurantName: RESTAURANT_NAME,
      providerName: 'Napa Valley Imports',
      notes: 'Prefer 750ml bottles. Flexible on delivery date — any time before May 20.',
      bottleSizeMl: 750,
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Wine Order Inquiry — Opus One 2019 (Ref: WO-2026-0060)',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[4/8] Order Inquiry sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 5. COUNTER OFFER (legacy — price negotiation response)
  // ========================================================================
  it('should send Counter Offer email (legacy template)', async () => {
    const html = counterOfferTemplate({
      orderNumber: 'WO-2026-0060',
      wineName: 'Opus One 2019',
      quantity: 6,
      originalPrice: 320,
      counterPrice: 295,
      managerName: 'Alex Chen',
      restaurantName: RESTAURANT_NAME,
      providerName: 'Napa Valley Imports',
      reason: 'We are a regular customer with 3+ orders per quarter. Our budget ceiling is $295/bottle for this SKU.',
      bottleSizeMl: 750,
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Counter Offer — Opus One 2019 (Ref: WO-2026-0060)',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[5/8] Counter Offer sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 6. ORDER CONFIRMATION (legacy — PO confirmation to vendor)
  // ========================================================================
  it('should send Order Confirmation email (legacy template)', async () => {
    const html = orderConfirmationTemplate({
      orderNumber: 'WO-2026-0060',
      wineName: 'Opus One 2019',
      quantity: 6,
      finalPrice: 295,
      totalCost: 1770,
      managerName: 'Alex Chen',
      restaurantName: RESTAURANT_NAME,
      providerName: 'Napa Valley Imports',
      expectedDeliveryDate: 'May 19, 2026',
      bottleSizeMl: 750,
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Order Confirmed — Opus One 2019 (Ref: WO-2026-0060)',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[6/8] Order Confirmation sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 7. DELIVERY REMINDER (legacy — upcoming delivery follow-up to vendor)
  // ========================================================================
  it('should send Delivery Reminder email (legacy template)', async () => {
    const html = deliveryReminderTemplate({
      orderNumber: 'WO-2026-0060',
      wineName: 'Opus One 2019',
      quantity: 6,
      providerName: 'Napa Valley Imports',
      expectedDeliveryDate: 'May 19, 2026',
      restaurantName: RESTAURANT_NAME,
      deliveryAddress: '123 Main Street, Suite 200, San Francisco, CA 94105',
      bottleSizeMl: 750,
    });

    const result: EmailResult = await gmailService.sendEmail({
      to: [TEST_EMAIL],
      subject: 'Delivery Reminder — WO-2026-0060 expected May 19',
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[7/8] Delivery Reminder sent. MessageID: ${result.messageId}`);
  }, 15000);

  // ========================================================================
  // 8. ONBOARDING (welcome email after registration)
  // ========================================================================
  it('should send Onboarding welcome email via sendOnboardingEmail()', async () => {
    const result: EmailResult = await gmailService.sendOnboardingEmail({
      to: TEST_EMAIL,
      ownerName: 'Alex Chen',
      restaurantName: RESTAURANT_NAME,
      restaurantCity: 'San Francisco',
      frontendBaseUrl: 'https://restaurant-ai-automation-web.vercel.app',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    console.log(`[8/8] Onboarding email sent. MessageID: ${result.messageId}`);
  }, 15000);
});
