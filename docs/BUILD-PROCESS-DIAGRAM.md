## Build Process and Startup Diagram

The diagrams below show how the application is built in each mode and how the three server processes relate to each other at runtime.

---

### Docker multi-stage build

```mermaid
flowchart TD
  subgraph Build["Stage 1 — build (node:20-alpine)"]
    B1["COPY project files into image"]
    B2["rm -rf node_modules (strip host binaries)"]
    B3["npm install (root deps)"]
    B4["cd server && npm install\n(compiles better-sqlite3 for Alpine/musl)"]
    B5["cd client && npm install"]
    B6["npm run build → client/dist/\n(Vite bundles React + bakes VITE_* env vars)"]
    B1 --> B2 --> B3 --> B4 --> B5 --> B6
  end

  subgraph Runtime["Stage 2 — runtime (node:20-alpine)"]
    R1["Fresh Alpine image\n(no build tools)"]
    R2["apk add sqlite\nnpm install -g pm2"]
    R3["COPY --from=build /app /app\n(compiled node_modules + client/dist/)"]
    R4["pm2-runtime ecosystem.config.js"]
    R1 --> R2 --> R3 --> R4
  end

  Build -->|"artifacts copied"| Runtime

  subgraph Processes["PM2-managed processes (inside container)"]
    P1["jamaica-api\nserver/index.js · port 3001\npmx:false (APM disabled)"]
    P2["jamaica-status\nserver/status-board.js · port 5555\nAPI_HOST=127.0.0.1"]
    P3["jamaica-admin\nserver/admin.js · port 5556\nAPI_HOST=127.0.0.1"]
  end

  subgraph Volume["Named volume — jamaica_data"]
    V1["jamaica.db\n.flight-cache.json\n.weather-cache.json"]
  end

  R4 --> Processes
  P1 -->|"JAMAICA_DATA_DIR=/data"| Volume

  classDef stage fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef proc fill:#111827,stroke:#4b5563,color:#e5e7eb;
  classDef vol fill:#020617,stroke:#6b7280,color:#e5e7eb;
  class Build,Runtime stage;
  class Processes proc;
  class Volume vol;
```

---

### Docker Compose deployment paths

```mermaid
flowchart TD
  Dev["Developer machine\n(source code)"]

  subgraph BuildPath["docker-compose-build.yml\n(build from source)"]
    BP1["docker compose … up -d --build"]
    BP2["Dockerfile build stage\n(compile native modules,\nbundle React client)"]
    BP3["Local image\njamaica-explorer:latest"]
    BP1 --> BP2 --> BP3
  end

  subgraph ProdPath["docker-compose-prod.yml\n(pull pre-built image)"]
    PP1["docker compose … up -d"]
    PP2["Docker Hub\nmaxwayne/jamaica-explorer:1.0"]
    PP3["Pulled image"]
    PP1 -->|"docker pull"| PP2 --> PP3
  end

  Dev -->|"run from project root"| BuildPath
  Dev -->|"run on server\n(no source needed)"| ProdPath

  subgraph Container["Running container"]
    C1["pm2-runtime ecosystem.config.js"]
    C2["jamaica-api · 3001\njamaica-status · 5555\njamaica-admin · 5556"]
    C1 --> C2
  end

  BP3 -->|"container started"| Container
  PP3 -->|"container started"| Container

  classDef path fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef hub fill:#1c1917,stroke:#78716c,color:#e7e5e4;
  classDef run fill:#111827,stroke:#4b5563,color:#e5e7eb;
  class BuildPath,ProdPath path;
  class PP2 hub;
  class Container run;
```

---

### Runtime architecture (all modes)

```mermaid
flowchart LR
  Browser["Browser\n(React SPA)"]

  subgraph Ports["Exposed ports"]
    P3001["3001 (or HOST_PORT)\nApp + API"]
    P5555["5555\nStatus board"]
    P5556["5556\nAdmin dashboard"]
  end

  subgraph API["jamaica-api\nserver/index.js"]
    Static["client/dist/ (static files)"]
    Routes["API routes\n/api/*"]
    DB[("jamaica.db\n(JAMAICA_DATA_DIR)")]
    FC[(".flight-cache.json")]
    WC[(".weather-cache.json")]
  end

  subgraph Status["jamaica-status\nserver/status-board.js"]
    SJ["GET /status.json\nprobes all internal endpoints"]
  end

  subgraph Admin["jamaica-admin\nserver/admin.js"]
    AH["GET / — dashboard\nPOST /api/restart"]
  end

  Browser -->|"app UI"| P3001
  Browser -->|"monitoring"| P5555
  Browser -->|"management"| P5556

  P3001 --> Static
  P3001 --> Routes
  P5555 --> Status
  P5556 --> Admin

  Routes --> DB
  Routes --> FC
  Routes --> WC

  Status -->|"HTTP probes\n(API_HOST:3001)"| Routes
  Admin -->|"proxy restart\n(API_HOST:3001)"| Routes

  classDef browser fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef api fill:#111827,stroke:#4b5563,color:#e5e7eb;
  classDef sidecar fill:#0d1117,stroke:#4b5563,color:#d1d5db;
  classDef data fill:#020617,stroke:#6b7280,color:#e5e7eb;

  class Browser browser;
  class API api;
  class Status,Admin sidecar;
  class DB,FC,WC data;
```

---

### Data directory (`JAMAICA_DATA_DIR`)

```mermaid
flowchart TD
  DD["server/data-dir.js\ngetDataDir()"]

  Env{"JAMAICA_DATA_DIR\nenv var set?"}
  DD --> Env

  Env -->|"yes"| Custom["path.resolve(JAMAICA_DATA_DIR)\ne.g. /data (Docker)\nor /var/lib/jamaica (VM)"]
  Env -->|"no"| Default["path.join(__dirname)\n= server/ directory"]

  subgraph Files["Files written there"]
    F1["jamaica.db"]
    F2[".flight-cache.json"]
    F3[".weather-cache.json"]
  end

  Custom --> Files
  Default --> Files

  subgraph Callers["Modules that call getDataDir()"]
    C1["server/db/connection.js\n(opens SQLite)"]
    C2["server/routes/flights.js\n(flight cache)"]
    C3["server/routes/weather.js\n(weather cache)"]
  end

  Files -.->|"used by"| Callers
```
