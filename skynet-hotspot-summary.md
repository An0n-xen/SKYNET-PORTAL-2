# Skynet Hotspot — Complete Setup Summary

## Overview

Paid WiFi hotspot system using MikroTik L009 + User Manager (RADIUS) + Paystack payments + Node.js backend on AWS, connected via WireGuard tunnel.

---

## What's Been Done on MikroTik

### Router Details
- **Model:** L009UiGS-2HaxD
- **RouterOS:** 7.20.6 (stable)
- **Architecture:** ARM

### Packages Installed
- `user-manager` — installed from System → Packages (wasn't there by default)
- `scheduler` — enabled via `/system/device-mode/update scheduler=yes` (required physical reset button press)

### Network Layout

| Interface | Purpose | IP | Notes |
|-----------|---------|-----|-------|
| ether1 | WAN/Internet | 192.168.1.36 (DHCP) | Uplink |
| bridge (ether2) | Management | 192.168.88.1/24 | WinBox access |
| hotspot-bridge (ether4-7) | OLD hotspot | 192.168.200.1/24 | Existing users, no RADIUS |
| ether8 | NEW hotspot | 192.168.100.1/24 | Connected to TP-Link AP, uses RADIUS/User Manager |
| back-to-home-vpn (WireGuard) | AWS tunnel | 192.168.216.1/24 | Connects to AWS backend |

### Old Hotspot (kept running, unchanged)
- **Hotspot name:** hotspot1
- **Interface:** hotspot-bridge
- **Profile:** hsprof2
- **IP:** 192.168.200.1/24
- **DNS:** skynet.wifi.login
- **RADIUS:** disabled (`use-radius=no`) — uses local user list
- **Users:** existing users authenticate via local hotspot user list

### New Hotspot (the one we built)
- **Hotspot name:** hotspot-new
- **Interface:** ether8 (connected to TP-Link AP for WiFi)
- **Profile:** hsprof-new
- **IP:** 192.168.100.1/24
- **DNS:** skynet.login
- **HTML directory:** hotspot2 (using default MikroTik login page for now)
- **Login methods:** cookie, http-chap, http-pap, mac-cookie
- **MAC cookie timeout:** 30 days
- **HTTP cookie lifetime:** 30 days (4w2d)
- **RADIUS:** enabled (`use-radius=yes`, `radius-accounting=yes`)

### DHCP for New Hotspot
- **Server name:** dhcp-new
- **Interface:** ether8
- **Pool:** hs-pool-new (192.168.100.10 - 192.168.100.254)
- **Gateway:** 192.168.100.1
- **DNS:** 192.168.100.1

### NAT Rule
```routeros
/ip/firewall/nat add chain=srcnat src-address=192.168.100.0/24 action=masquerade comment="NAT new hotspot"
```

---

## User Manager Configuration

### Enabled
```routeros
/user-manager set enabled=yes use-profiles=yes require-message-auth=no
```

### Router (RADIUS client)
```routeros
/user-manager/router add name=hotspot1 address=127.0.0.1 shared-secret=testing123
```

### RADIUS Setup
```routeros
/radius add service=hotspot address=127.0.0.1 secret=testing123
/radius set [find] require-message-auth=no
/radius incoming set accept=yes
```

### Limitation
```routeros
/user-manager/limitation add name=default-limit
```

### Profiles (packages)
```routeros
/user-manager/profile add name=daily validity=1d starts-when=first-auth
/user-manager/profile add name=monthly validity=4w2d starts-when=first-auth
```

### Profile-Limitation Links
```routeros
/user-manager/profile-limitation add profile=daily limitation=default-limit
/user-manager/profile-limitation add profile=monthly limitation=default-limit
```

### How to Create a User (this is what the Node.js backend will do via API)
```routeros
/user-manager/user add name=USERNAME password=PASSWORD group=default
/user-manager/user-profile add user=USERNAME profile=daily
```

### Important Notes
- Usernames with `@` symbols caused issues with `find name=` — avoid them or use the loop method
- `starts-when=first-auth` means the validity countdown starts at first login, not at account creation
- User profile state shows `waiting` / `not-yet-running` until first login

---

## REST API Access

### Service Config
- **API port:** 8728 (enabled)
- **API-SSL port:** 8729 (enabled)
- **Restricted to:** 192.168.216.0/24 (WireGuard subnet only)

```routeros
/ip/service set api address=192.168.216.0/24
/ip/service set api-ssl address=192.168.216.0/24
```

### API User
- Already exists (user created previously for API access)
- Has read, write, api, test permissions

### API Endpoints the Backend Needs

**Create a user:**
```
POST http://192.168.216.1:8728/rest/user-manager/user/add
Body: { "name": "SKY-7K3M", "password": "4829", "group": "default" }
Auth: Basic (api-user:password)
```

**Assign profile to user:**
```
POST http://192.168.216.1:8728/rest/user-manager/user-profile/add
Body: { "user": "SKY-7K3M", "profile": "daily" }
Auth: Basic (api-user:password)
```

**List users:**
```
GET http://192.168.216.1:8728/rest/user-manager/user/print
Auth: Basic (api-user:password)
```

**Remove a user:**
```
POST http://192.168.216.1:8728/rest/user-manager/user/remove
Body: { ".id": "USER_ID" }
Auth: Basic (api-user:password)
```

---

## WireGuard Tunnel

- **MikroTik side:** 192.168.216.1/24
- **AWS side:** 192.168.216.2 (WireGuard runs in a Docker container on AWS)
- **MikroTik WG port:** 27246
- Already configured and working

---

## Security Hardening Done
- REST API locked to WireGuard subnet (192.168.216.0/24)
- Telnet and FTP should be disabled
- Dedicated API user with limited permissions

---

## Node.js Backend — What Needs to Be Built

### Design Decisions
- **Single Express app** serves both the captive portal UI and the API (no separate frontend)
- **Paystack Inline popup** — payment happens in-page, no redirect to Paystack
- **Auto-login after payment** — user goes from "payment complete" to "internet working" with zero typing
- **2 Docker containers** instead of 3 (WireGuard + backend only)

### Architecture
```
User Phone → TP-Link AP → ether8 → MikroTik Hotspot
                                        ↓
                              Walled garden allows skynetlogin.duckdns.org
                                        ↓
                              Express backend serves captive portal page
                              (package selection + Paystack inline popup)
                                        ↓
                              User selects package → pays via Paystack popup
                                        ↓
                              Payment success callback → POST /api/payment/verify
                                        ↓
                              Backend verifies payment with Paystack API
                                        ↓
                              Backend creates user in MikroTik via REST API
                              (through WireGuard: 192.168.216.1:8728)
                                        ↓
                              Backend responds with auto-login URL
                                        ↓
                              Browser redirects to:
                              http://192.168.100.1/login?username=SKY-7K3M&password=4829
                                        ↓
                              User has internet. MAC cookie handles reconnections.
```

### Backend Structure
```
backend/
├── Dockerfile
├── package.json
├── .env
├── src/
│   ├── index.js              # Express app entry point
│   ├── routes/
│   │   ├── pages.js          # GET / — serves captive portal HTML page
│   │   ├── packages.js       # GET /api/packages — returns available packages
│   │   ├── payment.js        # POST /api/payment/charge — Paystack /charge
│   │   │                     # POST /api/payment/submit-otp — OTP if needed
│   │   │                     # POST /api/payment/verify — verify + create user + send SMS
│   │   └── webhook.js        # POST /api/paystack/webhook — Paystack webhook backup
│   ├── services/
│   │   ├── mikrotik.js       # MikroTik REST API calls (create user with shared-users=3, assign profile)
│   │   ├── paystack.js       # Paystack API calls (charge, submit-otp, verify)
│   │   ├── sms.js            # mNotify SMS (send credentials after payment)
│   │   └── credentials.js    # Generate random username (SKY-XXXX) + 4-digit PIN
│   └── public/
│       └── index.html        # Captive portal page (package selection + payment form + success screen)
```

### API Endpoints

1. `GET /` — serves the captive portal page (HTML with package selection + payment form)
2. `GET /api/packages` — returns available packages with prices
3. `POST /api/payment/charge` — charges customer directly via Paystack /charge endpoint:
   - Accepts: package, email, mobile_money_number, provider (mtn/vod/tigo)
   - Calls Paystack `/charge` endpoint with mobile money details
   - Returns charge reference and status
4. `POST /api/payment/submit-otp` — submits OTP if Paystack requires it (some mobile money charges need OTP confirmation)
5. `POST /api/payment/verify` — called after charge succeeds:
   - Verifies payment with Paystack `/transaction/verify/:reference`
   - Generates credentials (SKY-XXXX / 4-digit PIN)
   - Creates user in MikroTik User Manager via REST API (with `shared-users=3`)
   - Assigns the correct profile (daily/monthly)
   - Sends SMS with credentials via mNotify to user's phone number
   - Returns `{ success: true, username, password, loginUrl: "http://192.168.100.1/login?username=SKY-7K3M&password=4829" }`
   - Frontend shows success screen with credentials, countdown, then auto-redirects
6. `POST /api/paystack/webhook` — backup: Paystack webhook for failed verify calls

### Captive Portal Page Flow (single page)
```
┌─────────────────────────────────────┐
│         SKYNET WiFi                  │
│                                      │
│  Select a package:                   │
│                                      │
│  ┌─────────────┐ ┌─────────────┐    │
│  │   Daily      │ │   Monthly   │    │
│  │   X GHS      │ │   X GHS    │    │
│  │   24 hours   │ │   30 days  │    │
│  │  [Select]    │ │  [Select]  │    │
│  └─────────────┘ └─────────────┘    │
│                                      │
│  Pay with mobile money:              │
│  ┌─────────────────────────────┐    │
│  │ Provider: [MTN ▼]           │    │
│  │ Phone:    [024XXXXXXX]      │    │
│  │           [Pay Now]         │    │
│  └─────────────────────────────┘    │
│                                      │
│  ← User confirms on phone prompt →   │
│  ← Backend verifies + creates user → │
│  ← Auto-redirect to hotspot login →  │
└─────────────────────────────────────┘
```

### Paystack /charge Integration

**Backend — charge with mobile money:**
```javascript
// POST /api/payment/charge
const response = await axios.post('https://api.paystack.co/charge', {
  email: req.body.email || `${Date.now()}@skynet.local`,  // Auto-generate if not provided
  amount: package.price,  // In pesewas
  currency: 'GHS',
  mobile_money: {
    phone: req.body.phone,       // e.g. "0241234567"
    provider: req.body.provider  // "mtn" | "vod" | "tgo"
  }
}, {
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Response will have status: "send_otp" or "pay_offline" or "success"
// If "send_otp" — frontend shows OTP input, calls /api/payment/submit-otp
// If "pay_offline" — user confirms on their phone, frontend polls /api/payment/verify
// If "success" — proceed to create user immediately
```

**Backend — submit OTP (if required):**
```javascript
// POST /api/payment/submit-otp
const response = await axios.post('https://api.paystack.co/charge/submit_otp', {
  otp: req.body.otp,
  reference: req.body.reference
}, {
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
});
```

**Backend — verify and create user:**
```javascript
// POST /api/payment/verify
const verification = await axios.get(
  `https://api.paystack.co/transaction/verify/${req.body.reference}`,
  { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
);

if (verification.data.data.status === 'success') {
  // Generate credentials
  const username = generateUsername();  // "SKY-7K3M"
  const password = generatePin();       // "4829"
  const phone = req.body.phone;         // From the payment form

  // Create user in MikroTik (with shared-users=3 for multi-device)
  await mikrotik.createUser(username, password);
  await mikrotik.assignProfile(username, packageId);  // "daily" or "monthly"

  // Send credentials via SMS (mNotify)
  await sms.sendCredentials(phone, username, password, packageName);

  // Return credentials + auto-login URL
  res.json({
    success: true,
    username: username,
    password: password,
    loginUrl: `${process.env.HOTSPOT_LOGIN_URL}?username=${username}&password=${password}`
  });
}
```

### MikroTik REST API Calls (from backend via WireGuard)
```javascript
// mikrotik.js service

const MIKROTIK_URL = process.env.MIKROTIK_API_URL; // http://192.168.216.1:8728
const AUTH = Buffer.from(`${process.env.MIKROTIK_API_USER}:${process.env.MIKROTIK_API_PASSWORD}`).toString('base64');

// Create user (shared-users=2 allows up to 3 devices simultaneously)
await axios.post(`${MIKROTIK_URL}/rest/user-manager/user/add`, {
  name: 'SKY-7K3M',
  password: '4829',
  group: 'default',
  'shared-users': '2'
}, { headers: { Authorization: `Basic ${AUTH}` } });

// Assign profile
await axios.post(`${MIKROTIK_URL}/rest/user-manager/user-profile/add`, {
  user: 'SKY-7K3M',
  profile: 'daily'  // or 'monthly'
}, { headers: { Authorization: `Basic ${AUTH}` } });
```

### Packages Config
```json
{
  "daily": {
    "name": "Daily",
    "price": 100,
    "currency": "GHS",
    "validity": "24 hours",
    "mikrotik_profile": "daily"
  },
  "monthly": {
    "name": "Monthly",
    "price": 2000,
    "currency": "GHS",
    "validity": "30 days",
    "mikrotik_profile": "monthly"
  }
}
```
Note: Paystack prices are in pesewas (100 pesewas = 1 GHS). Placeholder prices — update later.

### User Credential Generation
- Auto-generate short username like `SKY-7K3M` (prefix + 4 random alphanumeric, uppercase, no ambiguous chars like 0/O, 1/I/L)
- Auto-generate 4-digit PIN as password like `4829`
- No `@` symbols in usernames (causes MikroTik issues)
- After payment: show credentials on success screen with "Copy" button, send SMS, then auto-redirect after a few seconds

### Multi-Device Support
- Each user account allows **3 simultaneous devices** (`shared-users=3` in User Manager)
- First device: auto-login after payment
- Additional devices: user enters same credentials (username + password) on the hotspot login page
- Credentials are shown on success screen AND sent via SMS so users can log in on other devices
- When creating users via REST API, always include `"shared-users": "3"`

### Success Screen Flow (after payment)
```
┌─────────────────────────────────────┐
│         Payment Successful!          │
│                                      │
│  Your WiFi credentials:              │
│                                      │
│  Username: SKY-7K3M    [Copy]        │
│  Password: 4829        [Copy]        │
│                                      │
│  Package: Daily (24 hours)           │
│                                      │
│  SMS sent to 0551234987              │
│  Use these on other devices too!     │
│                                      │
│  Connecting in 5 seconds...          │
│  ████████████░░░░ 3s                 │
│                                      │
│  [Connect Now]                       │
└─────────────────────────────────────┘
```
- Show credentials with copy buttons
- Countdown timer (5 seconds) then auto-redirect to hotspot login URL
- "Connect Now" button for impatient users
- SMS confirmation message shown

### SMS via mNotify
```javascript
// sms.js service
const MNOTIFY_API_KEY = process.env.MNOTIFY_API_KEY;

async function sendCredentials(phone, username, password, packageName) {
  await axios.post('https://apps.mnotify.net/smsapi', null, {
    params: {
      key: MNOTIFY_API_KEY,
      to: phone,
      msg: `SKYNET WiFi - Your login:\nUsername: ${username}\nPassword: ${password}\nPlan: ${packageName}\nUse on up to 3 devices.`,
      sender_id: 'SKYNET'  // Must be registered with mNotify
    }
  });
}
```
Note: You need to register a sender ID ("SKYNET") with mNotify. The mNotify API key goes in `.env`.

### Environment Variables Needed
```
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
MIKROTIK_API_URL=http://192.168.216.1:8728
MIKROTIK_API_USER=api-user
MIKROTIK_API_PASSWORD=YourStrongPasswordHere
HOTSPOT_LOGIN_URL=http://192.168.100.1/login
MNOTIFY_API_KEY=your_mnotify_api_key
PORT=3000
```

### Tech Stack
- Node.js + Express.js (serves both API and captive portal page)
- Axios (for MikroTik REST API calls and Paystack verification)
- crypto (for Paystack webhook signature verification)
- No separate frontend framework needed — plain HTML/CSS/JS for the captive portal page

### Docker Compose (Simplified — 2 containers)

```yaml
services:
  # WireGuard VPN Client — tunnels to MikroTik
  wireguard-client:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wireguard-client
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
    volumes:
      - ./client-config:/config
      - /lib/modules:/lib/modules
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    restart: unless-stopped
    privileged: true
    ports:
      - "3000:3000"

  # Express Backend — serves captive portal + API, routes through WireGuard
  backend:
    build: ./backend
    container_name: skynet-backend
    network_mode: "service:wireguard-client"  # Routes all traffic through WireGuard
    environment:
      - NODE_ENV=production
      - PORT=3000
    env_file:
      - ./backend/.env
    volumes:
      - ./backend:/app
      - /app/node_modules
    depends_on:
      - wireguard-client
    restart: unless-stopped
```

**Key changes from previous setup:**
- No separate frontend container — Express serves everything
- No `app-network` needed — backend uses WireGuard network only
- Domain: skynetlogin.duckdns.org (DuckDNS dynamic DNS)
- Hosted on AWS Lightsail VPS

### MikroTik Walled Garden Setup (IMPORTANT)

The walled garden allows users to access the payment site BEFORE they're logged in. Without this, users can't reach the captive portal or Paystack.

```routeros
# Allow access to your backend (captive portal + API)
/ip/hotspot/walled-garden/ip add dst-host=skynetlogin.duckdns.org action=accept comment="Captive portal"

# Allow Paystack domains (for payment processing)
/ip/hotspot/walled-garden/ip add dst-host=*.paystack.co action=accept comment="Paystack"
/ip/hotspot/walled-garden/ip add dst-host=*.paystack.com action=accept comment="Paystack"

# Allow DuckDNS (for DNS resolution of your domain)
/ip/hotspot/walled-garden/ip add dst-host=*.duckdns.org action=accept comment="DuckDNS"
```

Apply these to the new hotspot server.

---

## Key Gotchas / Lessons Learned

1. **Device mode:** MikroTik L009 has restricted device-mode. Enabling scheduler required physical reset button press.
2. **User Manager is a separate package** — not installed by default, needs to be enabled via System → Packages.
3. **User Manager must be explicitly enabled** — `/user-manager set enabled=yes` (was `no` by default after install).
4. **`use-profiles=yes`** must be set on User Manager for profiles with validity to work.
5. **`require-message-auth`** had to be set to `no` on both `/radius` and `/user-manager` to stop authentication failures.
6. **Usernames with `@`** cause issues with MikroTik's `find name=` command — the REST API should avoid `@` in generated usernames.
7. **`starts-when=first-auth`** is critical — it means the validity timer starts on first login, not account creation. This is exactly what you want for paid hotspot.
8. **MAC cookie** is better than HTTP cookie for mobile devices — phones' captive portal browsers clear cookies, but MAC address persists.
9. **Old hotspot must have `use-radius=no`** — otherwise existing users get checked against User Manager and fail.
10. **Captive portal redirect** — custom login.html may hardcode the old hotspot IP. The new hotspot uses default login page (`hotspot2` directory) for now.
