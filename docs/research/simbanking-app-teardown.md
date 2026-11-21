# SimBanking (CRDB Bank) — App Teardown

**Date:** 2026-11-22 · **Method:** public-source reverse engineering (CRDB official pages, App Store listing + version history + reviews, Tanzanian press and how-to guides). No binary analysis.
**Purpose:** map SimBanking's full feature set and workflows, and extract design lessons for SurePesa.

SimBanking is the benchmark digital-banking product in Tanzania: launched 2011/2012, >95% of CRDB services reachable through it, >86% of the bank's customer transactions already digital. Available as an app (iOS/Android) and USSD (`*150*03#`) — the two channels are one product, with the USSD menu doubling as the OTP issuer for app activation.

Sources: [CRDB mobile banking page](https://crdbbank.co.tz/en/for-you/ways-to-bank/mobile-banking), [App Store listing](https://apps.apple.com/tz/app/crdb-bank-simbanking/id1156903371), [Enhanced SimBanking launch post (Oct 2026)](https://crdbbank.co.tz/en/about-us/media-center/blog-post/crdb-bank-goes-extra-mile-enhanced-simbanking), [Benki ni SimBanking promotion](https://crdbbank.co.tz/en/about-us/media-center/blog-post/crdb-bank-reward-regular-simbanking-users-over-half-billion-shillings), [CRDB Lipa Hapa (TANQR)](https://crdbbank.co.tz/en/for-business/ways-to-bank/crdb-lipa-hapa), [registration guide (Swahili)](https://www.nijuzehabari1.com/jinsi-ya-kujisajili-simbanking-app/), [fee table](https://tzcareers.com/makato-ya-crdb-sim-banking/).

---

## 1. Feature inventory

### Accounts & onboarding
- **Full-KYC account opening inside the app** — including fingerprint scan at onboarding; no branch visit.
- **Three self-service registration paths:** USSD `*150*03#`; any CRDB ATM with a TemboCard; branch only if you have no card. Quick registration by scanning a TemboCard (added v15, 2025).
- **Diaspora account opening** (Tanzanite, TZS/USD/GBP/EUR) directly from the app.
- **Family Banking (2026):** Junior & Teen accounts — parent-managed child accounts.
- **Single view of all CRDB accounts** + ability to **link accounts** (users still ask for linking *multiple* external accounts — unsolved).
- **Lead generation without an account:** non-customers can leave business details and get contacted — the app is an acquisition funnel, not just a service channel.

### Transfers
- Intra-CRDB transfers; own-account transfers; to other local banks (TISS); international (SWIFT, internet banking).
- **Bank → mobile money** (M-Pesa, Tigo Pesa, Halopesa, Airtel Money) — recipient picked from phone contacts **without choosing the network** (network auto-detection from the number).
- **Send to many** (bulk payments, enhanced 2026).
- **Standing orders** (2026).
- **Cardless send:** send to a person with **no bank account and no card** — they withdraw at ATM/Wakala with a token.
- **Account sharing:** share your account details / personal QR to *receive* money in a few taps (2025).

### Payments & bills
- Bill pay catalogue: LUKU (instant token on screen), DAWASCO/Moruwasa water, TRA (tax), BRELA, TPA, GePG government payments, DSTV/Startimes/Azam, universities (SUA etc.), airlines.
- **TANQR + Lipa Namba merchant payments** — scan merchant QR or dial Lipa Namba; merchants self-serve QR generation and transaction history in-app.
- **Personal QR** for P2P receive (2025).
- Airtime purchase for self and others.
- **Miniapps (2025):** in-app third-party services — DSTV, SGR train bookings, insurance and more. SimBanking is becoming a super-app container.

### Cards
- TemboCard management: **block/unblock instantly**, apply for a card in-app, usage alerts (SMS/push).
- **Virtual card services** (2026).

### Credit & investment
- **Salary Advance** in-app.
- **Instant loans** without forms or branch visits; loan management view.
- **Investment & brokerage (2026):** Mwanahisa — track shares/returns in-app; iTrustBond IOP; EFTA bond; **Albarakah Sukuk** — Tanzania's first digital Islamic bond (Aug 2025).

### Insurance
- Buy insurance and use a premium calculator in-app.

### Engagement & personalization
- **SimBanking Stories** — short in-app stories teaching features and user journeys (2025).
- **Themes** incl. a premium "Gold" theme; personalized greeting; customizable feature shortcuts (circular feature selector).
- **AI/ML-powered search** across the app (2026).
- Bilingual English/Kiswahili; DRC/Burundi siblings add French/Kirundi.
- Promotions: "Benki ni SimBanking" — 10-month campaign, TZS 565M+ in cash, phones, cars to drive habit formation.

### Security
- PIN on every transaction; secure login PIN; OTP (via USSD `*150*03#` menu or SMS, 5-minute validity) for app activation; fingerprint at onboarding; card block; PIN change in-app.

---

## 2. Key workflows

### 2.1 App activation (existing CRDB customer)
1. Install app → enter SimBanking PIN → enter account number → request one-time PIN.
2. OTP arrives by SMS (issued via the USSD menu: `*150*03#` → 7 "Huduma za ziada" → 4 "Sajili SimBanking App"). OTP valid **5 minutes**.
3. Enter OTP → app bound to the account.
*Design note: USSD is the recovery/activation rail for the app — no dependence on email or branch.*

### 2.2 New customer, no account
Open app → full-KYC account opening flow → fingerprint scan → account created → immediate access. No paperwork, no branch.

### 2.3 Send money to mobile money
Contacts permission → pick contact (number auto-resolves the MNO — no network picker) → amount → PIN → done. Fees are tiered by band (e.g. 5,000–10,000 TZS → 1,271 TZS fee; 500,001–1M → 5,423 TZS). MNO→bank direction is free.

### 2.4 Cardless withdrawal ("Cashout")
App generates a **withdrawal token** (short code) → token valid ~5 minutes → at any CRDB ATM or Wakala agent, enter token → cash. Same flow lets you *send cash* to someone without any account: forward them the token.
*Known weakness (user reviews):* tokens cannot be cancelled once issued — if forwarded to the wrong person you wait out the 5 minutes.

### 2.5 LUKU (prepaid electricity)
Pay → **token displayed instantly on the app screen** (not only SMS) → also stored in history for re-retrieval.

### 2.6 Merchant payment (TANQR / Lipa Namba)
Scan merchant's TANQR QR → confirm merchant name + amount → PIN → real-time settlement to merchant's account. Fallback: dial the merchant's Lipa Namba alias via USSD. Merchants generate codes in-app themselves.

### 2.7 Salary advance / instant loan
Eligibility pre-computed server-side → offer shown in-app → accept terms → disbursement to account immediately. Loan status/repayment tracked under "Manage your loans".

### 2.8 Lost card
Cards section → block TemboCard instantly (reversible unblock in-app). Alerts for every card transaction.

---

## 3. Published limits & fees (retail)

| Transaction | Limit |
|---|---|
| Bank → MNO transfer | 2M TZS / transaction |
| Account → account | 8M TZS / day |
| Own accounts | 10M TZS / day |
| Airtime top-up | 200k TZS / transaction |
| Cardless withdrawal | 1M TZS / day |
| Paperless OTC withdrawal | 20M TZS / day |

MNO transfer fees are banded (see §2.3); incoming MNO→bank is free.

---

## 4. What real users complain about (App Store reviews)

1. **Receipts lost thousands separators** after an update — small formatting regressions are visible and erode trust.
2. **Contact picker can't handle contacts with multiple numbers** — silently picks the first.
3. **No fee shown before/after the transaction** — users explicitly ask for per-transaction fee transparency.
4. **Cash-out tokens can't be cancelled** — feels unsafe.
5. Can't link more than one external account.

## 5. Lessons for SurePesa

| SimBanking pattern | SurePesa status / action |
|---|---|
| USSD as activation + fallback rail | Not applicable to a web/app wallet, but the principle stands: **a low-tech recovery path** (e.g. voice/OTP — our PushBill voice confirmation is a genuine differentiator here) |
| Fee shown transparently per transaction | **Adopt now** — show fee + total on our confirm screen before PIN; users demand it |
| Cash-out tokens cancellable by the sender | **Adopt** — if we ever add agent/ATM cash-out, make tokens revocable while unclaimed |
| Send-to-many + standing orders | **Adopt** — natural extensions of our payment engine; standing orders pair well with Circles contributions |
| Number → network auto-detection | Already our provider-routing principle; keep it invisible |
| Instant LUKU-style fulfilment on screen | Our online-services catalogue should deliver tokens/vouchers **in-app with history**, not just via SMS |
| Miniapps ecosystem | Later — but our online-services catalogue is the seed; design it as a container, not a flat list |
| Stories / in-app education | Cheap to copy: feature tips inside notifications centre |
| Family/junior accounts | Interesting Circles-adjacent product: guardian-controlled sub-wallets |
| Virtual cards | Already shipped (issuer-simulated) — parity with their 2026 release |
| Receipts: formatting matters | Our receipts must keep grouping separators and be shareable — tiny detail, real reviews |
| App as acquisition funnel (lead capture pre-account) | Our sign-up already collects phone before full KYC — keep the funnel lossless |

**Their structural weaknesses we can beat:** bank-centric (CRDB accounts only; we are provider-neutral), slow fee transparency, no token cancellation, and a 223 MB app vs our lightweight web app.
