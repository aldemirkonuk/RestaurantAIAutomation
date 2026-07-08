/**
 * Email Templates Index
 * Export all templates and utilities
 */

// Configuration and utilities
export * from "./template-config";
export * from "./base-template";

// Onboarding
export * from "./onboarding.template";

// Individual templates
export * from "./low-stock-alert.template";
export * from "./weekly-report.template";
export * from "./daily-summary.template";
export * from "./order-notification.template";

// New reminder templates
export * from "./recurring-order.template";
export * from "./delivery-eta.template";
export * from "./payment-due.template";
export * from "./inventory-audit.template";
export * from "./event-prep.template";
export * from "./custom-reminder.template";

// Vendor communication templates
export * from "./vendor-action.template";

// Legacy templates (order inquiry, counter-offer, confirmation, delivery reminder)
export {
  orderInquiryTemplate,
  counterOfferTemplate,
  orderConfirmationTemplate,
  deliveryReminderTemplate,
  type OrderInquiryData,
  type CounterOfferData,
  type OrderConfirmationData,
  type DeliveryReminderData,
} from "../email-templates-legacy";
