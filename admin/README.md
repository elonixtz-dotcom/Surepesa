# SurePesa Back Office

Web console for SURECOM staff. One app, and each person sees only the screens their role allows (SOP §9 roles, §16 approval matrix).

| Role | Label | Can | Cannot |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | **System Controller** | Everything below, plus the overview, system health and audit log | Approve a request they raised |
| `SUPPORT` | **Customer Service** | Find customers, view the customer 360, open and work cases, *request* reversals | Move money, see full ID numbers or KYC documents, suspend accounts |
| `FINANCE` | Finance | Approve or reject reversals, view reconciliation and system health | Approve a request they raised |
| `COMPLIANCE` | Compliance | Review KYC with documents, suspend or reactivate accounts, read the audit log | Approve reversals |

## Screens

**System control:** Overview (KPIs, 14-day volume, queues needing attention, recent failures) · KYC review (queue and document viewer) · System health (dependencies, ledger reconciliation, stuck payments) · Audit log.

**Customer service:** Service desk (search plus my open cases) · Customers · Customer 360 (balance, activity, KYC, case history; every view is audited) · Cases (notes, status, priority, assignment, reversal request).

**Payments:** Transactions (filters, search by SPX reference or phone; detail shows the status timeline and ledger postings) · Approvals (maker-checker queue).

## Controls built in
- **Maker-checker:** reversals are requested by one person and decided by another. The server rejects self-approval (`SELF_APPROVAL`).
- **Audit trail:** logins, failed logins, customer and KYC views, status changes, case updates, and every request and decision are logged.
- **Staff auth is separate from customer auth:** staff accounts live in `admin_users` with scrypt passwords and 8-hour HS256 tokens. The account locks for 15 minutes after 5 failed attempts, and the login endpoint is rate-limited per IP.
- **Data minimisation:** Customer Service sees masked ID numbers. KYC documents are served only through 5-minute presigned links.

## Run locally

```bash
# API (from backend/)
npm run dev                                   # http://localhost:4000
npm run admin:create -- you@surecom.co.tz "Your Name" SUPER_ADMIN   # prints a one-time password
npm run seed:demo                              # optional: synthetic customers, payments, a case

# Console (from admin/)
npm install
npm run dev                                    # http://localhost:5173 (proxies /admin to the API)
npm run build                                  # type-check + production bundle in dist/
```
