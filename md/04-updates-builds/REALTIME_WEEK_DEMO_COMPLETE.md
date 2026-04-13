# Realtime Week Demo - Implementation Complete

## Overview

Successfully implemented the accelerated Monday demo that compresses a full day (9am-1am) into ~10 minutes, showcasing the complete WineOps AI workflow with real Supabase data and hybrid Toast API integration.

## New Files Created

### Services (3 files)

| File | Description |
|------|-------------|
| `services/toast_api_client.py` | Hybrid Toast POS API client with real/mock modes |
| `services/inventory_count_service.py` | Physical inventory counting with discrepancy detection |
| `services/mobile_count_simulator.py` | Mobile app simulation for QR scanning and counting |

### Demo Scripts (4 files)

| File | Description |
|------|-------------|
| `demo/demo_realtime_week.py` | Main demo orchestrator - full Monday timeline |
| `demo/demo_scenarios/__init__.py` | Package initialization |
| `demo/demo_scenarios/vintage_mismatch.py` | Standalone vintage mismatch scenarios |
| `demo/demo_scenarios/inventory_discrepancy.py` | Standalone inventory discrepancy scenarios |

### Enhanced Files (2 files)

| File | Changes |
|------|---------|
| `agents/visual_verification_agent.py` | Added `detect_vintage_mismatch()` and `detect_wine_type_mismatch()` demo methods |
| `agents/notification_agent.py` | Added 4 new notification types for demo scenarios |

## Timeline Scenarios

### 9:00 AM - Weekly Report
- Generates weekly report from Supabase data
- Uses LLM-guided report generator
- Gmail-ready output with data coverage notes

### 12:00 PM - Delivery Verification
**Scenario 1: Vintage Mismatch**
- OCR scans invoice → detects different vintage
- "SKU is 2019 but they sent 2020. Update?"
- Action buttons: [Accept 2020] [Reject Delivery] [Contact Vendor]

**Scenario 2: Wine Type Mismatch**
- Visual verification detects wrong wine type
- "Ordered 2021 red, got 2021 white"
- Critical notification with immediate action options

### 2:00 PM - Inventory Count
- Mobile app QR scanning simulation
- Physical count vs system stock comparison
- Discrepancy detection: "sold 2 bottles but we're down 3"
- Manager notification with [Investigate] [Adjust Stock] [Recount]

### 4:00 PM - Low Stock Alert
- Automatic threshold monitoring
- One-tap order notification
- "Low stock. Tap to order 12 bottles from Vendor X"
- Estimated cost calculation

### 5:00 PM - Order Approval
- Manager one-tap approval
- Procurement order creation
- Vendor confirmation workflow

### 5:00 PM - 1:00 AM - Toast Sales Sync
- Continuous POS data streaming
- Mock data generation with realistic patterns
- Real-time inventory updates
- Low stock alerts during service hours

## Usage

```bash
# Run full Monday demo (accelerated ~10 minutes)
cd services/agent-orchestrator
source venv/bin/activate
python demo/demo_realtime_week.py

# Run with real Toast API (if credentials available)
python demo/demo_realtime_week.py --use-real-toast

# Run specific time slot only
python demo/demo_realtime_week.py --time 12pm  # Just delivery scenario
python demo/demo_realtime_week.py --time 2pm   # Just inventory count
python demo/demo_realtime_week.py --time 4pm   # Just low stock alert
python demo/demo_realtime_week.py --time 5pm   # Just order approval
python demo/demo_realtime_week.py --time evening  # Just Toast sync

# Run individual scenarios
python demo/demo_scenarios/vintage_mismatch.py
python demo/demo_scenarios/inventory_discrepancy.py
```

## Key Features

### Toast API Client
- **Hybrid Mode**: Attempts real API, falls back to mock
- **Mock Data Generation**: Realistic wine sales patterns by hour
- **Streaming**: Continuous sales data updates
- **Statistics**: Track API calls, sales fetched, mock data generated

### Inventory Count Service
- **Physical Count Recording**: With location tracking
- **Expected Stock Calculation**: Based on sales data
- **Discrepancy Classification**: Minor, moderate, major
- **Manager Notifications**: Contextual alerts with action buttons

### Mobile Count Simulator
- **QR Code Scanning**: Simulates mobile app workflow
- **Session Management**: Track count sessions
- **Batch Counting**: Multiple items in one session
- **Discrepancy Simulation**: Configurable discrepancy rate

### New Notification Types
1. **Vintage Mismatch Alert**: "SKU is 2019 but they sent 2020"
2. **Wine Type Mismatch Alert**: "Ordered red, got white"
3. **Inventory Discrepancy Alert**: "Sold 2, down 3"
4. **One-Tap Order Alert**: "Low stock - Tap to order"

## Test Results

All scenarios tested successfully:

```
✅ 9:00 AM - Weekly Report: Generated from Supabase
✅ 12:00 PM - Delivery: Vintage + Wine Type mismatches detected
✅ 2:00 PM - Inventory: Discrepancy detected and notified
✅ 4:00 PM - Low Stock: One-tap notification sent
✅ 5:00 PM - Order: Created and confirmed
✅ Evening - Toast: 24 mock sales, $1,462 revenue
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Demo Orchestrator                         │
│                  (demo_realtime_week.py)                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
┌─────────────┐ ┌──────────────┐ ┌─────────────────┐
│ Toast API   │ │ Inventory    │ │ Mobile Count    │
│ Client      │ │ Count Service│ │ Simulator       │
└─────────────┘ └──────────────┘ └─────────────────┘
         │            │            │
         └────────────┼────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
┌─────────────┐ ┌──────────────┐ ┌─────────────────┐
│ Supabase    │ │ RabbitMQ     │ │ Notification    │
│ Database    │ │ Message Bus  │ │ Agent           │
└─────────────┘ └──────────────┘ └─────────────────┘
```

## Success Criteria Met

| Criteria | Status |
|----------|--------|
| Weekly report from real Supabase data | ✅ |
| Vintage mismatch detected and notified | ✅ |
| Wine type mismatch detected and notified | ✅ |
| Inventory discrepancy calculated and alerted | ✅ |
| Low stock triggers one-tap order | ✅ |
| Toast sales data updates stock (mock) | ✅ |
| All notifications with action buttons | ✅ |
| Demo runs in <15 minutes (accelerated) | ✅ |

## Date Completed

**January 15, 2026**

