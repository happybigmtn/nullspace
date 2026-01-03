# L17 - Submit client (register + deposit) (from scratch)

Focus file: `gateway/src/backend/http.ts`

Goal: explain how the gateway submits register/deposit transactions to the backend and handles errors/timeouts. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Register + deposit are just submissions
The gateway always sends binary `Submission` payloads to `/submit`. Whether it’s register or deposit doesn’t matter to HTTP — it’s just bytes.

### 2) Timeouts prevent hanging sessions
If the backend is slow, the gateway aborts so clients don’t wait forever.

---

## Limits & management callouts (important)

1) **Default submit timeout = 10s**
- Long enough for normal processing, short enough to keep UI responsive.

2) **Origin header must match backend allowlist**
- If origin mismatches, even valid submissions will be rejected.

---

## Walkthrough with code excerpts

### 1) Submit a transaction to `/submit`
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
- Register and deposit live or die by this one submission call.

What this code does:
- Sends binary submission bytes to the backend.
- Aborts after a timeout to avoid hanging.
- Returns a simple `{accepted, error}` result for the caller to act on.

---

## Key takeaways
- Register/deposit are just binary submissions sent to `/submit`.
- Timeouts and error handling protect the gateway from backend stalls.

## Next lesson
L18 - Register submit HTTP endpoint: `feynman/lessons/L18-register-submit-http.md`
