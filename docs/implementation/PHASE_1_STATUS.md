# SurePesa implementation increment 1 — status

Branch: `feature/surepesa-six-core-implementation`

## Implemented in this increment
- Authenticated API endpoints for P2P wallet transfers and payments to an onboarded SurePesa business.
- User-owned transaction history list/detail endpoints.
- Transaction PIN readiness and set/change endpoints. PIN set is blocked until a trusted phone-verification flow marks the phone verified.
- Salted scrypt PIN hashes and constant-time comparison; failed attempts are row-locked and five failures lock PIN use for 15 minutes.
- Ledger settlement writes a transaction audit log and idempotent outbox event in the same PostgreSQL transaction as ledger postings and status changes.
- Payment methods must be VERIFIED before use.
- Unknown payment provider names fail closed; only explicit SIMULATED goes to the simulator.
- Initial schema and migration for PushBill requests/voice-call state, reusable Circles, contribution monitoring, escrow agreements with one dedicated ledger wallet per deal, escrow disputes and transactional outbox.

## Not yet implemented
- Live GSM bridge, USSD gateway, SMS/push delivery adapter and provider callbacks.
- PushBill creation/notification/call/approval/payment APIs.
- Circle invitation, join, goal and contribution API workflows.
- Escrow create/fund/release/refund/dispute APIs and licensed custody arrangement.
- Virtual-card issuance/JIT funding and international FX/payout provider APIs.
- Background outbox worker and retry/dead-letter operations.

## Financial safety rules
- Database rollback only cancels uncommitted database changes; it cannot undo an external telco/bank side effect.
- External provider timeouts require status inquiry/reconciliation; never blindly retry a money movement.
- Escrow wallets are not ordinary spendable user wallets.
- Circle contributions are records for monitoring, not a pooled balance or custody account.
