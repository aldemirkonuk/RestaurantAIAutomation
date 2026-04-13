# WineOps AI - Project Structure

```
wineops-ai/
├── README.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── pyproject.toml                    # Python dependencies (Poetry)
├── package.json                      # Node/React dependencies
│
├── backend/                          # FastAPI Backend
│   ├── __init__.py
│   ├── main.py                       # FastAPI app entry
│   ├── config.py                     # Environment config
│   ├── requirements.txt
│   │
│   ├── agents/                       # Autonomous Agent Microservices
│   │   ├── __init__.py
│   │   ├── orchestrator.py           # Central Orchestrator Agent
│   │   ├── pos_ingestion_agent.py
│   │   ├── inventory_engine_agent.py
│   │   ├── alert_buffer_agent.py
│   │   ├── procurement_ai_agent.py
│   │   ├── visual_verification_agent.py
│   │   ├── reporting_agent.py
│   │   ├── sync_engine_agent.py
│   │   ├── sommelier_ai_agent.py
│   │   ├── menu_analyzer_agent.py
│   │   └── self_improving_agent.py
│   │
│   ├── core/                         # Core System Components
│   │   ├── __init__.py
│   │   ├── message_queue.py          # RabbitMQ wrapper
│   │   ├── database.py               # Supabase client
│   │   ├── llm_engine.py             # Gemini Pro + fallbacks
│   │   ├── embeddings.py             # Local sentence-transformers
│   │   ├── websocket_manager.py      # WebSocket connections
│   │   └── auth.py                   # JWT + SSO
│   │
│   ├── models/                       # Data Models (Pydantic)
│   │   ├── __init__.py
│   │   ├── wine.py
│   │   ├── inventory.py
│   │   ├── order.py
│   │   ├── supplier.py
│   │   ├── restaurant.py
│   │   └── events.py
│   │
│   ├── services/                     # Business Logic
│   │   ├── __init__.py
│   │   ├── pos_service.py            # Toast API integration
│   │   ├── inventory_service.py
│   │   ├── procurement_service.py
│   │   ├── notification_service.py   # Twilio, WhatsApp, Email
│   │   ├── vision_service.py         # YOLOv8 + Tesseract
│   │   └── reporting_service.py
│   │
│   ├── api/                          # REST API Routes
│   │   ├── __init__.py
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── inventory.py
│   │   │   ├── orders.py
│   │   │   ├── suppliers.py
│   │   │   ├── reports.py
│   │   │   ├── notifications.py
│   │   │   └── webhooks.py           # POS webhooks
│   │
│   ├── ml/                           # Machine Learning
│   │   ├── __init__.py
│   │   ├── yolov8_detector.py
│   │   ├── ocr_processor.py
│   │   ├── embeddings_generator.py
│   │   └── models/
│   │       └── wine_label_yolo.pt
│   │
│   ├── utils/                        # Utilities
│   │   ├── __init__.py
│   │   ├── logger.py
│   │   ├── validators.py
│   │   ├── helpers.py
│   │   └── constants.py
│   │
│   └── tests/                        # Backend Tests
│       ├── __init__.py
│       ├── test_agents.py
│       ├── test_services.py
│       └── test_api.py
│
├── frontend/                         # React Frontend
│   ├── public/
│   │   ├── index.html
│   │   ├── favicon.ico
│   │   └── fonts/
│   │       └── RobinhoodPhonic.woff2
│   │
│   ├── src/
│   │   ├── main.tsx                  # Entry point
│   │   ├── App.tsx
│   │   ├── index.css
│   │   │
│   │   ├── components/               # Reusable Components
│   │   │   ├── ui/                   # shadcn/ui components
│   │   │   │   ├── button.tsx
│   │   │   │   ├── card.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   ├── toast.tsx
│   │   │   │   └── ...
│   │   │   │
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── GlassCard.tsx     # Glassmorphism wrapper
│   │   │   │   └── TabNavigation.tsx
│   │   │   │
│   │   │   ├── inventory/
│   │   │   │   ├── InventoryGrid.tsx
│   │   │   │   ├── StockCard.tsx
│   │   │   │   ├── LowStockAlert.tsx
│   │   │   │   └── HeatMap.tsx       # Tradezella-style
│   │   │   │
│   │   │   ├── dashboard/
│   │   │   │   ├── WeekView.tsx      # Tradezella-inspired
│   │   │   │   ├── PieCharts.tsx
│   │   │   │   ├── MetricsCards.tsx
│   │   │   │   └── RealtimeFeed.tsx
│   │   │   │
│   │   │   ├── approvals/
│   │   │   │   ├── OneTapApproval.tsx
│   │   │   │   ├── OrderConfirm.tsx
│   │   │   │   ├── PriceReview.tsx
│   │   │   │   └── InequalityFix.tsx
│   │   │   │
│   │   │   ├── reports/
│   │   │   │   ├── ReportGenerator.tsx
│   │   │   │   ├── TimeWindowConfig.tsx
│   │   │   │   └── ExportOptions.tsx
│   │   │   │
│   │   │   ├── calendar/
│   │   │   │   ├── EventCalendar.tsx
│   │   │   │   ├── ReminderList.tsx
│   │   │   │   └── SupplierEvents.tsx
│   │   │   │
│   │   │   └── camera/
│   │   │       ├── MenuScanner.tsx
│   │   │       ├── LabelScanner.tsx
│   │   │       └── InvoiceScanner.tsx
│   │   │
│   │   ├── pages/                    # Page Components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Inventory.tsx
│   │   │   ├── Orders.tsx
│   │   │   ├── Suppliers.tsx
│   │   │   ├── Reports.tsx
│   │   │   ├── Calendar.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── AuditLogs.tsx
│   │   │
│   │   ├── hooks/                    # Custom React Hooks
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useRealtimeInventory.ts
│   │   │   ├── useNotifications.ts
│   │   │   └── useAgents.ts
│   │   │
│   │   ├── stores/                   # Zustand Stores
│   │   │   ├── inventoryStore.ts
│   │   │   ├── ordersStore.ts
│   │   │   ├── notificationsStore.ts
│   │   │   └── authStore.ts
│   │   │
│   │   ├── services/                 # API Services
│   │   │   ├── api.ts                # Axios instance
│   │   │   ├── inventoryApi.ts
│   │   │   ├── ordersApi.ts
│   │   │   ├── reportsApi.ts
│   │   │   └── websocket.ts
│   │   │
│   │   ├── utils/                    # Frontend Utilities
│   │   │   ├── formatters.ts
│   │   │   ├── validators.ts
│   │   │   └── constants.ts
│   │   │
│   │   ├── styles/                   # Global Styles
│   │   │   ├── glassmorphism.css
│   │   │   ├── animations.css
│   │   │   └── themes.css
│   │   │
│   │   └── types/                    # TypeScript Types
│   │       ├── wine.ts
│   │       ├── inventory.ts
│   │       ├── order.ts
│   │       └── api.ts
│   │
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── postcss.config.js
│
├── mobile/                           # React Native (Future)
│   ├── ios/
│   ├── android/
│   └── src/
│       ├── screens/
│       │   ├── Approvals.tsx         # One-tap approval screen
│       │   ├── Camera.tsx
│       │   └── Notifications.tsx
│       └── ...
│
├── database/                         # Database Schemas & Migrations
│   ├── supabase/
│   │   ├── migrations/
│   │   │   ├── 001_master_wine_library.sql
│   │   │   ├── 002_restaurant_inventory.sql
│   │   │   ├── 003_suppliers.sql
│   │   │   ├── 004_orders.sql
│   │   │   ├── 005_sales_events.sql
│   │   │   ├── 006_negotiations.sql
│   │   │   ├── 007_audit_logs.sql
│   │   │   └── 008_vector_embeddings.sql
│   │   │
│   │   ├── seed_data/
│   │   │   ├── master_wines.jsonl
│   │   │   └── test_restaurants.sql
│   │   │
│   │   └── functions/                # Postgres Functions
│   │       ├── calculate_cogs.sql
│   │       ├── detect_inequality.sql
│   │       └── similarity_search.sql
│   │
│   └── schemas/                      # Schema Documentation
│       ├── master_library.md
│       ├── restaurant_inventory.md
│       └── erd_diagram.png
│
├── ml_models/                        # Pre-trained Models
│   ├── yolov8/
│   │   └── wine_label_detector.pt
│   ├── embeddings/
│   │   └── all-MiniLM-L6-v2/
│   └── download_models.sh
│
├── scripts/                          # Utility Scripts
│   ├── setup_env.sh
│   ├── seed_database.py
│   ├── deploy.sh
│   └── backup.sh
│
├── docs/                             # Documentation
│   ├── API.md
│   ├── AGENTS.md
│   ├── DEPLOYMENT.md
│   ├── ARCHITECTURE.md
│   └── USER_GUIDE.md
│
├── infra/                            # Infrastructure as Code
│   ├── docker/
│   │   ├── Dockerfile.backend
│   │   ├── Dockerfile.frontend
│   │   └── Dockerfile.agents
│   │
│   ├── kubernetes/                   # K8s configs (future)
│   │   ├── backend-deployment.yaml
│   │   └── agents-deployment.yaml
│   │
│   └── terraform/                    # Cloud infrastructure (future)
│       └── aws/
│
└── .github/                          # CI/CD
    └── workflows/
        ├── ci.yml                    # Continuous Integration
        ├── cd.yml                    # Continuous Deployment
        └── tests.yml                 # Automated Testing
```

## Key Architecture Decisions

### Backend Structure
- **Agents as Microservices**: Each agent is independent, communicates via RabbitMQ
- **FastAPI**: Async Python for high performance
- **Pydantic Models**: Type-safe data validation
- **Service Layer**: Business logic separated from API routes

### Frontend Structure
- **Component-driven**: Reusable UI components
- **Glassmorphism Design**: Custom CSS + Tailwind utilities
- **Zustand**: Lightweight state management
- **shadcn/ui**: Beautiful, accessible components

### Database Schema
- **Multi-tenant**: Isolated per restaurant
- **Master Library**: Global wine catalog
- **Vector Embeddings**: Semantic search
- **Audit Logs**: 7-year retention for compliance

### Communication Flow
- **REST API**: Standard CRUD operations
- **WebSockets**: Real-time updates
- **RabbitMQ**: Agent-to-agent messaging
- **Webhooks**: POS integration

## Next Steps
1. Initialize project structure
2. Setup Docker Compose for local development
3. Create database schemas
4. Implement central orchestrator
5. Build individual agents
6. Create React frontend with glassmorphism
7. Integrate all components

