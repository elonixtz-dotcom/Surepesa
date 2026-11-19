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
| [backend/](backend/) | API, double-entry ledger, payment engine |
| `mobile/` | Flutter app (next) |
| `admin/` | Admin dashboard (later) |

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


## First six-core implementation increment (November 2026)

Branch: `feature/surepesa-six-core-implementation`.

This increment adds:
- Authenticated local P2P and SurePesa merchant payment endpoints.
- Transaction history list/detail endpoints scoped to the signed-in user.
- Transaction PIN status/set endpoints; PIN setup requires verified phone status.
- Salted scrypt PIN hashes, constant-time verification, row-locked failed-attempt counters and a 15-minute lock after five incorrect attempts.
- Audit log and transactional outbox records written in the same PostgreSQL transaction as ledger settlement.
- Explicit provider fail-closed behaviour: only `SIMULATED` maps to the simulator.
- Initial schema for PushBill requests/voice state, reusable Circles and contribution monitoring, dedicated per-agreement Escrow ledger wallets and disputes.

Money amounts in payment request bodies are integer minor-unit strings. For example TZS 50,000.00 is `5000000`. The existing double-entry ledger remains the sole writer of wallet balances.

**Not delivered in this increment:** live GSM call bridging, USSD, telco/bank adapters, PushBill external payment execution, Circle invitation/contribution APIs, Escrow funding/release/refund services, virtual-card issuing, cross-border payout integrations or an outbox worker. Escrow's dedicated wallet is an internal accounting sub-ledger, not by itself a licensed custody or safeguarding arrangement. Circle contribution records are monitoring records and do not pool members' money.

No unconfigured provider is ever silently sent to the simulator. External rails must be explicitly integrated and tested before real-money use.
