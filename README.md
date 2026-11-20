# SurePesa

Tanzanian digital wallet and payment gateway, built as a prototype with simulated payment rails.
The architecture is meant to carry over to production: mobile money, banks and cross-border providers plug in later as provider adapters.

```
Flutter app ──REST──▶ Node.js/Express API ──Prisma──▶ Neon Postgres
     │                      │        │
     └─ Neon Auth (JWT) ────┘        └──▶ Neon Object Storage (KYC documents, private)
```

## Product scope

SurePesa is organised around six product capabilities (see `docs/blueprint/SUREPESA_IMPLEMENTATION_BLUEPRINT.md`):

1. **Local Payments & Wallet Management** — send/receive, merchant QR and Lipa Namba payments, deposits and withdrawals. *In progress: prototype wallet, ledger and payment engine are running.*
2. **PushBill ★** — a customer asks another SurePesa user to pay a merchant/agent directly, confirmed over an ordinary cellular voice call before authorisation. *Implemented (voice confirmation simulated).*
3. **Borderless Payments** — cross-border send/receive and FX quotes over supported corridors. *Implemented: corridors, 5-minute FX quotes and transfers over the simulated provider.*
4. **Circles ★** — open group goal/contribution tracking (Family, Student, Vikoba, Friends, Custom). Monitoring and coordination only: Circles never hold or control members' money. *Implemented: a contribution only counts as confirmed when backed by the member's own completed payment.*
5. **Virtual Cards & Online Payments** — issuer-backed virtual cards with freeze/limits and online payments. *Implemented: prepaid virtual cards run against a simulated issuer, with issuer webhooks and an online-services catalogue.*
6. **Escrow ★** — protected buyer/seller deals with a dedicated per-deal escrow holding ledger, evidence, disputes, release and refund. *Implemented: per-deal escrow wallets on the double-entry ledger, fees on release only, full-principal refunds, admin dispute resolution.*

Two product rules apply everywhere:

- **Provider neutrality:** the customer chooses the payment provider. The app may show fees and recommendations, but never silently reroutes a payment to another provider.
- **Prototype balances are not e-money.** Wallet balances are a software ledger prototype, not customer-held funds; live e-money requires the licensed issuer, safeguarding and Bank of Tanzania approvals described in the blueprint's compliance section.

| Folder | What |
| --- | --- |
| [backend/](backend/) | API, double-entry ledger, payment engine, back-office API (`/admin/v1`) |
| [mobile/](mobile/) | Flutter customer app |
| [admin/](admin/) | Back-office console: System Controller, Customer Service, Finance, Compliance |
| [merchant/](merchant/) | Merchant portal: balance, payments, onboarding checklist, TANQR payment requests. `npm run dev` signs in with Neon Auth (via the dev proxy); `npm run demo` runs on sample data with no sign-in (`?demo=busy`, `?demo=new`). Port 5175. |
| [docs/](docs/) | Research and design records ([payment patterns teardown](docs/research/payment-patterns-teardown.md)) |

## Backend quick start

```bash
cd backend
cp .env.example .env          # fill in Neon values
npm install
npx prisma generate
npx prisma migrate deploy     # never point a shadow database at a real branch
npx prisma db seed            # currencies, system wallets, USD/TZS rate
npm run dev                   # http://localhost:4000/health
npm test                      # unit + Phase 15 financial-integrity tests
npm run reconcile             # verify ledger invariants
npm run rail-sync             # one pass of the rail status poller (the API also runs it every minute)
```

## Deployments

| App | URL | Notes |
| --- | --- | --- |
| Customer app (Flutter web) | https://surepesa-app.vercel.app/ | `/v1` and `/auth` rewrite same-origin to the API (see `mobile/web/vercel.json`) |
| Back-office console | https://surepesa-admin.vercel.app/ | `/admin` rewrites to the API (see `admin/vercel.json`) |
| API | https://surepesa-api.vercel.app/ | Express on Vercel functions; `/health` reports database/auth/storage |

Because the web apps reach the API through same-origin rewrites, no CORS entry is needed
for them; `CORS_ORIGINS` only covers non-proxied browser clients (e.g. local dev).

Deploy note: Vercel builds production from `main`. After merging a branch that adds
Prisma models, run `npm run db:deploy` (in `backend/`, with the production `DATABASE_URL`)
before the new API code serves traffic. Merging the Circles/Escrow/Borderless modules also
needs `npx prisma db seed` once, so the TZ→KE corridor and the TZS→KES rate exist.

## Money rules

- Amounts are integers in minor units (`BigInt`). The API sends them as strings.
- Every movement is a `Transaction` plus `ledger_entries` that sum to zero per currency.
- `wallets.balance` is a cache of the ledger. Only `src/services/ledger.service.ts` writes it.
- Wallet rows are locked in id order (`SELECT … FOR UPDATE`), so concurrent payments can't overspend or deadlock.
- Each payment is idempotent per `(initiator, idempotencyKey)`.
- A failed payment moves no money. A reversal is a new compensating transaction and never an edit.
- External rails sit behind `src/providers/PaymentProvider`. Only explicitly configured adapters resolve; in production an unconfigured provider fails closed with `PROVIDER_UNAVAILABLE` and is never silently rerouted to `SimulatedProvider`. During development/test the `SIMULATE_UNCONFIGURED_PROVIDERS` escape hatch (default on outside production) keeps routing names like `MPESA_TZ` to the simulator, and `SIMULATED_RAILS=off` disables the simulator entirely.
- Rails are asynchronous. A rail answer that is pending, ambiguous or a timeout never fails a payment, because money may already have moved. The transaction stays `PROCESSING` with the funds held until the rail gives a final answer.
- There are two ways to resolve a rail transaction, and both go through one idempotent, row-locked `applyRailOutcome`:
  - **Callbacks** to `POST /v1/providers/:provider/callbacks`. Each one is verified against the raw body, rejected if its timestamp is stale, and stored once in `provider_events`.
  - **Status polling** (`rail-sync`): every 3 minutes, escalated to Finance after 10 unanswered checks.
- A provider can only settle its own transactions.
- Refunds of merchant payments are new `REFUND` transactions linked to the original. Partial refunds are allowed, but the total never exceeds the original amount.
- Fees come from the `fee_rules` table, with built-in defaults as a fallback. A change is a new rule with an effective date and is never an edit.

### Trying the rail scenarios

The simulator picks its behaviour from the last four digits of the account number:

| Ends in | First answer | Later (callback or status check) |
| --- | --- | --- |
| `0000` | failed | — |
| `1111` | pending (approve on phone) | success |
| `2222` | ambiguous | success |
| `3333` | timeout | success (the money moved anyway) |
| `4444` | pending | failed: the payout is refunded |
| `5555` | pending | never answers, escalated to Finance |
| `9999` | account lookup: unknown | — |
| other | success | success |

## API so far

All `/v1` routes require `Authorization: Bearer <Neon Auth JWT>` (client: `authClient.token()` → `data.token`).

| Method | Path | |
| --- | --- | --- |
| GET | `/health` | Postgres, Neon Auth and storage status |
| GET | `/v1/me` | Current user, profile, wallets (SurePesa user auto-created on first call) |
| POST | `/v1/me/onboarding` | Name and `+255…` phone number; activates the account and creates the TZS wallet |
| POST | `/v1/kyc/submissions` | Start identity verification |
| PUT | `/v1/kyc/submissions/:id/documents/:type` | Raw JPEG/PNG/PDF body, max 5 MB, stored in the private bucket |
| GET | `/v1/kyc/submissions/:id` | Submission and 5-minute presigned document links |

| PUT | `/v1/me/pin` | Set the transaction PIN, or change it with `currentPin`. Easy-to-guess PINs are refused. 5 wrong tries lock it for 30 minutes. |
| POST | `/v1/payments/quote` | The confirmation screen: recipient's registered name, fee, total and whether the balance covers it. Moves no money. |
| POST | `/v1/payments/send` | P2P transfer by phone number. Needs `pin` and an `Idempotency-Key` header. |
| POST | `/v1/payments/merchant` | Pay a merchant by merchant code. Needs `pin` and `Idempotency-Key`. |
| POST | `/v1/payments/withdraw` | To a linked mobile-money account. Needs `pin` and `Idempotency-Key`. Returns `202` while the rail is working. |
| POST | `/v1/payments/deposit` | From a linked account. The customer approves on their phone. Needs `Idempotency-Key`. |
| GET | `/v1/transactions` | History as receipts (`?before=` for the next page) |
| GET | `/v1/transactions/:reference` | Receipt: our reference, the rail's reference, and a plain-language status |
| GET/POST | `/v1/payment-methods` | Linked mobile-money accounts. Adding one returns the rail's registered name. |
| GET/POST | `/v1/cards` | Virtual cards (prepaid Visa, up to 3 open). Creating one needs `pin`; `initialLoad` also loads it (needs `Idempotency-Key`). |
| GET | `/v1/cards/:id` | Card (never the full number) and its activity |
| POST | `/v1/cards/:id/load`, `/unload` | Move money between the wallet and the card. Needs `pin` and `Idempotency-Key`. |
| POST | `/v1/cards/:id/freeze`, `/unfreeze` | Freezing needs no PIN; unfreezing does |
| PUT | `/v1/cards/:id/limit` | Per-purchase limit, or `null` to remove it |
| POST | `/v1/cards/:id/reveal` | Card number, CVV and expiry, once, after `pin`. Never stored, served `no-store`, 5 per hour, audited. |
| POST | `/v1/cards/:id/close` | Terminates at the issuer, then returns the balance to the wallet |
| POST | `/v1/cards/:id/test-purchase` | Development only: the simulated issuer charges the card through the real decision path |
| POST | `/v1/providers/:issuer/card-events` | Issuer webhook: authorisations (answered with approve/decline), reversals, refunds |
| POST | `/v1/providers/:provider/callbacks` | Rail webhooks. Not user-authenticated: the provider's signature is the authentication. |
| GET/POST | `/v1/circles` | Circles ★: list mine, create. A circle tracks goals and contributions; it never holds money. |
| GET | `/v1/circles/invitations` | My pending invitations; `/invitations/:token/accept` / `/decline` act on them |
| GET | `/v1/circles/:id` · `/progress` | Members, goals, events and confirmed-vs-declared totals |
| POST | `/v1/circles/:id/invitations` · `/goals` · `/contributions` · `/leave` | Invite by phone, add goals, record a contribution (PROVIDER_CONFIRMED only when backed by the member's own completed payment) |
| GET/POST | `/v1/escrow/cases` | Escrow ★: create and list deals (buyer or seller) |
| POST | `/v1/escrow/cases/:id/funding-intents` | Buyer funds the deal's holding wallet. Needs `pin`. |
| POST | `/v1/escrow/cases/:id/confirm-receipt` · `/refund` · `/disputes` | Release to the seller (fee on release only), refund the buyer in full, or open a dispute |
| GET | `/v1/borderless/corridors` | Active cross-border corridors with limits |
| POST | `/v1/borderless/quotes` | 5-minute FX quote: rate, fee, recipient amount. Sending consumes the quote exactly once. |
| POST | `/v1/borderless/transfers` | Send a quoted transfer (needs `pin`, KYC approved, corridor limits). |
| GET | `/v1/online-services` | Online-services catalogue; `/:id/payment-intents` charges a virtual card through the issuer decision path |
| GET | `/v1/me/notifications` | In-app notifications; `/notifications/read-all` marks them read |
| GET | `/api/cron/sweep-expiry` | Vercel cron: sweeps expired PushBill sessions, escrow funding deadlines and FX quotes |

Amounts go in as decimal strings (`"25000"` or `"25000.50"`). Every response carries `{ value, formatted }`.

### Back office additions (`/admin/v1`)

| Method | Path | Who | |
| --- | --- | --- | --- |
| GET | `/rails/open?escalated=true` | Finance, System Controller | Deposits and withdrawals the rails haven't settled, escalated ones first |
| POST | `/rails/:id/check` | Finance, System Controller | Query the rail now (audited) |
| GET | `/rails/:id/events` | Finance, System Controller | Raw provider callbacks for a transaction |
| GET | `/fees` | Finance, Compliance, System Controller | Fee rules in force and the built-in defaults |
| POST | `/fees` | System Controller | New fee rule with a reason (`note`) and an effective date. It retires the old one and is audited. |
| POST | `/approvals` | Customer Service, Finance | Now also accepts `type: "TRANSACTION_REFUND"` with `amount` (minor units) for partial refunds. Maker-checker still applies. |
