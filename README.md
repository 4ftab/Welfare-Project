# Nojawan Itehad Welfare

A transparent community-giving platform for the Chitta Batta welfare committee: public projects and
financial reports, donor accounts and statements, and an administrator console. English and Urdu (RTL).

## Setup

```bash
# backend  (Node + Express + MySQL)
cd backend
npm install
# .env needs: PORT, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET, FRONTEND_URL
npm run migrate      # idempotent; adds contact_messages, donations.project_id, donations.note
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
- Login/registration and contact-form rate limiting, security headers, CSV formula-injection guard
- Skip link, ARIA roles, reduced-motion support, responsive layout

## Online payments (Safepay)

Add to `backend/.env` (sandbox keys from the Safepay dashboard; never commit this file):

```
SAFEPAY_ENV=sandbox            # or production
SAFEPAY_PUBLIC_KEY=sec_...
SAFEPAY_SECRET_KEY=...
FRONTEND_URL=http://localhost:5173
```

Flow: the donor creates a pledge → the server opens a Safepay tracker and returns a hosted-checkout URL →
the donor pays on Safepay and is redirected back → the server **asks Safepay** for the tracker state
(`GET /order/v1/{tracker}`) and only marks the donation `completed` when the state is `TRACKER_ENDED`
and the amount and currency match. The redirect URL alone is never trusted. A pending pledge can be
resumed ("Pay now") or re-checked ("Check status") from the dashboard. Without keys, the site falls back
to plain pledges that an administrator confirms.

### Easypaisa and JazzCash

Safepay has no separate API option for these wallets: they appear on Safepay's hosted checkout once
Safepay enables them on the merchant account. After Safepay confirms they are enabled, add

```
SAFEPAY_CHANNELS=card,easypaisa,jazzcash
```

to `backend/.env`. Donors then get a "Pay with" picker, and the chosen method is stored on the donation
(`donations.payment_channel`) and shown in the dashboard, admin console and CSV export. Leave it unset
(card only) until then, otherwise donors would pick a wallet and find only a card form.

Not yet implemented: a Safepay webhook (the shared secret is not configured), so payments are confirmed
when the donor returns or presses "Check status".

## Notes

- Pledges stay `pending` until Safepay confirms them or an administrator marks them completed.
