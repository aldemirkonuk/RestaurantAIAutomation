# 🤖 Agent Communication Protocols

**WineOps AI - Multi-Agent Orchestration Specification**

**Version:** 1.0.0  
**Last Updated:** January 7, 2026

---

## 📋 TABLE OF CONTENTS

1. [Overview](#overview)
2. [Message Bus Architecture](#message-bus-architecture)
3. [Agent Registry](#agent-registry)
4. [Message Format Specification](#message-format-specification)
5. [Agent-by-Agent Protocols](#agent-by-agent-protocols)
6. [Error Handling & Retries](#error-handling--retries)
7. [Human-in-the-Loop Checkpoints](#human-in-the-loop-checkpoints)
8. [Agent Health Monitoring](#agent-health-monitoring)

---

## 🎯 OVERVIEW

### Core Principles

1. **Event-Driven Architecture**: All agents communicate via asynchronous messages
2. **Loose Coupling**: Agents don't know about each other directly
3. **Message Persistence**: All messages stored in RabbitMQ until acknowledged
4. **Idempotency**: Agents can process same message multiple times safely
5. **Human Approval Required**: Critical operations pause for manager approval

### Communication Patterns

```
Pattern 1: Linear Handoff
Agent A → Queue → Agent B → Queue → Agent C

Pattern 2: Fan-Out (Broadcast)
Agent A → Queue → [Agent B, Agent C, Agent D]

Pattern 3: Request-Reply
Agent A → Queue → Agent B
         ←  Queue ← Agent B (reply)

Pattern 4: Peer-to-Peer (Same Workflow)
Agent A ↔ Agent B (direct, within same transaction)
```

---

## 🚌 MESSAGE BUS ARCHITECTURE

### RabbitMQ Exchange Topology

```
┌─────────────────────────────────────────────────────────┐
│                    EXCHANGES                            │
└─────────────────────────────────────────────────────────┘

1. pos.events (topic exchange)
   ├─ Routing Keys:
   │  ├─ pos.sale.completed
   │  ├─ pos.sale.voided
   │  ├─ pos.sale.refunded
   │  └─ pos.item.updated
   │
   └─ Bound Queues:
      ├─ queue.pos_ingestion
      └─ queue.buffer_manager

2. stock.events (topic exchange)
   ├─ Routing Keys:
   │  ├─ stock.evaluated
   │  ├─ stock.threshold.breached
   │  ├─ stock.updated
   │  └─ stock.inequality.detected
   │
   └─ Bound Queues:
      ├─ queue.inventory_engine
      ├─ queue.inequality_detector
      └─ queue.procurement_agent

3. procurement.events (topic exchange)
   ├─ Routing Keys:
   │  ├─ procurement.order.initiated
   │  ├─ procurement.quote.received
   │  ├─ procurement.approval.needed
   │  ├─ procurement.order.confirmed
   │  └─ procurement.delivery.received
   │
   └─ Bound Queues:
      ├─ queue.procurement_agent
      ├─ queue.notification_agent
      └─ queue.calendar_agent

4. notifications (fanout exchange)
   ├─ Routing Keys: (none - fanout to all)
   │
   └─ Bound Queues:
      ├─ queue.notification_sms
      ├─ queue.notification_email
      └─ queue.notification_push

5. reports (topic exchange)
   ├─ Routing Keys:
   │  ├─ report.daily.triggered
   │  ├─ report.weekly.triggered
   │  ├─ report.monthly.triggered
   │  └─ report.custom.triggered
   │
   └─ Bound Queues:
      └─ queue.reporting_agent

6. system.control (topic exchange)
   ├─ Routing Keys:
   │  ├─ system.pause_writes
   │  ├─ system.resume_writes
   │  ├─ system.agent.health_check
   │  └─ system.emergency.flush_buffer
   │
   └─ Bound Queues:
      ├─ queue.all_agents (all agents listen)
      └─ queue.orchestrator

7. dlx (dead letter exchange)
   ├─ Captures failed messages
   └─ Bound Queues:
      └─ queue.failed_messages (manual retry)
```

### Queue Configuration

```python
# Example Queue Declaration (Python/Pika)
channel.queue_declare(
    queue='queue.buffer_manager',
    durable=True,              # Survives broker restart
    arguments={
        'x-message-ttl': 3600000,         # Message expires after 1 hour
        'x-dead-letter-exchange': 'dlx',   # Failed messages go here
        'x-max-priority': 10,              # Support message priority
    }
)

# Bind queue to exchange
channel.queue_bind(
    exchange='pos.events',
    queue='queue.buffer_manager',
    routing_key='pos.sale.completed'
)
```

---

## 📝 MESSAGE FORMAT SPECIFICATION

### Standard Message Structure

All messages MUST follow this JSON schema:

```typescript
interface AgentMessage {
  // Message Metadata
  message_id: string;          // UUID v4
  timestamp: string;           // ISO 8601 (2026-01-07T10:30:00Z)
  correlation_id?: string;     // Links related messages
  causation_id?: string;       // ID of message that caused this one
  
  // Routing
  source_agent: string;        // 'buffer_manager_agent'
  target_agent?: string;       // Optional (for direct routing)
  routing_key: string;         // 'stock.threshold.breached'
  exchange: string;            // 'stock.events'
  
  // Message Type
  event_type: string;          // 'StockThresholdBreached'
  event_version: string;       // 'v1.0'
  
  // Business Data
  payload: {
    restaurant_id: string;     // UUID
    inventory_id: string;      // UUID
    wine_name: string;
    stock_before: number;
    stock_after: number;
    threshold: number;
    // ... event-specific fields
  };
  
  // Context
  context: {
    user_id?: string;          // If triggered by user action
    session_id?: string;
    ip_address?: string;
    restaurant_timezone: string;
  };
  
  // Processing
  priority: number;            // 1-10 (10 = highest, emergency)
  retry_count: number;         // Number of retry attempts
  max_retries: number;         // 3 (default)
  ttl_seconds: number;         // Message time-to-live
  
  // Human-in-the-Loop
  requires_approval: boolean;  // If true, wait for manager
  approval_timeout_minutes?: number;  // Auto-reject after timeout
  approval_actions?: ApprovalAction[];
  
  // Metadata
  metadata?: Record<string, any>;  // Extensible
}

interface ApprovalAction {
  action_id: string;
  label: string;               // 'Approve', 'Reject', 'Counter'
  action_type: string;         // 'approve_order', 'reject_price'
  data?: Record<string, any>;
}
```

### Example Message: Stock Threshold Breached

```json
{
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-07T14:23:15Z",
  "correlation_id": "sale-batch-001",
  "causation_id": "buffer-eval-12345",
  
  "source_agent": "buffer_manager_agent",
  "target_agent": null,
  "routing_key": "stock.threshold.breached",
  "exchange": "stock.events",
  
  "event_type": "StockThresholdBreached",
  "event_version": "v1.0",
  
  "payload": {
    "restaurant_id": "rest-001",
    "inventory_id": "inv-12345",
    "master_wine_id": "WINE_042",
    "wine_name": "Caymus Cabernet Sauvignon 2020",
    "stock_before": 5,
    "stock_after": 2,
    "threshold": 3,
    "in_transit_quantity": 0,
    "sales_velocity_7d": 1.2,
    "estimated_stockout_days": 1.6
  },
  
  "context": {
    "restaurant_timezone": "America/Los_Angeles",
    "buffer_window_minutes": 30,
    "evaluation_timestamp": "2026-01-07T14:00:00Z"
  },
  
  "priority": 7,
  "retry_count": 0,
  "max_retries": 3,
  "ttl_seconds": 3600,
  
  "requires_approval": false,
  "metadata": {
    "source_file": "buffer_manager.py",
    "function": "evaluate_buffer_window"
  }
}
```

---

## 🤖 AGENT-BY-AGENT PROTOCOLS

### 1. POS INGESTION AGENT

**Purpose**: Receive Toast POS webhooks and normalize into internal events

**Listens To:**
- HTTP Webhook: `POST /webhooks/toast/order-completed`
- HTTP Webhook: `POST /webhooks/toast/item-voided`

**Publishes To:**
```
Exchange: pos.events
Routing Keys:
  - pos.sale.completed
  - pos.sale.voided
  - pos.sale.refunded
```

**Message Schema:**
```typescript
interface POSSaleCompletedEvent {
  event_type: "POSSaleCompleted";
  payload: {
    restaurant_id: string;
    pos_order_id: string;
    pos_check_id: string;
    items_sold: Array<{
      inventory_id: string;
      wine_name: string;
      quantity: number;
      unit_price: number;
      total_price: number;
    }>;
    sale_timestamp: string;  // ISO 8601
    day_of_week: number;     // 0-6
    hour_of_day: number;     // 0-23
    server_name?: string;
    pos_raw_data: object;    // Full Toast payload
  };
}
```

**Error Handling:**
- Invalid webhook signature → Reject (401)
- Duplicate order ID → Idempotent (log & ignore)
- Unknown wine SKU → Flag for manual review

---

### 2. BUFFER MANAGER AGENT

**Purpose**: Collect POS sales in 30-min window, evaluate final stock state

**Listens To:**
```
Exchange: pos.events
Routing Key: pos.sale.completed
Queue: queue.buffer_manager (durable)
```

**Publishes To:**
```
Exchange: stock.events
Routing Keys:
  - stock.evaluated         (always)
  - stock.threshold.breached  (if stock < threshold)
```

**Internal State:**
```typescript
// In-memory buffer (Redis-backed)
interface BufferState {
  inventory_id: string;
  sales_in_window: Array<{
    quantity: number;
    timestamp: string;
  }>;
  window_start: string;
  window_end: string;
  initial_stock: number;
  final_stock: number;  // Calculated at window end
}
```

**Logic:**
```python
# Pseudocode
def on_sale_event(message):
    inventory_id = message.payload.inventory_id
    quantity = message.payload.quantity
    
    # Add to buffer
    buffer = get_or_create_buffer(inventory_id)
    buffer.sales_in_window.append({
        'quantity': quantity,
        'timestamp': message.timestamp
    })
    
    # If window expired
    if now() >= buffer.window_end:
        evaluate_buffer(buffer)

def evaluate_buffer(buffer):
    # Calculate final stock
    total_sold = sum([sale.quantity for sale in buffer.sales_in_window])
    final_stock = buffer.initial_stock - total_sold
    
    # Get threshold
    threshold = get_threshold(buffer.inventory_id)
    
    # Publish stock.evaluated
    publish_message({
        'routing_key': 'stock.evaluated',
        'payload': {
            'inventory_id': buffer.inventory_id,
            'stock_after': final_stock,
            'total_sold_in_window': total_sold,
            'threshold': threshold
        }
    })
    
    # If breached
    if final_stock < threshold:
        # Check no IN_TRANSIT order
        if not has_active_order(buffer.inventory_id):
            publish_message({
                'routing_key': 'stock.threshold.breached',
                'payload': {...}
            })
    
    # Clear buffer
    clear_buffer(buffer.inventory_id)
```

**Configuration:**
```python
BUFFER_WINDOW_MINUTES = int(os.getenv('BUFFER_WINDOW_MINUTES', 30))
BUFFER_EVALUATION_INTERVAL = 60  # Check every 60 seconds for expired windows
```

---

### 3. INVENTORY ENGINE AGENT

**Purpose**: Update database stock levels, detect inequalities

**Listens To:**
```
Exchange: stock.events
Routing Keys:
  - stock.evaluated
  - stock.manual.adjustment
  - procurement.delivery.received
```

**Publishes To:**
```
Exchange: stock.events
Routing Keys:
  - stock.updated
  - stock.inequality.detected
```

**Database Operations:**
```sql
-- Update stock after buffer evaluation
UPDATE restaurant_inventory
SET 
    stock_live = :new_stock,
    last_sold_at = :timestamp,
    updated_at = NOW()
WHERE id = :inventory_id;

-- Log to sales_events
INSERT INTO sales_events (...)
VALUES (...);
```

**Inequality Detection:**
```python
def check_inequality(inventory_id, quantity_sold):
    current_stock = get_current_stock(inventory_id)
    
    if current_stock < quantity_sold:
        # INEQUALITY DETECTED
        publish_message({
            'routing_key': 'stock.inequality.detected',
            'payload': {
                'inventory_id': inventory_id,
                'recorded_stock': current_stock,
                'attempted_sale': quantity_sold,
                'deficit': quantity_sold - current_stock,
                'suggested_corrections': [
                    {'label': '+12 bottles (1 case)', 'value': 12},
                    {'label': '+24 bottles (2 cases)', 'value': 24}
                ]
            },
            'requires_approval': True
        })
        
        # Do NOT update stock to negative
        return False
    
    return True
```

---

### 4. INEQUALITY DETECTOR AGENT

**Purpose**: Handle stock discrepancies, suggest corrections

**Listens To:**
```
Exchange: stock.events
Routing Key: stock.inequality.detected
```

**Publishes To:**
```
Exchange: notifications
Routing Key: notification.inequality.alert
```

**Message to Manager:**
```typescript
interface InequalityAlert {
  notification_type: "InequalityDetected";
  priority: 9;  // High priority
  payload: {
    inventory_id: string;
    wine_name: string;
    recorded_stock: number;
    attempted_sale: number;
    deficit: number;
    message: string;  // "Sales exceed recorded stock. Did you make a manual purchase?"
    actions: [
      {
        action_id: "correct_12",
        label: "+12 bottles (1 case)",
        action_type: "add_shadow_stock",
        data: { quantity: 12 }
      },
      {
        action_id: "correct_24",
        label: "+24 bottles (2 cases)",
        action_type: "add_shadow_stock",
        data: { quantity: 24 }
      },
      {
        action_id: "custom",
        label: "Custom amount",
        action_type: "prompt_quantity",
        data: {}
      }
    ]
  };
}
```

---

### 5. PROCUREMENT AGENT

**Purpose**: Contact suppliers, negotiate orders

**Listens To:**
```
Exchange: stock.events
Routing Key: stock.threshold.breached

Exchange: system.control
Routing Key: system.emergency.order_now
```

**Publishes To:**
```
Exchange: procurement.events
Routing Keys:
  - procurement.order.initiated
  - procurement.quote.received
  - procurement.approval.needed
```

**Workflow:**
```python
async def on_threshold_breached(message):
    inventory = message.payload
    
    # 1. Check if order already in progress
    active_order = db.query_active_order(inventory.inventory_id)
    if active_order:
        log.info("Order already in transit, skipping")
        return
    
    # 2. Get provider info
    provider = db.get_primary_provider(inventory.provider_id)
    
    # 3. Compose message using LLM (Gemini Pro)
    order_message = await llm.compose_order_message(
        provider_name=provider.name,
        wine_name=inventory.wine_name,
        quantity=2,  # cases
        last_price=inventory.last_purchase_price
    )
    
    # Example output:
    # "Hi John, I hope you're doing well. I'd like to order 2 cases 
    #  of Caymus Cabernet 2020 at $45/case. Please confirm availability."
    
    # 4. Send message
    sent = await comms.send_sms(
        to=provider.primary_contact.phone,
        message=order_message
    )
    
    # 5. Create order record
    order = db.create_procurement_order(
        status='PENDING',
        inventory_id=inventory.inventory_id,
        provider_id=provider.id,
        quoted_price=inventory.last_purchase_price
    )
    
    # 6. Publish event
    publish_message({
        'routing_key': 'procurement.order.initiated',
        'payload': {
            'order_id': order.id,
            'provider_name': provider.name,
            'message_sent': order_message,
            'awaiting_response': True
        }
    })
    
    # 7. Log conversation
    db.create_conversation_log(
        order_id=order.id,
        direction='outbound',
        channel='sms',
        message_text=order_message,
        ai_generated=True,
        llm_model='gemini-pro'
    )

async def on_provider_response(sms_webhook):
    # Parse provider SMS response
    provider_phone = sms_webhook.from_number
    response_text = sms_webhook.body
    
    # Find active order from this provider
    order = db.find_pending_order_by_provider_phone(provider_phone)
    
    # Use LLM to parse response
    parsed = await llm.parse_provider_response(response_text)
    # Returns: {
    #   intent: 'price_quote' | 'confirmation' | 'out_of_stock' | 'question',
    #   price: 50.0,
    #   availability: true,
    #   sentiment: 'positive',
    #   requires_clarification: false
    # }
    
    # Log conversation
    db.create_conversation_log(
        order_id=order.id,
        direction='inbound',
        message_text=response_text
    )
    
    # Publish quote received
    publish_message({
        'routing_key': 'procurement.quote.received',
        'payload': {
            'order_id': order.id,
            'provider_response': response_text,
            'parsed_intent': parsed.intent,
            'quoted_price': parsed.price,
            'available': parsed.availability
        }
    })
    
    # Check if price deviation
    original_price = order.quoted_price
    new_price = parsed.price
    deviation = abs(new_price - original_price) / original_price
    
    if deviation > 0.10:  # More than 10% change
        # Requires manager approval
        publish_message({
            'routing_key': 'procurement.approval.needed',
            'payload': {
                'order_id': order.id,
                'reason': 'price_deviation',
                'original_price': original_price,
                'new_price': new_price,
                'deviation_percent': deviation * 100,
                'provider_name': order.provider.name,
                'wine_name': order.inventory.wine_name,
                'quantity': order.quantity
            },
            'requires_approval': True,
            'approval_timeout_minutes': 60,
            'approval_actions': [
                {'action_id': 'approve', 'label': 'Approve', 'action_type': 'approve_order'},
                {'action_id': 'reject', 'label': 'Reject', 'action_type': 'reject_order'},
                {'action_id': 'counter', 'label': 'Counter Offer', 'action_type': 'counter_price'}
            ]
        })
    else:
        # Auto-approve (within 10%)
        # Still notify manager but don't require action
        pass
```

---

### 6. NOTIFICATION AGENT

**Purpose**: Send alerts via SMS/Email/Push

**Listens To:**
```
Exchange: notifications (fanout)
Exchange: procurement.events (topic)
  - procurement.approval.needed
Exchange: stock.events (topic)
  - stock.inequality.detected
```

**Publishes To:**
```
(None - terminal agent, but logs to database)
```

**Channel Selection:**
```python
def determine_channels(priority, notification_type):
    if priority >= 9:  # Urgent
        return ['sms', 'push', 'email']
    elif priority >= 7:  # High
        return ['push', 'email']
    elif priority >= 5:  # Normal
        return ['push']
    else:  # Low
        return ['email']
```

**SMS Template (Plivo):**
```python
async def send_low_stock_alert(inventory):
    message = f"⚠️ {inventory.wine_name} is low!\n" \
              f"Stock: {inventory.stock_live} (threshold: {inventory.threshold})\n" \
              f"Tap to reorder: {approval_link}"
    
    await plivo_client.send_sms(
        to=manager.phone,
        from_=os.getenv('PLIVO_PHONE_NUMBER'),
        text=message
    )
```

---

### 7. REPORTING AGENT

**Purpose**: Generate scheduled reports

**Listens To:**
```
Exchange: reports
Routing Keys:
  - report.daily.triggered
  - report.weekly.triggered
  - report.monthly.triggered
```

**Publishes To:**
```
(None - terminal agent)
```

**Scheduled Trigger (External Cron):**
```python
# Triggered by pg_cron or external scheduler
# Every day at 8 AM
publish_message({
    'exchange': 'reports',
    'routing_key': 'report.daily.triggered',
    'payload': {
        'report_type': 'daily',
        'restaurant_id': 'rest-001',
        'report_date': '2026-01-07'
    }
})
```

**Report Generation:**
```python
async def generate_daily_report(restaurant_id, report_date):
    # Query database
    stock_changes = db.get_stock_changes(restaurant_id, report_date)
    low_stock = db.get_low_stock_items(restaurant_id)
    sales = db.get_sales_summary(restaurant_id, report_date)
    
    # Optional: AI insights
    if manager_profile.ai_insights_enabled:
        insights = await llm.generate_insights(stock_changes, sales)
    
    # Generate PDF
    pdf_url = pdf_generator.create_report({
        'title': f'Daily Wine Operations Report - {report_date}',
        'sections': [stock_changes, low_stock, sales],
        'insights': insights
    })
    
    # Save to database
    db.create_generated_report(
        restaurant_id=restaurant_id,
        report_type='daily',
        pdf_url=pdf_url,
        report_data={'stock_changes': stock_changes, ...}
    )
    
    # Send email
    await email.send_report(
        to=manager_profile.email,
        subject=f'Daily Report - {report_date}',
        pdf_url=pdf_url
    )
```

---

### 8. CALENDAR AGENT

**Purpose**: Detect important dates from conversations, create reminders

**Listens To:**
```
Exchange: procurement.events
Routing Key: procurement.conversation.logged
```

**Publishes To:**
```
Exchange: notifications
Routing Key: notification.calendar.event_detected
```

**AI Date Detection:**
```python
async def analyze_conversation(conversation):
    # Use Gemini Pro to detect dates
    analysis = await llm.analyze_for_dates(
        conversation_text=conversation.message_text,
        context={
            'provider_name': conversation.provider.name,
            'conversation_history': conversation.provider.conversation_history
        }
    )
    
    # Example LLM output:
    # {
    #   "dates_detected": [
    #     {
    #       "date": "2026-02-03",
    #       "type": "provider_unavailable",
    #       "context": "My mom's surgery is next Thursday",
    #       "duration_days": 7,
    #       "confidence": 0.95
    #     }
    #   ],
    #   "important_events": [
    #     {
    #       "event_type": "personal_event",
    #       "description": "Provider's mom surgery",
    #       "impact_on_business": "Slower response time",
    #       "suggested_action": "Consider alternative provider for urgent orders"
    #     }
    #   ]
    # }
    
    for detected_date in analysis.dates_detected:
        if detected_date.confidence > 0.80:
            # Create calendar event (pending approval)
            event = db.create_calendar_event(
                restaurant_id=conversation.restaurant_id,
                provider_id=conversation.provider_id,
                title=f"{conversation.provider.name} - {detected_date.type}",
                event_date=detected_date.date,
                event_type=detected_date.type,
                source='ai_detected',
                ai_confidence=detected_date.confidence,
                status='pending'
            )
            
            # Notify manager for approval
            publish_message({
                'exchange': 'notifications',
                'routing_key': 'notification.calendar.event_detected',
                'payload': {
                    'event_id': event.id,
                    'title': event.title,
                    'date': event.event_date,
                    'context': detected_date.context,
                    'suggested_action': analysis.important_events[0].suggested_action
                },
                'requires_approval': True,
                'approval_actions': [
                    {'action_id': 'add', 'label': 'Add to Calendar'},
                    {'action_id': 'dismiss', 'label': 'Dismiss'}
                ]
            })
```

---

### 9. VISUAL VERIFICATION AGENT (Phase 2)

**Purpose**: Verify wine labels and invoices using computer vision

**Listens To:**
```
Exchange: procurement.events
Routing Key: procurement.image.uploaded
```

**Publishes To:**
```
Exchange: procurement.events
Routing Keys:
  - procurement.verification.completed
  - procurement.verification.mismatch
```

**Processing Pipeline:**
```python
async def verify_delivery_image(image_url, order_id):
    # 1. Download image
    image = await download_image(image_url)
    
    # 2. YOLOv8 label detection
    labels_detected = await yolov8.detect_wine_labels(image)
    # Returns: [
    #   {bbox: [x, y, w, h], confidence: 0.92, class: 'wine_label'},
    #   ...
    # ]
    
    # 3. OCR on detected labels
    text_results = []
    for label in labels_detected:
        cropped = crop_image(image, label.bbox)
        text = await easyocr.read_text(cropped)
        text_results.append(text)
    
    # 4. Extract wine info using LLM
    wine_info = await llm.extract_wine_details(text_results)
    # Returns: {
    #   'producer': 'Caymus',
    #   'wine_name': 'Cabernet Sauvignon',
    #   'vintage': 2020,
    #   'quantity_detected': 24,
    #   'confidence': 0.88
    # }
    
    # 5. Compare with order
    order = db.get_order(order_id)
    matches = compare_wine_details(wine_info, order)
    
    if matches.is_match:
        publish_message({
            'routing_key': 'procurement.verification.completed',
            'payload': {
                'order_id': order_id,
                'verified': True,
                'wine_info_detected': wine_info
            }
        })
    else:
        # Mismatch detected
        publish_message({
            'routing_key': 'procurement.verification.mismatch',
            'payload': {
                'order_id': order_id,
                'expected': order.wine_details,
                'detected': wine_info,
                'discrepancies': matches.discrepancies
            },
            'requires_approval': True
        })
```

---

### 10. SELF-IMPROVEMENT AGENT (Observer Mode - MVP)

**Purpose**: Monitor agent performance, detect edge cases

**Listens To:**
```
ALL queues (passive observer)
```

**Publishes To:**
```
(None - writes to database and generates weekly reports)
```

**Metrics Collected:**
```python
class AgentMetrics:
    agent_name: str
    action: str
    duration_ms: int
    status: str  # 'success' | 'failed' | 'partial'
    error_message: Optional[str]
    timestamp: datetime

# Stored in agent_activity_logs table

async def observe_all_messages():
    # Subscribe to all queues in read-only mode
    for queue in all_queues:
        channel.basic_consume(
            queue=queue,
            on_message_callback=log_agent_activity,
            auto_ack=True  # Don't interfere with processing
        )

def log_agent_activity(message):
    db.insert_agent_activity_log({
        'agent_name': message.source_agent,
        'agent_action': message.event_type,
        'started_at': message.timestamp,
        'status': 'success',  # Inferred from completion
        'input_data': message.payload,
        ...
    })
    
    # Detect edge cases
    if is_edge_case(message):
        db.update_agent_activity_log({
            'edge_case_detected': True,
            'edge_case_type': classify_edge_case(message),
            'improvement_suggestion': suggest_improvement(message)
        })

def generate_weekly_improvement_report():
    metrics = db.query_agent_metrics(last_7_days)
    
    report = {
        'slow_agents': find_slow_agents(metrics),  # p95 > threshold
        'error_prone_agents': find_error_prone(metrics),  # error rate > 5%
        'edge_cases_detected': count_edge_cases(metrics),
        'suggested_improvements': [
            {
                'agent': 'buffer_manager',
                'issue': 'p95 latency increased by 200ms',
                'suggestion': 'Increase buffer evaluation interval to reduce CPU load'
            }
        ]
    }
    
    # Email to developer
    send_email(
        to='dev@wineops.ai',
        subject='Weekly Agent Performance Report',
        body=format_report(report)
    )
```

---

## ⚠️ ERROR HANDLING & RETRIES

### Retry Strategy

```python
# Exponential backoff with jitter
def calculate_retry_delay(retry_count):
    base_delay = 2 ** retry_count  # 2, 4, 8, 16 seconds
    jitter = random.uniform(0, 0.1 * base_delay)
    return min(base_delay + jitter, 60)  # Max 60 seconds

# Message retry headers
message_properties = pika.BasicProperties(
    delivery_mode=2,  # Persistent
    headers={
        'x-retry-count': retry_count,
        'x-max-retries': 3,
        'x-original-queue': 'queue.buffer_manager',
        'x-error-message': str(error)
    }
)
```

### Dead Letter Queue (DLQ)

```python
def handle_max_retries_exceeded(message):
    # Move to DLQ
    channel.basic_publish(
        exchange='dlx',
        routing_key=message.routing_key,
        body=message.body,
        properties=message.properties
    )
    
    # Alert developer
    send_alert(
        severity='error',
        message=f"Message {message.message_id} exceeded max retries",
        context=message.payload
    )
    
    # Log to database
    db.insert_failed_message(message)
```

---

## 🔐 HUMAN-IN-THE-LOOP CHECKPOINTS

### Approval Flow

```python
async def send_approval_request(message):
    # Create notification
    notification = db.create_notification(
        restaurant_id=message.payload.restaurant_id,
        recipient_id=message.context.manager_id,
        notification_type='approval_needed',
        priority=message.priority,
        payload=message.payload,
        actions=message.approval_actions
    )
    
    # Send via multiple channels
    await notification_agent.send_multi_channel(notification)
    
    # Wait for approval (non-blocking)
    # Agent subscribes to approval responses
    channel.basic_consume(
        queue='queue.approval_responses',
        on_message_callback=handle_approval_response
    )

def handle_approval_response(approval_message):
    original_message_id = approval_message.correlation_id
    action_taken = approval_message.payload.action_id
    
    if action_taken == 'approve':
        # Continue workflow
        resume_workflow(original_message_id)
    elif action_taken == 'reject':
        # Cancel workflow
        cancel_workflow(original_message_id)
    elif action_taken == 'counter':
        # Modify and continue
        modified_payload = approval_message.payload.modified_data
        resume_workflow_with_changes(original_message_id, modified_payload)
```

---

## 📊 AGENT HEALTH MONITORING

### Health Check Endpoint

```python
# Each agent exposes /health endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "agent_name": "buffer_manager_agent",
        "version": "1.0.0",
        "uptime_seconds": get_uptime(),
        "rabbitmq_connected": rabbitmq.is_connected(),
        "database_connected": db.is_connected(),
        "redis_connected": redis.is_connected(),
        "messages_processed_last_minute": get_recent_count(),
        "error_rate_last_hour": get_error_rate(),
        "timestamp": datetime.now().isoformat()
    }
```

### Orchestrator Health Monitor

```python
# Orchestrator periodically checks all agents
async def monitor_agent_health():
    while True:
        for agent in agent_registry:
            try:
                response = await httpx.get(f"{agent.url}/health", timeout=5)
                if response.status_code != 200:
                    alert_unhealthy_agent(agent)
            except httpx.TimeoutException:
                alert_unresponsive_agent(agent)
        
        await asyncio.sleep(30)  # Check every 30 seconds
```

---

## 🎯 QUICK REFERENCE: Message Routing Table

| Event | Exchange | Routing Key | Consuming Agent |
|-------|----------|-------------|----------------|
| POS Sale | `pos.events` | `pos.sale.completed` | Buffer Manager |
| Stock Low | `stock.events` | `stock.threshold.breached` | Procurement Agent |
| Order Quote | `procurement.events` | `procurement.quote.received` | Procurement Agent |
| Approval Needed | `notifications` | `notification.approval.needed` | Notification Agent |
| Inequality | `stock.events` | `stock.inequality.detected` | Inequality Detector |
| Report Due | `reports` | `report.daily.triggered` | Reporting Agent |
| System Pause | `system.control` | `system.pause_writes` | ALL Agents |

---

**Next Steps:** See `API_REFERENCE.md` for REST API endpoints and `TESTING_STRATEGY.md` for E2E test scenarios.

