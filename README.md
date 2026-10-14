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
