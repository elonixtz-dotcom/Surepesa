# SurePesa — implementation increment 2

## Delivered in this increment

### Circles API
The authenticated API is mounted at `/v1/circles`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/circles` | Create a Circle and atomically add its owner as an active OWNER member |
| GET | `/v1/circles` | List the signed-in user's active Circle memberships |
| GET | `/v1/circles/invitations/pending` | List invitations for the signed-in user |
| GET | `/v1/circles/:circleId` | Read Circle details, active members and recent contribution records |
| POST | `/v1/circles/:circleId/invitations` | OWNER/ADMIN invites an existing active SurePesa user by internal user ID |
| POST | `/v1/circles/:circleId/invitations/accept` | Accept the signed-in user's pending invitation |
| POST | `/v1/circles/:circleId/contributions` | Record a member's self-reported contribution |

Amounts are integer minor-unit strings. The API deliberately labels manual contributions `SELF_REPORTED`; it does not imply that SurePesa has verified an external M-Pesa/bank movement. Circle membership and contribution records do not pool, lock, lend, or custody members' money.

## Remaining work before production

- Add invitation notification delivery and invitation expiry/revocation.
- Add contribution evidence upload and trusted provider reconciliation before any contribution can be labelled VERIFIED.
- Add Circle role/permission management and owner transfer.
- Add automated route/service tests and run the full backend typecheck, Prisma validation, migration checks and integration suite.
- Diagnose and resolve the current Vercel deployment failures; connector status shows failures for the API, admin and merchant deployments.
- Implement PushBill voice gateway, payer confirmation and external provider execution only behind real partner adapters and signed callbacks.
- Implement Escrow funding/release/refund/dispute operations with concurrency controls and a legally approved safeguarding partner.
- Implement virtual-card issuing and cross-border rails only with issuer/processor and regulated payout partners.

## Release gates

No feature should be described as production-ready until its CI checks pass, database migration has been tested against a clean database and an upgraded database, authorization and replay tests pass, and provider sandbox/reconciliation tests pass. No live money movement is enabled by these changes.
