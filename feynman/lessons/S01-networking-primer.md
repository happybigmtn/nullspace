# S01 - Networking primer (HTTP/WS, CORS, origins) (from scratch)

Focus: (concepts)

Goal: explain the basics of HTTP, WebSockets, origins, and CORS with beginner-friendly examples. This primer supports the gateway, auth, and live-table lessons.

---

## Concepts from scratch (expanded)

### 1) HTTP vs WebSocket
- **HTTP** is request/response: the client asks, the server answers, and the connection closes.
- **WebSocket** is a long-lived, two-way connection for real-time updates.

### 2) What an origin is
An origin is the tuple of protocol + hostname + port (e.g., `https://app.example.com:443`). Browsers attach the origin to requests so servers can decide what to allow.

### 3) What CORS is
CORS (Cross-Origin Resource Sharing) is a browser security policy. Servers must explicitly allow which origins can call them from a browser.

---

## Limits & management callouts (important)

1) **CORS only affects browsers**
- Mobile apps and servers are not restricted by CORS.
- You still need auth or origin checks server-side.

2) **WebSockets still have origin concerns**
- Browsers send the Origin header during WebSocket upgrades.
- Gateways should enforce an allowlist in production.

---

## Walkthrough with simple examples

### 1) HTTP request example
```rust
GET /healthz HTTP/1.1
Host: gateway.example.com
```

Why this matters:
- Health checks are simple HTTP requests used by load balancers and monitors.

What this means:
- The server responds once and closes the connection.

---

### 2) WebSocket upgrade example
```rust
GET /ws HTTP/1.1
Host: gateway.example.com
Upgrade: websocket
Connection: Upgrade
Origin: https://app.example.com
```

Why this matters:
- This is how a browser upgrades from HTTP to a WebSocket connection.

What this means:
- The server can read the `Origin` header and decide whether to accept.

---

### 3) CORS response example
```rust
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Why this matters:
- Without these headers, browsers will block requests across origins.

What this means:
- The server has explicitly allowed a specific origin to call it.

---

## Key takeaways
- HTTP is request/response; WebSockets are persistent and bidirectional.
- Origins identify where a browser request comes from.
- CORS is a browser rule, not a server rule, but servers must enforce it.

## Next primer
S02 - Distributed systems primer: `feynman/lessons/S02-distributed-systems-primer.md`
