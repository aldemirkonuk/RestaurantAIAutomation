# 📬 Communication Templates

**WineOps AI - Automated Communication System**

This document defines all communication templates, delivery schedules, and formats used by the WineOps AI system.

---

## 📅 Report Delivery Schedule

### Daily Reports

| Report | Delivery Time | Channel | Format |
|--------|---------------|---------|--------|
| Morning Stock Snapshot | **6:00 AM** | Email, Dashboard | HTML, PDF |
| Low Stock Alerts | **Real-time** | SMS, WhatsApp, Push | Plain text |
| End-of-Day Sales Summary | **11:30 PM** | Email | HTML, PDF |
| Delivery Confirmations | **As received** | SMS, Push | Plain text |

### Weekly Reports

| Report | Delivery Day/Time | Channel | Format |
|--------|-------------------|---------|--------|
| Executive Digest | **Monday 7:00 AM** | Email | HTML, PDF |
| Financial Recap | **Monday 7:00 AM** | Email | HTML, Excel |
| Inventory Variance Report | **Sunday 11:00 PM** | Email | PDF, Excel |
| Provider Performance | **Monday 7:00 AM** | Dashboard | HTML |

### Monthly Reports

| Report | Delivery Day/Time | Channel | Format |
|--------|-------------------|---------|--------|
| Complete Financial Report | **1st of month, 8:00 AM** | Email | PDF, Excel |
| Tax-Ready Summary | **1st of month, 8:00 AM** | Email, QuickBooks | PDF, CSV |
| COGS Analysis | **1st of month, 8:00 AM** | Email | PDF, Excel |
| Inventory History | **1st of month, 8:00 AM** | Email | CSV |
| Negotiation Audit Log | **1st of month, 8:00 AM** | Email | PDF |

---

## 📱 SMS/WhatsApp Templates

### Low Stock Alert
```
⚠️ LOW STOCK ALERT

Wine: {wine_name}
Stock: {current_stock} bottles
Threshold: {threshold}

Suggested order: {suggested_qty} bottles
Est. cost: ${estimated_cost}

Reply:
✅ APPROVE - Place order
❌ REJECT - Skip for now
📝 EDIT - Change quantity
```

### Delivery Confirmation Request
```
🚚 DELIVERY ARRIVED

Wine: {wine_name}
Expected: {expected_qty} bottles
Invoice: ${invoice_price}
Negotiated: ${negotiated_price}

Please confirm receipt:
✅ RECEIVED - All correct
⚠️ ISSUE - Report problem
```

### Price Negotiation Result
```
💰 PRICE UPDATE

Wine: {wine_name}
Your price: ${original_price}
Supplier offer: ${counter_price}
Deviation: {deviation}%

Supplier: {supplier_name}

Reply:
✅ ACCEPT - Agree to ${counter_price}
❌ DECLINE - Cancel order
🔄 COUNTER - Try ${new_price}
```

### Stock Inequality Alert
```
⚠️ INVENTORY MISMATCH

Wine: {wine_name}
System stock: {db_stock}
Sales recorded: {sales_count}
Expected: {expected_stock}

Did you make a manual purchase?

Reply:
+6 - Add 6 bottles
+12 - Add 1 case (12)
CHECK - Investigate manually
```

### Vintage Substitution
```
🍷 VINTAGE UNAVAILABLE

Wine: {wine_name}
Requested: {requested_vintage}
Available: {offered_vintage}
Price diff: ${price_change}

Supplier: {supplier_name}

Reply:
✅ ACCEPT {offered_vintage}
❌ DECLINE - Cancel order
```

### Human Edit Detected
```
⏸️ AUTOMATION PAUSED

Human edit detected on inventory.
Automation writes paused for 30 seconds.

Continue editing or wait for auto-resume.
```

### Order Confirmed
```
✅ ORDER PLACED

Wine: {wine_name}
Quantity: {quantity} bottles
Total: ${total_price}
Supplier: {supplier_name}
Expected delivery: {delivery_date}

Order ID: {order_id}
```

---

## 📧 Email Templates

### Daily Morning Stock Snapshot (6:00 AM)

**Subject:** `🍷 WineOps Daily Stock Report - {date}`

```html
<h1>Good Morning, {manager_name}</h1>

<h2>📊 Stock Overview</h2>
<table>
  <tr><th>Total Wines</th><td>{total_wines}</td></tr>
  <tr><th>Total Bottles</th><td>{total_bottles}</td></tr>
  <tr><th>Low Stock Items</th><td style="color:red">{low_stock_count}</td></tr>
  <tr><th>Out of Stock</th><td style="color:red">{out_of_stock_count}</td></tr>
</table>

<h2>🚨 Critical Items (Action Required)</h2>
<ul>
  {{#each critical_items}}
  <li>
    <strong>{wine_name}</strong> - {stock} bottles left (min: {threshold})
    <a href="{reorder_link}">Quick Reorder →</a>
  </li>
  {{/each}}
</ul>

<h2>📦 Pending Deliveries Today</h2>
<ul>
  {{#each pending_deliveries}}
  <li>{wine_name} - {quantity} bottles from {supplier}</li>
  {{/each}}
</ul>

<footer>
  <p>Generated: {timestamp}</p>
  <p><a href="{dashboard_link}">Open Dashboard</a></p>
</footer>
```

### End-of-Day Sales Summary (11:30 PM)

**Subject:** `📈 WineOps Sales Summary - {date}`

```html
<h1>End of Day Summary</h1>

<h2>💰 Today's Revenue</h2>
<table>
  <tr><th>Total Sales</th><td>${total_revenue}</td></tr>
  <tr><th>Bottles Sold</th><td>{bottles_sold}</td></tr>
  <tr><th>Avg. Bottle Price</th><td>${avg_price}</td></tr>
</table>

<h2>🏆 Top Sellers Today</h2>
<ol>
  {{#each top_sellers}}
  <li>{wine_name} - {quantity} bottles (${revenue})</li>
  {{/each}}
</ol>

<h2>📊 Sales by Type</h2>
<table>
  <tr><td>🔴 Red</td><td>{red_qty} bottles</td><td>${red_revenue}</td></tr>
  <tr><td>⚪ White</td><td>{white_qty} bottles</td><td>${white_revenue}</td></tr>
  <tr><td>✨ Sparkling</td><td>{sparkling_qty} bottles</td><td>${sparkling_revenue}</td></tr>
  <tr><td>🌸 Rosé</td><td>{rose_qty} bottles</td><td>${rose_revenue}</td></tr>
  <tr><td>🍯 Dessert</td><td>{dessert_qty} bottles</td><td>${dessert_revenue}</td></tr>
</table>

<h2>⏰ Sales by Time Window</h2>
{{#each time_windows}}
<p><strong>{start_time} - {end_time}:</strong> ${revenue} ({bottles} bottles)</p>
{{/each}}

<footer>
  <p>Generated: {timestamp}</p>
</footer>
```

### Weekly Executive Digest (Monday 7:00 AM)

**Subject:** `📋 WineOps Weekly Digest - Week of {week_start_date}`

```html
<h1>Weekly Executive Digest</h1>
<p>Week of {week_start_date} to {week_end_date}</p>

<h2>📊 Key Metrics</h2>
<table>
  <tr><th>Total Revenue</th><td>${total_revenue}</td><td>{revenue_change}%</td></tr>
  <tr><th>Bottles Sold</th><td>{bottles_sold}</td><td>{bottles_change}%</td></tr>
  <tr><th>Gross Margin</th><td>{margin}%</td><td>{margin_change}%</td></tr>
  <tr><th>Avg. Order Value</th><td>${avg_order}</td><td>{aov_change}%</td></tr>
</table>

<h2>💵 Financial Recap</h2>
<table>
  <tr><th>Total Spend</th><td>${total_spend}</td></tr>
  <tr><th>COGS</th><td>${cogs}</td></tr>
  <tr><th>Net Profit</th><td>${net_profit}</td></tr>
</table>

<h2>🏆 Top 5 Performers</h2>
<ol>
  {{#each top_performers}}
  <li>
    <strong>{wine_name}</strong><br>
    Sales: {quantity} | Revenue: ${revenue} | Trend: {trend}%
  </li>
  {{/each}}
</ol>

<h2>📉 Underperformers</h2>
{{#each underperformers}}
<p>⚠️ {wine_name} - Only {quantity} bottles (expected {expected})</p>
{{/each}}

<h2>🍷 Loved Wine of the Week</h2>
<div style="background:#f3f4f6;padding:16px;border-radius:8px;">
  <h3>{loved_wine_name}</h3>
  <p>Velocity increase: <strong>+{velocity_increase}%</strong></p>
  <p>{loved_wine_description}</p>
</div>

<h2>📦 Inventory Health</h2>
<ul>
  <li>Low Stock: {low_stock_count} items</li>
  <li>Reorders Placed: {reorders_count}</li>
  <li>Deliveries Received: {deliveries_count}</li>
</ul>

<h2>🤝 Provider Performance</h2>
<table>
  {{#each providers}}
  <tr>
    <td>{provider_name}</td>
    <td>Avg. Lead Time: {avg_lead_time} days</td>
    <td>On-Time: {on_time_rate}%</td>
  </tr>
  {{/each}}
</table>

<footer>
  <p>Generated: {timestamp}</p>
  <p><a href="{full_report_link}">Download Full PDF Report</a></p>
</footer>
```

### Monthly Financial Report (1st of month, 8:00 AM)

**Subject:** `📊 WineOps Monthly Report - {month_name} {year}`

```html
<h1>Monthly Financial Report</h1>
<p>{month_name} {year}</p>

<h2>📈 Executive Summary</h2>
<table>
  <tr><th>Total Revenue</th><td>${total_revenue}</td></tr>
  <tr><th>Total COGS</th><td>${total_cogs}</td></tr>
  <tr><th>Gross Profit</th><td>${gross_profit}</td></tr>
  <tr><th>Gross Margin</th><td>{gross_margin}%</td></tr>
</table>

<h2>💰 Revenue Breakdown</h2>
<table>
  <tr><th>By the Glass</th><td>${btg_revenue}</td><td>{btg_percent}%</td></tr>
  <tr><th>By the Bottle</th><td>${btb_revenue}</td><td>{btb_percent}%</td></tr>
  <tr><th>Events/Catering</th><td>${events_revenue}</td><td>{events_percent}%</td></tr>
</table>

<h2>📊 Margin Analysis by Wine Type</h2>
<table>
  <tr><th>Type</th><th>Revenue</th><th>COGS</th><th>Margin</th></tr>
  <tr><td>Red</td><td>${red_revenue}</td><td>${red_cogs}</td><td>{red_margin}%</td></tr>
  <tr><td>White</td><td>${white_revenue}</td><td>${white_cogs}</td><td>{white_margin}%</td></tr>
  <tr><td>Sparkling</td><td>${sparkling_revenue}</td><td>${sparkling_cogs}</td><td>{sparkling_margin}%</td></tr>
  <tr><td>Rosé</td><td>${rose_revenue}</td><td>${rose_cogs}</td><td>{rose_margin}%</td></tr>
  <tr><td>Dessert</td><td>${dessert_revenue}</td><td>${dessert_cogs}</td><td>{dessert_margin}%</td></tr>
</table>

<h2>🧾 Tax Summary</h2>
<table>
  <tr><th>Sales Tax Collected</th><td>${sales_tax}</td></tr>
  <tr><th>Excise Tax</th><td>${excise_tax}</td></tr>
  <tr><th>Total Tax Liability</th><td>${total_tax}</td></tr>
</table>

<h2>📦 Inventory Summary</h2>
<table>
  <tr><th>Opening Inventory Value</th><td>${opening_inventory}</td></tr>
  <tr><th>Purchases</th><td>${purchases}</td></tr>
  <tr><th>COGS</th><td>${cogs}</td></tr>
  <tr><th>Closing Inventory Value</th><td>${closing_inventory}</td></tr>
</table>

<h2>📎 Attachments</h2>
<ul>
  <li><a href="{pdf_link}">Full Report (PDF)</a></li>
  <li><a href="{excel_link}">Raw Data (Excel)</a></li>
  <li><a href="{csv_link}">Sales Events (CSV)</a></li>
  <li><a href="{tax_link}">Tax Breakdown (PDF)</a></li>
</ul>

<footer>
  <p>Generated: {timestamp}</p>
  <p>This report is tax-ready and QuickBooks compatible.</p>
</footer>
```

---

## 🤖 Supplier Communication Templates

### AI Message Template (Plivo Voice/SMS Conversation)
**Purpose:** Template for AI agent to use when contacting provider via Plivo

```
Hi [provider_name or worker_name],

[Greeting text based on time of day and relationship history]

I'm calling on behalf of {restaurant_name}. We need [amount] bottles of [wine_name] at [price decided by manager or provider's standard price]. Is it possible to fulfill this order?

[If manager added notes/questions, add:]
We also have a few questions:
- [Question 1 from manager's notes]
- [Question 2 from manager's notes]

[Closing statement based on urgency and relationship]

Thank you for your time. Please let us know if this works for you.

Best regards,
WineOps AI (on behalf of {restaurant_name})
```

**Context Variables:**
- `provider_name`: Name of provider contact or business
- `worker_name`: Name of person answering the call
- `greeting_text`: Dynamic based on time (Good morning/afternoon/evening) and previous interactions
- `amount`: Quantity requested by manager
- `wine_name`: Full wine name including vintage
- `price`: Manager's desired price or provider's standard price
- `questions`: Any additional questions manager specified in order notes
- `closing_statement`: Professional closing, may mention delivery timeline if urgent

---

### Conversation Summary Template
**Purpose:** AI-generated summary of provider conversation (similar to Google Meet transcript summary)

```
Report on the conversation we had with [provider_name]:

**Order Details:**
- Wine: [wine_name]
- Quantity Requested: [amount] bottles
- Proposed Price: $[manager_price]
- Final Agreed Price: $[final_price]

**Response:**
[Accepted/Declined/Counter-offered] the offer at $[final_price] for [wine_name] in [amount] bottles.

**Additional Information:**
- Delivery Timeline: [provider_delivery_estimate] days
- Availability: [in_stock/backorder/special_order]
- [Manager's requested note/condition]: [provider_response]
  Example: "Your request to be delivered under 2 days will be fulfilled."

**Key Points Discussed:**
- [Point 1 from conversation]
- [Point 2 from conversation]
- [Any counter-offers or negotiations]

**Next Steps:**
- [Action required from manager]
- [Expected confirmation deadline if applicable]

**Conversation Duration:** [X] minutes
**Sentiment:** [Positive/Neutral/Concerned]
**Confidence Score:** [X]% (AI assessment of order likelihood)

---
Generated by WineOps AI Procurement Agent
Conversation ID: [conversation_id]
Timestamp: [timestamp]
```

---

### Initial Order Request (Email/SMS - Legacy)
```
Hey {supplier_name},

I hope you're doing well.

I'd like to order {quantity} cases of {wine_name} at ${price_per_case}.

Please let me know if this works for you.

Best,
{restaurant_name} (via WineOps AI)
```

### Price Counter
```
Hey {supplier_name},

Thanks for getting back to me.

Unfortunately, ${counter_price} is a bit higher than we were hoping for. 

Would you be able to do ${target_price}? That would really help us make this work.

Let me know!

Best,
{restaurant_name} (via WineOps AI)
```

### Order Confirmation
```
Hey {supplier_name},

Great! We're good to go.

Please confirm {quantity} cases of {wine_name} at ${agreed_price}.

Expected delivery: {expected_date}

Thanks!
{restaurant_name} (via WineOps AI)
```

### Vintage Inquiry
```
Hey {supplier_name},

Quick question - we were looking for the {requested_vintage} vintage.

You mentioned {offered_vintage} is available. Our manager will need to approve the substitution.

I'll get back to you shortly.

Best,
{restaurant_name} (via WineOps AI)
```

---

## 🔔 Push Notification Templates

### Low Stock (Critical)
```
🚨 Critical: {wine_name} has only {stock} bottles left!
Tap to reorder now.
```

### Delivery Arrived
```
📦 {wine_name} delivery arrived!
{quantity} bottles from {supplier}
Tap to confirm receipt.
```

### Price Alert
```
💰 {supplier} countered at ${price}
{wine_name} order pending your approval.
```

### Order Confirmed
```
✅ Order confirmed!
{quantity} bottles of {wine_name}
Expected: {delivery_date}
```

### Daily Summary Available
```
📊 Your daily summary is ready!
{bottles_sold} bottles sold | ${revenue} revenue
Tap to view details.
```

---

## ⚙️ Configuration Schema

```yaml
communication_config:
  channels:
    email:
      provider: sendgrid  # or gmail_smtp
      from_address: reports@wineops.ai
      reply_to: support@wineops.ai
    
    sms:
      provider: plivo  # cost-efficient
      sender_id: WineOps
    
    whatsapp:
      provider: whatsapp_business_api
      template_namespace: wineops_templates
    
    push:
      provider: firebase_fcm
      app_id: wineops_mobile
  
  schedules:
    daily_morning:
      time: "06:00"
      timezone: restaurant_local
    
    daily_evening:
      time: "23:30"
      timezone: restaurant_local
    
    weekly_digest:
      day: monday
      time: "07:00"
      timezone: restaurant_local
    
    monthly_report:
      day: 1
      time: "08:00"
      timezone: restaurant_local
  
  preferences:
    low_stock_threshold_multiplier: 1.0
    buffer_window_minutes: 30
    quiet_hours:
      start: "00:00"
      end: "06:00"
    escalation_after_minutes: 60
```

---

## 📝 Notes

1. **All times are in restaurant local timezone** unless otherwise specified
2. **Critical alerts bypass quiet hours** - Low stock below 2 bottles, delivery issues
3. **SMS is used for time-sensitive alerts** - Manager can configure preferences
4. **Email is used for comprehensive reports** - With PDF/Excel attachments
5. **WhatsApp is preferred for supplier communication** - Professional and tracked
6. **Push notifications are for mobile app users** - Real-time updates

---

*Document Version: 1.0*
*Last Updated: January 2026*

