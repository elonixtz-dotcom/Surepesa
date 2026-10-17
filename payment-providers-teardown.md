# Tanzanian payment providers: REA website teardown

Captured 2026-10-17 with REA 6.5.0 `inspect_web_page`. REA attached passively to an
isolated headless Edge (155) and recorded DOM, accessibility text, scripts, storage
key names (values redacted) and limitations. It did not log in, click, or submit
anything.

Each finding is labelled:
- **Observed**: on the page, with the REA Evidence ID.
- **Inferred**: my reading of that evidence.
- **Unknown**: the public web doesn't show it.

Per-page digests are in [evidence/](evidence/).

## What a website teardown can and can't show

The flows you named for study (PIN confirmation, receipts, transaction history,
recipient confirmation, notifications) happen in **USSD menus, the native apps and
SMS**, not on these websites. No public page showed them. Getting that evidence
would mean analysing the Android apps, which the providers' terms generally
prohibit, or documenting your own handset sessions by hand. The richest public
sources turned out to be the developer docs: **Selcom** (open) and **Stripe** (open).
The M-Pesa and Airtel developer portals are behind a login or country gate.

Coverage caveat on every capture: REA records network traffic only from the moment
it attaches. All pages had already loaded, so **no API calls were observed**.
Every capture reports `policy_filtered` / `attach_limited` completeness.

---

## 1. M-Pesa Tanzania (Vodacom)

**Observed**
- `vodacom.co.tz/m-pesa` (the URL in most write-ups) renders a client-side **404
  page**, even though the server returns HTTP 200
  (`ev_158c07bc…5717`). The site's own navigation links to `/mpesa` instead.
- `vodacom.co.tz/mpesa` lists these products: **Lipa Kwa Simu** (merchant pay),
  **Changisha** (group contributions/collections), **International Money Transfer**
  ("200 countries") and the **M-Pesa App**. Its tagline is "Send money, pay bills, access loans"
  (`ev_66e2e7bb…a6`).
- The site is a PWA with a Workbox precache (`workbox-precache-v2`). It uses no local
  or session storage.
- `openapiportal.m-pesa.com` opens on a **login wall** with Developer and Organisation
  tabs, a forum and sign-up. After login it keeps `authToken`, `refreshToken` and
  `userType` in **localStorage** (`ev_5b5622c9…7f`).

**Inferred**
- Developer and organisation accounts are separate, so API access is tied to a
  registered business. Expect onboarding and KYB before any sandbox.
- Keeping bearer and refresh tokens in localStorage exposes them to XSS. Your app should
  keep them in httpOnly cookies or secure device storage instead.

**Unknown:** API shapes (behind the login), app UX, PIN and receipt flow.

## 2. Mixx by Yas (formerly Tigo Pesa)

**Observed** (`ev_21435034…af`, `ev_0cccf8a8…69`)
- Products: **Bustisha** (credit/boost), **Nivushe Plus**, **Lipa Kwa Simu**,
  **Government Payments** (GePG).
- **Business 360 Portal**: one hub for businesses to collect and disburse payments.
- Super App features:
  - link multiple Mixx accounts and switch profiles
  - send to multiple recipients at once
  - **personal messages on transfers** (birthday or seasonal notes)
  - agent and shop locator
  - corporate salary advances and expense management
  - embedded **mini apps** (DStv, TRC)
- Audience segments in the navigation: Consumers, Corporate, Merchant Business, Agents.
- Support channels: short code 100, WhatsApp, email.
- The site runs on WordPress (`wpEmojiSettingsSupports`), with all scripts first-party.

**Inferred:** Mixx builds the app around multiple profiles and multiple recipients,
and adds a social layer (messages on payments). A mini-app platform puts billers
inside the wallet rather than sending users out to them.

**Unknown:** no public developer docs were found, and the menu structure isn't shown.

## 3. Airtel Money Tanzania

**Observed** (`ev_73503e1d…83`, `ev_6fa7e566…f6`, `ev_85527f2f…1b`)
- Airtel Money has its own site, `airtelmoney.tz`. It lists:
  - Airtel Vikoba (group savings), Kamilisha, Timiza and Timiza Akiba (loans/savings)
  - Smart Banking, AFYA bima (insurance)
  - send and receive abroad, Lipa Ada (school fees)
  - **"Lipa kwa simu mitandao yote"** (merchant pay that works across all networks)
  - **Bulk Disbursement**
  - an **Anti Money Laundering portal** and a published tariffs page
- The airtel.co.tz homepage asks for the mobile number first: a "255" prefix plus a
  number field, then PROCEED.
- Both sites store **`reese84`**, an Imperva bot-protection token.
- `developers.airtel.africa` opens on a **country picker**: "applications are managed
  per Op-Co", with Tanzania as one option. Its sessionStorage holds `XCountry`, a
  country id, `language` and `fingerprint`.

**Inferred**
- An Airtel integration is set up per country, so credentials and apps differ by
  market. Starting with the phone number (prefix fixed, number entered) is a pattern
  worth copying.
- Bot protection on the public site means scraping it isn't a reliable route.

**Unknown:** API docs (behind the country and login gate), the payment notification
format.

## 4. Selcom (the best public API reference)

**Observed** from `developers.selcommobile.com` (`ev_a04ecb9a…24`, captured via the
REA CLI because it exceeds 10 MB):

**Access and authentication**
- You get an API key and secret by contacting the business team.
- **Every request (GET or POST) carries a cryptographic signature in a Digest header.**
- Client SDKs exist for PHP, Java, C#, Python, Node (`selcom-apigw-client`), WordPress
  and WooCommerce.

**Ambiguous outcomes are documented.** On `INPROGRESS` or `AMBIGUOUS`:
1. Wait **3 minutes**.
2. Call the status-query API.
3. Repeat every 3 minutes within a reasonable window.
4. Escalate to the helpdesk if it still hasn't resolved.

Every product has its own `/query` endpoint "in case of a timeout or ambiguous response".

**Product APIs (all `/v1/…`)**

| Area | Endpoints |
|---|---|
| Utility/bill pay | `POST utilitypayment/process`, `GET utilitypayment/lookup` (validate meter/account first), `GET utilitypayment/query` |
| Wallet cash-in (send to any wallet) | `POST walletcashin/process`, `GET walletcashin/namelookup`, `GET walletcashin/query` |
| Selcom Pesa | `POST selcompesa/cashin`, `namelookup`, `query` |
| Agent cash-out | `POST hudumacashin/process`, `query` |
| Float | `POST vendor/balance` |
| Push-USSD collection | `POST wallet/pushussd`, `GET c2b/query-status` |
| Bank transfer (Qwiksend) | `POST qwiksend/process`, `GET qwiksend/lookup` (account name), `query` |
| Virtual cards (VCN) | create, status, change status (block/unblock/suspend), show, set limit |
| Checkout | `create-order`, `create-order-minimal` (non-card), `cancel-order`, `order-status`, `list-orders`, `stored-cards`, `delete-card`, `card-payment`, `wallet-payment`, `selcompesa-payment`, `create-till-alias`, `initiate-pos-payment`, `pos-payment-status` |
| International transfer (IMT) | wallet and bank name lookup, send money (async, with a callback for final confirmation) |

**C2B "integrated merchant" flow.** Selcom calls *your* system:
- `POST /lookup`: Selcom asks you to resolve a payment reference to a customer name and
  amount.
- `POST /validation`
- `POST /notification`

You reply with result codes:

| Code | Meaning |
|---|---|
| `000` | Success |
| `010` | Invalid reference |
| `012` | Invalid amount |
| `014` | Amount too high |
| `015` | Amount too low |
| `4XX` | Other failures |

The `operator` field names the originating wallet: `AIRTELMONEY`, `MPESA-TZ`,
`TIGOPESATZ`, `HALOPESATZ`, `TTCLMOBILE` or `ZANTELEZPESA`.

**Status vocabularies**
- Order `payment_status`: `PENDING, COMPLETED, CANCELLED, USERCANCELLED, REJECTED,
  INPROGRESS`.
- Webhook: `result` is `SUCCESS`/`FAIL`, and `payment_status` is one of `COMPLETED, CANCELLED, PENDING,
  USERCANCELED`. Note the different spelling.
- **The webhook fires only on successful transactions.** Every other outcome has to be
  polled.
- Checkout URLs in requests and responses are **base64-encoded**. Amounts are in TZS or USD.
- **Till Alias**: create secondary Lipa numbers under one till, payable from any
  network via **TanQR**, with settlement to the primary till.

**Inferred:** Selcom is the aggregator. One integration reaches every Tanzanian wallet,
banks, billers, GePG and cards. For a new app it's the most realistic first
integration, with direct M-Pesa or Airtel APIs coming later.

## 5. Stripe (business-side reference, not available in TZ)

**Observed** (`ev_ee9f9f33…65`, `ev_99fb8d1a…35`, `ev_fbbd5630…b4`)

**Webhooks**
- Verify the `Stripe-Signature` header against the **raw, unparsed body**, using a
  secret per endpoint.
- Signatures carry a timestamp with a **5-minute tolerance** against replay attacks.
- Secrets can be rolled with up to **24 hours** of overlap.
- **Return 2xx quickly** and process asynchronously through a queue.
- **Duplicates happen**, so dedupe on the event or object ID.
- **Event order isn't guaranteed.**
- Delivery is retried with exponential backoff for **up to 3 days** in live mode, and
  can also be retried manually.
- Subscribe only to the event types you need.

**Refunds**
- Full refunds by default, with partial refunds and multiple partial refunds allowed.
- A refund draws on the *available* balance. If that's short, a card refund is held as
  pending, while other payment methods fail.
- Refunds can fail (lost or stolen card, expired payment method, a dispute opened
  meanwhile) and some need action. Events: `charge.refunded`, `refund.failed`.
- A card refund reaches the customer about **5–10 business days** after it's initiated.
  An ARN (the card network's reference number for tracing a refund) comes within 7 days.
- *Cancelling* a payment that hasn't completed is a different operation from
  *refunding* one that has.

**API conventions**
- **Idempotency keys** (V4 UUID recommended): the first response is saved and replayed
  on retries, and keys are pruned after 24 hours or more.
- Cursor pagination, expandable objects, dated API versions, and `metadata` (never
  sensitive data).

---

## Design takeaways for your Tanzanian payments app

These are design choices drawn from the observations above, not observed facts.

1. **Plan for ambiguous outcomes.** Mobile money often times out mid-transaction.
   Give every transaction a state machine:
   `CREATED → PENDING_USER (push USSD/PIN) → IN_PROGRESS → SUCCEEDED | FAILED | CANCELLED | USER_CANCELLED | EXPIRED`,
   plus `AMBIGUOUS`, which resolves only by **status query**. Selcom's 3-minute polling
   rule is a sensible default.
2. **Look up before you send.** Wallet, bank and utility lookups return the
   recipient's registered name. Show it in a confirmation step ("Send TZS 5,000 to
   JUMA H. MOSHI?") before asking for the PIN. All three operators work this way.
3. **Use push USSD and PIN on the handset for wallet pulls.** Never collect the wallet
   PIN in your app.
4. **Don't rely on webhooks alone.** Selcom calls back only on success, so a
   reconciliation job must poll for everything else. Make your own webhooks
   Stripe-grade: signed raw body, timestamp tolerance, quick 2xx, dedupe by ID, no
   ordering assumption, retries for days.
5. **Idempotency on every money-moving call.** Your `transid`/`order_id` should *be*
   the idempotency key. Never reuse it.
6. **Normalise status vocabularies.** Providers disagree: `USERCANCELLED` vs
   `USERCANCELED`, `COMPLETED` vs `SUCCESS`. Map them into one internal enum at the
   edge.
7. **Refunds in mobile money are reversals.** Mobile money has no card-style refund
   rail, so a "refund" is a new cash-in to the payer's wallet with a link to the
   original transaction. Copy Stripe's model: partial refunds, a separate refund
   status, and a failure path when float is too low (Selcom exposes `vendor/balance`).
8. **Receipts**: carry both IDs, the channel's transaction ID *and* the gateway
   reference. Selcom returns both, along with the channel name and payer MSISDN.
9. **Merchant features worth copying**: till aliases / TanQR, collections where
   you resolve the reference (Changisha), bulk disbursement, a Business 360-style
   dashboard.
10. **Consumer features worth copying**: start from the phone number with `255`
    prefilled, multi-recipient send, notes on transfers, multiple profiles, embedded
    biller mini-apps, and both Swahili and English throughout.

## Evidence index

| Page | REA Evidence ID |
|---|---|
| vodacom.co.tz/m-pesa (404) | `ev_158c07bc50ab588d10cba93049106e65fd7494523a71aad96f5aeb3c89ef5717` |
| vodacom.co.tz/mpesa | `ev_66e2e7bb2afbd1630ed92ea676c73d29bed1aef79767c370c647ee967c23aea6` |
| openapiportal.m-pesa.com | `ev_5b5622c9d10e2fe85cf8e5b16cb42853edd3678dfc2076fb0b549687f972d27f` |
| mixx.co.tz | `ev_2143503477aeabd61cd470ad71b49b400a910c47e9a694a87e675de1f337e2af` |
| yas.co.tz | `ev_0cccf8a8046733a214533c94ae7764445fe42e105f6cc76240054d9fdfb5b869` |
| airtel.co.tz | `ev_73503e1d62b191f14745cba675af4369aace6f3c4340f8fc159b8f450c2bef83` |
| airtelmoney.tz | `ev_6fa7e566a0f6eb4618c79cc262bcb95021a559b4c5492d972d776455b9b376f0` |
| developers.airtel.africa | `ev_85527f2ffef298559432e186900ce2d5b8407b724d12e3cee5c948e0c1e3f81b` |
| selcom.net | `ev_0037f87523a6feb740f4cc35ac75ab00085dccd19a0494fbe82c15b410ad72c8` |
| developers.selcommobile.com | `ev_a04ecb9aae09f9e7db06f3c088823e9f914551caf3987c818492c35acd90f924` |
| docs.stripe.com/webhooks | `ev_ee9f9f33009d64f2021ced72c55595a43fc13bf5363ac1d8b9c97605dbde1665` |
| docs.stripe.com/refunds | `ev_99fb8d1a059a335c0ef0d5da835df7f52e4c19af12d6637c5c35302edf92d374` |
| docs.stripe.com/api | `ev_fbbd5630221b19ba1760239d27743b85f95da4dcbe4ac68b84350ba6b6c524b4` |

Stripe.com's homepage (`stripe-site.digest.txt`) was captured too but added nothing
beyond marketing copy.
