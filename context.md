# Referral Engine — Project Context

## What We Are Building

A fraud-proof referral system where users are nodes and referrals are directed edges in a
Directed Acyclic Graph (DAG). The core invariant is: NO cycles are ever allowed.
Every referral claim must be validated with real-time cycle detection before committing.

---

## Tech Stack

- Backend: Python 3.11, FastAPI, SQLAlchemy (async), PostgreSQL, Redis
- Frontend: React 18, react-flow (graph viz), recharts (metrics), Axios
- Infra: Docker Compose (postgres + redis + api + frontend)

---

## Database Schema

### Table: users
```sql
user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid()
username       VARCHAR(100) NOT NULL
email          VARCHAR(255) UNIQUE NOT NULL
referrer_id    UUID REFERENCES users(user_id) NULL
reward_balance DECIMAL(12,2) DEFAULT 0.0
status         VARCHAR(20) DEFAULT 'active'  -- active | flagged | root
created_at     TIMESTAMP DEFAULT now()
```

### Table: referrals
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
child_id         UUID REFERENCES users(user_id)
parent_id        UUID REFERENCES users(user_id)
status           VARCHAR(20) DEFAULT 'valid'    -- valid | rejected | expired
rejection_reason VARCHAR(20) NULL               -- cycle | self_referral | velocity
created_at       TIMESTAMP DEFAULT now()
```

### Table: fraud_logs
```sql
id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
attempted_by UUID REFERENCES users(user_id)
attempted_ref UUID REFERENCES users(user_id)
reason       VARCHAR(20)   -- cycle | self_referral | velocity
timestamp    TIMESTAMP DEFAULT now()
```

### Table: reward_transactions
```sql
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
from_user   UUID REFERENCES users(user_id)
to_user     UUID REFERENCES users(user_id)
amount      DECIMAL(10,2)
depth_level INTEGER
created_at  TIMESTAMP DEFAULT now()
```

---

## Core Algorithm: Cycle Detection

File: `backend/graph.py`

Use iterative DFS. Never recursive (stack overflow risk on deep graphs).
The adjacency list is stored in Redis as a hash for sub-100ms lookups.

```python
def has_path(adj_list: dict, source: str, target: str) -> bool:
    """
    DFS: returns True if a path exists from source to target.
    Usage: has_path(adj_list, referrer_id, new_user_id)
    If True, adding the edge new_user -> referrer creates a cycle. Reject it.
    """
    visited = set()
    stack = [source]
    while stack:
        node = stack.pop()
        if node == target:
            return True
        if node not in visited:
            visited.add(node)
            stack.extend(adj_list.get(node, []))
    return False
```

Adjacency list shape: `{ parent_id: [child_id, child_id, ...] }`

Load from Redis on each request. Rebuild and cache after every committed or rejected edge.

---

## Referral Claim Logic

File: `backend/main.py` or `backend/referrals.py`

Execute checks in this exact order. Do not reorder.

```
POST /referral/claim
Body: { new_user_id, referrer_id }

STEP 1 — Self-referral check
  if new_user_id == referrer_id:
    insert fraud_log(reason='self_referral')
    set user.status = 'root', user.referrer_id = NULL
    insert referral(status='rejected', rejection_reason='self_referral')
    return 400 { error: 'self_referral', action: 'assigned_as_root' }

STEP 2 — Velocity check via Redis
  key = "velocity:{referrer_id}"
  count = redis.incr(key)
  if count == 1: redis.expire(key, 60)
  if count > VELOCITY_LIMIT (default 5):
    insert fraud_log(reason='velocity')
    return 429 { error: 'velocity_limit' }

STEP 3 — Cycle check
  adj_list = load_from_redis()
  if has_path(adj_list, referrer_id, new_user_id):
    insert fraud_log(reason='cycle')
    set new_user.status = 'flagged', new_user.referrer_id = NULL
    insert referral(status='rejected', rejection_reason='cycle')
    return 409 { error: 'cycle_detected', action: 'assigned_as_root' }

STEP 4 — Commit (all checks passed)
  UPDATE users SET referrer_id = referrer_id WHERE user_id = new_user_id
  INSERT referral(child_id, parent_id, status='valid')
  UPDATE redis adj_list: adj_list[referrer_id].append(new_user_id)
  call distribute_rewards(new_user_id, referrer_id, depth=3)
  return 200 { status: 'committed' }
```

---

## Reward Engine

File: `backend/rewards.py`

```python
REWARD_CONFIG = {
    "depth": 3,
    "type": "percentage",
    "base_amount": 100,
    "rates": {
        1: 10.0,
        2: 5.0,
        3: 2.5
    }
}

def distribute_rewards(new_user_id: str, referrer_id: str, depth: int = 3):
    """
    Walk up the parent chain. Credit each ancestor based on depth level.
    Wrap the entire function body in a single DB transaction.
    """
    current = referrer_id
    for level in range(1, depth + 1):
        if not current:
            break
        rate = REWARD_CONFIG["rates"][level]
        amount = REWARD_CONFIG["base_amount"] * (rate / 100)
        # INSERT INTO reward_transactions (from_user, to_user, amount, depth_level)
        # UPDATE users SET reward_balance = reward_balance + amount WHERE user_id = current
        current = get_parent(current)
        # get_parent: SELECT referrer_id FROM users WHERE user_id = current
```

---

## API Endpoints

### POST /referral/claim
```
Request:  { "new_user_id": "uuid", "referrer_id": "uuid" }
Response: { "status": "committed" | "rejected", "reason": null | "cycle" | "self_referral" | "velocity" }
```

### GET /user/{id}/graph
```json
{
  "nodes": [
    { "id": "uuid", "label": "Alice", "status": "active", "balance": 250.0 }
  ],
  "edges": [
    { "source": "uuid", "target": "uuid", "level": 1, "valid": true }
  ]
}
```
Note: this shape maps directly to react-flow's nodes/edges props.

### GET /user/{id}/rewards
```json
{
  "balance": 250.0,
  "transactions": [
    { "from": "uuid", "amount": 10.0, "level": 1, "created_at": "..." }
  ]
}
```

### GET /fraud/flags
```json
{
  "flags": [
    { "attempted_by": "uuid", "attempted_ref": "uuid", "reason": "cycle", "timestamp": "..." }
  ]
}
```

### GET /dashboard/metrics
```json
{
  "total_users": 142,
  "total_referrals": 98,
  "valid_referrals": 91,
  "rejected_referrals": 7,
  "fraud_attempts": 4,
  "total_rewards_distributed": 8450.0,
  "referrals_over_time": [
    { "date": "2025-01-01", "valid": 8, "rejected": 1 }
  ],
  "rewards_by_depth": { "1": 4200.0, "2": 2800.0, "3": 1450.0 }
}
```

### POST /users
```
Request:  { "username": "Alice", "email": "alice@example.com" }
Response: { "user_id": "uuid", "username": "Alice", "status": "root" }
```

### GET /users
```
Response: [{ "user_id": "uuid", "username": "Alice", "status": "root", "balance": 250.0 }]
```

### GET /referral/feed
```
Response: [{ "type": "valid" | "blocked" | "reward", "message": "...", "timestamp": "..." }]
```

---

## Fraud Detection Rules

File: `backend/fraud.py`

Implement all three in order:

1. Self-referral: new_user_id == referrer_id
2. Velocity: more than 5 referral claims by the same referrer within 60 seconds (Redis INCR + EXPIRE)
3. Cycle: DFS on adj_list finds a path from referrer to new_user

On any fraud detection:
- INSERT into fraud_logs
- Set user.status = 'flagged'
- Set user.referrer_id = NULL (assign as root)
- Return appropriate error code

---

## Frontend Structure

```
src/
├── App.jsx
├── api/
│   └── client.js              # axios baseURL = http://localhost:8000
├── components/
│   ├── MetricsPanel.jsx       # calls GET /dashboard/metrics
│   ├── GraphView.jsx          # calls GET /user/{id}/graph, renders with react-flow
│   ├── FraudMonitor.jsx       # calls GET /fraud/flags
│   └── ActivityFeed.jsx       # calls GET /referral/feed, polls every 5s
└── hooks/
    └── usePolling.js          # setInterval wrapper
```

### GraphView.jsx
- Library: `import ReactFlow, { Background, Controls } from 'reactflow'`
- Node colors: root = #378ADD, active = #1D9E75, flagged = #BA7517
- Edge style: valid = solid green stroke, rejected = dashed red stroke
- User selector dropdown at top, fetches graph for selected user
- Each node shows: username, user_id (small), reward_balance

### MetricsPanel.jsx
- recharts LineChart: referrals_over_time, valid line green, rejected line red
- recharts PieChart: valid vs rejected ratio
- recharts BarChart: rewards_by_depth
- KPI cards in a CSS grid, 3 columns

### ActivityFeed.jsx
- Poll GET /referral/feed every 5000ms
- Color-coded dots: valid = green, blocked = red, reward = amber
- Prepend new items to top of list

---

## Seed Data Script

File: `backend/seed.py`

Create this exact DAG structure:

```
Alice (root)
├── Bob   (referred by Alice)
│   ├── Dave  (referred by Bob)
│   │   └── Hal (referred by Dave)
│   └── Eve   (referred by Bob)
└── Carol (referred by Alice)
    ├── Frank (FLAGGED — attempted cycle)
    └── Grace (referred by Carol)
```

Also seed:
- 5 fraud_log entries with a mix of reasons: cycle, self_referral, velocity
- Reward transactions for every valid referral at all three depth levels

---

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:15
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: referraldb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres

  redis:
    image: redis:7
    ports: ["6379:6379"]

  api:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:postgres@postgres/referraldb
      REDIS_URL: redis://redis:6379
    depends_on: [postgres, redis]

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    environment:
      VITE_API_URL: http://localhost:8000
    depends_on: [api]
```

---

## Backend Rules

- Use async SQLAlchemy with asyncpg driver throughout
- Pydantic v2 for all request and response schemas
- Add CORS middleware to FastAPI allowing all origins for local dev
- All IDs are UUIDs, never integers
- Keep adj_list in Redis in sync after every edge commit or rejection
- Reward distribution must be wrapped in a single atomic DB transaction
- Cycle detection must complete in under 100ms — always load adj_list from Redis, never query DB per request
- No authentication required

---

## File Layout

```
referral-engine/
├── backend/
│   ├── main.py           # FastAPI app, routes, CORS
│   ├── models.py         # SQLAlchemy ORM models
│   ├── schemas.py        # Pydantic v2 request/response models
│   ├── graph.py          # has_path() DFS, adj_list Redis cache helpers
│   ├── rewards.py        # distribute_rewards(), REWARD_CONFIG
│   ├── fraud.py          # check_self_referral(), check_velocity(), check_cycle()
│   ├── database.py       # async engine, session factory
│   └── seed.py           # seed script
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api/client.js
│   │   ├── components/
│   │   │   ├── MetricsPanel.jsx
│   │   │   ├── GraphView.jsx
│   │   │   ├── FraudMonitor.jsx
│   │   │   └── ActivityFeed.jsx
│   │   └── hooks/usePolling.js
│   └── package.json
├── docker-compose.yml
└── CONTEXT.md
```

---

## Bonus Features (implement after core is working)

1. Temporal expiry: referrals older than 90 days get status = 'expired', their edges are
   removed from adj_list. Run as a FastAPI background task on a schedule.

2. Simulation tool: POST /simulate/rewards accepts { rules: { depth, rates, base_amount } }
   and returns projected payout totals without writing anything to the DB.

3. WebSocket feed: ws://localhost:8000/ws/feed pushes events to ActivityFeed in real time
   instead of polling. Use FastAPI WebSocket + asyncio.Queue.