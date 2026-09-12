Toast Developer Guide: Comprehensive Report

1. Overview

The Toast Developer Guide provides documentation for integrating with the Toast Point of Sale (POS) platform. It allows third-party developers to read restaurant data (menus, orders), write data (inject orders), and receive real-time updates (webhooks). The API is RESTful, uses JSON for data exchange, and requires OAuth 2.0 for authentication.

2. Key "Fields" and Functional Areas

The documentation is divided into several core modules. Below is a detailed breakdown of the data fields and capabilities for each.

A. Authentication

Inbound (Partner -> Toast): Uses OAuth 2.0.

Fields: clientId, clientSecret, userAccessType (set to TOAST_MACHINE_CLIENT).

Output: Returns a Bearer token valid for a limited time (e.g., 86400 seconds).

Outbound (Toast -> Partner): Uses Static API Keys.

Mechanism: Toast sends an API key in the Authorization header when calling your service (e.g., for Loyalty or Gift Card integrations).

B. Menus (The Data Backbone)

Structure: Hierarchical tree.

Menu: Top level (e.g., "Dinner", "Lunch").

Menu Group: Categories (e.g., "Appetizers", "Entrees").

Menu Item: Sellable items (e.g., "Burger", "Soda").

Modifier Group: Customizations (e.g., "Cheese Options", "Cooking Temp").

Modifier: Specific choices (e.g., "Cheddar", "Medium Rare").

Key Fields:

guid: Unique ID for every entity. Crucial for ordering.

price: Base price of the item.

visibility: Determines if an item is shown on POS, Kiosk, or Online.

availability: Status (Available, Out of Stock).

plu: Product Look-Up code (often used for accounting integrations).

C. Orders (Transactional Data)

Capability: Create (POST), Update, and Retrieve orders.

Key Object: Order

guid: Unique ID of the order.

checks: Contains payment and item details.

selections: The list of menuItem GUIDs ordered.

appliedDiscounts: Discount GUIDs applied.

payments: Payment details (Type: CREDIT or OTHER).

diningOption: GUID indicating Dine-in, Takeout, Delivery, etc.

promisedDate: Scheduled time for future orders.

deliveryInfo: Address and customer details (for delivery orders).

D. Stock (Inventory)

Fields:

status: IN_STOCK, OUT_OF_STOCK, or NOT_TRACKED.

quantity: Exact count (if tracked).

guid: Refers to the Menu Item or Modifier.

E. Webhooks (Real-time Events)

Mechanism: Toast pushes JSON to a registered URL when events occur.

Key Events:

order_updated: Sent when an order is created, paid, or fulfilled.

menu_published: Sent when the restaurant publishes menu changes.

stock_updated: Sent when item inventory changes.

Step-by-Step Integration Instructions

These instructions outline the "Happy Path" for building a standard ordering integration.

Step 1: Obtain Credentials

Contact the Toast Integrations team to register your partner account.

Receive your clientId and clientSecret.

Step 2: Authenticate (Get a Token)

Endpoint: POST /authentication/v1/authentication/login

Body:

JSON
{
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "userAccessType": "TOAST_MACHINE_CLIENT"
}
Response: Extract the accessToken. Use this token in the Authorization: Bearer <token> header for all subsequent calls.

Step 3: Fetch Restaurant Menu

You need the guid of items to place an order.

Endpoint: GET /menus/v2/menus (or v3 for specific ordering partners).

Action: Parse the JSON to find the guid for the items (e.g., "Burger") and modifiers (e.g., "Cheese") you want to sell.

Step 4: Create an Order

Endpoint: POST /orders/v2/orders

Header: Toast-Restaurant-External-ID: <Restaurant_GUID>

Body: Construct the order using the GUIDs found in Step 3.

JSON
{
  "diningOption": { "guid": "DINING_OPTION_GUID" },
  "checks": [
    {
      "selections": [
        {
          "item": { "guid": "MENU_ITEM_GUID" },
          "quantity": 1
        }
      ]
    }
  ]
}
Step 5: Handle Updates (Webhooks)

Set up a server endpoint (e.g., https://api.yourapp.com/webhooks/toast).

Register this URL with Toast for order_updated events.

When Toast sends a POST to your URL, verify the payload and update your local database with the new order status.
