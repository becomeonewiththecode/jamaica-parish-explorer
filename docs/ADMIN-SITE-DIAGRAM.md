## Admin Login Flow Diagram

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

