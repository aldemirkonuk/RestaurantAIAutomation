# Page Interconnection Map — Web App

> Generated 2026-08-24 from `apps/web/src/App.tsx` + page sources (`navigate()`, `<Link to>`, `href`).

**51 routes** · **39 in-app navigation edges** · 13 route components unresolved (dynamic/inline).

Yellow = unauthenticated/public entry points.

```mermaid
graph LR
  n_root["/<br/><i>Dashboard</i>"]
  n_admin["/admin<br/><i>AdminPanel</i>"]
  n_admin_health["/admin/health<br/><i>AdminHealth</i>"]
  n_authorize__integrationId["/authorize/:integrationId"]
  n_calendar["/calendar<br/><i>CalendarModular</i>"]
  n_calendar_classic["/calendar-classic<br/><i>Calendar</i>"]
  n_communications["/communications<br/><i>Communications</i>"]
  n_credits["/credits"]
  n_dev_sandbox["/dev-sandbox<br/><i>DevSandbox</i>"]
  n_distributors["/distributors"]
  n_documents_reports["/documents-reports<br/><i>DocumentsPage</i>"]
  n_forgot_password["/forgot-password<br/><i>ForgotPassword</i>"]
  n_get_started["/get-started<br/><i>GetStarted</i>"]
  n_help["/help<br/><i>Help</i>"]
  n_inventory["/inventory<br/><i>InventoryCommandPage</i>"]
  n_inventory_legacy["/inventory-legacy<br/><i>Inventory</i>"]
  n_invite__code["/invite/:code<br/><i>InviteLanding</i>"]
  n_login["/login<br/><i>Login</i>"]
  n_logs["/logs<br/><i>LogsTimelinePage</i>"]
  n_no_access["/no-access<br/><i>NoAccess</i>"]
  n_notifications["/notifications<br/><i>Notifications</i>"]
  n_onboarding["/onboarding<br/><i>Onboarding</i>"]
  n_orders["/orders<br/><i>Orders</i>"]
  n_privacy["/privacy<br/><i>Privacy</i>"]
  n_profile["/profile<br/><i>Profile</i>"]
  n_promotions["/promotions<br/><i>Promotions</i>"]
  n_providers["/providers<br/><i>Providers</i>"]
  n_receipts["/receipts<br/><i>ReceiptsPage</i>"]
  n_receiving["/receiving<br/><i>ReceivingHome</i>"]
  n_receiving__orderId_door["/receiving/:orderId/door"]
  n_recommendations["/recommendations<br/><i>Recommendations</i>"]
  n_recommendations_catalog["/recommendations/catalog<br/><i>InsightCatalog</i>"]
  n_register["/register<br/><i>Register</i>"]
  n_reports["/reports<br/><i>Reports</i>"]
  n_reset_password["/reset-password<br/><i>ResetPassword</i>"]
  n_services["/services"]
  n_settings["/settings<br/><i>Settings</i>"]
  n_simpos__restaurantId["/simpos/:restaurantId"]
  n_simpos__restaurantId_orders["/simpos/:restaurantId/orders"]
  n_sommelier["/sommelier<br/><i>SommelierAI</i>"]
  n_studio["/studio"]
  n_studio_certify["/studio/certify"]
  n_studio_queue["/studio/queue"]
  n_team["/team<br/><i>TeamCommandPage</i>"]
  n_v__slug["/v/:slug<br/><i>VendorPortal</i>"]
  n_vendor_prices["/vendor-prices<br/><i>VendorPriceCompare</i>"]
  n_verify_email["/verify-email<br/><i>VerifyEmail</i>"]
  n_wine_agent["/wine-agent<br/><i>PlaceholderPage</i>"]
  n_wineagent["/wineagent<br/><i>PlaceholderPage</i>"]
  n_wines["/wines<br/><i>WineLibrary</i>"]
  n_root --> n_calendar
  n_root --> n_inventory
  n_root --> n_orders
  n_root --> n_reports
  n_root --> n_wines
  n_admin --> n_root
  n_forgot_password --> n_login
  n_get_started --> n_root
  n_get_started --> n_inventory
  n_help --> n_get_started
  n_help --> n_profile
  n_help --> n_settings
  n_help --> n_sommelier
  n_inventory --> n_orders
  n_invite__code --> n_root
  n_invite__code --> n_login
  n_login --> n_forgot_password
  n_login --> n_register
  n_no_access --> n_login
  n_onboarding --> n_root
  n_onboarding --> n_get_started
  n_privacy --> n_profile
  n_privacy --> n_settings
  n_profile --> n_settings
  n_providers --> n_orders
  n_receiving --> n_orders
  n_receiving --> n_receiving__orderId_door
  n_recommendations --> n_recommendations_catalog
  n_recommendations --> n_reports
  n_recommendations_catalog --> n_recommendations
  n_recommendations_catalog --> n_settings
  n_register --> n_root
  n_register --> n_login
  n_register --> n_verify_email
  n_reset_password --> n_forgot_password
  n_reset_password --> n_login
  n_settings --> n_help
  n_settings --> n_profile
  n_verify_email --> n_login
  classDef pub fill:#fde68a,stroke:#b45309,color:#111;
  class n_login,n_verify_email,n_privacy,n_invite__code,n_register,n_no_access,n_reset_password,n_forgot_password pub;
```

## Entry points (no inbound in-app link)

These are reached by URL, redirect, or external link — not by clicking through the app.
Each is a place a user can land cold, so each needs its own auth + empty-state handling.

- `/admin/health`
- `/authorize/:integrationId`
- `/calendar-classic`
- `/communications`
- `/credits`
- `/dev-sandbox`
- `/distributors`
- `/documents-reports`
- `/inventory-legacy`
- `/logs`
- `/notifications`
- `/promotions`
- `/receipts`
- `/services`
- `/simpos/:restaurantId`
- `/simpos/:restaurantId/orders`
- `/studio`
- `/studio/certify`
- `/studio/queue`
- `/team`
- `/v/:slug`
- `/vendor-prices`
- `/wine-agent`
- `/wineagent`

## Most-linked-to pages (in-degree)

| Page | Inbound links |
|---|---|
| `/login` | 6 |
| `/` | 5 |
| `/orders` | 4 |
| `/settings` | 4 |
| `/profile` | 3 |
| `/inventory` | 2 |
| `/reports` | 2 |
| `/get-started` | 2 |
| `/forgot-password` | 2 |
| `/calendar` | 1 |
| `/wines` | 1 |
| `/sommelier` | 1 |

## Unresolved route components

Route element could not be traced to a file (inline element, or non-standard binding). Navigation out of these pages is **not** represented in the graph above:

- `*`
- `/authorize/:integrationId`
- `/credits`
- `/distributors`
- `/receiving/:orderId/door`
- `/services`
- `/simpos/:restaurantId`
- `/simpos/:restaurantId/orders`
- `/studio`
- `/studio/certify`
- `/studio/queue`
- `/wine-agent`
- `/wineagent`