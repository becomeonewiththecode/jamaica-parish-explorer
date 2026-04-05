## Admin Site Diagrams

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
