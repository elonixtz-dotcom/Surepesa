# SurePesa against the SURECOM Software Development SOP Framework

| | |
| --- | --- |
| Framework | SURECOM Software Development Processes and SOP Framework, v1.0 (proposed, not yet approved) |
| System | SurePesa: API (`backend/`), customer app (`mobile/`), back office (`admin/`), merchant portal (`merchant/`) |
| Assessed | 2026-10-17, against the repository at `feature/admin-console` (25f0fde) and the Vercel deployment of the same day |
| Status | Draft for the Head of Technology and the SurePesa business owner |

The framework applies "stronger transaction, security, reconciliation and operational controls" to SurePesa (§18).

**Overall finding:** the **engineering controls are largely in place**: transaction integrity, payment testing, audit trails, maker-checker. The **process controls are mostly missing**: approvals, independent review, environment separation, UAT, release sign-off and operational records. The framework's non-negotiable rules (§19) are not yet met, so SurePesa must not handle real money or real customers yet.

Status: **Met** · **Partly met** · **Not met** · **N/A yet**

---

## 0. Act now (risks introduced by the 2026-10-17 deployment)

| # | Finding | SOP | Recommended action |
| --- | --- | --- | --- |
| 0.1 | **The public Vercel deployment used the shared development/test database**, which holds demo data and test-run leftovers. Anyone could sign up through Neon Auth, a deposit required no identity check, and every rail is the simulator, which approves deposits. So anyone could create fake balances. | §3.5 environment separation; §18.2 | **Fixed 2026-10-17, apart from one item.** The Vercel apps are now **Staging/UAT** on their own Neon branch, `staging` (`ep-misty-sunset-b53hcj2o`); development and tests stay on the branch named `production`, which should be renamed `development`. `SIMULATED_RAILS=verified` (the production default) refuses deposits from customers whose identity isn't approved; this was verified against staging. **Still open:** restrict who can reach staging (Vercel deployment protection or an allow-list). |
| 0.2 | The deployment went out with **no UAT, no release sign-off, no rollback plan and no named release approver**. | §6.1–6.2, §16, §19 rule 65 | Record it retrospectively as an emergency/pilot change (§6.3, A8). From now on, deploy production only through the release procedure. |
| 0.3 | **Revealing a virtual card's number passes the full card number (PAN) and CVV through SurePesa's API.** Nothing is stored, but transmitting them puts the API in PCI DSS scope. | §18.3 "payment-card security" | With a real issuer, use issuer-side delivery (Selcom's secure SMS link) or an issuer-hosted iframe. Keep the API path only for the simulator. |

## 1. SDLC stages and approval gates (§2)

| Stage | Status | Evidence / gap |
| --- | --- | --- |
| 1 Initiation and feasibility | **Not met** | No project proposal, feasibility or risk assessment, or documented approval (A1). |
| 2 Requirements | **Partly met** | `docs/research/payment-patterns-teardown.md` (draft, refers to SD-002) and the API tables in `README.md`. No approved SRS/BRD, acceptance criteria or requirements baseline (A2). |
| 3 Design and architecture | **Partly met** | Architecture is in code and comments (provider interfaces, ledger rules, schema). No Architecture, Security Design or Infrastructure document, and no design review. |
| 4 Development | **Partly met** | Version control and tests are in place. No review procedure (see §3 below). |
| 5 Testing and QA | **Partly met** | Strong automated tests (below). No test plan, execution report or defect register. |
| 6 UAT | **Not met** | No UAT plan, results or business sign-off. Demo data supports UAT (`npm run seed:demo`, `seed:demo-rails`). |
| 7 Deployment and release | **Not met** | Deployed to Vercel without the §6 gates (finding 0.2). |
| 8 Maintenance | **Not met** | No monitoring, alerting, incident register or tested backup restore. |

## 2. Development and coding standards (§3)

| Control | Status | Evidence / gap |
| --- | --- | --- |
| Repositories and service accounts under SURECOM ownership (§3.2) | **Partly met: confirm** | Code is on GitHub `elonixtz-dotcom/Surepesa`; hosting on Vercel team `elonixtz-dotcoms-projects`; database and auth on Neon. **Confirm these are SURECOM-controlled accounts**, not personal ones, and record the owners. |
| Secrets never committed (§3.2, §13.42) | **Met** | `.env` and `*.local.md` are git-ignored, and `.vercelignore` blocks uploads. Vercel secrets are stored as Sensitive. Secrets generated for Vercel were never printed. |
| Secret rotation (§13.42) | **Not met** | No rotation schedule. `backend/dev-staff-accounts.local.md` holds demo staff passwords in plain text on one machine. |
| Feature branches, PRs, review by someone other than the author (§3.4, §9 segregation of duties) | **Not met** | All 9 commits were made by one author directly on `feature/admin-console`, with **no pull request and no reviewer**. High-risk payment code has been written, reviewed and deployed without independent review. |
| Static analysis, dependency and secret scanning (§3.3, §13.45) | **Not met** | No CI (`.github/` absent). TypeScript strict mode and `flutter analyze` run locally only. |
| Server-side authorization, input validation, safe errors (§3.3) | **Met** | Zod validation on every route; ownership checks server-side; role permissions and maker-checker in the back office; errors never return stack traces. |
| Dependency and licence tracking / SBOM (§3.2, §12.21) | **Not met** | Lockfiles exist, but there is no inventory or licence review. |
| Environment separation (§3.5) | **Not met** | Development, automated tests and the public deployment share **one** Neon database (finding 0.1). |

## 3. Payment testing (§4.1) and transaction integrity (§18.1)

This is where SurePesa is strongest. The evidence is automated tests that run against a real PostgreSQL database.

| §4.1 scenario | Status | Test evidence |
| --- | --- | --- |
| Successful, failed and pending payments | **Met** | `payments.integration.test.ts`, `rails.integration.test.ts` |
| Repeated requests, duplicate callbacks, retries | **Met** | Idempotency-key replay; duplicate callbacks (`DUPLICATE`); duplicate card authorisations |
| Network interruption or timeout | **Met** | A payout timeout keeps funds held (`AMBIGUOUS`) and settles from a status query |
| Invalid or mismatched references | **Met** | Another provider's callback can't settle a transaction (`UNKNOWN_TRANSACTION`); a QR code from another merchant is refused |
| Unauthorized payment, refund or admin requests | **Met** | Forged webhooks get 401; maker-checker blocks self-approval; role permissions are enforced (403) |
| Delayed and out-of-order notifications | **Met** | Callbacks racing the poller; rail escalation after 10 checks |
| Refunds, reversals, reconciliation, settlement exceptions | **Partly met** | Reversals, partial refunds and card refunds are tested; `npm run reconcile` checks ledger invariants. **There's no reconciliation against provider statements** (only internal invariants), and no settlement process. |
| Monitoring and recovery after interruption | **Partly met** | Unanswered rail calls are re-checked and escalated to Finance. No monitoring or alerting, and no restore test. |

| §18.1 control | Status |
| --- | --- |
| Unique IDs, defined states | **Met**: `SPX-…` references; `PENDING → PROCESSING → SUCCESS / FAILED / REVERSED` with an append-only event history |
| Idempotent processing | **Met**: per (initiator, key); row locks; one `applyRailOutcome` path |
| Verified external notifications | **Met**: HMAC over the raw body, 5-minute replay window, event inbox (`provider_events`, `card_events`) |
| Audit trails | **Met**: transaction events; `audit_logs` for back-office actions and card-detail reveals (without the card number) |
| Reconciliation with providers | **Partly met**: internal ledger checks only |
| Controlled refunds, reversals and exceptions | **Met**: maker-checker approvals; refunds capped at the original amount; escalations go to Finance |

## 4. Security (§13, §18.2)

| Control | Status | Notes |
| --- | --- | --- |
| Strong authentication, role-based authorization | **Met** | Neon Auth JWTs; back-office roles; transaction PIN with lockout |
| MFA for critical accounts | **Not met** | Not enforced for staff, GitHub, Vercel or Neon accounts |
| Encryption in transit / at rest | **Partly met** | HTTPS everywhere; Neon encrypts at rest. KYC documents sit in private storage. No application-level encryption policy. |
| Restricted, logged production access | **Not met** | There is no separate production yet (finding 0.1) |
| Vulnerability assessment, patching | **Not met** | No scans or penetration test yet |
| Monitoring of payment failures and unusual patterns | **Partly met** | The back-office overview shows failures and stuck transactions. No fraud or anomaly monitoring. |

## 5. Regulatory readiness (§18.3): needs legal advice before go-live

| Item | Status |
| --- | --- |
| Payment-system licensing / authorisation (Bank of Tanzania) | **Not met**: identified in the research note as a "Must"; not resolved |
| Data protection (Personal Data Protection Act 2022) | **Not met**: no data-protection assessment or retention policy for KYC documents |
| Agreements with banks, MNOs and Selcom | **N/A yet**: all rails are simulated |
| Customer due diligence / AML | **Partly met**: identity verification is required before sending money or creating cards; no AML monitoring |
| Card security (PCI DSS) | **Partly met**: card numbers and CVVs are never stored; see finding 0.3 on transmitting them |

## 6. Mandatory documentation (§12)

Present today: source repository and history (9), API documentation (6, in README), coding conventions in code comments (10, partial), and change history via commit messages (19, partial).

Missing: proposal and feasibility (1), BRD/SRS (2–3), architecture (4), data design (5), UI/UX (7), security design (8), test plan and report (11), defect register (12), UAT (13), deployment and rollback plan (14), user manual (15), runbook (16), backup and recovery (17), support plan (18), incident register (20), SBOM (21) and closure record (22).

---

## Recommended order of work

1. **Environments (this week).**
   - Create Neon branches for `dev`, `test` and `staging`, so the shared database becomes development only.
   - Point Vercel at `staging`, rename it as Staging in the docs, and restrict who can reach it (finding 0.1).
   - Give automated tests their own branch.
2. **Review workflow.**
   - Protect `main` on GitHub: changes only by pull request, with one approval from someone other than the author.
   - Add CI on every pull request: typecheck, unit tests, `flutter analyze`, and dependency and secret scanning.
   - Merge `feature/admin-console` through a reviewed pull request.
3. **Release records.** Use the A5 deployment checklist and the A8 release sign-off form for every staging and production deploy, and record today's deploy retrospectively.
4. **Documents to unblock the gates.**
   - A short SRS with acceptance criteria. The README and research note are a starting point.
   - An architecture and security design: trust boundaries, webhook verification, ledger and PCI scope.
   - A test plan that maps the §4.1 scenarios to the existing tests.
   - A runbook covering rail escalations, reconciliation and the 30-minute PIN lockout.
5. **Operations.** Error monitoring and alerting, a tested backup restore from Neon, and an incident register.
6. **Regulatory.** Get Tanzanian legal and compliance advice on Bank of Tanzania authorisation, data protection and card-issuer arrangements before any pilot with real money (§18.3, §19).
