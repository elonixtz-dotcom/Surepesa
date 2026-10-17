# SurePesa

Tanzanian digital wallet and payment gateway, built as a prototype with simulated payment rails.
The architecture is meant to carry over to production: mobile money, banks and cross-border providers plug in later as provider adapters.

```
Flutter app ──REST──▶ Node.js/Express API ──Prisma──▶ Neon Postgres
     │                      │        │
     └─ Neon Auth (JWT) ────┘        └──▶ Neon Object Storage (KYC documents, private)
```

| Folder | What |
| --- | --- |
| [backend/](backend/) | API, double-entry ledger, payment engine, back-office API (`/admin/v1`) |
| [mobile/](mobile/) | Flutter customer app |
| [admin/](admin/) | Back-office console: System Controller, Customer Service, Finance, Compliance |
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
```

## Money rules

- Amounts are integers in minor units (`BigInt`). The API sends them as strings.
- Every movement is a `Transaction` plus `ledger_entries` that sum to zero per currency.
- `wallets.balance` is a cache of the ledger. Only `src/services/ledger.service.ts` writes it.
- Wallet rows are locked in id order (`SELECT … FOR UPDATE`), so concurrent payments can't overspend or deadlock.
- Each payment is idempotent per `(initiator, idempotencyKey)`.
- A failed payment moves no money. A reversal is a new compensating transaction and never an edit.
- External rails sit behind `src/providers/PaymentProvider`. Today every provider routes to `SimulatedProvider`.

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

The payment flows (`sendMoney`, `payMerchant`, `deposit`, `withdraw`, `reverseTransaction`) are implemented and tested in `src/services/payment.service.ts`. They get HTTP routes, with PIN checks, in milestones 4–5.
