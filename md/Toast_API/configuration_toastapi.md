# Toast Platform Integration Report

## 1. Executive Summary
The Toast Developer Guide outlines the RESTful API endpoints and data models required to integrate with the Toast POS platform. The core workflow involves authenticating via OAuth 2.0, retrieving menu data to understand sellable items, and submitting transactional order data.

## 2. Authentication & Security
* **Protocol:** OAuth 2.0
* **Token Type:** Bearer Token
* **Token Lifespan:** Typically 24 hours (86400 seconds)
* **Requirements:**
    * `clientId`
    * `clientSecret`
    * `userAccessType`: `TOAST_MACHINE_CLIENT`

## 3. Data Models & Fields

### A. Menus API
The Menus API is read-only for most partners and provides the structure for ordering.
* **Hierarchy:** `Menu` -> `MenuGroup` -> `MenuItem` -> `ModifierGroup` -> `Modifier`.
* **Critical Fields:**
    * **GUID:** The primary key for all entities. Must be cached and used for Order submissions.
    * **Visibility:** Defines if an item is purchasable online.
    * **PricingStrategy:** Defines if an item has a fixed base price or open pricing.

### B. Orders API
The Orders API allows for the injection of orders into the POS system.
* **Primary Endpoint:** `/orders/v2/orders`
* **Order Object Fields:**
    * `diningOption`: (Required) e.g., Takeout, Delivery.
    * `checks`: A list containing the financial breakdown.
    * `selections`: The actual items ordered (linked via GUID).
    * `payments`: Credit card or external payment references.
    * `customer`: Name, phone, and email for the receipt.

### C. Webhooks
Push notifications for real-time synchronization.
* **Payload:** JSON object containing the `eventType` and the relevant entity object (e.g., the full Order JSON).
* **Key Events:**
    * `order_updated`: Triggered on status changes (Kitchen, Paid, Voided).
    * `stock_updated`: Triggered when item count reaches 0 or changes.

## 4. Integration Step-by-Step Guide

1.  **Authentication:**
    * Call `/authentication/v1/authentication/login` with credentials.
    * Store the `accessToken`.

2.  **Menu Sync:**
    * Call `/menus/v2/menus` to fetch the full tree.
    * Map `MenuItem` names to their `guids`.
    * Map `Modifier` options to their `guids`.

3.  **Order Submission:**
    * Construct a JSON payload.
    * Ensure `externalId` is unique (idempotency key).
    * Send POST to `/orders/v2/orders`.

4.  **Poll/Listen:**
    * Use Webhooks to listen for the `order_updated` event to confirm the kitchen has received the ticket.

## 5. Best Practices
* **Idempotency:** Always use unique `externalId`s for orders to prevent double-charging.
* **Rate Limiting:** Cache menu data; do not fetch the full menu for every single order.
* **Error Handling:** Handle HTTP 4xx errors (bad data) vs 5xx errors (server issues) distinctively.
