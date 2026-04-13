# WineOps AI - Agent Catalog

**Version**: 2.6.0  
**Framework**: FastAPI + Python  
**Last Updated**: January 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Inventory Agents](#inventory-agents)
4. [Procurement Agents](#procurement-agents)
5. [Reporting Agents](#reporting-agents)
6. [Compliance Agents](#compliance-agents)
7. [Communication Agents](#communication-agents)
8. [Integration Agents](#integration-agents)
9. [Supporting Services](#supporting-services)
10. [Agent Development Guide](#agent-development-guide)

---

## Overview

The WineOps AI Agent Orchestrator is a Python-based system that coordinates 17 specialized AI agents for restaurant wine operations automation.

### Agent Statistics

| Category | Count | Purpose |
|----------|-------|---------|
| Inventory | 5 | Stock management, detection, verification |
| Procurement | 4 | Orders, reordering, negotiation |
| Reporting | 3 | Reports, calendar, analysis |
| Compliance | 2 | Regulatory, data integrity |
| Communication | 2 | Notifications, recommendations |
| Integration | 2 | POS, autonomous operations |
| **Total** | **17** | |

### Key Features

- **Base Agent Pattern**: All agents extend `BaseAgent` class
- **Human-in-the-Loop**: Agents can require approval before execution
- **Message Bus**: RabbitMQ for async communication
- **LLM Integration**: OpenAI/Anthropic for intelligent decisions
- **Celery Tasks**: Background job processing

---

## Core Architecture

### Directory Structure

```
services/agent-orchestrator/
├── agents/
│   ├── __init__.py
│   ├── auto_pilot_agent.py
│   ├── buffer_manager.py
│   ├── calendar_agent.py
│   ├── compliance_agent.py
│   ├── ghost_inventory_agent.py
│   ├── inequality_detector.py
│   ├── inventory_engine.py
│   ├── menu_analyzer_agent.py
│   ├── negotiation_playbook_agent.py
│   ├── notification_agent.py
│   ├── pos_integration_agent.py
│   ├── procurement_agent.py
│   ├── recurring_order_agent.py
│   ├── reporting_agent.py
│   ├── rfq_agent.py
│   ├── shrinkage_detective_agent.py
│   ├── sommelier_agent.py
│   ├── state_invariant_enforcer.py
│   └── visual_verification_agent.py
├── core/
│   ├── __init__.py
│   ├── base_agent.py
│   ├── database.py
│   ├── message_bus.py
│   └── orchestrator.py
├── services/
│   ├── email_client.py
│   ├── plivo_client.py
│   ├── toast_api_client.py
│   └── ...
├── jobs/
│   ├── celery_app.py
│   └── tasks.py
└── main.py
```

### Base Agent Class

All agents extend the `BaseAgent` class:

```python
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from pydantic import BaseModel

class AgentContext(BaseModel):
    restaurant_id: str
    user_id: Optional[str]
    trace_id: str
    correlation_id: Optional[str]

class AgentResult(BaseModel):
    success: bool
    action_taken: str
    data: Dict[str, Any]
    requires_approval: bool = False
    approval_message: Optional[str] = None

class BaseAgent(ABC):
    """Base class for all WineOps agents."""
    
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
        self.logger = get_logger(name)
    
    @abstractmethod
    async def execute(
        self, 
        context: AgentContext, 
        params: Dict[str, Any]
    ) -> AgentResult:
        """Execute the agent's main task."""
        pass
    
    async def pre_execute(self, context: AgentContext) -> bool:
        """Pre-execution checks. Return False to abort."""
        return True
    
    async def post_execute(
        self, 
        context: AgentContext, 
        result: AgentResult
    ) -> None:
        """Post-execution cleanup and logging."""
        pass
    
    async def requires_human_approval(
        self, 
        context: AgentContext, 
        params: Dict[str, Any]
    ) -> bool:
        """Check if this action requires human approval."""
        return False
```

### Orchestrator

The core orchestrator routes tasks to appropriate agents:

```python
class Orchestrator:
    """Central coordinator for all agents."""
    
    def __init__(self):
        self.agents: Dict[str, BaseAgent] = {}
        self.message_bus = MessageBus()
        
    def register_agent(self, agent: BaseAgent) -> None:
        self.agents[agent.name] = agent
        
    async def route_task(
        self, 
        task_type: str, 
        context: AgentContext, 
        params: Dict[str, Any]
    ) -> AgentResult:
        """Route task to appropriate agent."""
        agent = self._get_agent_for_task(task_type)
        
        # Check if approval required
        if await agent.requires_human_approval(context, params):
            return await self._create_approval_request(agent, context, params)
        
        # Execute agent
        result = await agent.execute(context, params)
        
        # Emit result event
        await self.message_bus.publish(
            f"agent.{agent.name}.completed",
            result.dict()
        )
        
        return result
```

---

## Inventory Agents

### 1. InventoryEngineAgent

**Purpose**: Core inventory operations - stock updates, transfers, adjustments.

**File**: `agents/inventory_engine.py`

```python
class InventoryEngineAgent(BaseAgent):
    """
    Handles core inventory operations including:
    - Stock level updates
    - Inventory transfers between locations
    - Stock adjustments with audit trail
    - Par level calculations
    """
    
    async def execute(self, context, params):
        action = params.get("action")
        
        if action == "update_stock":
            return await self._update_stock(context, params)
        elif action == "transfer":
            return await self._transfer_stock(context, params)
        elif action == "adjust":
            return await self._adjust_stock(context, params)
        elif action == "calculate_par":
            return await self._calculate_par_levels(context, params)
```

**Supported Actions**:
| Action | Description |
|--------|-------------|
| `update_stock` | Update stock count for an item |
| `transfer` | Transfer stock between locations |
| `adjust` | Make adjustment with reason |
| `calculate_par` | Calculate optimal par levels based on sales |

---

### 2. GhostInventoryAgent

**Purpose**: Detect phantom/ghost inventory - stock that exists in system but not physically.

**File**: `agents/ghost_inventory_agent.py`

```python
class GhostInventoryAgent(BaseAgent):
    """
    Detects phantom inventory through:
    - POS sales vs physical count comparison
    - Aging inventory analysis
    - Last-sold date tracking
    - Zero-movement detection
    """
    
    async def execute(self, context, params):
        # Analyze inventory for ghost items
        ghost_candidates = await self._identify_ghost_inventory(
            context.restaurant_id
        )
        
        # Score each candidate
        scored = await self._score_candidates(ghost_candidates)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(scored)
        
        return AgentResult(
            success=True,
            action_taken="ghost_inventory_scan",
            data={
                "ghost_items": scored,
                "recommendations": recommendations
            },
            requires_approval=True,
            approval_message="Review ghost inventory findings"
        )
```

**Detection Criteria**:
- Items with zero POS sales in 30+ days
- Discrepancy between system stock and last count
- Items marked "in stock" but never scanned/sold
- High-value items with inconsistent movement

---

### 3. ShrinkageDetectiveAgent

**Purpose**: Identify inventory shrinkage patterns (theft, spillage, spoilage).

**File**: `agents/shrinkage_detective_agent.py`

```python
class ShrinkageDetectiveAgent(BaseAgent):
    """
    Investigates shrinkage patterns:
    - Variance analysis (expected vs actual)
    - Time-of-day patterns
    - Staff correlation
    - Category-specific shrinkage rates
    """
    
    async def execute(self, context, params):
        period = params.get("period", "30d")
        
        # Calculate shrinkage by category
        shrinkage_data = await self._calculate_shrinkage(
            context.restaurant_id, 
            period
        )
        
        # Identify patterns
        patterns = await self._analyze_patterns(shrinkage_data)
        
        # Generate alerts for anomalies
        alerts = self._generate_shrinkage_alerts(patterns)
        
        return AgentResult(
            success=True,
            action_taken="shrinkage_analysis",
            data={
                "shrinkage_summary": shrinkage_data,
                "patterns": patterns,
                "alerts": alerts
            }
        )
```

**Analysis Dimensions**:
| Dimension | Description |
|-----------|-------------|
| Time-based | Shrinkage by day/shift |
| Category | Shrinkage by wine type |
| Value | High-value item tracking |
| Location | By storage location |

---

### 4. VisualVerificationAgent

**Purpose**: Photo-based inventory verification using computer vision.

**File**: `agents/visual_verification_agent.py`

```python
class VisualVerificationAgent(BaseAgent):
    """
    Visual inventory verification:
    - Shelf photo analysis
    - Bottle counting via YOLOv8
    - Label recognition
    - Vintage verification
    """
    
    async def execute(self, context, params):
        image_url = params.get("image_url")
        location = params.get("location")
        
        # Run object detection
        detection_result = await self._detect_bottles(image_url)
        
        # Match with expected inventory
        verification = await self._verify_against_inventory(
            context.restaurant_id,
            location,
            detection_result
        )
        
        return AgentResult(
            success=True,
            action_taken="visual_verification",
            data={
                "detected_count": detection_result.count,
                "expected_count": verification.expected,
                "variance": verification.variance,
                "confidence": detection_result.confidence,
                "detected_items": detection_result.items
            }
        )
```

**Capabilities**:
- YOLOv8 bottle detection
- Label text recognition (OCR)
- Vintage year extraction
- Shelf position mapping

---

### 5. InequalityDetectorAgent

**Purpose**: Detect discrepancies between systems (POS, inventory, orders).

**File**: `agents/inequality_detector.py`

```python
class InequalityDetectorAgent(BaseAgent):
    """
    Cross-system discrepancy detection:
    - POS vs Inventory mismatches
    - Order received vs system updated
    - Invoice vs delivery count
    """
    
    async def execute(self, context, params):
        check_type = params.get("check_type")
        
        if check_type == "pos_inventory":
            return await self._check_pos_inventory(context)
        elif check_type == "order_received":
            return await self._check_order_received(context, params)
        elif check_type == "invoice_delivery":
            return await self._check_invoice_delivery(context, params)
```

**Discrepancy Types**:
| Type | Source A | Source B |
|------|----------|----------|
| POS-Inventory | Toast POS sales | System stock |
| Order-Received | Purchase order | Received count |
| Invoice-Delivery | Invoice amount | Physical delivery |

---

## Procurement Agents

### 6. ProcurementAgent

**Purpose**: Generate intelligent purchase order recommendations.

**File**: `agents/procurement_agent.py`

```python
class ProcurementAgent(BaseAgent):
    """
    Intelligent procurement recommendations:
    - Low stock reorder suggestions
    - Provider selection optimization
    - Price comparison across providers
    - Lead time consideration
    """
    
    async def execute(self, context, params):
        # Get low stock items
        low_stock = await self._get_low_stock_items(context.restaurant_id)
        
        # Generate order recommendations
        recommendations = []
        for item in low_stock:
            best_provider = await self._find_best_provider(item)
            order_qty = self._calculate_order_quantity(item)
            
            recommendations.append({
                "item": item,
                "provider": best_provider,
                "quantity": order_qty,
                "estimated_cost": order_qty * best_provider.price
            })
        
        return AgentResult(
            success=True,
            action_taken="generate_recommendations",
            data={"recommendations": recommendations},
            requires_approval=True,
            approval_message="Review and approve purchase orders"
        )
```

**Features**:
- Automatic low-stock detection
- Multi-provider comparison
- Order quantity optimization
- Cost estimation

---

### 7. RecurringOrderAgent

**Purpose**: Manage automated recurring orders.

**File**: `agents/recurring_order_agent.py`

```python
class RecurringOrderAgent(BaseAgent):
    """
    Automated recurring order management:
    - Schedule-based order generation
    - Dynamic quantity adjustment
    - Skip logic (above threshold)
    - Provider rotation
    """
    
    async def execute(self, context, params):
        action = params.get("action")
        
        if action == "generate_scheduled":
            return await self._generate_scheduled_orders(context)
        elif action == "adjust_quantities":
            return await self._adjust_order_quantities(context, params)
        elif action == "evaluate_skip":
            return await self._evaluate_skip_conditions(context, params)
```

**Schedule Options**:
- Weekly (specific day)
- Bi-weekly
- Monthly (specific date)
- Custom intervals

---

### 8. RFQAgent

**Purpose**: Generate and manage Request for Quotes.

**File**: `agents/rfq_agent.py`

```python
class RFQAgent(BaseAgent):
    """
    Request for Quote management:
    - Generate RFQ documents
    - Distribute to multiple providers
    - Collect and compare responses
    - Recommend best quotes
    """
    
    async def execute(self, context, params):
        items = params.get("items")
        providers = params.get("provider_ids")
        
        # Generate RFQ
        rfq = await self._create_rfq(items, context)
        
        # Send to providers
        await self._distribute_rfq(rfq, providers)
        
        return AgentResult(
            success=True,
            action_taken="rfq_created",
            data={"rfq_id": rfq.id, "sent_to": providers}
        )
```

---

### 9. NegotiationPlaybookAgent

**Purpose**: AI-powered price negotiation strategies.

**File**: `agents/negotiation_playbook_agent.py`

```python
class NegotiationPlaybookAgent(BaseAgent):
    """
    Price negotiation assistant:
    - Historical price analysis
    - Market rate comparison
    - Negotiation script generation
    - Counter-offer suggestions
    """
    
    async def execute(self, context, params):
        wine_id = params.get("wine_id")
        provider_id = params.get("provider_id")
        target_price = params.get("target_price")
        
        # Analyze historical prices
        price_history = await self._get_price_history(wine_id, provider_id)
        
        # Get market comparison
        market_rates = await self._get_market_rates(wine_id)
        
        # Generate negotiation strategy
        strategy = await self._generate_strategy(
            price_history, 
            market_rates, 
            target_price
        )
        
        return AgentResult(
            success=True,
            action_taken="negotiation_strategy",
            data={
                "strategy": strategy,
                "talking_points": strategy.talking_points,
                "target_discount": strategy.target_discount,
                "fallback_positions": strategy.fallbacks
            }
        )
```

**Strategy Elements**:
- Volume discount leverage
- Historical price trends
- Competitor pricing
- Seasonal factors

---

## Reporting Agents

### 10. ReportingAgent

**Purpose**: Generate comprehensive reports.

**File**: `agents/reporting_agent.py`

```python
class ReportingAgent(BaseAgent):
    """
    Report generation:
    - Inventory valuation
    - Sales analysis
    - Profit margins
    - Provider performance
    - Custom reports
    """
    
    async def execute(self, context, params):
        report_type = params.get("type")
        date_range = params.get("date_range")
        format = params.get("format", "pdf")
        
        # Generate report data
        report_data = await self._generate_report_data(
            context.restaurant_id,
            report_type,
            date_range
        )
        
        # Render report
        report_file = await self._render_report(
            report_data, 
            report_type, 
            format
        )
        
        return AgentResult(
            success=True,
            action_taken="report_generated",
            data={
                "report_id": report_file.id,
                "download_url": report_file.url,
                "format": format
            }
        )
```

**Report Types**:
| Type | Description |
|------|-------------|
| `inventory_valuation` | Current inventory value |
| `sales_analysis` | Sales by wine/category |
| `profit_margin` | Cost vs revenue analysis |
| `provider_performance` | Provider metrics |
| `weekly_summary` | Weekly overview |
| `monthly_inventory` | Month-end inventory |

---

### 11. CalendarAgent

**Purpose**: Intelligent calendar and scheduling management.

**File**: `agents/calendar_agent.py`

```python
class CalendarAgent(BaseAgent):
    """
    Calendar management:
    - Delivery scheduling optimization
    - Tasting event planning
    - Provider meeting coordination
    - Deadline tracking
    """
    
    async def execute(self, context, params):
        action = params.get("action")
        
        if action == "optimize_deliveries":
            return await self._optimize_delivery_schedule(context)
        elif action == "suggest_tasting":
            return await self._suggest_tasting_dates(context, params)
        elif action == "check_deadlines":
            return await self._check_upcoming_deadlines(context)
```

**Scheduling Features**:
- Delivery consolidation
- Conflict detection
- Provider cutoff awareness
- Staff availability consideration

---

### 12. MenuAnalyzerAgent

**Purpose**: Analyze menu performance and optimization.

**File**: `agents/menu_analyzer_agent.py`

```python
class MenuAnalyzerAgent(BaseAgent):
    """
    Menu analysis and optimization:
    - Wine-by-the-glass performance
    - Pairing recommendations
    - Pricing optimization
    - Seasonal adjustments
    """
    
    async def execute(self, context, params):
        # Analyze current menu performance
        performance = await self._analyze_menu_performance(
            context.restaurant_id
        )
        
        # Generate optimization suggestions
        suggestions = await self._generate_suggestions(performance)
        
        return AgentResult(
            success=True,
            action_taken="menu_analysis",
            data={
                "performance": performance,
                "suggestions": suggestions,
                "estimated_revenue_impact": suggestions.revenue_impact
            }
        )
```

---

## Compliance Agents

### 13. ComplianceAgent

**Purpose**: Regulatory and compliance monitoring.

**File**: `agents/compliance_agent.py`

```python
class ComplianceAgent(BaseAgent):
    """
    Compliance monitoring:
    - License expiration tracking
    - Regulatory reporting
    - Audit preparation
    - Document management
    """
    
    async def execute(self, context, params):
        check_type = params.get("check_type")
        
        if check_type == "license_status":
            return await self._check_licenses(context)
        elif check_type == "audit_prep":
            return await self._prepare_audit_docs(context, params)
        elif check_type == "regulatory_report":
            return await self._generate_regulatory_report(context, params)
```

**Compliance Areas**:
- Liquor license tracking
- State reporting requirements
- Tax documentation
- Age verification records

---

### 14. StateInvariantEnforcerAgent

**Purpose**: Maintain data integrity and system invariants.

**File**: `agents/state_invariant_enforcer.py`

```python
class StateInvariantEnforcerAgent(BaseAgent):
    """
    Data integrity enforcement:
    - Stock never negative
    - Transactions balanced
    - Order totals correct
    - Referential integrity
    """
    
    async def execute(self, context, params):
        # Run invariant checks
        violations = await self._check_all_invariants(context.restaurant_id)
        
        # Auto-fix where possible
        fixes = []
        for violation in violations:
            if violation.auto_fixable:
                fix = await self._apply_fix(violation)
                fixes.append(fix)
        
        return AgentResult(
            success=len(violations) == 0,
            action_taken="invariant_check",
            data={
                "violations": violations,
                "auto_fixed": fixes,
                "requires_manual": [v for v in violations if not v.auto_fixable]
            }
        )
```

**Invariants Checked**:
| Invariant | Description | Auto-Fix |
|-----------|-------------|----------|
| Non-negative stock | Stock >= 0 | No |
| Transaction balance | Credits = Debits | Yes |
| Order totals | Sum items = Total | Yes |
| FK integrity | All FKs valid | No |

---

## Communication Agents

### 15. NotificationAgent

**Purpose**: Intelligent notification routing and delivery.

**File**: `agents/notification_agent.py`

```python
class NotificationAgent(BaseAgent):
    """
    Notification management:
    - Multi-channel delivery (email, SMS, push)
    - Priority-based routing
    - User preference respect
    - Batching and digest
    """
    
    async def execute(self, context, params):
        notification_type = params.get("type")
        recipients = params.get("recipients")
        priority = params.get("priority", "normal")
        
        # Determine channels based on preferences
        delivery_plan = await self._create_delivery_plan(
            recipients, 
            notification_type, 
            priority
        )
        
        # Execute delivery
        results = await self._deliver_notifications(delivery_plan)
        
        return AgentResult(
            success=all(r.success for r in results),
            action_taken="notifications_sent",
            data={"delivery_results": results}
        )
```

**Channels**:
- Email (Gmail API)
- SMS (Plivo)
- Push notifications
- In-app notifications

---

### 16. SommelierAgent

**Purpose**: AI-powered wine recommendations.

**File**: `agents/sommelier_agent.py`

```python
class SommelierAgent(BaseAgent):
    """
    Wine recommendation engine:
    - Food pairing suggestions
    - Customer preference matching
    - Inventory-aware recommendations
    - Price point filtering
    """
    
    async def execute(self, context, params):
        query_type = params.get("query_type")
        
        if query_type == "food_pairing":
            dish = params.get("dish")
            return await self._recommend_for_dish(context, dish)
        elif query_type == "similar_wine":
            wine_id = params.get("wine_id")
            return await self._find_similar(context, wine_id)
        elif query_type == "occasion":
            occasion = params.get("occasion")
            budget = params.get("budget")
            return await self._recommend_for_occasion(context, occasion, budget)
```

**Recommendation Types**:
| Type | Input | Output |
|------|-------|--------|
| Food Pairing | Dish description | Wine recommendations |
| Similar Wine | Wine ID | Similar wines in stock |
| Occasion | Event type + budget | Curated selection |
| Preference | Customer profile | Personalized list |

---

## Integration Agents

### 17. POSIntegrationAgent

**Purpose**: Toast POS synchronization and integration.

**File**: `agents/pos_integration_agent.py`

```python
class POSIntegrationAgent(BaseAgent):
    """
    Toast POS integration:
    - Menu sync
    - Sales data import
    - Item mapping
    - Real-time updates
    """
    
    async def execute(self, context, params):
        action = params.get("action")
        
        if action == "sync_menu":
            return await self._sync_menu(context)
        elif action == "import_sales":
            return await self._import_sales(context, params)
        elif action == "map_items":
            return await self._auto_map_items(context)
        elif action == "process_webhook":
            return await self._process_webhook(context, params)
```

**Integration Features**:
- Automatic menu sync
- Real-time sales import
- AI-powered item mapping
- Webhook event processing

---

### 18. AutoPilotAgent

**Purpose**: Autonomous operation mode for routine tasks.

**File**: `agents/auto_pilot_agent.py`

```python
class AutoPilotAgent(BaseAgent):
    """
    Autonomous operations:
    - Routine task execution
    - Scheduled maintenance
    - Self-healing operations
    - Escalation management
    """
    
    async def execute(self, context, params):
        mode = params.get("mode")
        
        if mode == "daily_routine":
            return await self._run_daily_routine(context)
        elif mode == "maintenance":
            return await self._run_maintenance(context)
        elif mode == "self_heal":
            return await self._attempt_self_heal(context, params)
```

**Auto-Pilot Tasks**:
- Daily inventory checks
- Report generation
- Alert cleanup
- Cache refresh
- Health monitoring

---

## Supporting Services

### Email Client

```python
# services/email_client.py
class EmailClient:
    """Gmail API integration for sending emails."""
    
    async def send(
        self, 
        to: List[str], 
        subject: str, 
        body_html: str,
        attachments: List[Attachment] = None
    ) -> EmailResult
```

### Plivo Client

```python
# services/plivo_client.py
class PlivoClient:
    """Plivo SMS integration."""
    
    async def send_sms(
        self, 
        to: str, 
        message: str
    ) -> SMSResult
```

### Toast API Client

```python
# services/toast_api_client.py
class ToastAPIClient:
    """Toast POS API integration."""
    
    async def get_menus(self) -> List[Menu]
    async def get_sales(self, start: date, end: date) -> SalesData
    async def create_order(self, order: Order) -> OrderResult
```

### Invoice OCR Service

```python
# services/invoice_ocr_service.py
class InvoiceOCRService:
    """Invoice scanning and data extraction."""
    
    async def scan_invoice(self, image_url: str) -> InvoiceData
    async def match_to_order(self, invoice: InvoiceData) -> MatchResult
```

---

## Agent Development Guide

### Creating a New Agent

1. Create agent file in `agents/` directory:

```python
# agents/my_new_agent.py
from core.base_agent import BaseAgent, AgentContext, AgentResult

class MyNewAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="my_new_agent",
            description="Description of what this agent does"
        )
    
    async def execute(
        self, 
        context: AgentContext, 
        params: dict
    ) -> AgentResult:
        # Implementation here
        return AgentResult(
            success=True,
            action_taken="my_action",
            data={"result": "data"}
        )
```

2. Register in orchestrator:

```python
# core/orchestrator.py
from agents.my_new_agent import MyNewAgent

orchestrator.register_agent(MyNewAgent())
```

3. Add Celery task if needed:

```python
# jobs/tasks.py
@celery_app.task
def run_my_new_agent(restaurant_id: str, params: dict):
    return orchestrator.route_task(
        "my_new_agent",
        AgentContext(restaurant_id=restaurant_id),
        params
    )
```

### Best Practices

1. **Single Responsibility**: Each agent should do one thing well
2. **Idempotency**: Agents should be safe to retry
3. **Logging**: Use structured logging for debugging
4. **Error Handling**: Catch and handle errors gracefully
5. **Human Approval**: Flag actions that need human review
6. **Testing**: Write unit tests for agent logic

---

**Document Version**: 1.0  
**Created**: January 2026
