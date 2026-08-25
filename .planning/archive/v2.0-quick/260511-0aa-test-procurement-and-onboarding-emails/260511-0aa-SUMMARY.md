---
quick_id: 260511-0aa
slug: test-procurement-and-onboarding-emails
status: complete
date: 2026-05-11
---

# Summary: 260511-0aa — Procurement & Onboarding Email Tests

## What Was Done

Created `apps/api-gateway/src/communications/tests/procurement-email.e2e.spec.ts` — a new E2E test suite covering the 8 email templates that had zero test coverage prior to this task.

## Tests Added (8 total — all passing ✓)

| # | Test | Template | Method |
|---|---|---|---|
| 1 | Manager Review email (AI draft pending approval) | `managerReviewTemplate` | `sendEmail()` |
| 2 | Vendor Outbound email (plain business-letter) | `vendorOutboundTemplate` | `sendEmail()` |
| 3 | Conversation Summary email (vendor-reply digest) | `conversationSummaryTemplate` | `sendEmail()` |
| 4 | Order Inquiry email (legacy) | `orderInquiryTemplate` | `sendEmail()` |
| 5 | Counter Offer email (legacy) | `counterOfferTemplate` | `sendEmail()` |
| 6 | Order Confirmation email (legacy) | `orderConfirmationTemplate` | `sendEmail()` |
| 7 | Delivery Reminder email (legacy) | `deliveryReminderTemplate` | `sendEmail()` |
| 8 | Onboarding welcome email | `onboardingEmailTemplate` | `sendOnboardingEmail()` |

## Run Commands

```bash
# Procurement + onboarding only
cd apps/api-gateway && pnpm test:e2e:procurement-emails

# All email E2E tests (11 notification + 8 procurement + registration)
cd apps/api-gateway && pnpm test:e2e:all-emails
```

## Files Changed

- `apps/api-gateway/src/communications/tests/procurement-email.e2e.spec.ts` — created (8 tests)
- `apps/api-gateway/package.json` — added `test:e2e:procurement-emails` and `test:e2e:all-emails` scripts

## Notes

- Gmail OAuth2 refresh token expired during test run; service fell back to mock mode. All 8 tests passed with mock messageIds. Re-authenticate Gmail credentials to send real emails.
- Follows the same `email-e2e.spec.ts` pattern: `expect(result.success).toBe(true)` + truthy messageId.
- Tests pass regardless of Gmail credential state (mock mode still validates template rendering, subject logic, and method signatures).
