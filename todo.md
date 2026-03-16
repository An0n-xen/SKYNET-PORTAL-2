# TODO: Add RADIUS Password Verification to Manual Login — DONE

## Summary

RADIUS password verification is fully implemented and tested. The manual login flow now verifies both username and password server-side via RADIUS before redirecting.

**The fix:** Use RADIUS authentication to verify both username AND password server-side before redirecting. MikroTik User Manager already acts as a RADIUS server — we send an `Access-Request` and get `Access-Accept` (valid) or `Access-Reject` (wrong password).

### Why RADIUS instead of REST API?
MikroTik's REST API masks all passwords as `*****` (write-only field). There is no REST endpoint to verify a password. RADIUS is the proper protocol for credential verification and is already configured on the MikroTik.

---

## Current State (What's Already Done)

These were implemented in the previous session and are working:

- **`backend/src/services/mikrotik.ts`** — `findUser(username)` function that looks up a user by name via `GET /rest/user-manager/user` and filters locally. Returns the user object or `null`.
- **`backend/src/routes/auth.ts`** — `POST /api/auth/verify` endpoint. Normalizes username to uppercase, calls `findUser()`, returns 404 "Account not found" if user doesn't exist, otherwise returns `{ success: true, loginUrl }`. Currently does NOT verify the password.
- **`backend/src/index.ts`** — Auth router registered at `/api/auth` with a rate limiter (10 requests per 15 minutes, stricter than payment's 20).
- **`backend/src/public/index.html`** — Frontend has `#login-status` paragraph and `#login-spinner` elements. The Connect button handler does `fetch("/api/auth/verify")`, shows inline errors in red, shows "Credentials verified! Connecting..." in green on success, then redirects. "Back to payment" and bfcache `pageshow` handlers clear login state.

### What's NOT working yet
- Wrong password → user gets redirected to MikroTik anyway (no "Wrong password" error in portal)

---

## Implementation Steps

### Step 0: Test RADIUS Reachability

Before writing any code, verify that UDP port 1812 (RADIUS) is reachable from the Docker container:

```bash
# Check MikroTik RADIUS config
docker exec skynet-portal-2-backend-1 wget -q -O - -T 5 --header='Authorization: Basic Y2FwdGl2ZS1wb3J0YWwtdXNlcjpnYW1lem9uZQ==' http://192.168.88.1/rest/radius/print

# Also verify User Manager has require-message-auth=no (already in CLAUDE.md)
docker exec skynet-portal-2-backend-1 wget -q -O - -T 5 --header='Authorization: Basic Y2FwdGl2ZS1wb3J0YWwtdXNlcjpnYW1lem9uZQ==' http://192.168.88.1/rest/user-manager/print
```

If RADIUS port is not reachable, check MikroTik firewall rules and WireGuard routing.

### Step 1: Install `radclient` npm package

```bash
cd backend && pnpm add radclient
```

This package wraps `node-radius` and handles UDP socket management, timeouts, and retries.

**TypeScript types:** No `@types/radclient` exists. Create a type declaration file:

**New file: `backend/src/types/radclient.d.ts`**
```typescript
declare module 'radclient' {
  interface RadiusPacket {
    code: string;
    secret: string;
    identifier: number;
    attributes: [string, string][];
  }

  interface RadiusOptions {
    host: string;
    port?: number;
    timeout?: number;
    retries?: number;
  }

  interface RadiusResponse {
    code: string;  // 'Access-Accept' | 'Access-Reject'
    identifier: number;
    attributes: Record<string, any>;
  }

  function radclient(
    packet: RadiusPacket,
    options: RadiusOptions,
    callback: (err: Error | null, response: RadiusResponse) => void
  ): void;

  export = radclient;
}
```

### Step 2: Create `backend/src/services/radius.ts`

**New file** with a single exported function:

```typescript
import radclient from 'radclient';
import logger from '../logger';

// Derive RADIUS host from MIKROTIK_API_URL (strip http:// and port)
const RADIUS_HOST = process.env.MIKROTIK_API_URL?.replace('http://', '').split(':')[0] || '192.168.88.1';
const RADIUS_SECRET = process.env.RADIUS_SECRET || 'testing123';
const RADIUS_PORT = 1812;

/**
 * Verify username + password against MikroTik User Manager via RADIUS.
 * Returns true if Access-Accept, false if Access-Reject.
 * Throws on network/timeout errors.
 */
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const packet = {
      code: 'Access-Request',
      secret: RADIUS_SECRET,
      identifier: Math.floor(Math.random() * 256),
      attributes: [
        ['User-Name', username],
        ['User-Password', password],
      ] as [string, string][],
    };

    radclient(packet, { host: RADIUS_HOST, port: RADIUS_PORT, timeout: 5000, retries: 2 }, (err, response) => {
      if (err) {
        logger.error({ err: err.message, username }, 'RADIUS auth error');
        reject(err);
        return;
      }
      logger.info({ username, code: response.code }, 'RADIUS auth response');
      resolve(response.code === 'Access-Accept');
    });
  });
}
```

### Step 3: Update `backend/src/routes/auth.ts`

**Final approach:** RADIUS-only (no `findUser` — the REST API has intermittent timeout issues with `GET /rest/user-manager/user`). RADIUS handles both username and password verification in one call.

```typescript
import { verifyCredentials } from '../services/radius';

const valid = await verifyCredentials(normalized, pin);
if (!valid) {
  res.status(401).json({ error: 'Invalid username or password' });
  return;
}
```

The flow:
1. `verifyCredentials(username, password)` → RADIUS `Access-Reject` → **401 "Invalid username or password"** (covers both wrong user and wrong password)
2. RADIUS `Access-Accept` → **200 `{ success: true, loginUrl }`**

Note: We use a single "Invalid username or password" message instead of distinguishing the two — this is actually better security practice (doesn't leak which usernames exist).

### Step 4: Add `RADIUS_SECRET` to `.env`

Add to `backend/.env`:
```
RADIUS_SECRET=testing123
```

---

## RADIUS Configuration Reference

These settings are already configured on the MikroTik (documented in CLAUDE.md):

| Setting | Value | Location |
|---------|-------|----------|
| RADIUS server | 192.168.88.1:1812 | MikroTik User Manager |
| Shared secret | `testing123` | `/radius` and `/user-manager` config |
| `require-message-auth` | `no` | Must be `no` on both `/radius` and `/user-manager` |
| `use-profiles` | `yes` | User Manager setting |
| Auth protocol | PAP | User-Password attribute in Access-Request |

### Required MikroTik Config: RADIUS Client Entry

The backend must be registered as an authorized RADIUS client in User Manager. This was added via:

```
POST /rest/user-manager/router/add
{ "name": "backend", "address": "192.168.216.2", "shared-secret": "testing123" }
```

Where `192.168.216.2` is the WireGuard peer IP of the backend. Without this, RADIUS silently drops requests.

---

## Verification Checklist

After implementation:

- [ ] `npx tsc --noEmit` — TypeScript compiles cleanly
- [ ] `docker compose up --build -d backend` — Docker rebuild succeeds
- [ ] Check `docker logs skynet-portal-2-backend-1` — no startup errors
- [ ] **Test: non-existent username** → "Account not found" in red
- [ ] **Test: valid username + wrong PIN** → "Wrong password" in red
- [ ] **Test: valid credentials** → "Credentials verified! Connecting..." in green → redirect to MikroTik login URL
- [ ] **Test: rate limit** → 11th attempt in 15 min → "Too many login attempts"
- [ ] **Test: "Back to payment"** after error → error clears, returns to payment view
- [ ] Test all above via Playwright MCP

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/services/mikrotik.ts` | `findUser()` — REST API username lookup |
| `backend/src/services/radius.ts` | `verifyCredentials()` — RADIUS password check (NEW) |
| `backend/src/types/radclient.d.ts` | TypeScript types for radclient (NEW) |
| `backend/src/routes/auth.ts` | `POST /api/auth/verify` endpoint |
| `backend/src/index.ts` | Route registration + rate limiter |
| `backend/src/public/index.html` | Frontend login UI + async validation JS |
| `backend/.env` | `RADIUS_SECRET=testing123` |

---

## Gotchas

1. **UDP, not TCP** — RADIUS uses UDP port 1812. Docker/WireGuard must allow UDP traffic to 192.168.88.1.
2. **`require-message-auth=no`** — Must be set on MikroTik or RADIUS auth fails silently.
3. **`radclient` is callback-based** — Wrap in a Promise for async/await usage.
4. **No `@types/radclient`** — Must create own `.d.ts` type declarations.
5. **Rate limiter is critical** — 4-digit PINs are brute-forceable (10,000 combinations). 10 attempts per 15 min is already set.
6. **MikroTik REST API quirk** — Use `GET /rest/user-manager/user` (without `/print`) — the `/print` suffix causes 500 errors or timeouts.
7. **Always rebuild with Docker** — `docker compose up --build -d backend`. Don't rely on `pnpm dev` or `tsx watch`.
