# Payment patterns teardown: M-Pesa, Mixx by Yas, Airtel Money, Selcom, Stripe

| | |
| --- | --- |
| Document type | Research input to requirements (SOP SURECOM-SD-002) |
| Status | Draft for product owner review |
| Date | 2026-10-17 |
| Method | Public sources only: official sites, app store listings, regulator publications, public developer documentation and SDKs. No decompiling, traffic capture or access to non-public systems. |

> **Verification note.** Some details below come from third-party SDKs and blogs, not official documentation. Each such claim is marked *(unverified)*. Before building against any rail, get the official spec from Vodacom, Selcom or Airtel under a signed integration agreement.

---

## 1. What changes for SurePesa (summary)

| # | Finding | Impact on SurePesa | Priority |
| --- | --- | --- | --- |
| 1 | The Bank of Tanzania's **TANQR** standard (2022, based on EMVCo) is mandatory for local-currency QR payments and covers static and dynamic codes. | Replace the planned `surepesa://pay?merchant=` QR format with TANQR/EMVCo payloads. Keep our `QrCode.type` values (STATIC, DYNAMIC); they map onto the standard directly. | **Must** before merchant QR goes live |
| 2 | Issuing e-money and running a payment service need BoT licences (Electronic Money Regulations, National Payment Systems Act). Some sources say e-money licences are limited to MNOs, with banks exempt. *(partly unverified)* | Regulatory gating item (SOP §18.3). It may shape the operating model, for example partnering with a licensed bank or EMI, or operating as an aggregator. Get legal advice before any real-money pilot. | **Must**, business decision |
| 3 | BoT fee caps for wallet↔bank transfers (circular effective 1 Jul 2025) are reported as a maximum of TZS 5,000 for transfers above TZS 500,000. *(cap value from press)* | `fee.service.ts` must enforce regulatory caps. The current withdrawal cap of TZS 5,000 happens to match, but caps should be data, not code. | Should |
| 4 | Every rail (M-Pesa Open API, Selcom, Airtel) is **asynchronous**: request → PENDING → callback/webhook. Timeouts and retries are normal. | Our engine already supports PROCESSING/PENDING. We need signed, idempotent callback endpoints per provider, plus a status-poll job for callbacks that never arrive. | Must for the real-rail phase |
| 5 | Webhook delivery is **at-least-once** (Stripe and others). | Store every inbound provider event with a unique key (`INSERT … ON CONFLICT DO NOTHING`) before acting on it. This also covers SOP §4.1 test cases (duplicate callbacks, out-of-order events). | Must |
| 6 | Users confirm the **recipient's registered name** before entering a PIN, and both sides get a receipt. | Add a "confirm recipient" step (name and masked number) between amount and PIN. Push the in-app receipt to both parties, with SMS later. | Must for P2P |
| 7 | Mixx supports sending to **up to 5 recipients at once** and linking up to 5 accounts. | Backlog: bulk send (reuses the engine, one transaction per recipient). Linked-accounts cap is a sensible default. | Could |
| 8 | Airtel shows the **cash-out fee upfront** ("send with withdraw fee"). | Fee preview in the confirmation screen before PIN. Never surprise the user after confirming. | Should |

---

## 2. Consumer journeys (M-Pesa, Mixx, Airtel Money)

### 2.1 Common send-money flow
All three Tanzanian wallets follow the same shape: on USSD (`*150*00#` M-Pesa, `*334#` Airtel), on Mixx's USSD and app, and in their apps:

```
Menu → Send money → Enter number → Enter amount → [Confirm: recipient name + amount + fee] → PIN → Result → SMS receipt (both parties)
```

Patterns worth copying:
- **PIN as the final step**, after everything is confirmed. M-Pesa activation sets the PIN and verifies the user with date of birth.
- **Edit before confirm**: details can be changed up to the final confirmation, never after.
- **Receipts to both parties** with amount, counterparty, reference and the new balance.

### 2.2 Merchant payments
- Mixx's **Lipa Kwa Simu** lets customers pay a business number or a QR code, from any network, including to bank accounts. This is TANQR interoperability in practice.
- Takeaway: merchants want **one QR that works for any wallet or bank**. That's the regulatory direction, and a SurePesa merchant QR that only SurePesa users can scan would be at a disadvantage.

### 2.3 Other features seen
Bulk send (5 recipients), linked accounts (5), airtime and bundles, agent locator, micro-loans, insurance and remittances (Mixx). Customer support runs on a short code (`100`) and email.

---

## 3. Business and integration side (Selcom, M-Pesa Open API)

### 3.1 Selcom *(from third-party SDKs; confirm with Selcom)*
- REST API with **HMAC-SHA256 request signing**; vendor ID, API key and secret are issued by Selcom support, starting with test credentials.
- **Checkout API**: create an order (vendor, order ID, buyer details, TZS amount, webhook URL, redirect/cancel URLs) → receive a payment gateway URL → Selcom posts status to the webhook.
- USSD push checkout is reported to support only some networks (Airtel Money, Tigo Pesa/Mixx).

### 3.2 Vodacom M-Pesa Open API *(from public SDKs; confirm on the Vodacom developer portal)*
- Operations: **C2B** (collect from customer), **B2C** (pay out), **B2C reversal**, **transaction status**.
- Auth: API key exchanged for a session key. Market `vodacomTZN`, currency TZS.
- Request/callback model: we receive results on a callback URL and must acknowledge quickly.

### 3.3 How this maps to our code
| Rail operation | SurePesa flow | Adapter method |
| --- | --- | --- |
| C2B / Selcom checkout | `deposit()` | `PaymentProvider.collect()` |
| B2C | `withdraw()` | `PaymentProvider.payout()` |
| B2C reversal | `reverseTransaction()` of a withdrawal | new `PaymentProvider.reverse()` |
| Transaction status | stuck-PROCESSING sweeper | new `PaymentProvider.status()` |
| Callback / webhook | new `POST /webhooks/:provider` | new `PaymentProvider.parseCallback()` (verify signature, map status) |

---

## 4. Stripe: patterns for the merchant and back-office side
- **Explicit status lifecycle** per payment, with every transition recorded. We already have this (`transactions.status` plus `transaction_events`).
- **Idempotency keys** on every write; the same key returns the original result. Implemented (`initiatorUserId + idempotencyKey`).
- **Webhooks to merchants**: signed (HMAC over the raw body plus a timestamp, with a replay window), retried with backoff, and carrying event IDs so receivers can deduplicate. SurePesa should offer the same to merchants (`payment.succeeded`, `payment.failed`, `refund.succeeded`).
- **Refunds as separate objects** linked to the original payment, never edits. Implemented as REVERSAL transactions; a merchant-initiated partial **refund** type is still missing.
- **Dashboard**: payments list with filters, payment detail timeline, refund action with confirmation, event log. This is the reference for our back-office console.

---

## 5. Back-office implications (SOP §9, §16, §18)
The back-office console built alongside this document applies these patterns:
- **Customer Service** can find a customer by phone, email or SPX reference, see their 360° view, log cases and *request* a reversal. They cannot move money.
- **System Controller / Finance** approve or reject reversal requests (**maker-checker**: the requester can never approve their own request), review KYC, monitor transactions and reconciliation, and read the audit log.
- Every privileged action, and every view of a customer record, is written to `audit_logs`.

---

## Sources
- Bank of Tanzania, *TANQR Code Standard 2022* (guideline PDF): https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Guidelines/en/2022081908570183.pdf
- BoT circular on wallet↔bank fee caps (2025): https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Circulars/en/2025111916152484.pdf
- Daily News, *Tanzania steps up measures to lower the cost of mobile money transactions*: https://dailynews.co.tz/tanzania-steps-up-measures-to-lower-the-cost-of-mobile-money-transactions/
- RegAlert, *Tanzania: fintech & payments regulation*: https://regalert.today/guides/fintech/TZ
- Global Law Experts, *Bank & payment service provider licensing requirements, Tanzania*: https://globallawexperts.com/bank-payment-service-provider-licensing-requirements-tanzania/
- Policy Vault, *The Electronic Money Regulations*: https://www.policyvault.africa/policy/the-electronic-money-regulations/?version=0
- TransFi, *Tanzania's payment rails*: https://www.transfi.com/id/blog/tanzanias-payment-rails-how-they-work---mobile-money-interoperability-bank-transfers-qr-codes
- Mixx Tanzania (App Store listing): https://apps.apple.com/us/app/id825924072
- Yas, *Tigo is now Yas*: https://yas.co.tz/?p=27235
- WorldRemit, *M-Pesa Tanzania* (activation/PIN flow): https://www.worldremit.com/en/tanzania/mobile/m-pesa-tanzania
- Hostguru, *How to make payments* (M-Pesa USSD menu flow): https://hostguru.africa/portal/knowledgebase/4606/How-to-make-payments.html
- The Citizen, *Airtel Money launches "Send with withdraw fee"*: https://www.thecitizen.co.tz/tanzania/business/airtel-money-launches-send-with-withdraw-fee-service-2694802
- Flutterwave, *Tanzania mobile money* (async authorization): https://developer.flutterwave.com/docs/tanzania
- mctaba, *Tanzania M-Pesa vs Kenya M-Pesa for developers*: https://mctaba.com/learn/tanzania/tanzania-mpesa-vs-kenya-mpesa-developers
- mctaba, *E-commerce checkout in Tanzania*: https://mctaba.com/learn/tanzania/ecommerce-checkout-tanzania
- mpesa_sdk (Dart, Vodacom Open API): https://pub.dev/documentation/mpesa_sdk
- elixir_mpesa (market config): https://readme.hex.pm/elixir_mpesa/0.2.0
- bryceandy/laravel-selcom (Selcom Checkout wrapper): https://github.com/bryceandy/laravel-selcom
- lipa-py (Selcom HMAC signing): https://pypi.org/project/lipa-py/0.1.0/
- Stripe, *Webhook signatures*: https://docs.stripe.com/webhooks/signature
- Activepieces, *Webhook idempotency: handling duplicate events*: https://www.activepieces.com/blog/webhook-idempotency-how-to-handle-duplicate-events-2026
