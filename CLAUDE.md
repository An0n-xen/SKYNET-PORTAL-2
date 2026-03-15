# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SKYNET-PORTAL-2 is a **paid WiFi hotspot system**. Users connect to a TP-Link AP, get redirected to a captive portal, pay via Paystack mobile money, and are automatically logged in. The backend is **not yet built** — this repo is in the build phase.

**Stack:** Node.js + Express + **TypeScript** (serves both captive portal UI and API), Axios, **pnpm** package manager, plain HTML/CSS/JS frontend. No separate frontend framework.

## System Architecture

```
User Phone → TP-Link AP → MikroTik ether8 (192.168.100.1)
  → Captive portal redirect
  → Express backend at skynetlogin.duckdns.org (AWS Lightsail)
  → User selects package + pays via Paystack mobile money popup
  → Backend verifies payment → creates user in MikroTik via REST API
     (through WireGuard tunnel: 192.168.216.1:8728)
  → Browser auto-redirects to http://192.168.100.1/login?username=SKY-XXXX&password=NNNN
  → User has internet. MAC cookie handles reconnections (30 days).
```

## MikroTik Network Layout

| Interface | IP | Purpose |
|---|---|---|
| ether1 | 192.168.1.36 (DHCP) | WAN / Internet uplink |
| bridge (ether2) | 192.168.88.1/24 | Management (WinBox) |
| hotspot-bridge (ether4-7) | 192.168.200.1/24 | OLD hotspot (`hotspot1`), `use-radius=no`, local users only |
| ether8 | 192.168.100.1/24 | NEW hotspot (`hotspot-new`), TP-Link AP, RADIUS enabled |
| back-to-home-vpn (WireGuard) | 192.168.216.1/24 | Tunnel to AWS backend |

**New hotspot:** name=`hotspot-new`, profile=`hsprof-new`, DNS=`skynet.login`, HTML dir=`hotspot2`, login methods: cookie, http-chap, http-pap, mac-cookie. DHCP pool: `192.168.100.10–192.168.100.254`.

## User Manager (RADIUS)

Configured with `enabled=yes`, `use-profiles=yes`, `require-message-auth=no`. RADIUS shared secret: `testing123`.

**Profiles:**
- `daily` — validity `1d`, `starts-when=first-auth`
- `monthly` — validity `4w2d`, `starts-when=first-auth`

Both use `limitation=default-limit`.

## Backend File Structure

```
backend/
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env
└── src/
    ├── index.ts              # Express app entry point
    ├── routes/
    │   ├── pages.ts          # GET / — serves captive portal HTML
    │   ├── packages.ts       # GET /api/packages
    │   ├── payment.ts        # POST /api/payment/charge
    │   │                     # POST /api/payment/submit-otp
    │   │                     # POST /api/payment/verify
    │   └── webhook.ts        # POST /api/paystack/webhook (backup)
    ├── services/
    │   ├── mikrotik.ts       # MikroTik REST API calls
    │   ├── paystack.ts       # Paystack API calls
    │   └── credentials.ts    # Generate SKY-XXXX username + 4-digit PIN
    └── public/
        └── index.html        # Captive portal page
```

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Serve captive portal HTML (package selection + payment form) |
| GET | `/api/packages` | Return available packages with prices |
| POST | `/api/payment/charge` | Charge customer via Paystack `/charge` (mobile money) |
| POST | `/api/payment/submit-otp` | Submit OTP if Paystack requires it |
| POST | `/api/payment/verify` | Verify payment + create MikroTik user + return login URL |
| POST | `/api/paystack/webhook` | Paystack webhook (backup for failed verify calls) |

## Paystack /charge Flow

The payment flow uses Paystack's direct charge API — no redirect to Paystack.

**1. Charge:**
```javascript
// POST /api/payment/charge
// Accepts: { package, phone, provider } — email is auto-generated if not provided
POST https://api.paystack.co/charge
{
  email: `${Date.now()}@skynet.local`,  // auto-generated
  amount: package.price,  // in pesewas (100 pesewas = 1 GHS)
  currency: 'GHS',
  mobile_money: { phone: "0241234567", provider: "mtn" }  // "mtn" | "vod" | "tgo"
}
// Response status: "send_otp" → show OTP input
//                  "pay_offline" → user confirms on phone, poll verify
//                  "success" → proceed to create user
```

**2. Submit OTP (if required):**
```javascript
// POST /api/payment/submit-otp
// Accepts: { otp, reference }
POST https://api.paystack.co/charge/submit_otp
{ otp: "123456", reference: "ref_xxx" }
```

**3. Verify + create user:**
```javascript
// POST /api/payment/verify
// Accepts: { reference }
GET https://api.paystack.co/transaction/verify/:reference
// On status === 'success':
//   → generate credentials → create MikroTik user → return loginUrl
res.json({ success: true, loginUrl: "http://192.168.100.1/login?username=SKY-7K3M&password=4829" })
// Frontend JS auto-redirects to this URL
```

## MikroTik REST API Calls (from backend via WireGuard)

Base URL: `http://192.168.216.1:8728`, Basic Auth (`api-user:password`), restricted to WireGuard subnet.

```javascript
// Create user
POST /rest/user-manager/user/add
{ "name": "SKY-7K3M", "password": "4829", "group": "default" }

// Assign profile
POST /rest/user-manager/user-profile/add
{ "user": "SKY-7K3M", "profile": "daily" }  // or "monthly"

// List users
GET /rest/user-manager/user/print

// Remove user
POST /rest/user-manager/user/remove
{ ".id": "USER_ID" }
```

## User Credential Generation

- Username: `SKY-` + 4 random uppercase alphanumeric chars, no ambiguous chars (0/O, 1/I/L). Example: `SKY-7K3M`
- Password: 4-digit PIN. Example: `4829`
- **Never use `@` in usernames** — causes MikroTik REST API `find name=` issues

## Packages Config

```json
{
  "daily":   { "price": 10000, "validity": "24 hours", "mikrotik_profile": "daily" },
  "monthly": { "price": 200000, "validity": "30 days",  "mikrotik_profile": "monthly" }
}
```
Prices in pesewas (100 pesewas = 1 GHS). Placeholder values — confirm before launch.

## Docker Compose (2 containers)

Backend uses WireGuard's network (`network_mode: "service:wireguard-client"`) so all outbound traffic routes through the VPN tunnel to reach MikroTik.

```yaml
services:
  wireguard-client:
    image: lscr.io/linuxserver/wireguard:latest
    cap_add: [NET_ADMIN, SYS_MODULE]
    volumes: [./client-config:/config, /lib/modules:/lib/modules]
    sysctls: { net.ipv4.conf.all.src_valid_mark: 1 }
    ports: ["3000:3000"]
    privileged: true
    restart: unless-stopped

  backend:
    build: ./backend
    network_mode: "service:wireguard-client"
    env_file: ./backend/.env
    depends_on: [wireguard-client]
    restart: unless-stopped
```

## MikroTik Walled Garden

Must be configured on `hotspot-new` so users can reach the payment site before logging in:

```routeros
/ip/hotspot/walled-garden/ip add dst-host=skynetlogin.duckdns.org action=accept
/ip/hotspot/walled-garden/ip add dst-host=*.paystack.co action=accept
/ip/hotspot/walled-garden/ip add dst-host=*.paystack.com action=accept
/ip/hotspot/walled-garden/ip add dst-host=*.duckdns.org action=accept
```

## Environment Variables

```
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
MIKROTIK_API_URL=http://192.168.216.1:8728
MIKROTIK_API_USER=api-user
MIKROTIK_API_PASSWORD=YourStrongPasswordHere
HOTSPOT_LOGIN_URL=http://192.168.100.1/login
PORT=3000
```

## Key Gotchas

1. **`starts-when=first-auth`** — validity countdown starts at first login, not account creation. Critical for paid hotspot.
2. **`@` in usernames** — breaks MikroTik REST API `find name=`. Never use `@`.
3. **`use-profiles=yes`** — must be set on User Manager for profile validity to work.
4. **`require-message-auth=no`** — must be set on both `/radius` and `/user-manager` or auth fails.
5. **Old hotspot (`hotspot1`) must keep `use-radius=no`** — otherwise existing users fail against User Manager.
6. **MAC cookie over HTTP cookie** — mobile browsers clear HTTP cookies; MAC address persists for reconnection.
7. **Backend uses WireGuard network** — `network_mode: "service:wireguard-client"` gives backend access to `192.168.216.1:8728`.
8. **Paystack webhook** — verify `x-paystack-signature` header using HMAC-SHA512 with `PAYSTACK_SECRET_KEY`.
