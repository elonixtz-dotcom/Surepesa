# SurePesa — Repository Implementation Blueprint

**Repository reviewed:** `elonixtz-dotcom/Surepesa`  
**Branch reviewed:** `main`  
**Review date:** 19 November 2026  
**Purpose:** Extend the existing prototype into the approved SurePesa product without discarding the useful financial foundations already in the repository.

---

## 1. Product decisions to preserve

SurePesa is organised around **six product capabilities**. The first five are the previously approved pillars; Escrow is added as a sixth, separately modelled capability because it has its own held-funds lifecycle and dedicated escrow-wallet ledger.

1. **Local Payments & Wallet Management**
2. **PushBill ★** — founder-proposed differentiator
3. **Borderless Payments**
4. **Circles ★** — founder-proposed open circle-creation model
5. **Virtual Cards & Online Payments**
6. **Escrow ★** — protected buyer/seller transactions with a dedicated escrow wallet ledger

Shared infrastructure is not a seventh product pillar. It supports the six capabilities: identity/KYC, provider adapters, ledger, voice gateway, USSD gateway, notifications, merchant portal, agent portal, reconciliation, risk controls and administration.

### Product rules

- **Provider neutrality:** the customer chooses the supported payment provider. SurePesa may show fees, availability and recommendations, but must not silently reroute a payment to another provider.
- **Fail closed:** production must never silently send a real transaction to `SimulatedProvider` when a real provider adapter is missing.
- **PushBill voice rule:** PushBill requires an ordinary cellular voice call between the requester and payer before payment authorisation. An unanswered, declined, interrupted or unconfirmed call means no payment authorisation.
- **USSD rule:** the USSD interaction must be completed/closed before the system starts a normal voice call. After the call, the payer authorises through a new USSD session or the app. Never ask for a PIN to be spoken during the call.
- **Circles are monitoring/co-ordination:** a Circle tracks goals, commitments, contributions, reminders and records. It does not pool, hold, lend or control members' personal money by default. Each member retains control of their own funds.
- **Escrow is different from Circles:** Escrow is designed to hold funds under an agreed transaction. It therefore needs a dedicated escrow sub-wallet/ledger account, release/refund workflows and a compliant custody arrangement.
- **Wallet prototype versus live e-money:** existing database wallet balances are a software ledger prototype. They must not be represented as live customer-held e-money until the issuer, safeguarding, settlement and regulatory arrangements are in place.

---

## 2. Verified repository baseline

The public `main` branch currently describes this stack:

- Flutter mobile application
- Node.js / Express 5 backend with TypeScript
- Prisma ORM and PostgreSQL/Neon
- Neon Auth JWT authentication
- Neon private object storage for KYC documents
- Payment provider abstraction, currently backed by a simulator

### Existing files worth preserving

| Existing path | What it currently does | Blueprint decision |
|---|---|---|
| `backend/prisma/schema.prisma` | Existing User, Business, Wallet, Transaction, LedgerEntry, PaymentMethod, QrCode, Currency and related models | Extend with additive migrations; do not replace the schema |
| `backend/src/services/payment.service.ts` | Existing send, merchant payment, deposit, withdrawal and reversal flows | Keep as the shared payment execution layer; add module services that call it where appropriate |
| `backend/src/services/ledger.service.ts` | Central double-entry posting, wallet locking and reconciliation | Preserve as the only writer of wallet balances and ledger entries |
| `backend/src/services/wallet.service.ts` | User/business wallet lookup and system wallet helpers | Extend with controlled system/escrow account helpers; never expose escrow accounts as normal user wallets |
| `backend/src/providers/index.ts` | Provider registry; currently falls back to `SimulatedProvider` | Replace silent fallback with explicit provider resolution and production fail-closed behaviour |
| `backend/src/providers/payment-provider.ts` | Common provider contract | Extend carefully for quote, collect, payout, status lookup, webhook verification and refund capabilities |
| `backend/src/providers/simulated.provider.ts` | Development/test payment simulator | Keep for local development and tests only |
| `backend/src/app.ts` | Express setup; currently mounts health, `me` and KYC routes | Mount the new versioned module routers here |
| `backend/src/routes/health.routes.ts` | Health checks | Keep and extend operational health checks as services are added |
| `backend/src/routes/me.routes.ts` | Current-user profile and wallet summary | Keep as profile endpoint; avoid turning it into a catch-all business route |
| `backend/src/routes/kyc.routes.ts` | KYC submission and private document upload | Preserve; add business/circle/escrow verification workflows separately where needed |
| `mobile/lib/main.dart` | Flutter application entry and root navigation state | Preserve |
| `mobile/lib/screens/home_shell.dart` | Bottom navigation and central scan action (currently shows Coming Soon) | Turn scan action into the real scanner entry point |
| `mobile/lib/state/app_state.dart` | Session state and API client access | Extend with feature state/repositories; do not put all feature logic here |
| `mobile/lib/screens/services_screen.dart` | Service catalogue UI | Replace Coming Soon destinations incrementally with real feature flows |

### Important current limitations

1. `backend/src/app.ts` currently mounts only health, current-user and KYC routers. Payment services are not yet exposed as complete production API journeys.
2. The provider registry currently routes unknown provider names to the simulator. This is acceptable for a prototype only, not for production.
3. The mobile app has a functioning shell and starter screens, but the central Scan action and several service entries are still placeholders.
4. The schema's `Wallet` is an internal ledger account. A database row alone does not establish that customer funds are held by a licensed issuer or safeguarded at a bank.
5. `PaymentMethod` includes provider and account identifiers. Sensitive account identifiers must be encrypted/tokenised and masked in API responses; they must never be logged.

---

## 3. Recommended architecture: modular monolith first

Do not split the product into microservices at this stage. Keep one deployable Express application with clear module boundaries, one PostgreSQL database, a shared ledger, background jobs and provider adapters. This keeps the first implementation manageable while preventing the six product areas from becoming one large service file.

### Proposed backend layout

```text
backend/src/
  app.ts
  server.ts
  config/
  lib/
  middleware/
  providers/
    payment-provider.ts
    simulated.provider.ts
    index.ts
    mpesa/                 # real adapter only after partner credentials/approval
    airtel/
    mixx/
    bank/
    card-issuer/
    voice-carrier/
    escrow-custodian/
  routes/
    health.routes.ts
    me.routes.ts
    kyc.routes.ts
  modules/
    local-payments/
      local-payments.routes.ts
      local-payments.service.ts
      local-payments.schemas.ts
      local-payments.repository.ts
    pushbill/
      pushbill.routes.ts
      pushbill.service.ts
      pushbill.state-machine.ts
      pushbill.schemas.ts
      pushbill.repository.ts
    borderless/
      borderless.routes.ts
      borderless.service.ts
      fx.service.ts
      corridor-policy.service.ts
    circles/
      circles.routes.ts
      circles.service.ts
      goals.service.ts
      contributions.service.ts
    cards/
      cards.routes.ts
      cards.service.ts
      card-issuer.adapter.ts
      card-webhook.service.ts
    escrow/
      escrow.routes.ts
      escrow.service.ts
      escrow.state-machine.ts
      escrow-ledger.service.ts
      escrow-disputes.service.ts
      escrow-reconciliation.service.ts
    merchants/
      merchants.routes.ts
      merchants.service.ts
      settlements.service.ts
    agents/
      agents.routes.ts
      agents.service.ts
    people/
      people.routes.ts
      people-search.service.ts
    voice/
      voice.service.ts
      voice-webhook.routes.ts
    ussd/
      ussd.routes.ts
      ussd.service.ts
    notifications/
      notifications.service.ts
    reconciliation/
      reconciliation.service.ts
  services/
    payment.service.ts
    ledger.service.ts
    wallet.service.ts
    fee.service.ts
  jobs/
    webhook-retries.job.ts
    payment-reconciliation.job.ts
    escrow-expiry.job.ts
    circle-reminders.job.ts
```

The existing `services/payment.service.ts`, `services/ledger.service.ts` and `services/wallet.service.ts` should remain shared foundations. The module services should own product rules and call those shared foundations, rather than copying ledger or payment logic.

### Proposed Flutter layout

```text
mobile/lib/
  core/
    theme.dart
    routing.dart
    api/
    auth/
    widgets/
  features/
    local_payments/
      screens/
      widgets/
      models/
      repositories/
    pushbill/
      screens/
      widgets/
      models/
      repositories/
    borderless/
    circles/
      screens/
      widgets/
      models/
      repositories/
    cards/
    escrow/
    people/
    notifications/
  screens/
    auth_screen.dart
    onboarding_screen.dart
    home_shell.dart
  state/
```

Do not move every existing Flutter file immediately. Build the new features alongside the current screens, then migrate incrementally when the feature is stable.

---

## 4. Shared foundations to complete first

### 4.1 Identity, account security and roles

Extend the existing User/KYC foundation with:

- verified phone number and secure recovery flow;
- transaction PIN setup, hashing, retry limits and lockout;
- device/session registry and security notifications;
- account states and transaction limits tied to KYC/risk status;
- business verification and merchant ownership checks;
- Circle membership roles and Escrow participant roles.

User search should reveal only the minimum identity information needed to recognise the intended SurePesa user. Add privacy settings, consent, rate limits and anti-enumeration controls. Do not allow anonymous bulk phone-number discovery.

### 4.2 Ledger rules

Keep `ledger.service.ts` as the only writer of `Wallet.balance` and `LedgerEntry`.

Required rules:

- store money in integer minor units (`BigInt`), never floating-point values;
- every posting balances to zero per currency;
- lock touched wallet rows in a deterministic order;
- use idempotency keys for every money-moving operation;
- use explicit database transaction boundaries (`BEGIN` / Prisma `$transaction`, `COMMIT`, and `ROLLBACK`) for all related wallet, transaction, ledger, reservation, audit and outbox writes; on any database error or invariant failure, roll back the entire uncommitted unit so no partial debit/credit survives;
- keep external payment calls outside long-running database transactions: persist an idempotent intent, call the selected provider, then process its verified result in a new database transaction; an uncertain provider outcome is `UNKNOWN` and requires reconciliation, not a blind rollback/retry;
- never edit or delete posted ledger entries; create compensating reversals/refunds for completed movements; database `ROLLBACK` cannot undo an already completed external telco, bank, card or custodian operation;
- maintain immutable transaction status events;
- reconcile internal ledger totals against provider and safeguarding/custody statements;
- distinguish available, pending, reserved and held funds;
- never treat a simulated float as proof of real-world funds.

### 4.3 Provider-neutral payment selection

Create a `PaymentOption`/quote response that lists only routes that can perform the requested transaction type and currency. Each option should show provider name, fees, total debit, expected processing type, availability and limits where known.

The customer selects the provider. Recommendations such as lowest fee or likely fastest are optional labels only. If the selected provider fails, report the failure and ask the customer to choose again. No silent rerouting.

Production provider resolution must throw `PROVIDER_UNAVAILABLE` when an actual adapter is not configured. `SIMULATED` must require an explicit development/test setting.

---

## 5. Core 1 — Local Payments & Wallet Management

### Scope

- send and receive money;
- SurePesa-to-SurePesa transfers when the relevant wallet/issuer model is live;
- linked M-Pesa, Mixx, Airtel and bank payment methods;
- customer-chosen provider at payment time;
- merchant QR and Lipa Namba/manual merchant payments;
- supported utility/bill payments;
- transaction history, fees, receipts and reversals;
- wallet balance and available/pending balance display.

### User flow: external source payment

```text
Open SurePesa
  -> Choose Local Payments
  -> Choose action (send / merchant / bill / deposit / withdrawal)
  -> Enter recipient or scan QR / enter Lipa Namba
  -> Enter amount and reference
  -> Select payment source/provider
  -> Review recipient, fees and total debit
  -> Confirm with transaction PIN / supported provider authorisation
  -> Submit idempotent payment intent
  -> Wait for provider callback/status lookup
  -> Update ledger only on verified success
  -> Show receipt and updated transaction history
```

### Algorithm

`PaymentOptionService` evaluates user-selected eligible methods; it does not choose a provider on the user's behalf. It validates currency, transaction type, KYC, limits, fees, destination and provider availability. The selected method is bound to the intent and stored transaction so that a retry cannot silently change route.

### Database additions

Most of the foundation already exists in `Currency`, `Wallet`, `Transaction`, `LedgerEntry`, `PaymentMethod`, `QrCode` and `Business`. Add only where necessary:

- `PaymentQuote` for short-lived fee/rate/provider quotes;
- `ProviderWebhookEvent` for signature-verified, idempotent callbacks;
- `SettlementBatch` and `SettlementLine` for merchant/provider settlement reconciliation;
- `ExternalAccountToken` (or an encrypted/tokenised extension of `PaymentMethod`) for provider-held account tokens.

### API outline

- `GET /v1/payment-methods`
- `POST /v1/payment-methods`
- `DELETE /v1/payment-methods/:id`
- `GET /v1/payment-options?type=...&amount=...&currency=...`
- `POST /v1/payment-quotes`
- `POST /v1/payments/transfers`
- `POST /v1/payments/merchant`
- `POST /v1/payments/bills`
- `POST /v1/payments/deposits`
- `POST /v1/payments/withdrawals`
- `GET /v1/transactions`
- `GET /v1/transactions/:reference`
- `POST /v1/webhooks/payments/:provider`

### Completion criteria

A test user can select a specific provider, review all costs, authorise the transaction, receive a verified success/failure/pending status and obtain an auditable receipt. In production, no unconfigured provider can be simulated.

---

## 6. Core 2 — PushBill ★

### Purpose

A SurePesa user at a merchant/agent asks another SurePesa user to pay that merchant/agent directly. The requester can either scan a supported QR or manually enter a supported agent number/Lipa Namba and amount. The merchant should not have to collect the payer's phone number or create a request for the customer.

### Entry methods

1. **Scan:** scan a supported merchant/agent QR and validate its signed/registered destination.
2. **Manual entry:** enter Lipa Namba/agent number, amount and reference; resolve the destination server-side before sharing it with a payer.

The requester then searches for a SurePesa user by SurePesa ID/phone or chooses someone from an existing Circle. The payer must be a registered SurePesa user for the agreed first version.

### Required flow

```text
Requester opens PushBill
  -> Scan supported QR OR manually enter Lipa Namba/agent number
  -> Server resolves and displays verified destination
  -> Requester enters amount/reference
  -> Requester selects payer (SurePesa search or Circle)
  -> Server creates one-time, expiring PushBill session
  -> Payer receives in-app/USSD notification
  -> Both users are prompted for a NORMAL cellular voice call
  -> Voice gateway calls both verified mobile numbers and bridges the calls
  -> Both parties verify merchant, amount and purpose verbally
  -> Call provider reports connected/completed; each party completes an explicit confirmation step
  -> Payer returns to app or opens a new USSD session
  -> Payer reviews exact destination, amount and selected funding provider
  -> Payer authorises with PIN/biometric or secure USSD PIN
  -> Selected provider executes payment
  -> Provider success is verified
  -> Receipt/status reaches requester, payer and merchant where supported
```

**No answer / decline / mismatch / expired call = no payment authorisation.** A call being answered is not by itself payment consent. The payer must explicitly authorise the exact payment after the conversation. A PIN must never be spoken or collected by a person during the bridged call.

### USSD behaviour

- Requester enters the request details in a USSD session.
- The backend stores the PushBill request and returns a confirmation that the session can end.
- After the USSD session has ended, the voice gateway initiates the ordinary cellular call.
- After the call, the payer starts a fresh USSD session to review and authorise. No assumption should be made that the first USSD session remains open during a voice call.

### State machine

```text
CREATED
  -> DESTINATION_VERIFIED
  -> PAYER_SELECTED
  -> PAYER_NOTIFIED
  -> CALL_REQUESTED
  -> CALLING
  -> CALL_CONNECTED
  -> BOTH_PARTIES_CONFIRMED
  -> AWAITING_PAYER_AUTH
  -> PAYMENT_PROCESSING
  -> PAID

Alternative terminal/exception states:
DECLINED, NO_ANSWER, CALL_FAILED, MISMATCH, EXPIRED,
CANCELLED, PAYMENT_FAILED, PAYMENT_UNKNOWN, REVIEW_REQUIRED
```

If a provider reports an unknown status or times out after accepting the request, mark it `PAYMENT_UNKNOWN` and reconcile before retrying. Never create a duplicate payment by blindly retrying.

### Algorithm

`PushBillOrchestrator` coordinates destination validation, payer binding, session expiry, voice status, explicit confirmations, payer authorisation, payment provider execution and receipts. Use signed/opaque one-time session tokens, bind the approved amount and destination to the session, and reject any mutation after payer approval.

### Proposed database models

- `PushBillSession`: requester, payer, destination, amount, currency, reference, expiry, state, idempotency key and final payment transaction.
- `PushBillConfirmation`: participant, confirmation method, confirmed details hash, timestamp and result.
- `VoiceCallAttempt`: provider, provider call IDs, participants, call states, start/end times, failure code; never store call audio by default.
- `PushBillEvent`: append-only state/event history.
- Reuse `Transaction` for the actual payment; do not create a parallel money ledger.

### API outline

- `POST /v1/pushbills`
- `GET /v1/pushbills`
- `GET /v1/pushbills/:id`
- `POST /v1/pushbills/:id/accept`
- `POST /v1/pushbills/:id/decline`
- `POST /v1/pushbills/:id/call`
- `POST /v1/pushbills/:id/confirm`
- `POST /v1/pushbills/:id/authorize`
- `POST /v1/webhooks/voice/:provider`

### Completion criteria

A requester can scan or manually enter a supported destination, choose a payer, complete a normal cellular voice call, and receive payment only after the payer explicitly authorises. The full journey must be tested for app-to-app and USSD-to-USSD use, no-answer, call drop, duplicate webhook and payment-unknown cases.

---

## 7. Core 3 — Borderless Payments

### Scope

- home-wallet access while travelling, where partner rules allow;
- cross-border send and receive;
- local-to-local payments initiated while the customer is abroad;
- supported international QR/merchant payments;
- multi-currency balances/quotes;
- FX quotes and conversions;
- international online merchant/payment service integrations;
- corridor, currency and country availability rules.

### User flow

```text
Open Borderless
  -> Choose send / receive / pay / exchange
  -> Select destination country and currency
  -> Enter recipient or scan supported local merchant QR
  -> Select source wallet/provider
  -> Request FX/payment quote
  -> Review rate, fees, recipient amount and quote expiry
  -> User confirms
  -> Compliance, limits and corridor checks
  -> Submit through selected partner/provider
  -> Verify collection, payout and settlement callbacks
  -> Show final receipt and FX breakdown
```

### Algorithm

`BorderlessPaymentOrchestrator` checks supported corridors, permitted currencies, KYC/AML rules, limits, provider availability, FX rate freshness and fees. It displays eligible routes and lets the user select. It must not silently switch to another corridor/provider.

### Proposed data models

- `PaymentCorridor`: origin/destination country, currency pair, allowed transaction types and status.
- `FxQuote`: source/destination amounts, rate, fees, provider, expiry and acceptance.
- `CrossBorderTransfer`: sender, recipient, corridor, quote, selected provider, compliance state and settlement state.
- `ProviderSettlement`: settlement references, amount, currency, value date and reconciliation status.

### Completion criteria

At least one legally and operationally supported corridor completes end-to-end in partner sandbox and then a controlled production pilot. Unsupported countries/currencies must be clearly unavailable, not simulated as live.

---

## 8. Core 4 — Circles ★

### Purpose

Anyone who is eligible to use SurePesa can create a Circle and invite people around a shared purpose. Family, Student, Vikoba, Friends and Custom are templates/configurations on one reusable Circle engine.

### Circle types

- **Family Circle:** family support, allowances, school/household goals and shared records.
- **Student Circle:** students organise a group, track goals and contributions, and involve parents/sponsors if they choose.
- **Vikoba Circle:** contribution calendars, member progress, reminders, group reports and agreed meeting/approval records.
- **Friends/Custom Circle:** any group with a goal or purpose selected by its creator.

### Important financial boundary

Circles are monitoring and coordination tools. SurePesa does not lend money and does not take custody of Circle members' money in this model. Members retain control of their own wallets/accounts. A contribution is labelled as provider-confirmed only when supported by a payment integration or verified receipt; otherwise it must be marked self-reported/unverified. Never show an external account balance that SurePesa cannot actually verify.

### User flow

```text
Open Circles
  -> Create Circle
  -> Select template (Family / Student / Vikoba / Friends / Custom)
  -> Set name, purpose, target, due date and visibility
  -> Invite SurePesa users by search, ID, phone or invitation
  -> Members accept invitation and relevant terms
  -> Set optional contribution plan and member roles
  -> Members make their own payments through supported channels
  -> SurePesa records verified or self-reported contributions
  -> Dashboard updates progress and sends reminders
  -> Circle exports a report/history
```

### Algorithm

`CircleGoalMonitor` calculates target progress from contribution records, distinguishes confirmed from unverified amounts, checks contribution deadlines, sends reminders and enforces membership permissions. It does not move money, restrict withdrawals from external accounts or claim custody of members' savings.

### Proposed database models

- `Circle`: name, type, purpose, creator, visibility, target amount/currency, target date and status.
- `CircleMember`: user, role, join status, joined/left dates and permissions.
- `CircleInvitation`: inviter, invitee/contact, token, expiry and status.
- `CircleGoal`: one or more defined goals belonging to a Circle.
- `ContributionPlan`: expected amount/frequency/deadline; not proof of money held.
- `ContributionRecord`: member, amount, currency, date, source, evidence/reference and verification status.
- `CircleEvent`: append-only activity/audit log.
- `CircleNotificationPreference`: member's reminder preferences.

### API outline

- `POST /v1/circles`
- `GET /v1/circles`
- `GET /v1/circles/:id`
- `PATCH /v1/circles/:id`
- `POST /v1/circles/:id/invitations`
- `POST /v1/circles/invitations/:token/accept`
- `POST /v1/circles/:id/members/:userId/role`
- `POST /v1/circles/:id/goals`
- `POST /v1/circles/:id/contributions`
- `GET /v1/circles/:id/progress`
- `GET /v1/circles/:id/report`

### Completion criteria

A user can create any Circle template, invite users, manage member permissions, create goals and view contribution progress without SurePesa taking control of members' external money.

---

## 9. Core 5 — Virtual Cards & Online Payments

### Scope

- create virtual cards through a card issuer/program manager;
- card status, freeze/unfreeze and spending controls;
- supported wallet-linked funding;
- Just-in-Time Funding (JIT), if the issuer supports it;
- one-time/recurring/merchant-specific cards where supported;
- online service catalogue and subscription/payment records;
- card authorisation notifications and transaction history.

### User flow

```text
Open Cards
  -> Apply/create virtual card through issuer
  -> Complete issuer KYC/cardholder checks
  -> Choose supported funding source (SurePesa wallet or linked provider)
  -> Set controls and confirm terms
  -> Card issuer provisions card/token
  -> User pays online
  -> Issuer sends authorisation request
  -> SurePesa funding service checks source balance/limits
  -> Approve or decline within issuer deadline
  -> Issuer/network completes or declines purchase
  -> Webhook updates card transaction history
```

### JIT funding rule

A card can have no preloaded balance only if the issuer/program supports a real-time authorisation/funding model. SurePesa must receive the issuer authorisation request, check the chosen funding source, reserve/debit funds through an approved path and respond within the issuer's deadline. Do not assume a normal M-Pesa API can automatically fund any Visa/Mastercard authorisation; this requires an agreed card issuer and compatible mobile-money/bank funding integration.

### Proposed database models

- `CardProgram`: issuer, network, supported countries/currencies and programme status.
- `VirtualCard`: user, issuer token/reference, masked PAN, expiry metadata, status and controls. Do not store raw PAN/CVV unless the PCI programme explicitly permits it; prefer issuer tokens/hosted controls.
- `CardFundingSource`: permitted wallet/provider token and priority chosen by user.
- `CardAuthorization`: issuer request, merchant, amount, currency, deadline, decision and reason.
- `CardTransaction`: settled/cleared transaction record and provider references.
- `CardEvent`: append-only card lifecycle and control history.

### API outline

- `POST /v1/cards`
- `GET /v1/cards`
- `GET /v1/cards/:id`
- `POST /v1/cards/:id/freeze`
- `POST /v1/cards/:id/unfreeze`
- `PATCH /v1/cards/:id/controls`
- `POST /v1/cards/:id/funding-sources`
- `POST /v1/webhooks/cards/:issuer`
- `GET /v1/online-services`
- `POST /v1/online-services/:serviceId/payment-intents`

### Completion criteria

A partner-issued test card can be created, displayed safely, controlled, funded from a supported source and used in a sandbox online transaction with a verified authorisation/settlement record.

---

## 10. Core 6 — SurePesa Escrow ★

### Product definition

Escrow is a standalone SurePesa capability for protected buyer/seller transactions. It is not just a gateway integration. It has a dedicated escrow wallet ledger, per-deal held balance, deal terms, evidence, delivery status, dispute management, release and refund operations.

### What “Escrow Wallet” means in the application

- Every funded escrow deal has a dedicated logical escrow sub-wallet/account in the SurePesa ledger.
- Its balance represents funds locked for that specific deal and cannot be spent, transferred or withdrawn through normal user-wallet APIs.
- Only the Escrow service can request release/refund postings, after checking the deal state and authorised decision.
- It is not a second spendable wallet owned by the buyer or seller.
- The real money backing the escrow balance is held under the approved licensed partner/custody/safeguarding arrangement. The internal Escrow Wallet is the auditable allocation/sub-ledger, not proof of a separate bank account for each deal.
- Escrow funds must never be used as SurePesa working capital or mixed with company operating funds.

This satisfies the product requirement for an Escrow Wallet experience and ledger while keeping the legal custody model explicit.

### Primary user flow

```text
Buyer and seller agree on item/service, price, delivery window and inspection terms
  -> Create Escrow Deal
  -> Other party accepts exact terms
  -> System generates funding instruction/quote
  -> Buyer selects supported funding provider
  -> Buyer authorises payment
  -> Provider confirms collected/settled funds
  -> Ledger credits that deal's dedicated ESCROW_HOLDING wallet
  -> Seller sees FUNDED / funds secured status
  -> Seller ships or performs service and submits evidence
  -> Buyer confirms receipt/acceptance OR raises a dispute
  -> If accepted: authorised release posts debit from escrow wallet to seller settlement destination
  -> If refund agreed/awarded: authorised refund posts debit from escrow wallet to buyer refund destination
  -> Both parties receive final receipt and event history
```

### Escrow state machine

```text
DRAFT
  -> AWAITING_COUNTERPARTY
  -> TERMS_ACCEPTED
  -> AWAITING_FUNDING
  -> FUNDING_PROCESSING
  -> FUNDED
  -> FULFILMENT_IN_PROGRESS
  -> AWAITING_BUYER_CONFIRMATION
  -> RELEASE_PENDING
  -> RELEASED

Alternative states:
DECLINED, EXPIRED, CANCELLED, FUNDING_FAILED,
DISPUTED, REFUND_PENDING, REFUNDED, REVIEW_REQUIRED,
PAYOUT_PENDING, PAYOUT_FAILED, PAYOUT_UNKNOWN
```

The release deadline/inspection window must be explicit in the accepted deal terms. Do not invent a universal auto-release period. Automatic release, if ever offered, must be opt-in, clearly disclosed, legally reviewed and implemented only after a partner/regulatory sign-off. Disputes pause release until an authorised resolution.

### Escrow algorithm

`EscrowOrchestrator` owns deal rules and calls the shared payment/ledger services:

1. verify buyer/seller identity and eligibility;
2. create immutable deal terms and ensure both sides accept the same terms hash;
3. validate price, currency, fees, expiry, category and transaction limits;
4. collect funds via the user-selected supported provider;
5. credit the dedicated per-deal escrow wallet only after verified provider success;
6. record shipment/service evidence and buyer confirmation;
7. prevent release while the case is disputed, frozen or under review;
8. require authorised release/refund decision with a complete audit trail;
9. debit escrow wallet exactly once and execute payout/refund through a supported partner;
10. reconcile internal escrow liabilities with partner custody/safeguarded balances.

### Existing ledger integration

Do not build a parallel ledger. Extend the existing central ledger safely:

- Add `ESCROW_HOLDING` to `WalletKind`.
- Create a dedicated system-style wallet for each escrow case, with a unique `systemCode` such as `ESCROW_CASE_<caseId>_<currency>`.
- Add a relation from `EscrowCase` to exactly one escrow wallet.
- Add `ESCROW_HOLD`, `ESCROW_RELEASE`, `ESCROW_REFUND` and `ESCROW_ADJUSTMENT` ledger entry types (or an equivalent audited transaction subtype).
- Keep `allowNegative = false` for escrow wallets.
- Add a hard service-level guard and database constraints where feasible so ordinary P2P/merchant/withdrawal paths cannot debit an escrow wallet.
- `ledger.service.ts` remains the only code that posts ledger entries or changes cached wallet balances.

### Proposed escrow models

- `EscrowCase`: reference, buyer, seller/business, amount, currency, fee, accepted terms snapshot/hash, status, funding/release deadlines, escrow wallet ID and timestamps.
- `EscrowFunding`: case, provider, payment intent/transaction, provider reference, amount, status and callback verification.
- `EscrowEvidence`: case, submitted by, evidence type, private object key, checksum and timestamp.
- `EscrowDispute`: case, opener, reason, requested outcome, status, resolution and resolver.
- `EscrowEvent`: append-only event history with actor, action, old/new state and evidence reference.
- `EscrowPayout`: release/refund instruction, destination, provider reference, idempotency key, status and reconciliation state.
- `EscrowCustodyAccount`: licensed custodian/partner reference, currency, account identifier token/mask, active status and reconciliation configuration. Do not store unencrypted bank credentials.
- `EscrowReconciliation`: custody statement totals, internal held totals, differences, review status and signed-off reviewer.

### API outline

- `POST /v1/escrow/cases`
- `GET /v1/escrow/cases`
- `GET /v1/escrow/cases/:id`
- `POST /v1/escrow/cases/:id/accept-terms`
- `POST /v1/escrow/cases/:id/funding-intents`
- `POST /v1/escrow/cases/:id/evidence`
- `POST /v1/escrow/cases/:id/confirm-receipt`
- `POST /v1/escrow/cases/:id/disputes`
- `POST /v1/escrow/cases/:id/cancel` (only allowed before funding or under agreed rules)
- `POST /v1/escrow/cases/:id/release` (buyer/authorised workflow, not arbitrary admin bypass)
- `POST /v1/escrow/cases/:id/refund` (authorised decision only)
- `GET /v1/escrow/wallets/:id/summary` (read-only held/available state; no generic send/withdraw endpoint)
- `POST /v1/webhooks/escrow/:partner`
- Admin-only dispute and reconciliation endpoints under a separately protected admin namespace.

### Fee model

Possible revenue sources include disclosed escrow service fees, seller/buyer fees agreed at checkout, and partner revenue-sharing where lawful and commercially agreed. Never treat the held principal as revenue. Record fees separately from escrow principal and show them before either party accepts the transaction.

### Completion criteria

A test deal can be created, accepted by both parties, funded through a sandbox provider, recorded in its own escrow wallet, marked delivered, explicitly accepted, released to the seller and fully reconciled. A separate dispute test must stop release and support an authorised refund/release outcome. No normal wallet endpoint can spend the held funds.

---

## 11. Shared supporting systems

### Merchant Portal

Merchant tools are supporting infrastructure for Local Payments, PushBill and Escrow, not an additional core pillar.

- merchant/business onboarding and verification;
- merchant identifiers and supported QR management;
- incoming payment status and transaction history;
- settlement tracking and reconciliation;
- staff accounts and permissions;
- refunds through supported payment rails;
- Escrow seller view: see a secured/funded order, provide shipping/service evidence, view pending release and dispute status.

A merchant must not need to know the customer's family relationships or who is paying a PushBill. The customer initiates PushBill; merchant workflow remains unchanged.

### Agent Portal

- agent onboarding and verification;
- supported agent payment identifiers;
- cash-in/cash-out service records only where partner agreements permit;
- agent transaction history and commission statements;
- liquidity/float monitoring only when a provider supplies reliable data;
- reconciliation and support.

### Voice Gateway

- initiate ordinary cellular calls using a telecom/voice partner capable of outbound PSTN/mobile calling and bridging;
- verify provider webhook signatures;
- record call IDs, answered/no-answer/busy/failed/connected/ended states;
- handle consent, retries, rate limits and cost controls;
- do not record call audio by default;
- do not infer verbal agreement from call answered alone.

### USSD Gateway

- provide the same core account and PushBill request paths for feature phones;
- close the USSD session before a voice call;
- payer re-enters a fresh USSD session after the call to review/authorise;
- use short-lived sessions and idempotency;
- never collect a PIN in plaintext logs.

### Notifications and search

- in-app pushbill/payment/escrow/circle notifications;
- SMS only for minimal alerts and a secure deep link/reference (ordinary SMS is not end-to-end encrypted);
- user search by SurePesa ID/phone with masking, consent and anti-enumeration protection;
- event history for key actions.

---

## 12. Existing-file change map

| Existing file | Required change |
|---|---|
| `backend/prisma/schema.prisma` | Add enums/models for PushBill, Circles, Borderless, Cards, Escrow, custody and webhook events; add `ESCROW_HOLDING` wallet kind and escrow ledger entry types |
| `backend/src/services/ledger.service.ts` | Keep central posting/reconciliation; add safe account-kind rules and escrow-specific allowed posting paths |
| `backend/src/services/wallet.service.ts` | Add escrow wallet creation/lookup helpers; ensure it is not returned as a normal customer's spendable wallet |
| `backend/src/services/payment.service.ts` | Keep common payment orchestration; add explicit provider binding, transaction statuses/webhooks and reusable execution hooks; do not put all new product logic here |
| `backend/src/providers/index.ts` | Resolve only configured providers; fail closed in production; keep simulator explicit for dev/test |
| `backend/src/providers/payment-provider.ts` | Define verified webhook, quote, collection, payout, status lookup and refund capabilities (capabilities can be optional by provider) |
| `backend/src/app.ts` | Mount versioned routers for payments, people, PushBill, Circles, Borderless, Cards and Escrow, plus provider webhooks |
| `backend/src/routes/me.routes.ts` | Keep profile summary; expose only user-owned normal wallets and safe status fields |
| `mobile/lib/screens/home_shell.dart` | Replace current Coming Soon scan action with scanner entry; retain simple bottom navigation |
| `mobile/lib/screens/services_screen.dart` | Link to the six product capabilities and their sub-features |
| `mobile/lib/state/app_state.dart` | Keep auth/session state; add feature repositories or feature state rather than a single giant global state object |
| `README.md` | Update product vision, six capabilities, setup, demo-vs-production warnings, providers and module map |

---

## 13. Proposed database additions by domain

| Domain | Models to add or extend |
|---|---|
| People/search | `UserSearchPrivacy` or equivalent settings; avoid a duplicate user identity table |
| Local Payments | `PaymentQuote`, `ProviderWebhookEvent`, `SettlementBatch`, `SettlementLine` |
| PushBill | `PushBillSession`, `PushBillConfirmation`, `VoiceCallAttempt`, `PushBillEvent` |
| Borderless | `PaymentCorridor`, `FxQuote`, `CrossBorderTransfer`, `ProviderSettlement` |
| Circles | `Circle`, `CircleMember`, `CircleInvitation`, `CircleGoal`, `ContributionPlan`, `ContributionRecord`, `CircleEvent`, `CircleNotificationPreference` |
| Cards | `CardProgram`, `VirtualCard`, `CardFundingSource`, `CardAuthorization`, `CardTransaction`, `CardEvent` |
| Escrow | `EscrowCase`, `EscrowFunding`, `EscrowEvidence`, `EscrowDispute`, `EscrowEvent`, `EscrowPayout`, `EscrowCustodyAccount`, `EscrowReconciliation` |
| Shared | `AuditEvent`, `ProviderWebhookEvent`, notification preferences, admin/dual-control records as required |

All financial identifiers and provider references should be indexed, unique where appropriate, and protected by idempotency. Store money amounts as `BigInt` minor units and store exchange rates as fixed-precision decimals.

---

## 14. API mounting plan

Keep the existing `/v1` convention. Add route modules and mount them in `backend/src/app.ts`:

```text
/v1/me
/v1/kyc
/v1/payment-methods
/v1/payments
/v1/transactions
/v1/people
/v1/pushbills
/v1/circles
/v1/borderless
/v1/cards
/v1/escrow
/v1/merchants
/v1/agents
/v1/ussd
/v1/webhooks/payments/:provider
/v1/webhooks/voice/:provider
/v1/webhooks/cards/:issuer
/v1/webhooks/escrow/:partner
```

Webhook routes require provider signature validation, event replay protection, idempotent handling and strict event-to-transaction matching. Never trust a client-submitted `SUCCESS` status.

---

## 15. Mobile user-experience map

Top-level home should expose six clear entries:

1. Local Payments
2. PushBill ★
3. Borderless Payments
4. Circles ★
5. Virtual Cards & Online Payments
6. Escrow ★

Each gets its own screen, flow and explanation rather than a crowded multi-feature collage.

### PushBill screens

- Scan QR / enter Lipa Namba / agent number
- verify merchant destination
- amount and reference
- select payer via search/Circle
- live request status
- normal call prompt/status
- payer review + authorisation
- payment receipt

### Circle screens

- Circle discovery/list
- Create Circle template selector
- Circle name, purpose and goal setup
- Invite/search members
- member and role management
- contribution plan
- individual contribution history
- progress dashboard and exportable report

### Escrow screens

- Create deal / accept deal
- terms and inspection period review
- funding source selection
- escrow wallet status showing held funds (not spendable balance)
- seller fulfilment/evidence
- buyer accept or dispute
- release/refund status
- dispute timeline and receipts

---

## 16. Implementation sequence and release gates

### Phase 0 — Stabilise the current prototype

- Create a feature branch and tag the current baseline.
- Run backend typecheck, unit tests, Prisma validation and ledger reconciliation.
- Build Flutter app and document current screens.
- Confirm `.env` variables and keep all secrets out of Git.
- Fix production simulator fallback before any real transaction testing.

**Gate:** existing prototype builds and tests; ledger invariants pass.

### Phase 1 — Shared financial foundation + Local Payments

- complete transaction API routes and PIN authorisation;
- finish provider selection/quote experience;
- implement explicit provider adapters one by one in partner sandbox;
- implement verified webhooks and reconciliation;
- complete QR/manual merchant payment UI;
- distinguish prototype/demo balances from live partner-issued balances.

**Gate:** one selected provider completes a full sandbox flow; no other provider is silently substituted.

### Phase 2 — PushBill ★

- add schema, services, state machine and endpoints;
- implement user search and Circle payer selection hook;
- integrate normal cellular voice call/bridge provider;
- implement app and USSD initiation/authorisation flows;
- implement no-answer, decline, call-drop, timeout and payment-unknown handling.

**Gate:** all mandatory-call and no-payment-without-authorisation tests pass.

### Phase 3 — Circles ★

- build shared Circle engine;
- implement Family, Student, Vikoba, Friends and Custom templates;
- implement contribution monitoring and verified/unverified labels;
- implement reminders, roles and reports.

**Gate:** groups can organise goals without SurePesa taking custody or control of external member funds.

### Phase 4 — Borderless Payments

- select one supported corridor and partner;
- add FX quotes and explicit provider selection;
- add payout/collection status and reconciliation;
- expand only after the first corridor is stable.

**Gate:** end-to-end partner sandbox and controlled pilot pass.

### Phase 5 — Virtual Cards & Online Payments

- choose issuer/program manager;
- implement cardholder onboarding and tokenised cards;
- implement issuer webhook/auth flow;
- add wallet-link/JIT only if contractually and technically supported;
- add catalogue of services that accept the issued card/payment method.

**Gate:** issuer sandbox card and transaction lifecycle passes; PCI boundary reviewed.

### Phase 6 — Escrow ★

- confirm licensed custody/issuer/escrow partner and legal structure;
- implement EscrowCase and dedicated escrow wallet ledger;
- implement bilateral terms acceptance, funding and provider verification;
- implement evidence, delivery, accept/dispute, release/refund;
- implement dual-control admin decisions and full reconciliation;
- pilot with transaction limits and clearly defined supported deal categories.

**Gate:** funds are never released from escrow by ordinary wallet endpoints; partner custody statements reconcile to internal escrow liabilities; dispute and refund scenarios pass; legal/compliance approval is obtained before public real-money launch.

### Phase 7 — Production hardening

- penetration/security assessment;
- operational alerts and audit trails;
- incident response and customer complaint procedures;
- disaster recovery and backup restoration tests;
- provider failover only after explicit user consent where route changes affect cost/recipient;
- reconciliation runbooks and finance sign-off;
- monitoring of call costs, payment success, failed/unknown states and fraud indicators.

---

## 17. Testing requirements

### Financial integrity tests

- ledger lines balance by currency;
- insufficient funds never create a negative user/escrow balance;
- concurrent transfers cannot double-spend;
- idempotency prevents duplicate payment, funding, release or refund;
- every reversal is a new compensating transaction;
- provider webhooks are signature-checked and replay-protected;
- ledger balances reconcile with cached wallet balances and partner statements.

### PushBill tests

- valid QR and valid manual Lipa Namba;
- invalid/unverified destination;
- payer not found or inactive;
- no answer, busy, call rejected, call dropped;
- one party does not confirm;
- amount/destination changed after confirmation;
- USSD session closes before the call;
- new USSD session authorises the payment;
- payment provider unknown status and callback arrives late;
- duplicate request/callback does not double-pay.

### Circles tests

- privacy and invitation expiry;
- member roles and admin permission checks;
- self-reported versus provider-confirmed contributions;
- member leaves Circle and access is revoked;
- Circle deletion/closure preserves financial records;
- no API can debit a member's external wallet simply because they joined a Circle.

### Escrow tests

- deal terms must be accepted by both sides;
- funding is not marked complete before provider confirmation;
- escrow wallet is non-spendable through normal APIs;
- seller cannot release funds to themselves;
- buyer acceptance releases exactly once;
- dispute freezes release;
- authorised resolution supports refund or release;
- unknown payout is reconciled before retry;
- per-case held balance and total custody balance reconcile;
- admin actions have actor, reason, timestamps and audit history.

---

## 18. Compliance and real-money launch gates

This blueprint is a software architecture, not a legal determination. Before any live custody, e-money issuance, escrow or payment service is offered, SurePesa must obtain advice and the required Bank of Tanzania/licensed-partner approvals for the exact operating model. The current legal review must use the National Payment Systems Act as revised and the Electronic Money Regulations 2015 **as amended in 2026**, not rely on the unamended 2015 text alone.

The official 2026 amendment (GN No. 86, published 27 March 2026) replaces regulation 12: a non-bank payment system provider seeking to issue e-money must establish a separate legal entity with the minimum governance structure prescribed by the Bank. It also amends fee disclosure: charges/fees require prior written Bank approval before being imposed and must be clearly disclosed. The amendment does not, by itself, mean SurePesa is authorised to issue e-money; the National Payment Systems Act still requires a Bank of Tanzania licence or approval for e-money issuance. The 2015 regulations also require e-money issued to be backed by equivalent funds and safeguarded through the relevant trust/special-account structure. Counsel and the proposed issuer/custody partner must confirm how these provisions apply to the exact SurePesa structure and Escrow service.

Key design constraints to validate with counsel and the chosen licensed partner:

- who is the legal e-money issuer and who owes the customer the stored value;
- which legal entity holds safeguarded/trust/special-account funds;
- whether the proposed Escrow arrangement is a permitted payment service, trust/custody product or another regulated structure;
- how customer funds are segregated from company operating funds;
- redemption, payout, refund and unclaimed-funds procedures;
- KYC/AML, sanctions, transaction limits and record retention;
- consumer terms, fees, disputes and complaints;
- USSD/voice caller-ID and telecom consent/recording requirements;
- card issuer responsibilities and PCI compliance boundaries;
- data protection and cross-border data transfers.

Do not imply that an internal “escrow wallet” database account itself authorises SurePesa to custody customer money. It is the technical per-deal ledger and status record; a properly authorised entity must hold/control the corresponding funds.

---

## 19. Immediate next implementation task

Do not start by implementing every module in parallel. First take the existing repository through Phase 0, then implement in this order:

1. production-safe provider selection and complete Local Payments API;
2. PushBill data model, state machine and normal-call gateway;
3. shared Circles engine;
4. first Borderless corridor;
5. issuer-backed Virtual Cards;
6. Escrow module including dedicated escrow wallet ledger and custody reconciliation.

Escrow is included in the architecture from day one, and its schema/ledger boundaries should be designed before the next major migration. Its real-money release must remain gated until the custody partner and legal operating model are confirmed.

---

## 20. Sources reviewed

- Repository: https://github.com/elonixtz-dotcom/Surepesa
- Existing Prisma schema: https://github.com/elonixtz-dotcom/Surepesa/blob/main/backend/prisma/schema.prisma
- Existing payment engine: https://github.com/elonixtz-dotcom/Surepesa/blob/main/backend/src/services/payment.service.ts
- Existing ledger: https://github.com/elonixtz-dotcom/Surepesa/blob/main/backend/src/services/ledger.service.ts
- Existing provider registry: https://github.com/elonixtz-dotcom/Surepesa/blob/main/backend/src/providers/index.ts
- Existing Express app: https://github.com/elonixtz-dotcom/Surepesa/blob/main/backend/src/app.ts
- Tanzania National Payment Systems Act, 2015: https://www.bot.go.tz/Publications/Acts%2C%20Regulations%2C%20Circulars%2C%20Guidelines/Acts/en/2020030902433783.pdf
- Tanzania Electronic Money Regulations, 2015 (read with amendments): https://www.bot.go.tz/Publications/Acts%2C%20Regulations%2C%20Circulars%2C%20Guidelines/Regulations/en/2020030903230324.pdf
- Payment Systems (Electronic Money) (Amendment) Regulations, 2026, GN No. 86: https://oagmis.oag.go.tz/portal/legislation/4671/download

**Status:** Blueprint prepared from the public `main` branch files inspected on 19 November 2026. The repository itself has not been modified by this document, and no code has been committed or deployed.
