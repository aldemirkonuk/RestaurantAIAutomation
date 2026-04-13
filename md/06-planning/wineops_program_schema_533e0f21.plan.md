---
name: WineOps Program Schema
overview: Create a comprehensive program schema with architecture diagrams, data flow visualizations, and system documentation for the WineOps AI Restaurant Automation system, saved to md_files/.
todos:
  - id: program-schema
    content: Create PROGRAM_SCHEMA.md with complete system architecture, tech stack, and module breakdown
    status: in_progress
  - id: architecture-diagrams
    content: Create ARCHITECTURE_DIAGRAMS.md with Mermaid diagrams for all system flows
    status: pending
  - id: api-reference
    content: Create API_REFERENCE.md documenting all 60+ endpoints by module
    status: pending
  - id: database-overview
    content: Create DATABASE_OVERVIEW.md with table schemas and relationships
    status: pending
  - id: agent-catalog
    content: Create AGENT_CATALOG.md documenting all 17 Python agents
    status: pending
isProject: false
---

**File:** `wineops_program_schema_533e0f21.plan.md`  
**Purpose:** Root plan for the WineOps AI program schema initiative.  
**Description:** This plan defines the creation of a comprehensive program schema and system documentation for the WineOps AI Restaurant Automation platform. It specifies five deliverables (PROGRAM_SCHEMA, ARCHITECTURE_DIAGRAMS, API_REFERENCE, DATABASE_OVERVIEW, AGENT_CATALOG), the technology stack, and a high-level system architecture overview. Use this as the original reference for the schema effort; the master plan and sub-plans expand it with detailed execution and structure.

---

# WineOps AI - Comprehensive Program Schema and Documentation

## Project Summary

WineOps AI is a production-ready (v2.6.0) restaurant wine inventory and procurement automation platform. The system crashed due to heavy C++ package downloads, and workspace storage was deleted. This documentation reconstructs the complete system architecture.

---

## System Architecture Overview

```mermaid
flowchart TB
    subgraph Frontend["Frontend Layer"]
        Web["React Web App<br/>16 Pages"]
        Mobile["React Native<br/>Mobile App"]
    end
    
    subgraph Gateway["API Gateway Layer"]
        NestJS["NestJS API Gateway<br/>21 Modules | 60+ Endpoints"]
        WS["WebSocket Gateway<br/>Real-time Events"]
    end
    
    subgraph Agents["Agent Orchestrator Layer"]
        FastAPI["FastAPI Server"]
        Orchestrator["Core Orchestrator"]
        AgentPool["17 AI Agents"]
        Celery["Celery Workers"]
    end
    
    subgraph Data["Data Layer"]
        Supabase["Supabase PostgreSQL<br/>30+ Tables"]
        Redis["Redis Cache"]
        RabbitMQ["RabbitMQ<br/>Message Bus"]
    end
    
    subgraph External["External Integrations"]
        Toast["Toast POS API"]
        Plivo["Plivo SMS/Voice"]
        Gmail["Gmail API"]
        Sentry["Sentry Monitoring"]
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

## Key Files to Create

### 1. PROGRAM_SCHEMA.md

Complete system architecture with:

- Technology stack breakdown
- All 21 NestJS modules and their endpoints
- All 17 Python agents and their purposes
- Database schema overview (30+ tables)
- Authentication flow
- Real-time event system

### 2. ARCHITECTURE_DIAGRAMS.md

Mermaid diagrams for:

- System overview (above)
- Data flow (frontend to database)
- Agent orchestration flow
- Authentication sequence
- Event ingestion pipeline
- Toast POS integration

### 3. API_REFERENCE.md

All 60+ API endpoints grouped by module:

- Auth, Dashboard, Inventory, Procurement
- Reports, Toast, Calendar, Events
- Providers, Notifications, Communications

### 4. DATABASE_OVERVIEW.md

Tables and relationships:

- Core tables (users, restaurants, inventory)
- Event system (events, dead_letters, replay_jobs)
- Integrations (toast_*, provider_*)

---

## Technology Stack

| Layer | Technology | Purpose |

|-------|------------|---------|

| Frontend | React 18 + TypeScript | Web UI |

| Frontend | Tailwind + Framer Motion | Styling/Animation |

| API Gateway | NestJS + TypeScript | REST API |

| Agents | FastAPI + Python | AI Orchestration |

| Database | Supabase PostgreSQL | Persistence |

| Cache | Redis | Performance |

| Queue | RabbitMQ + Celery | Background Jobs |

| POS | Toast API | Restaurant Integration |

| Comms | Plivo + Gmail | SMS/Email |

---

## Deliverables

All files will be saved to:

`/Restaurant AI Automation/md_files/`

1. `PROGRAM_SCHEMA.md` - Complete system documentation
2. `ARCHITECTURE_DIAGRAMS.md` - Visual architecture
3. `API_REFERENCE.md` - All endpoints documented
4. `DATABASE_OVERVIEW.md` - Schema documentation
5. `AGENT_CATALOG.md` - All 17 agents documented
