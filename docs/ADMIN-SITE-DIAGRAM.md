## Admin Site Diagrams

### Client App link resolution

```mermaid
flowchart TD
  PL[Dashboard page loads in browser]
  PL --> FE["Browser: GET /api/client-url\n→ admin server port 5556"]

  FE --> PR["admin.js probes:\nHEAD CLIENT_HOST:CLIENT_PORT\n(default 127.0.0.1:5173, 1 s timeout)"]

  PR -->|Reachable| VU["{ url: 'http://<host>:CLIENT_PORT/', viteAvailable: true }"]
  PR -->|Timeout / refused| PU["{ url: 'http://<host>:PUBLIC_API_PORT/', viteAvailable: false }"]

  VU --> BV["Browser sets Client App link\nto Vite dev URL (:5173)"]
  PU --> BP["Browser sets Client App link\nto production app URL (:PUBLIC_API_PORT)\nand adds tooltip: 'Vite dev server is offline'"]

  classDef good fill:#064e3b,stroke:#4ade80,color:#f0fdf4;
  classDef neutral fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef prod fill:#1e3a5f,stroke:#60a5fa,color:#eff6ff;

  class BV good;
  class BP prod;
  class PL,FE,PR,VU,PU neutral;
```

---

### Login flow

```mermaid
flowchart TD
  U[User] --> L[Clicks \"Login\" link on map page]
  L --> A[Requests Admin site:<br/>GET /login on port 5556]

  A --> F[Submits credentials:<br/>POST /login]
  F --> R{Rate-limit / lockout check by IP}
  R -->|Locked out| C1[Set cookie:<br/>login_error=locked]
  C1 -->|Redirect| A
  A --> M[Login page shows lockout message]

  R -->|Not locked| V{Validate username + password}
  V -->|Valid| S[Set cookie:<br/>admin_token=HMAC (HttpOnly, SameSite=Strict)]
  S -->|Redirect| D[Requests dashboard:<br/>GET /]
  V -->|Invalid| F2[Record failure attempt<br/>in sliding window]
  F2 --> C2[Set cookie:<br/>login_error=invalid]
  C2 -->|Redirect| A

  D --> AM{authMiddleware checks admin_token cookie}
  AM -->|Authenticated| OK[Admin dashboard content]
  AM -->|Not authenticated| A
```


---

### Restart flow

```mermaid
flowchart TD
  U[Admin user clicks\nRestart API / Restart All]

  U --> BR["Browser: POST /api/restart\n{ target: 'api' | 'all' | 'status' }\n→ admin server port 5556"]

  BR --> T{target?}

  T -->|"admin"| SA["admin.js runs:\npm2 restart jamaica-admin\n(self-restart — no proxy needed)"]
  SA --> SD["Process dies; browser shows\n'Restarting…' and reloads after 3 s"]

  T -->|"api / status / all"| PX["admin.js proxies:\nPOST /api/admin/restart\n→ API server 127.0.0.1:3001\nX-Admin-Token: <token>"]

  PX --> AV{API validates\nX-Admin-Token}
  AV -->|"invalid / missing"| F403["403 Forbidden\n→ toast: Restart failed"]
  AV -->|"valid"| PM["API calls:\npm2 restart <target>"]

  PM --> KP["PM2 kills target process\n(jamaica-api / all)"]
  KP --> CR["TCP connection drops\nECONNRESET / EPIPE\nbefore API can respond"]

  CR --> EH{"admin proxy\nerror handler"}
  EH -->|"ECONNRESET or EPIPE"| OK["{ ok: true, note: 'Connection reset\n— target is restarting' }\n→ green toast: Restarted successfully"]
  EH -->|"other error\n(ENOTFOUND, timeout…)"| ERR["502 { ok: false, error: '…' }\n→ red toast: Restart failed"]

  PM --> RP["PM2 starts fresh process\n(jamaica-api back online)"]

  classDef good fill:#064e3b,stroke:#4ade80,color:#f0fdf4;
  classDef bad fill:#7f1d1d,stroke:#f97373,color:#fef2f2;
  classDef neutral fill:#0b1020,stroke:#1f2937,color:#f9fafb;

  class OK,SD good;
  class F403,ERR bad;
  class U,BR,T,PX,AV,PM,KP,CR,EH,RP,SA neutral;
```

---

### Database backup and restore

```mermaid
flowchart TD
  U[Admin user:\nDownload backup or upload .sql + RESTORE]

  U -->|GET| GB["Browser: GET /api/database/backup\n→ admin :5556"]
  U -->|POST multipart| RB["Browser: POST /api/database/restore\nfields: backup=file, confirm=RESTORE"]

  GB --> PXB["admin.js proxies:\nGET /api/admin/database/backup\n→ API :3001\nX-Admin-Token"]
  RB --> PXR["admin.js proxies:\nPOST /api/admin/database/restore\nX-Admin-Token"]

  PXB --> AV{API:\nvalid token?}
  PXR --> AV
  AV -->|no| F403["403 → toast / JSON error"]
  AV -->|yes| DUMP["spawn pg_dump\n--clean --if-exists …\nstream SQL to response"]
  AV -->|yes| SQL["spawn psql\nON_ERROR_STOP\nstdin = uploaded SQL"]

  DUMP --> PG[(PostgreSQL\nDATABASE_URL)]
  SQL --> PG

  DUMP -->|200| DL["Browser saves\njamaica-db-*.sql"]
  SQL -->|200 / 500| TR["JSON ok or\ndetail from stderr"]

  classDef good fill:#064e3b,stroke:#4ade80,color:#f0fdf4;
  classDef bad fill:#7f1d1d,stroke:#f97373,color:#fef2f2;
  classDef neutral fill:#0b1020,stroke:#1f2937,color:#f9fafb;

  class DL,TR good;
  class F403 bad;
  class U,GB,RB,PXB,PXR,AV,DUMP,SQL,PG neutral;
```

---

### Database tab — row counts (`GET /api/database/summary`)

Proxied from admin to **`GET /api/admin/database/summary`** with **`X-Admin-Token`**. Helps operators see whether tables are empty; **parishes** (14) and **features** (70) often appear immediately after a fresh Postgres volume because **`seedParishes()`** runs on API boot (see [`DATABASE-AND-MAP-DATA.md`](./DATABASE-AND-MAP-DATA.md)).

```mermaid
flowchart LR
  U[Admin: Database tab]
  U --> A["GET /api/database/summary\nadmin :5556"]
  A --> P["Proxy + X-Admin-Token\n→ /api/admin/database/summary"]
  P --> Q["API: COUNT per table"]
  Q --> PG[(PostgreSQL)]
  Q --> R["JSON counts +\nisNonEmpty / hasContentData"]
  R --> U
```

---

### Map data rebuild (selective targets or full OSM)

Poll responses and the pre-flight **GET** include **`dataSnapshot`** (`places` / `airports` / `notes` counts, **`wipeWarning`**). The UI uses **section checkboxes**; **`POST`** sends a **`targets`** array for selective refresh, or omits it for the **legacy full** rebuild (same as CLI `db:rebuild`). **`confirmWipe`** is required when **`places`** would delete rows (or counts are unknown); **`confirmClearNotes`** when **`notes_clear`** is selected. **`GET /api/health`** → **`mapDataRebuild`** omits **`dataSnapshot`**.

```mermaid
flowchart TD
  POLL0["Dashboard polls GET …/rebuild-inventory/status\n~1.5s while inProgress, ~4s idle\ndataSnapshot → banner + row counts"]

  U[Admin: section checkboxes +\nRun selected rebuilds]
  U -.-> POLL0

  U --> REF[Fresh GET status before POST\nsync counts for confirm text]
  REF --> C{Browser confirm\nlists selected steps}
  C -->|no| X[Cancel]
  C -->|yes| BR["POST /api/rebuild-inventory\nbody: optional targets[],\nincludeAirports, confirmWipe,\nconfirmClearNotes → admin → API"]

  BR --> VAL{Valid token +\nconfirm flags OK?}
  VAL -->|no| E400["400 CONFIRM_WIPE_REQUIRED,\nCONFIRM_CLEAR_NOTES_REQUIRED,\nor invalid targets"]
  VAL -->|yes| R{409 busy?}

  E400 -.-> POLL0
  R -->|yes| E409[Toast: busy]
  R -->|no| OK202["200 job started async"]

  OK202 --> BG["Background:\nselectiveDataRefresh(targets)\nor full rebuildInventory()\n(OSM when places / full)"]

  BG --> OP[(Overpass when places\nin targets / full)]
  OP --> BG

  BG --> RR{Retriable failures\n429 / 504 / …?}
  RR -->|yes| WAIT[Cooldown + retries]
  WAIT --> OP
  RR -->|no| DONE[phase: done\nlastSummary]

  POLL0 -.-> STATE[Shared in-memory job state:\nsections when OSM, %, phase]
  BG -.-> STATE
  HEALTH["GET /api/health\nmapDataRebuild"] -.-> STATE

  classDef good fill:#064e3b,stroke:#4ade80,color:#f0fdf4;
  classDef bad fill:#7f1d1d,stroke:#f97373,color:#fef2f2;
  classDef neutral fill:#0b1020,stroke:#1f2937,color:#f9fafb;

  class OK202,DONE good;
  class E400,E409 bad;
  class U,REF,C,BR,VAL,R,BG,OP,RR,WAIT,STATE,HEALTH,X,POLL0 neutral;
```
