# L05 - Submit client and HTTP submission (from scratch)

Focus file: `gateway/src/backend/http.ts`

Goal: explain how the gateway sends binary transactions to the backend and how it handles errors and timeouts. For every excerpt, you’ll see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) HTTP requests in plain terms
- The gateway talks to the backend using HTTP.
- It sends bytes to the `/submit` endpoint and receives a success or error response.

### 2) Status codes
- **200 OK** means the backend accepted the submission.
- **4xx / 5xx** mean the backend rejected or failed to process the request.

### 3) Timeouts
- If a request hangs too long, the gateway should abort it so the client isn’t stuck.
- Timeouts protect the gateway from backend stalls.

### 4) Origin header
- The backend may require an `Origin` header. The gateway supplies it to match allowlists.

---

## Limits & management callouts (important)

1) **Default submit timeout = 10s**
- Too low = false failures on slow backends.
- Too high = client waits too long before seeing errors.

2) **Health check timeout = 5s**
- Good for a fast liveness check. If your backend is under heavy load, you may need to adjust.

3) **Account query timeout = 5s**
- If this is too low, balance refresh may fail; too high increases request pile‑up under failure.

4) **Origin must match backend allowlist**
- If origin is misconfigured, all submissions can be rejected even if the backend is healthy.

---

## Walkthrough with code excerpts

### 1) SubmitClient constructor
```ts
export class SubmitClient {
  private baseUrl: string;
  private timeout: number;
  private origin: string;

  constructor(baseUrl: string, timeout: number = 10000, origin?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
    this.origin = origin || 'http://localhost:9010';
  }
}
```

Why this matters:
- Every backend request depends on these values. A wrong base URL or origin breaks all transactions.

What this code does:
- Stores the backend URL, timeout, and origin header.
- Normalizes the base URL by removing a trailing slash so path joins are consistent.
- Applies a default origin if one was not provided (localhost in dev).

---

### 2) Submit a transaction to `/submit`
```ts
async submit(submission: Uint8Array): Promise<SubmitResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeout);

  try {
    const response = await fetch(`${this.baseUrl}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Origin': this.origin,
      },
      body: Buffer.from(submission),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { accepted: true };
    }

    let error = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      if (text) error = text;
    } catch {
      // ignore
    }

    return { accepted: false, error };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      return { accepted: false, error: 'Request timeout' };
    }

    return {
      accepted: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
```

Why this matters:
- This is the **one and only path** for sending transactions to the backend. If it fails, no gameplay can happen.

What this code does:
- Builds a POST request with the binary submission body and required headers.
- Uses `AbortController` to enforce a hard timeout on the request.
- On non‑OK responses, attempts to read the response body as a text error message.
- Returns a simple `{ accepted, error }` object for the gateway to act on.

---

### 3) Health check
```ts
async healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${this.baseUrl}/healthz`, {
      method: 'GET',
      headers: {
        'Origin': this.origin,
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

Why this matters:
- Lets the gateway quickly detect if the backend is reachable.

What this code does:
- Sends a GET request to `/healthz` with an Origin header.
- Uses a short timeout so liveness checks never hang.
- Returns `true` only when the backend responds with a success status.

---

### 4) Account state query
```ts
async getAccount(publicKeyHex: string): Promise<{ nonce: bigint; balance: bigint } | null> {
  try {
    const response = await fetch(`${this.baseUrl}/account/${publicKeyHex}`, {
      headers: {
        'Origin': this.origin,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      nonce: BigInt(data.nonce || 0),
      balance: BigInt(data.balance || 0),
    };
  } catch {
    return null;
  }
}
```

Why this matters:
- The gateway uses this to refresh balances and resync nonces. Without it, local state drifts.

What this code does:
- Fetches account data from the backend by public key.
- Rejects any non‑OK response by returning `null`.
- Parses JSON and converts `nonce` and `balance` into BigInt for on‑chain math.

---

## Key takeaways
- SubmitClient is the gateway’s **HTTP bridge** to the backend.
- Timeouts are essential to keep the gateway responsive.
- Origin headers must match backend policy or all requests will fail.

## Next lesson
L06 - Simulator /submit endpoint (decode + dispatch): `feynman/lessons/L06-simulator-submit-http.md`
