# Nojawan Itehad Welfare

A transparent community-giving platform for the Chitta Batta welfare committee: public projects and
financial reports, donor accounts and statements, and an administrator console. English and Urdu (RTL).

## Setup

```bash
# backend  (Node + Express + MySQL)
cd backend
npm install
cp .env.example .env   # then fill in the values
npm run migrate      # optional: the server also runs this idempotent migration at startup
npm run make-admin   # promote a registered user to administrator
npm run dev

# frontend  (React + Vite)
cd Frontend
npm install
npm run dev          # http://localhost:5173
```

## Features

**Public**
- Landing page with live impact figures, mission, how-it-works, featured projects, FAQ and contact form
- Projects with funding progress (raised vs budget, spent), search and status filters
- Announcements with search
- Monthly financial report with month navigation, plus all-time totals and spending by category

**Donors**
- Pledge a donation with preset amounts, optionally dedicated to a project, with a note
- Dashboard: totals, six-month chart, filterable history, cancel pending pledges, PDF statement
- Profile editing and password change

**Administrators** (`Admin Console`)
- Overview: balances, 6-month trend, spending by category, top donors, pending-pledge alert
- Donations: search/filter, confirm / fail / refund pledges, record offline gifts, CSV export
- Expenses: record, search, delete, CSV export
- Projects: create, edit, change status, delete (blocked if financial records exist)
- Announcements: publish, edit, hide/show, delete
- Members: search, activate/deactivate, promote/demote (not yourself)
- Inbox for contact-form messages; activity log of every administrative action

**Platform**
- Email OTP verification for new accounts
- Login/registration and contact-form rate limiting, security headers, CSV formula-injection guard
- Skip link, ARIA roles, reduced-motion support, responsive layout

## Email verification (OTP)

A new account stays locked until the donor enters the 6-digit code emailed at registration. The code is
stored only as a hash, expires after 10 minutes, allows 5 wrong attempts, and can be re-sent once a
minute. Signing in to an unverified account sends a fresh code and returns to the code step, and the API
refuses tokens of unverified accounts. Accounts that existed before this feature are marked verified by
the migration.

Email is sent through **Brevo's HTTPS API** (Render blocks outbound SMTP, so Gmail SMTP times out there):

```
BREVO_API_KEY=xkeysib-...                        # an API key, NOT an SMTP key (xsmtpsib-...)
MAIL_FROM=nojawan.itehad.welfare@gmail.com       # must be a verified sender in Brevo
```

At startup the server checks the key with Brevo (no email is sent) and logs either
`Email: Brevo API key accepted ...` or the exact problem. `npm run test-email -- you@example.com`
sends one test message. For local development without Brevo, `MAIL_DEV_LOG_OTP=true` prints codes to
the console instead (ignored when `NODE_ENV=production`).

## Online payments (Safepay)

Settings (see `backend/.env.example`; never commit `.env`):

```
SAFEPAY_ENV=sandbox            # or production; any other value disables payments with an error
SAFEPAY_PUBLIC_KEY=sec_...     # public API key for that environment
SAFEPAY_SECRET_KEY=...         # secret key for that environment
SAFEPAY_WEBHOOK_SECRET=...     # webhook shared secret from the Safepay dashboard
FRONTEND_URL=https://...       # where Safepay sends donors back; must be https in production
```

Flow:

1. The donor chooses a whole PKR amount; the server validates it.
2. The server opens a Safepay tracker, then records the pending donation and payment together.
   Submitting the same pledge again within 10 minutes continues the first one instead of creating another.
3. The donor pays on Safepay's hosted checkout (card details never touch this site).
4. The payment is confirmed only by asking Safepay with the merchant secret (`GET /order/v1/{tracker}`):
   the tracker must be `TRACKER_ENDED` with a transaction, for this merchant, for exactly the amount in PKR.
   This check runs when the donor returns, on "Check status", when a signed webhook arrives
   (`POST /api/payments/safepay/webhook`), and every 5 minutes in the background. The redirect URL and the
   webhook body are never trusted on their own.
5. Pledges unpaid after 24 hours become `expired`; cancelled pledges are kept as `cancelled`. If Safepay
   later reports one of them paid, it is still recorded as `completed`.

Only `completed` donations count in totals and reports. An administrator cannot mark a Safepay donation
completed unless Safepay confirms it; offline gifts (cash, bank transfer) are recorded separately.

### Easypaisa and JazzCash

Safepay has no separate API option for these wallets: they appear on Safepay's hosted checkout once
Safepay enables them on the merchant account. After Safepay confirms they are enabled, add

```
SAFEPAY_CHANNELS=card,easypaisa,jazzcash
```

Donors then get a "Pay with" picker. When Safepay reports which processor took the payment, the stored
method is updated to match. Leave it unset (card only) until then.

## Design system

The frontend styles are layered, each file refining the one before it. `src/design.css` loads last and holds the
current look ("golden hour in the village"): ivory surfaces, forest/emerald/teal, and gold as the single warm accent.

- **Tokens** live at the top of `design.css` (`--forest-*`, `--emerald-*`, `--teal-400`, `--gold-*`, `--ivory-*`, `--ease-out`).
- **Motion** is progressive enhancement. `src/useAmbient.js` drives the scroll progress bar, the condensing navbar,
  the staggered reveal-on-scroll, the hero pointer parallax and magnetic buttons (`data-magnetic`). Every animation is
  switched off under `prefers-reduced-motion`, and content stays visible if JavaScript or IntersectionObserver is missing.
- **Illustration**: the hero scene is hand-built SVG (`components/Village.jsx`), so there are no images to download.
- **Icons**: `components/Glyphs.jsx` (`Icon` for UI, `Glyph` for project emblems; `glyphRules.js` picks an emblem from the
  project title). Use these instead of emoji or unicode symbols so every device renders the same shapes.
- **Tables** that should stack on phones get `className="table-wrap stack"` and a `data-label` on each `<td>`.

## Diagnosing slow OTP emails

Every OTP request prints single-line timing logs (visible in Render → Logs; search for `[otp]`). They never contain the
code, passwords, API keys or the full email address (addresses are masked, e.g. `ab***@gmail.com`).

```
[otp] {"t":"2026-10-14T10:00:03.412Z","trace":"a1b2c3","action":"register","to":"ab***@gmail.com","phase":"mail_accepted","step_ms":412,"total_ms":2310,"status":201,"provider_ms":412,"dns_ms":18,"connect_ms":41,"tls_ms":97,"first_byte_ms":405,"messageId":"<...@smtp-relay.mailin.fr>","accepted_at":"2026-10-14T10:00:03.412Z"}
```

Phases, in order: `request_start` (with `uptime_s` / `fresh_boot` to spot a server that was asleep) → `validated_and_looked_up` →
`password_hashed` → `user_saved` → `otp_stored` → `mail_request_start` → `mail_accepted` (or `mail_failed`) → `response_sent`.
`step_ms` is the time since the previous line, so the biggest `step_ms` shows where the time went. Inside `mail_accepted`,
`dns_ms` → `connect_ms` → `tls_ms` → `first_byte_ms` are cumulative, so `first_byte_ms - tls_ms` is how long Brevo itself took to answer.

**Delay before Brevo accepted the email**: the log shows it (large `total_ms`, or a large `step_ms` on one phase).
**Delay after acceptance** (Brevo to Gmail): the app cannot see it, so ask Brevo for its own record with the `messageId` from the log
(needs `BREVO_API_KEY` in `backend/.env`):

```
npm run email-trace -- "<messageId from the log>"
npm run email-trace -- someone@gmail.com            # recent emails to an address
```

It prints Brevo's events (`requests` → `deferred` → `delivered`) with the gaps in seconds. A long `requests` → `delivered` gap, especially
with `deferred` lines, means Gmail's servers were slow to accept it. If `delivered` is quick but the message shows up late, the delay is inside Gmail.

To line the clocks up: log times are UTC (`Z`); Pakistan time is UTC+5. In Gmail open the email → ⋮ → **Show original**: the top shows
*Created at … (Delivered after N seconds)*, and `Received:` lines show each hop's time; `Authentication-Results` shows whether SPF / DKIM / DMARC passed.

A registration or login inside the 60-second resend window does not send another email; each skip is logged as `skipped_cooldown`.
