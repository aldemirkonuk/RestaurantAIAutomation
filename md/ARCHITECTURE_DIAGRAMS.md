# WineOps AI - Architecture Diagrams

**Version**: 2.6.0  
**Last Updated**: January 2026

This document contains all system architecture diagrams in Mermaid format.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Flow Architecture](#2-data-flow-architecture)
3. [Agent Orchestration Flow](#3-agent-orchestration-flow)
4. [Authentication Sequence](#4-authentication-sequence)
5. [Event Ingestion Pipeline](#5-event-ingestion-pipeline)
6. [Toast POS Integration](#6-toast-pos-integration)
7. [Frontend Component Tree](#7-frontend-component-tree)
8. [Database Entity Relationships](#8-database-entity-relationships)

---

## 1. System Overview

```mermaid
flowchart TB
    subgraph Frontend["Frontend Layer"]
        Web["React Web App"]
        Mobile["React Native Mobile"]
    end
    
    subgraph Gateway["API Gateway Layer"]
        NestJS["NestJS API Gateway"]
        WS["WebSocket Gateway"]
    end
    
    subgraph Agents["Agent Orchestrator"]
        FastAPI["FastAPI Server"]
        Orchestrator["Core Orchestrator"]
        AgentPool["17 AI Agents"]
        Celery["Celery Workers"]
    end
    
    subgraph Data["Data Layer"]
        Supabase["Supabase PostgreSQL"]
        Redis["Redis Cache"]
        RabbitMQ["RabbitMQ"]
    end
    
    subgraph External["External Services"]
        Toast["Toast POS"]
        Plivo["Plivo SMS"]
        Gmail["Gmail API"]
        Sentry["Sentry"]
    end
    
    Web --> NestJS
    Mobile --> NestJS
    Web <--> WS
    NestJS --> FastAPI
    NestJS --> Supabase
    NestJS --> Redis
    FastAPI --> Orchestrator
    Orchestrator --> AgentPool
    Orchestrator --> RabbitMQ
    FastAPI --> Celery
    FastAPI --> Supabase
    AgentPool --> Toast
    AgentPool --> Plivo
    AgentPool --> Gmail
    NestJS --> Sentry
```

---

## 2. Data Flow Architecture

```mermaid
flowchart LR
    subgraph Client["Client Layer"]
        Browser["Browser"]
        MobileApp["Mobile App"]
    end
    
    subgraph API["API Layer"]
        Gateway["NestJS Gateway"]
        Guards["Auth Guards"]
        Controllers["Controllers"]
        Services["Services"]
    end
    
    subgraph Processing["Processing Layer"]
        Orchestrator["Orchestrator"]
        Agents["AI Agents"]
        Workers["Celery Workers"]
    end
    
    subgraph Storage["Storage Layer"]
        Postgres["PostgreSQL"]
        Cache["Redis"]
        Queue["RabbitMQ"]
    end
    
    Browser --> Gateway
    MobileApp --> Gateway
    Gateway --> Guards
    Guards --> Controllers
    Controllers --> Services
    Services --> Postgres
    Services --> Cache
    Services --> Orchestrator
    Orchestrator --> Agents
    Orchestrator --> Queue
    Queue --> Workers
    Workers --> Postgres
```

---

## 3. Agent Orchestration Flow

```mermaid
flowchart TB
    subgraph Trigger["Trigger Sources"]
        API["API Request"]
        Schedule["Scheduled Job"]
        Webhook["External Webhook"]
        Event["Realtime Event"]
    end
    
    subgraph Core["Orchestrator Core"]
        Router["Task Router"]
        Validator["Input Validator"]
        Executor["Agent Executor"]
        ResultHandler["Result Handler"]
    end
    
    subgraph AgentCategories["Agent Categories"]
        subgraph Inventory["Inventory Agents"]
            InventoryEngine["InventoryEngine"]
            GhostInventory["GhostInventory"]
            Shrinkage["Shrinkage"]
            Visual["VisualVerification"]
        end
        
        subgraph Procurement["Procurement Agents"]
            ProcAgent["Procurement"]
            Recurring["RecurringOrder"]
            RFQ["RFQ"]
            Negotiation["Negotiation"]
        end
        
        subgraph Reporting["Reporting Agents"]
            Reports["Reporting"]
            Calendar["Calendar"]
            Menu["MenuAnalyzer"]
        end
        
        subgraph Other["Other Agents"]
            Compliance["Compliance"]
            Notification["Notification"]
            Sommelier["Sommelier"]
            POS["POSIntegration"]
        end
    end
    
    subgraph Output["Output Handling"]
        Database["Database Update"]
        Notification2["Send Notification"]
        Approval["Human Approval"]
        External["External API"]
    end
    
    API --> Router
    Schedule --> Router
    Webhook --> Router
    Event --> Router
    
    Router --> Validator
    Validator --> Executor
    
    Executor --> Inventory
    Executor --> Procurement
    Executor --> Reporting
    Executor --> Other
    
    Inventory --> ResultHandler
    Procurement --> ResultHandler
    Reporting --> ResultHandler
    Other --> ResultHandler
    
    ResultHandler --> Database
    ResultHandler --> Notification2
    ResultHandler --> Approval
    ResultHandler --> External
```

---

## 4. Authentication Sequence

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as NestJS Gateway
    participant AuthService
    participant JWTGuard
    participant Supabase
    
    Note over Client,Supabase: Login Flow
    Client->>Gateway: POST /api/v1/auth/login
    Gateway->>AuthService: validateUser(email, password)
    AuthService->>Supabase: Query users table
    Supabase-->>AuthService: User record
    AuthService->>AuthService: Verify password (bcrypt)
    AuthService->>AuthService: Generate JWT tokens
    AuthService-->>Gateway: {accessToken, refreshToken}
    Gateway-->>Client: 200 OK + tokens
    
    Note over Client,Supabase: Protected Request
    Client->>Gateway: GET /inventory (Bearer token)
    Gateway->>JWTGuard: Validate token
    JWTGuard->>JWTGuard: Verify signature
    JWTGuard->>JWTGuard: Check blacklist
    JWTGuard->>JWTGuard: Extract user context
    JWTGuard-->>Gateway: User authenticated
    Gateway->>Supabase: Query with tenant filter
    Supabase-->>Gateway: Data
    Gateway-->>Client: 200 OK + data
    
    Note over Client,Supabase: Token Refresh
    Client->>Gateway: POST /api/v1/auth/refresh
    Gateway->>AuthService: refreshToken(token)
    AuthService->>AuthService: Validate refresh token
    AuthService->>AuthService: Generate new access token
    AuthService-->>Gateway: {accessToken}
    Gateway-->>Client: 200 OK + new token
```

---

## 5. Event Ingestion Pipeline

```mermaid
flowchart TB
    subgraph Sources["Event Sources"]
        Dashboard["Dashboard"]
        Inventory["Inventory Page"]
        Orders["Orders Page"]
        Calendar["Calendar Page"]
    end
    
    subgraph Ingestion["Event Ingestion"]
        API["POST /events"]
        Validate["DTO Validation"]
        Idempotency["Idempotency Check"]
        Insert["Database Insert"]
    end
    
    subgraph Realtime["Realtime Distribution"]
        Supabase["Supabase Realtime"]
        Broadcast["Broadcast to Subscribers"]
    end
    
    subgraph Subscribers["Subscribed Clients"]
        Client1["Dashboard Client"]
        Client2["Inventory Client"]
        Client3["Calendar Client"]
    end
    
    subgraph ErrorHandling["Error Handling"]
        DLQ["Dead Letter Queue"]
        Retry["Retry Service"]
        Alert["Alert Ops Team"]
    end
    
    Dashboard --> API
    Inventory --> API
    Orders --> API
    Calendar --> API
    
    API --> Validate
    Validate --> Idempotency
    Idempotency -->|New Event| Insert
    Idempotency -->|Duplicate| Return["Return Existing"]
    
    Insert --> Supabase
    Insert -->|Failed| DLQ
    
    Supabase --> Broadcast
    Broadcast --> Client1
    Broadcast --> Client2
    Broadcast --> Client3
    
    DLQ --> Retry
    Retry -->|Max Retries| Alert
```

---

## 6. Toast POS Integration

```mermaid
flowchart TB
    subgraph ToastPOS["Toast POS System"]
        ToastRestaurant["Restaurant POS"]
        ToastAPI["Toast API"]
        ToastWebhook["Toast Webhooks"]
    end
    
    subgraph WineOps["WineOps System"]
        subgraph Gateway["API Gateway"]
            WebhookEndpoint["POST /toast/webhook"]
            MenuEndpoint["GET /toast/menus"]
            SalesEndpoint["GET /toast/sales"]
        end
        
        subgraph Processing["Processing"]
            HMACVerify["HMAC Verification"]
            EventProcessor["Event Processor"]
            MenuCache["Menu Cache Service"]
        end
        
        subgraph Storage["Storage"]
            MenuCacheTable["toast_menu_cache"]
            MappingsTable["toast_item_mappings"]
            InventoryTable["restaurant_inventory"]
        end
    end
    
    ToastRestaurant --> ToastAPI
    ToastAPI --> ToastWebhook
    ToastWebhook --> WebhookEndpoint
    
    WebhookEndpoint --> HMACVerify
    HMACVerify -->|Valid| EventProcessor
    HMACVerify -->|Invalid| Reject["Reject 401"]
    
    EventProcessor --> MenuCacheTable
    EventProcessor --> InventoryTable
    
    ToastAPI --> MenuEndpoint
    MenuEndpoint --> MenuCache
    MenuCache --> MenuCacheTable
    
    ToastAPI --> SalesEndpoint
    SalesEndpoint --> InventoryTable
    
    MappingsTable --> InventoryTable
```

---

## 7. Frontend Component Tree

```mermaid
flowchart TB
    subgraph App["App Root"]
        Router["React Router"]
        Providers["Context Providers"]
    end
    
    subgraph Contexts["Contexts"]
        Auth["AuthContext"]
        Theme["ThemeContext"]
        Realtime["RealtimeContext"]
        Toast["ToastContext"]
    end
    
    subgraph Layout["Layout Components"]
        Header["Header"]
        Sidebar["Sidebar"]
        MainContent["Main Content"]
    end
    
    subgraph Pages["Page Components"]
        DashboardPage["Dashboard"]
        InventoryPage["Inventory"]
        OrdersPage["Orders"]
        CalendarPage["Calendar"]
        ReportsPage["Reports"]
        NotificationsPage["Notifications"]
        ProvidersPage["Providers"]
        SettingsPage["Settings"]
    end
    
    subgraph SharedUI["Shared UI"]
        Button["Button"]
        Card["Card"]
        Input["Input"]
        Modal["Modal"]
        Table["Table"]
        Charts["Charts"]
    end
    
    Router --> Providers
    Providers --> Auth
    Providers --> Theme
    Providers --> Realtime
    Providers --> Toast
    
    Providers --> Layout
    Layout --> Header
    Layout --> Sidebar
    Layout --> MainContent
    
    MainContent --> Pages
    
    Pages --> SharedUI
```

---

## 8. Database Entity Relationships

```mermaid
erDiagram
    users ||--o{ user_restaurant_access : has
    restaurants ||--o{ user_restaurant_access : has
    restaurants ||--o{ restaurant_inventory : owns
    restaurants ||--o{ procurement_orders : creates
    restaurants ||--o{ events : generates
    restaurants ||--o{ calendar_events : schedules
    restaurants ||--o{ notifications : receives
    
    master_wine_library ||--o{ restaurant_inventory : references
    
    restaurant_inventory ||--o{ inventory_transactions : tracks
    restaurant_inventory ||--o{ procurement_order_items : orders
    
    providers ||--o{ procurement_orders : supplies
    procurement_orders ||--o{ procurement_order_items : contains
    
    events ||--o{ event_dead_letters : fails_to
    
    calendar_events ||--o{ recurrence_rules : follows
    
    users {
        uuid id PK
        string email
        string password_hash
        string name
        string role
        timestamp created_at
    }
    
    restaurants {
        uuid id PK
        string name
        string address
        string timezone
        jsonb settings
        timestamp created_at
    }
    
    user_restaurant_access {
        uuid id PK
        uuid user_id FK
        uuid restaurant_id FK
        string role
    }
    
    master_wine_library {
        uuid id PK
        string name
        string producer
        string region
        string country
        integer vintage
        string grape_variety
        string wine_type
    }
    
    restaurant_inventory {
        uuid id PK
        uuid restaurant_id FK
        uuid master_wine_id FK
        integer stock_live
        integer threshold_min
        decimal cost_per_unit
        decimal sell_price
    }
    
    inventory_transactions {
        uuid id PK
        uuid inventory_id FK
        string transaction_type
        integer quantity
        integer balance_after
        string source
        timestamp created_at
    }
    
    providers {
        uuid id PK
        uuid restaurant_id FK
        string name
        string contact_email
        string contact_phone
        jsonb delivery_schedule
    }
    
    procurement_orders {
        uuid id PK
        uuid restaurant_id FK
        uuid provider_id FK
        string status
        decimal total_amount
        timestamp order_date
    }
    
    events {
        uuid id PK
        uuid restaurant_id FK
        string event_type
        string source_page
        jsonb payload
        string idempotency_key
        timestamp created_at
    }
    
    calendar_events {
        uuid id PK
        uuid restaurant_id FK
        string title
        string event_type
        timestamp start_time
        timestamp end_time
        uuid recurrence_rule_id FK
    }
```

---

## 9. Deployment Architecture

```mermaid
flowchart TB
    subgraph Cloud["Cloud Infrastructure"]
        subgraph Frontend["Frontend Tier"]
            CDN["CDN / Vercel"]
            StaticAssets["Static Assets"]
        end
        
        subgraph Backend["Backend Tier"]
            LB["Load Balancer"]
            API1["API Instance 1"]
            API2["API Instance 2"]
            WS1["WebSocket 1"]
            WS2["WebSocket 2"]
        end
        
        subgraph Agents["Agent Tier"]
            FastAPI1["FastAPI 1"]
            FastAPI2["FastAPI 2"]
            Worker1["Celery Worker 1"]
            Worker2["Celery Worker 2"]
        end
        
        subgraph Data["Data Tier"]
            Supabase["Supabase Cloud"]
            Redis["Redis Cluster"]
            RabbitMQ["RabbitMQ"]
        end
    end
    
    subgraph External["External"]
        ToastPOS["Toast POS"]
        Plivo["Plivo"]
        Gmail["Gmail"]
        Sentry["Sentry"]
    end
    
    CDN --> StaticAssets
    CDN --> LB
    
    LB --> API1
    LB --> API2
    LB --> WS1
    LB --> WS2
    
    API1 --> Supabase
    API2 --> Supabase
    API1 --> Redis
    API2 --> Redis
    
    API1 --> FastAPI1
    API2 --> FastAPI2
    
    FastAPI1 --> RabbitMQ
    FastAPI2 --> RabbitMQ
    RabbitMQ --> Worker1
    RabbitMQ --> Worker2
    
    Worker1 --> Supabase
    Worker2 --> Supabase
    
    FastAPI1 --> ToastPOS
    FastAPI2 --> Plivo
    Worker1 --> Gmail
    API1 --> Sentry
```

---

## 10. Human-in-the-Loop Workflow

```mermaid
flowchart TB
    subgraph Trigger["Trigger"]
        LowStock["Low Stock Alert"]
        PriceChange["Price Change"]
        Delivery["Delivery Arrival"]
        Discrepancy["Inventory Discrepancy"]
    end
    
    subgraph AIProcessing["AI Processing"]
        Agent["Relevant Agent"]
        Analysis["Analyze Situation"]
        Recommendation["Generate Recommendation"]
    end
    
    subgraph Approval["Human Approval"]
        Notification["Send Notification"]
        OneTap["One-Tap Action"]
        Review["Manager Review"]
        Decision["Approve/Reject/Modify"]
    end
    
    subgraph Execution["Execution"]
        Execute["Execute Action"]
        Database["Update Database"]
        External["External Actions"]
        Audit["Audit Log"]
    end
    
    LowStock --> Agent
    PriceChange --> Agent
    Delivery --> Agent
    Discrepancy --> Agent
    
    Agent --> Analysis
    Analysis --> Recommendation
    
    Recommendation --> Notification
    Notification --> OneTap
    OneTap --> Review
    Review --> Decision
    
    Decision -->|Approved| Execute
    Decision -->|Rejected| Log["Log Rejection"]
    Decision -->|Modified| Modify["Apply Modifications"]
    Modify --> Execute
    
    Execute --> Database
    Execute --> External
    Execute --> Audit
```

---

**Document Version**: 1.0  
**Created**: January 2026  
**Diagrams**: Mermaid format (compatible with GitHub, Notion, Obsidian)
