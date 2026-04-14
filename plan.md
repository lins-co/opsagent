# EMO Ops Intelligence Layer

## From Reactive to Predictive — Master Execution Plan

**Version:** 3.0
**Date:** 2026-03-30
**Lead:** AI-native ops intelligence build
**Starting point:** Single-agent EV fleet query bot (Node.js/TypeScript/Express/MongoDB)
**End state:** Organization-wide operational intelligence platform — multi-agent, multi-channel, predictive

**Timeline:**
- **3 weeks** to baseline integration (target: 2026-04-20)
- **90 days** to mature system (target: 2026-06-28)

---

## Table of Contents

1. [The Problem We're Solving](#1-the-problem-were-solving)
2. [Current State Audit](#2-current-state-audit)
3. [Target Architecture](#3-target-architecture)
4. [Platform Architecture (V3 Additions)](#platform-architecture-v3-additions)
5. [Data Streams & Unified Schema](#4-data-streams--unified-schema)
6. [Week 1 — Data Consolidation & Structure](#week-1--data-consolidation--structure)
7. [Week 2 — AI Intelligence Layer (4 Agents)](#week-2--ai-intelligence-layer-4-agents)
8. [Week 3 — Executive Ops Dashboards & AI Reports](#week-3--executive-ops-dashboards--ai-reports)
9. [Days 22–60 — Maturation Phase](#days-2260--maturation-phase)
10. [Days 61–90 — Operational Autonomy](#days-6190--operational-autonomy)
11. [Mandatory Rules](#mandatory-rules)
12. [Key Metrics (60–90 Day Targets)](#key-metrics-6090-day-targets)
13. [Technical Implementation Details](#technical-implementation-details)
14. [Risk Register](#risk-register)

**Full PostgreSQL Schema:** 20 tables total (Neon PostgreSQL — `ep-old-tooth-a1gga0gk-pooler.ap-southeast-1.aws.neon.tech`)
- **Ops Intelligence (9):** fleet_health, battery_risk, complaints, service_logs, firmware_map, vehicle_pack_map, anomaly_log, ops_reports
- **Enterprise Backbone (11+):** org_nodes, roles, users, audit_logs, conversations, messages, bookmarks, kpi_definitions, kpi_snapshots, alert_rules, alert_history, query_cache, scheduled_reports, csv_uploads

---

## 1. The Problem We're Solving

Today EMO operates reactively:

```
Rider complains → Field team investigates → Root cause found (maybe) → Fix applied → Repeat
```

This costs time, money, vehicles, and rider trust. We see problems **after** they happen.

The Ops Intelligence Layer flips this:

```
Telemetry anomaly detected → Correlated with firmware/batch/location →
Risk scored automatically → Escalation triggered BEFORE rider feels it
```

**What this system will do:**

1. **Detect fleet risk early** — abnormal idle, excessive faults, misuse signals
2. **Flag battery health degradation patterns** — SoH slopes, firmware correlation, batch heatmaps
3. **Cluster rider complaints** — recurring categories, vehicle/region clusters, telemetry correlation
4. **Correlate telemetry + firmware + batch data** — find the "why" behind the "what"
5. **Produce weekly AI-generated Ops Health Reports** — top risks, instability signals, escalation recommendations

---

## 2. Current State Audit

### What exists today

```
ops-agent/
  src/
    server.ts              # Express server, 4 endpoints, no auth (157 lines)
    agent/
      ops-agent.ts         # LLM orchestration + tools + sessions (878 lines)
      local-engine.ts      # Pattern matcher: ~100 regex patterns (1046 lines)
      schema.ts            # Data schema discovery for LLM context (88 lines)
    db/
      mongo.ts             # MongoDB connection + in-memory cache (111 lines)
  public/
    index.html             # Chat UI with autocomplete (1074 lines)
  package.json             # 7 runtime deps
```

### Current tech stack

| Component | Technology | Version |
|---|---|---|
| Runtime | Node.js + TypeScript (ESM) | — |
| Framework | Express | 5.2.1 |
| Database | MongoDB Atlas | 7.1.0 |
| Primary LLM | Anthropic Claude Haiku 4.5 | SDK 0.78 |
| Fallback LLM | Google Gemini 2.0 Flash | SDK 0.24 |
| Frontend | Vanilla HTML/CSS/JS | — |

### Current MongoDB collections (6)

| Collection | What it holds | Records |
|---|---|---|
| `Vehicletracker` | Vehicle status, location, vendor, rider info | Loaded at startup |
| `Newcomplaintresponses` | Rider complaints | Loaded at startup |
| `Vehiclereturnresponses` | Vehicle returns | Loaded at startup |
| `Deployementresponses` | Vehicle deployments | Loaded at startup |
| `Rentingdatabase` | Rentals, payments, collections (nested) | Loaded at startup |
| `Complaindatabase` | Battery/technical complaints | Loaded at startup |

### What's usable vs what's missing

| Have | Don't Have |
|---|---|
| Vehicle status tracking | Intellicar telemetry (fault codes, idle time, ride duration) |
| Rider complaints (basic) | EMO IoT data (pack-level telemetry, charge cycles, temp, DCIR) |
| Battery complaints (basic) | SENS analytics (SoH, degradation slope, risk flags) |
| Deployments + returns | Field service logs (repair type, parts replaced, root cause) |
| Rental/payment data | Firmware version mapping |
| Chat query interface | Batch ID tracking |
| LLM with tool-calling | Automated anomaly detection |
| Local pattern matching | Correlation engine |
| — | Scheduled intelligence reports |

**The gap is clear:** We have operational data but no intelligence pipeline. We have complaints but no correlation. We have battery data but no degradation tracking.

---

## 3. Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  ENTERPRISE AUTH & ACCESS LAYER                    │
│                                                                  │
│  org_nodes (hierarchy) → roles → users → JWT tokens              │
│  RBAC: CEO sees all ─ VP sees division ─ Manager sees city       │
│  Audit log on every action ─ Chat history persisted              │
│  KPI tracking ─ Alert rules ─ Query cache                        │
└──────────────────────────────┬───────────────────────────────────┘
                               │ Bearer token on every request
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     DATA INGESTION LAYER                         │
│                                                                  │
│  Intellicar API ──┐                                              │
│  EMO IoT Feed ────┤                                              │
│  SENS Analytics ──┤──→ ETL Pipeline ──→ Unified Ops DB           │
│  Rider Complaints ┤     (daily cron)     (PostgreSQL, 20 tables) │
│  Field Service ───┘                                              │
│                                                                  │
│  Linking Keys: Vehicle ID ←→ Pack ID ←→ Firmware ←→ Batch ID    │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                    AI INTELLIGENCE LAYER                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Fleet        │  │ Battery      │  │ Complaint    │           │
│  │ Anomaly      │  │ Degradation  │  │ Correlation  │           │
│  │ Agent        │  │ Agent        │  │ Agent        │           │
│  │              │  │              │  │              │           │
│  │ Daily        │  │ Weekly       │  │ Weekly       │           │
│  │ anomaly list │  │ risk report  │  │ intelligence │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                    │
│         │    ┌────────────┴──┐              │                    │
│         │    │ Service Root  │              │                    │
│         │    │ Cause Agent   │              │                    │
│         │    │               │              │                    │
│         │    │ Recurring     │              │                    │
│         │    │ failure summ. │              │                    │
│         │    └──────┬────────┘              │                    │
│         │           │                      │                    │
│         └───────────┼──────────────────────┘                    │
│                     │                                            │
│                     ▼                                            │
│         ┌───────────────────────┐                                │
│         │ Executive Ops Report  │                                │
│         │ Generator             │                                │
│         │                       │                                │
│         │ Weekly narrative:     │                                │
│         │ - Top 5 fleet risks   │                                │
│         │ - Top 5 battery risks │                                │
│         │ - Instability signals │                                │
│         │ - Escalations         │                                │
│         └───────────┬───────────┘                                │
└─────────────────────┼────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                    OUTPUT LAYER                                   │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │ Fleet       │  │ Battery     │  │ Complaint & Service      │ │
│  │ Stability   │  │ Health      │  │ Dashboard                │ │
│  │ Dashboard   │  │ Dashboard   │  │                          │ │
│  └─────────────┘  └─────────────┘  └──────────────────────────┘ │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │ KPI         │  │ Chat UI     │  │ Multi-channel delivery   │ │
│  │ Dashboards  │  │ + History   │  │ Email / WhatsApp / Slack │ │
│  │             │  │ + Bookmarks │  │ Notion integration       │ │
│  └─────────────┘  └─────────────┘  └──────────────────────────┘ │
│                                                                  │
│  All data scoped by user's org hierarchy position                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Platform Architecture (V3 Additions)

> Added 2026-03-30. These requirements apply across the entire build.

### Separated Frontend — React + Vite

The frontend is a **standalone React + Vite SPA**, fully decoupled from the Express backend. Communication is API-only (REST + WebSocket for real-time chat).

**Design language:** Inspired by Cursor's website — clean, dark theme, minimal chrome, professional typography, smooth transitions. The UI should feel like a premium developer tool, not an admin panel.

**Frontend tech stack:**

| Layer | Technology | Why |
|---|---|---|
| Framework | React 19 + Vite 6 | Fast builds, modern DX, no SSR needed |
| Routing | React Router v7 | Client-side routing |
| State | Zustand + TanStack Query | Lightweight global state + server state cache |
| Styling | Tailwind CSS 4 + shadcn/ui | Utility-first, Cursor-like component library |
| Charts | Recharts or Tremor | Dashboard visualizations |
| Chat UI | Custom (WebSocket) | Real-time streaming responses |
| File upload | react-dropzone | CSV upload in chat |
| Auth | JWT (stored in httpOnly cookie) | Secure, works with backend auth |
| Build | Vite → static deploy | Can be hosted on Vercel/Cloudflare/Nginx |

**Frontend directory structure:**

```
client/
  src/
    app/
      routes/                    # Page routes
        login.tsx
        dashboard/
          fleet.tsx              # Fleet Stability Dashboard
          battery.tsx            # Battery Health Dashboard
          complaints.tsx         # Complaint & Service Dashboard
        chat/
          index.tsx              # Main chat interface
          [conversationId].tsx   # Conversation view
        reports/
          index.tsx              # Scheduled reports list
          schedule.tsx           # Create/edit report schedule
        settings/
          profile.tsx
          team.tsx               # Admin: user management
    components/
      ui/                        # shadcn/ui components (button, input, card, etc.)
      chat/
        ChatWindow.tsx           # Main chat container with streaming
        MessageBubble.tsx        # Individual message (supports markdown, tables, charts)
        CSVAttachment.tsx        # CSV file drop zone + preview
        ScheduleReportDialog.tsx # Schedule a report from chat
      dashboard/
        FleetStabilityBoard.tsx
        BatteryHealthBoard.tsx
        ComplaintServiceBoard.tsx
        KPICard.tsx
        AnomalyTable.tsx
        RiskHeatmap.tsx
      layout/
        Sidebar.tsx              # Navigation + conversation history
        TopBar.tsx               # User profile, org context, search
        CommandPalette.tsx       # Cmd+K quick actions (Cursor-style)
    hooks/
      useAuth.ts
      useChat.ts                 # WebSocket chat hook with streaming
      useConversations.ts
      useDashboard.ts
    lib/
      api.ts                     # Axios/fetch wrapper with auth headers
      ws.ts                      # WebSocket client
      csv.ts                     # CSV parsing/preview utilities
    stores/
      auth.store.ts
      chat.store.ts
      ui.store.ts
  public/
  index.html
  vite.config.ts
  tailwind.config.ts
  package.json
```

**Key UI features:**

1. **Command palette (Cmd+K)** — quick access to any action: search conversations, jump to dashboard, schedule report, switch org context
2. **Streaming chat** — responses stream token-by-token via WebSocket, with markdown/table/chart rendering in real-time
3. **CSV attachment in chat** — drag-and-drop CSV files into chat. System shows a preview table, stores the file, and the LLM queries the stored CSV (never raw content in prompt)
4. **Conversation sidebar** — full chat history, searchable, pinnable, with timestamps
5. **Dashboard views** — 3 dashboards with interactive charts, click-to-drill-down, time range selectors
6. **Report scheduler UI** — users pick report type, data scope, schedule (daily/weekly/custom cron), delivery method
7. **Dark/light mode** — default dark, toggle available
8. **Mobile responsive** — works on tablets for field team

---

### Multi-Agent Architecture — LangChain + LangGraph

Replace the current single-agent (`ops-agent.ts` + `local-engine.ts`) with a **LangGraph state machine** that routes queries to specialized agents.

**Backend agent tech stack:**

| Layer | Technology | Why |
|---|---|---|
| Orchestration | LangGraph.js | Stateful multi-agent graphs with cycles, branching, human-in-the-loop |
| Agent framework | LangChain.js | Tool-calling, prompt management, LLM abstraction |
| Primary LLM | Claude Sonnet 4.6 | Intelligence agents (reasoning quality) |
| Fast LLM | Claude Haiku 4.5 | Routing, classification, simple lookups |
| Fallback LLM | Gemini 2.0 Flash | Backup if Anthropic is down |
| Vector store | pgvector (in Neon) | Future: semantic search over reports/conversations |

**LangGraph agent topology:**

```
                    ┌─────────────────┐
                    │   Router Agent   │  ← Classifies intent, routes to specialist
                    │   (Haiku 4.5)   │
                    └────────┬────────┘
                             │
          ┌──────────┬───────┼───────┬──────────┬──────────┐
          ▼          ▼       ▼       ▼          ▼          ▼
    ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
    │ Fleet    │ │Battery │ │Complnt │ │ Service  │ │ General  │
    │ Agent    │ │ Agent  │ │ Agent  │ │ Agent    │ │ Query    │
    │(Sonnet)  │ │(Sonnet)│ │(Sonnet)│ │(Sonnet)  │ │ Agent    │
    └────┬─────┘ └───┬────┘ └───┬────┘ └────┬─────┘ │(Haiku)  │
         │           │          │            │       └────┬─────┘
         │           │          │            │            │
         └───────────┴──────────┴────────────┴────────────┘
                             │
                    ┌────────▼────────┐
                    │  CSV Query      │  ← Activated when user attaches CSV
                    │  Agent (Sonnet) │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Report         │  ← Synthesizes multi-agent outputs
                    │  Generator      │
                    │  (Sonnet)       │
                    └─────────────────┘
```

**LangGraph state schema:**

```typescript
interface AgentState {
  messages: BaseMessage[];
  currentAgent: string;
  userId: string;
  orgScope: string[];          // Allowed locations from RBAC
  csvContext?: {
    fileId: string;            // Reference to stored CSV
    fileName: string;
    schema: ColumnDef[];       // Parsed column names + types
    rowCount: number;
  };
  toolResults: Record<string, any>;
  reportSchedule?: {
    type: string;
    cron: string;
    dataScope: string;
  };
}
```

**New backend directory structure (replaces existing agent/):**

```
src/
  agents/
    graph/
      index.ts                   # Main LangGraph definition
      nodes/
        router.ts                # Intent classification → route to agent
        fleet-agent.ts           # Fleet health queries + anomaly detection
        battery-agent.ts         # Battery risk queries + degradation analysis
        complaint-agent.ts       # Complaint correlation + clustering
        service-agent.ts         # Service root cause + MTTR analysis
        general-agent.ts         # Ad-hoc queries (existing local-engine + LLM)
        csv-agent.ts             # Parse + query user-uploaded CSVs
        report-agent.ts          # Generate + schedule reports
      edges/
        routing.ts               # Conditional edges based on intent
        escalation.ts            # Cross-agent escalation logic
      state.ts                   # AgentState type definition
    intelligence/
      fleet-anomaly.ts           # Scheduled: daily fleet anomaly detection
      battery-degradation.ts     # Scheduled: weekly battery risk report
      complaint-correlation.ts   # Scheduled: weekly complaint intelligence
      service-root-cause.ts      # Scheduled: weekly service analysis
      executive-report.ts        # Scheduled: weekly ops health narrative
      scheduler.ts               # Cron orchestrator
    tools/
      db-query.ts                # Query any connected database
      csv-query.ts               # Query stored CSV files
      anomaly-lookup.ts          # Look up anomaly_log
      report-lookup.ts           # Look up ops_reports
      vehicle-360.ts             # Full vehicle cross-stream lookup
      kpi-compute.ts             # Compute KPI on demand
  local-engine.ts                # Keep existing pattern matcher as a tool
```

---

### Pluggable Database Architecture

The backend abstracts all database connections behind a **registry pattern**. Adding a new database = registering a connector, no code rewiring.

```typescript
// src/db/registry.ts

interface DatabaseConnector {
  name: string;
  type: "postgres" | "mongodb" | "mysql" | "csv";
  query(sql: string, params?: any[]): Promise<any>;
  healthCheck(): Promise<boolean>;
  getSchema(): Promise<TableSchema[]>;
}

class DatabaseRegistry {
  private connectors = new Map<string, DatabaseConnector>();

  register(connector: DatabaseConnector): void { ... }
  get(name: string): DatabaseConnector { ... }
  listAll(): ConnectorInfo[] { ... }
  queryAny(connectorName: string, query: string): Promise<any> { ... }
}

// Usage:
registry.register(new PostgresConnector("neon-primary", process.env.DATABASE_URL));
registry.register(new MongoConnector("atlas-ops", process.env.MONGO_URI));
// Future:
registry.register(new PostgresConnector("analytics-db", process.env.ANALYTICS_DB_URL));
registry.register(new MySQLConnector("legacy-erp", process.env.ERP_DB_URL));
```

The LLM agents use the registry to discover and query any connected database — the system is self-describing.

---

### CSV Upload & Query in Chat

Users can attach CSV files in the chat interface. The system:

1. **Stores the CSV** to disk/S3 (never loads full content into LLM context)
2. **Parses schema** — column names, types, row count
3. **Registers as a temporary data source** in the database registry
4. **LLM queries it** via a CSV Query Agent tool (DuckDB in-process or load into a temp Postgres table)
5. **Results rendered** as tables/charts in the chat UI

```sql
-- csv_uploads table
CREATE TABLE csv_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  file_name       TEXT NOT NULL,
  file_path       TEXT NOT NULL,           -- Local/S3 path
  file_size_bytes BIGINT NOT NULL,
  column_schema   JSONB NOT NULL,          -- [{"name": "col1", "type": "text"}, ...]
  row_count       INT NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ             -- Auto-cleanup
);
```

---

### Scheduled Reports (User-Defined)

Users can schedule any report to run at a specific time and receive it via their preferred channel.

```sql
-- scheduled_reports table
CREATE TABLE scheduled_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,                     -- "My weekly fleet summary"
  report_type     TEXT NOT NULL,                     -- "fleet_health", "battery_risk", "custom_query"
  prompt          TEXT,                              -- Custom prompt if type = "custom_query"
  data_scope      JSONB NOT NULL DEFAULT '{}',       -- {"locations": ["Delhi"], "vehicle_ids": [...]}
  schedule_cron   TEXT NOT NULL,                     -- "0 9 * * 1" = every Monday 9am
  delivery_channel TEXT NOT NULL DEFAULT 'web',      -- "web", "email", "whatsapp"
  delivery_target TEXT,                              -- Email address or phone number
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**How it works:**
1. User opens "Schedule Report" dialog in chat or reports page
2. Picks report type (or writes a custom prompt), scope, schedule, delivery method
3. Backend registers a cron job via `node-cron` (or a persistent job queue like BullMQ)
4. At scheduled time, the relevant LangGraph agent runs with the user's scope
5. Result stored in `ops_reports`, delivered to the user's channel

---

### WhatsApp Bot & Gmail Bot (Context Collectors)

Both bots act as **input channels** to the same LangGraph agent system. Every interaction is stored in `conversations` + `messages` with `channel = "whatsapp"` or `channel = "email"`.

**WhatsApp Bot:**
- Uses WhatsApp Business API (or Twilio)
- Receives messages → routes to LangGraph → responds
- Field team can report issues, ask questions, get anomaly alerts
- All messages stored as conversations (searchable from web UI)

**Gmail Bot:**
- Uses Gmail API (OAuth2) or Google Workspace Add-on
- Watches a designated inbox (e.g., `ops@emo.in`)
- Incoming emails parsed → context extracted → stored in conversations
- Can send scheduled reports as email attachments
- Forwarded complaint emails auto-ingested into complaints table

**Architecture:**

```
src/
  channels/
    whatsapp/
      webhook.ts               # WhatsApp webhook handler
      formatter.ts             # Format agent responses for WhatsApp (text limits, no markdown)
    email/
      gmail-client.ts          # Gmail API client
      parser.ts                # Extract structured data from emails
      sender.ts                # Send reports via email
    web/
      websocket.ts             # WebSocket handler for web chat (existing)
```

All channels feed into the same `LangGraph.invoke(state)` — the agent doesn't know or care which channel the user is on.

---

### Database: Neon PostgreSQL

**Connection:** `ep-old-tooth-a1gga0gk-pooler.ap-southeast-1.aws.neon.tech` (ap-southeast-1, pooled)

All 20+ tables live in Neon. Benefits:
- Serverless scaling (auto-suspend when idle, scale on demand)
- Branching (can create dev/staging branches of the database)
- pgvector extension available (for future semantic search)
- Connection pooling built in (the `-pooler` endpoint)

---

## 4. Data Streams & Unified Schema

### The 5 Data Streams

#### Stream 1: Intellicar (Vehicle Telemetry)

Source: Intellicar API or daily CSV/JSON export

| Field | Type | Description | Required |
|---|---|---|---|
| `vehicle_id` | TEXT | **Primary linking key** | YES |
| `timestamp` | TIMESTAMPTZ | Reading timestamp | YES |
| `latitude` | NUMERIC | GPS latitude | YES |
| `longitude` | NUMERIC | GPS longitude | YES |
| `speed_kmh` | NUMERIC | Speed at timestamp | |
| `ride_duration_min` | NUMERIC | Cumulative ride time (daily) | YES |
| `idle_time_min` | NUMERIC | Cumulative idle time (daily) | YES |
| `total_distance_km` | NUMERIC | Distance covered (daily) | YES |
| `fault_codes` | TEXT[] | Active fault codes | YES |
| `fault_count` | INT | Number of faults in period | YES |
| `usage_hours` | NUMERIC | Total usage hours (odometer) | |
| `ignition_cycles` | INT | On/off cycles per day | |
| `harsh_braking_count` | INT | Harsh braking events | |
| `location_city` | TEXT | Resolved city name | YES |

**Extraction method:** API pull (preferred) or scheduled CSV from Intellicar portal. Daily at 02:00 IST.

#### Stream 2: EMO IoT (Battery Pack Telemetry)

Source: EMO IoT platform API or MQTT broker

| Field | Type | Description | Required |
|---|---|---|---|
| `pack_id` | TEXT | **Primary linking key** | YES |
| `vehicle_id` | TEXT | **Cross-link to fleet** | YES |
| `timestamp` | TIMESTAMPTZ | Reading timestamp | YES |
| `firmware_version` | TEXT | **Critical for correlation** | YES |
| `charge_cycles` | INT | Total charge cycles to date | YES |
| `soc_percent` | NUMERIC | State of charge (%) | YES |
| `soc_min_24h` | NUMERIC | Min SOC in last 24h | |
| `soc_max_24h` | NUMERIC | Max SOC in last 24h | |
| `soc_swing` | NUMERIC | `soc_max - soc_min` (daily) | YES |
| `temp_max_c` | NUMERIC | Max cell temperature (24h) | YES |
| `temp_min_c` | NUMERIC | Min cell temperature (24h) | |
| `temp_avg_c` | NUMERIC | Average cell temperature | |
| `temp_spike_count` | INT | Times temp exceeded threshold | YES |
| `dcir_mohm` | NUMERIC | DC internal resistance (if available) | |
| `cell_imbalance_mv` | NUMERIC | Max cell voltage delta | YES |
| `voltage_pack_v` | NUMERIC | Pack voltage | |
| `current_a` | NUMERIC | Pack current (avg) | |
| `batch_id` | TEXT | Manufacturing batch | YES |

**Extraction method:** API pull or MQTT subscription. Hourly aggregation, daily summary.

#### Stream 3: SENS (Battery Analytics)

Source: SENS platform API or export

| Field | Type | Description | Required |
|---|---|---|---|
| `pack_id` | TEXT | **Primary linking key** | YES |
| `vehicle_id` | TEXT | **Cross-link** | YES |
| `timestamp` | TIMESTAMPTZ | Assessment timestamp | YES |
| `soh_percent` | NUMERIC | State of health (%) | YES |
| `soh_previous` | NUMERIC | SoH at last assessment | |
| `degradation_slope` | NUMERIC | Rate of SoH decline per month | YES |
| `risk_flag` | TEXT | none/low/medium/high/critical | YES |
| `risk_reason` | TEXT | Why the flag was set | |
| `abnormal_alert` | BOOLEAN | Abnormal pack behavior detected | YES |
| `alert_type` | TEXT | Type of abnormal alert | |
| `predicted_eol_date` | DATE | Predicted end-of-life date | |
| `firmware_version` | TEXT | At time of assessment | YES |
| `batch_id` | TEXT | Manufacturing batch | YES |

**Extraction method:** API pull or CSV. Weekly minimum, daily preferred.

#### Stream 4: Rider Complaints (Enhanced)

Source: Existing `Newcomplaintresponses` + `Complaindatabase` in MongoDB, enhanced with mandatory fields

| Field | Type | Description | Required |
|---|---|---|---|
| `complaint_id` | TEXT | Unique ID (Ticket) | YES |
| `vehicle_id` | TEXT | **Primary linking key** | YES |
| `pack_id` | TEXT | **Cross-link to battery** | YES |
| `timestamp` | TIMESTAMPTZ | When complaint was filed | YES |
| `complaint_type` | TEXT | Categorized type | YES |
| `complaint_category` | TEXT | Standardized category enum | YES |
| `description` | TEXT | Free-text description | |
| `location_city` | TEXT | City | YES |
| `rider_name` | TEXT | Rider who complained | |
| `resolution_status` | TEXT | open/in_progress/resolved/closed | YES |
| `resolution_time_hours` | NUMERIC | Hours to resolve (computed) | |
| `resolution_type` | TEXT | repair/replace/no_action/duplicate | |
| `firmware_version` | TEXT | Vehicle firmware at time of complaint | |
| `operator_name` | TEXT | Who logged it | YES |

**Extraction method:** Migrated from existing MongoDB collections + new form enforcement.

#### Stream 5: Field Service Logs (New)

Source: New structured form (replacing WhatsApp-based logging)

| Field | Type | Description | Required |
|---|---|---|---|
| `service_id` | TEXT | Unique service entry ID | YES |
| `vehicle_id` | TEXT | **Primary linking key** | YES |
| `pack_id` | TEXT | **Cross-link** | YES |
| `timestamp` | TIMESTAMPTZ | When service was performed | YES |
| `repair_type` | TEXT | Standardized repair category | YES |
| `parts_replaced` | TEXT[] | List of parts replaced | YES |
| `root_cause_tag` | TEXT | **Mandatory.** Standardized root cause | YES |
| `root_cause_detail` | TEXT | Free-text explanation | |
| `time_to_resolve_hours` | NUMERIC | Hours from ticket to fix | YES |
| `technician_name` | TEXT | Who performed the repair | YES |
| `firmware_version` | TEXT | At time of service | |
| `batch_id` | TEXT | Pack batch ID | |
| `location_city` | TEXT | Service location | YES |
| `is_repeat_repair` | BOOLEAN | Same vehicle, same issue within 30 days | YES |
| `related_complaint_id` | TEXT | FK to complaint that triggered this | |

**Extraction method:** New web form (mandatory fields enforced at input). Cannot submit without root cause tag.

### Unified Linking Keys

**Every record in the system MUST be joinable through these keys:**

```
Vehicle ID ←──→ Pack ID ←──→ Firmware Version ←──→ Batch ID
     │               │               │                  │
     └───── Intellicar data    IoT data, SENS      Manufacturing
             Complaints         Service logs         traceability
             Returns
             Deployments
             Rentals
```

### The Firmware Map Table

Central reference table — every firmware deployment tracked:

| Field | Type | Description |
|---|---|---|
| `vehicle_id` | TEXT | Which vehicle |
| `pack_id` | TEXT | Which pack |
| `firmware_version` | TEXT | Version string |
| `deployed_date` | DATE | When this firmware was deployed |
| `deployed_by` | TEXT | Who deployed it |
| `batch_id` | TEXT | Pack batch |
| `previous_version` | TEXT | What it was before |
| `notes` | TEXT | Release notes or reason |

---

## Week 1 — Data Consolidation & Structure

**Objective:** Build the data foundation. If this is wrong, everything above it is useless.

### Day 1–2: Data Inventory & Gap Analysis

**Action items:**

- [ ] **Intellicar:** Get API documentation. Identify authentication method. Confirm available fields. Determine if daily export is possible (API or CSV).
- [ ] **EMO IoT:** Get API documentation. Identify available telemetry fields. Confirm pack_id ↔ vehicle_id mapping exists.
- [ ] **SENS:** Get API/export access. Confirm SoH, degradation slope, risk flags are available. Confirm pack_id linkage.
- [ ] **Rider Complaints:** Audit existing MongoDB data. Count records missing vehicle_id or pack_id. Quantify the linking key gap.
- [ ] **Field Service:** Audit current logging process (WhatsApp?). Design new structured form. Define root cause tag taxonomy.

**Deliverable:** Data Inventory Map document:

```markdown
| Data Stream | Source System | Access Method | Auth | Fields Available | Fields Missing | Linking Key Status |
|---|---|---|---|---|---|---|
| Intellicar | Intellicar API | REST API / CSV | API key | ? | ? | Vehicle ID: ✅ |
| EMO IoT | IoT Platform | MQTT / REST | Token | ? | ? | Pack ID: ✅, Vehicle ID: ? |
| SENS | SENS Platform | REST API / CSV | API key | ? | ? | Pack ID: ✅ |
| Complaints | MongoDB | Direct | Connection string | ✅ Known | pack_id | Vehicle ID: ✅, Pack ID: ❌ |
| Service | WhatsApp / None | N/A | N/A | ❌ | Everything | ❌ |
```

### Day 2–3: Missing Linking Key Remediation

**This is the most important task of Week 1.**

- [ ] **Vehicle ID → Pack ID mapping:** Extract from `Deployementresponses` (has "Battery Serial No"). Build a lookup table: `vehicle_pack_map (vehicle_id, pack_id, mapped_from, mapped_at)`.
- [ ] **Pack ID → Batch ID mapping:** Must come from manufacturing/procurement. If not in any system, create manual entry form.
- [ ] **Pack ID → Firmware Version:** Must come from IoT platform or SENS. If not available, firmware tracking starts from now (no historical data).
- [ ] **Backfill existing complaints:** For every complaint in MongoDB that has a Vehicle ID but no Pack ID, resolve via `vehicle_pack_map`. Log unresolvable records separately.

```typescript
// Linking key resolution script (pseudo-code)
for (const complaint of allComplaints) {
  if (!complaint.pack_id && complaint.vehicle_id) {
    const mapping = await vehiclePackMap.findLatest(complaint.vehicle_id);
    if (mapping) {
      complaint.pack_id = mapping.pack_id;
      complaint.linking_resolved = true;
    } else {
      unresolvedLog.push({ complaint_id: complaint.id, vehicle_id: complaint.vehicle_id });
    }
  }
}
```

### Day 3–4: PostgreSQL Schema & Unified Ops DB

**New dependency:**

```bash
npm install @prisma/client node-cron
npm install -D prisma
```

**PostgreSQL tables (9 ops intelligence + 11 enterprise backbone = 20 total):**

```sql
-- ============================================================
-- FLEET HEALTH TABLE (Intellicar data)
-- Daily snapshots per vehicle
-- ============================================================

CREATE TABLE fleet_health (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          TEXT NOT NULL,
  pack_id             TEXT,
  date                DATE NOT NULL,
  location_city       TEXT NOT NULL,
  ride_duration_min   NUMERIC,
  idle_time_min       NUMERIC,
  idle_ratio          NUMERIC GENERATED ALWAYS AS (
    CASE WHEN (ride_duration_min + idle_time_min) > 0
    THEN idle_time_min / (ride_duration_min + idle_time_min)
    ELSE NULL END
  ) STORED,
  total_distance_km   NUMERIC,
  fault_codes         TEXT[],
  fault_count         INT DEFAULT 0,
  usage_hours         NUMERIC,
  ignition_cycles     INT,
  harsh_braking_count INT,
  firmware_version    TEXT,
  batch_id            TEXT,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, date)
);

CREATE INDEX idx_fleet_health_vehicle ON fleet_health(vehicle_id, date DESC);
CREATE INDEX idx_fleet_health_date ON fleet_health(date DESC);
CREATE INDEX idx_fleet_health_location ON fleet_health(location_city);
CREATE INDEX idx_fleet_health_faults ON fleet_health(fault_count DESC) WHERE fault_count > 0;

-- ============================================================
-- BATTERY RISK TABLE (IoT + SENS combined)
-- Daily/weekly snapshots per pack
-- ============================================================

CREATE TABLE battery_risk (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id             TEXT NOT NULL,
  vehicle_id          TEXT,
  date                DATE NOT NULL,
  -- IoT telemetry
  firmware_version    TEXT,
  charge_cycles       INT,
  soc_swing           NUMERIC,
  temp_max_c          NUMERIC,
  temp_spike_count    INT DEFAULT 0,
  dcir_mohm           NUMERIC,
  cell_imbalance_mv   NUMERIC,
  -- SENS analytics
  soh_percent         NUMERIC,
  degradation_slope   NUMERIC,           -- SoH decline per month
  risk_flag           TEXT DEFAULT 'none', -- none/low/medium/high/critical
  risk_reason         TEXT,
  abnormal_alert      BOOLEAN DEFAULT false,
  alert_type          TEXT,
  predicted_eol_date  DATE,
  -- Linking
  batch_id            TEXT,
  location_city       TEXT,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pack_id, date)
);

CREATE INDEX idx_battery_risk_pack ON battery_risk(pack_id, date DESC);
CREATE INDEX idx_battery_risk_flag ON battery_risk(risk_flag) WHERE risk_flag != 'none';
CREATE INDEX idx_battery_risk_batch ON battery_risk(batch_id);
CREATE INDEX idx_battery_risk_firmware ON battery_risk(firmware_version);
CREATE INDEX idx_battery_risk_soh ON battery_risk(soh_percent) WHERE soh_percent IS NOT NULL;

-- ============================================================
-- COMPLAINT TABLE (Enhanced from MongoDB)
-- ============================================================

CREATE TABLE complaints (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id            TEXT NOT NULL UNIQUE,
  vehicle_id              TEXT NOT NULL,
  pack_id                 TEXT,
  timestamp               TIMESTAMPTZ NOT NULL,
  complaint_type          TEXT NOT NULL,
  complaint_category      TEXT NOT NULL,
  description             TEXT,
  location_city           TEXT NOT NULL,
  rider_name              TEXT,
  operator_name           TEXT,
  resolution_status       TEXT NOT NULL DEFAULT 'open',
  resolution_time_hours   NUMERIC,
  resolution_type         TEXT,
  firmware_version        TEXT,
  batch_id                TEXT,
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_complaints_vehicle ON complaints(vehicle_id);
CREATE INDEX idx_complaints_pack ON complaints(pack_id) WHERE pack_id IS NOT NULL;
CREATE INDEX idx_complaints_timestamp ON complaints(timestamp DESC);
CREATE INDEX idx_complaints_category ON complaints(complaint_category);
CREATE INDEX idx_complaints_status ON complaints(resolution_status);
CREATE INDEX idx_complaints_location ON complaints(location_city);

-- ============================================================
-- SERVICE LOG TABLE (New — replaces WhatsApp logging)
-- ============================================================

CREATE TABLE service_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id              TEXT NOT NULL UNIQUE,
  vehicle_id              TEXT NOT NULL,
  pack_id                 TEXT,
  timestamp               TIMESTAMPTZ NOT NULL,
  repair_type             TEXT NOT NULL,
  parts_replaced          TEXT[] NOT NULL DEFAULT '{}',
  root_cause_tag          TEXT NOT NULL,       -- MANDATORY
  root_cause_detail       TEXT,
  time_to_resolve_hours   NUMERIC NOT NULL,
  technician_name         TEXT NOT NULL,
  firmware_version        TEXT,
  batch_id                TEXT,
  location_city           TEXT NOT NULL,
  is_repeat_repair        BOOLEAN NOT NULL DEFAULT false,
  related_complaint_id    TEXT REFERENCES complaints(complaint_id),
  ingested_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_vehicle ON service_logs(vehicle_id);
CREATE INDEX idx_service_root_cause ON service_logs(root_cause_tag);
CREATE INDEX idx_service_repeat ON service_logs(is_repeat_repair) WHERE is_repeat_repair = true;
CREATE INDEX idx_service_timestamp ON service_logs(timestamp DESC);

-- ============================================================
-- FIRMWARE MAP TABLE (Central reference)
-- ============================================================

CREATE TABLE firmware_map (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          TEXT NOT NULL,
  pack_id             TEXT,
  firmware_version    TEXT NOT NULL,
  previous_version    TEXT,
  deployed_date       DATE NOT NULL,
  deployed_by         TEXT,
  batch_id            TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_firmware_vehicle ON firmware_map(vehicle_id, deployed_date DESC);
CREATE INDEX idx_firmware_version ON firmware_map(firmware_version);
CREATE INDEX idx_firmware_batch ON firmware_map(batch_id);

-- ============================================================
-- VEHICLE-PACK MAPPING (Linking key resolver)
-- ============================================================

CREATE TABLE vehicle_pack_map (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      TEXT NOT NULL,
  pack_id         TEXT NOT NULL,
  batch_id        TEXT,
  mapped_from     TEXT NOT NULL,         -- "deployment", "manual", "iot", "sens"
  active          BOOLEAN NOT NULL DEFAULT true,
  valid_from      DATE NOT NULL,
  valid_to        DATE,                  -- NULL = current mapping
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_vpm_active ON vehicle_pack_map(vehicle_id) WHERE active = true;
CREATE INDEX idx_vpm_pack ON vehicle_pack_map(pack_id);

-- ============================================================
-- ANOMALY LOG (Output from AI agents)
-- ============================================================

CREATE TABLE anomaly_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT NOT NULL,          -- "fleet_anomaly", "battery_degradation", "complaint_correlation", "service_root_cause"
  severity        TEXT NOT NULL,          -- "info", "warning", "critical"
  vehicle_id      TEXT,
  pack_id         TEXT,
  batch_id        TEXT,
  location_city   TEXT,
  anomaly_type    TEXT NOT NULL,          -- "high_idle_ratio", "excessive_faults", "fast_degradation", "repeat_complaint", etc.
  description     TEXT NOT NULL,          -- AI-generated explanation
  data_snapshot   JSONB,                  -- Raw data that triggered this anomaly
  report_date     DATE NOT NULL,
  acknowledged    BOOLEAN DEFAULT false,
  acknowledged_by TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomaly_date ON anomaly_log(report_date DESC);
CREATE INDEX idx_anomaly_severity ON anomaly_log(severity) WHERE severity IN ('warning', 'critical');
CREATE INDEX idx_anomaly_agent ON anomaly_log(agent_name, report_date DESC);
CREATE INDEX idx_anomaly_vehicle ON anomaly_log(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- ============================================================
-- OPS REPORTS (AI-generated weekly summaries)
-- ============================================================

CREATE TABLE ops_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type     TEXT NOT NULL,          -- "weekly_health", "fleet_anomaly_daily", "battery_risk_weekly", "complaint_weekly", "service_weekly"
  report_date     DATE NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  content         TEXT NOT NULL,          -- Full markdown report
  summary         TEXT NOT NULL,          -- Executive summary (first paragraph)
  metrics         JSONB NOT NULL,         -- Structured metrics for dashboard
  agent_name      TEXT NOT NULL,
  tokens_used     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_type_date ON ops_reports(report_type, report_date DESC);

-- ============================================================
-- ORGANIZATION HIERARCHY
-- ============================================================

CREATE TABLE org_nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,                    -- "Delhi Operations", "Mumbai Region"
  parent_id     UUID REFERENCES org_nodes(id),    -- NULL for root (CEO level)
  level         INT NOT NULL DEFAULT 0,           -- 0=company, 1=division, 2=region, 3=city, 4=team
  locations     TEXT[] NOT NULL DEFAULT '{}',      -- Fleet locations this node covers: ["Delhi", "Noida"]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_nodes_parent ON org_nodes(parent_id);

-- ============================================================
-- ROLES & PERMISSIONS
-- ============================================================

CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,              -- "admin", "ceo", "vp", "manager", "employee"
  permissions   JSONB NOT NULL DEFAULT '{}',       -- { "view_all_data": true, "manage_users": false, ... }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default roles
INSERT INTO roles (name, permissions) VALUES
  ('admin',    '{"view_all_data":true,"manage_users":true,"view_audit":true,"manage_alerts":true,"view_llm_usage":true}'),
  ('ceo',      '{"view_all_data":true,"manage_users":true,"view_audit":true,"manage_alerts":true,"view_llm_usage":true}'),
  ('vp',       '{"view_all_data":true,"manage_users":false,"view_audit":true,"manage_alerts":true,"view_llm_usage":false}'),
  ('manager',  '{"view_all_data":false,"manage_users":false,"view_audit":false,"manage_alerts":true,"view_llm_usage":false}'),
  ('employee', '{"view_all_data":false,"manage_users":false,"view_audit":false,"manage_alerts":false,"view_llm_usage":false}');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role_id       UUID NOT NULL REFERENCES roles(id),
  org_node_id   UUID NOT NULL REFERENCES org_nodes(id),
  phone         TEXT,                              -- For WhatsApp lookup
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_org_node ON users(org_node_id);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  action        TEXT NOT NULL,                     -- "chat.query", "auth.login", "admin.user.create"
  resource      TEXT,                              -- "chat", "user:uuid", "kpi:fleet_utilization"
  details       JSONB,                             -- { query: "...", source: "local", tokens: 150 }
  ip_address    INET,
  channel       TEXT,                              -- "web", "whatsapp", "email", "api"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================

CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  title         TEXT,                              -- Auto-generated from first message
  channel       TEXT NOT NULL DEFAULT 'web',       -- "web", "whatsapp", "email", "api"
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,                  -- "user", "assistant", "system"
  content           TEXT NOT NULL,
  source            TEXT,                           -- "local", "llm", "kpi-agent", "decision-agent"
  agent_name        TEXT,                           -- Which agent handled this
  tokens_used       INT,
  latency_ms        INT,
  metadata          JSONB,                          -- Tool calls, routing info, error details
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE bookmarks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  message_id    UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- KPI DEFINITIONS & SNAPSHOTS
-- ============================================================

CREATE TABLE kpi_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,              -- "fleet_utilization", "collection_efficiency"
  display_name  TEXT NOT NULL,                     -- "Fleet Utilization Rate"
  description   TEXT,
  formula       TEXT NOT NULL,                     -- Human-readable: "active_vehicles / total_vehicles * 100"
  unit          TEXT NOT NULL DEFAULT '%',          -- "%", "₹", "days", "count"
  target_value  NUMERIC,                           -- Target threshold (e.g., 80 for 80%)
  warning_threshold NUMERIC,                       -- Yellow alert threshold
  critical_threshold NUMERIC,                      -- Red alert threshold
  scope         TEXT NOT NULL DEFAULT 'location',  -- "location", "team", "company"
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kpi_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id        UUID NOT NULL REFERENCES kpi_definitions(id),
  org_node_id   UUID REFERENCES org_nodes(id),     -- NULL = company-wide
  location      TEXT,                              -- Denormalized for fast queries
  value         NUMERIC NOT NULL,
  period        TEXT NOT NULL,                     -- "2026-03-20" (daily), "2026-W12" (weekly), "2026-03" (monthly)
  period_type   TEXT NOT NULL DEFAULT 'daily',     -- "daily", "weekly", "monthly"
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kpi_snapshots_lookup ON kpi_snapshots(kpi_id, period_type, period DESC);
CREATE INDEX idx_kpi_snapshots_org ON kpi_snapshots(org_node_id, period DESC);

-- ============================================================
-- ALERT RULES & HISTORY
-- ============================================================

CREATE TABLE alert_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,                   -- "High overdue payments"
  condition_type  TEXT NOT NULL,                   -- "kpi_threshold", "count_threshold", "schedule"
  condition       JSONB NOT NULL,                  -- { "kpi": "overdue_count", "operator": ">", "value": 50, "location": "Delhi" }
  channel         TEXT NOT NULL DEFAULT 'web',     -- "web", "email", "whatsapp"
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID NOT NULL REFERENCES alert_rules(id),
  payload         JSONB NOT NULL,                  -- The data that triggered the alert
  delivered       BOOLEAN NOT NULL DEFAULT false,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- QUERY CACHE
-- ============================================================

CREATE TABLE query_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash    TEXT NOT NULL,                     -- SHA-256 of normalized query
  scope_hash    TEXT NOT NULL,                     -- SHA-256 of user's location scope
  response      TEXT NOT NULL,
  source        TEXT NOT NULL,                     -- "local", "llm"
  hit_count     INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX idx_cache_lookup ON query_cache(query_hash, scope_hash);
```

### Day 3–4 (continued): JWT Authentication

**New dependencies:**

```bash
npm install jsonwebtoken bcryptjs
npm install -D @types/jsonwebtoken @types/bcryptjs
```
> Note: All backend deps are installed inside `backend/`. Frontend deps inside `frontend/`.

**`src/auth/jwt.ts`:**

```typescript
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  orgNodeId: string;
  permissions: Record<string, boolean>;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRY });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
```

**`src/auth/middleware.ts`:**

```typescript
import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "./jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

export interface UserContext {
  userId: string;
  email: string;
  name: string;
  role: string;
  orgNodeId: string;
  permissions: Record<string, boolean>;
  allowedLocations: string[];  // Resolved from org hierarchy
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    req.user = await resolveUserContext(payload);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
```

**`src/auth/rbac.ts` — Location-scoped data access:**

```typescript
import { db } from "../db/postgres.js";

// Resolve which locations a user can see based on org hierarchy
export async function resolveAllowedLocations(orgNodeId: string): Promise<string[]> {
  // Walk down the org tree: user sees their node + all children
  const result = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, locations FROM org_nodes WHERE id = ${orgNodeId}
      UNION ALL
      SELECT c.id, c.locations FROM org_nodes c
      JOIN subtree p ON c.parent_id = p.id
    )
    SELECT DISTINCT unnest(locations) as location FROM subtree
  `);
  return result.rows.map(r => r.location);
}

// Apply location scope to any query
export function scopeByLocation(allowedLocations: string[]): SQL {
  return sql`location_city = ANY(${allowedLocations})`;
}
```

### Day 4–5: Data Ingestion Pipeline

**Architecture: `src/ingestion/`**

```
src/ingestion/
  pipeline.ts              # Orchestrator: runs all extractors on schedule
  extractors/
    intellicar.ts          # Fetch from Intellicar API → fleet_health
    iot.ts                 # Fetch from EMO IoT → battery_risk (telemetry part)
    sens.ts                # Fetch from SENS → battery_risk (analytics part, merged)
    complaints.ts          # Migrate from MongoDB → complaints (with linking key resolution)
    service-logs.ts        # Ingest from new form → service_logs
  transformers/
    linking-resolver.ts    # Resolve vehicle_id ↔ pack_id ↔ firmware ↔ batch
    dedup.ts               # Deduplicate records on UNIQUE constraints
    validator.ts           # Enforce mandatory fields, reject bad records
  loaders/
    postgres-loader.ts     # Bulk upsert into PostgreSQL tables
```

**Pipeline schedule:**

| Extractor | Frequency | Time | Dependencies |
|---|---|---|---|
| Intellicar | Daily | 02:00 IST | API access |
| EMO IoT | Daily (hourly raw → daily aggregation) | 03:00 IST | API access |
| SENS | Daily (or weekly) | 04:00 IST | API access |
| Complaints | Every 15 min (sync from MongoDB) | Continuous | MongoDB connection |
| Service Logs | Real-time (on form submit) | Continuous | New form deployed |
| Linking Resolver | After each ingestion cycle | 05:00 IST | All extractors complete |

```typescript
// src/ingestion/pipeline.ts
import cron from "node-cron";

// Daily ingestion pipeline — 02:00 IST
cron.schedule("30 20 * * *", async () => { // 20:30 UTC = 02:00 IST
  logger.info("Starting daily ingestion pipeline...");

  // Step 1: Extract from all sources
  const intellicarData = await extractIntellicar();
  const iotData = await extractIoT();
  const sensData = await extractSENS();

  // Step 2: Resolve linking keys
  await resolveLinkingKeys(intellicarData, iotData, sensData);

  // Step 3: Validate mandatory fields
  const validated = validateAll(intellicarData, iotData, sensData);

  // Step 4: Load into PostgreSQL
  await loadFleetHealth(validated.intellicar);
  await loadBatteryRisk(validated.iot, validated.sens); // Merged by pack_id + date
  await syncComplaints(); // Continuous sync from MongoDB

  // Step 5: Run linking resolver for any new mappings
  await updateVehiclePackMap();

  logger.info("Daily ingestion complete", {
    fleet_records: validated.intellicar.length,
    battery_records: validated.iot.length,
    sens_records: validated.sens.length,
  });
});

// Complaint sync — every 15 minutes
cron.schedule("*/15 * * * *", async () => {
  await syncComplaintsFromMongo();
});
```

### Day 5–7: Complaint Migration & Service Form

**Complaint migration script:**

```typescript
// Migrate existing MongoDB complaints to PostgreSQL with linking key enrichment
async function migrateComplaints() {
  const mongoComplaints = getData()!.Newcomplaintresponses;
  const batteryComplaints = getData()!.Complaindatabase;

  let migrated = 0, unlinked = 0;

  for (const doc of [...mongoComplaints, ...batteryComplaints]) {
    const vehicleId = doc["Vehicle ID"];
    if (!vehicleId) { unlinked++; continue; } // MANDATORY: skip if no vehicle ID

    // Resolve pack_id from mapping
    const packId = await resolvePackId(vehicleId) || doc["Battery ID"] || null;

    // Resolve firmware from firmware_map
    const firmware = await resolveCurrentFirmware(vehicleId);

    await upsertComplaint({
      complaint_id: doc["Ticket"] || doc["Ticket ID"],
      vehicle_id: vehicleId,
      pack_id: packId,
      timestamp: parseDate(doc["Created Time"]),
      complaint_type: doc["Purpose of Form Fillup?"] || doc["Issue"] || "Unknown",
      complaint_category: categorizeComplaint(doc),
      description: doc["Comments (if any)"] || doc["Solution"] || "",
      location_city: doc["Location"],
      resolution_status: mapResolutionStatus(doc),
      firmware_version: firmware,
      operator_name: doc["Your Name"] || doc["Technician Name"],
    });
    migrated++;
  }

  logger.info(`Migration complete: ${migrated} migrated, ${unlinked} skipped (no vehicle ID)`);
}
```

**Standardized complaint categories (enum):**

```
vehicle_breakdown, battery_issue, charging_failure, range_anxiety,
motor_problem, brake_issue, tire_issue, electrical_fault,
display_malfunction, water_ingress, body_damage, theft_attempt,
rider_misconduct, payment_dispute, app_issue, other
```

**Standardized root cause tags (for service logs):**

```
battery_cell_failure, bms_fault, firmware_bug, motor_bearing,
motor_controller, wiring_damage, connector_loose, water_damage,
physical_impact, manufacturing_defect, wear_and_tear,
rider_misuse, charging_adapter, display_unit, no_fault_found, other
```

**Service log form** — new endpoint or simple web form:

```
POST /api/service-log
{
  "vehicle_id": "DL4SDY2798",        // Required
  "pack_id": "ZENE1234",             // Required
  "repair_type": "battery_replacement", // Required, from enum
  "parts_replaced": ["battery_pack"], // Required, at least one
  "root_cause_tag": "battery_cell_failure", // Required, from enum
  "root_cause_detail": "Cell 4 voltage dropped below 2.5V",
  "time_to_resolve_hours": 4.5,      // Required
  "technician_name": "Rahul K",      // Required
  "location_city": "Delhi"           // Required
}
```

### Week 1 Deliverables

- [ ] Data inventory map: all 5 streams documented (access method, fields, gaps)
- [ ] Missing linking key list: every broken Vehicle ID ↔ Pack ID mapping identified
- [ ] `vehicle_pack_map` table populated from Deployementresponses ("Battery Serial No")
- [ ] PostgreSQL running with all 7 tables created
- [ ] Complaint migration script: MongoDB → PostgreSQL (with linking enrichment)
- [ ] Service log form: POST endpoint with mandatory field enforcement
- [ ] Firmware map: initial population from available data
- [ ] Extraction feasibility confirmed for Intellicar, IoT, SENS (API keys obtained or blockers identified)
- [ ] Ingestion pipeline scaffold: cron jobs defined, extractor stubs for each source

---

## Week 2 — AI Intelligence Layer (4 Agents)

**Objective:** Build 4 specialized AI agents that turn raw data into actionable intelligence. Each agent runs on a schedule, queries the unified DB, and produces structured reports.

### Agent Architecture

```typescript
// src/agents/intelligence/base-intelligence-agent.ts

export interface IntelligenceReport {
  agentName: string;
  reportType: string;
  reportDate: Date;
  periodStart: Date;
  periodEnd: Date;
  summary: string;           // Executive summary paragraph
  anomalies: Anomaly[];      // Structured anomaly list
  metrics: Record<string, any>; // Structured metrics for dashboard
  fullReport: string;        // Full markdown narrative
  tokensUsed: number;
}

export interface Anomaly {
  severity: "info" | "warning" | "critical";
  vehicleId?: string;
  packId?: string;
  batchId?: string;
  locationCity?: string;
  anomalyType: string;
  description: string;
  dataSnapshot: Record<string, any>;
}

export abstract class BaseIntelligenceAgent {
  abstract readonly name: string;
  abstract readonly schedule: string;   // cron expression

  /** Gather data for this agent's analysis */
  abstract gatherData(periodStart: Date, periodEnd: Date): Promise<any>;

  /** Build the prompt for Claude with gathered data */
  abstract buildPrompt(data: any): string;

  /** Parse the LLM response into structured report */
  abstract parseResponse(llmResponse: string, data: any): IntelligenceReport;

  /** Full execution: gather → prompt → call LLM → parse → store */
  async execute(periodStart: Date, periodEnd: Date): Promise<IntelligenceReport> {
    const data = await this.gatherData(periodStart, periodEnd);
    const prompt = this.buildPrompt(data);
    const llmResponse = await callClaude(prompt); // Use Sonnet for intelligence, not Haiku
    const report = this.parseResponse(llmResponse, data);

    // Store report
    await storeReport(report);
    // Store individual anomalies
    for (const anomaly of report.anomalies) {
      await storeAnomaly(this.name, anomaly, report.reportDate);
    }

    return report;
  }
}
```

### Agent 1: Fleet Anomaly Agent

**Schedule:** Daily at 06:00 IST (after ingestion completes)
**Input:** `fleet_health` table (last 24h + 7-day baseline)
**Output:** Daily anomaly list

```typescript
// src/agents/intelligence/fleet-anomaly.ts

class FleetAnomalyAgent extends BaseIntelligenceAgent {
  name = "fleet_anomaly";
  schedule = "30 0 * * *"; // 00:30 UTC = 06:00 IST

  async gatherData(periodStart: Date, periodEnd: Date) {
    // Today's data
    const todayData = await db.select().from(fleetHealth)
      .where(eq(fleetHealth.date, today()));

    // 7-day baseline for comparison
    const baseline = await db.execute(sql`
      SELECT
        vehicle_id,
        AVG(idle_ratio) as avg_idle_ratio,
        AVG(fault_count) as avg_fault_count,
        AVG(ride_duration_min) as avg_ride_duration,
        STDDEV(idle_ratio) as stddev_idle_ratio,
        STDDEV(fault_count) as stddev_fault_count
      FROM fleet_health
      WHERE date >= ${sevenDaysAgo} AND date < ${today}
      GROUP BY vehicle_id
    `);

    // Fleet-wide stats
    const fleetStats = await db.execute(sql`
      SELECT
        COUNT(DISTINCT vehicle_id) as total_vehicles,
        AVG(idle_ratio) as fleet_avg_idle,
        AVG(fault_count) as fleet_avg_faults,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY idle_ratio) as idle_p95,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fault_count) as fault_p95
      FROM fleet_health
      WHERE date = ${today}
    `);

    return { todayData, baseline, fleetStats };
  }

  buildPrompt(data: any): string {
    return `You are the Fleet Anomaly Detection Agent for EMO's EV fleet operations.

TASK: Analyze today's fleet health data and identify anomalies compared to 7-day baselines.

FLEET STATISTICS (today):
- Total vehicles reporting: ${data.fleetStats.total_vehicles}
- Fleet average idle ratio: ${data.fleetStats.fleet_avg_idle}
- Fleet average fault count: ${data.fleetStats.fleet_avg_faults}
- Idle ratio 95th percentile: ${data.fleetStats.idle_p95}
- Fault count 95th percentile: ${data.fleetStats.fault_p95}

TODAY'S DATA (${data.todayData.length} vehicles):
${formatFleetDataForLLM(data.todayData)}

7-DAY BASELINES PER VEHICLE (for vehicles with today's data):
${formatBaselineForLLM(data.baseline)}

DETECT:
1. Vehicles with abnormal idle ratio (>2 std devs above their baseline, or >0.6 absolute)
2. Vehicles with excessive fault codes (>2 std devs above baseline, or >5 absolute)
3. Outlier ride duration patterns (very short rides = possible misuse, or very long = no rest)
4. Misuse detection signals (high idle + low distance + high ignition cycles)
5. Vehicles that suddenly stopped reporting (were active yesterday, missing today)

OUTPUT FORMAT (strict JSON):
{
  "summary": "Executive summary paragraph",
  "total_anomalies": <number>,
  "critical_count": <number>,
  "warning_count": <number>,
  "anomalies": [
    {
      "severity": "critical|warning|info",
      "vehicle_id": "...",
      "location_city": "...",
      "anomaly_type": "high_idle_ratio|excessive_faults|ride_duration_outlier|misuse_signal|stopped_reporting",
      "description": "Human-readable explanation of why this is flagged",
      "metric_value": <current value>,
      "baseline_value": <7-day average>,
      "deviation": <how many std devs or % above baseline>
    }
  ],
  "fleet_health_score": <0-100, overall fleet health>,
  "location_risk_ranking": [{"city": "...", "risk_score": <0-100>, "vehicle_count": <n>}]
}`;
  }
}
```

### Agent 2: Battery Degradation Intelligence Agent

**Schedule:** Weekly (Monday 07:00 IST) + daily screening
**Input:** `battery_risk` table (last 30 days + lifecycle data)
**Output:** Weekly battery risk report

```typescript
// src/agents/intelligence/battery-degradation.ts

class BatteryDegradationAgent extends BaseIntelligenceAgent {
  name = "battery_degradation";
  schedule = "30 1 * * 1"; // Monday 01:30 UTC = 07:00 IST

  async gatherData(periodStart: Date, periodEnd: Date) {
    // Packs degrading faster than fleet average
    const fastDegrading = await db.execute(sql`
      WITH fleet_avg AS (
        SELECT AVG(degradation_slope) as avg_slope
        FROM battery_risk
        WHERE degradation_slope IS NOT NULL AND date >= ${thirtyDaysAgo}
      )
      SELECT br.*, fa.avg_slope as fleet_avg_slope
      FROM battery_risk br, fleet_avg fa
      WHERE br.date = (SELECT MAX(date) FROM battery_risk WHERE pack_id = br.pack_id)
        AND br.degradation_slope > fa.avg_slope * 1.5
      ORDER BY br.degradation_slope DESC
      LIMIT 50
    `);

    // Firmware correlation: avg degradation slope per firmware version
    const firmwareCorrelation = await db.execute(sql`
      SELECT
        firmware_version,
        COUNT(DISTINCT pack_id) as pack_count,
        AVG(degradation_slope) as avg_degradation,
        AVG(soh_percent) as avg_soh,
        COUNT(*) FILTER (WHERE risk_flag IN ('high', 'critical')) as high_risk_count
      FROM battery_risk
      WHERE date >= ${thirtyDaysAgo} AND firmware_version IS NOT NULL
      GROUP BY firmware_version
      ORDER BY avg_degradation DESC
    `);

    // Batch performance comparison
    const batchComparison = await db.execute(sql`
      SELECT
        batch_id,
        COUNT(DISTINCT pack_id) as pack_count,
        AVG(soh_percent) as avg_soh,
        AVG(degradation_slope) as avg_degradation,
        COUNT(*) FILTER (WHERE risk_flag IN ('high', 'critical')) as flagged_count,
        AVG(temp_max_c) as avg_temp_max,
        AVG(cell_imbalance_mv) as avg_imbalance
      FROM battery_risk
      WHERE date >= ${thirtyDaysAgo} AND batch_id IS NOT NULL
      GROUP BY batch_id
      ORDER BY avg_degradation DESC
    `);

    // Temperature abuse clusters (packs with frequent temp spikes)
    const tempAbuse = await db.execute(sql`
      SELECT
        pack_id, vehicle_id, location_city, batch_id, firmware_version,
        SUM(temp_spike_count) as total_spikes,
        MAX(temp_max_c) as max_temp_ever,
        AVG(temp_max_c) as avg_max_temp
      FROM battery_risk
      WHERE date >= ${thirtyDaysAgo}
      GROUP BY pack_id, vehicle_id, location_city, batch_id, firmware_version
      HAVING SUM(temp_spike_count) > 10
      ORDER BY total_spikes DESC
      LIMIT 30
    `);

    // SoH distribution
    const sohDistribution = await db.execute(sql`
      SELECT
        CASE
          WHEN soh_percent >= 90 THEN 'Healthy (90-100%)'
          WHEN soh_percent >= 80 THEN 'Good (80-90%)'
          WHEN soh_percent >= 70 THEN 'Fair (70-80%)'
          WHEN soh_percent >= 60 THEN 'Degraded (60-70%)'
          ELSE 'Critical (<60%)'
        END as soh_band,
        COUNT(DISTINCT pack_id) as pack_count
      FROM battery_risk
      WHERE date = (SELECT MAX(date) FROM battery_risk)
        AND soh_percent IS NOT NULL
      GROUP BY 1
      ORDER BY MIN(soh_percent) DESC
    `);

    return { fastDegrading, firmwareCorrelation, batchComparison, tempAbuse, sohDistribution };
  }

  buildPrompt(data: any): string {
    return `You are the Battery Degradation Intelligence Agent for EMO's EV fleet.

TASK: Analyze battery health data from the past 30 days and produce a risk report.

SOH DISTRIBUTION:
${formatTable(data.sohDistribution)}

PACKS DEGRADING FASTER THAN 1.5x FLEET AVERAGE (${data.fastDegrading.length} packs):
${formatTable(data.fastDegrading.slice(0, 20))}

FIRMWARE VERSION CORRELATION:
${formatTable(data.firmwareCorrelation)}

BATCH PERFORMANCE COMPARISON:
${formatTable(data.batchComparison)}

TEMPERATURE ABUSE CLUSTERS (packs with >10 temp spikes in 30 days):
${formatTable(data.tempAbuse)}

ANALYZE AND REPORT:
1. Which packs are degrading fastest and why (firmware? batch? temperature abuse? usage pattern?)
2. Is there a firmware version that correlates with faster degradation?
3. Is there a batch that's underperforming?
4. Which locations have the worst battery health?
5. Predict: which packs will need replacement in the next 30/60/90 days?
6. Risk heatmap by batch: which batches are ticking time bombs?

OUTPUT FORMAT (strict JSON):
{
  "summary": "Executive summary paragraph",
  "total_packs_at_risk": <number>,
  "replacement_candidates_30d": [{"pack_id": "...", "vehicle_id": "...", "soh": <n>, "predicted_eol": "YYYY-MM-DD"}],
  "firmware_risk_ranking": [{"version": "...", "pack_count": <n>, "avg_degradation": <n>, "verdict": "safe|monitor|investigate|critical"}],
  "batch_risk_ranking": [{"batch_id": "...", "pack_count": <n>, "avg_soh": <n>, "flagged_pct": <n>, "verdict": "..."}],
  "anomalies": [
    {
      "severity": "critical|warning|info",
      "pack_id": "...",
      "vehicle_id": "...",
      "batch_id": "...",
      "anomaly_type": "fast_degradation|firmware_correlation|temp_abuse|cell_imbalance|batch_defect",
      "description": "..."
    }
  ]
}`;
  }
}
```

### Agent 3: Complaint Correlation Agent

**Schedule:** Weekly (Monday 08:00 IST)
**Input:** `complaints` + `fleet_health` + `battery_risk`
**Output:** Weekly complaint intelligence report

**Key queries:**
- Top recurring complaint categories (this week vs last week trend)
- Vehicles with repeated complaints (>2 in 30 days)
- Complaint-to-telemetry correlation: do vehicles with high fault counts also have more complaints?
- Regional complaint density: complaints per 100 vehicles per city
- Complaint-to-battery correlation: do packs with low SoH correlate with more complaints?

### Agent 4: Service Root Cause Agent

**Schedule:** Weekly (Monday 09:00 IST)
**Input:** `service_logs` + `battery_risk` + `complaints` + `firmware_map`
**Output:** Recurring failure summary

**Key queries:**
- Root cause tag frequency distribution
- Part failure frequency (which parts are replaced most?)
- Firmware-related defect clustering: does a firmware version correlate with a specific root cause?
- Repeat repair flags: vehicles serviced multiple times for the same issue
- MTTR by location, by repair type, by technician
- Cross-reference: Do complaint categories predict the eventual root cause?

### Orchestrating the 4 Agents

```typescript
// src/agents/intelligence/scheduler.ts

import cron from "node-cron";

// ── Daily agents ──
// Fleet Anomaly: every day at 06:00 IST
cron.schedule("30 0 * * *", async () => {
  const yesterday = subDays(new Date(), 1);
  const today = new Date();
  await fleetAnomalyAgent.execute(yesterday, today);
  logger.info("Fleet Anomaly Agent: daily report generated");
});

// ── Weekly agents (Monday) ──
// Battery Degradation: Monday 07:00 IST
cron.schedule("30 1 * * 1", async () => {
  const weekStart = subDays(new Date(), 7);
  await batteryDegradationAgent.execute(weekStart, new Date());
  logger.info("Battery Degradation Agent: weekly report generated");
});

// Complaint Correlation: Monday 08:00 IST
cron.schedule("30 2 * * 1", async () => {
  const weekStart = subDays(new Date(), 7);
  await complaintCorrelationAgent.execute(weekStart, new Date());
  logger.info("Complaint Correlation Agent: weekly report generated");
});

// Service Root Cause: Monday 09:00 IST
cron.schedule("30 3 * * 1", async () => {
  const weekStart = subDays(new Date(), 7);
  await serviceRootCauseAgent.execute(weekStart, new Date());
  logger.info("Service Root Cause Agent: weekly report generated");
});

// ── Executive Ops Health Report: Monday 10:00 IST ──
// Synthesizes outputs from all 4 agents
cron.schedule("30 4 * * 1", async () => {
  await generateWeeklyOpsHealthReport();
  logger.info("Executive Ops Health Report: generated");
});
```

### Week 2 Deliverables

- [ ] Fleet Anomaly Agent: running daily, producing anomaly lists stored in `anomaly_log`
- [ ] Battery Degradation Agent: running weekly, producing risk reports stored in `ops_reports`
- [ ] Complaint Correlation Agent: running weekly, cross-referencing complaints with telemetry
- [ ] Service Root Cause Agent: running weekly (may have limited data in first week)
- [ ] All agents using Claude Sonnet (not Haiku) for reasoning quality
- [ ] Agent outputs queryable via existing chat interface: "Show me today's fleet anomalies"
- [ ] New local engine patterns for common intelligence queries
- [ ] Initial AI anomaly report: first automated daily output running

---

## Week 3 — Executive Ops Dashboards & AI Reports

**Objective:** Surface intelligence visually. Three dashboards + weekly AI-generated narrative.

### Dashboard 1: Fleet Stability

```
┌──────────────────────────────────────────────────────────────┐
│  FLEET STABILITY DASHBOARD                     Date: Mar 20  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Active   │  │ At Risk  │  │ Fault    │  │ Idle     │    │
│  │ 847      │  │ 23 ▲4   │  │ Density  │  │ Abuse %  │    │
│  │ vehicles │  │ vehicles │  │ 1.3/veh  │  │ 8.2%     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  ┌─ Anomaly Trend (7 days) ──────────────────────────────┐  │
│  │  ▁▂▃▂▄▅▆  (bar chart: anomaly count per day)         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Today's Anomalies ──────────────────────────────────┐   │
│  │  CRITICAL  DL4SDY2798  Delhi  Fault count 12 (avg 2)│   │
│  │  WARNING   MH12AB1234  Mumbai  Idle ratio 0.72       │   │
│  │  WARNING   KA01CD5678  B'luru  Stopped reporting     │   │
│  │  ... (sorted by severity)                             │   │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Risk by Location ───────────────────────────────────┐   │
│  │  Delhi ████████████ 42 vehicles at risk              │   │
│  │  Mumbai ██████ 18 vehicles at risk                    │   │
│  │  B'luru ████ 12 vehicles at risk                      │   │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Data source:** `fleet_health`, `anomaly_log` (agent=fleet_anomaly)

### Dashboard 2: Battery Health

```
┌──────────────────────────────────────────────────────────────┐
│  BATTERY HEALTH DASHBOARD                      Date: Mar 20  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ SoH Distribution ───────────────────────────────────┐   │
│  │  Healthy (90-100%)  ████████████████████ 612 packs   │   │
│  │  Good (80-90%)      ████████████ 198 packs            │   │
│  │  Fair (70-80%)      ███ 45 packs                      │   │
│  │  Degraded (60-70%)  █ 12 packs ← MONITOR             │   │
│  │  Critical (<60%)    ▏ 3 packs  ← REPLACE             │   │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Risk Flagged Packs (high + critical) ───────────────┐   │
│  │  CRITICAL  ZENE1234  DL4SDY2798  SoH: 52%  Delhi    │   │
│  │  HIGH      ZEAA5678  MH12AB1234  SoH: 63%  Mumbai   │   │
│  │  ... (15 packs flagged this week)                     │   │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Batch Performance ──────────────────────────────────┐   │
│  │  Batch    Packs   Avg SoH   Flagged%   Verdict       │   │
│  │  B2025-A  120     88.3%     2.5%       OK            │   │
│  │  B2025-B  85      82.1%     8.2%       MONITOR       │   │
│  │  B2024-Q  45      71.2%     22.2%      INVESTIGATE   │   │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Firmware Impact ────────────────────────────────────┐   │
│  │  v2.3.1   230 packs  avg degrade: 0.8%/mo   OK      │   │
│  │  v2.2.0   180 packs  avg degrade: 1.2%/mo   MONITOR │   │
│  │  v2.1.3   60 packs   avg degrade: 2.1%/mo   FLAG    │   │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Data source:** `battery_risk`, `anomaly_log` (agent=battery_degradation), `firmware_map`

### Dashboard 3: Complaint & Service

```
┌──────────────────────────────────────────────────────────────┐
│  COMPLAINT & SERVICE DASHBOARD                 Date: Mar 20  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │Complaint │  │ Top      │  │ MTTR     │  │ Repeat   │    │
│  │ per 100  │  │ Issue    │  │ (avg)    │  │ Repairs  │    │
│  │  4.2     │  │ Battery  │  │ 18.5 hrs │  │  12.3%   │    │
│  │ vehicles │  │ 34%      │  │ ▼2.1hrs  │  │  ▲1.8%   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  ┌─ Top Recurring Issues ───────────────────────────────┐   │
│  │  battery_issue      ████████████████ 142 complaints  │   │
│  │  charging_failure   ████████ 67 complaints            │   │
│  │  motor_problem      █████ 41 complaints               │   │
│  │  range_anxiety      ████ 35 complaints                │   │
│  │  electrical_fault   ███ 28 complaints                 │   │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Vehicles with Repeated Complaints (>2 in 30 days) ──┐   │
│  │  DL4SDY2798  5 complaints  battery_issue, charging    │   │
│  │  MH12AB1234  4 complaints  motor_problem (3x)         │   │
│  │  ... (18 vehicles flagged)                             │   │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Root Cause Distribution (Service Logs) ─────────────┐   │
│  │  battery_cell_failure  ████████ 23%                   │   │
│  │  bms_fault             ██████ 17%                     │   │
│  │  connector_loose       █████ 14%                      │   │
│  │  firmware_bug          ████ 11%                       │   │
│  │  wear_and_tear         ███ 9%                         │   │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Data source:** `complaints`, `service_logs`, `anomaly_log`

### Weekly Executive Ops Health Report (AI-Generated)

```typescript
async function generateWeeklyOpsHealthReport() {
  // Gather outputs from all 4 agents (this week's reports)
  const fleetReport = await getLatestReport("fleet_anomaly_daily", 7); // Last 7 daily reports
  const batteryReport = await getLatestReport("battery_risk_weekly");
  const complaintReport = await getLatestReport("complaint_weekly");
  const serviceReport = await getLatestReport("service_weekly");

  const prompt = `You are the Executive Ops Intelligence system for EMO.

Synthesize the following agent reports into a Weekly Ops Health Narrative for the leadership team.

FLEET ANOMALY SUMMARY (past 7 days):
${fleetReport.map(r => r.summary).join("\n")}

BATTERY RISK SUMMARY:
${batteryReport.summary}

COMPLAINT INTELLIGENCE:
${complaintReport.summary}

SERVICE ROOT CAUSE ANALYSIS:
${serviceReport.summary}

PRODUCE THE WEEKLY OPS HEALTH NARRATIVE:

1. **Top 5 Fleet Risks** — What's most likely to cause vehicle downtime this week?
2. **Top 5 Battery Risks** — Which packs/batches/firmware need immediate attention?
3. **Operational Instability Signals** — What patterns are emerging that aren't yet critical but trending badly?
4. **Escalation Recommendations** — What requires human decision-making NOW?
5. **Wins This Week** — What improved? What's working?

Be specific. Name vehicle IDs, pack IDs, batch IDs, firmware versions, and cities.
Don't be generic. Every insight must be backed by data from the reports above.`;

  const narrative = await callClaude(prompt, { model: "claude-sonnet-4-6" });

  await storeReport({
    reportType: "weekly_health",
    reportDate: today(),
    content: narrative,
    summary: extractFirstParagraph(narrative),
    agentName: "executive_ops",
  });
}
```

**Report distribution:**
- Stored in `ops_reports` table
- Queryable via chat: "Show me this week's ops health report"
- Future: emailed to leadership, pushed to Slack/Notion

### Week 3 Deliverables

- [ ] Fleet Stability Dashboard: live with today's anomaly data
- [ ] Battery Health Dashboard: live with SoH distribution, batch comparison, firmware impact
- [ ] Complaint & Service Dashboard: live with complaint density, top issues, MTTR, root causes
- [ ] Weekly Ops Health Report: first AI-generated executive narrative produced
- [ ] Dashboard data served via new API endpoints (`GET /api/intelligence/fleet`, `/battery`, `/complaints`, `/report`)
- [ ] Reports accessible through existing chat interface
- [ ] All 4 agents running on schedule, outputs accumulating in `anomaly_log` and `ops_reports`

---

## Days 22–60 — Maturation Phase

### Week 4–5: Data Quality Hardening

- [ ] Backfill historical data: load as much Intellicar/IoT/SENS history as available
- [ ] Linking key coverage: target 95%+ of active vehicles have vehicle_id → pack_id → firmware mapping
- [ ] Complaint backfill: all historical MongoDB complaints migrated with pack_id enrichment
- [ ] Anomaly threshold tuning: adjust agent thresholds based on first 2 weeks of real data (reduce false positives)
- [ ] Add confidence scores to anomaly detection (how certain is the agent?)

### Week 5–6: Agent Intelligence Improvement

- [ ] Fleet Anomaly Agent: add seasonal/weather adjustments (idle time spikes in monsoon are normal)
- [ ] Battery Agent: add charge cycle normalization (pack age matters)
- [ ] Complaint Agent: add NLP clustering on free-text complaint descriptions (not just category)
- [ ] Service Agent: add predictive element — "Vehicles likely to need service in next 7 days based on telemetry patterns"

### Week 7–8: Cross-Agent Correlation

- [ ] Build correlation engine: when Fleet Anomaly flags a vehicle AND Battery Agent flags its pack AND there's a recent complaint — auto-escalate to CRITICAL
- [ ] Composite risk score per vehicle: weighted combination of fleet health, battery health, complaint history, service history
- [ ] "Vehicle 360" view: single query returns everything known about a vehicle across all 5 data streams

### Week 9–10: Alerting & Escalation

- [ ] Real-time alert rules: "If any vehicle has fault_count > 10, alert immediately"
- [ ] Escalation tiers: info → Slack channel, warning → email to city manager, critical → SMS to ops head
- [ ] Suppression rules: don't alert on the same vehicle for the same issue within 24h
- [ ] Alert acknowledgment workflow: who saw it, what action was taken

---

## Days 61–90 — Operational Autonomy

### Week 11–12: Predictive Models

- [ ] Battery replacement predictor: "These 15 packs will drop below 60% SoH within 30 days" — based on degradation slope extrapolation
- [ ] Failure predictor: "Vehicles with this telemetry pattern have a 73% chance of breakdown within 7 days" — based on historical fleet anomaly → complaint → service correlation
- [ ] Firmware impact scorer: when a new firmware is deployed, automatically track its impact on degradation rates within 14 days

### Week 12–13: Feedback Loops

- [ ] Service outcome tracking: after a service log is filed, did the complaint recur? Feed this back to Service Root Cause Agent
- [ ] Factory feedback: anomaly patterns traced to batch IDs → structured report sent to manufacturing (MES feedback loop)
- [ ] Firmware rollback signals: if a firmware version correlates with degradation spikes, auto-generate rollback recommendation

### Week 13: Full System Maturity Assessment

- [ ] Measure: Has repeated failure rate decreased?
- [ ] Measure: Has MTTR improved?
- [ ] Measure: Are we catching pack replacements before catastrophic failure?
- [ ] Measure: Is firmware impact visible within 2 weeks of deployment?
- [ ] Measure: Has complaint density per 100 vehicles decreased?
- [ ] System confidence report: how accurate have the anomaly detections been? (precision/recall vs actual incidents)

---

## Mandatory Rules

These are non-negotiable. If data doesn't meet these standards, the intelligence layer produces garbage.

| Rule | Enforcement |
|---|---|
| **No complaint without Vehicle ID and Pack ID** | Form validation. Reject submission if missing. |
| **No service entry without root cause tag** | Form validation. Root cause is required field, selected from standardized enum. |
| **No firmware deployment without version mapping** | Firmware deployment process must create a `firmware_map` record. No exceptions. |
| **All issues logged structured, not WhatsApp only** | WhatsApp messages are not data. If it didn't go into the system, it didn't happen. |
| **Linking keys must be maintained** | `vehicle_pack_map` is updated on every deployment, every pack swap. If a linking key is broken, it's a P0 data bug. |

---

## Key Metrics (60–90 Day Targets)

| Metric | Current State | 30-Day Target | 60-Day Target | 90-Day Target |
|---|---|---|---|---|
| **Repeated failures (same vehicle, same issue, 30 days)** | Unknown | Measured | -20% | -40% |
| **MTTR (mean time to resolve)** | Unknown | Measured | -15% | -30% |
| **Early pack replacement (predicted before failure)** | 0% | 10% | 40% | 70% |
| **Firmware impact visibility** | None | Awareness | Within 14 days | Within 7 days |
| **Complaint density (per 100 vehicles/month)** | Unknown | Measured | -10% | -25% |
| **Linking key coverage** | ~40% (est.) | 80% | 95% | 99% |
| **Anomaly detection accuracy** | N/A | Baseline | 70% precision | 85% precision |

---

## Technical Implementation Details

### Project Structure (Separate Backend & Frontend)

```
ops-agent/
  │
  ├── backend/                           # Node.js/Express + Prisma + LangGraph
  │   ├── prisma/
  │   │   └── schema.prisma              # All 22+ table definitions
  │   ├── src/
  │   │   ├── config/
  │   │   │   └── env.ts                 # All env vars: DB URLs, JWT, API keys, LLM keys
  │   │   ├── auth/
  │   │   │   ├── jwt.ts                 # JWT generation & verification
  │   │   │   ├── middleware.ts          # requireAuth Express middleware
  │   │   │   └── rbac.ts               # Location-scoped access (org hierarchy)
  │   │   ├── db/
  │   │   │   ├── prisma.ts             # Prisma client singleton
  │   │   │   ├── registry.ts           # Pluggable database registry
  │   │   │   └── connectors/
  │   │   │       ├── postgres.ts        # Neon PostgreSQL via Prisma
  │   │   │       ├── mongodb.ts         # MongoDB Atlas connector (existing logic)
  │   │   │       └── csv.ts            # CSV-as-database connector (DuckDB or temp table)
  │   │   ├── agents/
  │   │   │   ├── graph/
  │   │   │   │   ├── index.ts          # Main LangGraph definition
  │   │   │   │   ├── state.ts          # AgentState type
  │   │   │   │   ├── nodes/            # router, fleet, battery, complaint, service, general, csv, report
  │   │   │   │   └── edges/            # routing.ts, escalation.ts
  │   │   │   ├── intelligence/          # Scheduled agents (fleet-anomaly, battery, complaint, service, exec report)
  │   │   │   │   └── scheduler.ts
  │   │   │   ├── tools/                 # db-query, csv-query, anomaly-lookup, vehicle-360, kpi-compute
  │   │   │   └── local-engine.ts        # Keep existing pattern matcher as a LangChain tool
  │   │   ├── channels/
  │   │   │   ├── whatsapp/
  │   │   │   │   ├── webhook.ts         # WhatsApp Business API webhook
  │   │   │   │   └── formatter.ts
  │   │   │   ├── email/
  │   │   │   │   ├── gmail-client.ts    # Gmail API client
  │   │   │   │   ├── parser.ts
  │   │   │   │   └── sender.ts
  │   │   │   └── web/
  │   │   │       └── websocket.ts       # WebSocket for real-time chat streaming
  │   │   ├── ingestion/
  │   │   │   ├── pipeline.ts            # Orchestrator
  │   │   │   ├── extractors/            # intellicar, iot, sens, complaints, service-logs
  │   │   │   ├── transformers/          # linking-resolver, validator, dedup
  │   │   │   └── loaders/               # postgres-loader
  │   │   ├── routes/
  │   │   │   ├── auth.ts                # /api/auth/*
  │   │   │   ├── chat.ts               # /api/chat (HTTP + WS upgrade)
  │   │   │   ├── intelligence.ts        # /api/intelligence/* (dashboard data)
  │   │   │   ├── reports.ts             # /api/reports/* (scheduled reports CRUD)
  │   │   │   ├── csv.ts                 # /api/csv/upload, /api/csv/:id/query
  │   │   │   ├── service-form.ts        # /api/service-log
  │   │   │   ├── users.ts              # /api/users/*
  │   │   │   ├── kpi.ts                # /api/kpi/*
  │   │   │   └── alerts.ts             # /api/alerts/*
  │   │   ├── uploads/                   # CSV file storage (gitignored)
  │   │   └── server.ts                  # Express app + WS + scheduler bootstrap
  │   ├── .env                           # Backend secrets (gitignored)
  │   ├── package.json
  │   └── tsconfig.json
  │
  ├── frontend/                          # React + Vite SPA
  │   ├── src/
  │   │   ├── app/
  │   │   │   └── routes/                # Pages (login, dashboard, chat, reports, settings)
  │   │   ├── components/
  │   │   │   ├── ui/                    # shadcn/ui components
  │   │   │   ├── chat/                  # ChatWindow, MessageBubble, CSVAttachment, ScheduleReportDialog
  │   │   │   ├── dashboard/             # FleetStabilityBoard, BatteryHealthBoard, ComplaintServiceBoard, KPICard
  │   │   │   └── layout/               # Sidebar, TopBar, CommandPalette
  │   │   ├── hooks/                     # useAuth, useChat, useConversations, useDashboard
  │   │   ├── lib/                       # api.ts, ws.ts, csv.ts utilities
  │   │   └── stores/                    # Zustand stores (auth, chat, ui)
  │   ├── index.html
  │   ├── vite.config.ts
  │   ├── tailwind.config.ts
  │   ├── .env                           # Frontend env (VITE_API_URL, etc.)
  │   └── package.json
  │
  └── plan.md                            # This document
```

### Backend Dependencies

```bash
cd backend

# Core
npm install @prisma/client express cors dotenv node-cron pino pino-pretty jsonwebtoken bcryptjs ws multer
npm install -D prisma typescript tsx @types/node @types/express @types/cors @types/jsonwebtoken @types/bcryptjs @types/ws @types/multer

# LangChain + LangGraph
npm install @langchain/core @langchain/langgraph @langchain/anthropic @langchain/community langchain

# Existing (carry over)
npm install mongodb @anthropic-ai/sdk @google/generative-ai

# Init Prisma
npx prisma init

# Channels (future)
npm install googleapis                            # Gmail
npm install twilio                                # WhatsApp
```

| Package | Purpose | Phase |
|---|---|---|
| `@prisma/client` + `prisma` (dev) | Neon PostgreSQL ORM + type-safe queries + migrations | Week 1 |
| `@langchain/core` + `@langchain/langgraph` | Multi-agent orchestration graph | Week 1 |
| `@langchain/anthropic` | Claude LLM integration via LangChain | Week 1 |
| `ws` | WebSocket server for streaming chat | Week 1 |
| `multer` | File upload middleware (CSV) | Week 1 |
| `node-cron` | Scheduled agent execution + report scheduling | Week 1 |
| `pino` + `pino-pretty` | Structured logging | Week 1 |
| `jsonwebtoken` + `bcryptjs` | JWT auth + password hashing | Week 1 |
| `googleapis` | Gmail bot (context collector) | Week 4+ |
| `twilio` | WhatsApp bot | Week 4+ |

### Frontend Dependencies

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install react-router-dom@7 zustand @tanstack/react-query
npm install tailwindcss @tailwindcss/vite shadcn
npm install recharts react-dropzone lucide-react
npm install socket.io-client                      # Or native WebSocket
```

| Package | Purpose |
|---|---|
| `react` + `vite` | Core frontend framework + build tool |
| `react-router-dom` v7 | Client-side routing |
| `zustand` | Lightweight state management |
| `@tanstack/react-query` | Server state + caching |
| `tailwindcss` + `shadcn/ui` | Styling + component library |
| `recharts` | Dashboard charts |
| `react-dropzone` | CSV drag-and-drop upload |
| `lucide-react` | Icon set |

### API Endpoints (New)

**Auth & Users (no auth required for login/register):**

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `POST /api/auth/register` | POST | — | Create user account (admin-only in production) |
| `POST /api/auth/login` | POST | — | Authenticate → returns JWT |
| `GET /api/auth/me` | GET | Bearer | Get current user profile + permissions |
| `GET /api/users` | GET | Admin | List users (filtered by org scope) |
| `PATCH /api/users/:id` | PATCH | Admin | Update user role, org node, active status |

**Intelligence & Dashboards (all require Bearer token, data scoped by org hierarchy):**

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/service-log` | POST | Submit structured service log entry |
| `GET /api/intelligence/fleet` | GET | Fleet stability dashboard data |
| `GET /api/intelligence/battery` | GET | Battery health dashboard data |
| `GET /api/intelligence/complaints` | GET | Complaint & service dashboard data |
| `GET /api/intelligence/anomalies?date=YYYY-MM-DD&severity=critical` | GET | Query anomaly log |
| `GET /api/intelligence/reports?type=weekly_health` | GET | Get AI-generated reports |
| `POST /api/intelligence/run/:agent` | POST | Manually trigger an agent run (admin/vp only) |
| `GET /api/intelligence/vehicle/:id` | GET | Vehicle 360 view (all data streams) |

**KPIs & Alerts:**

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `GET /api/kpi/definitions` | GET | Bearer | List all KPI definitions |
| `GET /api/kpi/snapshots?kpi=fleet_utilization&period=daily` | GET | Bearer | Get KPI values (scoped by org) |
| `POST /api/alerts/rules` | POST | Bearer | Create an alert rule |
| `GET /api/alerts/rules` | GET | Bearer | List user's alert rules |
| `GET /api/alerts/history` | GET | Bearer | Alert delivery history |

**Conversations & Chat (all require Bearer token):**

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/conversations` | GET | List user's chat conversations |
| `GET /api/conversations/:id/messages` | GET | Get messages in a conversation |
| `POST /api/conversations/:id/bookmark` | POST | Bookmark a message |
| `POST /api/chat` | POST | Send message (HTTP — for simple queries) |
| `WS /ws/chat` | WebSocket | Real-time streaming chat (primary interface) |

**CSV Upload & Query:**

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/csv/upload` | POST | Upload CSV file (multipart/form-data) → returns file ID + schema |
| `GET /api/csv/:id/preview` | GET | Preview first 50 rows of uploaded CSV |
| `POST /api/csv/:id/query` | POST | Natural language query against stored CSV |
| `GET /api/csv/list` | GET | List user's uploaded CSVs |

**Scheduled Reports:**

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/reports/scheduled` | GET | List user's scheduled reports |
| `POST /api/reports/schedule` | POST | Create a new scheduled report |
| `PATCH /api/reports/scheduled/:id` | PATCH | Update schedule/scope/delivery |
| `DELETE /api/reports/scheduled/:id` | DELETE | Cancel a scheduled report |
| `POST /api/reports/scheduled/:id/run` | POST | Manually trigger a scheduled report now |

### LLM Strategy (via LangChain)

| Use Case | Model | LangGraph Node | Why |
|---|---|---|---|
| Intent routing / classification | Claude Haiku 4.5 | `router` | Fast, cheap classification |
| Ad-hoc data queries | Claude Haiku 4.5 | `general-agent` | Fast lookup, simple answers |
| Fleet anomaly analysis | Claude Sonnet 4.6 | `fleet-agent` + scheduled | Reasoning over baselines + deviations |
| Battery degradation analysis | Claude Sonnet 4.6 | `battery-agent` + scheduled | Correlation across firmware/batch/temp |
| Complaint correlation | Claude Sonnet 4.6 | `complaint-agent` + scheduled | Cross-stream pattern detection |
| Service root cause | Claude Sonnet 4.6 | `service-agent` + scheduled | Multi-factor root cause reasoning |
| CSV data querying | Claude Sonnet 4.6 | `csv-agent` | SQL generation over unknown schemas |
| Executive report generation | Claude Sonnet 4.6 | `report-agent` + scheduled | Quality narrative synthesis |
| Fallback (Anthropic down) | Gemini 2.0 Flash | Any node | Backup — LangChain model swap |

---

## Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Intellicar/IoT/SENS API access delayed** | HIGH | Start with CSV imports. Build API integration in parallel. The pipeline architecture supports both. |
| 2 | **Linking keys are worse than expected** | CRITICAL | Week 1 Day 2–3 is entirely dedicated to this. If >30% of vehicles have broken links, escalate immediately. Manual mapping sprint. |
| 3 | **Service logs don't exist yet** | MEDIUM | Agent 4 (Service Root Cause) will have limited data initially. Start with what's in Complaindatabase. New form goes live Day 5. |
| 4 | **LLM hallucination in anomaly reports** | MEDIUM | Every anomaly must cite specific data (vehicle ID, metric value, baseline). Post-processing validates that cited IDs exist in the data. |
| 5 | **Data volume too high for in-memory processing** | LOW | PostgreSQL handles aggregation. Agents query pre-aggregated views, not raw telemetry. |
| 6 | **False positive flood** | MEDIUM | First 2 weeks: agents run but anomalies are reviewed manually. Thresholds tuned in Week 4–5 based on real data. |
| 7 | **Field team doesn't adopt structured logging** | HIGH | Make the service form mandatory. No ticket closure without a service log entry. Enforce at process level, not just tech level. |

---

## What Happens Next

**Phase 0 — Foundation (starting now):**

1. **Backend scaffold** — Express + Neon PostgreSQL + Prisma ORM + env config
2. **Schema migration** — Run all 22 table CREATE statements against Neon
3. **LangGraph setup** — Router agent + general query agent working end-to-end
4. **Frontend scaffold** — React + Vite + Tailwind + shadcn/ui + routing
5. **WebSocket chat** — Streaming chat between frontend and LangGraph backend
6. **Auth** — JWT login/register, RBAC middleware, org hierarchy scoping

**Phase 1 — Data (Week 1):**
- Complaint migration: MongoDB → PostgreSQL with linking key enrichment
- vehicle_pack_map built from deployment data
- Ingestion pipeline scaffold (extractor stubs for Intellicar, IoT, SENS)
- Service log form endpoint

**Phase 2 — Intelligence (Week 2):**
- 4 scheduled intelligence agents running via LangGraph
- Agent outputs queryable from chat
- CSV upload + query working

**Phase 3 — Dashboards & Reports (Week 3):**
- 3 React dashboard pages with live data
- Scheduled report system (user-defined cron + delivery)
- Executive weekly ops health narrative

**Phase 4 — Channels (Week 4+):**
- WhatsApp bot integration
- Gmail bot integration
- Multi-channel conversation unification

---

## Long-Term Strategic Impact

If done correctly:

- **We will know fleet risk before riders feel it.** The Fleet Anomaly Agent catches fault code spikes and idle abuse patterns days before a breakdown.

- **We will know firmware impact before complaints spike.** The Battery Degradation Agent correlates firmware versions with degradation rates within 7–14 days of deployment.

- **We will detect degradation before catastrophic failure.** The Battery Agent predicts pack replacement needs 30–90 days in advance.

- **We will reduce reactive firefighting.** The Service Root Cause Agent identifies repeat failure patterns, so we fix the root cause, not the symptom.

- **EMO becomes operationally intelligent.** Every week, the system produces an AI-synthesized health report that tells leadership exactly what needs attention and why.

This is how EMO moves from reactive to predictive.

---

*This document is the execution plan for the EMO Ops Intelligence Layer. It is updated as the build progresses.*
